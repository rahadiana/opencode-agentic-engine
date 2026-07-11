/**
 * RAG Quality Scorer — Multi-dimensional Quality Assessment for RAG Entries
 *
 * Berdasarkan paper:
 * - SCIM (MDPI Electronics, 2026): 5-dimensi quality eval + degradation detection
 * - Reflective RAG (ACL Findings, 2026): self-evaluation signals
 * - ReflectRAG (Neurocomputing, 2026): iterative reflection with GRPO
 *
 * 5 Dimensi Kualitas:
 * 1. Relevance  — seberapa relevan konten dengan query
 * 2. Completeness — apakah mencakup semua aspek penting
 * 3. Consistency — konsisten internal & eksternal
 * 4. Factuality — faktual vs opini/asumsi
 * 5. Fluency — kualitas penulisan, kejelasan
 *
 * Plus:
 * - Usage-based scoring: entry sering dipakai & sukses → naik score
 * - Temporal decay: makin lama gak diverifikasi → turun confidence
 * - Staleness detection: flag entry yang perlu di-refresh
 */
import { createLogger } from "../observability/logger.js"
import type { QualityDimensions, IndexEntry, UsageStats, FeedbackEntry as _FeedbackEntry } from "./multi-index-rag.js"
import { createDefaultQuality, computeQualityScore } from "./multi-index-rag.js"

const _log = createLogger("RAGQuality")

// ── Constants ──────────────────────────────────────────────────

/** Default weights untuk weighted average quality score (SCIM-inspired) */
export const QUALITY_WEIGHTS: Record<keyof QualityDimensions, number> = {
  relevance: 0.25,
  factuality: 0.25,
  completeness: 0.20,
  consistency: 0.20,
  fluency: 0.10,
}

/** Thresholds untuk decision making */
export const QUALITY_THRESHOLDS = {
  /** Minimum acceptable overall quality */
  MIN_ACCEPTABLE: 0.5,
  /** High quality threshold */
  HIGH_QUALITY: 0.8,
  /** Critical quality — auto-flag for review */
  CRITICAL_LOW: 0.3,
  /** Staleness threshold: > ini berarti perlu di-refresh */
  STALE_THRESHOLD: 0.6,
  /** Days without verification before staleness starts */
  STALE_GRACE_DAYS: 30,
  /** Days before entry is considered completely stale */
  MAX_STALE_DAYS: 180,
  /** Usage ratio (success / total) below this → quality penalty */
  MIN_SUCCESS_RATIO: 0.3,
}

// ── Quality Scorer ─────────────────────────────────────────────

export class RAGQualityScorer {
  /**
   * Hitung overall quality score dari multi-dimensional quality.
   * Weighted average: relevance & factuality > completeness & consistency > fluency.
   */
  score(q: QualityDimensions): number {
    return computeQualityScore(q)
  }

  /**
   * Hitung staleness score (0 = fresh, 1 = completely stale).
   * Berdasarkan:
   * - Age: makin lama sejak dibuat
   * - Last verification: makin lama gak diverifikasi
   * - Usage: gak pernah dipake → lebih cepat stale
   */
  computeStaleness(entry: {
    timestamp: string
    lastVerifiedAt?: string
    usageStats?: UsageStats
    qualityScore?: number
  }): number {
    const now = Date.now()
    const created = new Date(entry.timestamp).getTime()
    const ageDays = (now - created) / 86_400_000

    // Base staleness from age (0 at creation, 1 at MAX_STALE_DAYS)
    let ageStaleness = Math.min(ageDays / QUALITY_THRESHOLDS.MAX_STALE_DAYS, 1.0)

    // If verified recently, reduce staleness
    if (entry.lastVerifiedAt) {
      const verifiedAge = (now - new Date(entry.lastVerifiedAt).getTime()) / 86_400_000
      const verificationBonus = Math.min(verifiedAge / QUALITY_THRESHOLDS.STALE_GRACE_DAYS, 1.0)
      // Verification resets staleness partially
      ageStaleness = ageStaleness * (1 - verificationBonus * 0.5)
    }

    // Usage bonus: frequently used entries are less stale
    let usageStaleness = 0
    const stats = entry.usageStats
    if (stats && stats.retrievalCount > 0) {
      const totalUsage = stats.retrievalCount
      // More usage = less stale (diminishing returns after 20 uses)
      const usageFactor = Math.min(totalUsage / 20, 1.0)
      usageStaleness = usageFactor * 0.3 // max 0.3 reduction
    }

    // Quality bonus: higher quality entries decay slower
    let qualityStaleness = 0
    if (entry.qualityScore !== undefined) {
      // Quality below 0.5 accelerates staleness
      if (entry.qualityScore < 0.5) {
        qualityStaleness = (0.5 - entry.qualityScore) * 0.5
      }
    }

    const staleness = Math.min(Math.max(ageStaleness - usageStaleness + qualityStaleness, 0), 1.0)
    return Math.round(staleness * 100) / 100
  }

