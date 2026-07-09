/**
 * Knowledge Boundary Calibration — Agentic Trust Calibration
 *
 * Berdasarkan paper:
 * - KbPO: Knowledge Boundary Policy Optimization (ACL, 2026)
 *   "Trust Within? Seek Beyond?" — 4-quadrant cognitive taxonomy
 *
 * Quadrant Taxonomy:
 *
 *               Internal Knowledge (parametric)
 *               HIGH                    LOW
 *       ┌─────────────────┬─────────────────┐
 *   EXT │   Quadrant 1    │   Quadrant 2    │
 *   HIGH│   Both align    │ Internal weak   │
 *   R   │   → INTEGRATE   │   → TRUST RAG   │
 *   N   │                 │                 │
 *   A   ├─────────────────┼─────────────────┤
 *   L   │   Quadrant 3    │   Quadrant 4    │
 *   LOW │   Retrieval noisy│ Both unknown   │
 *       │   → TRUST SELF  │   → REFUSE      │
 *       └─────────────────┴─────────────────┘
 *
 * Mekanisme:
 * 1. Ukur internal confidence (LLM's own certainty about the answer)
 * 2. Ukur external confidence (RAG quality scores)
 * 3. Petakan ke salah satu dari 4 quadrant
 * 4. Terapkan action sesuai quadrant:
 *    - Q1: Integrate (gabung internal + external)
 *    - Q2: Trust RAG (eksternal lebih可信)
 *    - Q3: Trust Self (internal lebih可信, RAG noisy)
 *    - Q4: Refuse (gak tahu, harus research lagi)
 */
import { createLogger } from "../observability/logger.js"
import type { IndexEntry } from "./multi-index-rag.js"
import { createDefaultQuality, computeQualityScore } from "./multi-index-rag.js"

const log = createLogger("KnowledgeBoundary")

// ── Types ──────────────────────────────────────────────────────

export type KnowledgeQuadrant = 1 | 2 | 3 | 4

export interface KnowledgeState {
  /** Internal confidence (0-1): seberapa yakin LLM dengan pengetahuannya sendiri */
  internalConfidence: number
  /** External confidence (0-1): seberapa yakin dengan RAG results */
  externalConfidence: number
  /** Detected quadrant */
  quadrant: KnowledgeQuadrant
  /** Recommended action */
  action: "integrate" | "trust-rag" | "trust-self" | "refuse" | "research"
  /** Reasoning for the decision */
  reasoning: string
  /** Whether RAG results are noisy/contradictory */
  isNoisy: boolean
  /** Whether internal knowledge is sufficient */
  isInternalSufficient: boolean
}

export interface CalibratedEntry {
  entry: IndexEntry
  /** Calibrated confidence after boundary analysis */
  calibratedConfidence: number
  /** Whether this entry should be used */
  shouldUse: boolean
  /** Reason for inclusion/exclusion */
  reason: string
}

// ── Constants ──────────────────────────────────────────────────

const CONFIDENCE_THRESHOLDS = {
  /** Above this = high confidence */
  HIGH: 0.7,
  /** Above this = medium confidence */
  MEDIUM: 0.4,
  /** Below this = low confidence */
  LOW: 0.3,
  /** Noise detection: standard deviation of scores above this = noisy */
  NOISE_STD_DEV: 0.25,
  /** Contradiction: confidence difference > this = conflicting */
  CONTRADICTION_GAP: 0.4,
}

// ── Knowledge Boundary Calibrator ──────────────────────────────

export class KnowledgeBoundaryCalibrator {
  /**
   * Analyze knowledge state and determine quadrant.
   *
   * @param internalConfidence - LLM's confidence in its own knowledge (0-1)
   *   Cara estimasi: dari token probabilities, atau dari jumlah kata "mungkin", "saya pikir"
   * @param ragEntries - Retrieved RAG entries
   * @returns KnowledgeState with quadrant classification
   */
  analyze(
    internalConfidence: number,
    ragEntries: IndexEntry[],
  ): KnowledgeState {
    // Hitung external confidence dari quality scores RAG entries
    const externalConfidence = this._computeExternalConfidence(ragEntries)
    const isNoisy = this._detectNoise(ragEntries)
    const isInternalSufficient = internalConfidence >= CONFIDENCE_THRESHOLDS.HIGH

    // KbPO quadrant classification
    const quadrant = this._classifyQuadrant(internalConfidence, externalConfidence, isNoisy)
    const { action, reasoning } = this._getQuadrantAction(quadrant, internalConfidence, externalConfidence, isNoisy)

    return {
      internalConfidence: Math.round(internalConfidence * 100) / 100,
      externalConfidence: Math.round(externalConfidence * 100) / 100,
      quadrant,
      action,
      reasoning,
      isNoisy,
      isInternalSufficient,
    }
  }

