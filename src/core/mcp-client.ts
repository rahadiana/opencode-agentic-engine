import { spawn, type ChildProcess } from "node:child_process"
import { request } from "node:http"
import { request as httpsRequest } from "node:https"

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
        throw new Error(`Unsupported MCP transport: ${config.transport}`)
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
   * Call a tool on a connected MCP server.
   */
  async callTool(serverName: string, toolName: string, args: Record<string, unknown> = {}): Promise<MCPCallResult> {
    const conn = this.connections.get(serverName)
    if (!conn || !conn.connected) {
      throw new Error(`Not connected to MCP server "${serverName}"`)
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
          throw new Error(`Unsupported transport: ${conn.config.transport}`)
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

  // ── Stdio Transport ──

  private async connectStdio(name: string, config: MCPConfig): Promise<MCPTool[]> {
    if (!config.command) {
      throw new Error("stdio transport requires a 'command'")
    }

    return new Promise((resolve, reject) => {
      const proc = spawn(config.command!, config.args ?? [], {
        stdio: ["pipe", "pipe", "pipe"],
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
      const stdout: string[] = []

      proc.stdout?.on("data", (data: Buffer) => {
        const chunk = data.toString()
        state.buffer += chunk
        stdout.push(chunk)

        // Try to find JSON-RPC response in buffer
        const lines = state.buffer.split("\n")
        state.buffer = lines.pop() || "" // Keep incomplete last line

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const msg = JSON.parse(line)
            if (msg.id === 1 && msg.result) {
              const tools = (msg.result.tools || msg.result.tools || []).map((t: { name: string; description?: string; inputSchema?: Record<string, unknown> }) => ({
                name: t.name,
                description: t.description || "",
                parameters: t.inputSchema || {},
              }))
              state.tools = tools

              if (!settled) {
                settled = true
                resolve(tools)
              }
            }
          } catch { /* JSON parse error — still accumulating */ }
        }
      })

      proc.stderr?.on("data", (_data: Buffer) => {
        // MCP servers often log to stderr — ignore
      })

      proc.on("error", (err) => {
        if (!settled) {
          settled = true
          reject(new Error(`MCP stdio error: ${err.message}`))
        }
      })

      proc.on("close", (code) => {
        if (!settled) {
          settled = true
          // Even if closed, we might have gotten tool list
          if (state.tools.length > 0) {
            resolve(state.tools)
          } else {
            reject(new Error(`MCP process exited with code ${code}`))
          }
        }
      })

      // Send initialize + list_tools
      const initMsg = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "opencode-agentic-engine", version: "0.3.0" },
        },
      })

      const listMsg = JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      })

      // Small delay to let process start
      setTimeout(() => {
        try {
          proc.stdin?.write(initMsg + "\n")
          setTimeout(() => {
            try {
              proc.stdin?.write(listMsg + "\n")
            } catch { /* ignore */ }
          }, 500)

          // Timeout: resolve with whatever we have
          setTimeout(() => {
            if (!settled) {
              settled = true
              clearTimeout(timeoutId)
              resolve(state.tools.length > 0 ? state.tools : [])
            }
          }, STDIO_TIMEOUT)
        } catch (err) {
          if (!settled) {
            settled = true
            reject(err)
          }
        }
      }, 200)
    })
  }

  private async callStdio(conn: { config: MCPConfig; proc?: ChildProcess; buffer: string }, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    if (!conn.proc || !conn.proc.stdin) {
      throw new Error("stdio connection not established")
    }

    return new Promise((resolve, reject) => {
      const callId = Date.now()
      const callMsg = JSON.stringify({
        jsonrpc: "2.0",
        id: callId,
        method: "tools/call",
        params: {
          name: toolName,
          arguments: args,
        },
      })

      let settled = false
      let resultBuffer = ""
      let braceDepth = 0
      let inString = false
      let escapeNext = false

      const onData = (data: Buffer) => {
        const chunk = data.toString()
        resultBuffer += chunk

        // Find complete JSON objects using brace counting (handles newlines in content)
        let i = 0
        while (i < resultBuffer.length) {
          const ch = resultBuffer[i]
          if (escapeNext) {
            escapeNext = false
          } else if (ch === "\\" && inString) {
            escapeNext = true
          } else if (ch === '"') {
            inString = !inString
          } else if (!inString) {
            if (ch === "{") braceDepth++
            else if (ch === "}") {
              braceDepth--
              if (braceDepth === 0) {
                // Found a complete JSON object
                const candidate = resultBuffer.slice(0, i + 1)
                resultBuffer = resultBuffer.slice(i + 1)
                i = -1 // Reset loop
                try {
                  const msg = JSON.parse(candidate)
                  if (msg.id === callId) {
                    cleanup()
                    if (msg.error) {
                      reject(new Error(msg.error.message || String(msg.error)))
                    } else {
                      resolve(msg.result?.content || msg.result || null)
                    }
                    return
                  }
                } catch { /* not valid JSON, continue */ }
              }
            }
          }
          i++
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
      throw new Error("HTTP transport requires a 'url'")
    }

    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    })

    const response = await this.httpRequest(config.url, body, config.headers, HTTP_TIMEOUT)
    const parsed = JSON.parse(response)

    const tools: MCPTool[] = (parsed.result?.tools || []).map((t: { name: string; description?: string; inputSchema?: Record<string, unknown> }) => ({
      name: t.name,
      description: t.description || "",
      parameters: t.inputSchema || {},
    }))

    return tools
  }

  private async callHTTP(conn: { config: MCPConfig }, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    if (!conn.config.url) {
      throw new Error("HTTP connection has no URL")
    }

    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: {
        name: toolName,
        arguments: args,
      },
    })

    const response = await this.httpRequest(conn.config.url, body, conn.config.headers, HTTP_TIMEOUT)
    const parsed = JSON.parse(response)

    if (parsed.error) {
      throw new Error(parsed.error.message || String(parsed.error))
    }

    return parsed.result?.content || parsed.result || null
  }

  private httpRequest(url: string, body: string, headers?: Record<string, string>, timeout = HTTP_TIMEOUT): Promise<string> {
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
}
