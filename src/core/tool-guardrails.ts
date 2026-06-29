/**
 * Tool Guardrails — Loop detection for agent execution steps.
 *
 * Detects execution patterns that indicate the agent is stuck:
 *   1. Exact repeat — same step re-executed with identical error
 *   2. Same-step failure — step failed N+ times regardless of error
 *   3. Idempotent no-progress — read-only step produced identical result
 *
 * Tracks per-step signals across retries and issues warn/block/halt
 * decisions at configurable thresholds. Inspired by Hermes Agent's
 * ``ToolCallGuardrailController`` (agent/tool_guardrails.py).
 *
 * The "tool" in opencode-agentic-engine context = a DAG Step. Each step
 * is executed by the agent-loop which wraps stepExecutor. Guardrails
 * detect infinite retry loops before they consume the token budget.
 */

import { createLogger } from "../observability/logger.js"

const log = createLogger("ToolGuardrails")

// ── Types ──────────────────────────────────────────────────────────

export interface ToolGuardrailConfig {
  /** Master kill-switch — set false to disable all guardrails */
  enabled: boolean
  /** Warn after N identical (same step + same error message) retries */
  exactRepeatWarn: number
  /** Block after N identical retries (0 = never block) */
  exactRepeatBlock: number
  /** Warn after N consecutive failures for the same step (any error) */
  sameStepFailWarn: number
  /** Block after N consecutive same-step failures */
  sameStepFailBlock: number
  /** Block after N identical read-only results (idempotent tools only) */
  idempotentNoProgressBlock: number
  /** Hard stop: block means agent loop exits immediately */
  hardStop: boolean
}

export interface GuardrailDecision {
  action: "allow" | "warn" | "block" | "halt"
  code: string
  message: string
  signal: "none" | "exact-repeat" | "same-step-fail" | "idempotent-no-progress"
}

export const DEFAULT_GUARDRAIL_CONFIG: ToolGuardrailConfig = {
  enabled: true,
  exactRepeatWarn: 2,
  exactRepeatBlock: 5,
  sameStepFailWarn: 3,
  sameStepFailBlock: 8,
  idempotentNoProgressBlock: 3,
  hardStop: false,
}

// ── Helpers ────────────────────────────────────────────────────────

/** Stable key for identical step + error — used for exact-repeat detection */
function exactRepeatKey(stepId: string, error: string): string {
  const normalized = error.slice(0, 200).replace(/\s+/g, " ").trim()
  return `${stepId}::${normalized}`
}

/** Check if a step is idempotent (read-only, no file modifications) */
function isIdempotent(filesModified: string[]): boolean {
  return filesModified.length === 0
}

// ── Controller ─────────────────────────────────────────────────────

export class ToolGuardrailController {
  private config: ToolGuardrailConfig
  private exactRepeatCount = new Map<string, number>()
  private sameStepFailCount = new Map<string, number>()
  private idempotentResults = new Map<string, string>()
  private activeWarnings = new Set<string>()
  private halted = false

  constructor(config: Partial<ToolGuardrailConfig> = {}) {
    this.config = { ...DEFAULT_GUARDRAIL_CONFIG, ...config }
  }

  /** Reset all per-turn counters — call at agent loop start */
  resetForTurn(): void {
    this.exactRepeatCount.clear()
    this.sameStepFailCount.clear()
    this.idempotentResults.clear()
    this.activeWarnings.clear()
    this.halted = false
  }

  /** Check if the controller is currently halted */
  get isHalted(): boolean {
    return this.halted
  }

