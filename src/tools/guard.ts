import { tool } from "@opencode-ai/plugin"
import type { ToolSpec } from "./types.js"
import type { ToolContext } from "./tool-context.js"

export function makeGuardTool(ctx: ToolContext): ToolSpec {
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
    llmEngine,
    modelRegistry,
    hallucinationGuard,
    checkpoints: _checkpoints,
    stateStore: _stateStore,
    budgetTracker: _budgetTracker,
    eventBus,
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
      description: "MANUAL re-run of the hallucination guard. NOTE: Guard already runs automatically inside `agentic_execute` on every successful step (if `autoHallucinationCheck: true` in config). This standalone tool is only needed for: (a) re-checking an older step after files changed, (b) auditing a step that was executed while auto-check was disabled, or (c) getting a detailed per-claim breakdown. Do NOT call redundantly — the auto-check already ran.",
      args: {
        stepId: tool.schema.string().describe("The step ID whose output to verify (in ID chain: sessionID ⊃ stepId)"),
      },
      async execute(args, context) {
        const stepState = executor.getStepState(context.sessionID, args.stepId)
        if (!stepState?.result) return { output: `No execution record for step "${args.stepId}".` }

        const output = stepState.result.output
        const files = executor.getAllFilesModified(context.sessionID)
        const check = hallucinationGuard.check(output, files)

        // Emit guard.check.completed event (auto-check in execution-helpers does this too)
        const claims20 = check.claims.slice(0, 20) as unknown as Array<{ claim: string; type: "file" | "function" | "import"; verified: boolean; expected: string; actual: string | null }>
        const unverifiedCount = claims20.filter(c => !c.verified).length
        eventBus.emit({
          type: "guard.check.completed",
          payload: {
            sessionID: context.sessionID,
            stepId: args.stepId,
            totalClaims: claims20.length,
            unverifiedClaims: unverifiedCount,
            hallucinationRate: claims20.length > 0 ? unverifiedCount / claims20.length : 0,
            passed: check.passed,
            claims: claims20,
          },
        })

        if (!check.passed) {
          const guardModelId = await llmEngine.getOpenCodeModel()
          if (guardModelId && guardModelId !== "unknown") {
            modelRegistry.recordHallucination(guardModelId)
          }
        }

        let response = `⚠️ **Deprecation notice:** \`agentic_guard\` auto-runs inside \`agentic_execute\`. This standalone call is only needed for re-auditing old steps.\n\n`
        response += `## 🛡️ Hallucination Check: Step "${args.stepId}"\n\n`
        response += `**Verdict:** ${check.passed ? "✅ All claims verified" : "❌ Unverified claims found"}\n\n`
        response += `**Summary:** ${check.summary}\n\n`

        if (check.claims.length > 0) {
          response += `### Claims Checked\n\n`
          response += `| Claim | Type | Verified |\n|-------|------|----------|\n`
          for (const c of check.claims.slice(0, 20)) {
            const icon = c.verified ? "✅" : "❌"
            response += `| ${icon} ${c.claim.slice(0, 50)} | ${c.type} | ${c.actual ?? "?"} |\n`
          }
        }

        if (!check.passed) {
          response += `\n### ⚠️ Action Required\n`
          response += `The following claims could not be verified: \n`
          for (const c of check.claims.filter(c => !c.verified)) {
            response += `- "${c.claim}" — expected ${c.expected} but got ${c.actual}\n`
          }
          response += `\nDouble-check these before proceeding. The agent may be hallucinating about files/functions that don't exist.`
        }

        response += `\n### 🤖 Model Reliability\n`
        const guardModelStr = await llmEngine.getOpenCodeModel()
        const modelScore = modelRegistry.getScore(guardModelStr)
        if (modelScore && modelScore.totalCalls > 0) {
          const icon = modelScore.status === "healthy" ? "✅" : modelScore.status === "degraded" ? "⚠️" : "❌"
          response += `${icon} **${modelScore.model}** — reliability: ${(modelScore.reliability * 100).toFixed(0)}%, hallucinations: ${(modelScore.hallucinationRate * 100).toFixed(0)}%, calls: ${modelScore.totalCalls}\n`
        } else {
          response += `No data yet for current model.\n`
        }

        traceLogger.log({
          step: `guard:${args.stepId}`,
          input: args.stepId,
          output: check.summary,
          toolUsed: "agentic_guard",
          success: check.passed,
          durationMs: 0,
        })
        return { output: response }
      },
  }
}
