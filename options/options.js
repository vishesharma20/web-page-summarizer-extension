const providerEl = document.getElementById("provider");
const apiKeyField = document.getElementById("apiKeyField");
const apiKeyEl = document.getElementById("apiKey");
const keyHintEl = document.getElementById("keyHint");
const maxBulletsEl = document.getElementById("maxBullets");
const maxBulletsValueEl = document.getElementById("maxBulletsValue");
const saveBtn = document.getElementById("saveBtn");
const savedNote = document.getElementById("savedNote");

const KEY_HINTS = {
  hosted: "",
  local: "",
  openai:
    'Get a key at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">platform.openai.com/api-keys</a>. Usage is billed by OpenAI, not by this extension.',
  groq:
    'Get a free key at <a href="https://console.groq.com/keys" target="_blank" rel="noopener">console.groq.com/keys</a>. Groq has a generous free tier.',
  anthropic:
    'Get a key at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>. Usage is billed by Anthropic, not by this extension.',
};

function updateVisibility() {
  const provider = providerEl.value;
  apiKeyField.style.display =
    provider === "hosted" || provider === "local" ? "none" : "block";
  keyHintEl.innerHTML = KEY_HINTS[provider] || "";
}

async function load() {
  const settings = await chrome.storage.sync.get({
    provider: "hosted",
    apiKey: "",
    maxBullets: 5,
  });
  providerEl.value = settings.provider;
  apiKeyEl.value = settings.apiKey;
  maxBulletsEl.value = settings.maxBullets;
  maxBulletsValueEl.textContent = settings.maxBullets;
  updateVisibility();
}

async function save() {
  await chrome.storage.sync.set({
    provider: providerEl.value,
    apiKey: apiKeyEl.value.trim(),
    maxBullets: Number(maxBulletsEl.value),
  });
  savedNote.classList.remove("hidden");
  setTimeout(() => savedNote.classList.add("hidden"), 2000);
}

providerEl.addEventListener("change", updateVisibility);
maxBulletsEl.addEventListener("input", () => {
  maxBulletsValueEl.textContent = maxBulletsEl.value;
});
saveBtn.addEventListener("click", save);

load();