  /**
   * Called BEFORE executing a step. Returns a decision: allow, warn, block.
   * If block/halt, the agent loop should NOT execute the step.
   */
  beforeCall(stepId: string, error?: string): GuardrailDecision {
    if (!this.config.enabled || this.config.hardStop && this.halted) {
      return { action: "allow", code: "disabled", message: "", signal: "none" }
    }

    // 1. Exact-repeat: check if this step+error combo was seen before
    if (error) {
      const key = exactRepeatKey(stepId, error)
      const count = (this.exactRepeatCount.get(key) ?? 0) + 1
      this.exactRepeatCount.set(key, count)

      if (this.config.hardStop && count >= this.config.exactRepeatBlock && this.config.exactRepeatBlock > 0) {
        this.halted = true
        return {
          action: "halt",
          code: "exact-repeat-halt",
          signal: "exact-repeat",
          message: `Step "${stepId}" has failed ${count} times with the same error (${error.slice(0, 80)}). The agent loop is stuck — halting turn.`,
        }
      }
      if (count >= this.config.exactRepeatBlock && this.config.exactRepeatBlock > 0) {
        return {
          action: "block",
          code: "exact-repeat-block",
          signal: "exact-repeat",
          message: `Step "${stepId}" has failed ${count} times with the same error (${error.slice(0, 80)}). Blocking retry — agent must change approach.`,
        }
      }
      if (count >= this.config.exactRepeatWarn) {
        this.activeWarnings.add(key)
        return {
          action: "warn",
          code: "exact-repeat-warn",
          signal: "exact-repeat",
          message: `Step "${stepId}" has failed ${count} times with the same error. Consider a different approach.`,
        }
      }
    }

    // 2. Same-step failure: check consecutive failures for this step
    if (error) {
      const count = (this.sameStepFailCount.get(stepId) ?? 0) + 1
      this.sameStepFailCount.set(stepId, count)

      if (this.config.hardStop && count >= this.config.sameStepFailBlock && this.config.sameStepFailBlock > 0) {
        this.halted = true
        return {
          action: "halt",
          code: "same-step-halt",
          signal: "same-step-fail",
          message: `Step "${stepId}" has failed ${count} consecutive times. The entire turn is being halted to prevent infinite retry.`,
        }
      }
      if (count >= this.config.sameStepFailBlock && this.config.sameStepFailBlock > 0) {
        return {
          action: "block",
          code: "same-step-block",
          signal: "same-step-fail",
          message: `Step "${stepId}" has failed ${count} consecutive times. Blocking retry — analyze the root cause first.`,
        }
      }
      if (count >= this.config.sameStepFailWarn) {
        return {
          action: "warn",
          code: "same-step-warn",
          signal: "same-step-fail",
          message: `Step "${stepId}" has failed ${count} consecutive times. Consider escalating or replanning.`,
        }
      }
    }

    return { action: "allow", code: "ok", message: "", signal: "none" }
  }

  /**
   * Called AFTER executing a step. Updates idempotent result tracking.
   * For failed steps, passes the error to the failure counters.
   */
  afterCall(
    stepId: string,
    success: boolean,
    output: string,
    filesModified: string[],
  ): void {
    if (!this.config.enabled) return

    // Reset same-step failure counter on success
    if (success) {
      this.sameStepFailCount.delete(stepId)
    }

    // 3. Idempotent no-progress: track read-only steps returning same result
    if (success && isIdempotent(filesModified) && output) {
      const hash = simpleHash(output.slice(0, 500))
      const prev = this.idempotentResults.get(stepId)
      if (prev === hash) {
        // Same result as last time — track it
        const countKey = `idempotent:${stepId}`
        const count = (this.exactRepeatCount.get(countKey) ?? 0) + 1
        this.exactRepeatCount.set(countKey, count)

        if (count >= this.config.idempotentNoProgressBlock && this.config.idempotentNoProgressBlock > 0) {
          log.warn(
            `[Guardrails] Step "${stepId}" returned same result ${count} times — idempotent-no-progress detected`,
          )
        }
      }
      this.idempotentResults.set(stepId, hash)
    }
  }

  /**
   * Check idempotent no-progress after the fact and return a decision.
   * Separate from beforeCall because we need the output to compare.
   */
  checkIdempotent(stepId: string): GuardrailDecision {
    const countKey = `idempotent:${stepId}`
    const count = this.exactRepeatCount.get(countKey) ?? 0

    if (count >= this.config.idempotentNoProgressBlock && this.config.idempotentNoProgressBlock > 0) {
      if (this.config.hardStop) {
        this.halted = true
        return {
          action: "halt",
          code: "idempotent-halt",
          signal: "idempotent-no-progress",
          message: `Step "${stepId}" produced the same result ${count} times without modifying files. No progress being made — halting turn.`,
        }
      }
      return {
        action: "block",
        code: "idempotent-block",
        signal: "idempotent-no-progress",
        message: `Step "${stepId}" produced the same result ${count} times without modifying files. The agent is not making progress.`,
      }
    }
    return { action: "allow", code: "ok", message: "", signal: "none" }
  }

  /** Update thresholds at runtime */
  updateConfig(partial: Partial<ToolGuardrailConfig>): void {
    this.config = { ...this.config, ...partial }
  }

  /** Get current config */
  getConfig(): ToolGuardrailConfig {
    return { ...this.config }
  }
}

// ── Simple hash for output comparison ──────────────────────────────

function simpleHash(s: string): string {
  let hash = 0
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0
  }
  return hash.toString(36)
}
