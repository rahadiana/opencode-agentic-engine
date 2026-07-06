import { tool } from "@opencode-ai/plugin"
import type { ToolSpec } from "./types.js"
import type { ToolContext } from "./tool-context.js"

export function makeContextTool(ctx: ToolContext): ToolSpec {
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
