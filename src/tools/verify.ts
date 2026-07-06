import { tool } from "@opencode-ai/plugin"
import type { ToolSpec } from "./types.js"
import type { ToolContext } from "./tool-context.js"

export function makeVerifyTool(ctx: ToolContext): ToolSpec {
  const {
    sessionStore, domainRegistry, worktree, projectId, config,
    log, projectContext, TOOL_REGISTRY, currentInjectDomain,
    planner, plannerCritic, executor, intentParser, agentLoop,
    verifier, errorAnalyzer, errorRecovery, alignmentGate,
    economicModel, confidenceScorer, confidenceStore, techDebtScorer,
    constraintManifold, navigator, toolRouter, routerAgent,
    skillStore, skillCurator, episodicStore, memoryOrchestrator,
    secondBrain, rag: multiIndexRAG, coordinator, orchestrator,
    roleRegistry, agentRuntime, debateLoop, dashboard, traceLogger,
    liveEvaluator, patternDiscovery, toolUsageTracker, workflowEngine,
    llmEngine, modelRegistry, hallucinationGuard, checkpoints,
    stateStore, budgetTracker, eventBus, parallelExec,
    dependencyTracker: depTracker, contextCompressor, git,
    selfEvolver, continuousEvolution, metaReasoner,
    mcpServer, mcpClient, protocolAdapter, dynamicToolRegistry,
    worldModel, simulationEngine, dataCleaner, configLoader,
    logErrorToFile, detectSubAgentRole, buildSubAgentInjection, ctxDir,
  } = ctx
  return {
      description: "Run deep verification: compile + lint + test + semantic + security + performance + architecture + dependency audit. Gap #4 multi-dimensional.",
      args: {
        stepId: tool.schema.string().optional().describe("Label for this verification"),
        projectDir: tool.schema.string().optional().describe("Project directory (default: worktree)"),
        tier: tool.schema.enum(["fast", "standard", "deep"]).optional().describe("Verification tier: 'fast', 'standard', or 'deep' (default: 'deep')"),
      },
      async execute(args, context) {
        const projectDir = args.projectDir ?? ctxDir(context)
        const stepId = args.stepId ?? "full"
        const tier = (args.tier ?? "deep") as import("../core/verifier.js").VerificationTier

        const result = await verifier.verifyAllDeep(stepId, projectDir, undefined, [], false, tier)

        traceLogger.log({
          step: `verify:${stepId}`,
          input: projectDir,
          output: JSON.stringify(result),
          toolUsed: "agentic_verify",
          success: result.passed,
          durationMs: 0,
        })

        const checkOutput = result.checks.map(c =>
          `${c.passed ? "✅" : "❌"} **${c.name}**\n\`\`\`\n${c.output.slice(0, 600)}\n\`\`\``
        ).join("\n\n")

        // Emit step.verified event
        eventBus.emit({
          type: "step.verified",
          payload: {
            sessionID: context.sessionID,
            stepId,
            tier,
            passed: result.passed,
            checkCount: result.checks.length,
            errors: result.errors.slice(0, 5),
          },
        })

        if (result.passed) {
          sessionStore.getOrCreate(context.sessionID).artifacts.set("workflow:verified", String(Date.now()))
          return { output: `## ✅ Verification Passed\n\n${checkOutput}`, metadata: result }
        }

        const analysis = await errorAnalyzer.analyzeDeep(result.errors.join("\n"), [])
        return {
          output: `## ❌ Verification Failed\n\n${checkOutput}\n\n### Analysis\n**Category:** \`${analysis.category}\`\n**Likely cause:** ${analysis.likelyRootCause}\n**Fix:** ${analysis.suggestedFix}`,
          metadata: result,
        }
      },
  }
}
