import type { SkillRecord } from "../memory/skill-store.js"
import type { Episode } from "../memory/episodic-store.js"
import type { AgentTask } from "../agents/coordinator.js"
import type { CustomAgentDef } from "../agents/role-registry.js"

export interface EvolutionMetrics {
  totalSessions: number
  totalSteps: number
  successRate: number
  retryRate: number
  avgRetriesPerFailure: number
  topErrorCategories: Array<{ category: string; count: number }>
  skillEffectiveness: Array<{ name: string; successRate: number; usage: number }>
  toolUsage: Array<{ tool: string; calls: number; failureRate: number }>
  recommendations: string[]
}

export interface SkillPatch {
  skillId: string
  skillName: string
  failures: number
  suggestedChanges: Array<{
    type: "add_step" | "add_tool" | "add_rollback" | "reorder" | "split"
    description: string
    detail: string
  }>
}

export interface RoleSuggestion {
  name: string
  triggerPattern: string
  suggestedTools: string[]
  reason: string
}

export interface PromptPatch {
  role: string
  errorCategory: string
  instruction: string
  priority: "high" | "medium" | "low"
  occurrences: number
}

export interface EvolutionReport {
  metrics: EvolutionMetrics
  skillPatches: SkillPatch[]
  roleSuggestions: RoleSuggestion[]
  promptPatches: PromptPatch[]
  improvementScore: number // 0-100, higher = more evolving
}

export class SelfEvolver {
  private skills: SkillRecord[] = []
  private episodes: Episode[] = []
  private tasks: AgentTask[] = []
  private stepStates: Array<{ stepId: string; success: boolean; output: string }> = []
  private traceEntries: Array<{ toolUsed: string; success: boolean; step: string }> = []

  feedSkills(skills: SkillRecord[]): void { this.skills = skills }
  feedEpisodes(episodes: Episode[]): void { this.episodes = episodes }
  feedTasks(tasks: AgentTask[]): void { this.tasks = tasks }
  feedStepStates(steps: Array<{ stepId: string; success: boolean; output: string }>): void { this.stepStates = steps }
  feedTraces(traces: Array<{ toolUsed: string; success: boolean; step: string }>): void { this.traceEntries = traces }

  evolve(): EvolutionReport {
    const metrics = this.computeMetrics()
    const skillPatches = this.analyzeSkills()
    const roleSuggestions = this.suggestRoles()
    const promptPatches = this.suggestPromptPatches(metrics)

    // Auto-apply safe prompt patches (low-risk, high-priority)
    const appliedPatches: PromptPatch[] = []
    for (const patch of promptPatches) {
      // Auto-apply if: (1) high-priority AND (2) low occurrences (new pattern, not widespread)
      // OR: medium-priority with very high occurrences (proven pattern)
      const shouldAutoApply = 
        (patch.priority === "high" && patch.occurrences >= 2 && patch.occurrences <= 5) ||
        (patch.priority === "medium" && patch.occurrences >= 10)
      
      if (shouldAutoApply) {
        // Mark as applied (actual prompt injection happens in RoleRegistry)
        appliedPatches.push(patch)
      }
    }

    const improvementScore = Math.min(100, Math.round(
      (skillPatches.length * 15) +
      (roleSuggestions.length * 10) +
      (promptPatches.length * 8) +
      (appliedPatches.length * 5) + // Small bonus for identified patches (actual application requires RoleRegistry)
      (metrics.successRate * 20) +
      (metrics.recommendations.length * 5)
    ))

    return { metrics, skillPatches, roleSuggestions, promptPatches, improvementScore }
  }

