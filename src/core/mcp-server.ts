/**
 * MCPServer — MCP protocol server that exposes plugin tools via MCP.
 *
 * Implements the Model Context Protocol (MCP) over HTTP transport.
 * Wraps DynamicToolRegistry to serve tools/list and tools/call.
 *
 * Part of the MCP-first architecture: the plugin serves its own tools
 * as an MCP server, so external clients can discover and call them
 * via standard MCP protocol.
 *
 * Referensi:
 * - STEM Agent (arXiv:2603.22359): Multi-protocol gateway pattern
 * - MCP Spec (modelcontextprotocol.io): JSON-RPC 2.0, initialize → tools/list → tools/call
 * - A2AServer (`src/agents/a2a-server.ts`): HTTP server + JSON-RPC routing pattern
 */

import http, { type IncomingMessage, type ServerResponse } from "node:http"
import { type DynamicToolRegistry } from "./dynamic-tool-registry.js"
import { ValidationError } from "./errors.js"

export interface MCPServerConfig {
  port?: number
  host?: string
  requestTimeout?: number
}

export interface MCPServerStatus {
  running: boolean
  port: number
  toolCount: number
  uptimeMs: number
  startTime: number
}

/**
 * MCP protocol server.
 *
 * Provides a standard MCP HTTP endpoint that external MCP clients
 * (including the plugin's own MCPClient) can connect to and discover
 * all tools registered in the DynamicToolRegistry.
 *
 * Protocol flow:
 *   1. Client sends `initialize` → server responds with capabilities
 *   2. Client sends `tools/list` → server returns all registered tools
 *   3. Client sends `tools/call` → server executes tool via registry
 *
 * MCP JSON-RPC 2.0 error codes:
 *   -32700: Parse error
 *   -32600: Invalid Request
 *   -32601: Method not found
 *   -32602: Invalid params
 *   -32603: Internal error
 *   -32001: Server not found (custom)
 *   -32002: Request timeout (custom)
 */
export class MCPServer {
  private server: http.Server | null = null
  private startTime = 0
  private registry: DynamicToolRegistry

  constructor(
    registry: DynamicToolRegistry,
    private config: MCPServerConfig = {},
  ) {
    this.registry = registry
  }

  /**
   * Start the MCP HTTP server.
   */
  async start(): Promise<void> {
    if (this.server) return

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res))
      this.server.on("error", reject)
      this.server.listen(
        this.config.port ?? 4124,
        this.config.host ?? "127.0.0.1",
        () => {
          this.startTime = Date.now()
          resolve()
        },
      )
    })
  }

  /**
   * Stop the MCP server.
   */
  async stop(): Promise<void> {
    if (!this.server) return
    return new Promise((resolve) => {
      this.server!.close(() => {
        this.server = null
        resolve()
      })
    })
  }

  /**
   * Get the port the server is listening on.
   */
  get port(): number {
    const addr = this.server?.address()
    if (addr && typeof addr === "object") return addr.port
    return this.config.port ?? 4124
  }

  /**
   * Get server status.
   */
  getStatus(): MCPServerStatus {
    return {
      running: this.server !== null,
      port: this.port,
      toolCount: this.registry.size,
      uptimeMs: this.startTime > 0 ? Date.now() - this.startTime : 0,
      startTime: this.startTime,
    }
  }

  // ── HTTP Request Handler ──

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")

    if (req.method === "OPTIONS") {
      res.writeHead(204)
      res.end()
      return
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)

    // GET /health — health check
    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ status: "ok", tools: this.registry.size }))
      return
    }

    // GET / or /tools — list tools (convenience for non-MCP clients)
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/tools")) {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ tools: this.registry.toMCPTools() }))
      return
    }

    // POST / or /rpc — JSON-RPC endpoint (MCP protocol)
    if (req.method === "POST" && (url.pathname === "/" || url.pathname === "/rpc")) {
      this.handleJsonRpc(req, res)
      return
    }

    // 404
    res.writeHead(404)
    res.end(JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32001, message: "Not found" },
    }))
  }

  // ── JSON-RPC Handler ──

  private handleJsonRpc(req: IncomingMessage, res: ServerResponse): void {
    let body = ""
    req.setEncoding("utf-8")

    const timeout = setTimeout(() => {
      res.writeHead(408)
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32002, message: "Request timeout" },
      }))
    }, this.config.requestTimeout ?? 30000)

    req.on("data", (chunk: string) => { body += chunk })
    req.on("end", async () => {
      clearTimeout(timeout)

      let rpcReq: { jsonrpc: string; id: string | number; method: string; params?: Record<string, unknown> }
      try {
        rpcReq = JSON.parse(body)
        if (rpcReq.jsonrpc !== "2.0" || !rpcReq.method) throw new ValidationError("Invalid JSON-RPC")
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        }))
        return
      }

      try {
        const response = await this.executeMethod(rpcReq)
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify(response))
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" })
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: rpcReq.id,
          error: { code: -32603, message: `Internal error: ${err}` },
        }))
      }
    })
  }

  // ── MCP Method Router ──

  private async executeMethod(req: {
    jsonrpc: string
    id: string | number
    method: string
    params?: Record<string, unknown>
  }): Promise<Record<string, unknown>> {
    const id = req.id

    switch (req.method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "opencode-agentic-engine", version: "0.6.0" },
          },
        }

      case "tools/list":
        return {
          jsonrpc: "2.0",
          id,
          result: { tools: this.registry.toMCPTools() },
        }

      case "tools/call": {
        const params = req.params as { name?: string; arguments?: Record<string, unknown> } | undefined
        if (!params?.name) {
          return {
            jsonrpc: "2.0",
            id,
            error: { code: -32602, message: "Invalid params: 'name' is required" },
          }
        }

        const result = await this.registry.call(params.name, params.arguments ?? {})
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text" as const, text: String(result.content) }],
            isError: result.isError,
          },
        }
      }

      default:
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Method not found: ${req.method}` },
        }
    }
  }
}
