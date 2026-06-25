/**
 * ExecutionTracer — standalone trace management subsystem.
 *
 * Extracted from MemoryOrchestrator for cleaner separation of concerns.
 * Tracks ExecutionStep/ExecutionTrace records with LRU eviction.
 */

import type { MemoryLevel, MemoryEntry, ExecutionStep, ExecutionTrace } from "./memory-orchestrator.js"

export class ExecutionTracer {
  private traces: ExecutionTrace[] = []
  private maxTraces: number

  constructor(maxTraces: number = 200) {
    this.maxTraces = maxTraces
  }

  trackExecution(trace: ExecutionTrace): void {
    const existing = this.traces.findIndex(t => t.id === trace.id)
    if (existing >= 0) {
      this.traces[existing] = trace
    } else {
      this.traces.push(trace)
    }

    if (this.traces.length > this.maxTraces) {
      const sorted = [...this.traces].sort((a, b) =>
        (a.completedAt ?? a.startedAt) - (b.completedAt ?? b.startedAt)
      )
      this.traces = sorted.slice(-this.maxTraces)
    }
  }

  getExecutionTrace(id: string): ExecutionTrace | undefined {
    return this.traces.find(t => t.id === id)
  }

  getSessionTraces(sessionId: string): ExecutionTrace[] {
    return this.traces.filter(t => t.sessionId === sessionId)
  }

  getAllTraces(): ExecutionTrace[] {
    return [...this.traces]
  }

  tracesToProceduralEntries(): MemoryEntry[] {
    return this.traces.map(trace => ({
      id: `trace-${trace.id}`,
      level: "procedural" as MemoryLevel,
      content: `Execution: ${trace.goal} — ${trace.outcome} (${trace.steps.filter(s => s.status === "success").length}/${trace.steps.length} steps, ${trace.steps.length} total)`,
      keywords: [
        ...trace.goal.split(/\s+/).filter(w => w.length > 3),
        trace.outcome,
        "execution_trace",
        ...trace.steps.map(s => s.description.split(/\s+/).filter(w => w.length > 3)).flat().slice(0, 5),
      ],
      importance: trace.outcome === "success" ? 0.9 : trace.outcome === "partial" ? 0.6 : 0.3,
      createdAt: trace.startedAt,
      lastAccessed: trace.completedAt ?? trace.startedAt,
      accessCount: 0,
      sourceSession: trace.sessionId,
      metadata: {
        type: "execution_trace",
        stepCount: trace.steps.length,
        outcome: trace.outcome,
        tokensUsed: trace.tokensUsed,
        costUsd: trace.costUsd,
        modelUsed: trace.modelUsed,
        stepStatuses: trace.steps.map(s => `${s.stepId}:${s.status}`).join(","),
      },
    }))
  }

  beginStep(traceId: string, sessionId: string, goal: string, stepId: string, description: string): void {
    let trace = this.traces.find(t => t.id === traceId)
    if (!trace) {
      trace = {
        id: traceId,
        sessionId,
        goal,
        steps: [],
        startedAt: Date.now(),
        outcome: "running",
      }
      this.traces.push(trace)
    }
    const existingIdx = trace.steps.findIndex(s => s.stepId === stepId)
    if (existingIdx >= 0) {
      trace.steps.splice(existingIdx, 1)
    }
    trace.steps.push({
      stepId,
      description,
      status: "running",
      startedAt: Date.now(),
      retries: 0,
    })
  }

  completeStep(
    traceId: string,
    stepId: string,
    status: "success" | "failed",
    error?: string,
    confidence?: number,
  ): { trace?: ExecutionTrace; step?: ExecutionStep; justCompleted: boolean } {
    const trace = this.traces.find(t => t.id === traceId)
    if (!trace) return { justCompleted: false }

    const step = trace.steps.find(s => s.stepId === stepId)
    if (!step) return { justCompleted: false }

    step.status = status
    step.completedAt = Date.now()
    if (error) step.error = error
    if (confidence !== undefined) step.confidence = confidence

    const allDone = trace.steps.every(s => s.status === "success" || s.status === "failed")
    if (allDone) {
      trace.completedAt = Date.now()
      const successCount = trace.steps.filter(s => s.status === "success").length
      if (successCount === trace.steps.length) {
        trace.outcome = "success"
      } else if (successCount > 0) {
        trace.outcome = "partial"
      } else {
        trace.outcome = "failed"
      }
      return { trace, step, justCompleted: true }
    }
    return { trace, step, justCompleted: false }
  }
}