  private computeMetrics(): EvolutionMetrics {
    const sessions = new Set(this.episodes.map(e => e.sessionId))
    const totalSteps = this.stepStates.length || this.tasks.length
    const doneSteps = this.stepStates.filter(s => s.success).length
    const failedSteps = this.stepStates.filter(s => !s.success).length
    const done = doneSteps + this.tasks.filter(t => t.status === "done").length
    const failed = failedSteps + this.tasks.filter(t => t.status === "failed").length
    const total = done + failed || 1

    const errorCategories = new Map<string, number>()
    for (const ep of this.episodes) {
      if (ep.outcome !== "success") {
        for (const tag of ep.tags) {
          errorCategories.set(tag, (errorCategories.get(tag) ?? 0) + 1)
        }
      }
    }

    const topErrors = [...errorCategories.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([category, count]) => ({ category, count }))

    const skillEff = this.skills.map(s => ({
      name: s.definition.meta.name,
      successRate: s.successRate,
      usage: s.usageCount,
    }))

    const toolUsage = new Map<string, { calls: number; failures: number }>()
    for (const t of this.traceEntries) {
      const entry = toolUsage.get(t.toolUsed) ?? { calls: 0, failures: 0 }
      entry.calls++
      if (!t.success) entry.failures++
      toolUsage.set(t.toolUsed, entry)
    }

    const toolStats = [...toolUsage.entries()]
      .map(([tool, stats]) => ({
        tool,
        calls: stats.calls,
        failureRate: stats.calls > 0 ? stats.failures / stats.calls : 0,
      }))
      .sort((a, b) => b.calls - a.calls)

    const recommendations: string[] = []

    if (total > 0 && done / total < 0.5) {
      recommendations.push("Task success rate is below 50%. Consider more granular task decomposition in agentic_plan.")
    }

    if (sessions.size > 3 && this.episodes.filter(e => e.outcome === "failed").length / Math.max(this.episodes.length, 1) > 0.3) {
      recommendations.push("High cross-session failure rate. Consider adding a 'review' checkpoint between plan and execute phases.")
    }

    const unusedTools = [
      "agentic_context", "agentic_snapshot", "agentic_score",
    ].filter(t => !toolUsage.has(t))

    if (unusedTools.length > 0) {
      recommendations.push(`Underutilized tools: ${unusedTools.join(", ")}. These could improve observability and quality.`)
    }

    const retryFraction = failed / Math.max(total, 1)
    if (retryFraction > 0.3) {
      recommendations.push("High retry rate (>30%). Consider adding more explicit verification criteria to plan steps.")
    }

    // Error pattern analysis
    for (const step of this.stepStates) {
      if (!step.success && step.output.length > 0) {
        const lower = step.output.toLowerCase()
        if (lower.includes("type") || lower.includes("compile")) {
          recommendations.push("Frequent type/compile errors detected. Enable `autoVerify` on all execute calls to catch these early.")
          break
        }
      }
    }

    return {
      totalSessions: sessions.size,
      totalSteps,
      successRate: total > 0 ? done / total : 0,
      retryRate: retryFraction,
      avgRetriesPerFailure: failed > 0 ? failedSteps / failed : 0,
      topErrorCategories: topErrors,
      skillEffectiveness: skillEff,
      toolUsage: toolStats,
      recommendations,
    }
  }

  private analyzeSkills(): SkillPatch[] {
    const patches: SkillPatch[] = []

    for (const skill of this.skills) {
      if (skill.successRate >= 0.8) continue // healthy skills

      const def = skill.definition
      const suggestions: SkillPatch["suggestedChanges"] = []

      for (const scenario of def.quality.failureScenarios.slice(-3)) {
        if (scenario.includes("rollback") || scenario.includes("undo")) {
          suggestions.push({
            type: "add_rollback",
            description: "Add rollback step for failed operations",
            detail: "Each step that modifies state should have a corresponding undo action",
          })
        }
        if (scenario.includes("timeout") || scenario.includes("slow")) {
          suggestions.push({
            type: "add_step",
            description: "Add timeout/retry wrapper step",
            detail: "Wrap long-running operations with retry: utils/retry.ts handles exponential backoff",
          })
        }
        if (scenario.includes("missing") || scenario.includes("not found")) {
          suggestions.push({
            type: "add_step",
            description: "Add pre-flight validation step",
            detail: "Check prerequisites before executing main workflow",
          })
        }
      }

      if (def.workflow.steps.length > 5) {
        suggestions.push({
          type: "split",
          description: "Split into smaller, independently testable sub-skills",
          detail: `This skill has ${def.workflow.steps.length} steps. Consider splitting at logical boundaries.`,
        })
      }

      if (suggestions.length > 0) {
        patches.push({
          skillId: def.meta.id,
          skillName: def.meta.name,
          failures: Math.round(skill.usageCount * (1 - skill.successRate)),
          suggestedChanges: suggestions,
        })
      }
    }

    return patches
  }