  /**
   * Apply temporal decay to quality dimensions.
   * Higher staleness → lower quality scores.
   * Returns updated quality dimensions.
   */
  applyDecay(quality: QualityDimensions, staleness: number): QualityDimensions {
    if (staleness <= 0) return { ...quality }

    const decay: QualityDimensions = {
      relevance: Math.max(quality.relevance * (1 - staleness * 0.3), 0.1),
      completeness: Math.max(quality.completeness * (1 - staleness * 0.2), 0.1),
      consistency: Math.max(quality.consistency * (1 - staleness * 0.25), 0.1),
      factuality: Math.max(quality.factuality * (1 - staleness * 0.35), 0.1), // factuality decays fastest
      fluency: Math.max(quality.fluency * (1 - staleness * 0.15), 0.1),       // fluency decays slowest
    }
    return decay
  }

  /**
   * Update quality based on usage feedback (SCIM-inspired).
   * - Success → increase relevance, completeness
   * - Failure → decrease factuality, consistency
   * - Neutral → slight decay
   */
  applyFeedback(
    quality: QualityDimensions,
    feedbackType: "positive" | "negative" | "neutral",
    dimension?: keyof QualityDimensions,
  ): QualityDimensions {
    const updated = { ...quality }

    if (feedbackType === "positive") {
      // Success: boost relevance and completeness
      if (dimension) {
        updated[dimension] = Math.min(updated[dimension] + 0.05, 1.0)
      } else {
        updated.relevance = Math.min(updated.relevance + 0.03, 1.0)
        updated.completeness = Math.min(updated.completeness + 0.03, 1.0)
      }
    } else if (feedbackType === "negative") {
      // Failure: reduce factuality and consistency
      if (dimension) {
        updated[dimension] = Math.max(updated[dimension] - 0.1, 0)
      } else {
        updated.factuality = Math.max(updated.factuality - 0.08, 0)
        updated.consistency = Math.max(updated.consistency - 0.05, 0)
      }
    } else {
      // Neutral: slight decay to all dimensions
      for (const key of Object.keys(updated) as (keyof QualityDimensions)[]) {
        updated[key] = Math.max(updated[key] - 0.01, 0.1)
      }
    }

    return updated
  }

  /**
   * Classify quality level berdasarkan multi-dimensional scores.
   * Returns: "high" | "acceptable" | "low" | "critical"
   */
  classifyQuality(entry: {
    quality?: QualityDimensions
    qualityScore?: number
    stalenessScore?: number
  }): "high" | "acceptable" | "low" | "critical" {
    const score = entry.qualityScore ?? (entry.quality ? computeQualityScore(entry.quality) : 0.7)
    const staleness = entry.stalenessScore ?? 0

    if (score >= QUALITY_THRESHOLDS.HIGH_QUALITY && staleness < 0.3) return "high"
    if (score >= QUALITY_THRESHOLDS.MIN_ACCEPTABLE && staleness < QUALITY_THRESHOLDS.STALE_THRESHOLD) return "acceptable"
    if (score >= QUALITY_THRESHOLDS.CRITICAL_LOW) return "low"
    return "critical"
  }

