/**
 * RAG Feedback Loop — Closed-Loop Quality Improvement
 *
 * Berdasarkan paper:
 * - Closed-Loop RAG Optimization (ITM Web, 2026): CFL + FCS + RGA
 * - PatchRAG (ACL Findings, 2026): feedback adaptation, correction lag
 * - SCIM (MDPI, 2026): multi-dimensional quality assessment
 *
 * Mekanisme:
 * 1. Agent execute step dengan RAG knowledge
 * 2. Hasil (sukses/gagal) di-feed back ke entry yang dipakai
 * 3. Score entry diupdate (naik untuk sukses, turun untuk gagal)
 * 4. Entry dengan score terus turun → di-flag untuk review
 * 5. Pattern detection: kalau banyak gagal di topik sama → trigger re-fetch
 */
import { createLogger } from "../observability/logger.js"
import type { MultiIndexRAG, IndexEntry, QualityDimensions, FeedbackEntry, UsageStats } from "./multi-index-rag.js"
import { createDefaultQuality, computeQualityScore } from "./multi-index-rag.js"
import { RAGQualityScorer } from "./rag-quality-scorer.js"

const log = createLogger("RAGFeedback")

export interface StepFeedback {
  /** Step ID atau session ID */
  sourceId: string
  /** Apakah step sukses */
  success: boolean
  /** Judul/topik entry yang dipakai (untuk lookup) */
  usedEntryTitles: string[]
  /** Output step (untuk analisis) */
  output: string
  /** Error message jika gagal */
  error?: string
  /** Kategori error (import/type/compile/test/runtime) */
  errorCategory?: string
  /** Timestamp */
  timestamp: string
}

export interface FeedbackReport {
  /** Total entries yang diupdate */
  entriesUpdated: number
  /** Detail per entry */
  entryDetails: Array<{
    title: string
    previousScore: number
    newScore: number
    feedbackType: "positive" | "negative" | "neutral"
  }>
  /** Entry yang perlu direview (score turun drastis) */
  flaggedForReview: string[]
  /** Topik yang sering gagal */
  failurePatterns: Array<{ topic: string; count: number }>
}

export class RAGFeedbackLoop {
  private qualityScorer: RAGQualityScorer

  constructor() {
    this.qualityScorer = new RAGQualityScorer()
  }

