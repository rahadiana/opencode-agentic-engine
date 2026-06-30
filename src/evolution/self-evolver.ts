import type { SkillRecord } from "../memory/skill-store.js"
import type { Episode } from "../memory/episodic-store.js"
import type { AgentTask } from "../agents/coordinator.js"
import type { RoleRegistry } from "../agents/role-registry.js"
import { createLogger } from "../observability/logger.js"

const log = createLogger("SelfEvolver")


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

const WEIGHT_SKILL_PATCH = 15  // per skill patch suggestion
const WEIGHT_ROLE_SUGGESTION = 10 // per new role suggestion
const WEIGHT_PROMPT_PATCH = 8    // per prompt patch detected
const WEIGHT_APPLIED_PATCH = 5   // per auto-applied patch
const WEIGHT_SUCCESS_RATE = 20   // success rate scaling
const WEIGHT_RECOMMENDATION = 5  // per recommendation

export class SelfEvolver {
  private skills: SkillRecord[] = []
  private episodes: Episode[] = []
  private tasks: AgentTask[] = []
  private stepStates: Array<{ stepId: string; success: boolean; output: string }> = []
  private traceEntries: Array<{ toolUsed: string; success: boolean; step: string }> = []

  private seenEpisodeIds = new Set<string>()
  private seenTaskIds = new Set<string>()
  private autoApplyHighMin = 2
  private autoApplyHighMax = 5
  private autoApplyMediumMin = 10

  // Sliding window for success rate calculation
  private readonly successWindowSize = 20
  private roleRegistry: RoleRegistry | null = null

  /** Provide a RoleRegistry so auto-apply can patch role prompts (P2) */
  setRoleRegistry(rr: RoleRegistry): void { this.roleRegistry = rr }

  feedSkills(skills: SkillRecord[]): void { this.skills = skills }
  feedEpisodes(episodes: Episode[]): void {
    this.episodes = (episodes ?? []).filter(e => {
      if (!e || typeof e !== "object") return false
      if (!e.sessionId) return true
      if (this.seenEpisodeIds.has(e.sessionId)) return false
      this.seenEpisodeIds.add(e.sessionId)
      return true
    })
  }
  feedTasks(tasks: AgentTask[]): void {
    this.tasks = (tasks ?? []).filter(t => {
      if (!t || typeof t !== "object") return false
      if (!t.id) return true
      if (this.seenTaskIds.has(t.id)) return false
      this.seenTaskIds.add(t.id)
      return true
    })
  }
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
      const shouldAutoApply =
        (patch.priority === "high" && patch.occurrences >= this.autoApplyHighMin && patch.occurrences <= this.autoApplyHighMax) ||
        (patch.priority === "medium" && patch.occurrences >= this.autoApplyMediumMin)
      
