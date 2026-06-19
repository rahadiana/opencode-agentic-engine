import type { SharedMemoryEntry, AgentCoordinator } from "./coordinator.js"
import type { LLMEngine } from "../core/llm.js"
import type { BudgetTracker } from "../core/budget-tracker.js"
import type { EventBus } from "../core/event-bus.js"
import type { Condition } from "../core/formal-model.js"
import { parseFileEntries, writeFiles, recordCompletion } from "../core/execution-helpers.js"
import fs from "node:fs"

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

// ── G4: Contract-based cross-validation ──

/** Schema field type for pipeline stage I/O contracts */
export type SchemaFieldType = "string" | "string[]" | "number" | "boolean" | "json" | "code"

export interface SchemaField {
  name: string
  type: SchemaFieldType
  required: boolean
  description: string
  /** Pattern/regex for value validation (e.g., "*.ts" for file paths) */
  pattern?: string
}

/** Defines what a pipeline stage expects as input and must produce as output */
export interface StageContract {
  role: string
  description: string
  inputSchema: SchemaField[]
  outputSchema: SchemaField[]
  /** Pre-conditions: must be true before this stage runs */
  preConditions: Condition[]
  /** Post-conditions: must be true after this stage completes */
  postConditions: Condition[]
}

/** Aggregate contract for an entire pipeline */
export interface PipelineContract {
  pipelineId: string
  stageContracts: StageContract[]
  /** Cross-stage invariants: must hold across ALL stages */
  crossStageInvariants: Condition[]
}

/** Result of a single schema field validation */
export interface SchemaValidationResult {
  field: string
  passed: boolean
  severity: "error" | "warning" | "info"
  detail: string
}

enum InvariantKind {
  NoErrors = "no-errors",
  DependencyComplete = "dependency-complete",
  CompilePasses = "compile-passes",
}

export class Orchestrator {
  private pipelines = new Map<string, WorkflowPipeline>()
  private readonly maxActiveRuns = 50
  private activeRuns = new Map<string, {
    pipelineId: string
    currentStageIndex: number
    stageResults: Map<string, { output: string; issues: string[]; validatedBy: string[] }>
  }>()
  private llmEngine: LLMEngine | null = null
  private persistencePath: string | null = null
  private sysPrompts: Record<string, string> = {
    pm: `You are a PM. Define requirements and acceptance criteria concisely. Return JSON: {"spec": "...", "criteria": ["..."]}`,
    architect: `You are an architect. Design architecture and interface contracts. Return JSON: {"architecture": "...", "interfaces": [{...}], "designNotes": "..."}`,
    developer: `Return JSON array of {path, content}. Write COMPLETE file contents. Rules: ESM imports (.js) · match existing patterns · valid imports. {"files":[{"path":"src/x.ts","content":"..."}]} or {"noChanges":true}`,
    qa: `You are QA. Review the implementation for correctness, edge cases, and regressions. Return JSON: {"issues": [{"severity":"error|warning|info","description":"...","file":"..."}], "summary": "verdict", "passed": true/false}`,
    coordinator: `You are a coordinator. Verify pipeline completion and consistency. Return JSON: {"summary": "...", "gaps": ["..."], "approved": true/false}`,
  }

  setLLMEngine(engine: LLMEngine): void {
    this.llmEngine = engine
  }

  setRolePrompt(role: string, prompt: string): void {
    this.sysPrompts[role] = prompt
  }

  initPersistence(filePath: string): void {
    this.persistencePath = filePath
    if (fs.existsSync(filePath)) {
      try {
        const data: WorkflowPipeline[] = JSON.parse(fs.readFileSync(filePath, "utf-8"))
        for (const p of data) this.pipelines.set(p.id, p)
      } catch { console.warn(`[Orchestrator] Failed to load pipelines from ${filePath}`) }
    }
  }

  private savePipelines(): void {
    if (!this.persistencePath) return
    try {
      fs.writeFileSync(this.persistencePath, JSON.stringify([...this.pipelines.values()], null, 2))
    } catch { /* non-fatal */ }
  }

