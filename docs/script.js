// Fill these in with your own deployed values (see backend/README.md).
// Same tradeoff as background.js: this secret is visible to anyone who views
// this page's source. It only gates casual bot traffic — the real protection
// against abuse is the Worker's per-IP/day rate limiting, not this string.
const PROXY_URL = "https://webpage-summarizer-proxy.vishesh-dev.workers.dev/summarize"; // e.g. "https://webpage-summarizer-proxy.yoursubdomain.workers.dev/summarize"
const SHARED_SECRET = "haqiutj4e3mcnv7g0zlp516w"; // must match the SHARED_SECRET you set with `wrangler secret put`

const demoInput = document.getElementById("demoInput");
const demoBtn = document.getElementById("demoBtn");
const demoStatus = document.getElementById("demoStatus");
const demoResult = document.getElementById("demoResult");
const demoError = document.getElementById("demoError");

function parseBullets(rawText) {
  return rawText
    .split("\n")
    .map((line) => line.replace(/^[-*•\d.\)\s]+/, "").trim())
    .filter((line) => line.length > 0);
}

function setLoading(isLoading) {
  demoBtn.disabled = isLoading;
  demoStatus.textContent = isLoading ? "Summarizing…" : "";
}

function showError(message) {
  demoError.textContent = message;
  demoError.classList.remove("hidden");
  demoResult.classList.add("hidden");
}

function showResult(bullets) {
  demoResult.innerHTML = "";
  bullets.forEach((b) => {
    const li = document.createElement("li");
    li.textContent = b;
    demoResult.appendChild(li);
  });
  demoResult.classList.remove("hidden");
  demoError.classList.add("hidden");
}

async function runDemo() {
  const text = demoInput.value.trim();

  if (!PROXY_URL || !SHARED_SECRET) {
    showError(
      "Live demo isn't wired up yet — set PROXY_URL and SHARED_SECRET in docs/script.js after deploying the backend."
    );
    return;
  }

  if (text.length < 40) {
    showError("Paste at least a couple of sentences so there's something to summarize.");
    return;
  }

  setLoading(true);
  demoError.classList.add("hidden");

  try {
    const res = await fetch(PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Ext-Secret": SHARED_SECRET,
      },
      body: JSON.stringify({
        title: "Pasted text",
        url: "",
        content: text,
        maxBullets: 5,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }

    const bullets = parseBullets(data.text || "");
    if (bullets.length === 0) {
      throw new Error("Got an empty response — try pasting a longer passage.");
    }

    showResult(bullets);
  } catch (err) {
    showError(err.message || "Something went wrong. Please try again.");
  } finally {
    setLoading(false);
  }
}

demoBtn.addEventListener("click", runDemo);