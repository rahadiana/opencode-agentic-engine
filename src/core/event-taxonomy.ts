/**
 * Event Taxonomy — unified event schema for the agentic event bus.
 *
 * Prinsip: producer emit event → consumer reaksi otomatis.
 * Generalisasi pola BudgetTracker + hook listener ke seluruh sistem.
 *
 * Hirarki namespace:
 *   step.*      → lifecycle subtask (producer: executor)
 *   plan.*      → lifecycle rencana (producer: planner)
 *   pipeline.*  → lifecycle multi-agent (producer: orchestrator)
 *   budget.*    → policy gate pertama (producer: BudgetTracker)
 *   guard.*     → hallucination check (producer: HallucinationGuard)
 *   task.*      → delegasi agent role (producer: coordinator)
 *   memory.*    → persistensi skills/episodes (producer: store)
 */

// ── Namespace: step — subtask lifecycle ──

export interface StepCompletedEvent {
  type: "step.completed"
  payload: {
    sessionID: string
    stepId: string
    /** parent task if delegated */
    taskId?: string
    /** parent pipeline if multi-stage */
    pipelineRunId?: string
    output: string
    filesModified: string[]
    success: true
    durationMs: number
  }
}
/** Consumers: BudgetTracker.recordStep, HallucinationGuard.check (auto), SkillStore.extract (if autoSkillExtract=true), EpisodicStore.record, TraceLogger.log */

export interface StepFailedEvent {
  type: "step.failed"
  payload: {
    sessionID: string
    stepId: string
    taskId?: string
    pipelineRunId?: string
    output: string
    filesModified: string[]
    error: string
    errorCategory: "import" | "type" | "compile" | "test" | "runtime" | "unknown"
    durationMs: number
  }
}
/** Consumers: ContinuousEvolution.feedStepResult, ErrorAnalyzer.propagate, ModelRegistry.updateReliability */

export interface StepRetryingEvent {
  type: "step.retrying"
  payload: {
    sessionID: string
    stepId: string
    attempt: number
    maxRetries: number
    previousError: string
    suggestedFix: string
  }
}

// ── Namespace: plan — rencana lifecycle ──

export interface PlanCreatedEvent {
  type: "plan.created"
  payload: {
    sessionID: string
    /** first subtask ID serves as planId */
    planId: string
    goal: string
    subtaskCount: number
    domain: string
  }
}

export interface PlanCompletedEvent {
  type: "plan.completed"
  payload: {
    sessionID: string
    planId: string
    goal: string
    allStepIds: string[]
    allFilesModified: string[]
    totalDurationMs: number
    allPassed: boolean
  }
}
/** Consumers: agentic_pr (auto-gather results), agentic_score (auto-analyze), SkillStore (extract from plan context) */

// ── Namespace: pipeline — multi-agent lifecycle ──

export interface PipelineStageCompletedEvent {
  type: "pipeline.stage.completed"
  payload: {
    sessionID: string
    runId: string
    pipelineId: string
    role: string
    stageIndex: number
    totalStages: number
    output: string
    filesCreated: string[]
    issues: string[]
  }
}
/** Consumers: Orchestrator.advanceStage, Coordinator.updateTask, agentic_message (auto-notify next role) */

export interface PipelineCompletedEvent {
  type: "pipeline.completed"
  payload: {
    sessionID: string
    runId: string
    pipelineId: string
    stageCount: number
    allFiles: string[]
    crossValidationPassed: boolean
    summary: string
  }
}

// ── Namespace: budget — resource policy gate (PDP/PEP) ──

export interface BudgetLimitExceededEvent {
  type: "budget.limit.exceeded"
  payload: {
    sessionID: string
    scope: "session" | "task"
    metric: "tokens" | "steps" | "time" | "cost"
    current: number
    limit: number
    behavior: "hard-stop" | "warn" | "request-approval"
  }
}
/** Consumers: Executor (block next execute), LLMEngine (block next call), agentic_budget (update status display) */

export interface BudgetThresholdWarningEvent {
  type: "budget.threshold.warning"
  payload: {
    sessionID: string
    scope: "session" | "task"
    metric: "tokens" | "steps" | "time" | "cost"
    usagePercent: number
    current: number
    limit: number
  }
}

// ── Namespace: guard — hallucination detection ──

export interface GuardCheckCompletedEvent {
  type: "guard.check.completed"
  payload: {
    sessionID: string
    stepId: string
    totalClaims: number
    unverifiedClaims: number
    hallucinationRate: number
    passed: boolean
    claims: Array<{
      claim: string
      type: "file" | "function" | "import"
      verified: boolean
      expected: string
      actual: string | null
    }>
  }
}
/** Consumers: ModelRegistry.recordHallucination (if failed), BudgetTracker (optional cost-adjust), agentic_dashboard */

