import { tool } from "@opencode-ai/plugin"
import type { ToolSpec } from "./types.js"
import type { ToolContext } from "./tool-context.js"

export function makeNavTool(ctx: ToolContext): ToolSpec {
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
      description: "Scan the project codebase and find relevant files for a task. Use this to understand the project structure before planning, or to find which files to modify.",
      args: {
        query: tool.schema.string().describe("What you're looking for — a task description, module name, or feature keyword"),
        maxResults: tool.schema.number().optional().describe("Maximum number of files to return (default: 10)"),
        showSummary: tool.schema.boolean().optional().describe("Show full project structure summary"),
      },
      async execute(args, context) {
        const maxResults = args.maxResults ?? 10
        const scanDir = context.directory || context.worktree || worktree
        await navigator.scan(scanDir)
        const files = navigator.findRelevantFiles(args.query, maxResults)

        // Index files into TF-IDF vector store for future search
        for (const file of files) {
          multiIndexRAG.vectorStore.index({
            id: `file:${file}`,
            category: "general",
            title: file,
            content: `File ${file}`,
            keywords: file.split(/[/\\]/).pop()?.split(".") ?? [],
            metadata: { type: "file", path: file },
          })
        }

        let output = `## 🔍 Codebase Navigator\n\n**Query:** ${args.query}\n\n`

        if (args.showSummary) {
          output += navigator.getSummary() + "\n\n"
        }

        if (files.length === 0) {
          output += "No matching files found. Try a different query, or use `showSummary: true` to see the project structure."
        } else {
          output += `### Matching Files (${files.length})\n`
          output += files.map(f => `- \`${f}\``).join("\n")

          const testFiles = files.flatMap(f => navigator.getTestFiles(f))
          if (testFiles.length > 0) {
            output += `\n\n### Related Test Files\n`
            output += testFiles.map(f => `- \`${f}\``).join("\n")
          }
        }

        traceLogger.log({
          step: "nav",
          input: args.query,
          output: `${files.length} files found`,
          toolUsed: "agentic_nav",
          success: true,
          durationMs: 0,
        })
        sessionStore.getOrCreate(context.sessionID).artifacts.set("workflow:researched", String(Date.now()))

        return { output, metadata: { files, projectSummary: args.showSummary ? navigator.getSummary() : undefined } }
      },
  }
}
