/**
 * ErrorRecovery — Gap #5: Self-healing error recovery framework.
 *
 * From paper (Section 5.2): "Error propagation — a small error in an early
 * commit cascades into compounding failures." Maps error categories to
 * recovery strategies with automatic circuit breaker escalation.
 *
 * ponytail: One file, extends existing auto-retry.ts + error-analyzer.ts
 * patterns. Does NOT replace them — adds escalation + recovery tracking.
 */

import type { ErrorAnalysis } from "./error-analyzer.js"

// ── Types ──────────────────────────────────────────────────────

export type RecoveryAction =
  | "retry_same"        // Coba ulang dengan strategi sama
  | "retry_different"   // Ganti strategi
  | "rollback_file"     // Rollback file spesifik
  | "rollback_all"      // Rollback semua (reset ke checkpoint)
  | "split_step"        // Pecah step menjadi lebih kecil
  | "escalate"          // Butuh intervensi manusia
  | "skip"              // Skip step ini (non-critical)
  | "replan"            // Butuh replanning ulang

export interface RecoveryPlan {
  action: RecoveryAction
  reason: string
  target?: string       // File atau step target
  retryStrategy?: string
  priority: number      // 1=immediately, 2=soon, 3=eventually
}

export interface RecoveryRecord {
  stepId: string
  errorCategory: string
  attemptedActions: RecoveryAction[]
  finalAction: RecoveryAction
  success: boolean
  durationMs: number
  errorCount: number
  timestamp: number
}

export interface ErrorRecoveryConfig {
  maxRetriesPerCategory: number      // Max retries sebelum escalate
  circuitBreakerThreshold: number    // Consecutive failures before escalate
  enableAutoRollback: boolean
  enableSplitStep: boolean
  enableSkip: boolean
}

// ── Defaults ───────────────────────────────────────────────────

const DEFAULT_CONFIG: ErrorRecoveryConfig = {
  maxRetriesPerCategory: 3,
  circuitBreakerThreshold: 5,
  enableAutoRollback: true,
  enableSplitStep: true,
  enableSkip: false,
}

// ── Category → Recovery Strategy Map ──────────────────────────

/** ponytail: simple map, not a full rule engine */
const CATEGORY_RECOVERY: Record<string, RecoveryAction[]> = {
  import:    ["retry_different", "retry_same", "rollback_file", "escalate"],
  type:      ["retry_different", "retry_same", "rollback_file", "escalate"],
  compile:   ["retry_different", "retry_same", "rollback_file", "escalate"],
  test:      ["retry_same", "split_step", "rollback_file", "escalate"],
  runtime:   ["retry_different", "rollback_file", "rollback_all", "escalate"],
  unknown:   ["retry_same", "rollback_file", "escalate", "replan"],
}

// ── ErrorRecovery Class ───────────────────────────────────────

export class ErrorRecovery {
  private config: ErrorRecoveryConfig
  private records: RecoveryRecord[] = []
  private categoryFailCount: Map<string, number> = new Map()
  private consecutiveFailures = 0

  constructor(config?: Partial<ErrorRecoveryConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /** Generate recovery plan from error analysis */
  getRecoveryPlan(analysis: ErrorAnalysis | null, _stepId: string, attempt: number): RecoveryPlan {
    const category = analysis?.category ?? "unknown"
    const options = CATEGORY_RECOVERY[category] ?? CATEGORY_RECOVERY.unknown
    const severity = analysis?.severity ?? "medium"

    // Increase fail count for this category
    this.categoryFailCount.set(category, (this.categoryFailCount.get(category) ?? 0) + 1)
    this.consecutiveFailures++

    // Circuit breaker: escalate if too many consecutive failures
    if (this.consecutiveFailures >= this.config.circuitBreakerThreshold) {
      return { action: "escalate", reason: `Circuit breaker: ${this.consecutiveFailures} consecutive failures`, priority: 1 }
    }

    // Too many retries for this category → escalate
    if (attempt > this.config.maxRetriesPerCategory) {
      return { action: "escalate", reason: `Max retries (${this.config.maxRetriesPerCategory}) for category "${category}"`, priority: 1 }
    }

    // Rotate through options by attempt number (1-indexed)
    const index = (attempt - 1) % options.length
    const action = options[index]

    return { action, reason: `Category "${category}" attempt ${attempt} → ${action}`, priority: severity === "critical" ? 1 : 2 }
  }

  /** Record outcome of a recovery attempt */
  recordOutcome(stepId: string, analysis: ErrorAnalysis | null, attempted: RecoveryAction[], final: RecoveryAction, success: boolean): RecoveryRecord {
    const record: RecoveryRecord = {
      stepId,
      errorCategory: analysis?.category ?? "unknown",
      attemptedActions: attempted,
      finalAction: final,
      success,
      durationMs: 0, // filled by caller if desired
      errorCount: this.categoryFailCount.get(analysis?.category ?? "unknown") ?? 1,
      timestamp: Date.now(),
    }
    if (this.records.length >= 100) this.records.shift() // ponytail: bounded history
    this.records.push(record)

    if (success) {
      this.consecutiveFailures = 0
      this.categoryFailCount.set(analysis?.category ?? "unknown", 0)
    }
    return record
  }

  /** Get recovery history */
  getHistory(stepId?: string): RecoveryRecord[] {
    if (stepId) return this.records.filter(r => r.stepId === stepId)
    return [...this.records]
  }

  /** Get success rate for a category */
  getCategorySuccessRate(category: string): { attempts: number; success: number; rate: number } {
    const catRecords = this.records.filter(r => r.errorCategory === category)
    const attempts = catRecords.length
    const success = catRecords.filter(r => r.success).length
    return { attempts, success, rate: attempts > 0 ? success / attempts : 1 }
  }

  /** Health check: degraded if any category has >50% failure */
  getHealth(): "healthy" | "degraded" | "critical" {
    if (this.consecutiveFailures >= this.config.circuitBreakerThreshold) return "critical"
    const degradedCategories = [...this.categoryFailCount.entries()].filter(([_, count]) => count >= this.config.maxRetriesPerCategory)
    if (degradedCategories.length > 0) return "degraded"
    return "healthy"
  }

  /** Reset state */
  reset(): void {
    this.records = []
    this.categoryFailCount.clear()
    this.consecutiveFailures = 0
  }

  /** Summary for dashboard */
  getSummary(): string {
    const health = this.getHealth()
    const total = this.records.length
    const successCount = this.records.filter(r => r.success).length
    const rate = total > 0 ? Math.round((successCount / total) * 100) : 100
    const failingCats = [...this.categoryFailCount.entries()].filter(([_, c]) => c > 0).map(([c, n]) => `${c}(${n})`).join(", ")
    return `Recovery: ${total} attempt(s), ${rate}% success, health=${health}${failingCats ? `, failing=[${failingCats}]` : ""}`
  }
}
