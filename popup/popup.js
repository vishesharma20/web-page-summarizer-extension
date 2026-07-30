const els = {
  idle: document.getElementById("idleState"),
  loading: document.getElementById("loadingState"),
  result: document.getElementById("resultState"),
  error: document.getElementById("errorState"),
  summarizeBtn: document.getElementById("summarizeBtn"),
  retryBtn: document.getElementById("retryBtn"),
  redoBtn: document.getElementById("redoBtn"),
  copyBtn: document.getElementById("copyBtn"),
  copyLabel: document.getElementById("copyLabel"),
  settingsBtn: document.getElementById("settingsBtn"),
  loadingText: document.getElementById("loadingText"),
  summaryList: document.getElementById("summaryList"),
  pageTitle: document.getElementById("pageTitle"),
  methodBadge: document.getElementById("methodBadge"),
  errorText: document.getElementById("errorText"),
  wordCount: document.getElementById("wordCount"),
  providerHint: document.getElementById("providerHint"),
};

const METHOD_LABELS = {
  hosted: "AI (built-in)",
  openai: "AI · OpenAI",
  groq: "AI · Groq",
  anthropic: "AI · Claude",
  local: "Local summary",
  "local-fallback": "Local (fallback)",
};

let lastBullets = [];

function showState(name) {
  ["idle", "loading", "result", "error"].forEach((key) => {
    els[key].classList.toggle("hidden", key !== name);
  });
}

const LOADING_MESSAGES = [
  "Reading the page…",
  "Finding the important bits…",
  "Cutting the fluff…",
  "Almost there…",
];

function cycleLoadingText() {
  let i = 0;
  els.loadingText.textContent = LOADING_MESSAGES[0];
  return setInterval(() => {
    i = (i + 1) % LOADING_MESSAGES.length;
    els.loadingText.textContent = LOADING_MESSAGES[i];
  }, 1400);
}

async function loadProviderHint() {
  const { provider = "hosted", apiKey = "" } = await chrome.storage.sync.get([
    "provider",
    "apiKey",
  ]);
  if (provider === "hosted") {
    els.providerHint.textContent = "Using built-in AI (no key needed)";
  } else if (provider !== "local" && apiKey) {
    const labels = { openai: "OpenAI", groq: "Groq", anthropic: "Claude" };
    els.providerHint.textContent = `Using ${labels[provider] || provider} for summaries`;
  } else {
    els.providerHint.textContent = "Using built-in local summarizer";
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function extractPageData(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
  });
  return result;
}

function renderResult({ bullets, pageTitle, method, wordCount }) {
  lastBullets = bullets;
  els.summaryList.innerHTML = "";
  bullets.forEach((b) => {
    const li = document.createElement("li");
    li.textContent = b;
    els.summaryList.appendChild(li);
  });
  els.pageTitle.textContent = pageTitle || "";
  els.pageTitle.title = pageTitle || "";
  els.methodBadge.textContent = METHOD_LABELS[method] || "Summary";
  els.wordCount.textContent = wordCount ? `Source: ~${wordCount} words` : "";
  els.copyLabel.textContent = "Copy summary";
  els.copyBtn.classList.remove("copied");
  showState("result");
}

async function runSummarize() {
  showState("loading");
  const spinnerInterval = cycleLoadingText();

  try {
    const tab = await getActiveTab();
    if (!tab || !tab.id) {
      throw new Error("Couldn't find the active tab.");
    }
    if (/^(chrome|edge|about|chrome-extension):/.test(tab.url || "")) {
      throw new Error(
        "This page can't be read by the extension (browser-internal pages are restricted). Try it on a regular website."
      );
    }

    const pageData = await extractPageData(tab.id);
    if (!pageData) {
      throw new Error("Couldn't extract content from this page.");
    }

    const response = await chrome.runtime.sendMessage({
      type: "SUMMARIZE",
      pageData,
    });

    clearInterval(spinnerInterval);

    if (!response || !response.success) {
      throw new Error(response?.error || "Something went wrong while summarizing.");
    }

    renderResult({
      bullets: response.bullets,
      pageTitle: pageData.title,
      method: response.method,
      wordCount: pageData.wordCount,
    });
  } catch (err) {
    clearInterval(spinnerInterval);
    els.errorText.textContent = err.message || "Something went wrong. Please try again.";
    showState("error");
  }
}

els.summarizeBtn.addEventListener("click", runSummarize);
els.retryBtn.addEventListener("click", runSummarize);
els.redoBtn.addEventListener("click", runSummarize);

els.copyBtn.addEventListener("click", async () => {
  const text = lastBullets.map((b) => `• ${b}`).join("\n");
  try {
    await navigator.clipboard.writeText(text);
    els.copyLabel.textContent = "Copied!";
    els.copyBtn.classList.add("copied");
    setTimeout(() => {
      els.copyLabel.textContent = "Copy summary";
      els.copyBtn.classList.remove("copied");
    }, 1500);
  } catch (err) {
    els.copyLabel.textContent = "Copy failed";
  }
});

els.settingsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

loadProviderHint();