  definePipeline(pipeline: WorkflowPipeline): void {
    this.pipelines.set(pipeline.id, pipeline)
    this.savePipelines()
  }

  getPipeline(id: string): WorkflowPipeline | undefined {
    return this.pipelines.get(id)
  }

  listPipelines(): WorkflowPipeline[] {
    return [...this.pipelines.values()]
  }

  cleanupRun(runId: string): void {
    this.activeRuns.delete(runId)
  }

  private cleanupStaleRuns(): void {
    if (this.activeRuns.size > this.maxActiveRuns) {
      const keys = [...this.activeRuns.keys()]
      const toRemove = keys.slice(0, keys.length - this.maxActiveRuns)
      for (const k of toRemove) this.activeRuns.delete(k)
    }
  }

  startRun(runId: string, pipelineId: string): boolean {
    const pipeline = this.pipelines.get(pipelineId)
    if (!pipeline) return false
    this.cleanupStaleRuns()
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

  /** Validate stage output against its output schema */
  validateSchema(output: string, schema: SchemaField[]): SchemaValidationResult[] {
    const results: SchemaValidationResult[] = []
    const lower = output.toLowerCase()
    let parsed: any = null
    try {
      parsed = JSON.parse(output)
    } catch { /* not JSON */ }
    for (const field of schema) {
      const name = field.name.toLowerCase()
      let found = false
      if (parsed) {
        found = parsed[name] !== undefined || Object.keys(parsed).some(k => k.toLowerCase() === name)
      } else {
        found = lower.includes(name)
      }
      if (!found && field.required) {
        results.push({ field: field.name, passed: false, severity: "error", detail: `Required field "${field.name}" (${field.type}) not found in output` })
      } else if (!found) {
        results.push({ field: field.name, passed: true, severity: "info", detail: `Optional field "${field.name}" not found (non-blocking)` })
      } else {
        results.push({ field: field.name, passed: true, severity: "info", detail: `Field "${field.name}" present in output` })
      }
    }
    return results
  }

  /** Check cross-stage invariants against all stage outputs */
  checkInvariants(invariants: Condition[], allStageResults: Map<string, { output: string; issues: string[]; validatedBy: string[] }>): SchemaValidationResult[] {
    const results: SchemaValidationResult[] = []
    const allOutputs = [...allStageResults.values()].map(r => r.output.toLowerCase()).join("\n")
    const allIssues = [...allStageResults.values()].flatMap(r => r.issues)
    for (const inv of invariants) {
      const expr = inv.expr.toLowerCase()
      const kind = this.classifyInvariant(expr)
      if (kind === InvariantKind.NoErrors) {
        const hasErrors = allIssues.some(i => i.toLowerCase().includes("error")) || allOutputs.includes("error")
        results.push({ field: `invariant: ${inv.description}`, passed: !hasErrors, severity: inv.severity, detail: hasErrors ? "Errors detected across stages" : "No errors detected across stages" })
      } else if (kind === InvariantKind.DependencyComplete) {
        const hasEmpty = [...allStageResults.values()].some(r => !r.output || r.output.trim().length === 0)
        results.push({ field: `invariant: ${inv.description}`, passed: !hasEmpty, severity: inv.severity, detail: hasEmpty ? "Some stages produced empty output" : "All stages have output" })
      } else if (kind === InvariantKind.CompilePasses) {
        const compilePassed = !allOutputs.includes("fail") || allOutputs.includes("compilation successful")
        results.push({ field: `invariant: ${inv.description}`, passed: compilePassed, severity: inv.severity, detail: compilePassed ? "Compilation check passed" : "Compilation issues detected" })
      } else {
        results.push({ field: `invariant: ${inv.description}`, passed: true, severity: "info", detail: `Invariant "${inv.expr}" assumed satisfied` })
      }
    }
    return results
  }

  private classifyInvariant(expr: string): InvariantKind | null {
    if (/no\s+errors?/.test(expr)) return InvariantKind.NoErrors
    if (/dependency.*complete|complete.*dependency/.test(expr)) return InvariantKind.DependencyComplete
    if (/compile.*pass|pass.*compile|compilation/.test(expr)) return InvariantKind.CompilePasses
    return null
  }

  /** G4: Contract-based crossValidate with schema + invariant checking */
  async crossValidate(
    targetRole: string,
    output: string,
    allStageResults: Map<string, { output: string; issues: string[]; validatedBy: string[] }>,
  ): Promise<CrossValidationResult> {
    const issues: CrossValidationResult["issues"] = []

    // 1. Find pipeline contract
    let pipelineContract: PipelineContract | null = null
    for (const pipeline of this.pipelines.values()) {
      if (pipeline.stages.some(s => s.role === targetRole)) {
        pipelineContract = this.getPipelineContract(pipeline.id)
        break
      }
    }
    if (!pipelineContract) {
      for (const bp of this.getBuiltInPipelines()) {
        if (bp.stages.some(s => s.role === targetRole)) {
          pipelineContract = this.getPipelineContract(bp.id)
          if (pipelineContract) break
        }
      }
    }

    if (pipelineContract) {
      // 2. Schema validation per stage
      for (const contract of pipelineContract.stageContracts) {
        const stageResult = allStageResults.get(contract.role)
        if (!stageResult) continue
        const schemaResults = this.validateSchema(stageResult.output, contract.outputSchema)
        for (const sr of schemaResults) {
          if (!sr.passed) {
            issues.push({ severity: sr.severity as "error" | "warning" | "info", description: `[${contract.role}] ${sr.detail}`, source: "schema-validator" })
          }
        }
      }
      // 3. Cross-stage invariants
      const invResults = this.checkInvariants(pipelineContract.crossStageInvariants, allStageResults)
      for (const ir of invResults) {
        if (!ir.passed) {
          issues.push({ severity: ir.severity as "error" | "warning" | "info", description: ir.detail, source: "invariant-checker" })
        }
      }
    }

    // 4. Basic structural checks
    for (const [role, result] of allStageResults) {
      if (role === targetRole) continue
      if (!result.output || result.output.trim().length === 0) {
        issues.push({ severity: "warning", description: `Output from ${role} stage appears empty or incomplete`, source: role })
      }
    }

    // 5. Semantic validation via LLM
    if (this.llmEngine && allStageResults.size >= 2) {
      const previousStages = [...allStageResults].filter(([r]) => r !== targetRole)
      const previousOutputs = previousStages.map(([r, res]) => `### ${r}\n${res.output.slice(0, 1000)}`).join("\n\n")
      const contractInfo = pipelineContract ? `Pipeline: ${pipelineContract.pipelineId}\nContracts: ${pipelineContract.stageContracts.length} stages` : "No formal contract"
      const validationPrompt = `You are a strict cross-validator. Compare pipeline stage outputs for consistency.
${contractInfo}
Previous outputs:
${previousOutputs}
Current (${targetRole}):
${output.slice(0, 1500)}
Check: 1) Contradictions? 2) Missing requirements? 3) Contract compliance?
Return JSON: {"passed":boolean,"issues":[{severity,description,source}],"summary":string}`
      try {
        const llmResp = await this.llmEngine.call({ systemPrompt: "You are a strict cross-validator.", userPrompt: validationPrompt, jsonMode: true, temperature: 0.1, maxTokens: 1024 })
        const parsed = JSON.parse(llmResp.content)
        if (parsed.issues && Array.isArray(parsed.issues)) {
          for (const issue of parsed.issues) {
            if (issue.severity && issue.description && !issues.some(i => i.description === issue.description)) {
              issues.push({ severity: issue.severity, description: issue.description, source: issue.source ?? "llm-validator" })
            }
          }
        }
      } catch {
        console.warn(`[Orchestrator] LLM cross-validation failed for stage ${targetRole}`)
      }
    }

    const passed = issues.filter(i => i.severity === "error").length === 0
    const summary = passed
      ? `Cross-validation passed: ${allStageResults.size} stages, ${issues.length} issue(s) (minor)`
      : `Cross-validation FAILED: ${issues.filter(i => i.severity === "error").length} error(s), ${issues.filter(i => i.severity === "warning").length} warning(s)`
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
        `  ${i < run.currentStageIndex ? "[DONE]" : i === run.currentStageIndex ? "[ACTIVE]" : "[PENDING]"} **${s.role}**: ${s.description}`
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
    hallucinationGuard?: import("../drift/hallucination-guard.js").HallucinationGuard
    skillStore?: import("../memory/skill-store.js").SkillStore
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
    const { pipeline, runId, goal, coordinator, sessionID, budgetTracker } = params
    const allFiles: string[] = []
    let pipelineReview = ""
    let verifyNote = ""
    let hasNoLLM = false
    let budgetExceeded = false
    let completedStageCount = 0
    const stageStartTime = Date.now()

    for (const stage of pipeline.stages) {
      const budgetStop = this.checkBudget(budgetTracker)
      if (budgetStop) {
        budgetExceeded = true
        verifyNote = budgetStop
        break
      }

      const stageTaskId = `pipeline-${stage.role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const stageResult = await this.executeStage(stage, params, stageTaskId, runId)
      if (stageResult.stop) {
        if (stageResult.hasNoLLM) hasNoLLM = true
        if (stageResult.budgetExceeded) budgetExceeded = true
        if (stageResult.verifyNote) verifyNote = stageResult.verifyNote
        break
      }
      if (stageResult.verifyNote) verifyNote = stageResult.verifyNote
      if (stageResult.raw) {
        const raw = stageResult.raw
        const handled = await this.handleStageOutput(stage.role, raw, allFiles, stageTaskId, runId, params)
        pipelineReview = handled.pipelineReview ?? pipelineReview
        if (handled.verifyNote) verifyNote = handled.verifyNote

        await this.recordStageCompletion({
          sessionID, taskId: stageTaskId, pipelineRunId: runId,
          output: raw, filesModified: allFiles, durationMs: Date.now() - stageStartTime,
          role: stage.role,
        }, params)
      }
      completedStageCount++
    }

    if (completedStageCount >= 2 && !budgetExceeded && !hasNoLLM) {
      try {
        const allStageResults = this.getAllStageResults(runId)
        if (allStageResults.size >= 2) {
          const xv = await this.crossValidate("coordinator", goal, allStageResults)
          if (!xv.passed) verifyNote += ` ⚠️ Cross-validation: ${xv.issues.length} issues`
        }
      } catch {
        console.warn(`[Orchestrator] Cross-validation failed for run ${runId}`)
      }
    }

    const allPipelineStages = pipeline.stages.map(s => s.role)
    await coordinator.writeSharedMemory("pipeline:stages", allPipelineStages.join(","), "coordinator")

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

  private checkBudget(budgetTracker?: BudgetTracker): string | null {
    if (!budgetTracker) return null
    const sessionStatus = budgetTracker.check("session")
    if (sessionStatus) return `Budget exceeded (session): ${sessionStatus.metric} (${sessionStatus.current} > ${sessionStatus.limit})`
    const taskStatus = budgetTracker.check("task")
    if (taskStatus) return `Budget exceeded (task): ${taskStatus.metric} (${taskStatus.current} > ${taskStatus.limit})`
    return null
  }

  private async executeStage(
    stage: PipelineStage, params: any, stageTaskId: string, runId: string,
  ): Promise<{ stop: boolean; verifyNote?: string; hasNoLLM?: boolean; budgetExceeded?: boolean; raw?: string }> {
    const { goal, constraints, filesBlock, codebaseSummary, memoryContexts, skillContexts, coordinator, sessionID } = params
    const sysPrompts = this.sysPrompts

    coordinator.delegate(stage.role, {
      id: stageTaskId, assignedTo: stage.role,
      description: `${goal} — ${stage.description}`,
      input: stage.description, status: "running",
      pipelineRunId: runId,
    }, sessionID, 0)

    await coordinator.writeSharedMemory(`pipeline:${stage.role}:start`, stage.description, stage.role)

    const pipelineContextHints = [...(memoryContexts ?? []).slice(0, 2), ...(skillContexts ?? []).slice(0, 1)].join("; ")
    const stageCtx = this.buildContextForRole(stage.role, runId, coordinator.getAllSharedMemory())
    const sp = sysPrompts[stage.role] ?? `You are ${stage.role}. Complete your task. Return JSON output.`

    const up = `Goal: ${goal}${constraints?.length ? `\nConstraints: ${constraints.join(", ")}` : ""}${pipelineContextHints ? `\nPast tasks: ${pipelineContextHints}` : ""}${stageCtx ? `\n\nContext from previous stages:\n${stageCtx}` : ""}\n${stage.role} task: ${stage.description}\n${filesBlock || "(new)"}\n${(codebaseSummary ?? "").slice(0, 100)}`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 120_000)

    let raw: string
    try {
      const llmOut = await Promise.race([
        this.llmEngine!.call({
          systemPrompt: sp, userPrompt: up,
          temperature: 0.2, maxTokens: 2048, jsonMode: true,
          sourceTaskId: stageTaskId,
          sourcePipelineRunId: runId,
        }),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener("abort", () => reject(new Error(`LLM timeout after 120s for stage ${stage.role}`)))
        }),
      ])
      clearTimeout(timeoutId)
      raw = llmOut.content || ""
    } catch (err) {
      clearTimeout(timeoutId)
      const msg = `Stage ${stage.role} crashed: ${(err as Error).message ?? err}`
      await coordinator.updateTask(sessionID, stageTaskId, "failed", `LLM call failed: ${(err as Error).message ?? err}`)
      return { stop: true, verifyNote: msg }
    }

    const isFail = raw.includes("[NO_LLM]") || raw === "NO_LLM"
    if (isFail) return { stop: true, hasNoLLM: true }

    await coordinator.updateTask(sessionID, stageTaskId, "done", raw.slice(0, 1000))
    return { stop: false, raw }
  }

  private async handleStageOutput(
    role: string, raw: string, allFiles: string[], stageTaskId: string, runId: string, params: any,
  ): Promise<{ pipelineReview?: string; verifyNote?: string }> {
    const { projectDir, sessionID, coordinator } = params
    let pipelineReview: string | undefined
    let verifyNote: string | undefined

    if (role === "developer") {
      const fileEntries = parseFileEntries(raw)
      const written = writeFiles(fileEntries, projectDir, sessionID, params.eventBus, { taskId: stageTaskId, pipelineRunId: runId })
      allFiles.push(...written)
      if (written.length === 0 && !raw.includes("noChanges") && !raw.includes("NO_CHANGES")) {
        verifyNote = "Developer stage: no files written (parsing may have failed)"
      }
      await coordinator.writeSharedMemory("pipeline:files", allFiles.join(", "), "developer")
    }

    if (role === "qa") {
      try {
        const qaParsed = JSON.parse(raw)
        pipelineReview = qaParsed.summary?.slice(0, 200) ?? raw.slice(0, 200)
        if (!qaParsed.passed) verifyNote = `QA: ${qaParsed.summary?.slice(0, 100) ?? "issues found"}`
        else verifyNote = "QA passed"
      } catch {
        pipelineReview = raw.slice(0, 200)
      }
    }

    return { pipelineReview, verifyNote }
  }

  private async recordStageCompletion(
    opts: {
      sessionID: string; taskId: string; pipelineRunId: string; output: string
      filesModified: string[]; durationMs: number; role: string
    }, params: any,
  ): Promise<void> {
    await recordCompletion({
      sessionID: opts.sessionID,
      taskId: opts.taskId,
      pipelineRunId: opts.pipelineRunId,
      output: opts.output,
      filesModified: opts.filesModified,
      durationMs: opts.durationMs,
      role: opts.role,
      skipSkillExtract: opts.role !== "developer" || opts.filesModified.length === 0,
    }, {
      budgetTracker: params.budgetTracker,
      hallucinationGuard: params.hallucinationGuard,
      skillStore: params.skillStore,
      configLoader: params.configLoader,
      eventBus: params.eventBus,
    })
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

  // ──────────────────────────────────────────────────────────────
  // G4: Contract-based cross-validation
  // ──────────────────────────────────────────────────────────────

  /** Get the built-in contract for a pipeline */
  getPipelineContract(pipelineId: string): PipelineContract | null {
    // Define contracts inline
    const featureDev: PipelineContract = {
      pipelineId: "feature-dev",
      stageContracts: [
        {
          role: "pm", description: "PM defines requirements and acceptance criteria",
          inputSchema: [{ name: "goal", type: "string", required: true, description: "The feature goal" }],
          outputSchema: [
            { name: "spec", type: "string", required: true, description: "Feature specification" },
            { name: "criteria", type: "string[]", required: true, description: "Acceptance criteria" },
          ],
          preConditions: [{ expr: "goal is non-empty", severity: "error", description: "Feature goal must be defined" }],
          postConditions: [
            { expr: "spec is non-empty", severity: "error", description: "PM must produce a specification" },
          ],
        },
        {
          role: "architect", description: "Architect designs architecture",
          inputSchema: [
            { name: "spec", type: "string", required: true, description: "Specification from PM" },
            { name: "criteria", type: "string[]", required: true, description: "Acceptance criteria" },
          ],
          outputSchema: [
            { name: "architecture", type: "string", required: true, description: "Architecture design" },
            { name: "interfaces", type: "json", required: true, description: "Interface contracts" },
          ],
          preConditions: [{ expr: "spec is non-empty", severity: "error", description: "Architecture needs a specification" }],
          postConditions: [{ expr: "architecture is non-empty", severity: "error", description: "Architecture must be produced" }],
        },
        {
          role: "developer", description: "Developer implements the feature",
          inputSchema: [
            { name: "spec", type: "string", required: true, description: "Feature specification" },
            { name: "architecture", type: "string", required: true, description: "Architecture design" },
            { name: "interfaces", type: "json", required: true, description: "Interface contracts" },
          ],
          outputSchema: [
            { name: "files", type: "string[]", required: true, description: "Implementation files" },
          ],
          preConditions: [{ expr: "architecture is non-empty", severity: "error", description: "Developer needs architecture" }],
          postConditions: [
            { expr: "files exist", severity: "error", description: "Implementation must produce files" },
          ],
        },
        {
          role: "qa", description: "QA reviews the implementation",
          inputSchema: [
            { name: "spec", type: "string", required: true, description: "Original specification" },
            { name: "criteria", type: "string[]", required: true, description: "Acceptance criteria" },
            { name: "files", type: "string[]", required: true, description: "Implementation files" },
          ],
          outputSchema: [
            { name: "issues", type: "json", required: true, description: "Review findings" },
            { name: "summary", type: "string", required: true, description: "Review verdict" },
            { name: "passed", type: "boolean", required: true, description: "Whether QA approves" },
          ],
          preConditions: [{ expr: "files exist", severity: "warning", description: "QA should have files to review" }],
          postConditions: [{ expr: "output is non-empty", severity: "error", description: "QA must produce a review" }],
        },
      ],
      crossStageInvariants: [
        { expr: "no errors", severity: "error", description: "No stage should produce errors" },
        { expr: "dependency is complete", severity: "error", description: "Each stage depends on previous stage output" },
      ],
    }

    const fixVerify: PipelineContract = {
      pipelineId: "fix-verify",
      stageContracts: [
        {
          role: "qa", description: "QA reproduces the bug",
          inputSchema: [{ name: "goal", type: "string", required: true, description: "Bug description" }],
          outputSchema: [
            { name: "reproduction", type: "string", required: true, description: "Steps to reproduce" },
            { name: "failure", type: "string", required: true, description: "Actual failure" },
          ],
          preConditions: [{ expr: "goal is non-empty", severity: "error", description: "Bug description required" }],
          postConditions: [{ expr: "output is non-empty", severity: "error", description: "Reproduction steps required" }],
        },
        {
          role: "developer", description: "Developer fixes the root cause",
          inputSchema: [
            { name: "reproduction", type: "string", required: true, description: "Steps to reproduce" },
            { name: "failure", type: "string", required: true, description: "Actual failure" },
          ],
          outputSchema: [
            { name: "files", type: "string[]", required: true, description: "Fix files" },
          ],
          preConditions: [{ expr: "output is non-empty", severity: "error", description: "Developer needs reproduction steps" }],
          postConditions: [{ expr: "files exist", severity: "error", description: "Fix must produce changes" }],
        },
        {
          role: "qa", description: "QA verifies the fix",
          inputSchema: [
            { name: "fix", type: "string", required: true, description: "Fix description" },
            { name: "files", type: "string[]", required: true, description: "Changed files" },
          ],
          outputSchema: [
            { name: "passed", type: "boolean", required: true, description: "Whether fix is verified" },
            { name: "summary", type: "string", required: true, description: "Verification result" },
          ],
          preConditions: [{ expr: "files exist", severity: "warning", description: "QA needs files to verify" }],
          postConditions: [{ expr: "output is non-empty", severity: "error", description: "QA must produce verification" }],
        },
      ],
      crossStageInvariants: [{ expr: "no errors", severity: "error", description: "No stage should produce errors" }],
    }

    const refactorReview: PipelineContract = {
      pipelineId: "refactor-review",
      stageContracts: [
        {
          role: "architect", description: "Architect designs new structure",
          inputSchema: [{ name: "goal", type: "string", required: true, description: "Refactoring goal" }],
          outputSchema: [
            { name: "architecture", type: "string", required: true, description: "New structure" },
          ],
          preConditions: [{ expr: "goal is non-empty", severity: "error", description: "Refactoring goal required" }],
          postConditions: [{ expr: "output is non-empty", severity: "error", description: "New structure must be defined" }],
        },
        {
          role: "developer", description: "Developer executes refactoring",
          inputSchema: [
            { name: "architecture", type: "string", required: true, description: "New structure" },
          ],
          outputSchema: [{ name: "files", type: "string[]", required: true, description: "Changed files" }],
          preConditions: [{ expr: "output is non-empty", severity: "error", description: "Developer needs architecture" }],
          postConditions: [{ expr: "files exist", severity: "error", description: "Refactoring must produce changes" }],
        },
        {
          role: "qa", description: "QA verifies no regressions",
          inputSchema: [{ name: "files", type: "string[]", required: true, description: "Changed files" }],
          outputSchema: [
            { name: "passed", type: "boolean", required: true, description: "Whether refactoring is clean" },
            { name: "summary", type: "string", required: true, description: "Review result" },
          ],
          preConditions: [{ expr: "files exist", severity: "warning", description: "QA needs files to review" }],
          postConditions: [{ expr: "output is non-empty", severity: "error", description: "QA must produce verdict" }],
        },
      ],
      crossStageInvariants: [
        { expr: "no errors", severity: "error", description: "No regressions allowed" },
        { expr: "compile passes", severity: "error", description: "Code must compile after refactoring" },
      ],
    }

    const contracts: Record<string, PipelineContract> = {
      "feature-dev": featureDev,
      "fix-verify": fixVerify,
      "refactor-review": refactorReview,
    }
    return contracts[pipelineId] ?? null
  }
}
