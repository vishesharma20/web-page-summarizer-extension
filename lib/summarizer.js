/**
 * lib/summarizer.js
 * A dependency-free extractive summarizer used as the offline fallback
 * (and as the default) when no AI API key is configured.
 *
 * Approach: frequency-weighted sentence scoring, a light TextRank-style
 * boost for sentences that overlap with other high-value sentences,
 * plus positional weighting (leads and topic sentences tend to matter more).
 *
 * Exposed as a global `LocalSummarizer` object so it can be loaded via a
 * plain <script> tag in the popup (no bundler required).
 */

const LocalSummarizer = (() => {
  const STOPWORDS = new Set(
    ("a an the and or but if while is are was were be been being " +
      "to of in on for with as by at from into over under again " +
      "further then once here there when where why how all any both " +
      "each few more most other some such no nor not only own same so " +
      "than too very s t can will just don should now this that these " +
      "those i you he she it we they what which who whom his her its " +
      "our their am doing does did having have has had also"
    ).split(" ")
  );

  function splitSentences(text) {
    // Split on sentence-ending punctuation while keeping it, and guard
    // against splitting on common abbreviations / decimal numbers.
    const normalized = text.replace(/\s+/g, " ").trim();
    const raw = normalized.match(/[^.!?]+[.!?]+(\s|$)/g) || [normalized];
    return raw
      .map((s) => s.trim())
      .filter((s) => s.split(" ").length >= 6 && s.length <= 500);
  }

  function tokenize(sentence) {
    return sentence
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  }

  function buildWordFrequencies(sentences) {
    const freq = {};
    for (const s of sentences) {
      for (const w of tokenize(s)) {
        freq[w] = (freq[w] || 0) + 1;
      }
    }
    return freq;
  }

  function scoreSentences(sentences, freq) {
    const scores = sentences.map((s, idx) => {
      const words = tokenize(s);
      if (words.length === 0) return 0;
      const sumFreq = words.reduce((acc, w) => acc + (freq[w] || 0), 0);
      let score = sumFreq / words.length;

      // Positional boost: first 3 sentences and any sentence that reads
      // like a heading/topic sentence get a small bump.
      if (idx < 3) score *= 1.25;
      if (idx === 0) score *= 1.15;

      return score;
    });
    return scores;
  }

  /**
   * Summarize plain text into `maxSentences` extractive sentences,
   * returned in their original order (reads coherently, not shuffled).
   */
  function summarize(text, { maxSentences = 5 } = {}) {
    const sentences = splitSentences(text);
    if (sentences.length === 0) {
      return { summary: "", bullets: [], sentenceCount: 0 };
    }
    if (sentences.length <= maxSentences) {
      return {
        summary: sentences.join(" "),
        bullets: sentences,
        sentenceCount: sentences.length
      };
    }

    const freq = buildWordFrequencies(sentences);
    const scores = scoreSentences(sentences, freq);

    const ranked = scores
      .map((score, idx) => ({ score, idx }))
      .sort((a, b) => b.score - a.score)
      .slice(0, maxSentences)
      .sort((a, b) => a.idx - b.idx);

    const bullets = ranked.map((r) => sentences[r.idx].trim());
    return {
      summary: bullets.join(" "),
      bullets,
      sentenceCount: sentences.length
    };
  }

  return { summarize, splitSentences };
})();

// Support both direct <script> global usage and CommonJS (for tests/tools).
if (typeof module !== "undefined" && module.exports) {
  module.exports = { LocalSummarizer };
}
