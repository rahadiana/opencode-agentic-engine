/**
 * ProtocolAdapter — Unified gateway for MCP + A2A protocols.
 *
 * STEM Agent (arXiv:2603.22359) multi-protocol gateway pattern:
 * "5 protocols (A2A, AG-UI, A2UI, UCP, AP2) di belakang unified gateway"
 *
 * Provides a single interface for:
 *   - Discovering tools/agents across MCP and A2A
 *   - Auto-routing calls to the correct backend
 *   - Unified connection management
 *   - Combined statistics
 */

import { type MCPClient, type MCPConfig, type MCPConnection, type MCPCallResult } from "./mcp-client.js"
import { type A2AClient, type DiscoveredAgent, type TaskSendResult } from "../agents/a2a-client.js"
import type { AgentCard } from "../agents/a2a-types.js"
import type { A2AServerConfig, A2AServerStatus } from "../agents/a2a-server.js"

// ── Types ────────────────────────────────────────────

export type Protocol = "mcp" | "a2a"

/** Unified descriptor for any discoverable capability */
export interface ToolDescriptor {
  protocol: Protocol
  name: string
  description: string
  /** For MCP: the server name; for A2A: the agent URL */
  source: string
  /** Protocol-specific parameters schema */
  parameters?: Record<string, unknown>
}

export interface ProtocolCallResult {
  protocol: Protocol
  success: boolean
  content: unknown
  durationMs: number
  source: string
  method: string
  isError: boolean
}

export interface ProtocolAdapterStats {
  mcp: {
    connections: number
    totalTools: number
  }
  a2a: {
    listened: boolean
    discoveredAgents: number
    tasksSent: number
    tasksCompleted: number
    tasksFailed: number
  }
  combined: {
    totalConnections: number
    totalTools: number
  }
}

// ── Adapter Class ────────────────────────────────────

/**
 * ProtocolAdapter — Unified gateway that wraps existing MCPClient + A2AClient/A2AServer
 * instances and provides unified search, routing, discovery, and statistics.
 *
 * Designed as a thin "view" layer — all state is owned by the underlying clients.
 * A2A instances are obtained from globalThis (where agentic_a2a tool stores them
 * via lazy-init pattern).
 */
export class ProtocolAdapter {
  private mcpClient: MCPClient

  constructor(mcpClient: MCPClient) {
    this.mcpClient = mcpClient
  }

  /** Get A2A client from globalThis (lazy-init by agentic_a2a tool), or null if not initialized */
  private get a2aClient(): A2AClient | null {
    const g = globalThis as { __opencode_a2aClient?: A2AClient }
    return g.__opencode_a2aClient ?? null
  }

  /** Get A2A server from globalThis (lazy-init by agentic_a2a tool) */
  private get a2aServer(): import("../agents/a2a-server.js").A2AServer | null {
    const g = globalThis as { __opencode_a2aServer?: import("../agents/a2a-server.js").A2AServer }
    return g.__opencode_a2aServer ?? null
  }

  // ── MCP Operations ────────────────────────────────

  /** Connect to an MCP server and discover its tools */
  async connectMCP(config: MCPConfig): Promise<MCPConnection> {
    return this.mcpClient.connect(config)
  }

  /** List all MCP connections */
  listMCP(): MCPConnection[] {
    return this.mcpClient.listConnections()
  }

  /** Get info about a specific MCP server */
  getMCPInfo(serverName: string): { name: string; transport: string; connected: boolean; toolCount: number } | null {
    return this.mcpClient.getServerInfo(serverName)
  }

  /** Call a tool on an MCP server */
  async callMCP(serverName: string, toolName: string, args: Record<string, unknown> = {}): Promise<MCPCallResult> {
    return this.mcpClient.callTool(serverName, toolName, args)
  }

  /** Disconnect from an MCP server */
  disconnectMCP(serverName: string): boolean {
    return this.mcpClient.disconnect(serverName)
  }

