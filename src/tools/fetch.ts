import { tool } from "@opencode-ai/plugin"
import type { ToolSpec } from "./types.js"
import type { ToolContext } from "./tool-context.js"

export function makeFetchTool(ctx: ToolContext): ToolSpec {
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
      description: "Fetch URL dan auto-index ke RAG. Hasilnya otomatis tersimpan di knowledge base (TF-IDF) dan bisa dicari lagi via agentic_rag. Gunakan INI sebagai pengganti webfetch bawaan — karena hasilnya otomatis tersimpan tanpa perlu store manual.",
      args: {
        url: tool.schema.string().describe("URL to fetch"),
        category: tool.schema.string().optional().default("knowledge-tech").describe("RAG category (default: knowledge-tech)"),
      },
      async execute(args, context) {
        const url = args.url as string
        const category = (args.category as string) || "knowledge-tech"
        const startTime = Date.now()
        
        // Validate URL
        try { new URL(url) } catch (_e) { log.warn("Silent catch: invalid URL in agentic_fetch"); 
          return { output: `❌ URL tidak valid: ${url}`, metadata: { error: true, url, latency: Date.now() - startTime } }
        }
        
        let response: Response
        let contentText = ""
        let contentType = ""
        try {
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), 15_000)
          try {
            response = await fetch(url, {
              signal: controller.signal,
              headers: { "User-Agent": "Mozilla/5.0 (compatible; AgenticEngine/1.0)" },
            })
            contentType = response.headers.get("content-type") || ""
            contentText = await response.text()
          } finally {
            clearTimeout(timeout)
          }
        } catch (fetchErr) {
          return {
            output: `❌ Gagal fetch ${url}: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`,
            metadata: { error: true, url, latency: Date.now() - startTime },
          }
        }
        
        // Detect content type and extract accordingly
        const ctype = detectContentType(contentText, contentType, url)
        let outputText: string
        let summary: string
        
        if (ctype === "html") {
          outputText = htmlToText(contentText)
          summary = extractSummary(outputText, "text")
        } else if (ctype === "code") {
          outputText = contentText
          summary = extractSummary(contentText, "code")
        } else if (ctype === "json") {
          outputText = contentText
          summary = extractSummary(contentText, "json")
        } else {
          outputText = contentText
          summary = extractSummary(contentText, "text")
        }
        const tags = buildFetchTags(url, ctype)
        
        // Auto-index to RAG
        let indexed = false
        try {
          multiIndexRAG.indexEpisode(category, {
            id: `web-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            sessionId: context.sessionID || "web",
            projectId,
            planGoal: `Web fetch: ${url}`,
            summary,
            outcome: "success",
            decisions: [],
            filesChanged: [url],
            domain: ctype === "code" ? "code" : "web",
            timestamp: new Date().toISOString(),
            tags,
            score: 1.0,
            usageCount: 0,
            significance: "routine",
          })
          indexed = true
        } catch (ragErr) {
          log.warn(`[agentic_fetch] RAG indexing failed: ${ragErr instanceof Error ? ragErr.message : String(ragErr)}`)
        }
        
        // Track that research was done (for WorkflowPolicy Gate)
        try { sessionStore.getOrCreate(context.sessionID).artifacts.set("workflow:researched", String(Date.now())) } catch (e) { log.warn("Silent catch: silent: session may not be ready", { error: String(e) }) }
        
        return {
          output: outputText.slice(0, 50000),
          metadata: { autoIndexed: indexed, category, url, contentType: ctype, charCount: outputText.length, latency: Date.now() - startTime },
        }
      },
  }
}
