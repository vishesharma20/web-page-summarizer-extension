/**
 * background.js — MV3 service worker.
 * Central place for anything that needs to live outside the popup:
 *  - talking to the AI provider APIs (keeps fetch logic in one spot)
 *  - falling back to the local summarizer when no key is configured
 *
 * Message protocol (popup -> background):
 *   { type: "SUMMARIZE", pageData: { title, url, content }, settings }
 * Response:
 *   { success: true, summary, bullets, method } or
 *   { success: false, error }
 */

importScripts("lib/summarizer.js");

// --- Developer-hosted proxy config -----------------------------------
// Fill these in after deploying backend/worker.js (see backend/README.md).
// This lets users get real AI summaries with ZERO setup on their end —
// your Groq key lives on the server, never in this file.
const DEVELOPER_PROXY_URL = "https://webpage-summarizer-proxy.vishesh-dev.workers.dev/summarize";
const EXTENSION_SHARED_SECRET = "haqiutj4e3mcnv7g0zlp516w";
// -----------------------------------------------------------------------

const DEFAULT_SETTINGS = {
  provider: "hosted", // "hosted" | "local" | "openai" | "groq" | "anthropic"
  apiKey: "",
  maxBullets: 5
};

async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

function buildPrompt(pageData, maxBullets) {
  return (
    `Summarize the following webpage into ${maxBullets} concise, information-dense bullet points. ` +
    `Only use information present in the text. Do not add outside knowledge or opinions. ` +
    `Return ONLY the bullet points, one per line, each starting with "- ". No preamble, no closing remarks.\n\n` +
    `Title: ${pageData.title}\n` +
    `URL: ${pageData.url}\n\n` +
    `Content:\n${pageData.content}`
  );
}

function parseBullets(rawText) {
  return rawText
    .split("\n")
    .map((line) => line.replace(/^[-*•\d.\)\s]+/, "").trim())
    .filter((line) => line.length > 0);
}

async function summarizeWithOpenAI(pageData, settings) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "user", content: buildPrompt(pageData, settings.maxBullets) }
      ],
      temperature: 0.3,
      max_tokens: 600
    })
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`OpenAI API error (${res.status}): ${errBody.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "";
  const bullets = parseBullets(text);
  return { bullets, summary: bullets.join(" ") };
}

async function summarizeWithGroq(pageData, settings) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "user", content: buildPrompt(pageData, settings.maxBullets) }
      ],
      temperature: 0.3,
      max_tokens: 600
    })
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Groq API error (${res.status}): ${errBody.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "";
  const bullets = parseBullets(text);
  return { bullets, summary: bullets.join(" ") };
}

async function summarizeWithAnthropic(pageData, settings) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": settings.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 600,
      messages: [
        { role: "user", content: buildPrompt(pageData, settings.maxBullets) }
      ]
    })
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Anthropic API error (${res.status}): ${errBody.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = (data.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  const bullets = parseBullets(text);
  return { bullets, summary: bullets.join(" ") };
}

async function summarizeWithHostedProxy(pageData, settings) {
  if (!DEVELOPER_PROXY_URL) {
    throw new Error("Hosted proxy is not configured yet.");
  }

  const res = await fetch(DEVELOPER_PROXY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Ext-Secret": EXTENSION_SHARED_SECRET
    },
    body: JSON.stringify({
      title: pageData.title,
      url: pageData.url,
      content: pageData.content,
      maxBullets: settings.maxBullets
    })
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `Proxy error (${res.status})`);
  }

  const data = await res.json();
  const bullets = parseBullets(data.text || "");
  return { bullets, summary: bullets.join(" ") };
}

function summarizeLocally(pageData, settings) {
  const { bullets, summary } = LocalSummarizer.summarize(pageData.content, {
    maxSentences: settings.maxBullets
  });
  return { bullets, summary };
}

async function handleSummarize(pageData) {
  const settings = await getSettings();

  if (!pageData || !pageData.content || pageData.content.trim().length < 40) {
    return {
      success: false,
      error: "Couldn't find enough readable text on this page to summarize."
    };
  }

  try {
    let result;
    let method = "local";

    if (settings.provider === "hosted") {
      result = await summarizeWithHostedProxy(pageData, settings);
      method = "hosted";
    } else if (settings.provider === "openai" && settings.apiKey) {
      result = await summarizeWithOpenAI(pageData, settings);
      method = "openai";
    } else if (settings.provider === "groq" && settings.apiKey) {
      result = await summarizeWithGroq(pageData, settings);
      method = "groq";
    } else if (settings.provider === "anthropic" && settings.apiKey) {
      result = await summarizeWithAnthropic(pageData, settings);
      method = "anthropic";
    } else {
      result = summarizeLocally(pageData, settings);
      method = "local";
    }

    if (!result.bullets || result.bullets.length === 0) {
      // AI call returned something unusable — fall back locally so the
      // user always gets a result instead of an empty popup.
      result = summarizeLocally(pageData, settings);
      method = "local-fallback";
    }

    return { success: true, ...result, method };
  } catch (err) {
    // Network/API failure -> gracefully fall back to local summarizer
    // rather than leaving the user with nothing.
    try {
      const fallback = summarizeLocally(pageData, settings);
      return {
        success: true,
        ...fallback,
        method: "local-fallback",
        warning: err.message
      };
    } catch (innerErr) {
      return { success: false, error: err.message || "Unknown error while summarizing." };
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "SUMMARIZE") {
    handleSummarize(message.pageData).then(sendResponse);
    return true; // keep the message channel open for the async response
  }
  return false;
});
