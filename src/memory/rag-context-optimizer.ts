/**
 * Token-Budget-Aware Context Selection — MMKP-inspired Optimizer
 *
 * Mengadopsi konsep MMKP (Multi-dimensional Multiple Choice Knapsack)
 * dari Self-Correcting RAG, diimplementasi sebagai greedy 1D selection.
 *
 * Catatan: Self-Correcting RAG asli memiliki dua fase — MMKP formal + NLI-Guided MCTS.
 * Fase 2 (NLI-MCTS) tidak diimplementasi di sini.
 *
 * Referensi:
 * - Self-Correcting RAG (ACL Findings, 2026): MMKP + NLI-Guided MCTS
 * - SCIM (MDPI, 2026): token budget + quality awareness
 *
 * Masalah:
 *   Konteks LLM terbatas (misal 8K, 16K, 128K tokens).
 *   Dari banyak RAG entries, kita harus pilih subset yang:
 *   - Memaksimalkan "information density" (quality × relevance)
 *   - Tidak melebihi token budget
 *   - Minim redundansi (jangan 3 entry bilang hal sama)
 *
 * Solusi (MMKP-inspired):
 *   1D Knapsack: setiap entry punya weight (token count) dan value (quality × relevance)
 *   Tapi dengan MULTIPLE DIMENSIONS:
 *   - Dimension 1: relevance score
 *   - Dimension 2: quality score
 *   - Dimension 3: coverage (unique information)
 *
 * Karena NP-hard, kita pake greedy heuristic dengan diversity bonus.
 */
import { createLogger } from "../observability/logger.js"
import type { IndexEntry } from "./multi-index-rag.js"
import { createDefaultQuality, computeQualityScore } from "./multi-index-rag.js"

const _log = createLogger("RAGContextOpt")

// ── Types ──────────────────────────────────────────────────────

export interface OptimizedContext {
  /** Selected entries (subset of input) */
  entries: IndexEntry[]
  /** Total tokens used */
  totalTokens: number
  /** Token budget */
  budget: number
  /** Utilization percentage */
  utilization: number
  /** Average quality of selected entries */
  avgQuality: number
  /** Total information score (sum of values) */
  totalValue: number
  /** Redundancy score (0 = no redundancy, 1 = all redundant) */
  redundancyScore: number
  /** Entries that were excluded and why */
  excluded: Array<{ title: string; reason: string; tokens: number }>
  /** P0: explicit redundancy budget (second MMKP dimension) */
  redundancyBudget: number
  /** P0: redundancy cost actually spent (similarity-weighted tokens) */
  redundancyUsed: number
}

export interface ContextEntryScore {
  entry: IndexEntry
  /** Token count estimation */
  tokens: number
  /** Value score (0-1): weighted combination of quality, relevance, diversity */
  value: number
  /** Relevance to current query */
  relevance: number
  /** Diversity bonus (0-1): higher = more unique */
  diversity: number
}

// ── Constants ──────────────────────────────────────────────────