  /** Disconnect all MCP servers */
  disconnectAllMCP(): void {
    this.mcpClient.disconnectAll()
  }

  // ── A2A Client Operations ─────────────────────────

  /** Discover a remote A2A agent */
  async discoverA2A(url: string): Promise<AgentCard | null> {
    if (!this.a2aClient) return null
    return this.a2aClient.discover(url)
  }

  /** Get cached agent card (if recently discovered) */
  getCachedAgent(url: string): AgentCard | null {
    if (!this.a2aClient) return null
    return this.a2aClient.getCachedAgent(url)
  }

  /** List all discovered A2A agents */
  listA2AAgents(): DiscoveredAgent[] {
    if (!this.a2aClient) return []
    return this.a2aClient.listDiscoveredAgents()
  }

  /** Send a task to a remote A2A agent */
  async delegateA2A(serverUrl: string, taskDescription: string, messages?: Array<{ role: string; content: string }>): Promise<TaskSendResult> {
    if (!this.a2aClient) throw new Error("A2A client not initialized — call agentic_a2a first")
    const a2aMessages = messages?.map(m => ({
      role: m.role as "agent" | "user",
      parts: [{ type: "text" as const, text: m.content }],
    })) ?? [{ role: "user" as const, parts: [{ type: "text" as const, text: taskDescription }] }]
    const result = await this.a2aClient.taskSend(serverUrl, { id: "", sessionId: "" }, a2aMessages)
    if (!result) throw new Error("A2A task send returned no result")
    return result
  }

  /** Get task status from a remote A2A agent */
  async getA2ATask(serverUrl: string, taskIdStr: string): Promise<unknown> {
    if (!this.a2aClient) throw new Error("A2A client not initialized")
    return this.a2aClient.taskGet(serverUrl, { id: taskIdStr })
  }

  /** Cancel a task on a remote A2A agent */
  async cancelA2ATask(serverUrl: string, taskIdStr: string): Promise<boolean> {
    if (!this.a2aClient) return false
    return this.a2aClient.taskCancel(serverUrl, { id: taskIdStr })
  }

  /** Clear A2A agent cache */
  clearA2ACache(): void {
    if (!this.a2aClient) return
    this.a2aClient.clearCache()
  }

  // ── A2A Server Operations ─────────────────────────

  /** Start an A2A server to serve this agent */
  async serveA2A(config: A2AServerConfig): Promise<void> {
    const g = globalThis as { __opencode_a2aServer?: import("../agents/a2a-server.js").A2AServer }
    if (g.__opencode_a2aServer) {
      await g.__opencode_a2aServer.stop()
    }
    // Import dynamically to avoid circular dependency at module level
    const { A2AServer: A2AServerClass } = await import("../agents/a2a-server.js")
    g.__opencode_a2aServer = new A2AServerClass(config)
    await g.__opencode_a2aServer.start()
  }

  /** Stop the A2A server */
  async stopA2A(): Promise<void> {
    const g = globalThis as { __opencode_a2aServer?: import("../agents/a2a-server.js").A2AServer }
    if (g.__opencode_a2aServer) {
      await g.__opencode_a2aServer.stop()
      delete (g as any).__opencode_a2aServer
    }
  }

  /** Get A2A server status */
  getA2AStatus(): A2AServerStatus | null {
    const g = globalThis as { __opencode_a2aServer?: import("../agents/a2a-server.js").A2AServer }
    return g.__opencode_a2aServer?.getStatus() ?? null
  }

  /** Update the A2A server's Agent Card */
  updateA2ACard(card: AgentCard): void {
    const g = globalThis as { __opencode_a2aServer?: import("../agents/a2a-server.js").A2AServer }
    g.__opencode_a2aServer?.updateCard(card)
  }

