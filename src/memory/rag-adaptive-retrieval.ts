/**
 * Adaptive Retrieval — Smart RAG Retrieval dengan Quality Awareness
 *
 * Berdasarkan paper:
 * - SCIM (MDPI, 2026): augment mode (completeness deficit) + refine mode (consistency deficit)
 * - Reflective RAG (ACL Findings, 2026): reflection tagging → adaptive strategy
 * - SeaKR (ACL, 2025): self-aware uncertainty → adaptive retrieval
 *
 * Mekanisme:
 * 1. Search normal → dapat results dengan quality scores
 * 2. Evaluasi hasil: apakah cukup? atau perlu mode khusus?
 * 3. Augment mode: kalau completeness rendah → cari aspek yang kurang
 * 4. Refine mode: kalau consistency rendah → cari sumber alternatif untuk verifikasi
 * 5. Decompose mode: kalau semua irrelevant → pecah query
 *
 * Quality-weighted scoring:
 *   finalScore = hybridScore * 0.6 + qualityScore * 0.3 + (1 - staleness) * 0.1
 */
import { createLogger } from "../observability/logger.js"
import type { MultiIndexRAG, IndexEntry, QualityDimensions } from "./multi-index-rag.js"
import { createDefaultQuality, computeQualityScore } from "./multi-index-rag.js"
import { RAGQualityScorer, QUALITY_THRESHOLDS } from "./rag-quality-scorer.js"

const log = createLogger("RAGAdaptive")

// ── Types ──────────────────────────────────────────────────────

export type RetrievalMode = "standard" | "augment" | "refine" | "decompose"

export interface AdaptiveSearchResult {
  entries: IndexEntry[]
  mode: RetrievalMode
  /** Average quality-weighted score */
  avgScore: number
  /** Deficits yang terdeteksi (untuk decision making) */
  deficits: {
    completeness: boolean  // completeness < 0.6
    consistency: boolean   // consistency < 0.6
    factuality: boolean    // factuality < 0.6
    relevance: boolean     // relevance < 0.6
  }
  /** Apakah hasil memadai atau perlu mode lain */
  sufficient: boolean
  /** Recommended next action */
  recommendation: "proceed" | "augment" | "refine" | "decompose" | "manual-research"
}

// ── Adaptive Retrieval Engine ──────────────────────────────────

export class RAGAdaptiveRetrieval {
  private qualityScorer: RAGQualityScorer

  constructor() {
    this.qualityScorer = new RAGQualityScorer()
  }

  /**
   * Adaptive search dengan quality awareness.
   * SCIM-inspired: evaluasi hasil, deteksi deficits, pilih mode.
   *
   * @param rag - MultiIndexRAG instance
   * @param query - Query pencarian
   * @param mode - Retrieval mode (default: standard → auto-escalate)
   * @param limit - Max results
   */
  async search(
    rag: MultiIndexRAG,
    query: string,
    mode: RetrievalMode = "standard",
    limit: number = 5,
  ): Promise<AdaptiveSearchResult> {
    // Phase 1: Standard search with confidence
    const searchResult = await rag.searchWithConfidence(query, undefined, limit * 2)
    let entries = searchResult.entries

    // Apply quality-weighted scoring to each entry
    entries = this._applyQualityWeight(entries)

    // Sort by quality-weighted score
    entries.sort((a, b) => (b.hybridScore ?? 0) - (a.hybridScore ?? 0))
    entries = entries.slice(0, limit)

    // Phase 2: Detect deficits
    const deficits = this._detectDeficits(entries, query)

    // Phase 3: Calculate average quality score
    const avgScore = entries.length > 0
      ? entries.reduce((sum, e) => sum + (e.qualityScore ?? 0.7), 0) / entries.length
      : 0

    // Phase 4: Determine if sufficient
    const sufficient = this._isSufficient(entries, deficits, mode)

    // Phase 5: Generate recommendation
    const recommendation = this._getRecommendation(entries, deficits, mode, query)

    return {
      entries,
      mode,
      avgScore: Math.round(avgScore * 100) / 100,
      deficits,
      sufficient,
      recommendation,
    }
  }

