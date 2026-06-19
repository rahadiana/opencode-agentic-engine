import type { Subtask } from "./intent-parser.js"
import { Executor } from "./executor.js"
import { Verifier } from "./verifier.js"
import { ErrorAnalyzer } from "./error-analyzer.js"
import { DependencyTracker } from "../drift/dependency-tracker.js"
import { LLMEngine } from "./llm.js"
import { BudgetTracker } from "./budget-tracker.js"

export interface AgentLoopConfig {
  maxIterations: number
  autoRetry: boolean
  maxRetries: number
  verifyAfterEach: boolean
  /** Max parallelism per phase (default: unlimited) */
  maxParallelism?: number
  /** Abort remaining steps in phase if one fails (default: false) */
  abortOnFailure?: boolean
}

export interface LoopResult {
  completedSteps: string[]
  failedSteps: string[]
  totalIterations: number
  success: boolean
  summary: string
}

export interface LoopObserver {
  onStepStart(stepId: string, iteration: number): void
  onStepComplete(stepId: string, success: boolean, output: string): void
  onLoopComplete(result: LoopResult): void
}

export class AgentLoop {
  private config: AgentLoopConfig
  private llm: LLMEngine
  private observers: LoopObserver[] = []
  private budgetTracker?: BudgetTracker

  /** Rolling window for repetition detection */
  private callHistory: Array<{ stepId: string; ts: number; hash: string }> = []
  private readonly WINDOW_MS = 60_000
  private readonly MAX_IDENTICAL_CALLS = 5

  constructor(llm: LLMEngine, config: Partial<AgentLoopConfig> = {}) {
    this.llm = llm
    this.config = {
      maxIterations: config.maxIterations ?? 10,
      autoRetry: config.autoRetry ?? true,
      maxRetries: config.maxRetries ?? 3,
      verifyAfterEach: config.verifyAfterEach ?? true,
      maxParallelism: config.maxParallelism,
      abortOnFailure: config.abortOnFailure ?? false,
    }
  }

  setBudgetTracker(tracker: BudgetTracker): void {
    this.budgetTracker = tracker
  }

  private detectLoop(callKey: string): boolean {
    const now = Date.now()
    this.callHistory.push({ stepId: callKey, ts: now, hash: callKey })
    const window = this.callHistory.filter(c => now - c.ts < this.WINDOW_MS)
    const identical = window.filter(c => c.hash === callKey).length
    return identical > this.MAX_IDENTICAL_CALLS
  }

  addObserver(observer: LoopObserver): void {
    this.observers.push(observer)
  }

  async runLoop(
    sessionId: string,
    executor: Executor,
    verifier: Verifier,
    errorAnalyzer: ErrorAnalyzer,
    depTracker: DependencyTracker,
    projectDir: string,
    stepExecutor: (step: Subtask) => Promise<{ success: boolean; output: string; filesModified: string[]; error?: string }>,
    fixExecutor?: (fix: string) => Promise<boolean>,
  ): Promise<LoopResult> {
    const completedSteps: string[] = []
    const failedSteps: string[] = []
    let iteration = 0
    const filesModifiedMap = new Map<string, string[]>()

    while (iteration < this.config.maxIterations) {
      // Circuit breaker: check budget before each iteration
      if (this.budgetTracker) {
        const sessionExceeded = this.budgetTracker.check("session")
        if (sessionExceeded) {
          return {
            completedSteps, failedSteps, totalIterations: iteration,
            success: false,
            summary: `Budget exceeded (${sessionExceeded.metric}: ${sessionExceeded.current}/${sessionExceeded.limit})`,
          }
        }
      }

      iteration++

      const readySteps = executor.getReadySteps(sessionId)
      if (readySteps.length === 0) break

      // Track progress to detect stalled loops
      const beforeCompleted = completedSteps.length

      // Group ready steps into non-conflicting batches
      const batches = this.batchSteps(readySteps, filesModifiedMap)

      for (const batch of batches) {
        const results = await this.executeBatch(
          batch, sessionId, executor, verifier, errorAnalyzer,
          depTracker, projectDir, stepExecutor, fixExecutor,
        )

        for (const r of results) {
          if (r.filesModified.length > 0) {
            filesModifiedMap.set(r.stepId, r.filesModified)
          }
          if (r.success) {
            completedSteps.push(r.stepId)
          } else {
            failedSteps.push(r.stepId)
          }
        }

        if (this.config.abortOnFailure && results.some(r => !r.success)) break
      }

      // Break if no progress: no new completed steps this iteration
      if (completedSteps.length === beforeCompleted) {
        break
      }
    }

    const result: LoopResult = {
      completedSteps,
      failedSteps,
      totalIterations: iteration,
      success: failedSteps.length === 0,
      summary: `Completed ${completedSteps.length} steps, ${failedSteps.length} failed in ${iteration} iterations.`,
    }

    this.observers.forEach(o => o.onLoopComplete(result))
    return result
  }

