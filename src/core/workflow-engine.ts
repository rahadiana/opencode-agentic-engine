/**
 * WorkflowEngine — Event-driven tool chaining.
 *
 * Menjawab gap: tools punya banyak kemampuan tapi gak saling integrasi.
 * WorkflowEngine dengerin EventBus dan auto-chain tool execution:
 *
 *   step.completed  → auto-check plan → suggest next ready step(s)
 *   step.failed     → auto-track retry → suggest recovery
 *   task.completed  → auto-advance pipeline
 */

import { EventBus } from "./event-bus.js"
import type { SessionStore } from "../memory/session-store.js"
import type { Orchestrator } from "../agents/orchestrator.js"
import type { AgenticEvent } from "./event-taxonomy.js"

export interface WorkflowConfig {
  eventBus: EventBus
  sessionStore: SessionStore
  orchestrator?: Orchestrator
}

export interface ChainedResult {
  /** Steps yang siap di-execute (dependensinya terpenuhi) */
  nextSteps: string[]
  /** Recovery steps yang dibuat (untuk failed steps) */
  recoverySteps: string[]
  /** Pipeline stages yang di-advance */
  advancedStages: string[]
}

export class WorkflowEngine {
  private eventBus: EventBus
  private sessionStore: SessionStore
  private orchestrator?: Orchestrator

  /** Track retry counts per step */
  private retryCounts = new Map<string, number>()
  private maxRetries = 3

  /** Unsubscribe functions */
  private unsubscribers: Array<() => void> = []

  constructor(config: WorkflowConfig) {
    this.eventBus = config.eventBus
    this.sessionStore = config.sessionStore
    this.orchestrator = config.orchestrator

    this._subscribe()
  }

  /** Subscribe ke EventBus events */
  private _subscribe(): void {
    this.unsubscribers.push(
      this.eventBus.on("step.completed", (ev) => this._onStepCompleted(ev)),
    )
    this.unsubscribers.push(
      this.eventBus.on("step.failed", (ev) => this._onStepFailed(ev)),
    )
    this.unsubscribers.push(
      this.eventBus.on("task.completed", (ev) => this._onTaskCompleted(ev)),
    )
  }

  /** Unsubscribe semua listener */
  dispose(): void {
    for (const unsub of this.unsubscribers) {
      unsub()
    }
    this.unsubscribers = []
    this.retryCounts.clear()
  }

  // ── Public API: relay events dari tool handlers ──

  /**
   * Relay step result dari agentic_execute.
   * Emit event yg sesuai (step.completed / step.failed).
   * Returns ChainedResult with suggestions.
   */
  relayStep(
    sessionId: string,
    stepId: string,
    success: boolean,
    output: string,
    filesModified: string[],
    error?: string,
    durationMs?: number,
  ): ChainedResult {
    const result: ChainedResult = { nextSteps: [], recoverySteps: [], advancedStages: [] }
    this._currentResult = result

    const base = {
      sessionID: sessionId,
      stepId,
      output,
      filesModified,
      durationMs: durationMs ?? 0,
    }

    if (success) {
      this.eventBus.emit({
        type: "step.completed",
        payload: { ...base, success: true as const },
      } as AgenticEvent)
    } else {
      this.eventBus.emit({
        type: "step.failed",
        payload: {
          ...base,
          error: error ?? output,
          errorCategory: "unknown" as const,
        },
      } as AgenticEvent)
    }

    this._currentResult = undefined
    return result
  }

  /**
   * Relay delegation result dari agentic_delegate.
   */
  relayDelegation(
    sessionId: string,
    taskId: string,
    role: string,
    success: boolean,
    result?: string,
    pipelineRunId?: string,
  ): ChainedResult {
    const chained: ChainedResult = { nextSteps: [], recoverySteps: [], advancedStages: [] }
    this._currentResult = chained

    this.eventBus.emit({
      type: "task.completed",
      payload: {
        sessionID: sessionId,
        taskId,
        role,
        result: result ?? "",
        success,
        pipelineRunId,
      },
    } as AgenticEvent)

    this._currentResult = undefined
    return chained
  }

  /** Dapatkan status chain saat ini */
  getStatus(): { retryEntries: number } {
    return { retryEntries: this.retryCounts.size }
  }

  // ── Event Handlers ──

  /** Step berhasil → cek plan → suggest next ready step */
  private _onStepCompleted(ev: AgenticEvent): void {
    const p = (ev as any).payload
    if (!p?.sessionID || !p?.stepId) return

    const plan = this.sessionStore.getOrCreate(p.sessionID).plan
    if (!plan || !(plan as any).steps || (plan as any).steps.length === 0) return

    const steps = (plan as any).steps as Array<{ id: string; status?: string; dependsOn?: string[] }>

    // Tandai step selesai
    const current = steps.find((s: any) => s.id === p.stepId)
    if (current) current.status = "completed"

    // Cari step berikutnya yang dependensinya terpenuhi
    const ready = steps.filter((s: any) => {
      if (s.status === "completed" || s.status === "running") return false
      if (!s.dependsOn || s.dependsOn.length === 0) return true
      return s.dependsOn.every((depId: string) => {
        const dep = steps.find((ds: any) => ds.id === depId)
        return dep?.status === "completed"
      })
    })

    if (ready.length > 0 && this._currentResult) {
      this._currentResult.nextSteps.push(...ready.map((s: any) => s.id))
    }
  }

  /** Step gagal → track retry → suggest recovery */
  private _onStepFailed(ev: AgenticEvent): void {
    const p = (ev as any).payload
    if (!p?.sessionID || !p?.stepId) return

    const retryKey = `${p.sessionID}::${p.stepId}`
    const currentRetries = this.retryCounts.get(retryKey) ?? 0

    if (currentRetries < this.maxRetries) {
      this.retryCounts.set(retryKey, currentRetries + 1)
      if (this._currentResult) {
        this._currentResult.recoverySteps.push(`${p.stepId}-recovery-${currentRetries + 1}`)
      }
    }
  }

  /** Task selesai → auto-advance pipeline */
  private _onTaskCompleted(ev: AgenticEvent): void {
    const p = (ev as any).payload
    if (!p?.sessionID || !p?.pipelineRunId || !this.orchestrator) return
    if (this._currentResult) {
      this._currentResult.advancedStages.push(p.pipelineRunId)
    }
  }

  // ── Internal ──

  private _currentResult: ChainedResult | undefined
}
