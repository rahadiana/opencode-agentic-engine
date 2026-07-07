import { tool } from "@opencode-ai/plugin"
import type { ToolSpec } from "./types.js"
import type { ToolContext } from "./tool-context.js"
import type { A2AClient } from "../agents/a2a-client.js"
import type { A2AServer } from "../agents/a2a-server.js"

// Module-level state for A2A client/server singletons
let _a2aClient: A2AClient | null = null
let _a2aServer: A2AServer | null = null

function getA2AClient(): A2AClient | null { return _a2aClient }
function setA2AClient(c: A2AClient | null): void { _a2aClient = c }
function getA2AServer(): A2AServer | null { return _a2aServer }
function setA2AServer(s: A2AServer | null): void { _a2aServer = s }

export function makeA2aTool(ctx: ToolContext): ToolSpec {
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
      description: "A2A (Agent-to-Agent) protocol: discover remote agents, delegate tasks, serve Agent Card. Google A2A standard for cross-framework interoperability.",
      args: {
        action: tool.schema.string().describe("Action: serve, stop, discover, delegate, list, ping, stats, status"),
        url: tool.schema.string().optional().describe("Remote agent URL (for discover/delegate/ping)"),
        agentName: tool.schema.string().optional().describe("Agent name for Agent Card (for serve action)"),
        port: tool.schema.number().optional().describe("Port for A2A server (default: 4123)"),
        serverUrl: tool.schema.string().optional().describe("A2A server URL for task delegation"),
        taskDescription: tool.schema.string().optional().describe("Task description (for delegate action)"),
        instructions: tool.schema.string().optional().describe("Additional instructions for delegated task"),
      },
      async execute(args: Record<string, unknown>, _context: Record<string, unknown>) {
        const action = (args.action as string) || "status"
        const { A2AClient: A2AClientClass } = await import("../agents/a2a-client.js")
        let a2aClient = getA2AClient()
        if (!a2aClient) {
          a2aClient = new A2AClientClass()
          setA2AClient(a2aClient)
        }

        switch (action) {
          case "serve": {
            // Start A2A server
            const name = (args.agentName as string) || "opencode-agentic-engine"
            const port = (args.port as number) || 4123

            // Build AgentCard from skill store
            const allSkills = skillStore.getAll()
            const capabilities: Array<{
              id: string; name: string; description: string
              skillId?: string; estimatedSuccessRate?: number
            }> = allSkills.slice(0, 50).map(s => ({
              id: s.definition.trigger.capability ?? s.definition.meta.name.toLowerCase().replace(/\s+/g, "."),
              name: s.definition.meta.name,
              description: `${s.definition.workflow.steps.length} steps, ${(s.successRate * 100).toFixed(0)}% success`,
              skillId: s.definition.meta.id,
              estimatedSuccessRate: s.successRate,
            }))

            // Add built-in capabilities
            capabilities.push(
              { id: "plan", name: "Task Planning", description: "Auto-decompose goals into subtasks", estimatedSuccessRate: 0.9 },
              { id: "code.execute", name: "Code Execution", description: "Read, write, edit source code", estimatedSuccessRate: 0.85 },
              { id: "code.verify", name: "Code Verification", description: "Compile, lint, test, security audit", estimatedSuccessRate: 0.8 },
              { id: "nav.search", name: "Codebase Navigation", description: "Search and analyze codebase", estimatedSuccessRate: 0.9 },
            )

            const agentCard = {
              protocolVersion: "1.0",
              name,
              description: `OpenCode Agentic Engine — ${capabilities.length} capabilities, ${allSkills.length} skills`,
              url: `http://127.0.0.1:${port}`,
              capabilities,
            }

            // Stop existing server if running
            const existingServer = getA2AServer()
            if (existingServer) {
              try { await existingServer.stop() } catch (e) { log.warn("Silent catch: ignore", { error: String(e) }) }
            }

            const { A2AServer } = await import("../agents/a2a-server.js")
            const server = new A2AServer({
              port,
              host: "127.0.0.1",
              agentCard,
            })
            await server.start()
            setA2AServer(server)

            const actualPort = server.port
            return {
              output: [
                `## 🤖 A2A Server Started`,
                ``,
                `**Agent:** ${name}`,
                `**Endpoint:** http://127.0.0.1:${actualPort}/a2a`,
                `**Card:** http://127.0.0.1:${actualPort}/a2a/card`,
                `**Capabilities:** ${capabilities.length}`,
                `**Skills exported:** ${allSkills.length}`,
                ``,
                `> Other agents can discover this agent via \`agentic_a2a action=discover url=http://127.0.0.1:${actualPort}\``,
                `> Or delegate tasks via \`agentic_a2a action=delegate serverUrl=http://127.0.0.1:${actualPort} taskDescription="..."\``,
              ].join("\n"),
              metadata: { port: actualPort, agentName: name, capabilities: capabilities.length },
            }
          }

          case "stop": {
            const stopSrv = getA2AServer()
            if (!stopSrv) {
              return { output: "⚠️ No A2A server running" }
            }
            const status = stopSrv.getStatus()
            await stopSrv.stop()
            setA2AServer(null)
            return {
              output: [
                `## 🛑 A2A Server Stopped`,
                ``,
                `**Agent:** ${status.agentName}`,
                `**Uptime:** ${(status.uptimeMs / 1000).toFixed(0)}s`,
                `**Tasks processed:** ${status.totalTasks}`,
              ].join("\n"),
            }
          }

          case "discover": {
            const url = args.url as string
            if (!url) return { output: "Parameter 'url' diperlukan untuk discover" }

            const card = await a2aClient.discover(url)
            if (!card) {
              return { output: `❌ Could not discover agent at ${url}` }
            }

            return {
              output: [
                `## 🧭 Remote Agent Discovered`,
                ``,
                `**Name:** ${card.name}`,
                `**Description:** ${card.description}`,
                `**URL:** ${card.url}`,
                `**Protocol:** ${card.protocolVersion}`,
                `**Capabilities (${card.capabilities.length}):`,
                ...card.capabilities.map(c => `  - **${c.name}** (\`${c.id}\`)${c.estimatedSuccessRate ? ` — ${(c.estimatedSuccessRate * 100).toFixed(0)}% success` : ""}`),
              ].join("\n"),
              metadata: { card },
            }
          }

          case "delegate": {
            const serverUrl = (args.serverUrl || args.url) as string
            if (!serverUrl) return { output: "Parameter 'serverUrl' diperlukan untuk delegate" }

            const taskDesc = (args.taskDescription || args.taskDescription || "Task from A2A client") as string
            const instructions = args.instructions as string || taskDesc

            const taskId = { id: `a2a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
            const messages = [
              { role: "user" as const, parts: [{ type: "text" as const, text: taskDesc }], id: "msg-1", timestamp: new Date().toISOString() },
            ]

            const result = await a2aClient.taskSend(serverUrl, taskId, messages, instructions)

            if (!result) {
              return { output: `❌ Failed to delegate task to ${serverUrl}` }
            }

            const task = result.task
            return {
              output: [
                `## 📤 Task Delegated`,
                ``,
                `**To:** ${serverUrl}`,
                `**Task ID:** ${task.id.id}`,
                `**Status:** ${task.status}`,
                task.statusDescription ? `**Description:** ${task.statusDescription}` : "",
                ``,
                `**Messages (${task.messages.length}):`,
                ...task.messages.map(m => `  - [${m.role}] ${m.parts.map(p => p.type === "text" ? p.text.slice(0, 100) : `[${p.type}]`).join(", ")}`),
                ``,
                task.artifacts.length > 0 ? `**Artifacts (${task.artifacts.length}):` : "",
                ...task.artifacts.map(a => `  - ${a.name}: ${a.parts.length} part(s)`),
              ].filter(Boolean).join("\n"),
              metadata: { task },
            }
          }

          case "list": {
            const agents = a2aClient.listDiscoveredAgents()
            if (agents.length === 0) {
              return { output: "No remote agents discovered yet. Use `agentic_a2a action=discover url=...` first." }
            }
            return {
              output: [
                `## 🌐 Discovered Agents (${agents.length})`,
                ``,
                ...agents.map(a => [
                  `### ${a.card.name}`,
                  `- URL: ${a.card.url}`,
                  `- Capabilities: ${a.card.capabilities.length}`,
                  `- Discovered: ${new Date(a.discoveredAt).toLocaleTimeString()}`,
                ].join("\n")),
              ].join("\n\n"),
              metadata: { agents: agents.map(a => ({ name: a.card.name, url: a.card.url, capabilities: a.card.capabilities.length })) },
            }
          }

          case "ping": {
            const url = args.url as string
            if (!url) return { output: "Parameter 'url' diperlukan untuk ping" }

            const card = await a2aClient.discover(url)
            if (!card) {
              return { output: `❌ Agent at ${url} unreachable` }
            }
            return {
              output: `✅ Agent **${card.name}** reachable at ${url} — ${card.capabilities.length} capabilities`,
              metadata: { reachable: true, card },
            }
          }

          case "stats":
          case "status": {
            const stats = a2aClient.getStats()
            const lines = [
              `## 📊 A2A Protocol Status`,
              ``,
              `### Client`,
              `| Metric | Value |`,
              `|--------|-------|`,
              `| Cached agents | ${stats.cachedCards} |`,
              `| Tasks sent | ${stats.tasksSent} |`,
              `| Tasks completed | ${stats.tasksCompleted} |`,
              `| Tasks failed | ${stats.tasksFailed} |`,
              `| Avg latency | ${stats.averageLatencyMs}ms |`,
              ``,
            ]

            const statsSrv = getA2AServer()
            if (statsSrv) {
              const srv = statsSrv.getStatus()
              lines.push(
                `### Server`,
                `| Metric | Value |`,
                `|--------|-------|`,
                `| Running | ✅ Yes on port ${srv.port} |`,
                `| Agent | ${srv.agentName} |`,
                `| Capabilities | ${srv.capabilities} |`,
                `| Active tasks | ${srv.activeTasks} |`,
                `| Total tasks | ${srv.totalTasks} |`,
                `| Uptime | ${(srv.uptimeMs / 1000).toFixed(0)}s |`,
              )
            } else {
              lines.push(`### Server\n\n⚠️ Not running. Use \`agentic_a2a action=serve\` to start.`)
            }

            return { output: lines.join("\n") }
          }

          default:
            return { output: "Unknown action. Use: serve, stop, discover, delegate, list, ping, stats" }
        }
      },
  }
}
