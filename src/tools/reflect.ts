import { tool } from "@opencode-ai/plugin"
import type { ToolSpec } from "./types.js"
import type { ToolContext } from "./tool-context.js"

export function makeReflectTool(ctx: ToolContext): ToolSpec {
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
    errorAnalyzer,
    errorRecovery,
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
    traceLogger: _traceLogger,
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
    eventBus,
    parallelExec: _parallelExec,
    dependencyTracker: depTracker,
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
      description: "Analyze a failed step. Diagnoses the error category, traces error propagation across the step chain, and suggests a recovery plan.",
      args: {
        stepId: tool.schema.string().describe("The ID of the failed step to analyze (in ID chain: sessionID ⊃ stepId)"),
        errorDetails: tool.schema.string().optional().describe("Additional error context (full stack trace, test output, etc.)"),
        attemptedFix: tool.schema.string().optional().describe("What you tried to fix the error (if any)"),
      },
      async execute(args, context) {
        const stepState = executor.getStepState(context.sessionID, args.stepId)
        if (!stepState || !stepState.result) {
          return { output: `No execution record for step "${args.stepId}". Has it been run via \`agentic_execute\`?` }
        }

        if (stepState.result.success) {
          return { output: `Step "${args.stepId}" was successful — no reflection needed.` }
        }

        const errorText = [args.errorDetails, stepState.result.output, stepState.result.error]
          .filter(Boolean)
          .join("\n")
        const modifiedFiles = executor.getAllFilesModified(context.sessionID)
        const analysis = await errorAnalyzer.analyzeDeep(errorText, modifiedFiles)
        const canRetry = executor.canRetry(context.sessionID, args.stepId)
        const retriesUsed = executor.getRetryCount(context.sessionID, args.stepId)

        if (args.attemptedFix) {
          executor.recordFixAttempt(context.sessionID, args.stepId, args.attemptedFix, false)
        }

        // Error propagation analysis
        const session = sessionStore.getOrCreate(context.sessionID)
        const planSteps = session.plan?.intent.subtasks.map(s => s.id) ?? []
        const propAnalysis = depTracker.analyzeErrorPropagation(context.sessionID, args.stepId, errorText, planSteps)

        const maxRetries = executor.getMaxRetries(analysis.category)
        let output = `## 🔍 Error Analysis: Step "${args.stepId}"\n\n`
        output += `**Category:** \`${analysis.category}\`\n`
        output += `**Severity:** ${analysis.severity}\n`
        output += `**Retry #${retriesUsed}/${maxRetries}**\n\n`
        output += `### Root Cause\n${analysis.likelyRootCause}\n\n`

        if (propAnalysis.likelyCulprit || propAnalysis.propagationPath.length > 0) {
          output += `### 🔗 Error Propagation Trace\n`
          if (propAnalysis.likelyCulprit) {
            output += `**Likely origin:** \`${propAnalysis.likelyCulprit}\`\n`
          }
          if (propAnalysis.propagationPath.length > 0) {
            output += `**Propagation path:** ${propAnalysis.propagationPath.map(p => `\`${p}\``).join(" → ")}\n`
          }
          output += `**Suggestion:** ${propAnalysis.suggestion}\n\n`
        }

        output += `### Suggested Fix\n${analysis.suggestedFix}\n`

        if (modifiedFiles.length > 0) {
          output += `\n### Modified Files (likely sources)\n`
          output += modifiedFiles.map(f => `- \`${f}\``).join("\n") + "\n"
        }

        // ── Gap #5: Error Recovery Plan ──
        const recoveryPlan = errorRecovery.getRecoveryPlan(analysis, args.stepId, retriesUsed + 1)
        output += `\n### 🩺 Recovery Plan (Gap #5)\n`
        output += `**Action:** \`${recoveryPlan.action}\`\n`
        output += `**Reason:** ${recoveryPlan.reason}\n`
        if (recoveryPlan.target) output += `**Target:** \`${recoveryPlan.target}\`\n`
        output += `**Priority:** ${recoveryPlan.priority === 1 ? "🔴 Immediate" : recoveryPlan.priority === 2 ? "🟡 Soon" : "🟢 Eventually"}\n`

        const health = errorRecovery.getHealth()
        if (health !== "healthy") {
          output += `**System Health:** ⚠️ ${health}\n`
        }

        if (canRetry) {
          output += `\n---\n🔄 **${maxRetries - retriesUsed} retries left.** Fix and call \`agentic_execute\` to retry.`
        } else {
          output += `\n---\n🛑 **No retries remaining.** Consider adding a new plan step for this fix.`
        }

        // Emit step.reflected event
        eventBus.emit({
          type: "step.reflected",
          payload: {
            sessionID: context.sessionID,
            stepId: args.stepId,
            category: analysis.category,
            severity: analysis.severity,
            suggestedFix: analysis.suggestedFix,
            canRetry,
            retriesUsed,
          },
        })

        sessionStore.getOrCreate(context.sessionID).artifacts.set(`workflow:reflected:${args.stepId}`, String(Date.now()))
        return { output }
      },
  }
}
