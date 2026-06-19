import type { SharedMemoryEntry, AgentCoordinator } from "./coordinator.js"
import type { LLMEngine } from "../core/llm.js"
import type { BudgetTracker } from "../core/budget-tracker.js"
import type { EventBus } from "../core/event-bus.js"
import { parseFileEntries, writeFiles, recordCompletion } from "../core/execution-helpers.js"

export interface PipelineStage {
  role: string
  description: string
  validationCriteria?: string[]
  model?: string
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
  private llmEngine: LLMEngine | null = null

  setLLMEngine(engine: LLMEngine): void {
    this.llmEngine = engine
  }

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

  async crossValidate(
    targetRole: string,
    output: string,
    allStageResults: Map<string, { output: string; issues: string[]; validatedBy: string[] }>,
  ): Promise<CrossValidationResult> {
    const issues: CrossValidationResult["issues"] = []

    // Basic structural checks
    for (const [role, result] of allStageResults) {
      if (role === targetRole) continue
      if (!result.output || result.output.trim().length === 0) {
        issues.push({ severity: "warning", description: `Output from ${role} stage appears empty or incomplete`, source: role })
      }
    }

    // Semantic validation via LLM (if available)
    if (this.llmEngine && allStageResults.size >= 2) {
      const previousStages = [...allStageResults].filter(([r]) => r !== targetRole)
      const previousOutputs = previousStages.map(([r, res]) => `### ${r}\n${res.output.slice(0, 1000)}`).join("\n\n")

      const validationPrompt = `You are a cross-validator. Compare the outputs of different stages in a software engineering pipeline. Identify any inconsistencies, contradictions, or missing pieces between stages.

Previous stage outputs:
${previousOutputs}

Current stage (${targetRole}) output:
${output.slice(0, 1500)}

Check:
1. Does the current output contradict any previous stage?
2. Are there requirements from earlier stages that are not addressed?
3. Are there any gaps or missing pieces?

Return your analysis as JSON with:
- "passed": boolean
- "issues": array of { "severity": "error"|"warning"|"info", "description": string, "source": string }
- "summary": string`

      try {
        const llmResp = await this.llmEngine.call({
          systemPrompt: "You are a strict cross-validator. Compare pipeline stage outputs for consistency.",
          userPrompt: validationPrompt,
          jsonMode: true,
          temperature: 0.1,
          maxTokens: 1024,
        })
        const parsed = JSON.parse(llmResp.content)
        if (parsed.issues && Array.isArray(parsed.issues)) {
          for (const issue of parsed.issues) {
            if (issue.severity && issue.description && !issues.some(i => i.description === issue.description)) {
              issues.push({
                severity: issue.severity as "error" | "warning" | "info",
                description: issue.description,
                source: issue.source ?? "llm-validator",
              })
            }
          }
        }
      } catch { /* LLM call failed, fall through */ }
    }

    const passed = issues.filter(i => i.severity === "error").length === 0
    const summary = passed
      ? `Cross-validation passed: ${allStageResults.size} stages reviewed, no critical issues`
      : `Cross-validation found ${issues.length} issue(s): ${issues.filter(i => i.severity === "error").length} error(s), ${issues.filter(i => i.severity === "warning").length} warning(s)`

    return { stage: targetRole, targetStage: "<all>", issues, passed, summary }
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

  /**
   * Internal pipeline orchestrator — runs all stages via LLM, no manual delegation needed.
   * Reused by both `agentic_pipeline run` and `agentic_auto` (Stage V).
   * Returns { results: Map<role, output>, allFiles: string[], pipelineReview: string, hasNoLLM: bool }
   */
  async executePipeline(params: {
    pipeline: WorkflowPipeline
    runId: string
    goal: string
    constraints?: string[]
    projectDir: string
    codebaseSummary: string
    filesBlock: string
    memoryContexts: string[]
    skillContexts: string[]
    coordinator: AgentCoordinator
    sessionID: string
    budgetTracker?: BudgetTracker
    eventBus?: EventBus
    /** HallucinationGuard instance (for auto-check during completion recording) */
    hallucinationGuard?: import("../drift/hallucination-guard.js").HallucinationGuard
    /** SkillStore instance (for auto-extract during completion recording) */
    skillStore?: import("../memory/skill-store.js").SkillStore
    /** ConfigLoader instance (for autoSkillExtract flag check) */
    configLoader?: import("../core/config.js").ConfigLoader
  }): Promise<{
    results: Map<string, { output: string; issues: string[]; validatedBy: string[] }>
    allFiles: string[]
    pipelineReview: string
    hasNoLLM: boolean
    budgetExceeded: boolean
    verifyNote: string
    completedStageCount: number
  }> {
    const { pipeline, runId, goal, constraints, projectDir, codebaseSummary, filesBlock, memoryContexts, skillContexts, coordinator, sessionID, budgetTracker } = params
    const allFiles: string[] = []
    let pipelineReview = ""
    let verifyNote = ""
    let hasNoLLM = false
    let budgetExceeded = false
    let completedStageCount = 0

    const sysPrompts: Record<string, string> = {
      pm: `You are a PM. Define requirements and acceptance criteria concisely. Return JSON: {"spec": "...", "criteria": ["..."]}`,
      architect: `You are an architect. Design architecture and interface contracts. Return JSON: {"architecture": "...", "interfaces": [{...}], "designNotes": "..."}`,
      developer: `Return JSON array of {path, content}. Write COMPLETE file contents. Rules: ESM imports (.js) · match existing patterns · valid imports. {"files":[{"path":"src/x.ts","content":"..."}]} or {"noChanges":true}`,
      qa: `You are QA. Review the implementation for correctness, edge cases, and regressions. Return JSON: {"issues": [{"severity":"error|warning|info","description":"...","file":"..."}], "summary": "verdict", "passed": true/false}`,
      coordinator: `You are a coordinator. Verify pipeline completion and consistency. Return JSON: {"summary": "...", "gaps": ["..."], "approved": true/false}`,
    }

    const stageStartTime = Date.now()

    for (const stage of pipeline.stages) {
      // ── Synchronous budget check BEFORE each stage (direct call, not event) ──
      // Cek kedua scope — strictest-wins (sesuai desain awal agentic_budget)
      if (budgetTracker) {
        const sessionStatus = budgetTracker.check("session")
        if (sessionStatus) {
          budgetExceeded = true
          verifyNote = `⛔ Budget exceeded (session): ${sessionStatus.metric} (${sessionStatus.current} > ${sessionStatus.limit})`
          break
        }
        const taskStatus = budgetTracker.check("task")
        if (taskStatus) {
          budgetExceeded = true
          verifyNote = `⛔ Budget exceeded (task): ${taskStatus.metric} (${taskStatus.current} > ${taskStatus.limit})`
          break
        }
      }

      const stageTaskId = `pipeline-${stage.role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

      coordinator.delegate(stage.role, {
        id: stageTaskId, assignedTo: stage.role,
        description: `${goal} — ${stage.description}`,
        input: stage.description, status: "running",
        pipelineRunId: runId,
      }, sessionID, 0)

      coordinator.writeSharedMemory(`pipeline:${stage.role}:start`, stage.description, stage.role)

      const pipelineContextHints = [...memoryContexts.slice(0, 2), ...skillContexts.slice(0, 1)].join("; ")
      const stageCtx = this.buildContextForRole(stage.role, runId, coordinator.getAllSharedMemory())
      const sp = sysPrompts[stage.role] ?? `You are ${stage.role}. Complete your task. Return JSON output.`

      const up = `Goal: ${goal}${constraints?.length ? `\nConstraints: ${constraints.join(", ")}` : ""}${pipelineContextHints ? `\nPast tasks: ${pipelineContextHints}` : ""}${stageCtx ? `\n\nContext from previous stages:\n${stageCtx}` : ""}\n${stage.role} task: ${stage.description}\n${filesBlock || "(new)"}\n${codebaseSummary.slice(0, 100)}`

      // ── LLM call with try/catch for partial-save ──
      let raw: string
      try {
        const llmOut = await this.llmEngine!.call({
          systemPrompt: sp, userPrompt: up,
          temperature: 0.2, maxTokens: 2048, jsonMode: true,
          sourceTaskId: stageTaskId,
          sourcePipelineRunId: runId,
        })
        raw = llmOut.content || ""
      } catch (err) {
        // Partial-save: pipeline tetap return hasil stage yang sudah sukses
        verifyNote = `❌ Stage ${stage.role} crashed: ${(err as Error).message ?? err}`
        coordinator.updateTask(sessionID, stageTaskId, "failed", `LLM call failed: ${(err as Error).message ?? err}`)
        break
      }

      const isFail = raw.includes("[NO_LLM]") || raw === "NO_LLM"
      if (isFail) { hasNoLLM = true; break }

      coordinator.updateTask(sessionID, stageTaskId, "done", raw.slice(0, 1000))

      // ── Developer stage: write files via shared helper ──
      if (stage.role === "developer") {
        const fileEntries = parseFileEntries(raw)
        const written = writeFiles(fileEntries, projectDir, sessionID, params.eventBus, { taskId: stageTaskId, pipelineRunId: runId })
        allFiles.push(...written)

        // Warning kalau developer tidak menghasilkan file
        if (written.length === 0 && !raw.includes("noChanges") && !raw.includes("NO_CHANGES")) {
          verifyNote = "⚠️ Developer stage: no files written (parsing may have failed)"
        }
        coordinator.writeSharedMemory("pipeline:files", allFiles.join(", "), "developer")
      }

      // ── QA stage: parse review ──
      if (stage.role === "qa") {
        try {
          const qaParsed = JSON.parse(raw)
          pipelineReview = qaParsed.summary?.slice(0, 200) ?? raw.slice(0, 200)
          if (!qaParsed.passed) verifyNote = `⚠️ QA: ${qaParsed.summary?.slice(0, 100) ?? "issues found"}`
          else verifyNote = "✅ QA passed"
        } catch { pipelineReview = raw.slice(0, 200) }
      }

      // ── Blocking completion record: guard + skill + step count ──
      // TANPA AND-gate — setiap concern independen di dalam recordCompletion().
      // Guard gak butuh skill, skill gak butuh budget, masing-masing jalan sendiri.
      await recordCompletion({
        sessionID,
        taskId: stageTaskId,
        pipelineRunId: runId,
        output: raw,
        filesModified: allFiles,
        durationMs: Date.now() - stageStartTime,
        role: stage.role,
        skipSkillExtract: stage.role !== "developer" || allFiles.length === 0,
      }, {
        budgetTracker,
        hallucinationGuard: params.hallucinationGuard,
        skillStore: params.skillStore,
        configLoader: params.configLoader,
        eventBus: params.eventBus,
      })

      completedStageCount++
    }

    // Cross-validate between stages
    if (completedStageCount >= 2 && !budgetExceeded && !hasNoLLM) {
      try {
        const allStageResults = this.getAllStageResults(runId)
        if (allStageResults.size >= 2) {
          const xv = await this.crossValidate("coordinator", goal, allStageResults)
          if (!xv.passed) verifyNote += ` ⚠️ Cross-validation: ${xv.issues.length} issues`
        }
      } catch { /* non-fatal */ }
    }

    const allPipelineStages = pipeline.stages.map(s => s.role)
    coordinator.writeSharedMemory("pipeline:stages", allPipelineStages.join(","), "coordinator")

    return {
      results: this.getAllStageResults(runId),
      allFiles,
      pipelineReview,
      hasNoLLM,
      budgetExceeded,
      verifyNote,
      completedStageCount,
    }
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
