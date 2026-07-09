import { tool } from "@opencode-ai/plugin"
import type { ToolSpec } from "./types.js"
import type { ToolContext } from "./tool-context.js"

export function makeDebateTool(ctx: ToolContext): ToolSpec {
  const {
    sessionStore: _sessionStore,
    domainRegistry,
    worktree: _worktree,
    projectId,
    config: _config,
    log,
    projectContext: _projectContext,
    TOOL_REGISTRY: _TOOL_REGISTRY,
    currentInjectDomain: _currentInjectDomain,
    planner: _planner,
    plannerCritic: _plannerCritic,
    executor: _executor,
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
    skillStore,
    skillCurator: _skillCurator,
    episodicStore,
    memoryOrchestrator: _memoryOrchestrator,
    secondBrain: _secondBrain,
    rag: _multiIndexRAG,
    coordinator: _coordinator,
    orchestrator: _orchestrator,
    roleRegistry: _roleRegistry,
    agentRuntime: _agentRuntime,
    debateLoop,
    dashboard: _dashboard,
    traceLogger,
    liveEvaluator: _liveEvaluator,
    patternDiscovery: _patternDiscovery,
    toolUsageTracker: _toolUsageTracker,
    workflowEngine: _workflowEngine,
    llmEngine: _llmEngine,
    modelRegistry: _modelRegistry,
    hallucinationGuard: _hallucinationGuard,
    checkpoints: _checkpoints,
    stateStore: _stateStore,
    budgetTracker: _budgetTracker,
    eventBus: _eventBus,
    parallelExec: _parallelExec,
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
    ctxDir: _ctxDir,
  } = ctx
  return {
      description: "Debate loop between two agents (executor ↔ critic) for thorough analysis. Produces cleaner, more accurate results than a single LLM call. Best for complex analysis, data validation, and reviews.",
      args: {
        task: tool.schema.string().describe("The task or question to analyze in depth"),
        context: tool.schema.string().optional().describe("Additional context: data, files, requirements, or previous work"),
        maxRounds: tool.schema.number().optional().default(3).describe("Maximum debate rounds (default: 3, max: 5)"),
        format: tool.schema.enum(["markdown", "json"]).optional().default("json").describe("Output format: structured JSON or readable markdown"),
        verbose: tool.schema.boolean().optional().default(false).describe("Tampilkan progress debate real-time + full transcript per round"),
        timeoutMs: tool.schema.number().optional().describe("Total timeout in ms for entire debate (default: 300000 = 5 menit)"),
      },
      async execute(args, context) {
        const startTime = Date.now()

        // Model per-role di-resolve otomatis via toolName di debate-loop.ts:
        //   debate-executor → unspecified-high
        //   debate-critic   → deep
        //   debate-cleaner  → quick
        // Bisa di-override via: agentic_model set tool=debate-executor model="..."
        const maxRounds = Math.min(args.maxRounds ?? 3, 5)
        const result = await debateLoop.execute({
          task: args.task,
          context: args.context,
          maxRounds,
          format: args.format ?? "json",
          verbose: args.verbose ?? false,
          sessionId: context.sessionID,
          totalTimeoutMs: args.timeoutMs,
        })

        // Record as episode for future learning
        try {
          episodicStore.record(
            context.sessionID,
            `Debate: ${args.task.slice(0, 100)}`,
            result.approved ? "success" : "partial",
            [`${result.totalRounds} rounds`, `Approved: ${result.approved}`, result.revisionSummary],
            [],
            domainRegistry.getCurrentDomain() ?? undefined,
            projectId,
          )
        } catch (e) { log.warn("Silent catch: non-fatal", { error: String(e) }) }

        // Try to extract skill if debate was successful
        if (result.approved) {
          try {
            skillStore.extract({
              role: "tool",
              content: `✅ Debate completed: ${args.task}\nRounds: ${result.totalRounds}\nFinal output:\n${result.finalOutput.slice(0, 500)}`,
            }, [args.task])
          } catch (e) { log.warn("Silent catch: non-fatal", { error: String(e) }) }
        }

        traceLogger.log({
          step: "execute",
          input: `Debate: ${args.task}`,
          output: result.approved ? "approved" : "not-approved",
          toolUsed: "agentic_debate",
          success: result.approved,
          durationMs: Date.now() - startTime,
        })

        // Build output — with full debate history when verbose
        let outputText: string
        if (args.verbose) {
          outputText = `## 🗣️ Debate Result\n\n**Task:** ${args.task}\n**Status:** ${result.approved ? "✅ Approved" : "⚠️ Not fully resolved"} after ${result.totalRounds} round(s)\n**Revision:** ${result.revisionSummary}\n\n### Final Output\n\n${(args.format ?? "json") === "json" ? "```json\n" + result.finalOutput + "\n```" : result.finalOutput}\n\n### Full Debate History\n\n`
          for (const round of result.rounds) {
            outputText += `#### Round ${round.round}\n\n`
            outputText += `**Executor Draft:**\n\`\`\`\n${round.draft}\n\`\`\`\n\n`
            outputText += `**Critic Review:**\n\`\`\`\n${round.review}\n\`\`\`\n\n`
            if (round.issues.length > 0) {
              outputText += `**Issues:**\n`
              for (const issue of round.issues) {
                outputText += `- ${issue}\n`
              }
              outputText += `\n`
            }
            if (round.approved) outputText += `**[Approved]**\n\n`
          }
        } else {
          outputText = `## 🗣️ Debate Result\n\n**Task:** ${args.task}\n**Status:** ${result.approved ? "✅ Approved" : "⚠️ Not fully resolved"} after ${result.totalRounds} round(s)\n**Revision:** ${result.revisionSummary}\n\n### Final Output\n\n${(args.format ?? "json") === "json" ? "```json\n" + result.finalOutput + "\n```" : result.finalOutput}`
        }

        return {
          output: outputText,
          metadata: { debateResult: result },
        }
      },
  }
}
