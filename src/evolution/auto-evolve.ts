/**
 * Auto-evolution helpers extracted from src/index.ts.
 *
 * Both functions now receive dependencies via ToolContext parameter
 * instead of closing over the createEngine scope.
 */
import type { ToolContext } from "../tools/tool-context.js"
import { readFileSync } from "node:fs"
import type { AgentTask } from "../agents/coordinator.js"

/**
 * Collect evolution data from all subsystems and feed to selfEvolver.
 */
export async function gatherEvolutionData(deps: ToolContext): Promise<{
  allEpisodes: import("../memory/episodic-store.js").Episode[]
  allStepStates: Array<{ stepId: string; success: boolean; output: string }>
  traces: Array<{ toolUsed: string; success: boolean; step: string }>
}> {
  const {
    traceLogger, skillStore, episodicStore, coordinator, sessionStore,
    executor, worktree, log, selfEvolver,
  } = deps

  await traceLogger.flush()
  const allSkills = skillStore.getAll()
  const allEpisodes = episodicStore.getRecent(50)
  const uniqueSessions = new Set(allEpisodes.map(e => e.sessionId))
  let allTasks: AgentTask[] = []
  for (const sid of uniqueSessions) {
    allTasks = allTasks.concat(coordinator.getTasks(sid))
  }
  const allStepStates: Array<{ stepId: string; success: boolean; output: string }> = []
  for (const sid of uniqueSessions) {
    const session = sessionStore.getOrCreate(sid)
    const subtasks = session.plan?.intent.subtasks ?? []
    for (const step of subtasks) {
      const state = executor.getStepState(sid, step.id)
      if (state?.result) {
        allStepStates.push({ stepId: step.id, success: state.result.success, output: state.result.output })
      }
    }
  }
  const traces: Array<{ toolUsed: string; success: boolean; step: string }> = []
  const tracePath = `${worktree}/.agentic/trace.jsonl`
  try {
    for (const line of readFileSync(tracePath, "utf-8").trim().split("\n").filter(Boolean)) {
      const parsed = JSON.parse(line)
      traces.push({ toolUsed: parsed.toolUsed ?? "unknown", success: parsed.success ?? true, step: parsed.step ?? "" })
    }
  } catch (e) { log.warn("Silent catch: no traces yet", { error: String(e) }) }
  selfEvolver.feedSkills(allSkills)
  selfEvolver.feedEpisodes(allEpisodes)
  selfEvolver.feedTasks(allTasks)
  selfEvolver.feedStepStates(allStepStates)
  selfEvolver.feedTraces(traces)
  return { allEpisodes, allStepStates, traces }
}

/**
 * Run the full self-evolution cycle and return a summary.
 */
export async function runAutoEvolve(deps: ToolContext): Promise<string> {
  await gatherEvolutionData(deps)

  const {
    worktree, log, rag: multiIndexRAG, selfEvolver,
    coordinator, skillStore, stateStore, roleRegistry,
  } = deps

  // Index trace entries into TF-IDF vector store
  try {
    const tracePath = `${worktree}/.agentic/trace.jsonl`
    const content = readFileSync(tracePath, "utf-8")
    const lines = content.trim().split("\n").filter(Boolean)
    const recentTraces = lines.slice(-200)
    for (const line of recentTraces) {
      try {
        const parsed = JSON.parse(line)
        const tool = parsed.toolUsed ?? "unknown"
        const input = parsed.input ?? ""
        const output = parsed.output ?? ""
        const step = parsed.step ?? ""
        multiIndexRAG.vectorStore.index({
          id: `trace:${parsed.timestamp ?? Date.now()}`,
          category: "general",
          title: `${tool}: ${String(input).slice(0, 80)}`,
          content: `${tool} ${step} ${String(output).slice(0, 200)} ${String(input).slice(0, 200)}`,
          keywords: [tool, step, ...String(input).toLowerCase().split(/\W+/).filter(Boolean).slice(0, 10)],
          metadata: { type: "trace", tool, success: parsed.success, timestamp: parsed.timestamp },
        })
      } catch (e) { log.warn("Silent catch: skip corrupted line", { error: String(e) }) }
    }
  } catch (e) { log.warn("Silent catch: no trace file yet", { error: String(e) }) }

  const report = selfEvolver.evolve()

  // Auto-apply role suggestions
  const appliedRoles: string[] = []
  for (const role of report.roleSuggestions) {
    try {
      coordinator.registerCustomRole({
        role: role.name,
        name: role.name,
        tools: role.suggestedTools,
        prompt: `You are ${role.name}. ${role.reason}\n\nTrigger: ${role.triggerPattern}`,
      })
      appliedRoles.push(role.name)
    } catch (e) { log.warn("Silent catch: non-fatal", { error: String(e) }) }
  }

  // Auto-apply skill patches
  const patchedSkills: string[] = []
  for (const patch of report.skillPatches) {
    const record = skillStore.getById(patch.skillId)
    if (!record) continue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const def = record.definition as any
    let modified = false

    for (const change of patch.suggestedChanges) {
      if (change.type === "add_rollback") {
        for (const step of def.workflow.steps) {
          if (!step.rollback) {
            step.rollback = change.detail
            modified = true
          }
        }
      }
      if (change.type === "add_step") {
        const newStep = {
          order: def.workflow.steps.length + 1,
          action: "verify",
          description: change.detail,
          expectedOutput: "Step completed successfully",
        }
        def.workflow.steps.push(newStep)
        modified = true
      }
    }

    if (modified) {
      def.quality.usageCount = record.usageCount
      def.quality.successRate = record.successRate
      def.audit.lastModified = new Date().toISOString()
      def.audit.modifiedBy = "system"
      def.meta.version++
      stateStore.set("skills", def.meta.id, def)
      patchedSkills.push(patch.skillName)
    }
  }

  // Auto-apply prompt patches
  const appliedPatches: string[] = []
  for (const patch of report.promptPatches) {
    try {
      const existingPrompt = roleRegistry.getPrompt(patch.role)
      if (existingPrompt && !existingPrompt.includes(patch.instruction.slice(0, 40))) {
        const newPrompt = existingPrompt + `\n\n## Auto-Patched Instruction (from ${patch.errorCategory} errors)\n${patch.instruction}`
        roleRegistry.updatePrompt(patch.role, newPrompt, "auto-evolve", `Patch from ${patch.errorCategory} errors (${patch.occurrences}x)`)
        stateStore.set("prompts", "state", roleRegistry.getAllPromptStates())
        appliedPatches.push(`${patch.role}: "${patch.instruction.slice(0, 60)}..."`)
      }
    } catch (e) { log.warn("Silent catch: non-fatal", { error: String(e) }) }
  }

  let result = `### 🔮 Auto-Evolution Complete\n`
  result += `**Score:** ${report.improvementScore}/100\n`
  result += `**Sessions:** ${report.metrics.totalSessions} | **Steps:** ${report.metrics.totalSteps} | **Success Rate:** ${(report.metrics.successRate * 100).toFixed(0)}%\n`
  if (appliedRoles.length > 0) result += `**Roles Registered:** ${appliedRoles.join(", ")}\n`
  if (patchedSkills.length > 0) result += `**Skills Patched:** ${patchedSkills.join(", ")}\n`
  if (appliedPatches.length > 0) result += `**Prompts Patched:** ${appliedPatches.length}\n`
  if (appliedRoles.length === 0 && patchedSkills.length === 0 && appliedPatches.length === 0) {
    result += "No changes needed — system is healthy.\n"
  }
  return result.trim()
}