  private suggestRoles(): RoleSuggestion[] {
    const suggestions: RoleSuggestion[] = []

    const taskOutcomes = new Map<string, { total: number; failed: number }>()
    for (const task of this.tasks) {
      const entry = taskOutcomes.get(task.assignedTo) ?? { total: 0, failed: 0 }
      entry.total++
      if (task.status === "failed") entry.failed++
      taskOutcomes.set(task.assignedTo, entry)
    }

    const failedTasks = this.tasks.filter(t => t.status === "failed")
    const failKeywords = new Map<string, number>()

    for (const task of failedTasks) {
      const words = task.description.toLowerCase().split(/\W+/).filter(w => w.length > 3)
      for (const w of words) {
        failKeywords.set(w, (failKeywords.get(w) ?? 0) + 1)
      }
    }

    const significantKeywords = [...failKeywords.entries()]
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])

    for (const [keyword, count] of significantKeywords) {
      if (keyword === "security" || keyword === "vulnerability" || keyword === "injection") {
        suggestions.push({
          name: "Security Auditor",
          triggerPattern: `tasks involving ${keyword}`,
          suggestedTools: ["read", "grep", "agentic_guard", "agentic_verify"],
          reason: `${count} task(s) involving "${keyword}" failed. A dedicated security role could prevent these via specialized review patterns.`,
        })
      }

      if (keyword === "performance" || keyword === "optimize" || keyword === "slow") {
        suggestions.push({
          name: "Performance Engineer",
          triggerPattern: `tasks involving ${keyword}`,
          suggestedTools: ["bash", "agentic_score", "agentic_verify"],
          reason: `${count} task(s) involving "${keyword}" failed. A performance-focused agent could catch bottlenecks early.`,
        })
      }

      if (keyword === "database" || keyword === "migration" || keyword === "schema") {
        suggestions.push({
          name: "DB Specialist",
          triggerPattern: `tasks involving ${keyword}`,
          suggestedTools: ["bash", "read", "agentic_nav"],
          reason: `${count} task(s) involving "${keyword}" failed. A database specialist could prevent schema drift and migration errors.`,
        })
      }
    }

    const hasCoordinator = taskOutcomes.has("coordinator")
    if (!hasCoordinator && this.tasks.length > 10) {
      suggestions.push({
        name: "Task Coordinator",
        triggerPattern: "multi-step tasks with cross-cutting concerns",
        suggestedTools: ["agentic_plan", "agentic_status", "agentic_delegate", "agentic_parallel"],
        reason: "With 10+ tasks and no coordinator role active, orchestration overhead may cause failures.",
      })
    }

    return suggestions.slice(0, 5)
  }

  /**
   * Generate prompt patches from recurring error patterns (Gap #1: prompt auto-patching).
   * Maps error categories → specific instruction additions for the relevant agent role.
   */
  private suggestPromptPatches(metrics: EvolutionMetrics): PromptPatch[] {
    const patches: PromptPatch[] = []

    // Error category → (role, instruction) mapping
    const errorToPatch: Array<{
      category: string
      role: string
      instruction: string
      priority: "high" | "medium" | "low"
    }> = [
      {
        category: "compile",
        role: "developer",
        instruction: "Before writing code, verify that all types and interfaces are compatible. Run `npx tsc --noEmit` to check for type errors before considering a step complete.",
        priority: "high",
      },
      {
        category: "type",
        role: "developer",
        instruction: "Always define explicit type annotations for function parameters and return values. Avoid `any` types. Verify type exports/imports match between files.",
        priority: "high",
      },
      {
        category: "import",
        role: "architect",
        instruction: "Before implementing, document all file dependencies and ensure import paths are correct. Verify the import exists at the expected relative path.",
        priority: "high",
      },
      {
        category: "test",
        role: "qa",
        instruction: "When reviewing code, check edge cases: empty inputs, null/undefined values, boundary conditions, and error paths. Ensure tests cover both success and failure scenarios.",
        priority: "medium",
      },
      {
        category: "runtime",
        role: "developer",
        instruction: "Add error handling for runtime edge cases: network timeouts, file not found, permission denied, and invalid input. Use try/catch blocks and return user-friendly error messages.",
        priority: "medium",
      },
    ]

    for (const errCat of metrics.topErrorCategories) {
      const mapping = errorToPatch.find(e => e.category === errCat.category)
      if (mapping && errCat.count >= 2) {
        patches.push({
          role: mapping.role,
          errorCategory: errCat.category,
          instruction: mapping.instruction,
          priority: errCat.count >= 5 ? "high" : mapping.priority,
          occurrences: errCat.count,
        })
      }
    }

    return patches
  }
}
