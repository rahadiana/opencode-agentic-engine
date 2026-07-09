import { tool } from "@opencode-ai/plugin"
import type { ToolSpec } from "./types.js"
import type { ToolContext } from "./tool-context.js"
import { parseLLMStepImplementation } from "../core/parallel.js"
import { writeFiles as writeFilesHelper } from "../core/execution-helpers.js"

export function makeParallelTool(ctx: ToolContext): ToolSpec {
  const {
    sessionStore,
    domainRegistry: _domainRegistry,
    worktree: _worktree,
    projectId: _projectId,
    config: _config,
    log: _log,
    projectContext: _projectContext,
    TOOL_REGISTRY: _TOOL_REGISTRY,
    currentInjectDomain: _currentInjectDomain,
    planner: _planner,
    plannerCritic: _plannerCritic,
    executor,
    intentParser: _intentParser,
    agentLoop: _agentLoop,
    verifier: _verifier,
    errorAnalyzer: _errorAnalyzer,
    errorRecovery: _errorRecovery,
    alignmentGate: _alignmentGate,
    economicModel: _economicModel,
    confidenceScorer: _confidenceScorer,
    confidenceStore: _confidenceStore,
    techDebtScorer: _techDebtScorer,
    constraintManifold: _constraintManifold,
    navigator: _navigator,
    toolRouter: _toolRouter,
    routerAgent: _routerAgent,
    skillStore: _skillStore,
    skillCurator: _skillCurator,
    episodicStore: _episodicStore,
    memoryOrchestrator: _memoryOrchestrator,
    secondBrain: _secondBrain,
    rag: _multiIndexRAG,
    coordinator,
    orchestrator: _orchestrator,
    roleRegistry: _roleRegistry,
    agentRuntime: _agentRuntime,
    debateLoop: _debateLoop,
    dashboard: _dashboard,
    traceLogger,
    liveEvaluator: _liveEvaluator,
    patternDiscovery: _patternDiscovery,
    toolUsageTracker: _toolUsageTracker,
    workflowEngine: _workflowEngine,
    llmEngine,
    modelRegistry: _modelRegistry,
    hallucinationGuard: _hallucinationGuard,
    checkpoints: _checkpoints,
    stateStore: _stateStore,
    budgetTracker: _budgetTracker,
    eventBus,
    parallelExec,
    dependencyTracker: _depTracker,
    contextCompressor: _contextCompressor,
    git: _git,
    selfEvolver: _selfEvolver,
    continuousEvolution: _continuousEvolution,
    metaReasoner: _metaReasoner,
    mcpServer: _mcpServer,
    mcpClient: _mcpClient,
    protocolAdapter: _protocolAdapter,
    dynamicToolRegistry: _dynamicToolRegistry,
    worldModel: _worldModel,
    simulationEngine: _simulationEngine,
    dataCleaner: _dataCleaner,
    configLoader: _configLoader,
    logErrorToFile: _logErrorToFile,
    detectSubAgentRole: _detectSubAgentRole,
    buildSubAgentInjection: _buildSubAgentInjection,
    ctxDir,
  } = ctx
  return {
      description: "Analyze or run steps concurrently. Use action: `analyze` to see parallelism opportunities. Use action: `execute` to run ready steps in parallel. Does NOT replace agentic_execute — only orchestrates concurrent runs.",
      args: {
        action: tool.schema.enum(["analyze", "execute"]).optional().describe("'analyze' shows parallelism plan; 'execute' runs ready steps concurrently (does not replace agentic_execute for step execution)"),
        opencodePath: tool.schema.string().optional().describe("Path to `opencode` binary for sub-process spawn (execute mode)"),
        abortOnFailure: tool.schema.boolean().optional().describe("Stop all tasks in phase if one fails (default: false)"),
      },
      async execute(args, context) {
        const session = sessionStore.getOrCreate(context.sessionID)
        if (!session.plan) return { output: "No plan found. Create one with `agentic_plan` first." }

        const subtasks = session.plan.intent.subtasks
        const completed = executor.getCompletedSteps(context.sessionID)
        const plan = parallelExec.analyzeParallelism(subtasks)

        if (args.action === "execute") {
          const readySteps = subtasks.filter(s =>
            !completed.includes(s.id) &&
            s.dependsOn.every(d => completed.includes(d))
          )
          if (readySteps.length === 0) {
            return { output: "No ready steps to execute. All steps are either completed or blocked by dependencies." }
          }

          const cwd = ctxDir(context)

          let stepRunner: import("../core/parallel.js").StepRunner
          if (args.opencodePath) {
            stepRunner = (step) => parallelExec.executeWithSubprocessSpawn(step, args.opencodePath!, cwd, context.sessionID)
          } else {
            stepRunner = async (step) => {
              const taskId = `parallel-${step.id}-${Date.now()}`
              coordinator.delegate("developer", {
                id: taskId, assignedTo: "developer",
                description: step.description, input: step.description,
                status: "running",
              }, context.sessionID, 0)

              const sharedMem = coordinator.getAllSharedMemory()
              const memCtx = sharedMem.length > 0
                ? `\nShared context:\n${sharedMem.slice(-3).map(e => `- ${e.key}: ${e.value.slice(0, 200)}`).join("\n")}`
                : ""

              try {
                const resp = await llmEngine.call({
                  systemPrompt: `You are a developer implementing step ${step.id}. Return JSON with: "files": [{path, content}], "summary": "what was done"`,
                  userPrompt: `Goal: ${session.plan!.intent.goal}\nStep: ${step.description}${memCtx}`,
                  jsonMode: true, temperature: 0.3, maxTokens: 2048,
                })
                let impl: { files: Array<{ path: string; content: string }>; summary: string }
                try { impl = parseLLMStepImplementation(resp.content) } catch (parseErr) {
                  const msg = parseErr instanceof Error ? parseErr.message : "LLM JSON parse/schema error"
                  await coordinator.updateTask(context.sessionID, taskId, "failed", msg)
                  return { stepId: step.id, success: false, error: msg, output: resp.content, filesModified: [] }
                }
                const written = writeFilesHelper(impl.files, cwd, context.sessionID, eventBus, { taskId })
                // path traversal guard built into writeFilesHelper — rejects writes escaping projectDir
                if (written.length !== impl.files.length) {
                  const failed = impl.files.filter(f => !written.includes(f.path))
                  await coordinator.updateTask(context.sessionID, taskId, "failed", `Path traversal blocked for: ${failed.map(f => f.path).join(", ")}`)
                  return { stepId: step.id, success: false, error: `Path traversal blocked for some files`, output: "", filesModified: written }
                }
                await coordinator.updateTask(context.sessionID, taskId, "done", impl.summary)
                return { stepId: step.id, success: true, output: impl.summary ?? step.description, filesModified: written }
              } catch (e) {
                await coordinator.updateTask(context.sessionID, taskId, "failed", (e as Error).message)
                return { stepId: step.id, success: false, error: (e as Error).message, output: "", filesModified: [] }
              }
            }
          }

          const { results, durationMs } = await parallelExec.executePlanConcurrently(
            plan, stepRunner, args.abortOnFailure ?? false,
          )

          for (const r of results) {
            executor.recordResult(context.sessionID, {
              stepId: r.stepId,
              success: r.success,
              output: r.output ?? "",
              filesModified: r.filesModified,
              error: r.error,
            })
          }

          traceLogger.log({
            step: "parallel:execute",
            input: `${readySteps.length} steps`,
            output: `${results.filter(r => r.success).length}/${results.length} passed`,
            toolUsed: "agentic_parallel",
            success: results.every(r => r.success),
            durationMs,
            metadata: { total: results.length, passed: results.filter(r => r.success).length },
          })

          let output = `## ⚡ Parallel Execution Complete (${(durationMs / 1000).toFixed(1)}s)\n\n`
          output += `**Steps executed:** ${readySteps.length}\n`
          output += `**Passed:** ${results.filter(r => r.success).length}\n`
          output += `**Failed:** ${results.filter(r => !r.success).length}\n\n`

          for (const r of results) {
            const icon = r.success ? "✅" : "❌"
            output += `${icon} **${r.stepId}** — ${r.output?.slice(0, 120) ?? "no output"}\n`
            if (r.error) output += `   Error: ${r.error.slice(0, 200)}\n`
          }

          const progress = executor.getProgress(context.sessionID)
          output += `\n### Overall Progress\n`
          output += `✅ ${progress.completed}/${progress.total} | ❌ ${progress.failed} | ⏳ ${progress.total - progress.completed - progress.failed}`

          return { output, metadata: { results, durationMs } }
        }

        // Analyze mode (default)
        let output = `## ⚡ Parallel Execution Plan\n\n`
        output += `**Max parallelism:** ${plan.maxParallelism}\n`
        output += `**Phases:** ${plan.phases.length}\n\n`

        output += `| Phase | Steps | Parallel |\n|-------|-------|----------|\n`
        for (const phase of plan.phases) {
          const stepIds = phase.steps.map(s => s.id).join(", ")
          output += `| ${phase.index + 1} | ${stepIds} | ${phase.canRunInParallel ? "✅" : "🔒"} |\n`
        }

        const suggestions = parallelExec.suggestParallelTasks(subtasks, completed)
        if (suggestions.length > 1) {
          output += `\n### Currently Runnable\n`
          const groups = new Map<number, string[]>()
          for (const s of suggestions) {
            const list = groups.get(s.parallelGroup) ?? []
            list.push(s.taskId)
            groups.set(s.parallelGroup, list)
          }
          for (const [group, tasks] of groups) {
            const label = tasks.length > 1 ? `🟢 Parallel group ${group}` : `🟡 Sequential`
            output += `- **${label}**: ${tasks.map(t => `\`${t}\``).join(", ")}\n`
          }
          output += `\nRun \`agentic_parallel\` with \`action: "execute"\` to run these steps concurrently.`
        }

        const allFiles = new Map<string, string[]>()
        for (const step of subtasks) {
          const stepState = executor.getStepState(context.sessionID, step.id)
          if (stepState?.result?.filesModified) {
            allFiles.set(step.id, stepState.result.filesModified)
          }
        }
        const conflicts = parallelExec.detectConflicts(
          suggestions.map(s => s.taskId),
          allFiles,
        )
        if (conflicts.length > 0) {
          output += `\n### ⚠️ Potential Conflicts\n`
          for (const c of conflicts) {
            output += `- \`${c.taskA}\` ⚔️ \`${c.taskB}\` both touch \`${c.conflictingFile}\`\n`
          }
        }

        return { output }
      },
  }
}
