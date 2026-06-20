import type { Subtask, Plan } from "./intent-parser.js"
import type { DomainRegistry } from "./domain-registry.js"
import type { BudgetTracker } from "./budget-tracker.js"
import { ContractVerifier, type FormalContract, type VerificationContext } from "./formal-model.js"

export interface ExecutionResult {
  stepId: string
  success: boolean
  output: string
  filesModified?: string[]
  error?: string
}

export interface StepErrorHistory {
  error: string
  attemptedFix: string
  timestamp: number
  success: boolean
}

export interface StepState {
  result?: ExecutionResult
  retryCount: number
  errorHistory: StepErrorHistory[]
}

export interface ExecutionState {
  plan: Plan
  completedSteps: Set<string>
  failedSteps: Map<string, string>
  stepStates: Map<string, StepState>
  currentStepIndex: number
}

export class Executor {
  private maxRetries = 3
  private states = new Map<string, ExecutionState>()
  private domainRegistry: DomainRegistry | null = null
  private contractVerifier: ContractVerifier

  constructor(contractVerifier?: ContractVerifier) {
    this.contractVerifier = contractVerifier ?? new ContractVerifier()
  }

  setDomainRegistry(registry: DomainRegistry): void {
    this.domainRegistry = registry
  }

  setBudgetTracker(_tracker: BudgetTracker): void {
    // Budget step counting is handled by recordCompletion() in execution-helpers.ts
    // to prevent double counting. Setter kept for API compatibility.
  }

  /** G5: Get contract for current domain */
  private getCurrentContract(): FormalContract | undefined {
    return this.domainRegistry?.getCurrentPack()?.formalContract
  }

  /** G5: Verify pre-conditions before executing a step.
   *  Returns null if no contract, or { passed, summary, results } */
  async verifyPreConditions(stepId: string, description: string, projectDir?: string): Promise<{ passed: boolean; summary: string } | null> {
    const contract = this.getCurrentContract()
    if (!contract) return null

    const context: VerificationContext = { stepId, description, projectDir }
    return this.contractVerifier.verifyPreConditions(contract, context)
  }

  /** G5: Verify post-conditions after executing a step */
  async verifyPostConditions(stepId: string, description: string, filesModified: string[], output: string, errorOutput?: string, projectDir?: string): Promise<{ passed: boolean; summary: string } | null> {
    const contract = this.getCurrentContract()
    if (!contract) return null

    const context: VerificationContext = {
      stepId, description, filesModified, output, errorOutput, projectDir,
    }
    return this.contractVerifier.verifyPostConditions(contract, context)
  }

  /** Per-error-category retry limits (domain-agnostic).
   *  Domain-specific categories (e.g. compile/type/test) are added
   *  by domain packs when they register error matchers.
   */
  private retryPolicies = new Map<string, number>([
    ["runtime", 3],
    ["error", 3],
    ["unknown", 3],
  ])

  /** Set max retries for a specific error category. */
  setRetryPolicy(category: string, maxRetries: number): void {
    this.retryPolicies.set(category, maxRetries)
  }

  /** Get max retries for an error category, or the global default if not categorized */
  getMaxRetries(category?: string): number {
    if (category && this.retryPolicies.has(category)) {
      return this.retryPolicies.get(category)!
    }
    return this.maxRetries
  }

  /** Get all retry policy summaries */
  getRetryPolicies(): Array<{ category: string; maxRetries: number }> {
    return [...this.retryPolicies.entries()]
      .map(([category, maxRetries]) => ({ category, maxRetries }))
      .sort((a, b) => a.category.localeCompare(b.category))
  }

  initExecution(sessionId: string, plan: Plan): ExecutionState {
    const state: ExecutionState = {
      plan,
      completedSteps: new Set(),
      failedSteps: new Map(),
      stepStates: new Map(),
      currentStepIndex: 0,
    }
    this.states.set(sessionId, state)
    return state
  }

