/**
 * ID Chain — unified identifier hierarchy for the entire agentic system.
 *
 * All IDs nest conceptually as:
 *
 *   sessionID  ⊃  pipelineRunId  ⊃  taskId  ⊃  stepId
 *
 * - `sessionID`:   top-level, one per OpenCode conversation (auto from context)
 * - `pipelineRunId`: identifies one execution of a multi-stage pipeline
 * - `taskId`:       a unit of work delegated to a specific agent role
 * - `stepId`:       a single subtask step within a plan
 *
 * Tools SHOULD accept/return the fullest chain they have access to.
 * At minimum, every tool automatically receives `sessionID` from context.
 */
export interface IDChain {
  /** Top-level conversation (auto from tool context) */
  sessionID: string
  /** Multi-stage pipeline run (optional) */
  pipelineRunId?: string
  /** Delegated task (optional — links stepId to its parent task) */
  taskId?: string
  /** Individual subtask step (optional — leaf in the chain) */
  stepId?: string
}

/**
 * Build a pipelineRunId string from sessionID + pipelineId (canonical format).
 */
export function makePipelineRunId(sessionID: string, pipelineId: string): string {
  return `run-${sessionID}-${pipelineId}`
}

/**
 * Extract the original pipelineId from a pipelineRunId.
 */
export function parsePipelineRunId(runId: string): { sessionID: string; pipelineId: string } | null {
  const m = /^run-([^-]+)-(.+)$/.exec(runId)
  return m ? { sessionID: m[1], pipelineId: m[2] } : null
}