  private batchSteps(steps: Subtask[], filesModified: Map<string, string[]>): Subtask[][] {
    if (steps.length <= 1) return [steps]
    if (!this.config.maxParallelism) return [steps] // run all ready steps in one batch

    const batches: Subtask[][] = []
    const used = new Set<string>()

    for (const step of steps) {
      if (used.has(step.id)) continue
      const batch: Subtask[] = [step]
      used.add(step.id)

      for (const other of steps) {
        if (used.has(other.id)) continue
        const conflict = this.hasConflict(step, other, filesModified)
        if (!conflict && batch.length < this.config.maxParallelism) {
          batch.push(other)
          used.add(other.id)
        }
      }
      batches.push(batch)
    }

    return batches
  }

  private hasConflict(a: Subtask, b: Subtask, filesModified: Map<string, string[]>): boolean {
    const normalize = (p: string) => p.replace(/\\/g, "/").replace(/^\.\//, "")
    const filesA = (filesModified.get(a.id) ?? []).map(normalize)
    const filesB = (filesModified.get(b.id) ?? []).map(normalize)
    return filesA.some(f => filesB.includes(f))
  }

  private async executeBatch(
    batch: Subtask[],
    sessionId: string,
    executor: Executor,
    verifier: Verifier,
    errorAnalyzer: ErrorAnalyzer,
    depTracker: DependencyTracker,
    projectDir: string,
    stepExecutor: (step: Subtask) => Promise<{ success: boolean; output: string; filesModified: string[]; error?: string }>,
    fixExecutor?: (fix: string) => Promise<boolean>,
  ): Promise<Array<{ stepId: string; success: boolean; filesModified: string[] }>> {
    if (batch.length <= 1) {
      const step = batch[0]
      const r = await this.executeStepWithRetry(
        step, sessionId, executor, verifier, errorAnalyzer,
        depTracker, projectDir, stepExecutor, fixExecutor, 0,
      )
      return [r]
    }

    const settled = await Promise.allSettled(
      batch.map(step =>
        this.executeStepWithRetry(
          step, sessionId, executor, verifier, errorAnalyzer,
          depTracker, projectDir, stepExecutor, fixExecutor, 0,
        ),
      ),
    )
    return settled.map((s, i) => {
      if (s.status === "fulfilled") return s.value
      return { stepId: batch[i].id, success: false, filesModified: [] }
    })
  }

  private async executeStepWithRetry(
    step: Subtask,
    sessionId: string,
    executor: Executor,
    verifier: Verifier,
    errorAnalyzer: ErrorAnalyzer,
    depTracker: DependencyTracker,
    projectDir: string,
    stepExecutor: (step: Subtask) => Promise<{ success: boolean; output: string; filesModified: string[]; error?: string }>,
    fixExecutor?: (fix: string) => Promise<boolean>,
    depth = 0,
  ): Promise<{ stepId: string; success: boolean; filesModified: string[] }> {
    let retryCount = 0
    let stepSuccess = false
    let stepOutput = ""
    let filesModified: string[] = []

    while (retryCount <= this.config.maxRetries) {
      // Circuit breaker: check budget before each retry
      if (this.budgetTracker) {
        const budgetEvent = this.budgetTracker.check("session")
        if (budgetEvent) {
          stepOutput = `Budget exceeded (${budgetEvent.metric}: ${budgetEvent.current}/${budgetEvent.limit})`
          break
        }
      }

      // Repetition detection: same step + same retry context = stuck loop
      if (this.detectLoop(`${step.id}:retry=${retryCount}`)) {
        stepOutput = `Infinite loop detected: step ${step.id} repeated ${this.MAX_IDENTICAL_CALLS}+ times in ${this.WINDOW_MS / 1000}s`
        break
      }

      this.observers.forEach(o => o.onStepStart(step.id, depth + 1))

      const stepPromise = stepExecutor(step)
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Step ${step.id} timed out after 120000ms`)), 120_000)
      })
      const result = await Promise.race([stepPromise, timeoutPromise])

      if (result.filesModified && result.filesModified.length > 0) {
        depTracker.recordChange(sessionId, step.id, result.filesModified)
        filesModified = result.filesModified
      }

      stepSuccess = result.success
      stepOutput = result.output

      if (stepSuccess) {
        if (this.config.verifyAfterEach) {
          const verifyResult = result.filesModified.length > 0
            ? verifier.verifyRelated(step.id, projectDir, result.filesModified)
            : verifier.verifyAll(step.id, projectDir)

          if (!verifyResult.passed) {
            stepSuccess = false
            stepOutput = `Verification failed: ${verifyResult.errors.join("\n")}`
            const analysis = await errorAnalyzer.analyzeDeep(stepOutput, result.filesModified)
            this.observers.forEach(o => o.onStepComplete(step.id, false, analysis.suggestedFix))

            if (!this.config.autoRetry) { retryCount++; break }

            const repairResult = await this.attemptRepair(step, stepOutput, analysis, fixExecutor)
            if (!repairResult) { retryCount++; break }
            continue
          }
        }

        executor.recordResult(sessionId, {
          stepId: step.id,
          success: true,
          output: stepOutput,
          filesModified,
          error: result.error,
        })
        this.observers.forEach(o => o.onStepComplete(step.id, true, stepOutput))
        return { stepId: step.id, success: true, filesModified }
      }

      retryCount++
      this.observers.forEach(o => o.onStepComplete(step.id, false, stepOutput))

      if (!this.config.autoRetry || retryCount > this.config.maxRetries) break

      const analysis = await errorAnalyzer.analyzeDeep(stepOutput, filesModified)
      const repairResult = await this.attemptRepair(step, stepOutput, analysis, fixExecutor)
      if (!repairResult) break
    }

    executor.recordResult(sessionId, {
      stepId: step.id,
      success: false,
      output: stepOutput,
      filesModified: [],
      error: stepOutput,
    })

    return { stepId: step.id, success: false, filesModified }
  }

  private async attemptRepair(
    _step: Subtask,
    error: string,
    analysis: ReturnType<ErrorAnalyzer["analyze"]>,
    fixExecutor?: (fix: string) => Promise<boolean>,
  ): Promise<boolean> {
    try {
      const llmAnalysis = await this.llm.analyzeError(error, [])
      if (llmAnalysis && llmAnalysis.category !== "unknown" && llmAnalysis.fix && llmAnalysis.fix !== "Manual investigation needed") {
        // If a fixExecutor is provided, try it. If it fails, still retry (the step executor
        // will get another chance with the error context).
        if (fixExecutor) {
          const fixed = await fixExecutor(llmAnalysis.fix).catch(() => false)
          if (fixed) return true
        }
        return true // retry step execution even if bash fix failed
      }
    } catch (e) {
      console.warn(`[AgentLoop] LLM repair failed for step ${_step.id}:`, e)
    }

    // Only allow retry if analysis suggests recovery (domain-agnostic)
    if (analysis && analysis.category !== "unknown") {
      return true
    }
    return false
  }
}