  /**
   * Auto-escalate search: mulai dari standard, escalate ke augment/refine kalau perlu.
   * SeaKR-inspired: self-aware uncertainty-driven adaptive retrieval.
   */
  async searchWithAutoEscalate(
    rag: MultiIndexRAG,
    query: string,
    maxIterations: number = 3,
    limit: number = 5,
  ): Promise<AdaptiveSearchResult> {
    let currentMode: RetrievalMode = "standard"
    let lastResult: AdaptiveSearchResult | null = null

    for (let i = 0; i < maxIterations; i++) {
      lastResult = await this.search(rag, query, currentMode, limit)

      if (lastResult.sufficient) {
        log.info(`[AdaptiveRAG] Query "${query.slice(0, 40)}..." sufficient at mode=${currentMode} (iter ${i + 1})`)
        return lastResult
      }

      // Escalate mode
      currentMode = this._escalateMode(currentMode, lastResult.deficits)
      if (currentMode === "decompose") {
        log.info(`[AdaptiveRAG] Query "${query.slice(0, 40)}..." escalating to decompose (iter ${i + 1})`)
      } else {
        log.info(`[AdaptiveRAG] Query "${query.slice(0, 40)}..." escalating to ${currentMode} (iter ${i + 1})`)
      }
    }

    // If still not sufficient after all iterations, return whatever we have
    log.warn(`[AdaptiveRAG] Query "${query.slice(0, 40)}..." not sufficient after ${maxIterations} iterations`)
    return lastResult ?? {
      entries: [],
      mode: "standard",
      avgScore: 0,
      deficits: { completeness: true, consistency: true, factuality: true, relevance: true },
      sufficient: false,
      recommendation: "manual-research",
    }
  }

  /**
   * Format adaptive search result sebagai prompt section.
   * Include quality scores dan deficit warnings.
   */
  formatForPrompt(result: AdaptiveSearchResult): string {
    if (result.entries.length === 0) {
      return `<adaptive-rag><status>NO_KNOWLEDGE_FOUND</status><recommendation>${result.recommendation}</recommendation></adaptive-rag>`
    }

    const lines: string[] = [
      `<adaptive-rag>`,
      `<status>${result.sufficient ? "SUFFICIENT" : "INSUFFICIENT"}</status>`,
      `<mode>${result.mode}</mode>`,
      `<avg-quality>${(result.avgScore * 100).toFixed(0)}%</avg-quality>`,
    ]

    if (result.deficits.completeness || result.deficits.consistency || result.deficits.factuality) {
      lines.push(`<deficits>`)
      if (result.deficits.completeness) lines.push(`  <deficit dimension="completeness">Knowledge may be incomplete</deficit>`)
      if (result.deficits.consistency) lines.push(`  <deficit dimension="consistency">Knowledge may have inconsistencies</deficit>`)
      if (result.deficits.factuality) lines.push(`  <deficit dimension="factuality">Knowledge may contain inaccuracies</deficit>`)
      lines.push(`</deficits>`)
    }

    lines.push(`<recommendation>${result.recommendation}</recommendation>`)

    for (const entry of result.entries) {
      const q = entry.quality ?? createDefaultQuality()
      const qs = entry.qualityScore ?? computeQualityScore(q)
      lines.push(`<entry confidence="${entry.confidence?.toFixed(2) ?? "0.70"}" quality="${(qs * 100).toFixed(0)}%">`)
      lines.push(`  <title>${entry.title}</title>`)
      const content = entry.episode?.summary ?? entry.title
      lines.push(`  <content>${content.slice(0, 200)}</content>`)
      lines.push(`</entry>`)
    }

    lines.push(`</adaptive-rag>`)
    return lines.join("\n")
  }