const DEFAULT_TOKEN_BUDGET = 4000
const MIN_TOKENS_PER_ENTRY = 50
const MAX_TOKENS_PER_ENTRY = 2000
const DIVERSITY_SIMILARITY_THRESHOLD = 0.6 // cosine similarity threshold for "redundant"
// P0 fix: explicit redundancy budget (second knapsack dimension, cf. Self-Correcting RAG C_red).
// Cumulative similarity-weighted cost that may be spent on overlapping entries.
const DEFAULT_REDUNDANCY_BUDGET = 120
// P0 fix: NLI-light contradiction penalty (negation-aware, no external model).
const CONTRADICTION_PENALTY = 0.3
const CONTRADICTION_VALUE_FLOOR = 0.4
const NEGATION_RE = /\b(tidak|bukan|tanpa|jangan|belum|gagal|salah|never|not|no|n't|cannot|can't|won't|don't|doesn't)\b/gi

// ── Context Optimizer ──────────────────────────────────────────

export class RAGContextOptimizer {
  /**
   * Optimize context selection under token budget.
   * MMKP-inspired greedy selection with diversity bonus.
   *
   * @param entries - All candidate entries
   * @param budget - Token budget (default: 4000)
   * @param query - Original query for relevance scoring
   * @returns OptimizedContext with selected entries
   */
  optimize(
    entries: IndexEntry[],
    budget: number = DEFAULT_TOKEN_BUDGET,
    query?: string,
    redundancyBudget: number = DEFAULT_REDUNDANCY_BUDGET,
  ): OptimizedContext {
    if (entries.length === 0) {
      return {
        entries: [],
        totalTokens: 0,
        budget,
        utilization: 0,
        avgQuality: 0,
        totalValue: 0,
        redundancyScore: 0,
        excluded: [],
        redundancyBudget,
        redundancyUsed: 0,
      }
    }

    // Phase 1: Score all entries
    const scored = this._scoreEntries(entries, query)

    // Phase 2: Greedy selection with diversity bonus + redundancy budget + NLI-light check
    return this._selectWithKnapsack(scored, budget, redundancyBudget)
  }

  /**
   * Format optimized context untuk prompt injection.
   * Include budget info dan quality summary.
   */
  formatForPrompt(optimized: OptimizedContext): string {
    const lines: string[] = [
      `<optimized-context>`,
      `<budget>${optimized.budget} tokens</budget>`,
      `<used>${optimized.totalTokens} tokens (${(optimized.utilization * 100).toFixed(0)}%)</used>`,
      `<entries-selected>${optimized.entries.length}</entries-selected>`,
      `<avg-quality>${(optimized.avgQuality * 100).toFixed(0)}%</avg-quality>`,
      `<redundancy>${(optimized.redundancyScore * 100).toFixed(0)}%</redundancy>`,
    ]

    if (optimized.excluded.length > 0) {
      lines.push(`<excluded count="${optimized.excluded.length}">`)
      for (const ex of optimized.excluded) {
        lines.push(`  <entry reason="${ex.reason}" tokens="${ex.tokens}">${ex.title}</entry>`)
      }
      lines.push(`</excluded>`)
    }

    lines.push(`</optimized-context>`)
    return lines.join("\n")
  }

  /**
   * Estimate token count for a text.
   * ~4 characters per token untuk English/Indonesian.
   */
  estimateTokens(text: string): number {
    if (!text) return 0
    // Rough estimate: 4 chars per token
    return Math.ceil(text.length / 4)
  }

  /**
   * Estimate tokens for an IndexEntry.
   */
  estimateEntryTokens(entry: IndexEntry): number {
    let text = entry.title
    if (entry.episode?.summary) text += " " + entry.episode.summary
    if (entry.episode?.decisions) text += " " + entry.episode.decisions.join(" ")
    if (entry.keywords) text += " " + entry.keywords.join(" ")
    return Math.min(MAX_TOKENS_PER_ENTRY, Math.max(MIN_TOKENS_PER_ENTRY, this.estimateTokens(text)))
  }

  // ── Private: Scoring ──

  /**
   * Score each entry: value = quality * 0.4 + relevance * 0.4 + diversity * 0.2.
   *
   * Self-Correcting RAG MMKP-inspired:
   * - quality: dari qualityScore atau default
   * - relevance: keyword overlap dengan query
   * - diversity: uniqueness dibanding entry lain (TF-IDF keyword overlap)
   */
  private _scoreEntries(entries: IndexEntry[], query?: string): ContextEntryScore[] {
    // First pass: estimate tokens and base scores
    const scored: ContextEntryScore[] = entries.map(entry => {
      const tokens = this.estimateEntryTokens(entry)
      const _quality = entry.qualityScore ?? computeQualityScore(entry.quality ?? createDefaultQuality())
      const relevance = query ? this._computeRelevance(entry, query) : 0.5
      return { entry, tokens, value: 0, relevance, diversity: 0 }
    })

    // Second pass: compute diversity (keyword overlap between entries)
    for (let i = 0; i < scored.length; i++) {
      const kw1 = new Set(scored[i].entry.keywords.map(k => k.toLowerCase()))
      let maxOverlap = 0
      for (let j = 0; j < scored.length; j++) {
        if (i === j) continue
        const kw2 = new Set(scored[j].entry.keywords.map(k => k.toLowerCase()))
        const intersection = [...kw1].filter(k => kw2.has(k)).length
        const union = new Set([...kw1, ...kw2]).size
        const overlap = union > 0 ? intersection / union : 0
        maxOverlap = Math.max(maxOverlap, overlap)
      }
      // Diversity = 1 - maxOverlap (0 = sama persis, 1 =完全不同)
      scored[i].diversity = 1 - maxOverlap
    }

    // Third pass: compute final value
    for (const s of scored) {
      s.value = s.entry.qualityScore
        ? s.entry.qualityScore * 0.4 + s.relevance * 0.4 + s.diversity * 0.2
        : s.relevance * 0.6 + s.diversity * 0.4
    }

    return scored
  }

  /**
   * Compute relevance score antara entry dan query.
   * Keyword overlap-based (TF-IDF simplified).
   */
  private _computeRelevance(entry: IndexEntry, query: string): number {
    const queryLower = query.toLowerCase()
    const queryTokens = new Set(queryLower.split(/\s+/).filter(t => t.length > 2 && !this._isStopWord(t)))

    if (queryTokens.size === 0) return 0.5

    const entryTokens = new Set([
      entry.title.toLowerCase(),
      ...entry.keywords.map(k => k.toLowerCase()),
      ...(entry.episode?.decisions ?? []).map(d => d.toLowerCase()),
    ].flatMap(s => s.split(/\s+/)).filter(t => t.length > 2))

    const intersection = [...queryTokens].filter(t => entryTokens.has(t)).length
    const union = new Set([...queryTokens, ...entryTokens]).size

    return union > 0 ? intersection / union : 0
  }

  /**
   * Greedy knapsack selection with diversity bonus.
   *
   * Self-Correcting RAG MMKP-inspired:
   * - Sort by value/token ratio (density)
   * - Iteratively select highest density entry that fits budget
   * - Apply diversity penalty: if entry too similar to already selected, reduce its value
   * - Stop when no more entries fit or budget exhausted
   */
  private _selectWithKnapsack(
    scored: ContextEntryScore[],
    budget: number,
    redundancyBudget: number = DEFAULT_REDUNDANCY_BUDGET,
  ): OptimizedContext {
    const selected: ContextEntryScore[] = []
    const excluded: OptimizedContext["excluded"] = []
    let remainingBudget = budget
    let redundancyUsed = 0

    // Sort by value density (value per token)
    const sorted = [...scored]
      .filter(s => s.tokens <= budget) // must be able to fit at least alone
      .sort((a, b) => {
        const densityA = a.value / Math.max(a.tokens, 1)
        const densityB = b.value / Math.max(b.tokens, 1)
        return densityB - densityA
      })

    for (const s of sorted) {
      if (s.tokens > remainingBudget) {
        excluded.push({
          title: s.entry.title,
          reason: `Exceeds remaining budget (${s.tokens} > ${remainingBudget})`,
          tokens: s.tokens,
        })
        continue
      }

      // P0: NLI-light contradiction check against already selected entries.
      // If entry negates shared-topic content, penalize its effective value.
      const contradictionPenalty = this._detectContradiction(
        s.entry,
        selected.map(sel => sel.entry),
      )
      const effectiveValue = s.value - contradictionPenalty
      if (contradictionPenalty >= CONTRADICTION_PENALTY && effectiveValue < CONTRADICTION_VALUE_FLOOR) {
        excluded.push({
          title: s.entry.title,
          reason: `Contradiction with already selected entries (penalty ${contradictionPenalty.toFixed(2)})`,
          tokens: s.tokens,
        })
        continue
      }

      // Diversity: max Jaccard similarity to already selected entries.
      let maxSimilarity = 0
      for (const sel of selected) {
        const kw1 = new Set(s.entry.keywords.map(k => k.toLowerCase()))
        const kw2 = new Set(sel.entry.keywords.map(k => k.toLowerCase()))
        const intersection = [...kw1].filter(k => kw2.has(k)).length
        const union = new Set([...kw1, ...kw2]).size
        const similarity = union > 0 ? intersection / union : 0
        if (similarity > maxSimilarity) maxSimilarity = similarity
      }
      const isRedundant = maxSimilarity > DIVERSITY_SIMILARITY_THRESHOLD

      // P0: second knapsack dimension — similarity-weighted redundancy cost.
      // cost = maxSimilarity * tokens; must fit within redundancyBudget.
      const redundancyCost = Math.round(maxSimilarity * s.tokens * 100) / 100
      if (isRedundant) {
        if (redundancyUsed + redundancyCost > redundancyBudget) {
          excluded.push({
            title: s.entry.title,
            reason: `Redundancy budget exceeded (cost ${redundancyCost}, used ${redundancyUsed}/${redundancyBudget})`,
            tokens: s.tokens,
          })
          continue
        }
        // Legacy guard retained: very low value + redundant → skip without spending budget.
        if (effectiveValue < 0.5 && redundancyCost > 0) {
          excluded.push({
            title: s.entry.title,
            reason: `Redundant with already selected entries (diversity too low)`,
            tokens: s.tokens,
          })
          continue
        }
        redundancyUsed = Math.round((redundancyUsed + redundancyCost) * 100) / 100
      }

      // Select (store effective value so contradiction penalty is reflected downstream)
      selected.push({ ...s, value: Math.round(effectiveValue * 100) / 100 })
      remainingBudget -= s.tokens
    }

    // Compute metrics
    const totalTokens = budget - remainingBudget
    const avgQuality = selected.length > 0
      ? selected.reduce((sum, s) => sum + (s.entry.qualityScore ?? 0.7), 0) / selected.length
      : 0

    // Redundancy score: average pairwise similarity
    let redundancySum = 0
    let redundancyPairs = 0
    for (let i = 0; i < selected.length; i++) {
      for (let j = i + 1; j < selected.length; j++) {
        const kw1 = new Set(selected[i].entry.keywords.map(k => k.toLowerCase()))
        const kw2 = new Set(selected[j].entry.keywords.map(k => k.toLowerCase()))
        const intersection = [...kw1].filter(k => kw2.has(k)).length
        const union = new Set([...kw1, ...kw2]).size
        redundancySum += union > 0 ? intersection / union : 0
        redundancyPairs++
      }
    }
    const redundancyScore = redundancyPairs > 0 ? redundancySum / redundancyPairs : 0

    return {
      entries: selected.map(s => s.entry),
      totalTokens,
      budget,
      utilization: budget > 0 ? totalTokens / budget : 0,
      avgQuality: Math.round(avgQuality * 100) / 100,
      totalValue: Math.round(selected.reduce((sum, s) => sum + s.value, 0) * 100) / 100,
      redundancyScore: Math.round(redundancyScore * 100) / 100,
      excluded,
      redundancyBudget,
      redundancyUsed,
    }
  }

  /**
   * P0: NLI-light contradiction detector (no external model).
   * Returns CONTRADICTION_PENALTY if candidate shares a topic (≥2 keywords)
   * with any selected entry but differs in negation polarity; else 0.
   */
  private _detectContradiction(candidate: IndexEntry, selected: IndexEntry[]): number {
    if (selected.length === 0) return 0
    const candText = this._entryText(candidate)
    const candNeg = this._countNegations(candText)
    const candKw = new Set(candidate.keywords.map(k => k.toLowerCase()))
    for (const sel of selected) {
      const selKw = new Set(sel.keywords.map(k => k.toLowerCase()))
      const shared = [...candKw].filter(k => selKw.has(k)).length
      if (shared < 2) continue
      const selNeg = this._countNegations(this._entryText(sel))
      if (Math.abs(candNeg - selNeg) >= 1) return CONTRADICTION_PENALTY
    }
    return 0
  }

  private _entryText(entry: IndexEntry): string {
    const parts: string[] = [entry.title]
    if (entry.episode?.summary) parts.push(entry.episode.summary)
    if (entry.episode?.decisions) parts.push(entry.episode.decisions.join(" "))
    if (entry.keywords) parts.push(entry.keywords.join(" "))
    return parts.join(" ").toLowerCase()
  }

  private _countNegations(text: string): number {
    const m = text.toLowerCase().match(NEGATION_RE)
    return m ? m.length : 0
  }

  private _isStopWord(token: string): boolean {
    const stopWords = new Set([
      "the", "is", "at", "which", "on", "a", "an", "and", "or", "for",
      "of", "to", "in", "with", "by", "from", "as", "into", "through",
      "during", "before", "after", "above", "below", "between", "out",
      "off", "over", "under", "again", "further", "then", "once",
      "here", "there", "when", "where", "why", "how", "all", "each",
      "every", "both", "few", "more", "most", "other", "some", "such",
      "no", "nor", "not", "only", "own", "same", "so", "than", "too",
      "very", "just", "because", "but", "yang", "dan", "di", "ke",
      "dari", "ini", "itu", "dengan", "untuk", "pada", "adalah",
      "telah", "sudah", "akan", "tidak", "ada", "juga", "atau",
    ])
    return stopWords.has(token)
  }
}
