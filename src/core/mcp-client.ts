import { spawn, type ChildProcess } from "node:child_process"
import { request } from "node:http"
import { request as httpsRequest } from "node:https"
import { AgenticError, NotFoundError, ValidationError } from "./errors.js"

export type MCPTransport = "stdio" | "http" | "https"

export interface MCPConfig {
  transport: MCPTransport
  /** For stdio: path to the executable */
  command?: string
  /** For stdio: args for the executable */
  args?: string[]
  /** For HTTP(S): URL endpoint */
  url?: string
  /** For HTTP(S): API key/headers */
  headers?: Record<string, string>
  /** Name for this connection */
  name?: string
}

export interface MCPTool {
  name: string
  description: string
  parameters: Record<string, unknown>
  version?: string
}

export interface MCPCallResult {
  tool: string
  content: unknown
  isError: boolean
  durationMs: number
}

export interface MCPConnection {
  name: string
  transport: MCPTransport
  connected: boolean
  tools: MCPTool[]
  connectedAt: string
}

const STDIO_TIMEOUT = 30000 // 30s for stdio commands
const HTTP_TIMEOUT = 15000  // 15s for HTTP requests

// ── Pure Helpers ──

/**
 * Fallback JSON parser using brace counting for messages
 * where content contains newlines.
 */
function parseBraceBalanced(input: string): unknown | null {
  let braceDepth = 0
  let inString = false
  let escapeNext = false
  let startIdx = -1

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (escapeNext) {
      escapeNext = false
    } else if (ch === "\\" && inString) {
      escapeNext = true
    } else if (ch === '"') {
      inString = !inString
    } else if (!inString) {
      if (ch === "{") {
        if (startIdx === -1) startIdx = i
        braceDepth++
      } else if (ch === "}") {
        braceDepth--
        if (braceDepth === 0 && startIdx !== -1) {
          const candidate = input.slice(startIdx, i + 1)
          return JSON.parse(candidate)
        }
      }
    }
  }
  return null
}

/**
 * Check if a response chunk contains a complete JSON-RPC message.
 * MCP uses newline-delimited JSON — each complete line is a message.
 */
function parseMessages(buffer: string): { messages: unknown[]; remainder: string } {
  const messages: unknown[] = []
  const lines = buffer.split("\n")
  const remainder = lines.pop() || "" // Keep incomplete last line

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      messages.push(JSON.parse(trimmed))
    } catch {
      // Incomplete JSON — might span multiple lines in content field
      // Try brace-counting as fallback
      try {
        const parsed = parseBraceBalanced(line)
        if (parsed !== null) messages.push(parsed)
      } catch { /* skip unparseable line */ }
    }
  }

  return { messages, remainder }
}

function buildRpcMessage(method: string, id?: number, params?: Record<string, unknown>): string {
  const msg: Record<string, unknown> = {
    jsonrpc: "2.0",
    method,
  }
  if (id !== undefined) msg.id = id
  if (params !== undefined) msg.params = params
  return JSON.stringify(msg)
}

function buildInitializeParams(): Record<string, unknown> {
  return {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "opencode-agentic-engine", version: "0.3.0" },
  }
}

function parseToolsFromResult(tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>): MCPTool[] {
  return (tools || []).map(t => ({
    name: t.name,
    description: t.description || "",
    parameters: t.inputSchema || {},
  }))
}

function getRpcErrorMessage(error: { message?: string }): string {
  return error.message || JSON.stringify(error)
}