// ── Namespace: task — agent delegation ──

export interface TaskDelegatedEvent {
  type: "task.delegated"
  payload: {
    sessionID: string
    taskId: string
    role: string
    description: string
    pipelineRunId?: string
    delegationDepth: number
  }
}

export interface TaskCompletedEvent {
  type: "task.completed"
  payload: {
    sessionID: string
    taskId: string
    role: string
    result: string
    success: boolean
    pipelineRunId?: string
  }
}
/** Consumers: Orchestrator (advance pipeline stage), agentic_message (auto-notify downstream) */

// ── Namespace: memory — persistence ──

export interface SkillExtractedEvent {
  type: "memory.skill.extracted"
  payload: {
    sessionID: string
    skillId: string
    name: string
    sourceStepId?: string
    successRate: number
  }
}

export interface EpisodeRecordedEvent {
  type: "memory.episode.recorded"
  payload: {
    sessionID: string
    episodeId: string
    planGoal: string
    outcome: "success" | "partial" | "failed"
    timestamp: string
  }
}

// ── Union type for all events ──

export type AgenticEvent =
  | StepCompletedEvent
  | StepFailedEvent
  | StepRetryingEvent
  | PlanCreatedEvent
  | PlanCompletedEvent
  | PipelineStageCompletedEvent
  | PipelineCompletedEvent
  | BudgetLimitExceededEvent
  | BudgetThresholdWarningEvent
  | GuardCheckCompletedEvent
  | TaskDelegatedEvent
  | TaskCompletedEvent
  | SkillExtractedEvent
  | EpisodeRecordedEvent

// ── Producer → Consumer mapping ──

export const EVENT_PRODUCER_MAP: Record<string, string[]> = {
  "step.completed":            ["agentic_execute"],
  "step.failed":               ["agentic_execute"],
  "step.retrying":             ["agentic_execute"],
  "plan.created":              ["agentic_plan"],
  "plan.completed":            ["agentic_execute (last step)", "agentic_verify"],
  "pipeline.stage.completed":  ["agentic_pipeline", "agentic_auto"],
  "pipeline.completed":        ["agentic_pipeline", "agentic_auto"],
  "budget.limit.exceeded":     ["BudgetTracker.check()", "PEP middleware"],
  "budget.threshold.warning":  ["BudgetTracker.check()"],
  "guard.check.completed":     ["agentic_execute (auto)", "agentic_guard (manual)"],
  "task.delegated":            ["agentic_delegate"],
  "task.completed":            ["agentic_delegate"],
  "memory.skill.extracted":    ["SkillStore.extract()"],
  "memory.episode.recorded":   ["EpisodicStore.record()"],
}

export const EVENT_CONSUMER_MAP: Record<string, string[]> = {
  "step.completed":            ["BudgetTracker.recordStep", "HallucinationGuard.check (auto)", "SkillStore.extract (if autoSkillExtract)", "EpisodicStore.record", "TraceLogger.log"],
  "step.failed":               ["ContinuousEvolution.feedStepResult", "ErrorAnalyzer.propagate", "ModelRegistry.updateReliability"],
  "step.retrying":             ["TraceLogger.log", "Dashboard.anomalyDetection"],
  "plan.created":              ["SessionStore.savePlan", "ContextCompressor.compress", "TraceLogger.log"],
  "plan.completed":            ["agentic_pr (auto-gather)", "agentic_score (auto-analyze)", "SkillStore.extract (plan-context skills)"],
  "pipeline.stage.completed":  ["Orchestrator.advanceStage", "Coordinator.updateTask", "agentic_message (auto-notify next)"],
  "pipeline.completed":        ["agentic_pr", "agentic_score", "SkillStore.extract"],
  "budget.limit.exceeded":     ["Executor (block next)", "LLMEngine (block next)", "agentic_budget (status update)"],
  "budget.threshold.warning":  ["agentic_budget (display warning)"],
  "guard.check.completed":     ["ModelRegistry.recordHallucination (if failed)", "Dashboard.anomalyDetection"],
  "task.delegated":            ["TraceLogger.log", "Orchestrator (pipeline tracking)"],
  "task.completed":            ["Orchestrator.advanceStage (if pipeline)", "agentic_message (notify downstream)"],
  "memory.skill.extracted":    ["Dashboard.skillStats"],
  "memory.episode.recorded":   ["Dashboard.episodeStats"],
}
