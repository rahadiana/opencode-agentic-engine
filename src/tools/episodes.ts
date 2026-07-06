import { tool } from "@opencode-ai/plugin"
import type { ToolSpec } from "./types.js"
import type { ToolContext } from "./tool-context.js"

export function makeEpisodesTool(ctx: ToolContext): ToolSpec {
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
      description: "Browse cross-session memory. Search past tasks, patterns, and knowledge across all 4 memory levels (working/episodic/semantic/procedural). Use before planning similar tasks to avoid repeating mistakes.",
      args: {
        action: tool.schema.enum(["search", "recent", "stats"]).describe("'search' finds relevant past tasks; 'recent' shows latest; 'stats' shows summary"),
        query: tool.schema.string().optional().describe("Search query (for 'search' action)"),
        levels: tool.schema.array(tool.schema.string()).optional().describe("Memory levels to search (default: all). E.g. ['episodic', 'semantic']"),
        minImportance: tool.schema.number().optional().describe("Minimum importance threshold (0-1, default: 0)"),
      },
      async execute(args, _context) {
        if (args.action === "search") {
          if (!args.query) return { output: "Provide a search query." }

          // Try MemoryOrchestrator cross-level search first (if levels specified or all)
          const useOrchLevels = args.levels && args.levels.length > 0
          if (useOrchLevels || args.minImportance !== undefined) {
            const levelsArr: string[] = args.levels ?? []
            const validLevels = levelsArr.filter((l: string) =>
              ["working", "episodic", "semantic", "procedural"].includes(l))
            const result = memoryOrchestrator.query({
              query: args.query,
              levels: validLevels.length > 0 ? validLevels as import("../memory/memory-orchestrator.js").MemoryLevel[] : undefined,
              minImportance: args.minImportance ?? 0,
              maxResults: 15,
            })
            if (result.entries.length === 0) return { output: `No results found for "${args.query}" across levels: ${(args.levels ?? ["all"]).join(", ")}.` }
            let output = `## 🧠 Memory Search: "${args.query}"\n\n`
            output += `*Searched levels: ${result.sources.join(", ")}* (${result.totalTime}ms)\n\n`
            for (const entry of result.entries) {
              const levelIcon = { working: "💼", episodic: "🧠", semantic: "📚", procedural: "🔧" }[entry.level] ?? "📄"
              const impBar = "█".repeat(Math.round(entry.importance * 10)) + "░".repeat(Math.max(0, 10 - Math.round(entry.importance * 10)))
              output += `${levelIcon} **${entry.level}** — ${entry.id}\n`
              output += `  ${entry.content.slice(0, 120)}${entry.content.length > 120 ? "..." : ""}\n`
              output += `  Importance: ${impBar} (${(entry.importance * 100).toFixed(0)}%) | Keywords: ${entry.keywords.slice(0, 5).join(", ")}\n`
            }
            return { output }
          }

          // Original path: episodic-only TF-IDF search (backward compat)
          const localEpisodes = episodicStore.getRecent(50)
          const allEpisodes = [...localEpisodes]
          const seenIds = new Set(localEpisodes.map(e => e.id))

          // Load episode dari project lain dari global store
          try {
            const scopes = stateStore.listScopes("episodes")
            for (const scope of scopes) {
              if (scope === projectId) continue
              const globalEps = stateStore.getAll<{ planGoal: string; outcome: string; decisions: string[]; filesChanged: string[]; sessionId: string; timestamp: string; tags: string[]; projectId?: string }>("episodes", scope)
              for (const ep of globalEps) {
                if (!seenIds.has(ep.data.sessionId)) {
                  seenIds.add(ep.data.sessionId)
                  allEpisodes.push({
                    id: ep.data.sessionId,
                    sessionId: ep.data.sessionId,
                    projectId: ep.data.projectId ?? scope,
                    planGoal: ep.data.planGoal,
                    outcome: ep.data.outcome as "success" | "partial" | "failed",
                    decisions: ep.data.decisions,
                    filesChanged: ep.data.filesChanged,
                    tags: ep.data.tags ?? [],
                    timestamp: ep.data.timestamp,
                    score: 0,
                    usageCount: 0,
                    summary: ep.data.planGoal,
                significance: "routine" as const,
                  })
                }
              }
            }
          } catch (e) { log.warn("Silent catch: non-fatal — search tetap jalan dari local", { error: String(e) }) }

          // Index all episodes into TF-IDF vector store
          for (const ep of allEpisodes) {
            multiIndexRAG.vectorStore.index({
              id: `ep:${ep.sessionId}`,
              category: "general",
              title: ep.planGoal,
              content: `${ep.outcome} ${ep.decisions.join(" ")}`,
              keywords: ep.tags,
              metadata: { type: "episode", sessionId: ep.sessionId, outcome: ep.outcome, projectId: ep.projectId },
            })
          }
          const tfidfResults = multiIndexRAG.vectorStore.search(args.query, "general", 5)
          const episodeIds = new Set(tfidfResults.map(r => r.doc.id))
          const episodes = allEpisodes.filter(e => episodeIds.has(`ep:${e.sessionId}`))
          if (episodes.length === 0) return { output: `No episodes found for "${args.query}".` }
          let output = `## 🧠 Episodic Memory: "${args.query}"\n\n`
          output += episodes.map(e => {
            const score = tfidfResults.find(r => r.doc.id === `ep:${e.sessionId}`)?.score.toFixed(2) ?? "?"
            const projTag = e.projectId && e.projectId !== projectId ? ` 📁 ${e.projectId}` : ""
            return `- **${e.outcome === "success" ? "✅" : e.outcome === "partial" ? "⚠️" : "❌"} ${e.planGoal}**${projTag}\n  Score: ${score} | Files: ${(e.filesChanged ?? []).length} | ${e.timestamp.slice(0, 10)}`
          }).join("\n")
          return { output }
        }

        if (args.action === "recent") {
          const episodes = episodicStore.getRecent(10)
          if (episodes.length === 0) return { output: "No episode history yet." }
          let output = `## 📜 Recent Episodes\n\n`
          output += episodes.map(e =>
            `- ${e.timestamp.slice(0, 10)} — **${e.outcome.toUpperCase()}**: ${e.planGoal.slice(0, 80)}`
          ).join("\n")
          return { output }
        }

        const stats = episodicStore.getStats()
        return {
          output: `## 📊 Episode Stats\n\n**Total sessions:** ${stats.total}\n**Successful:** ${stats.successful}\n**Partial:** ${stats.partial}\n**Failed:** ${stats.failed}\n\nSuccess rate: ${stats.total > 0 ? ((stats.successful / stats.total) * 100).toFixed(0) : 0}%`,
        }
      },
  }
}
