/**
 * RecoveryLayer — Graph Harness §3.3: Strict escalation protocol for failures.
 *
 * Paper ref: arXiv:2604.11378 (Graph Harness)
 *   Commitment 3: Recovery follows a strict escalation protocol.
 *
 * Escalation chain:
 *   1. Retry node (with backoff) — first line of defense
 *   2. Replan node — if retry fails, try alternative approach
 *   3. Escalate to human — if replan fails, escalate
 *
 * Each level has configurable max attempts before moving to next.
 * Recovery decisions are traceable (stored in RecoveryRecord).
 */

import type { Subtask } from "./intent-parser.js"
import type { DAGExecutionContext, DAGNode, RetryStrategy } from "./dag-engine.js"

/** Current recovery level in escalation chain */
export type RecoveryLevel = "none" | "retry" | "replan" | "escalate"

/** Result of a recovery attempt */
export type RecoveryStatus = "resolved" | "retrying" | "replanning" | "escalated" | "skipped"

/** Record of a recovery event — traceable for debugging */
export interface RecoveryRecord {
  nodeId: string
  timestamp: number
  level: RecoveryLevel
  status: RecoveryStatus
  error: string
  attemptedFix?: string
  retryCount: number
  nextAction?: string
}

export interface RecoveryLayerConfig {
  /** Max retry attempts per node before replanning (default: 3) */
  maxRetries: number
  /** Max replan attempts per node before escalation (default: 2) */
  maxReplans: number
  /** Retry backoff strategy (default: "exponential") */
  retryStrategy: RetryStrategy
  /** Whether to attempt replan via LLM when retries exhausted */
  autoReplan: boolean
  /** Whether to auto-escalate when replan exhausted */
  autoEscalate: boolean
  /** Max recovery history entries before LRU eviction (default: 500) */
  maxHistorySize?: number
}

export interface ReplanResult {
  newSubtasks: Subtask[]
  summary: string
}

/** Recovery decision for a failed node */
export interface RecoveryDecision {
  level: RecoveryLevel
  action: "retry" | "replan" | "escalate" | "skip"
  reason: string
  delayMs: number
}

const DEFAULT_CONFIG: RecoveryLayerConfig = {
  maxRetries: 3,
  maxReplans: 2,
  retryStrategy: "exponential",
  autoReplan: true,
  autoEscalate: true,
}

/**
 * RecoveryLayer — handles node failures with strict escalation.
 *
 * Graph Harness §3.3:
 *   "Recovery follows a strict escalation protocol: retry → replan → escalate.
 *    This makes recovery decisions inspectable and debuggable,
 *    unlike the opaque recovery loops of traditional Agent Loops."
 */
export class RecoveryLayer {
  private config: RecoveryLayerConfig
  private recoveryHistory: RecoveryRecord[] = []
  private maxHistorySize: number

  constructor(config?: Partial<RecoveryLayerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.maxHistorySize = config?.maxHistorySize ?? 500
  }

  /**
   * Decide the next recovery action for a failed node.
   * Follows the escalation protocol:
   *   1. If retries remaining → retry
   *   2. If retries exhausted, replans remaining → replan
   *   3. Otherwise → escalate
   */
  decide(node: DAGNode, context: DAGExecutionContext, error: string): RecoveryDecision {
    const state = context.nodeStates.get(node.id)
    const retryCount = state?.retryCount ?? 0
    const pastRecoveries = this.getRecoveries(node.id)

    // Level 1: Retry
    if (retryCount < this.config.maxRetries) {
      const delay = this.computeDelay(retryCount + 1)
      this.record(node.id, "retry", "retrying", error, retryCount, `Retry ${retryCount + 1}/${this.config.maxRetries}`)
      return {
        level: "retry",
        action: "retry",
        reason: `Retry ${retryCount + 1}/${this.config.maxRetries} after ${delay}ms backoff`,
        delayMs: delay,
      }
    }

    // Level 2: Replan
    const replanAttempts = pastRecoveries.filter(r => r.level === "replan").length
    if (replanAttempts < this.config.maxReplans && this.config.autoReplan) {
      this.record(node.id, "replan", "replanning", error, retryCount, `Replan ${replanAttempts + 1}/${this.config.maxReplans}`)
      return {
        level: "replan",
        action: "replan",
        reason: `Replan ${replanAttempts + 1}/${this.config.maxReplans} — retries exhausted`,
        delayMs: 100,
      }
    }

    // Level 3: Escalate
    if (this.config.autoEscalate) {
      this.record(node.id, "escalate", "escalated", error, retryCount, "All retries and replans exhausted — escalating")
      return {
        level: "escalate",
        action: "escalate",
        reason: `Escalated after ${retryCount} retries, ${replanAttempts} replans`,
        delayMs: 0,
      }
    }

    // Fallback: skip
    this.record(node.id, "none", "skipped", error, retryCount, "Recovery disabled — skipping")
    return {
      level: "none",
      action: "skip",
      reason: "Recovery not available",
      delayMs: 0,
    }
  }