  /**
   * Calibrate individual RAG entries based on knowledge boundary analysis.
   * Quadrant 3 (noisy retrieval): downweight or filter entries.
   * Quadrant 2 (weak internal): boost entry confidence.
   */
  calibrateEntries(
    entries: IndexEntry[],
    knowledgeState: KnowledgeState,
  ): CalibratedEntry[] {
    return entries.map(entry => {
      const baseQuality = entry.qualityScore ?? computeQualityScore(entry.quality ?? createDefaultQuality())
      let calibratedConfidence = baseQuality
      let shouldUse = true
      let reason = "Default inclusion"

      switch (knowledgeState.quadrant) {
        case 1: // Both align — boost confidence
          calibratedConfidence = Math.min((baseQuality + knowledgeState.internalConfidence) / 2 + 0.1, 1.0)
          reason = `Q1: Internal ${(knowledgeState.internalConfidence * 100).toFixed(0)}% + External ${(baseQuality * 100).toFixed(0)}% align — boosted`
          break

        case 2: // Internal weak — trust RAG
          calibratedConfidence = Math.min(baseQuality + 0.15, 1.0)
          reason = `Q2: Internal weak (${(knowledgeState.internalConfidence * 100).toFixed(0)}%) — trusting RAG`
          break

        case 3: // Retrieval noisy — be selective
          if (baseQuality < CONFIDENCE_THRESHOLDS.MEDIUM) {
            shouldUse = false
            reason = `Q3: Noisy retrieval — filtering low-quality entry (${(baseQuality * 100).toFixed(0)}%)`
            calibratedConfidence = 0
          } else {
            calibratedConfidence = Math.max(baseQuality - 0.1, 0)
            reason = `Q3: Noisy retrieval — reduced confidence to ${(calibratedConfidence * 100).toFixed(0)}%`
          }
          break

        case 4: // Both unknown — refuse all
          shouldUse = false
          calibratedConfidence = 0
          reason = `Q4: Both internal (${(knowledgeState.internalConfidence * 100).toFixed(0)}%) and external (${(baseQuality * 100).toFixed(0)}%) unknown — refusing`
          break
      }

      return { entry, calibratedConfidence, shouldUse, reason }
    })
  }

  /**
   * Estimate internal confidence from a text response.
   * Heuristic: cari signal of uncertainty dalam teks.
   * KbPO-inspired: semantic stability metrics.
   */
  estimateInternalConfidence(text: string): number {
    if (!text || text.length < 10) return 0.3

    const lower = text.toLowerCase()

    // Uncertainty markers → lower confidence
    const uncertaintyPatterns = [
      /\bmungkin\b/, /\bkurang\b.*\byakin\b/, /\btidak\b.*\btahu\b/,
      /\bperhaps\b/, /\bmaybe\b/, /\bi'm not sure\b/, /\bi think\b/,
      /\bprobably\b/, /\bpossibly\b/, /\bnot certain\b/,
      /\bsepertinya\b/, /\bragu\b/, /\bbisa jadi\b/,
    ]
    const uncertaintyCount = uncertaintyPatterns.filter(p => p.test(lower)).length

    // Certainty markers → higher confidence
    const certaintyPatterns = [
      /\btentu\b/, /\byakin\b/, /\bpasti\b/, /\bdefinitely\b/,
      /\bcertainly\b/, /\babsolutely\b/, /\bundoubtedly\b/,
      /\bsudah\b.*\bpasti\b/, /\bdapat\b.*\bdipastikan\b/,
    ]
    const certaintyCount = certaintyPatterns.filter(p => p.test(lower)).length

    // Specificity: if text has code, specific numbers, or API names → higher confidence
    const hasCodeBlock = text.includes("```") || text.includes("function") || text.includes("import ")
    const hasSpecificNumbers = /\b\d{2,}\b/.test(text)

    // Calculate base confidence
    let confidence = 0.5 // default moderate
    confidence += certaintyCount * 0.1
    confidence -= uncertaintyCount * 0.15
    if (hasCodeBlock) confidence += 0.2
    if (hasSpecificNumbers) confidence += 0.1

    return Math.max(0.1, Math.min(1.0, confidence))
  }

  /**
   * Format quadrant analysis for prompt injection.
   * Memberi tahu LLM quadrant apa yang terdeteksi dan bagaimana harus bersikap.
   */
  formatForPrompt(knowledgeState: KnowledgeState): string {
    const quadrantNames: Record<KnowledgeQuadrant, string> = {
      1: "Both Reliable (Integrate)",
      2: "RAG Reliable (Trust External)",
      3: "Internal Reliable (Trust Self)",
      4: "Both Unknown (Research Needed)",
    }

    return `<knowledge-boundary>
  <quadrant value="${knowledgeState.quadrant}">
    <name>${quadrantNames[knowledgeState.quadrant]}</name>
    <internal-confidence>${(knowledgeState.internalConfidence * 100).toFixed(0)}%</internal-confidence>
    <external-confidence>${(knowledgeState.externalConfidence * 100).toFixed(0)}%</external-confidence>
    <action>${knowledgeState.action}</action>
  </quadrant>
  <reasoning>${knowledgeState.reasoning}</reasoning>
  <noisy>${knowledgeState.isNoisy}</noisy>
</knowledge-boundary>`
  }