  /**
   * Dapatkan rekomendasi aksi berdasarkan quality assessment.
   * Reflective RAG-inspired: reflection tagging → action recommendation.
   */
  getRecommendation(entry: {
    quality?: QualityDimensions
    qualityScore?: number
    stalenessScore?: number
    usageStats?: UsageStats
    lastVerifiedAt?: string
  }): {
    action: "none" | "refresh" | "verify" | "upgrade" | "prune"
    reason: string
    priority: "low" | "medium" | "high" | "critical"
  } {
    const qualityClass = this.classifyQuality(entry as IndexEntry)
    const staleness = entry.stalenessScore ?? 0
    const stats = entry.usageStats
    const totalUsage = stats ? stats.retrievalCount : 0
    const successRatio = stats && stats.retrievalCount > 0
      ? stats.successCount / stats.retrievalCount
      : -1

    // SCIM degradation detection: quality < CRITICAL_LOW or success ratio very low
    if (qualityClass === "critical") {
      return { action: "prune", reason: "Quality critically low — remove or replace", priority: "critical" }
    }

    // High staleness → refresh
    if (staleness > QUALITY_THRESHOLDS.STALE_THRESHOLD) {
      return { action: "refresh", reason: `Staleness ${(staleness * 100).toFixed(0)}% — needs re-verification`, priority: "high" }
    }

    // Low quality → verify
    if (qualityClass === "low") {
      return { action: "verify", reason: "Quality score below acceptable threshold", priority: "medium" }
    }

    // Good quality but never verified → verify
    if (!entry.lastVerifiedAt && totalUsage > 5) {
      return { action: "verify", reason: "Used >5 times but never verified", priority: "medium" }
    }

    // Low success ratio → upgrade
    if (successRatio >= 0 && successRatio < QUALITY_THRESHOLDS.MIN_SUCCESS_RATIO && totalUsage >= 5) {
      return { action: "upgrade", reason: `Success ratio ${(successRatio * 100).toFixed(0)}% — needs improvement`, priority: "high" }
    }

    return { action: "none", reason: "Quality acceptable", priority: "low" }
  }

  /**
   * Format quality report untuk logging/dashboard.
   */
  formatQualityReport(entry: IndexEntry): string {
    const quality = entry.quality ?? createDefaultQuality()
    const qs = entry.qualityScore ?? computeQualityScore(quality)
    const staleness = entry.stalenessScore ?? 0
    const classification = this.classifyQuality(entry)
    const rec = this.getRecommendation(entry)
    const stats = entry.usageStats

    const lines: string[] = [
      `  Quality: ${(qs * 100).toFixed(0)}% (${classification})`,
      `  Staleness: ${(staleness * 100).toFixed(0)}%`,
      `  Dimensions: rel=${(quality.relevance * 100).toFixed(0)}% comp=${(quality.completeness * 100).toFixed(0)}% ` +
        `cons=${(quality.consistency * 100).toFixed(0)}% fact=${(quality.factuality * 100).toFixed(0)}% ` +
        `flu=${(quality.fluency * 100).toFixed(0)}%`,
    ]

    if (stats && stats.retrievalCount > 0) {
      lines.push(`  Usage: ${stats.retrievalCount} retrievals, ${stats.successCount} success, ${stats.failureCount} failure`)
    }

    if (rec.action !== "none") {
      lines.push(`  ⚠️ Recommendation: ${rec.action} (${rec.priority}) — ${rec.reason}`)
    }

    return lines.join("\n")
  }
}

/**
 * Factory untuk default UsageStats.
 */
export function createDefaultUsageStats(): UsageStats {
  return {
    retrievalCount: 0,
    successCount: 0,
    failureCount: 0,
    lastRetrievedAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
  }
}