      if (shouldAutoApply) {
        // P2: Actually apply the patch via RoleRegistry
        if (this.roleRegistry) {
          const existing = this.roleRegistry.getPrompt(patch.role)
          if (existing) {
            // Append instruction to existing prompt
            const updated = existing.endsWith("\n")
              ? `${existing}${patch.instruction}`
              : `${existing}\n${patch.instruction}`
            const ok = this.roleRegistry.updatePrompt(patch.role, updated, "auto-evolve", `Auto-apply: ${patch.errorCategory} error pattern (${patch.occurrences}x)`)
            if (ok) {
              log.info(`Auto-applied prompt patch for "${patch.role}": ${patch.instruction.slice(0, 80)}...`)
            }
          }
        }
        appliedPatches.push(patch)
      }
    }

    const improvementScore = Math.min(100, Math.round(
      (skillPatches.length * WEIGHT_SKILL_PATCH) +
      (roleSuggestions.length * WEIGHT_ROLE_SUGGESTION) +
      (promptPatches.length * WEIGHT_PROMPT_PATCH) +
      (appliedPatches.length * WEIGHT_APPLIED_PATCH) +
      (metrics.successRate * WEIGHT_SUCCESS_RATE) +
      (metrics.recommendations.length * WEIGHT_RECOMMENDATION)
    ))

    return { metrics, skillPatches, roleSuggestions, promptPatches, improvementScore }
  }

  private computeMetrics(): EvolutionMetrics {
    const sessions = new Set(this.episodes.map(e => e.sessionId))
    const useStepStates = this.stepStates.length > 0

    // Sliding window: only consider last N steps for current success rate
    const windowSize = this.successWindowSize
    let weightedDone = 0
    let weightedTotal = 0
    let slidingDone = 0
    let slidingTotal = 0

    if (useStepStates) {
      weightedDone = this.stepStates.filter(s => s.success).length
      weightedTotal = this.stepStates.length
      // Sliding window over recent steps
      const recent = this.stepStates.slice(-windowSize)
      slidingDone = recent.filter(s => s.success).length
      slidingTotal = recent.length
    } else {
      for (const task of this.tasks) {
        weightedTotal += 1
        if (task.status === "done") weightedDone += 1
      }
      const recent = this.tasks.slice(-windowSize)
      slidingDone = recent.filter(t => t.status === "done").length
      slidingTotal = recent.length
    }

    const totalSteps = weightedTotal || this.stepStates.length || this.tasks.length
    const done = weightedDone
    const failed = useStepStates
      ? this.stepStates.filter(s => !s.success).length
      : this.tasks.filter(t => t.status === "failed").length
    const total = done + failed
    const safeTotal = total || 1

    // Use sliding window rate for recommendations (more current)
    const effectiveSuccessRate = slidingTotal > 0 ? slidingDone / slidingTotal : (safeTotal > 0 ? done / safeTotal : 0)

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

    // Use sliding window rate for more relevant recommendations
    if (effectiveSuccessRate < 0.5 && slidingTotal >= 5) {
      recommendations.push(`Recent success rate is ${(effectiveSuccessRate * 100).toFixed(0)}% (last ${slidingTotal} steps). Consider more granular task decomposition in agentic_plan.`)
    } else if (safeTotal > 0 && done / safeTotal < 0.5 && slidingTotal < 5) {
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

    const retryFraction = failed / Math.max(safeTotal, 1)
    if (retryFraction > 0.3 && effectiveSuccessRate < 0.7) {
      recommendations.push("High retry rate (>30%) with low recent success rate. Consider adding more explicit verification criteria to plan steps.")
    }

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
      // Use sliding window rate when available, fall back to cumulative
      successRate: effectiveSuccessRate,
      retryRate: retryFraction,
      avgRetriesPerFailure: failed > 0
        ? useStepStates
          ? this.stepStates.length / failed
          : this.tasks.length / failed
        : 0,
      topErrorCategories: topErrors,
      skillEffectiveness: skillEff,
      toolUsage: toolStats,
      recommendations,
    }
  }

  private analyzeSkills(): SkillPatch[] {
    const patches: SkillPatch[] = []

    for (const skill of this.skills) {
      if (skill.successRate >= 0.8) continue

      const def = skill.definition
      const suggestions: SkillPatch["suggestedChanges"] = []

      const failureScenarios = def.quality.failureScenarios ?? []
      for (const scenario of failureScenarios) {
        const sc = scenario.toLowerCase()
        if (sc.includes("rollback") || sc.includes("undo")) {
          suggestions.push({
            type: "add_rollback",
            description: "Add rollback step for failed operations",
            detail: "Each step that modifies state should have a corresponding undo action",
          })
        }
        if (sc.includes("timeout") || sc.includes("slow")) {
          suggestions.push({
            type: "add_step",
            description: "Add timeout/retry wrapper step",
            detail: "Wrap long-running operations with retry: utils/retry.ts handles exponential backoff",
          })
        }
        if (sc.includes("missing") || sc.includes("not found")) {
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
      .filter(([, count]) => count >= 3)  // Higher threshold to reduce noise-induced role suggestions
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

    // Also consider error categories from episodes
    const errorCategoryFailures = new Map<string, number>()
    for (const ep of this.episodes) {
      if (ep.outcome !== "success") {
        for (const tag of ep.tags) {
          errorCategoryFailures.set(tag, (errorCategoryFailures.get(tag) ?? 0) + 1)
        }
      }
    }
    const secKeywords = ["security", "vulnerability", "injection"]
    if ([...errorCategoryFailures.entries()].some(([k, v]) => secKeywords.includes(k) && v >= 2)) {
      if (!suggestions.some(s => s.name === "Security Auditor")) {
        suggestions.push({
          name: "Security Auditor",
          triggerPattern: "error categories involving security",
          suggestedTools: ["read", "grep", "agentic_guard", "agentic_verify"],
          reason: "Security-related errors detected across multiple episodes. A dedicated security role could prevent these.",
        })
      }
    }

    // Coordinator suggestion: consider also failure rate per role
    const hasCoordinator = taskOutcomes.has("coordinator")
    const highFailRoles = [...taskOutcomes.entries()].filter(([, v]) => v.total > 3 && v.failed / v.total > 0.4)
    if ((!hasCoordinator && this.tasks.length > 10) || highFailRoles.length >= 2) {
      suggestions.push({
        name: "Task Coordinator",
        triggerPattern: "multi-step tasks with cross-cutting concerns",
        suggestedTools: ["agentic_plan", "agentic_status", "agentic_delegate", "agentic_parallel"],
        reason: `${this.tasks.length} task(s) and ${highFailRoles.length} role(s) with >40% failure rate. A coordinator could improve orchestration.`,
      })
    }

    return suggestions.slice(0, 5)
  }

  /**
   * Generate prompt patches from recurring error patterns (Gap #1: prompt auto-patching).
   * Maps error categories → specific instruction additions for the relevant agent role.
   */
  private suggestPromptPatches(metrics: EvolutionMetrics): PromptPatch[] {
    return this.buildPromptPatches(metrics.topErrorCategories)
  }

  private errorToPatchConfig: Array<{
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

  setPromptPatchConfig(config: typeof SelfEvolver.prototype.errorToPatchConfig): void {
    this.errorToPatchConfig = config
  }

  private buildPromptPatches(topErrorCategories: Array<{ category: string; count: number }>): PromptPatch[] {
    const patches: PromptPatch[] = []

    for (const errCat of topErrorCategories) {
      const mapping = this.errorToPatchConfig.find(e => e.category === errCat.category)
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