  /**
   * Generate a replan for a failed node.
   * Uses the error context to create alternative subtasks.
   * This is called by the AgentLoop when decision.action === "replan".
   */
  generateReplan(
    original: Subtask,
    error: string,
    planner?: (description: string, error: string) => Subtask[],
  ): ReplanResult {
    if (planner) {
      const newSubtasks = planner(original.description, error)
      if (newSubtasks.length > 0) {
        return {
          newSubtasks,
          summary: `Replanned "${original.id}" into ${newSubtasks.length} subtasks`,
        }
      }
    }

    // Default replan: split failed node into diagnose → fix → verify
    const newSubtasks: Subtask[] = [
      {
        id: `${original.id}-diagnose`,
        description: `Diagnose failure in ${original.description}: ${error.slice(0, 100)}`,
        dependsOn: original.dependsOn,
        verificationCriteria: [],
      },
      {
        id: `${original.id}-fix`,
        description: `Fix issue in ${original.description} based on diagnosis`,
        dependsOn: [`${original.id}-diagnose`],
        verificationCriteria: [],
      },
      {
        id: `${original.id}-verify`,
        description: `Verify fix for ${original.description}`,
        dependsOn: [`${original.id}-fix`],
        verificationCriteria: [],
      },
    ]

    return {
      newSubtasks,
      summary: `Auto-replanned "${original.id}" into diagnose → fix → verify`,
    }
  }

  /**
   * Get recovery history for a specific node.
   */
  getRecoveries(nodeId: string): RecoveryRecord[] {
    return this.recoveryHistory.filter(r => r.nodeId === nodeId)
  }

  /**
   * Get all recovery records.
   */
  getAllRecoveries(): RecoveryRecord[] {
    return [...this.recoveryHistory]
  }

  /**
   * Get recovery stats for dashboard.
   */
  getStats(): { totalRecoveries: number; byLevel: Record<string, number>; byStatus: Record<string, number> } {
    const byLevel: Record<string, number> = {}
    const byStatus: Record<string, number> = {}

    for (const r of this.recoveryHistory) {
      byLevel[r.level] = (byLevel[r.level] ?? 0) + 1
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1
    }

    return {
      totalRecoveries: this.recoveryHistory.length,
      byLevel,
      byStatus,
    }
  }

  // ── Private ──

  private record(
    nodeId: string,
    level: RecoveryLevel,
    status: RecoveryStatus,
    error: string,
    retryCount: number,
    nextAction?: string,
  ): void {
    this.recoveryHistory.push({
      nodeId,
      timestamp: Date.now(),
      level,
      status,
      error: error.slice(0, 200),
      retryCount,
      nextAction,
    })

    // LRU eviction
    if (this.recoveryHistory.length > this.maxHistorySize) {
      this.recoveryHistory.splice(0, this.recoveryHistory.length - this.maxHistorySize)
    }
  }

  private computeDelay(attempt: number): number {
    switch (this.config.retryStrategy) {
      case "none":
        return 0
      case "linear":
        return Math.min(attempt * 1000, 30_000)
      case "exponential":
        return Math.min(Math.pow(2, attempt) * 500, 30_000)
      default:
        return Math.min(attempt * 1000, 30_000)
    }
  }
}
