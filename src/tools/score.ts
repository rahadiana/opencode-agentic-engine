import { tool } from "@opencode-ai/plugin"
import type { ToolSpec } from "./types.js"
import type { ToolContext } from "./tool-context.js"
import { readFileSync } from "node:fs"

export function makeScoreTool(ctx: ToolContext): ToolSpec {
  const {
    sessionStore,
    domainRegistry: _domainRegistry,
    worktree: _worktree,
    projectId: _projectId,
    config: _config,
    log,
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
    techDebtScorer,
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
  const debtScorer = techDebtScorer
  return {
      description: "Score the current changeset for technical debt. Analyzes coupling, file size, scope, and code patterns. Use before completing to ensure code quality.",
      args: {
        files: tool.schema.array(tool.schema.string()).optional().describe("Specific files to score (defaults to all modified files)"),
      },
      async execute(args, context) {
        const allFiles = executor.getAllFilesModified(context.sessionID)
        const files = args.files ?? allFiles

        if (files.length === 0) {
          return { output: "No files modified yet. Complete some steps first." }
        }

        const contents = new Map<string, string>()
        for (const file of files) {
          try {
            contents.set(file, readFileSync(file, "utf-8"))
          } catch (_e) { log.warn("Silent catch: unable to read file")
            contents.set(file, `[Unable to read ${file}]`)
          }
        }

        const session = sessionStore.getOrCreate(context.sessionID)
        const score = debtScorer.score(session.plan?.intent.goal ?? "Unknown", files, contents)

        let output = `## 📊 Tech Debt Score: **${score.overall.toUpperCase()}**\n\n`
        output += `**Issues found:** ${score.totalIssues}\n\n`
        output += `### Breakdown\n\n`

        for (const cat of score.breakdown) {
          const bar = "█".repeat(Math.min(cat.score, 10)) + "░".repeat(Math.max(10 - cat.score, 0))
          output += `**${cat.category}** \`[${bar}]\` ${cat.score}/10\n`
          for (const issue of cat.issues) {
            output += `  - ${issue}\n`
          }
          output += "\n"
        }

        output += `### Suggestion\n${score.suggestion}\n`

        traceLogger.log({
          step: "score",
          input: `${files.length} files`,
          output: score.overall,
          toolUsed: "agentic_score",
          success: true,
          durationMs: 0,
          metadata: { overall: score.overall, totalIssues: score.totalIssues },
        })

        return { output }
      },
  }
}