  /**
   * Generate extracted keywords for augment/refine mode based on deficits.
   */
  generateRefineQueries(query: string, deficits: AdaptiveSearchResult["deficits"]): string[] {
    const queries: string[] = []

    if (deficits.completeness) {
      queries.push(`${query} implementation guide`)
      queries.push(`${query} complete tutorial`)
    }
    if (deficits.consistency) {
      queries.push(`${query} best practices`)
      queries.push(`${query} alternatives comparison`)
    }
    if (deficits.factuality) {
      queries.push(`${query} documentation official`)
      queries.push(`${query} reference guide`)
    }
    if (deficits.relevance) {
      queries.push(`${query} overview`)
    }

    return queries
  }

  // ── Private ──

  /**
   * Apply quality-weighted scoring: finalScore = hybridScore * 0.6 + qualityScore * 0.3 + (1 - staleness) * 0.1
   */
  private _applyQualityWeight(entries: IndexEntry[]): IndexEntry[] {
    return entries.map(entry => {
      const quality = entry.quality ?? createDefaultQuality()
      const qualityScore = entry.qualityScore ?? computeQualityScore(quality)
      const staleness = entry.stalenessScore ?? 0
      const hybrid = entry.hybridScore ?? entry.confidence ?? 0.5

      // SCIM-inspired weighted scoring
      const weighted = hybrid * 0.6 + qualityScore * 0.3 + (1 - staleness) * 0.1
      entry.hybridScore = Math.min(weighted, 1.0)
      return entry
    })
  }

  /**
   * Detect quality deficits dari hasil search.
   */
  private _detectDeficits(entries: IndexEntry[], _query: string): AdaptiveSearchResult["deficits"] {
    if (entries.length === 0) {
      return { completeness: true, consistency: true, factuality: true, relevance: true }
    }

    let avgCompleteness = 0, avgConsistency = 0, avgFactuality = 0, avgRelevance = 0

    for (const entry of entries) {
      const q = entry.quality ?? createDefaultQuality()
      avgCompleteness += q.completeness
      avgConsistency += q.consistency
      avgFactuality += q.factuality
      avgRelevance += q.relevance
    }

    const n = entries.length
    avgCompleteness /= n
    avgConsistency /= n
    avgFactuality /= n
    avgRelevance /= n

    return {
      completeness: avgCompleteness < 0.6,
      consistency: avgConsistency < 0.6,
      factuality: avgFactuality < 0.6,
      relevance: avgRelevance < 0.6,
    }
  }

  /**
   * Apakah hasil search sudah memadai?
   */
  private _isSufficient(
    entries: IndexEntry[],
    deficits: AdaptiveSearchResult["deficits"],
    mode: RetrievalMode,
  ): boolean {
    // Must have at least 1 entry
    if (entries.length === 0) return false

    // In standard mode: no critical deficits
    if (mode === "standard") {
      return !deficits.completeness && !deficits.factuality
    }

    // In augment/refine mode: check if the specific deficit is resolved
    if (mode === "augment") {
      return !deficits.completeness
    }
    if (mode === "refine") {
      return !deficits.consistency && !deficits.factuality
    }

    // Decompose mode: just return what we have
    return entries.length > 0
  }

  /**
   * Escalate retrieval mode based on deficits.
   * SCIM-inspired: standard → augment (completeness) → refine (consistency) → decompose
   */
  private _escalateMode(
    currentMode: RetrievalMode,
    deficits: AdaptiveSearchResult["deficits"],
  ): RetrievalMode {
    switch (currentMode) {
      case "standard":
        if (deficits.completeness) return "augment"
        if (deficits.consistency || deficits.factuality) return "refine"
        return "decompose"

      case "augment":
        if (deficits.consistency || deficits.factuality) return "refine"
        return "decompose"

      case "refine":
        return "decompose"

      case "decompose":
        return "decompose" // Max escalation
    }
  }

  /**
   * Generate recommendation based on search quality.
   */
  private _getRecommendation(
    entries: IndexEntry[],
    deficits: AdaptiveSearchResult["deficits"],
    mode: RetrievalMode,
    _query: string,
  ): AdaptiveSearchResult["recommendation"] {
    if (entries.length === 0) return "manual-research"
    if (this._isSufficient(entries, deficits, mode)) return "proceed"

    if (deficits.completeness) return "augment"
    if (deficits.consistency || deficits.factuality) return "refine"
    return "decompose"
  }
}