function httpRequest(url: string, body: string, headers?: Record<string, string>, timeout = HTTP_TIMEOUT): Promise<string> {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith("https")
    const requester = isHttps ? httpsRequest : request

    const urlObj = new URL(url)
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "MCP-Protocol-Version": "2024-11-05",
        ...(headers || {}),
      },
      timeout,
    }

    const req = requester(options, (res) => {
      const chunks: Buffer[] = []
      res.on("data", (chunk: Buffer) => chunks.push(chunk))
      res.on("end", () => {
        const response = Buffer.concat(chunks).toString()
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(response)
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${response.slice(0, 200)}`))
        }
      })
    })

    req.on("error", reject)
    req.on("timeout", () => {
      req.destroy()
      reject(new Error(`HTTP request timed out after ${timeout}ms`))
    })

    req.write(body)
    req.end()
  })
}

// ── MCPClient Class ──

/**
 * Minimal MCP (Model Context Protocol) client.
 * Supports stdio (subprocess) and HTTP(S) transports.
 * Auto-discovers tools via `list_tools` request.
 */
export class MCPClient {
  private connections = new Map<string, {
    config: MCPConfig
    proc?: ChildProcess
    tools: MCPTool[]
    connected: boolean
    connectedAt: string
    buffer: string
  }>()

  // ── Connection Management ──

  /**
   * Connect to an MCP server.
   */
  async connect(config: MCPConfig): Promise<MCPConnection> {
    const name = config.name || config.command || config.url || "unnamed"

    // Check if already connected
    if (this.connections.has(name) && this.connections.get(name)!.connected) {
      const existing = this.connections.get(name)!
      return {
        name,
        transport: config.transport,
        connected: true,
        tools: existing.tools,
        connectedAt: existing.connectedAt,
      }
    }

    let tools: MCPTool[] = []

    switch (config.transport) {
      case "stdio":
        tools = await this.connectStdio(name, config)
        break
      case "http":
      case "https":
        tools = await this.connectHTTP(name, config)
        break
      default:
        throw new AgenticError(`Unsupported MCP transport: ${config.transport}`, "MCP_ERROR")
    }

    const now = new Date().toISOString()
    this.connections.set(name, {
      config,
      tools,
      connected: true,
      connectedAt: now,
      buffer: "",
    })

    return {
      name,
      transport: config.transport,
      connected: true,
      tools,
      connectedAt: now,
    }
  }

  /**
   * Disconnect from a server.
   */
  disconnect(serverName: string): boolean {
    const conn = this.connections.get(serverName)
    if (!conn) return false

    if (conn.proc) {
      try {
        conn.proc.kill()
      } catch { /* ignore */ }
    }

    conn.connected = false
    this.connections.delete(serverName)
    return true
  }

  /**
   * Disconnect all servers.
   */
  disconnectAll(): void {
    for (const [name] of this.connections) {
      this.disconnect(name)
    }
  }

  /**
   * List all connected servers and their tools.
   */
  listConnections(): MCPConnection[] {
    const result: MCPConnection[] = []
    for (const [name, conn] of this.connections) {
      result.push({
        name,
        transport: conn.config.transport,
        connected: conn.connected,
        tools: conn.tools,
        connectedAt: conn.connectedAt,
      })
    }
    return result
  }

  /**
   * Get server config securely (without exposing credentials).
   * Internal use only — does not expose headers/API keys.
   */
  getServerInfo(serverName: string): { name: string; transport: MCPTransport; connected: boolean; toolCount: number } | null {
    const conn = this.connections.get(serverName)
    if (!conn) return null
    return {
      name: serverName,
      transport: conn.config.transport,
      connected: conn.connected,
      toolCount: conn.tools.length,
    }
  }

  // ── Tool Calling ──

  /**
   * Call a tool on a connected MCP server.
   */
  async callTool(serverName: string, toolName: string, args: Record<string, unknown> = {}): Promise<MCPCallResult> {
    const conn = this.connections.get(serverName)
    if (!conn || !conn.connected) {
      throw new AgenticError(`Not connected to MCP server "${serverName}"`, "MCP_NOT_CONNECTED")
    }

    // Validate tool exists and args match schema
    const tool = conn.tools.find(t => t.name === toolName)
    if (!tool) {
      throw new NotFoundError("tool", `${toolName} on server "${serverName}"`)
    }

    // Validate args against tool schema if available
    if (tool.parameters?.properties) {
      const schema = tool.parameters as { required?: string[]; properties: Record<string, { type?: string }> }
      // Check required params
      if (schema.required) {
        for (const req of schema.required) {
          if (args[req] === undefined) {
            throw new ValidationError(`Missing required argument "${req}" for tool "${toolName}"`)
          }
        }
      }
    }

    const startTime = Date.now()

    try {
      let content: unknown

      switch (conn.config.transport) {
        case "stdio":
          content = await this.callStdio(conn, toolName, args)
          break
        case "http":
        case "https":
          content = await this.callHTTP(conn, toolName, args)
          break
        default:
          throw new AgenticError(`Unsupported transport: ${conn.config.transport}`, "MCP_ERROR")
      }

      return {
        tool: toolName,
        content,
        isError: false,
        durationMs: Date.now() - startTime,
      }
    } catch (error) {
      return {
        tool: toolName,
        content: String(error),
        isError: true,
        durationMs: Date.now() - startTime,
      }
    }
  }

  // ── Stdio Transport ──

  private async connectStdio(name: string, config: MCPConfig): Promise<MCPTool[]> {
    if (!config.command) {
      throw new ValidationError("stdio transport requires a 'command'")
    }

    return new Promise((resolve, reject) => {
      const proc = spawn(config.command!, config.args ?? [], {
        stdio: ["pipe", "pipe", "pipe"],
        shell: false, // Explicitly prevent shell injection
      })

      // Manual timeout since spawn() ignores timeout option
      const timeoutId = setTimeout(() => {
        if (!settled) {
          settled = true
          try { proc.kill() } catch { /* already dead */ }
          reject(new Error(`MCP stdio connection timed out after ${STDIO_TIMEOUT}ms`))
        }
      }, STDIO_TIMEOUT)

      const state = {
        config,
        proc,
        tools: [] as MCPTool[],
        connected: false,
        connectedAt: "",
        buffer: "",
      }
      this.connections.set(name, state)

      let settled = false
      let initResolved = false // Track if initialize response received

      proc.stdout?.on("data", (data: Buffer) => {
        const chunk = data.toString()
        state.buffer += chunk

        const { messages, remainder } = parseMessages(state.buffer)
        state.buffer = remainder

        for (const msg of messages) {
          const rpc = msg as { id?: number; method?: string; result?: { protocolVersion?: string; capabilities?: Record<string, unknown>; tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> }; error?: { message?: string } }

          // Handle initialize response
          if (rpc.id === 1 && rpc.result) {
            initResolved = true

            // Send initialized notification (required by spec)
            const notifMsg = buildRpcMessage("notifications/initialized")

            try {
              proc.stdin?.write(notifMsg + "\n")
            } catch { /* ignore */ }

            // Now send tools/list (id: 2)
            const listMsg = buildRpcMessage("tools/list", 2, {})

            try {
              proc.stdin?.write(listMsg + "\n")
            } catch { /* ignore */ }

            continue
          }

          // Handle initialize error
          if (rpc.id === 1 && rpc.error) {
            if (!settled) {
              settled = true
              clearTimeout(timeoutId)
              reject(new Error(`MCP initialize failed: ${getRpcErrorMessage(rpc.error)}`))
            }
            return
          }

          // Handle tools/list response (id: 2)
          if (rpc.id === 2 && rpc.result) {
            const tools = parseToolsFromResult(rpc.result.tools || [])
            state.tools = tools

            if (!settled) {
              settled = true
              clearTimeout(timeoutId)
              resolve(tools)
            }
            continue
          }

          // Handle tools/list error
          if (rpc.id === 2 && rpc.error) {
            if (!settled) {
              settled = true
              clearTimeout(timeoutId)
              reject(new Error(`MCP tools/list failed: ${getRpcErrorMessage(rpc.error)}`))
            }
            return
          }
        }
      })

      proc.stderr?.on("data", (_data: Buffer) => {
        // MCP servers often log to stderr — ignore
      })

      proc.on("error", (err) => {
        if (!settled) {
          settled = true
          clearTimeout(timeoutId)
          reject(new Error(`MCP stdio error: ${err.message}`))
        }
      })

      proc.on("close", (code) => {
        if (!settled) {
          settled = true
          clearTimeout(timeoutId)
          // Even if closed, we might have gotten tool list
          if (state.tools.length > 0) {
            resolve(state.tools)
          } else if (initResolved) {
            reject(new Error(`MCP process exited (code ${code}) before sending tools/list response`))
          } else {
            reject(new Error(`MCP process exited with code ${code} — check command: ${config.command}`))
          }
        }
      })

      // Send initialize (id: 1) — wait for response before sending tools/list
      const initMsg = buildRpcMessage("initialize", 1, buildInitializeParams())

      // Small delay to let process start
      setTimeout(() => {
        try {
          if (!proc.stdin || proc.stdin.destroyed) {
            if (!settled) {
              settled = true
              clearTimeout(timeoutId)
              reject(new Error("MCP process stdin not available"))
            }
            return
          }
          proc.stdin.write(initMsg + "\n")
        } catch (err) {
          if (!settled) {
            settled = true
            clearTimeout(timeoutId)
            reject(err)
          }
        }
      }, 200)
    })
  }

  private async callStdio(conn: { config: MCPConfig; proc?: ChildProcess; buffer: string }, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    if (!conn.proc || !conn.proc.stdin) {
      throw new AgenticError("stdio connection not established", "MCP_NOT_CONNECTED")
    }

    return new Promise((resolve, reject) => {
      const callId = Date.now()
      const callMsg = buildRpcMessage("tools/call", callId, { name: toolName, arguments: args })

      let settled = false
      let resultBuffer = ""

      const onData = (data: Buffer) => {
        if (settled) return
        resultBuffer += data.toString()

        const { messages, remainder } = parseMessages(resultBuffer)
        resultBuffer = remainder

        for (const msg of messages) {
          const rpc = msg as { id?: number; error?: { message?: string }; result?: { content?: unknown } }
          if (rpc.id === callId) {
            cleanup()
            if (rpc.error) {
              reject(new Error(rpc.error.message || String(rpc.error)))
            } else {
              resolve(rpc.result?.content || rpc.result || null)
            }
            return
          }
        }
      }

      const onError = (err: Error) => {
        if (!settled) {
          settled = true
          cleanup()
          reject(err)
        }
      }

      const cleanup = () => {
        settled = true
        conn.proc?.stdout?.removeListener("data", onData)
        conn.proc?.removeListener("error", onError)
      }

      conn.proc!.stdout?.on("data", onData)
      conn.proc!.on("error", onError)

      // Timeout
      setTimeout(() => {
        if (!settled) {
          settled = true
          cleanup()
          reject(new Error(`MCP tool call timed out after ${STDIO_TIMEOUT}ms`))
        }
      }, STDIO_TIMEOUT)

      try {
        conn.proc!.stdin!.write(callMsg + "\n")
      } catch (err) {
        if (!settled) {
          settled = true
          cleanup()
          reject(err)
        }
      }
    })
  }

  // ── HTTP(S) Transport ──

  private async connectHTTP(_name: string, config: MCPConfig): Promise<MCPTool[]> {
    if (!config.url) {
      throw new ValidationError("HTTP transport requires a 'url'")
    }

    // Step 1: Send initialize request
    const initBody = buildRpcMessage("initialize", 1, buildInitializeParams())

    const initResponse = await httpRequest(config.url, initBody, config.headers, HTTP_TIMEOUT)
    const initParsed = JSON.parse(initResponse)

    if (initParsed.error) {
      throw new AgenticError(`MCP initialize failed: ${getRpcErrorMessage(initParsed.error)}`, "MCP_ERROR")
    }

    // Step 2: Send initialized notification (no response expected)
    const notifBody = buildRpcMessage("notifications/initialized")

    // Fire-and-forget: no response expected
    httpRequest(config.url, notifBody, config.headers, HTTP_TIMEOUT).catch(() => {})

    // Step 3: Send tools/list
    const listBody = buildRpcMessage("tools/list", 2, {})

    const listResponse = await httpRequest(config.url, listBody, config.headers, HTTP_TIMEOUT)
    const listParsed = JSON.parse(listResponse)

    if (listParsed.error) {
      throw new AgenticError(`MCP tools/list failed: ${getRpcErrorMessage(listParsed.error)}`, "MCP_ERROR")
    }

    const tools: MCPTool[] = parseToolsFromResult(listParsed.result?.tools || [])

    return tools
  }

  private async callHTTP(conn: { config: MCPConfig }, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    if (!conn.config.url) {
      throw new ValidationError("HTTP connection has no URL")
    }

    const body = buildRpcMessage("tools/call", Date.now(), { name: toolName, arguments: args })

    const response = await httpRequest(conn.config.url, body, conn.config.headers, HTTP_TIMEOUT)
    const parsed = JSON.parse(response)

    if (parsed.error) {
      throw new AgenticError(parsed.error.message || String(parsed.error), "MCP_ERROR")
    }

    return parsed.result?.content || parsed.result || null
  }
}
