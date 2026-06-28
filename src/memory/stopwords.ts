/**
 * Centralized Multilingual Stop Word Module
 *
 * Uses stopwords-iso (58 languages) as the primary source for comprehensive
 * multilingual stop word coverage. Falls back to a bundled minimal set if
 * the package is unavailable (offline / no-dependency environments).
 *
 * stopwords-iso is the ISO-standard open-source stop word collection:
 *   https://github.com/stopwords-iso/stopwords-iso
 *   npm: stopwords-iso (MIT license)
 *
 * Supported languages (58 total via stopwords-iso):
 *   en (1298), id (758), zh (794), ja (134), ko (679), de (620),
 *   fr (691), es (732), pt (560), ar (480), hi (225), ru (559),
 *   and 46 more...
 *
 * Usage:
 *   import { STOP_WORDS, isStopWord } from "./stopwords.js"
 *
 *   if (isStopWord(word)) { ... }
 *   const filtered = tokens.filter(t => !STOP_WORDS.has(t))
 */

// ── Minimal hardcoded fallback (EN + ID only) ──────────────────────────
// Used only when stopwords-iso npm package cannot be loaded
const FALLBACK_STOP_WORDS = new Set([
  // English
  "the", "and", "for", "are", "but", "not", "you", "all", "can", "had",
  "her", "was", "one", "our", "out", "has", "have", "been", "were", "they",
  "them", "their", "what", "which", "when", "where", "will", "would",
  "could", "should", "about", "then", "than", "just", "also", "very",
  "more", "some", "such", "only", "other", "into", "over", "after",
  "before", "between", "through", "during", "because", "therefore",
  "however", "without", "within", "along", "across", "being", "doing",
  "having", "thing", "make", "made", "take", "took", "need", "want",
  "used", "using", "might", "must", "still", "well", "back", "much",
  "each", "every", "both", "few", "most", "way", "done",
  // Indonesian
  "yang", "dan", "di", "ke", "dari", "ini", "itu", "dengan", "untuk",
  "pada", "adalah", "akan", "telah", "sudah", "bisa", "dapat", "tidak",
  "atau", "saya", "kami", "kita", "mereka", "dia", "anda", "juga",
  "karena", "jika", "saat", "setelah", "sebelum", "sangat", "semua",
  "tetapi", "namun", "selesai", "sukses", "berhasil",
])

import { createLogger } from "../observability/logger.js"

const log = createLogger("Stopwords")

// ── Load stopwords-iso, fall back to minimal set ───────────────────────
function loadStopWords(): Set<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const stopwordsIso: Record<string, string[]> = require("stopwords-iso")

    if (!stopwordsIso || typeof stopwordsIso !== "object") {
      log.warn("stopwords-iso loaded but not an object, using fallback")
      return new Set(FALLBACK_STOP_WORDS)
    }

    // Merge ALL languages into one unified set for maximum coverage
    const merged = new Set<string>()
    let langCount = 0
    let totalWords = 0

    for (const [, words] of Object.entries(stopwordsIso)) {
      if (Array.isArray(words)) {
        langCount++
        for (const w of words) {
          const lower = w.toLowerCase().trim()
          if (lower.length > 0) {
            merged.add(lower)
            totalWords++
          }
        }
      }
    }

    log.debug(
      `Loaded ${totalWords} stop words from ${langCount} languages ` +
      `(${merged.size} unique after dedup)`
    )
    return merged
  } catch (err) {
    // Package not available — use fallback
    log.warn(
      "stopwords-iso not available, using bundled fallback " +
      `(${FALLBACK_STOP_WORDS.size} words): ${(err as Error)?.message ?? String(err)}`
    )
    return new Set(FALLBACK_STOP_WORDS)
  }
}

// ── Software engineering domain-specific additions ──────────────────────
// These are NOT in stopwords-iso but are noise for code analysis
const SE_DOMAIN_STOP_WORDS = new Set([
  "step", "steps", "task", "tasks", "code", "file", "files",
  "function", "class", "method", "variable", "type", "data",
  "value", "name", "line", "lines", "test", "tests", "bug",
  "fix", "feature", "change", "changes", "need", "needs",
  "needed", "work", "works", "working",
])

// ── Build the final set ────────────────────────────────────────────────
const BASE_STOP_WORDS = loadStopWords()

/**
 * Aggregated stop word set:
 *   - All 58 languages from stopwords-iso (or fallback)
 *   - Plus software engineering domain-specific words
 */
export const STOP_WORDS: ReadonlySet<string> = (() => {
  const merged = new Set(BASE_STOP_WORDS)
  for (const w of SE_DOMAIN_STOP_WORDS) merged.add(w)
  return merged
})()

// ── Utility functions ──────────────────────────────────────────────────

/**
 * Check if a word is a stop word (language-agnostic).
 * Compares against the centralized multilingual set.
 */
export function isStopWord(word: string): boolean {
  return STOP_WORDS.has(word.toLowerCase().trim())
}

/**
 * Filter an array of words/tokens, removing stop words.
 * Optionally also filters by minimum length (default: 2).
 */
export function filterStopWords(
  words: string[],
  minLength = 2,
): string[] {
  return words.filter(w => {
    const lower = w.toLowerCase().trim()
    return lower.length > minLength && !STOP_WORDS.has(lower)
  })
}

/**
 * Language statistics (for debugging / dashboard)
 */
export function getStopWordStats(): {
  totalUnique: number
  languages: number
  source: "stopwords-iso" | "fallback"
} {
  return {
    totalUnique: STOP_WORDS.size,
    languages: BASE_STOP_WORDS === FALLBACK_STOP_WORDS ? 2 : 58,
    source: BASE_STOP_WORDS === FALLBACK_STOP_WORDS ? "fallback" : "stopwords-iso",
  }
}

// ─── Shared NLP Utilities (consolidated from vector-store.ts + semantic-cache.ts) ───

/**
 * Unicode-aware tokenizer with bigram support.
 * If `stopWords` is provided, uses that set; otherwise uses the global STOP_WORDS.
 */
export function tokenize(text: string, stopWords?: Set<string>): string[] {
  const sw = stopWords ?? STOP_WORDS
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(t => t.length > 1 && !sw.has(t))

  // Add bigrams for n-gram support
  const bigrams: string[] = []
  for (let i = 0; i < words.length - 1; i++) {
    bigrams.push(words[i] + "_" + words[i + 1])
  }

  return [...words, ...bigrams]
}

/** Compute term frequency vector from token array */
export function computeTf(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>()
  for (const t of tokens) {
    tf.set(t, (tf.get(t) ?? 0) + 1)
  }
  return tf
}

/** Cosine similarity between two TF vectors */
export function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0
  let normA = 0
  let normB = 0

  for (const [term, valueA] of a) {
    const valueB = b.get(term) ?? 0
    dot += valueA * valueB
    normA += valueA * valueA
  }

  for (const [, valueB] of b) {
    normB += valueB * valueB
  }

  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}
