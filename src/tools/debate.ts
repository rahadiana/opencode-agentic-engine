import { tool } from "@opencode-ai/plugin"
import type { ToolSpec } from "./types.js"
import type { ToolContext } from "./tool-context.js"

export function makeDebateTool(ctx: ToolContext): ToolSpec {
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