  getNextStep(sessionId: string): Subtask | null {
    const state = this.states.get(sessionId)
    if (!state) return null

    for (const step of state.plan.intent.subtasks) {
      if (state.completedSteps.has(step.id)) continue
      if (state.failedSteps.has(step.id)) continue

      const depsMet = step.dependsOn.every(d => state.completedSteps.has(d))
      if (depsMet) {
        state.currentStepIndex = state.plan.intent.subtasks.indexOf(step)
        return step
      }
    }

    return null
  }

  getReadySteps(sessionId: string): Subtask[] {
    const state = this.states.get(sessionId)
    if (!state) return []

    const ready: Subtask[] = []
    for (const step of state.plan.intent.subtasks) {
      if (state.completedSteps.has(step.id)) continue
      if (state.failedSteps.has(step.id)) continue
      if (step.dependsOn.every(d => state.completedSteps.has(d))) {
        ready.push(step)
      }
    }
    return ready
  }

  getBlockedSteps(sessionId: string): Array<{ id: string; description: string; blockedBy: string[] }> {
    const state = this.states.get(sessionId)
    if (!state) return []

    const blocked: Array<{ id: string; description: string; blockedBy: string[] }> = []
    for (const step of state.plan.intent.subtasks) {
      if (state.completedSteps.has(step.id)) continue
      if (state.failedSteps.has(step.id)) continue
      const unmet = step.dependsOn.filter(d => !state.completedSteps.has(d))
      if (unmet.length > 0) {
        blocked.push({ id: step.id, description: step.description, blockedBy: unmet })
      }
    }
    return blocked
  }

  recordResult(sessionId: string, result: ExecutionResult): void {
    const state = this.states.get(sessionId)
    if (!state) return

    let stepState = state.stepStates.get(result.stepId)
    if (!stepState) {
      stepState = { retryCount: 0, errorHistory: [] }
      state.stepStates.set(result.stepId, stepState)
    }

    stepState.result = result

    if (result.success) {
      state.completedSteps.add(result.stepId)
      state.failedSteps.delete(result.stepId) // Clear from failed if succeeded after retry
      // NOTE: budgetTracker.recordStep() is NOT called here — it's handled in
      // execution-helpers.ts recordCompletion() to prevent double counting
    } else {
      // Analyze error FIRST, then increment retry count
      const errorCategory = this.detectErrorCategory(result.error ?? result.output)
      const maxRetries = this.getMaxRetries(errorCategory)

      stepState.errorHistory.push({
        error: result.error ?? "Unknown error",
        attemptedFix: "",
        timestamp: Date.now(),
        success: false,
      })

      if (stepState.retryCount < maxRetries) {
        stepState.retryCount++
        state.failedSteps.delete(result.stepId)
      } else {
        stepState.retryCount++
        state.failedSteps.set(result.stepId, result.error ?? `Max retries (${maxRetries}) exceeded for category: ${errorCategory}`)
      }
    }
  }

  recordFixAttempt(sessionId: string, stepId: string, fix: string, success: boolean): void {
    const state = this.states.get(sessionId)
    if (!state) return

    const stepState = state.stepStates.get(stepId)
    if (stepState && stepState.errorHistory.length > 0) {
      const last = stepState.errorHistory[stepState.errorHistory.length - 1]
      last.attemptedFix = fix
      last.success = success
    }
  }

  canRetry(sessionId: string, stepId: string, category?: string): boolean {
    const state = this.states.get(sessionId)
    if (!state) return false
    const ss = state.stepStates.get(stepId)

    // Adaptive: if category provided, use per-category limit
    if (category) {
      return (ss?.retryCount ?? 0) < this.getMaxRetries(category)
    }

    // Fall back to last known error's category
    if (ss?.result?.error) {
      const detectedCategory = this.detectErrorCategory(ss.result.error)
      return (ss?.retryCount ?? 0) < this.getMaxRetries(detectedCategory)
    }

    return (ss?.retryCount ?? 0) < this.maxRetries
  }

