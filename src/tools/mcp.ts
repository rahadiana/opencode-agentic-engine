import { tool } from "@opencode-ai/plugin"
import type { ToolSpec } from "./types.js"
import type { ToolContext } from "./tool-context.js"

export function makeMcpTool(ctx: ToolContext): ToolSpec {
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
      description: "MCP client + server management. Connect to external servers (DB, APIs), call tools, or start/stop the MCP server that exposes plugin tools. Use for real-world data or exposing tools to external clients.",
      args: {
        action: tool.schema.enum(["connect", "list", "call", "disconnect", "disconnect-all", "server-start", "server-stop", "server-status", "server-restart"]).describe("Action: client actions (connect/list/call/disconnect) or server management (server-start/stop/status/restart)"),
        transport: tool.schema.enum(["stdio", "http", "https"]).optional().describe("Transport type (for connect)"),
        command: tool.schema.string().optional().describe("Executable path (for stdio connect)"),
        args: tool.schema.array(tool.schema.string()).optional().describe("Command arguments (for stdio connect)"),
        url: tool.schema.string().optional().describe("Server URL (for http/https connect)"),
        name: tool.schema.string().optional().describe("Server name for identification"),
        headers: tool.schema.string().optional().describe("JSON string of extra HTTP headers"),
        server: tool.schema.string().optional().describe("Server name to call/disconnect"),
        tool: tool.schema.string().optional().describe("Tool name to call on the server"),
        params: tool.schema.string().optional().describe("JSON string of tool arguments"),
        port: tool.schema.number().optional().describe("Port for MCP server (for server-start, default: auto-assign)"),
      },
      async execute(args, _context) {
        switch (args.action) {
          case "connect": {
            if (!args.transport) {
              return { output: "Parameter 'transport' diperlukan: stdio, http, atau https" }
            }
            if (!args.command && !args.url) {
              return { output: "Parameter 'command' (stdio) atau 'url' (http/https) diperlukan" }
            }

            let headers: Record<string, string> | undefined
            if (args.headers) {
              try { headers = JSON.parse(args.headers) } catch (_e) { log.warn("Silent catch: invalid headers JSON"); headers = undefined }
            }

            const conn = await mcpClient.connect({
              transport: args.transport as import("../core/mcp-client.js").MCPTransport,
              command: args.command,
              args: args.args,
              url: args.url,
              headers,
              name: args.name,
            })

            const toolList = conn.tools.map(t => `  - **${t.name}**: ${t.description || "(no description)"}`).join("\n")
            return {
              output: `## 🔌 MCP Connected\n\n**Server:** ${conn.name}\n**Transport:** ${conn.transport}\n**Tools (${conn.tools.length}):**\n${toolList || "  *(none discovered)*"}`,
              metadata: { connection: conn },
            }
          }

          case "list": {
            const connections = mcpClient.listConnections()
            if (connections.length === 0) {
              return { output: "No MCP servers connected. Use `agentic_mcp action=connect` first." }
            }
            const lines = ["## 🔌 MCP Connections", ""]
            for (const conn of connections) {
              lines.push(`### ${conn.name}`)
              lines.push(`- Transport: ${conn.transport}`)
              lines.push(`- Connected: ${conn.connectedAt}`)
              lines.push(`- Tools:`)
              for (const tool of conn.tools) {
                lines.push(`  - **${tool.name}**: ${tool.description || "(no description)"}`)
              }
              lines.push("")
            }
            return {
              output: lines.join("\n"),
              metadata: { connections },
            }
          }

          case "call": {
            if (!args.server) return { output: "Parameter 'server' diperlukan" }
            if (!args.tool) return { output: "Parameter 'tool' diperlukan" }

            let params: Record<string, unknown> = {}
            if (args.params) {
              try { params = JSON.parse(args.params) } catch (_e) { log.warn("Silent catch: invalid params JSON"); params = {} }
            }

            const result = await mcpClient.callTool(args.server, args.tool, params)
            const contentStr = typeof result.content === "string"
              ? result.content
              : JSON.stringify(result.content, null, 2)

            return {
              output: `## 🔧 MCP Tool Call\n\n**Server:** ${args.server}\n**Tool:** ${args.tool}\n**Duration:** ${result.durationMs}ms\n${result.isError ? "❌ Error" : "✅ Success"}\n\n### Result\n\`\`\`json\n${contentStr.slice(0, 3000)}\n\`\`\``,
              metadata: { callResult: result },
            }
          }

          case "disconnect": {
            if (!args.server) return { output: "Parameter 'server' diperlukan" }
            const ok = mcpClient.disconnect(args.server)
            return {
              output: ok ? `🔌 Disconnected from ${args.server}` : `⚠️ Server "${args.server}" not found`,
              metadata: { disconnected: ok },
            }
          }

          case "disconnect-all": {
            mcpClient.disconnectAll()
            return { output: "🔌 All MCP servers disconnected" }
          }

          // ── Server management (merged from agentic_mcp_server) ──
          case "server-start": {
            if (mcpServer.getStatus().running) {
              return { output: `MCP server already running on port ${mcpServer.port}` }
            }
            await mcpServer.start()
            const url = `http://127.0.0.1:${mcpServer.port}`
            return { output: `MCP server started on port ${mcpServer.port}\n\nClients can connect via: ${url}\n\nRegistered tools: ${dynamicToolRegistry.size}`, metadata: { port: mcpServer.port, toolCount: dynamicToolRegistry.size } }
          }
          case "server-stop": {
            if (!mcpServer.getStatus().running) {
              return { output: "MCP server is not running" }
            }
            await mcpServer.stop()
            return { output: "MCP server stopped" }
          }
          case "server-restart": {
            await mcpServer.stop()
            await mcpServer.start()
            return { output: `MCP server restarted on port ${mcpServer.port}` }
          }
          case "server-status": {
            const status = mcpServer.getStatus()
            if (!status.running) {
              return { output: "MCP server is not running", metadata: { running: false } }
            }
            return {
              output: [
                `## MCP Server Status`,
                `| Metric | Value |`,
                `|--------|-------|`,
                `| Running | ✅ Yes |`,
                `| Port | ${status.port} |`,
                `| Tools | ${status.toolCount} |`,
                `| Uptime | ${(status.uptimeMs / 1000).toFixed(0)}s |`,
              ].join("\n"),
              metadata: { running: true, port: status.port, toolCount: status.toolCount, uptimeMs: status.uptimeMs },
            }
          }

          default:
            return { output: "Unknown action. Use: connect, list, call, disconnect, disconnect-all, or server-start/stop/status/restart" }
        }
      },
  }
}