  /** Get the A2A server's Agent Card */
  getA2ACard(): AgentCard | undefined {
    const g = globalThis as { __opencode_a2aServer?: import("../agents/a2a-server.js").A2AServer }
    return g.__opencode_a2aServer?.getCard()
  }

  // ── UNIFIED Operations ────────────────────────────

  /**
   * Find tools/capabilities across both protocols.
   * Searches MCP tool names+descriptions and A2A agent cards+capabilities.
   */
  findTools(query: string, maxResults = 20): ToolDescriptor[] {
    const results: ToolDescriptor[] = []
    const lower = query.toLowerCase()
    const terms = lower.split(/\s+/).filter(Boolean)

    if (terms.length === 0) return results

    // Search MCP tools
    const mcpConnections = this.mcpClient.listConnections()
    for (const conn of mcpConnections) {
      for (const tool of conn.tools) {
        const searchable = `${tool.name} ${tool.description}`.toLowerCase()
        if (terms.every(t => searchable.includes(t))) {
          results.push({
            protocol: "mcp",
            name: tool.name,
            description: tool.description,
            source: conn.name,
            parameters: tool.parameters as Record<string, unknown> | undefined,
          })
        }
      }
    }

    // Search A2A agents (if A2A client is available)
    const agents = this.a2aClient?.listDiscoveredAgents() ?? []
    for (const agent of agents) {
      const card = agent.card
      // Search in agent name, description, and capabilities
      const searchable = [
        card.name,
        card.description || "",
        ...(card.capabilities || []).map((c: { id?: string; name?: string; description?: string }) => `${c.id || ""} ${c.name || ""} ${c.description || ""}`),
      ].join(" ").toLowerCase()

      if (terms.every(t => searchable.includes(t))) {
        // Add each capability as a separate tool descriptor
        const caps = card.capabilities || []
        if (caps.length > 0) {
          for (const cap of caps) {
          results.push({
            protocol: "a2a",
            name: cap.name || cap.id || card.name,
            description: cap.description || `${card.name} capability: ${cap.name || cap.id}`,
            source: `a2a:${card.url || card.name}`,
          })
          }
        } else {
          // No capabilities listed — add agent itself as a discoverable target
          results.push({
            protocol: "a2a",
            name: card.name,
            description: card.description || `A2A agent: ${card.name}`,
            source: `a2a:${card.url || card.name}`,
          })
        }
      }
    }

    // Sort by relevance: exact name match first, then description match
    results.sort((a, b) => {
      const aName = a.name.toLowerCase() === query.toLowerCase() ? -1 : 0
      const bName = b.name.toLowerCase() === query.toLowerCase() ? -1 : 0
      return aName - bName || a.description.length - b.description.length
    })

    return results.slice(0, maxResults)
  }

