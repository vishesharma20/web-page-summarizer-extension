/**
 * worker.js — Cloudflare Worker
 *
 * Purpose: sit between the extension and Groq so the real API key never
 * ships inside the extension's client-side code.
 *
 * The extension sends page text here. This worker:
 *   1. Checks a lightweight shared-secret header (cuts down on random bots
 *      hitting the endpoint — NOT a substitute for rate limiting).
 *   2. Enforces per-IP and global daily rate limits using Workers KV, so
 *      one abusive user (or a leaked secret) can't drain your Groq quota.
 *   3. Calls Groq with the real key (stored as a secret, never in code).
 *   4. Returns the raw completion text; the extension parses bullets itself
 *      the same way it does for user-supplied keys.
 *
 * Required setup (see backend/README.md for full steps):
 *   - Secret:      GROQ_API_KEY
 *   - Secret:      SHARED_SECRET      (any random string you invent)
 *   - KV binding:  RATE_LIMIT_KV
 */

const PER_IP_HOURLY_LIMIT = 15;   // requests/hour per visitor IP
const GLOBAL_DAILY_LIMIT = 300;   // total requests/day across all users — protects your Groq quota
const MAX_CONTENT_CHARS = 20000;  // guard against giant payloads

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Ext-Secret",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

async function incrementAndCheck(env, key, limit, windowSeconds) {
  const current = parseInt((await env.RATE_LIMIT_KV.get(key)) || "0", 10);
  if (current >= limit) return false;
  await env.RATE_LIMIT_KV.put(key, String(current + 1), {
    expirationTtl: windowSeconds,
  });
  return true;
}

function buildPrompt(title, url, content, maxBullets) {
  return (
    `Summarize the following webpage into ${maxBullets} concise, information-dense bullet points. ` +
    `Only use information present in the text. Do not add outside knowledge or opinions. ` +
    `Return ONLY the bullet points, one per line, each starting with "- ". No preamble, no closing remarks.\n\n` +
    `Title: ${title}\nURL: ${url}\n\nContent:\n${content}`
  );
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    // Lightweight gate — matches the constant baked into the extension.
    // This is NOT secret-proof (client code can always be read), it just
    // filters out random internet traffic hitting the endpoint directly.
    const provided = request.headers.get("X-Ext-Secret") || "";
    if (!env.SHARED_SECRET || provided !== env.SHARED_SECRET) {
      return json({ error: "Unauthorized" }, 401);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const { title = "", url = "", content = "", maxBullets = 5 } = body;
    if (!content || content.trim().length < 40) {
      return json({ error: "Not enough content to summarize" }, 400);
    }

    // --- Rate limiting ---
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const hour = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
    const day = new Date().toISOString().slice(0, 10);  // YYYY-MM-DD

    const ipOk = await incrementAndCheck(
      env,
      `ip:${ip}:${hour}`,
      PER_IP_HOURLY_LIMIT,
      3600
    );
    if (!ipOk) {
      return json(
        { error: "Rate limit reached for your IP. Try again later." },
        429
      );
    }

    const globalOk = await incrementAndCheck(
      env,
      `global:${day}`,
      GLOBAL_DAILY_LIMIT,
      86400
    );
    if (!globalOk) {
      return json(
        { error: "Daily summary budget reached. Try again tomorrow, or add your own API key in Settings." },
        429
      );
    }

    // --- Call Groq with the server-side key ---
    const trimmedContent = content.slice(0, MAX_CONTENT_CHARS);
    const prompt = buildPrompt(title, url, trimmedContent, maxBullets);

    try {
      const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.3,
          max_tokens: 600,
        }),
      });

      if (!groqRes.ok) {
        const errText = await groqRes.text().catch(() => "");
        return json(
          { error: `Groq error (${groqRes.status}): ${errText.slice(0, 200)}` },
          502
        );
      }

      const data = await groqRes.json();
      const text = data.choices?.[0]?.message?.content || "";
      return json({ text });
    } catch (err) {
      return json({ error: err.message || "Upstream request failed" }, 502);
    }
  },
};
