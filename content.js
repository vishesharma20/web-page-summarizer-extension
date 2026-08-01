/**
 * content.js
 * Injected into the active tab on demand (via chrome.scripting.executeScript).
 * Job: pull out the "real" reading content of the page and hand it back,
 * ignoring nav bars, ads, footers, scripts, etc.
 */

(function extractPageContent() {
  const BAD_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "IFRAME", "SVG", "CANVAS",
    "NAV", "FOOTER", "HEADER", "ASIDE", "FORM", "BUTTON",
    "INPUT", "SELECT", "TEXTAREA", "LABEL"
  ]);

  const BAD_CLASS_ID_HINTS = [
    "nav", "menu", "sidebar", "footer", "header", "advert", "ad-",
    "cookie", "banner", "popup", "modal", "share", "social",
    "comment", "subscribe", "newsletter", "related", "promo"
  ];

  function looksLikeChrome(el) {
    const idClass = ((el.id || "") + " " + (el.className || "")).toLowerCase();
    return BAD_CLASS_ID_HINTS.some((hint) => idClass.includes(hint));
  }

  function textDensity(el) {
    const text = el.innerText || "";
    const linkText = Array.from(el.querySelectorAll("a"))
      .map((a) => a.innerText || "")
      .join(" ");
    const total = text.length;
    if (total === 0) return 0;
    const linkRatio = linkText.length / total;
    // Penalize link-heavy blocks (nav/menus) and reward longer prose
    return total * (1 - Math.min(linkRatio, 0.9));
  }

  function pickMainCandidate() {
    // Prefer semantic containers first
    const semanticSelectors = ["article", "main", "[role='main']"];
    for (const sel of semanticSelectors) {
      const el = document.querySelector(sel);
      if (el && (el.innerText || "").trim().length > 200) return el;
    }

    // Otherwise scan block-level containers and score them
    const candidates = Array.from(
      document.querySelectorAll("div, section, article, main")
    ).filter((el) => !BAD_TAGS.has(el.tagName) && !looksLikeChrome(el));

    let best = document.body;
    let bestScore = 0;
    for (const el of candidates) {
      const score = textDensity(el);
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return best;
  }

  function cleanText(root) {
    const clone = root.cloneNode(true);
    clone.querySelectorAll(
      Array.from(BAD_TAGS).join(",")
    ).forEach((n) => n.remove());

    clone.querySelectorAll("*").forEach((n) => {
      if (looksLikeChrome(n)) n.remove();
    });

    const raw = clone.innerText || "";
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  const mainEl = pickMainCandidate();
  const content = cleanText(mainEl);
  const title = document.title || "";
  const url = window.location.href;

  return {
    title,
    url,
    content: content.slice(0, 20000), // guard against pathologically huge pages
    wordCount: content.split(/\s+/).filter(Boolean).length
  };
})();