  /**
   * Call a tool/action via the correct protocol.
   * Auto-routes based on tool descriptor or explicit protocol.
   */
  async call(target: {
    protocol: Protocol
    source: string
    name: string
  }, params: Record<string, unknown> = {}): Promise<ProtocolCallResult> {
    const start = Date.now()

    if (target.protocol === "mcp") {
      try {
        const result = await this.mcpClient.callTool(target.source, target.name, params)
        return {
          protocol: "mcp",
          success: !result.isError,
          content: result.content,
          durationMs: result.durationMs,
          source: target.source,
          method: target.name,
          isError: result.isError,
        }
      } catch (err) {
        return {
          protocol: "mcp",
          success: false,
          content: (err as Error).message,
          durationMs: Date.now() - start,
          source: target.source,
          method: target.name,
          isError: true,
        }
      }
    }

    if (target.protocol === "a2a") {
      if (!this.a2aClient) {
        return {
          protocol: "a2a",
          success: false,
          content: "A2A client not initialized — call agentic_a2a first",
          durationMs: Date.now() - start,
          source: target.source,
          method: target.name,
          isError: true,
        }
      }
      try {
        const taskDesc = (params.taskDescription as string) || (params.query as string) || `Execute ${target.name} with params: ${JSON.stringify(params)}`
        const msgs = params.messages as Array<{ role: string; content: string }> | undefined
        const a2aMessages = msgs?.map(m => ({
          role: m.role as "agent" | "user",
          parts: [{ type: "text" as const, text: m.content }],
        })) ?? [{ role: "user" as const, parts: [{ type: "text" as const, text: taskDesc }] }]
        const result = await this.a2aClient.taskSend(target.source, { id: "", sessionId: "" }, a2aMessages)
        if (!result) throw new Error("A2A task send returned no result")
        const task = result.task
        const isComplete = task.status === "completed" || task.status === "working"
        const isFailed = task.status === "failed"
        return {
          protocol: "a2a",
          success: isComplete,
          content: task.artifacts || task.messages || task.status,
          durationMs: Date.now() - start,
          source: target.source,
          method: target.name,
          isError: isFailed,
        }
      } catch (err) {
        return {
          protocol: "a2a",
          success: false,
          content: (err as Error).message,
          durationMs: Date.now() - start,
          source: target.source,
          method: target.name,
          isError: true,
        }
      }
    }

    throw new Error(`Unknown protocol: ${target.protocol}`)
  }

  /** List all available connections (MCP servers + A2A agents) */
  listAll(): Array<{
    protocol: Protocol
    name: string
    description: string
    connected: boolean
    toolCount: number
  }> {
    const results: Array<{
      protocol: Protocol
      name: string
      description: string
      connected: boolean
      toolCount: number
    }> = []

    // MCP connections
    const mcpConns = this.mcpClient.listConnections()
    for (const conn of mcpConns) {
      results.push({
        protocol: "mcp",
        name: conn.name,
        description: `MCP server (${conn.transport}) with ${conn.tools.length} tools`,
        connected: conn.connected,
        toolCount: conn.tools.length,
      })
    }

    // A2A server (self)
    if (this.a2aServer) {
      const status = this.a2aServer.getStatus()
      const card = this.a2aServer.getCard()
      results.push({
        protocol: "a2a",
        name: `A2A Server (local)`,
        description: card?.description || `Local A2A agent server on port ${status.port}`,
        connected: status.running,
        toolCount: card?.capabilities?.length ?? 0,
      })
    }

    // A2A discovered agents (if A2A client is available)
    const agents = this.a2aClient?.listDiscoveredAgents() ?? []
    for (const agent of agents) {
      const card = agent.card
      results.push({
        protocol: "a2a",
        name: card.name,
        description: card.description || `A2A agent at ${card.url}`,
        connected: true,
        toolCount: card.capabilities?.length ?? 0,
      })
    }

    return results
  }

  /** Get combined statistics across both protocols */
  getStats(): ProtocolAdapterStats {
    const mcpConns = this.mcpClient.listConnections()
    const mcpTools = mcpConns.reduce((sum, c) => sum + c.tools.length, 0)
    const a2aAgents = this.a2aClient?.listDiscoveredAgents() ?? []
    const a2aStats = this.a2aClient?.getStats() ?? { tasksSent: 0, tasksCompleted: 0, tasksFailed: 0 }

    return {
      mcp: {
        connections: mcpConns.length,
        totalTools: mcpTools,
      },
      a2a: {
        listened: this.a2aServer !== null && this.a2aServer.getStatus().running,
        discoveredAgents: a2aAgents.length,
        tasksSent: a2aStats.tasksSent,
        tasksCompleted: a2aStats.tasksCompleted,
        tasksFailed: a2aStats.tasksFailed,
      },
      combined: {
        totalConnections: mcpConns.length + a2aAgents.length + (this.a2aServer ? 1 : 0),
        totalTools: mcpTools + a2aAgents.reduce((sum, a) => sum + (a.card.capabilities?.length ?? 0), 0),
      },
    }
  }
}
