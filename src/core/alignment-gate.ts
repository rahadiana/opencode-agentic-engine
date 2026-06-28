/**
 * AlignmentGate — Gap #10: Agent alignment at scale.
 *
 * From paper (Section 7.2): "As agents become more autonomous and are composed
 * into teams, ensuring that their collective behavior aligns with human values
 * becomes both more important and more difficult."
 *
 * Detects goal drift, intent mismatch, and behavioral divergence between
 * agent output and original user intent. Pattern follows constraint-manifold.ts
 * but focuses on semantic alignment rather than safety.
 *
 * ponytail: One file, lightweight TF-IDF comparison + configurable thresholds.
 */

import { tokenize, cosineSimilarity, computeTf } from "../memory/stopwords.js"

// ── Types ──────────────────────────────────────────────────────

export type AlignmentDimension = "goal" | "constraint" | "scope" | "value"
export type AlignmentSeverity = "aligned" | "drift_warning" | "drift_error" | "misaligned"

export interface AlignmentCheck {
  dimension: AlignmentDimension
  severity: AlignmentSeverity
  score: number           // 0=misaligned → 1=perfect alignment
  description: string
  timestamp: number
}

export interface AlignmentResult {
  checks: AlignmentCheck[]
  overallScore: number    // 0-1, weighted average
  passed: boolean         // true if all checks pass threshold
  driftDetected: boolean
  recommendations: string[]
}

export interface AlignmentConfig {
  /** Score threshold below which we flag drift (default: 0.5) */
  driftThreshold: number
  /** Score threshold below which we block (default: 0.3) */
  blockThreshold: number
  /** Dimensions to check (default: all) */
  enabledDimensions: AlignmentDimension[]
  /** Max entries in alignment history */
  maxHistory: number
}

// ── Defaults ───────────────────────────────────────────────────

const DEFAULT_CONFIG: AlignmentConfig = {
  driftThreshold: 0.5,
  blockThreshold: 0.3,
  enabledDimensions: ["goal", "constraint", "scope"],
  maxHistory: 100,
}

// ── AlignmentGate Class ───────────────────────────────────────

export class AlignmentGate {
  private config: AlignmentConfig
  private history: AlignmentCheck[] = []
  private scoreHistory: number[] = []

