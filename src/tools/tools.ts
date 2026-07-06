import { tool } from "@opencode-ai/plugin"
import type { ToolSpec } from "./types.js"
import type { ToolContext } from "./tool-context.js"

export function makeToolsTool(ctx: ToolContext): ToolSpec {
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
      description: "Unified tool discovery and calling across MCP + A2A protocols. Search for tools, auto-route calls to the right backend, list all connections, and view combined stats.",
      args: {
        action: tool.schema.enum(["search", "call", "list", "stats"]).describe("Action: search (find tools across protocols), call (auto-route call), list (all connections), stats (combined)"),
        query: tool.schema.string().optional().describe("Search query (for search action)"),
        protocol: tool.schema.enum(["mcp", "a2a"]).optional().describe("Protocol hint (optional, for call action)"),
        source: tool.schema.string().optional().describe("Source identifier: MCP server name or A2A agent URL (for call action)"),
        method: tool.schema.string().optional().describe("Tool name or capability to call (for call action)"),
        params: tool.schema.string().optional().describe("JSON string of parameters (for call action)"),
        maxResults: tool.schema.number().optional().describe("Max search results (default: 20)"),
      },
      async execute(args, _context) {
        switch (args.action) {
          case "search": {
            if (!args.query) return { output: "Parameter 'query' diperlukan untuk search" }
            const results = protocolAdapter.findTools(args.query, args.maxResults ?? 20)
            if (results.length === 0) {
              return { output: `No tools found matching "${args.query}" across MCP or A2A.` }
            }
            const mcpCount = results.filter(r => r.protocol === "mcp").length
            const a2aCount = results.filter(r => r.protocol === "a2a").length
            const lines = [
              `## 🔍 Unified Tool Search: "${args.query}"`,
              ``,
              `**${results.length} results** (${mcpCount} MCP · ${a2aCount} A2A)`,
              ``,
            ]
            for (const r of results) {
              const icon = r.protocol === "mcp" ? "🔌" : "🤖"
              lines.push(`${icon} **${r.name}** \`[${r.protocol}]\``)
              lines.push(`   ${r.description}`)
              lines.push(`   Source: \`${r.source}\``)
              lines.push(``)
            }
            return { output: lines.join("\n"), metadata: { results, total: results.length } }
          }

          case "call": {
            if (!args.source) return { output: "Parameter 'source' diperlukan: MCP server name atau A2A agent URL" }
            if (!args.method) return { output: "Parameter 'method' diperlukan: tool name atau capability" }
            if (!args.protocol) return { output: "Parameter 'protocol' diperlukan: 'mcp' atau 'a2a'" }

            let params: Record<string, unknown> = {}
            if (args.params) {
              try { params = JSON.parse(args.params) } catch (_e) { log.warn("Silent catch: invalid params JSON"); params = {} }
            }

            const result = await protocolAdapter.call({
              protocol: args.protocol,
              source: args.source,
              name: args.method,
            }, params)

            const icon = result.isError ? "❌" : "✅"
            const contentStr = typeof result.content === "string"
              ? result.content.slice(0, 3000)
              : JSON.stringify(result.content, null, 2).slice(0, 3000)

            return {
              output: `## ${icon} Protocol Call\n\n**Protocol:** ${result.protocol}\n**Source:** ${result.source}\n**Method:** ${result.method}\n**Duration:** ${result.durationMs}ms\n\n### Result\n\`\`\`json\n${contentStr}\n\`\`\``,
              metadata: { callResult: result },
            }
          }

          case "list": {
            const all = protocolAdapter.listAll()
            if (all.length === 0) {
              return { output: "No connections. Use MCP connect or A2A serve/discover first." }
            }
            const lines = ["## 📡 Protocol Connections", ""]
            for (const entry of all) {
              const icon = entry.protocol === "mcp" ? "🔌" : "🤖"
              lines.push(`${icon} **${entry.name}** \`[${entry.protocol}]\``)
              lines.push(`   ${entry.description}`)
              lines.push(`   ${entry.connected ? "✅ Connected" : "❌ Disconnected"} · ${entry.toolCount} tools`)
              lines.push(``)
            }
            return { output: lines.join("\n"), metadata: { connections: all } }
          }

          case "stats": {
            const stats = protocolAdapter.getStats()
            const lines = [
              "## 📊 Protocol Adapter Stats",
              "",
              "### 🔌 MCP",
              `| Metric | Value |`,
              `|--------|-------|`,
              `| Connections | ${stats.mcp.connections} |`,
              `| Total Tools | ${stats.mcp.totalTools} |`,
              "",
              "### 🤖 A2A",
              `| Metric | Value |`,
              `|--------|-------|`,
              `| Server Active | ${stats.a2a.listened ? "✅ Yes" : "❌ No"} |`,
              `| Discovered Agents | ${stats.a2a.discoveredAgents} |`,
              `| Tasks Sent | ${stats.a2a.tasksSent} |`,
              `| Tasks Completed | ${stats.a2a.tasksCompleted} |`,
              `| Tasks Failed | ${stats.a2a.tasksFailed} |`,
              "",
              "### Combined",
              `| Metric | Value |`,
              `|--------|-------|`,
              `| Total Connections | ${stats.combined.totalConnections} |`,
              `| Total Tools/Capabilities | ${stats.combined.totalTools} |`,
            ]
            return { output: lines.join("\n"), metadata: { stats } }
          }

          default:
            return { output: "Unknown action. Use: search, call, list, stats" }
        }
      },
  }
}