  /** Detect error category from error text — domain-aware */
  private detectErrorCategory(errorText: string): string {
    if (this.domainRegistry) {
      const matchers = this.domainRegistry.getErrorMatchers()
      for (const matcher of matchers) {
        const result = matcher.match(errorText)
        if (result && result.matched) return result.category
      }
    }
    const lower = errorText.toLowerCase()
    if (/cannot find module|module not found|could not resolve|import error/i.test(lower)) return "import"
    if (/not assignable|does not exist on type|type.*mismatch/i.test(lower)) return "type"
    if (/error ts|ts\d{3,}|compilation failed|syntax error|unexpected token/i.test(lower)) return "compile"
    if (/test.*failed|assert.*fail|expect.*received/i.test(lower)) return "test"
    if (lower.includes("timeout") || lower.includes("econnrefused") || lower.includes("etimedout") || lower.includes("network")) return "runtime"
    if (/error|fail|exception/i.test(lower)) return "error"
    return "unknown"
  }

  getRetryCount(sessionId: string, stepId: string): number {
    const state = this.states.get(sessionId)
    if (!state) return 0
    return state.stepStates.get(stepId)?.retryCount ?? 0
  }

  getCompletedSteps(sessionId: string): string[] {
    const state = this.states.get(sessionId)
    if (!state) return []
    return [...state.completedSteps]
  }

  getStepState(sessionId: string, stepId: string): StepState | undefined {
    return this.states.get(sessionId)?.stepStates.get(stepId)
  }

  isComplete(sessionId: string): boolean {
    const state = this.states.get(sessionId)
    if (!state) return false

    return state.plan.intent.subtasks.every(
      s => state.completedSteps.has(s.id) || state.failedSteps.has(s.id)
    )
  }

  isHealthy(sessionId: string): boolean {
    const state = this.states.get(sessionId)
    if (!state) return false
    return state.failedSteps.size === 0
  }

  getProgress(sessionId: string): { completed: number; total: number; failed: number; blocked: number } {
    const state = this.states.get(sessionId)
    if (!state) return { completed: 0, total: 0, failed: 0, blocked: 0 }

    return {
      completed: state.completedSteps.size,
      total: state.plan.intent.subtasks.length,
      failed: state.failedSteps.size,
      blocked: this.getBlockedSteps(sessionId).length,
    }
  }

  getAllFilesModified(sessionId: string): string[] {
    const state = this.states.get(sessionId)
    if (!state) return []
    const files = new Set<string>()
    for (const stepState of state.stepStates.values()) {
      if (stepState.result?.filesModified) {
        for (const f of stepState.result.filesModified) files.add(f)
      }
    }
    return [...files]
  }

  replanStep(sessionId: string, stepId: string, newSubtasks: Subtask[]): number {
    const state = this.states.get(sessionId)
    if (!state) return 0
    if (newSubtasks.length === 0) return 0

    const idx = state.plan.intent.subtasks.findIndex(s => s.id === stepId)
    if (idx !== -1) {
      state.plan.intent.subtasks.splice(idx, 1)
    }

    state.completedSteps.delete(stepId)
    state.failedSteps.delete(stepId)
    state.stepStates.delete(stepId)

    for (let i = 0; i < newSubtasks.length; i++) {
      const ss = newSubtasks[i]
      if (state.plan.intent.subtasks.some(s => s.id === ss.id)) {
        ss.id = `${stepId}-replan-${i + 1}`
      }
      ss.dependsOn = ss.dependsOn.filter(d => d !== stepId)
    }

    state.plan.intent.subtasks.push(...newSubtasks)
    return newSubtasks.length
  }

  removeSession(sessionId: string): void {
    this.states.delete(sessionId)
  }
}