  constructor(config?: Partial<AlignmentConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Check alignment between original intent and current agent output/state.
   * @param originalIntent — the original goal/constraint text from user
   * @param currentState — representation of current agent behavior/state
   * @param contextFiles — optional file paths involved (for scope check)
   */
  checkAlignment(
    originalIntent: string,
    currentState: string,
    contextFiles?: string[],
  ): AlignmentResult {
    const checks: AlignmentCheck[] = []
    const now = Date.now()

    // ponytail: TF-IDF cosine similarity for semantic comparison
    // NOT a full semantic understanding — good enough for drift detection
    const intentTokens = tokenize(originalIntent)
    const stateTokens = tokenize(currentState)
    const intentTf = computeTf(intentTokens)
    const stateTf = computeTf(stateTokens)
    const semanticScore = cosineSimilarity(intentTf, stateTf)

    if (this.config.enabledDimensions.includes("goal")) {
      checks.push({
        dimension: "goal",
        severity: this.scoreToSeverity(semanticScore),
        score: semanticScore,
        description: `Goal alignment: ${Math.round(semanticScore * 100)}% match with original intent`,
        timestamp: now,
      })
    }

    if (this.config.enabledDimensions.includes("constraint")) {
      // Extract constraint-like phrases (e.g., "should not", "must", "avoid")
      const constraintPattern = /\b(?:should\s+not|must\s+not|cannot|avoid|never|don't|do\s+not|must|should|required)\s+[\w\s]{3,80}/gi
      const intentConstraints = originalIntent.match(constraintPattern) ?? []
      const stateViolations = currentState.match(constraintPattern) ?? []

      const cScore = intentConstraints.length > 0
        ? Math.max(0, 1 - (stateViolations.length / intentConstraints.length))
        : 1 // no constraints → aligned by default

      checks.push({
        dimension: "constraint",
        severity: this.scoreToSeverity(cScore),
        score: cScore,
        description: intentConstraints.length > 0
          ? `Constraint alignment: ${Math.round(cScore * 100)}% match (${stateViolations.length}/${intentConstraints.length} constraints preserved)`
          : "No explicit constraints detected",
        timestamp: now,
      })
    }

    if (this.config.enabledDimensions.includes("scope") && contextFiles && contextFiles.length > 0) {
      // Scope check: are we modifying files outside the intended scope?
      if (contextFiles.length > 5) {
        const scopeScore = Math.max(0, 1 - ((contextFiles.length - 5) * 0.1))
        checks.push({
          dimension: "scope",
          severity: this.scoreToSeverity(scopeScore),
          score: scopeScore,
          description: `Scope alignment: ${contextFiles.length} files affected (threshold: 5)`,
          timestamp: now,
        })
      }
    }

    // Weighted average: goal=0.5, constraint=0.3, scope=0.2
    const weights: Record<string, number> = { goal: 0.5, constraint: 0.3, scope: 0.2, value: 0.4 }
    let totalWeight = 0
    let weightedSum = 0
    for (const c of checks) {
      const w = weights[c.dimension] ?? 0.25
      weightedSum += c.score * w
      totalWeight += w
    }
    const overallScore = totalWeight > 0 ? weightedSum / totalWeight : 1

    // Track history
    this.history = [...checks, ...this.history].slice(0, this.config.maxHistory)
    this.scoreHistory.push(overallScore)
    if (this.scoreHistory.length > 20) this.scoreHistory.shift()

    const driftDetected = checks.some(c => c.severity === "drift_warning" || c.severity === "drift_error")
    const passed = !checks.some(c => c.severity === "drift_error" || c.severity === "misaligned")

    // Generate recommendations
    const recommendations: string[] = []
    if (overallScore < this.config.driftThreshold) recommendations.push("⚠️ Significant goal drift detected — consider re-articulating intent")
    if (checks.some(c => c.dimension === "scope" && c.severity !== "aligned")) recommendations.push("📐 Scope creep detected — constrain file modifications")
    if (checks.some(c => c.dimension === "constraint" && c.score < 0.4)) recommendations.push("🔒 Constraints being violated — review current state against original rules")
    if (this.getAlignmentTrend() === "declining") recommendations.push("📉 Alignment declining over time — consider human review")

    return { checks, overallScore, passed, driftDetected, recommendations }
  }

  /** Check if alignment is improving or declining over time */
  getAlignmentTrend(): "improving" | "declining" | "stable" {
    if (this.scoreHistory.length < 3) return "stable"
    const recent = this.scoreHistory.slice(-5)
    const first = recent[0]
    const last = recent[recent.length - 1]
    const diff = last - first
    if (diff > 0.1) return "improving"
    if (diff < -0.1) return "declining"
    return "stable"
  }

  /** Reset for new session */
  reset(): void {
    this.history = []
    this.scoreHistory = []
  }

  /** Get alignment history */
  getHistory(): AlignmentCheck[] {
    return [...this.history]
  }

  /** Summary for dashboard */
  getSummary(): string {
    const last = this.scoreHistory[this.scoreHistory.length - 1] ?? 1
    const trend = this.getAlignmentTrend()
    const avg = this.scoreHistory.length > 0
      ? Math.round((this.scoreHistory.reduce((a, b) => a + b, 0) / this.scoreHistory.length) * 100)
      : 100
    return `Alignment: ${Math.round(last * 100)}% (avg ${avg}%, trend=${trend})`
  }

  /** Map numeric score to severity level */
  private scoreToSeverity(score: number): AlignmentSeverity {
    if (score >= this.config.driftThreshold) return "aligned"
    if (score >= this.config.blockThreshold) return "drift_warning"
    if (score > 0) return "drift_error"
    return "misaligned"
  }
}
