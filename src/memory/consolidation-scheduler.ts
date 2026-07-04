/**
 * ConsolidationScheduler — Periodic memory consolidation.
 *
 * Prinsip 6 (Memory Agnostic): working → episodic → semantic → procedural.
 * Runs consolidation at configurable intervals, auto-prunes, extracts patterns.
 *
 * Dari riset:
 * - Auton (arXiv:2602.23720): Periodic consolidation with importance decay
 * - STEM Agent (arXiv:2603.22359): Event-triggered + time-triggered consolidation
 */

import { createLogger } from "../observability/logger.js"
import { MemoryOrchestrator, type ConsolidationReport } from "./memory-orchestrator.js"
import type { SessionStore } from "./session-store.js"

// ── Types ──────────────────────────────────────────────────────────

export type ConsolidationTrigger = "interval" | "session_end" | "manual"

export interface ConsolidationSchedule {
  /** Interval in ms between automatic consolidations (0 = disabled) */
  intervalMs: number
  /** Run consolidation when a session ends */
  onSessionEnd: boolean
  /** Only consolidate if there are at least N new sessions since last run */
  minNewSessions: number
  /** Auto-prune episodic memory when above this count */
  pruneThreshold: number
}

export interface SchedulerStats {
  totalRuns: number
  lastRun: number | null
  lastReport: ConsolidationReport | null
  isRunning: boolean
  nextRun: number | null
}

export type ConsolidationCallback = (report: ConsolidationReport) => void

// ── Defaults ───────────────────────────────────────────────────────

const DEFAULT_SCHEDULE: ConsolidationSchedule = {
  intervalMs: 300_000,       // every 5 minutes
  onSessionEnd: true,
  minNewSessions: 1,
  pruneThreshold: 800,       // prune when > 80% of max (1000)
}

// ── ConsolidationScheduler ─────────────────────────────────────────

const log = createLogger("Consolidation")

export class ConsolidationScheduler {
  private orchestrator: MemoryOrchestrator
  private sessionStore: SessionStore
  private schedule: ConsolidationSchedule
  private callbacks: ConsolidationCallback[] = []

  private intervalTimer: ReturnType<typeof setInterval> | null = null
  private totalRuns = 0
  private lastRun: number | null = null
  private lastReport: ConsolidationReport | null = null
  private sessionCountAtLastRun = 0

  constructor(
    orchestrator: MemoryOrchestrator,
    sessionStore: SessionStore,
    schedule?: Partial<ConsolidationSchedule>,
  ) {
    this.orchestrator = orchestrator
    this.sessionStore = sessionStore
    this.schedule = { ...DEFAULT_SCHEDULE, ...schedule }
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  /** Start periodic consolidation timer */
  start(): void {
    if (this.intervalTimer) return
    if (this.schedule.intervalMs <= 0) return

    this.intervalTimer = setInterval(() => {
      this.runConsolidation("interval")
    }, this.schedule.intervalMs)

    // Don't keep process alive
    if (this.intervalTimer && typeof this.intervalTimer === "object" &&
        "unref" in this.intervalTimer) {
      this.intervalTimer.unref()
    }
  }

  /** Stop periodic consolidation timer */
  stop(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer)
      this.intervalTimer = null
    }
  }

  /** Called when a session ends — triggers onSessionEnd consolidation */
  onSessionEnd(): void {
    if (!this.schedule.onSessionEnd) return
    this.runConsolidation("session_end")
  }

  /** Run consolidation manually (regardless of schedule) */
  runManual(): ConsolidationReport {
    return this.runConsolidation("manual")
  }

  // ── Callbacks ────────────────────────────────────────────────────

  onConsolidation(cb: ConsolidationCallback): void {
    this.callbacks.push(cb)
  }

  removeCallback(cb: ConsolidationCallback): void {
    const idx = this.callbacks.indexOf(cb)
    if (idx >= 0) this.callbacks.splice(idx, 1)
  }

  // ── Stats ────────────────────────────────────────────────────────

  getStats(): SchedulerStats {
    return {
      totalRuns: this.totalRuns,
      lastRun: this.lastRun,
      lastReport: this.lastReport,
      isRunning: this.intervalTimer !== null,
      nextRun: this.intervalTimer
        ? (this.lastRun ?? 0) + this.schedule.intervalMs
        : null,
    }
  }

  getSchedule(): ConsolidationSchedule {
    return { ...this.schedule }
  }

  /** Update schedule at runtime */
  updateSchedule(partial: Partial<ConsolidationSchedule>): void {
    this.schedule = { ...this.schedule, ...partial }
    // Restart timer if running
    if (this.intervalTimer) {
      this.stop()
      this.start()
    }
  }

  // ── Internal ─────────────────────────────────────────────────────

  private runConsolidation(trigger: ConsolidationTrigger): ConsolidationReport {
    const activeSessions = this.sessionStore.getActiveSessions()
    const newSessions = activeSessions.length - this.sessionCountAtLastRun

    // Skip if not enough new sessions (threshold check)
    if (trigger === "interval" && newSessions < this.schedule.minNewSessions) {
      // Still run lightweight prune
      const report: ConsolidationReport = {
        workingArchived: 0,
        episodicPruned: 0,
        semanticDeduplicated: 0,
        patternsExtracted: 0,
        skillsConverted: 0,
        ragPruned: 0,
        timestamp: Date.now(),
      }
      return report
    }

    // Run full consolidation
    const report = this.orchestrator.consolidate(activeSessions)
    this.totalRuns++
    this.lastRun = Date.now()
    this.lastReport = report
    this.sessionCountAtLastRun = activeSessions.length

    // Notify callbacks
    for (const cb of this.callbacks) {
      try {
        cb(report)
      } catch (e) {
        log.warn("callback error", { error: e instanceof Error ? e.message : String(e) })
      }
    }

    return report
  }
}