  // ── Private ──

  /**
   * Compute external confidence from RAG entries.
   * Weighted average of quality scores, with count bonus.
   */
  private _computeExternalConfidence(entries: IndexEntry[]): number {
    if (entries.length === 0) return 0

    const avgQuality = entries.reduce((sum, e) => sum + (e.qualityScore ?? 0.7), 0) / entries.length
    const countBonus = Math.min(entries.length / 5, 1.0) * 0.1 // max 0.1 bonus for 5+ entries
    const externalConf = avgQuality * 0.8 + countBonus

    return Math.min(1.0, Math.max(0, externalConf))
  }

  /**
   * Detect noise dalam RAG results.
   * KbPO: noise = high variance dalam quality scores atau contradictory entries.
   */
  private _detectNoise(entries: IndexEntry[]): boolean {
    if (entries.length < 2) return false

    // Variance-based noise detection
    const scores = entries.map(e => e.qualityScore ?? 0.7)
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length
    const variance = scores.reduce((sum, s) => sum + (s - mean) ** 2, 0) / scores.length
    const stdDev = Math.sqrt(variance)

    // High standard deviation = noisy
    if (stdDev > CONFIDENCE_THRESHOLDS.NOISE_STD_DEV) return true

    // Check for contradictory timestamps (very old + very new = mixed quality)
    const timestamps = entries.map(e => new Date(e.timestamp).getTime()).filter(t => !isNaN(t))
    if (timestamps.length >= 2) {
      const ageRange = (Math.max(...timestamps) - Math.min(...timestamps)) / 86_400_000 // days
      if (ageRange > 90) return true // entries span > 90 days
    }

    return false
  }

  /**
   * KbPO 4-quadrant classification.
   *
   *               Internal HIGH    Internal LOW
   * External HIGH  → Q1 (align)    → Q2 (trust RAG)
   * External LOW   → Q3 (noisy)    → Q4 (refuse)
   */
  private _classifyQuadrant(
    internalConf: number,
    externalConf: number,
    isNoisy: boolean,
  ): KnowledgeQuadrant {
    const internalHigh = internalConf >= CONFIDENCE_THRESHOLDS.HIGH
    const externalHigh = externalConf >= CONFIDENCE_THRESHOLDS.HIGH
    const internalLow = internalConf < CONFIDENCE_THRESHOLDS.LOW
    const externalLow = externalConf < CONFIDENCE_THRESHOLDS.LOW

    if (internalHigh && externalHigh) return 1 // Both align
    if (!internalHigh && externalHigh) return 2 // Trust RAG
    if (internalHigh && !externalHigh) return 3 // Trust self (noisy retrieval)
    if (internalLow && externalLow) return 4 // Both unknown
    if (isNoisy && internalHigh) return 3
    if (isNoisy && !internalHigh) return 4

    // Default: quadrant 4 (cautious)
    return 4
  }

  /**
   * Map quadrant to action with reasoning.
   * KbPO: boundary-consistent alignment.
   */
  private _getQuadrantAction(
    quadrant: KnowledgeQuadrant,
    internalConf: number,
    externalConf: number,
    isNoisy: boolean,
  ): { action: KnowledgeState["action"]; reasoning: string } {
    switch (quadrant) {
      case 1:
        return {
          action: "integrate",
          reasoning: `Internal (${(internalConf * 100).toFixed(0)}%) and external (${(externalConf * 100).toFixed(0)}%) knowledge align. Integrate both sources for maximum accuracy.`,
        }
      case 2:
        return {
          action: "trust-rag",
          reasoning: `Internal knowledge insufficient (${(internalConf * 100).toFixed(0)}%). RAG provides reliable external knowledge (${(externalConf * 100).toFixed(0)}%). Trust retrieved content.`,
        }
      case 3:
        return {
          action: "trust-self",
          reasoning: isNoisy
            ? `RAG results appear noisy or contradictory. Internal knowledge is reliable (${(internalConf * 100).toFixed(0)}%). Prioritize internal knowledge and filter RAG entries.`
            : `RAG confidence (${(externalConf * 100).toFixed(0)}%) is below internal confidence (${(internalConf * 100).toFixed(0)}%). Trust internal knowledge but verify with web research.`,
        }
      case 4:
        return {
          action: "refuse",
          reasoning: `Neither internal (${(internalConf * 100).toFixed(0)}%) nor external (${(externalConf * 100).toFixed(0)}%) knowledge is reliable. Must conduct web research before proceeding.`,
        }
    }
  }
}
