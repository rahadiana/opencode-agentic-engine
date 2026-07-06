import { tool } from "@opencode-ai/plugin"
import type { ToolSpec } from "./types.js"
import type { ToolContext } from "./tool-context.js"

export function makeRouterTool(ctx: ToolContext): ToolSpec {
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
