import { tool } from "@opencode-ai/plugin"
import type { ToolSpec } from "./types.js"
import type { ToolContext } from "./tool-context.js"

function detectContentType(content: string, contentTypeHeader: string, url: string): "html" | "code" | "json" | "text" {
  if (contentTypeHeader.startsWith("text/html") || contentTypeHeader.startsWith("application/xhtml")) return "html"
  if (contentTypeHeader.startsWith("application/json") || url.match(/\.json$/i)) return "json"
  if (content.match(/^\s*</)) return "html"
  if (url.match(/\.(ts|js|tsx|jsx|mjs|cjs|mts|cts|py|rs|go|java|c|cpp|h|hpp|rb|php|swift|kt|scala|ex|exs|hs|lua|r|sh|bash|zsh|fish|sql|graphql|css|scss|less|sass|vue|svelte|astro)$/i)) return "code"
  return "text"
}
function htmlToText(html: string): string {
  const codeBlocks: string[] = []
  const saved = html.replace(/<(pre|code)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi, (_: unknown, _tag: string, inner: string) => {
    codeBlocks.push(inner.replace(/<[^>]+>/g, "").trim())
    return `\n---CODEBLOCK${codeBlocks.length - 1}---\n`
  })
  return saved.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "").replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "").replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim()
    .replace(/---CODEBLOCK(\d+)---/g, (_: unknown, idx: string) => `\n\`\`\`\n${codeBlocks[parseInt(idx)] || ""}\n\`\`\`\n`)
}
function extractSummary(content: string, type: "html" | "code" | "json" | "text"): string {
  if (type === "code") {
    const lines = content.split("\n").filter(l => l.trim() && !l.trim().startsWith("//") && !l.trim().startsWith("/*") && !l.trim().startsWith("*"))
    return lines.slice(0, Math.min(15, lines.length)).join("\n").slice(0, 800) + `\n\n(... ${content.split("\n").length} total lines, ${content.length} chars)`
  }
  if (type === "json") {
    return content.replace(/\s+/g, " ").trim().slice(0, 500) + `\n\nTop keys: ${(content.match(/"([^"]+)":/g)?.slice(0, 10).map((k: string) => k.replace(/[":]/g, "")) || []).join(", ")}`
  }
  return content.replace(/\s+/g, " ").trim().slice(0, 1000)
}
function buildFetchTags(url: string, ctype: string): string[] {
  const tags: string[] = ["web-fetch"]
  const parts = url.split("/").filter(Boolean).slice(-3).map(t => t.replace(/[^a-zA-Z0-9-]/g, "").toLowerCase()).filter(Boolean)
  tags.push(...parts)
  if (ctype === "code") {
    tags.push("source-code")
    const ext = url.match(/\.([a-z0-9]+)(?:\?|$)/i)?.[1] || ""
    if (ext) tags.push(`ext-${ext}`)
    const langMap: Record<string, string> = { ts: "typescript", js: "javascript", py: "python", rs: "rust", go: "golang", rb: "ruby", java: "java", cs: "csharp", php: "php", swift: "swift", kt: "kotlin" }
    if (langMap[ext]) tags.push(langMap[ext])
  } else if (ctype === "html") { tags.push("html") }
  else if (ctype === "json") { tags.push("json") }
  if (tags.length < 2) tags.push("web-research")
  return [...new Set(tags)]
}

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
        
        // Track research for WorkflowPolicy Gate + ecosystem solid path
        try {
          sessionStore.getOrCreate(context.sessionID).artifacts.set("workflow:researched", String(Date.now()))
        } catch (e) { log.warn("Silent catch: session may not be ready", { error: String(e) }) }
        
        return {
          output: outputText.slice(0, 50000),
          metadata: { autoIndexed: indexed, category, url, contentType: ctype, charCount: outputText.length, latency: Date.now() - startTime },
        }
      },
  }
}