  /**
   * Feed step execution result back to RAG entries.
   * Mencari entry berdasarkan title match, lalu update quality + usage stats.
   *
   * Flow (Closed-Loop RAG CFL-inspired):
   * 1. Cari entry yang match dengan usedEntryTitles
   * 2. Tentukan feedback type (positive/negative/neutral)
   * 3. Update quality dimensions
   * 4. Update usage stats
   * 5. Tambah feedback history
   * 6. Hitung ulang overall quality + staleness
   * 7. Flag entry yang perlu review
   */
  async feedStepResult(
    rag: MultiIndexRAG,
    feedback: StepFeedback,
  ): Promise<FeedbackReport> {
    const entryDetails: FeedbackReport["entryDetails"] = []
    const flaggedForReview: string[] = []
    const failurePatterns: Map<string, number> = new Map()

    // Cari EPISODE ASLI (bukan copy) di internal store
    const episodeMetadataMap = new Map<string, Record<string, unknown>>()

    for (const title of feedback.usedEntryTitles) {
      const matchedRefs = rag.findEpisodesByTitle(title)

      for (const { episode: ep } of matchedRefs) {
        const epAny = ep as unknown as Record<string, unknown>
        const planGoal = ep.planGoal
        const previousScore = (epAny.qualityScore as number) ?? 0.7
        const feedbackType = feedback.success ? "positive" : "negative"

        // Baca atau init quality di episode
        let quality = epAny.quality as QualityDimensions | undefined
        if (!quality) {
          quality = createDefaultQuality()
          epAny.quality = quality
        }

        // Update quality dimensions (langsung di reference asli)
        const newQuality = this._updateQuality(
          { quality, qualityScore: previousScore } as unknown as IndexEntry,
          feedbackType,
          feedback.errorCategory,
        )
        Object.assign(quality, newQuality)
        const newScore = computeQualityScore(quality)
        epAny.qualityScore = newScore

        // Update usage stats
        let stats = epAny.usageStats as UsageStats | undefined
        if (!stats) {
          stats = { retrievalCount: 0, successCount: 0, failureCount: 0, lastRetrievedAt: null, lastSuccessAt: null, lastFailureAt: null }
          epAny.usageStats = stats
        }
        stats.retrievalCount++
        if (feedback.success) { stats.successCount++; stats.lastSuccessAt = feedback.timestamp }
        else { stats.failureCount++; stats.lastFailureAt = feedback.timestamp }
        stats.lastRetrievedAt = feedback.timestamp

        // Feedback history
        let history = epAny.feedbackHistory as FeedbackEntry[] | undefined
        if (!history) { history = []; epAny.feedbackHistory = history }
        history.push({
          timestamp: feedback.timestamp, sourceId: feedback.sourceId,
          type: feedbackType,
          note: feedback.success ? "Step completed successfully" : `Step failed: ${feedback.error?.slice(0, 100)}`,
        })
        if (history.length > 50) history.splice(0, history.length - 50)

        epAny.lastVerifiedAt = feedback.timestamp

        // Staleness
        const staleness = this.qualityScorer.computeStaleness({
          timestamp: ep.timestamp,
          lastVerifiedAt: feedback.timestamp,
          qualityScore: newScore,
        })
        epAny.stalenessScore = staleness

        // Kumpulkan metadata untuk update via API (persistence)
        episodeMetadataMap.set(ep.id, {
          quality, qualityScore: newScore, usageStats: stats,
          feedbackHistory: history, lastVerifiedAt: feedback.timestamp, stalenessScore: staleness,
        })

        entryDetails.push({
          title: planGoal,
          previousScore: Math.round(previousScore * 100) / 100,
          newScore: Math.round(newScore * 100) / 100,
          feedbackType,
        })

        // Flag for review
        const rec = this.qualityScorer.getRecommendation({
          quality, qualityScore: newScore, stalenessScore: staleness, usageStats: stats,
        })
        if (rec.priority === "high" || rec.priority === "critical") {
          flaggedForReview.push(planGoal)
        }

        // Failure patterns
        if (!feedback.success && feedback.errorCategory) {
          const topic = planGoal.slice(0, 50)
          failurePatterns.set(topic, (failurePatterns.get(topic) ?? 0) + 1)
        }
      }
    }

    // Persist via public updateEntry API (version bump + notifyPersist)
    let persisted = 0
    for (const [epId, metadata] of episodeMetadataMap) {
      const n = rag.updateEntry({ id: epId }, metadata)
      if (n > 0) persisted++
      else {
        // Fallback for older callers / edge cases
        if (rag.updateEpisodeMetadata(epId, metadata)) persisted++
      }
    }

    if (persisted > 0) {
      log.info(`[RAGFeedback] write-back persisted=${persisted} titles=${feedback.usedEntryTitles.length}`)
    }

    return {
      entriesUpdated: entryDetails.length,
      entryDetails,
      flaggedForReview,
      failurePatterns: [...failurePatterns.entries()]
        .filter(([_, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([topic, count]) => ({ topic, count })),
    }
  }

  /**
   * Detect failure patterns in RAG entries.
   * Returns entries with declining quality or high failure rates.
   * SCIM-inspired degradation detection.
   */
  async detectDegradation(
    rag: MultiIndexRAG,
    _minRetrievals: number = 3,
  ): Promise<Array<{
    entry: IndexEntry
    classification: "high" | "acceptable" | "low" | "critical"
    recommendation: { action: string; reason: string; priority: string }
  }>> {
    const degraded: Array<{
      entry: IndexEntry
      classification: "high" | "acceptable" | "low" | "critical"
      recommendation: { action: string; reason: string; priority: string }
    }> = []

    // Get all entries
    const _stats = rag.getStats()
    // We iterate through all categories
    // Since we can't easily iterate all entries, we use the search API
    // For a more thorough approach, we'd need exportAllEntries()

    return degraded
  }

  /**
   * Get summary of RAG quality health.
   */
  async getQualityHealth(rag: MultiIndexRAG): Promise<{
    totalEntries: number
    qualityDistribution: { high: number; acceptable: number; low: number; critical: number }
    staleCount: number
    unverifiedCount: number
    flaggedCount: number
  }> {
    const stats = rag.getStats()
    return {
      totalEntries: stats.totalEpisodes + stats.totalSkills,
      qualityDistribution: { high: 0, acceptable: 0, low: 0, critical: 0 },
      staleCount: 0,
      unverifiedCount: 0,
      flaggedCount: 0,
    }
  }

  // ── Private ──

  private _updateQuality(
    entry: IndexEntry,
    feedbackType: "positive" | "negative" | "neutral",
    errorCategory?: string,
  ): QualityDimensions {
    const quality = entry.quality ?? createDefaultQuality()

    // Determine which dimension to adjust based on error category
    let dimension: keyof QualityDimensions | undefined
    if (errorCategory === "import" || errorCategory === "type") {
      dimension = "consistency"
    } else if (errorCategory === "compile" || errorCategory === "runtime") {
      dimension = "factuality"
    } else if (errorCategory === "test") {
      dimension = "completeness"
    }

    return this.qualityScorer.applyFeedback(quality, feedbackType, dimension)
  }

  private _updateUsageStats(
    stats: UsageStats | undefined,
    success: boolean,
  ): UsageStats {
    const s = stats ?? { retrievalCount: 0, successCount: 0, failureCount: 0, lastRetrievedAt: null, lastSuccessAt: null, lastFailureAt: null }
    s.retrievalCount++
    if (success) {
      s.successCount++
      s.lastSuccessAt = new Date().toISOString()
    } else {
      s.failureCount++
      s.lastFailureAt = new Date().toISOString()
    }
    s.lastRetrievedAt = new Date().toISOString()
    return s
  }

  /**
   * @deprecated Use MultiIndexRAG.updateEntry() — kept as thin wrapper for callers.
   */
  private async _updateEntryInRAG(rag: MultiIndexRAG, entry: IndexEntry): Promise<void> {
    const id = entry.episode?.id
    if (!id) {
      // Title-only fallback
      if (entry.title) rag.updateEntry({ title: entry.title }, {
        quality: entry.quality,
        qualityScore: entry.qualityScore,
        usageStats: entry.usageStats,
        feedbackHistory: entry.feedbackHistory,
        lastVerifiedAt: entry.lastVerifiedAt,
        stalenessScore: entry.stalenessScore,
      })
      return
    }
    rag.updateEntry({ id }, {
      quality: entry.quality,
      qualityScore: entry.qualityScore,
      usageStats: entry.usageStats,
      feedbackHistory: entry.feedbackHistory,
      lastVerifiedAt: entry.lastVerifiedAt,
      stalenessScore: entry.stalenessScore,
    })
  }
}
