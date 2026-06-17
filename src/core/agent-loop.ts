import type { Subtask } from "./intent-parser.js"
import { Executor } from "./executor.js"
import { Verifier } from "./verifier.js"
import { ErrorAnalyzer } from "./error-analyzer.js"
import { DependencyTracker } from "../drift/dependency-tracker.js"
import { LLMEngine } from "./llm.js"

export interface AgentLoopConfig {
  maxIterations: number
  autoRetry: boolean
  maxRetries: number
  verifyAfterEach: boolean
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

  constructor(llm: LLMEngine, config: Partial<AgentLoopConfig> = {}) {
    this.llm = llm
    this.config = {
      maxIterations: config.maxIterations ?? 20,
      autoRetry: config.autoRetry ?? true,
      maxRetries: config.maxRetries ?? 3,
      verifyAfterEach: config.verifyAfterEach ?? true,
    }
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

    while (iteration < this.config.maxIterations) {
      iteration++

      const nextStep = executor.getNextStep(sessionId)
      if (!nextStep) break

      let retryCount = 0
      let stepSuccess = false
      let stepOutput = ""

      while (retryCount <= this.config.maxRetries) {
        this.observers.forEach(o => o.onStepStart(nextStep.id, iteration))

        const result = await stepExecutor(nextStep)

        if (result.filesModified && result.filesModified.length > 0) {
          depTracker.recordChange(sessionId, nextStep.id, result.filesModified)
        }

        stepSuccess = result.success
        stepOutput = result.output

        if (stepSuccess) {
          if (this.config.verifyAfterEach) {
            const verifyResult = result.filesModified.length > 0
              ? verifier.verifyRelated(nextStep.id, projectDir, result.filesModified)
              : verifier.verifyAll(nextStep.id, projectDir)

            if (!verifyResult.passed) {
              stepSuccess = false
              stepOutput = `Verification failed: ${verifyResult.errors.join("\n")}`
              const analysis = await errorAnalyzer.analyzeDeep(stepOutput, result.filesModified)
              this.observers.forEach(o => o.onStepComplete(nextStep.id, false, analysis.suggestedFix))

              if (!this.config.autoRetry) { retryCount++; break }

              const repairResult = await this.attemptRepair(nextStep, stepOutput, analysis, fixExecutor)
              if (!repairResult) {
                retryCount++
                break
              }
              continue
            }
          }

          // Record success only after verification passes
          executor.recordResult(sessionId, {
            stepId: nextStep.id,
            success: true,
            output: stepOutput,
            filesModified: result.filesModified,
            error: result.error,
          })
          completedSteps.push(nextStep.id)
          this.observers.forEach(o => o.onStepComplete(nextStep.id, true, stepOutput))
          break
        }

        retryCount++
        this.observers.forEach(o => o.onStepComplete(nextStep.id, false, stepOutput))

        if (!this.config.autoRetry || retryCount > this.config.maxRetries) break

        const analysis = await errorAnalyzer.analyzeDeep(stepOutput, result.filesModified ?? [])
        const repairResult = await this.attemptRepair(nextStep, stepOutput, analysis, fixExecutor)
        if (!repairResult) break
      }

      if (!stepSuccess) {
        // Record failure after all retries exhausted
        executor.recordResult(sessionId, {
          stepId: nextStep.id,
          success: false,
          output: stepOutput,
          filesModified: [],
          error: stepOutput,
        })
        failedSteps.push(nextStep.id)
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

  private async attemptRepair(
    step: Subtask,
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
    } catch {
      // LLM repair failed, but we can still try basic fixes
    }

    // Only allow retry for deterministic/recoverable error categories
    if (analysis && (analysis.category === "import" || analysis.category === "compile" || analysis.category === "type")) {
      return true
    }
    // Runtime errors, test failures, and unknown errors — do not auto-retry without explicit fix
    return false
  }
}
