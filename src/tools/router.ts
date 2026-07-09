import { tool } from "@opencode-ai/plugin"
import type { ToolSpec } from "./types.js"
import type { ToolContext } from "./tool-context.js"

export function makeRouterTool(ctx: ToolContext): ToolSpec {
  const {
    sessionStore: _sessionStore,
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
    routerAgent,
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
      description: "Lightweight intent classifier that routes user input to the right knowledge category, RAG index, and tools. Use before searching memory to scope results to relevant domain.",
      args: {
        input: tool.schema.string().describe("User input or query to classify"),
        categories: tool.schema.array(tool.schema.object({
          id: tool.schema.string(),
          name: tool.schema.string(),
          keywords: tool.schema.array(tool.schema.string()),
          description: tool.schema.string(),
        })).optional().describe("Optional custom categories (overrides defaults)"),
      },
      async execute(args, _context) {
        const startTime = Date.now()

        if (args.categories && Array.isArray(args.categories) && args.categories.length > 0) {
          routerAgent.setCategories(args.categories as import("../core/router-agent.js").RouteCategory[])
        }

        const route = await routerAgent.route(args.input)

        traceLogger.log({
          step: "execute",
          input: `Route: ${args.input}`,
          output: route.category,
          toolUsed: "agentic_router",
          success: true,
          durationMs: Date.now() - startTime,
        })

        const confidenceBar = "█".repeat(Math.round(route.confidence * 10)) + "░".repeat(10 - Math.round(route.confidence * 10))

        return {
          output: `## 🧭 Route Result\n\n**Input:** ${args.input}\n**Intent:** ${route.intent}\n**Category:** ${route.category}\n**Confidence:** ${(route.confidence * 100).toFixed(0)}% ${confidenceBar}\n**Method:** ${route.usedLlm ? "LLM Classification" : "Keyword Fallback"}\n**RAG Index:** ${route.suggestedRagIndex}\n**Reasoning:** ${route.reasoning}\n\n> 💡 Use \`agentic_episodes search "${route.suggestedRagIndex}: ${args.input}"\` to find relevant past sessions in this category.`,
          metadata: { route },
        }
      },
  }
}
