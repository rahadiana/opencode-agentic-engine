import type { Subtask, Plan } from "./intent-parser"

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
    } else {
      stepState.retryCount++
      stepState.errorHistory.push({
        error: result.error ?? "Unknown error",
        attemptedFix: "",
        timestamp: Date.now(),
        success: false,
      })

      if (stepState.retryCount < this.maxRetries) {
        state.failedSteps.delete(result.stepId)
      } else {
        state.failedSteps.set(result.stepId, result.error ?? "Max retries exceeded")
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

  canRetry(sessionId: string, stepId: string): boolean {
    const state = this.states.get(sessionId)
    if (!state) return false
    const ss = state.stepStates.get(stepId)
    return (ss?.retryCount ?? 0) < this.maxRetries
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

  removeSession(sessionId: string): void {
    this.states.delete(sessionId)
  }
}
