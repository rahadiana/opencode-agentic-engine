import type { AgentRole, AgentTask, SharedMemoryEntry } from "./coordinator.js"
import type { AgentDef, CustomAgentDef } from "./role-registry.js"

export interface PipelineStage {
  role: string
  description: string
  validationCriteria?: string[]
}

export interface WorkflowPipeline {
  id: string
  name: string
  stages: PipelineStage[]
  createdAt: number
}

export interface CrossValidationResult {
  stage: string
  targetStage: string
  issues: Array<{
    severity: "error" | "warning" | "info"
    description: string
    source: string
  }>
  passed: boolean
  summary: string
}

export class Orchestrator {
  private pipelines = new Map<string, WorkflowPipeline>()
  private activeRuns = new Map<string, {
    pipelineId: string
    currentStageIndex: number
    stageResults: Map<string, { output: string; issues: string[]; validatedBy: string[] }>
  }>()

  definePipeline(pipeline: WorkflowPipeline): void {
    this.pipelines.set(pipeline.id, pipeline)
  }

  getPipeline(id: string): WorkflowPipeline | undefined {
    return this.pipelines.get(id)
  }

  listPipelines(): WorkflowPipeline[] {
    return [...this.pipelines.values()]
  }

  startRun(runId: string, pipelineId: string): boolean {
    const pipeline = this.pipelines.get(pipelineId)
    if (!pipeline) return false
    this.activeRuns.set(runId, {
      pipelineId,
      currentStageIndex: 0,
      stageResults: new Map(),
    })
    return true
  }

  getCurrentStage(runId: string): PipelineStage | null {
    const run = this.activeRuns.get(runId)
    if (!run) return null
    const pipeline = this.pipelines.get(run.pipelineId)
    if (!pipeline) return null
    if (run.currentStageIndex >= pipeline.stages.length) return null
    return pipeline.stages[run.currentStageIndex]
  }

  advanceStage(runId: string, output: string, issues: string[]): PipelineStage | null {
    const run = this.activeRuns.get(runId)
    if (!run) return null
    const pipeline = this.pipelines.get(run.pipelineId)
    if (!pipeline) return null

    const currentStage = pipeline.stages[run.currentStageIndex]
    if (currentStage) {
      run.stageResults.set(currentStage.role, { output, issues, validatedBy: [] })
    }

    run.currentStageIndex++
    if (run.currentStageIndex >= pipeline.stages.length) return null
    return pipeline.stages[run.currentStageIndex]
  }

  getStageResult(runId: string, role: string): { output: string; issues: string[]; validatedBy: string[] } | undefined {
    return this.activeRuns.get(runId)?.stageResults.get(role)
  }

  getAllStageResults(runId: string): Map<string, { output: string; issues: string[]; validatedBy: string[] }> {
    return this.activeRuns.get(runId)?.stageResults ?? new Map()
  }

  crossValidate(
    targetRole: string,
    output: string,
    allStageResults: Map<string, { output: string; issues: string[]; validatedBy: string[] }>,
    sharedMemory: SharedMemoryEntry[],
  ): CrossValidationResult {
    const issues: CrossValidationResult["issues"] = []

    for (const [role, result] of allStageResults) {
      if (role === targetRole) continue

      const containsKeyIdea = result.output.length > 0
      if (!containsKeyIdea) {
        issues.push({
          severity: "warning",
          description: `Output from ${role} stage appears empty or incomplete`,
          source: role,
        })
      }
    }

    const passed = issues.filter(i => i.severity === "error").length === 0
    const summary = passed
      ? `Cross-validation passed: ${allStageResults.size} stages reviewed, no critical issues`
      : `Cross-validation found ${issues.length} issue(s): ${issues.filter(i => i.severity === "error").length} error(s), ${issues.filter(i => i.severity === "warning").length} warning(s)`

    return { stage: targetRole, targetStage: targetRole, issues, passed, summary }
  }

  buildContextForRole(role: string, runId: string, sharedMemory: SharedMemoryEntry[]): string {
    const parts: string[] = []
    const run = this.activeRuns.get(runId)
    if (!run) return ""

    const pipeline = this.pipelines.get(run.pipelineId)
    if (pipeline) {
      parts.push(`## Pipeline: ${pipeline.name}`)
      parts.push(pipeline.stages.map((s, i) =>
        `  ${i < run.currentStageIndex ? "✅" : i === run.currentStageIndex ? "▶" : "⏳"} **${s.role}**: ${s.description}`
      ).join("\n"))
      parts.push("")
    }

    for (const [prevRole, result] of run.stageResults) {
      if (prevRole === role) continue
      parts.push(`### Output from ${prevRole}`)
      parts.push(result.output.slice(0, 500))
      if (result.issues.length > 0) {
        parts.push(`Issues flagged: ${result.issues.join(", ")}`)
      }
      parts.push("")
    }

    if (sharedMemory.length > 0) {
      parts.push("### Shared Memory")
      for (const entry of sharedMemory) {
        parts.push(`[${entry.key}] (by ${entry.writtenBy}): ${entry.value.slice(0, 200)}`)
      }
    }

    return parts.join("\n")
  }

  getSuggestedPipeline(description: string): string {
    const d = description.toLowerCase()
    if (d.includes("feature") || d.includes("new") || d.includes("implement") || d.includes("add")) return "feature-dev"
    if (d.includes("fix") || d.includes("bug") || d.includes("repair")) return "fix-verify"
    if (d.includes("refactor") || d.includes("restructure") || d.includes("extract")) return "refactor-review"
    if (d.includes("deploy") || d.includes("release") || d.includes("ci") || d.includes("cd")) return "deploy-check"
    return "feature-dev"
  }

  getBuiltInPipelines(): WorkflowPipeline[] {
    return [
      {
        id: "feature-dev",
        name: "Feature Development",
        stages: [
          { role: "pm", description: "Define requirements and acceptance criteria" },
          { role: "architect", description: "Design architecture and interface contracts" },
          { role: "developer", description: "Implement the feature following the architecture" },
          { role: "qa", description: "Review implementation for correctness, edge cases, and regressions" },
        ],
        createdAt: Date.now(),
      },
      {
        id: "fix-verify",
        name: "Bug Fix + Verify",
        stages: [
          { role: "qa", description: "Reproduce the bug and document the exact failure" },
          { role: "developer", description: "Fix the root cause" },
          { role: "qa", description: "Verify the fix and run regression tests" },
        ],
        createdAt: Date.now(),
      },
      {
        id: "refactor-review",
        name: "Refactor + Review",
        stages: [
          { role: "architect", description: "Design the new structure and migration path" },
          { role: "developer", description: "Execute the refactoring" },
          { role: "qa", description: "Verify no regressions from refactoring" },
        ],
        createdAt: Date.now(),
      },
      {
        id: "deploy-check",
        name: "Deploy Checklist",
        stages: [
          { role: "pm", description: "Confirm scope and readiness" },
          { role: "qa", description: "Run full regression suite and check for blockers" },
          { role: "coordinator", description: "Orchestrate the deploy and monitor" },
        ],
        createdAt: Date.now(),
      },
    ]
  }
}
