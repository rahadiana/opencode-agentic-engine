/**
 * dag-helpers.ts — Pure helper functions extracted from DAGEngine.
 *
 * Extracted for testability and separation of concerns.
 * All functions are pure (no dependency on `this` or DAGEngine instance state).
 */

import type { Subtask } from "./intent-parser.js"
import type { DAGNodeType, DAGExecutionContext, RetryStrategy } from "./dag-engine.js"

// ── Constants ──────────────────────────────────────────────────────

export const LOOP_DETECTION_WINDOW_MS = 60_000
export const LOOP_DETECTION_MAX_IDENTICAL = 5

// ── Backoff ─────────────────────────────────────────────────────────

/** Compute backoff delay based on retry strategy */
export function computeBackoff(strategy: RetryStrategy, attempt: number): number {
  switch (strategy) {
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

// ── Summary ─────────────────────────────────────────────────────────

/** Build execution summary string from context */
export function buildSummary(context: DAGExecutionContext, prevCompleted: number, totalTime: number): string {
  const total = context.plan.nodes.length
  let completed = 0
  let failed = 0
  for (const state of context.nodeStates.values()) {
    if (state.status === "completed") completed++
    if (state.status === "failed") failed++
  }
  const newDone = completed - prevCompleted
  return `DAG: ${completed}/${total} nodes, ${failed} failed, ${newDone} new in ${totalTime}ms` +
    (context.circuitBreakerTripped ? " [CIRCUIT BREAKER TRIPPED]" : "")
}

// ── Node Type Inference ─────────────────────────────────────────────

/** Infer node type from description */
export function inferNodeType(subtask: Subtask): DAGNodeType {
  const desc = subtask.description.toLowerCase()
  if (/verify|compile|test|check|lint/i.test(desc)) return "verify"
  if (/plan|design|architecture/i.test(desc)) return "plan"
  if (/analyze|debug|reflect|investigate/i.test(desc)) return "reflect"
  if (/delegate|assign|orchestrat/i.test(desc)) return "delegate"
  return "execute"
}

// ── Loop Detection ──────────────────────────────────────────────────

/** Loop detection: hash-based rolling window */
export function detectLoop(context: DAGExecutionContext, nodeId: string): boolean {
  const now = Date.now()
  const hash = `${nodeId}`
  context.callHistory.push({ nodeId, ts: now, hash })

  // Prune old entries
  const window = context.callHistory.filter(c => now - c.ts < LOOP_DETECTION_WINDOW_MS)
  context.callHistory.length = 0
  context.callHistory.push(...window)

  const identical = window.filter(c => c.hash === hash).length
  return identical > LOOP_DETECTION_MAX_IDENTICAL
}
