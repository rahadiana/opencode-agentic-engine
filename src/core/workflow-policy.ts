export type WorkflowAction = "execute" | "finalize" | "retry"
export type WorkflowSeverity = "allow" | "warn" | "block"

export interface WorkflowPolicyInput {
  action: WorkflowAction
  stepId?: string
  filesModified?: string[]
  success?: boolean
  hasPlan?: boolean
  hasResearch?: boolean
  hasReflection?: boolean
  hasVerificationEvidence?: boolean
  verificationEvidenceFailed?: boolean
  confidence?: number
}

export interface WorkflowPolicyDecision {
  allowed: boolean
  severity: WorkflowSeverity
  code: string
  message: string
}

export interface WorkflowPolicyOptions {
  mode?: "advisory" | "strict"
  minConfidence?: number
}

function decision(severity: WorkflowSeverity, code: string, message: string): WorkflowPolicyDecision {
  return { allowed: severity !== "block", severity, code, message }
}

function maybeBlock(strict: boolean, code: string, message: string): WorkflowPolicyDecision {
  return decision(strict ? "block" : "warn", code, message)
}

export function evaluateWorkflowPolicy(input: WorkflowPolicyInput, options: WorkflowPolicyOptions = {}): WorkflowPolicyDecision[] {
  const strict = options.mode === "strict"
  const minConfidence = options.minConfidence ?? 0.6
  const decisions: WorkflowPolicyDecision[] = []
  const touchesFiles = (input.filesModified?.length ?? 0) > 0

  if (input.success && input.verificationEvidenceFailed) {
    decisions.push(decision("block", "evidence-failed", "Cannot mark success when supplied verification evidence contains failures."))
  }

  if (input.action === "execute" && input.success && touchesFiles && !input.hasPlan) {
    decisions.push(maybeBlock(strict, "plan-missing", "File-changing execution has no recorded plan. Call agentic_plan first for non-trivial work."))
  }

  if (input.action === "execute" && input.success && touchesFiles && !input.hasResearch) {
    decisions.push(decision("warn", "research-missing", "No codebase research/navigation was recorded before modifying files."))
  }

  if (input.action === "retry" && !input.hasReflection) {
    decisions.push(maybeBlock(strict, "reflection-missing", "Retry after failure requires agentic_reflect before marking the retry successful."))
  }

  if (input.action === "finalize" && input.success && touchesFiles && !input.hasVerificationEvidence) {
    decisions.push(maybeBlock(strict, "verification-missing", "Final completion changed files but has no final agentic_verify pass or explicit verificationEvidence."))
  }

  if (input.success && input.confidence !== undefined && input.confidence < minConfidence) {
    decisions.push(decision("warn", "confidence-low", `Completion confidence ${(input.confidence * 100).toFixed(0)}% is below ${(minConfidence * 100).toFixed(0)}%.`))
  }

  return decisions.length > 0 ? decisions : [decision("allow", "ok", "Workflow policy checks passed.")]
}

export function formatWorkflowPolicyDecisions(decisions: WorkflowPolicyDecision[]): string {
  const actionable = decisions.filter(d => d.severity !== "allow")
  if (actionable.length === 0) return ""
  return actionable.map(d => {
    const icon = d.severity === "block" ? "🛑" : "⚠️"
    return `${icon} **${d.code}**: ${d.message}`
  }).join("\n")
}

export function verificationEvidenceFailed(evidence?: {
  build?: "passed" | "failed" | "skipped"
  lint?: "passed" | "failed" | "skipped"
  tests?: Array<{ failed?: number }>
}): boolean {
  return evidence?.build === "failed" || evidence?.lint === "failed" || !!evidence?.tests?.some(t => (t.failed ?? 0) > 0)
}
