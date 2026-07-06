import { tool } from "@opencode-ai/plugin"
import type { ToolSpec } from "./types.js"
import type { ToolContext } from "./tool-context.js"

export function makeScoreTool(ctx: ToolContext): ToolSpec {
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
