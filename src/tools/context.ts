import { tool } from "@opencode-ai/plugin"
import type { ToolSpec } from "./types.js"
import type { ToolContext } from "./tool-context.js"

export function makeContextTool(ctx: ToolContext): ToolSpec {
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
    coordinator: _coordinator,
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
    llmEngine: _llmEngine,
    modelRegistry: _modelRegistry,
    hallucinationGuard: _hallucinationGuard,
    checkpoints: _checkpoints,
    stateStore: _stateStore,
    budgetTracker: _budgetTracker,
    eventBus: _eventBus,
    parallelExec: _parallelExec,
    dependencyTracker: _depTracker,
    contextCompressor,
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
      description: "View and compress the execution context. When approaching context limits, this tool summarizes the conversation history into a compact form preserving key decisions, file changes, and invariants.",
      args: {
        action: tool.schema.enum(["view", "compress"]).describe("'view' shows current context stats; 'compress' generates a compressed context prompt"),
      },
      async execute(args, context) {
        const turns = sessionStore.getContext(context.sessionID, 100)
        const session = sessionStore.getOrCreate(context.sessionID)
        const allFiles = executor.getAllFilesModified(context.sessionID)
        const decisions: string[] = []

        if (args.action === "view") {
          let output = `## 🧠 Context Status\n\n`
          output += `**Turns in memory:** ${turns.length}\n`
          output += `**Files tracked:** ${allFiles.length}\n`
          output += `**Plan steps:** ${session.plan?.intent.subtasks.length ?? 0}\n`

          const summary = await contextCompressor.compressWithLLM(
            session.plan?.intent.goal ?? "N/A",
            turns,
            decisions,
            allFiles,
          )

          output += `**Estimated tokens:** ~${summary.estimatedTokens}\n`

          const shouldCompress = contextCompressor.shouldCompress(turns.length, summary.estimatedTokens)
          if (shouldCompress) {
            output += `\n⚠️ **Context window approaching capacity.** Run \`agentic_context\` with \`action: "compress"\` to compact.\n`
          } else {
            output += `\n✅ Context is healthy.\n`
          }

          return { output }
        }

        // Compress — use LLM-enhanced version when available
        const summary = await contextCompressor.compressWithLLM(
          session.plan?.intent.goal ?? "N/A",
          turns,
          decisions,
          allFiles,
        )

        const prompt = contextCompressor.compressToPrompt(summary)

        let output = `## 🗜️ Context Compressed\n\n`
        output += `Compressed ${turns.length} turns into ~${summary.estimatedTokens} tokens.\n\n`
        output += prompt

        traceLogger.log({
          step: "context:compress",
          input: `${turns.length} turns`,
          output: `${summary.estimatedTokens} tokens`,
          toolUsed: "agentic_context",
          success: true,
          durationMs: 0,
        })

        return { output }
      },
  }
}
