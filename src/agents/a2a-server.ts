/**
 * A2A Protocol Server — Agent-to-Agent HTTP server.
 *
 * Serves A2A JSON-RPC 2.0 endpoints for agent discovery and task delegation.
 * Integrates with skill-store (AgentCard capabilities) and coordinator (task execution).
 *
 * Endpoints:
 *   POST /a2a — JSON-RPC handler (agent/getCard, tasks/send, tasks/get, tasks/cancel)
 *   POST /a2a/stream — SSE streaming for tasks/sendSubscribe
 *   GET  /a2a/card — Agent Card (simple GET for discovery)
 *
 * Usage:
 *   const server = new A2AServer({ port: 4123, agentCard: myCard, executor: myExecutor })
 *   await server.start()
 *   // ... later
 *   await server.stop()
 */

import http, { type IncomingMessage, type ServerResponse } from "node:http"
import type {
  AgentCard,
  Task,
  TaskId,
  TaskStatus,
  JsonRpcRequest,
  JsonRpcResponse,
  A2AMessage,
  Artifact,
} from "./a2a-types.js"
import {
  A2A_METHODS,
  A2A_CONTENT_TYPE,
  A2A_SSE_CONTENT_TYPE,
  A2A_PROTOCOL_VERSION,
  createJsonRpcError,
  createJsonRpcResult,
  createTextMessage,
} from "./a2a-types.js"

// ── Types ──────────────────────────────────────────────────

export interface A2AServerConfig {
  /** Port to listen on (default: 0 = random available) */
  port?: number
  /** Host to bind to (default: "127.0.0.1") */
  host?: string
  /** The Agent Card this server advertises */
  agentCard: AgentCard
  /** Optional: custom task executor */
  taskExecutor?: A2ATaskExecutor
  /** Request timeout in ms (default: 30000) */
  requestTimeout?: number
}

export interface A2ATaskExecutor {
  /** Execute a task and return the result */
  executeTask(params: {
    taskId: TaskId
    messages: A2AMessage[]
    instructions?: string
  }): Promise<{
    status: TaskStatus
    messages: A2AMessage[]
    artifacts: Artifact[]
    statusDescription?: string
  }>
}

export interface A2AServerStatus {
  running: boolean
  port: number
  host: string
  agentName: string
  capabilities: number
  activeTasks: number
  totalTasks: number
  uptimeMs: number
}

// ── Server ────────────────────────────────────────────────

export class A2AServer {
  private server: http.Server | null = null
  private config: Required<A2AServerConfig>
  private activeTasks = new Map<string, Task>()
  private totalTasks = 0
  private startTime = 0
  private card: AgentCard

  constructor(config: A2AServerConfig) {
    this.config = {
      port: config.port ?? 0,
      host: config.host ?? "127.0.0.1",
      agentCard: config.agentCard,
      taskExecutor: config.taskExecutor ?? this.defaultExecutor(),
      requestTimeout: config.requestTimeout ?? 30000,
    }
    this.card = { ...config.agentCard, protocolVersion: A2A_PROTOCOL_VERSION }
  }

  /** Start the HTTP server */
  async start(): Promise<void> {
    if (this.server) return

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res))
      this.server.on("error", reject)
      this.server.listen(this.config.port, this.config.host, () => {
        this.startTime = Date.now()
        resolve()
      })
    })
  }

  /** Stop the server */
  async stop(): Promise<void> {
    if (!this.server) return
    return new Promise((resolve) => {
      this.server!.close(() => {
        this.server = null
        this.activeTasks.clear()
        resolve()
      })
    })
  }

  /** Get the actual port (useful when port=0) */
  get port(): number {
    const addr = this.server?.address()
    if (addr && typeof addr === "object") return addr.port
    return this.config.port
  }

  /** Get server status */
  getStatus(): A2AServerStatus {
    return {
      running: this.server !== null,
      port: this.port,
      host: this.config.host,
      agentName: this.card.name,
      capabilities: this.card.capabilities.length,
      activeTasks: this.activeTasks.size,
      totalTasks: this.totalTasks,
      uptimeMs: this.startTime > 0 ? Date.now() - this.startTime : 0,
    }
  }

  /** Get the Agent Card */
  getCard(): AgentCard {
    return { ...this.card }
  }

  /** Update the Agent Card at runtime (e.g., when skills change) */
  updateCard(card: AgentCard): void {
    this.card = { ...card, protocolVersion: A2A_PROTOCOL_VERSION }
  }

  /** Get all active tasks (for monitoring) */
  getActiveTasks(): Task[] {
    return [...this.activeTasks.values()]
  }

  // ── Request Handler ────────────────────────────────────

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

    // GET /a2a/card — simple card discovery
    if (req.method === "GET" && url.pathname === "/a2a/card") {
      res.writeHead(200, { "Content-Type": A2A_CONTENT_TYPE })
      res.end(JSON.stringify(this.card))
      return
    }

    // POST /a2a — JSON-RPC handler
    if (req.method === "POST" && (url.pathname === "/a2a" || url.pathname === "/a2a/")) {
      this.handleJsonRpc(req, res)
      return
    }

    // POST /a2a/stream — SSE streaming
    if (req.method === "POST" && url.pathname === "/a2a/stream") {
      this.handleStream(req, res)
      return
    }

    // Health check
    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": A2A_CONTENT_TYPE })
      res.end(JSON.stringify({ status: "ok", agent: this.card.name }))
      return
    }

    res.writeHead(404)
    res.end(JSON.stringify(createJsonRpcError(-32001, "Not found")))
  }

  // ── JSON-RPC Handler ──────────────────────────────────

  private handleJsonRpc(req: IncomingMessage, res: ServerResponse): void {
    let body = ""
    req.setEncoding("utf-8")

    const timeout = setTimeout(() => {
      res.writeHead(408)
      res.end(JSON.stringify(createJsonRpcError(-32002, "Request timeout")))
    }, this.config.requestTimeout)

    req.on("data", (chunk: string) => { body += chunk })
    req.on("end", async () => {
      clearTimeout(timeout)

      let rpcReq: JsonRpcRequest
      try {
        rpcReq = JSON.parse(body)
        if (rpcReq.jsonrpc !== "2.0" || !rpcReq.method) throw new Error("Invalid JSON-RPC")
      } catch {
        res.writeHead(400, { "Content-Type": A2A_CONTENT_TYPE })
        res.end(JSON.stringify(createJsonRpcError(-32700, "Parse error", { body })))
        return
      }

      try {
        const response = await this.executeMethod(rpcReq)
        res.writeHead(200, { "Content-Type": A2A_CONTENT_TYPE })
        res.end(JSON.stringify(response))
      } catch (err) {
        res.writeHead(500, { "Content-Type": A2A_CONTENT_TYPE })
        res.end(JSON.stringify(createJsonRpcError(-32603, `Internal error: ${err}`)))
      }
    })
  }

  // ── SSE Stream Handler ────────────────────────────────

  private handleStream(req: IncomingMessage, res: ServerResponse): void {
    let body = ""
    req.setEncoding("utf-8")

    req.on("data", (chunk: string) => { body += chunk })
    req.on("end", async () => {
      let rpcReq: JsonRpcRequest
      try {
        rpcReq = JSON.parse(body)
        if (rpcReq.method !== "tasks/sendSubscribe") {
          res.writeHead(400, { "Content-Type": A2A_CONTENT_TYPE })
          res.end(JSON.stringify(createJsonRpcError(-32601, "Only tasks/sendSubscribe supported on stream endpoint")))
          return
        }
      } catch {
        res.writeHead(400)
        res.end(JSON.stringify(createJsonRpcError(-32700, "Parse error")))
        return
      }

      // SSE headers
      res.writeHead(200, {
        "Content-Type": A2A_SSE_CONTENT_TYPE,
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      })

      const params = rpcReq.params as any
      if (!params?.id || !params?.input) {
        res.write(`data: ${JSON.stringify(createJsonRpcError(-32602, "Invalid params", { id: rpcReq.id }))}\n\n`)
        res.end()
        return
      }

      const taskId = params.id as TaskId
      this.totalTasks++

      // Send submitted
      res.write(`data: ${JSON.stringify(createJsonRpcResult(rpcReq.id, {
        id: taskId,
        status: "submitted",
        messages: [],
        artifacts: [],
      }))}\n\n`)

      // Execute
      try {
        const result = await this.config.taskExecutor.executeTask({
          taskId,
          messages: params.input?.messages ?? [],
          instructions: params.input?.instructions,
        })

        // Send working
        res.write(`data: ${JSON.stringify(createJsonRpcResult(rpcReq.id, {
          id: taskId,
          status: "working",
          messages: result.messages ?? [],
          artifacts: result.artifacts ?? [],
        }))}\n\n`)

        // Send completion
        res.write(`data: ${JSON.stringify(createJsonRpcResult(rpcReq.id, {
          id: taskId,
          status: result.status,
          messages: result.messages ?? [],
          artifacts: result.artifacts ?? [],
          statusDescription: result.statusDescription,
        }))}\n\n`)
      } catch (err) {
        res.write(`data: ${JSON.stringify(createJsonRpcResult(rpcReq.id, {
          id: taskId,
          status: "failed",
          messages: [createTextMessage("agent", `Execution error: ${err}`)],
          artifacts: [],
          statusDescription: `Error: ${err}`,
        }))}\n\n`)
      }

      res.end()
    })
  }

  // ── Method Executor ──────────────────────────────────

  private async executeMethod(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    const id = req.id

    switch (req.method) {
      case A2A_METHODS.GET_CARD: {
        const params = req.params as any
        let capabilities = this.card.capabilities
        if (params?.capabilityFilter?.length) {
          const filter = new Set(params.capabilityFilter as string[])
          capabilities = capabilities.filter(c => filter.has(c.id))
        }
        return createJsonRpcResult(id, {
          ...this.card,
          capabilities,
        })
      }

      case A2A_METHODS.TASK_SEND: {
        const params = req.params as any
        if (!params?.id || !params?.input) {
          return createJsonRpcError(-32602, "Invalid params: id and input required")
        }

        const taskId = params.id as TaskId
        this.totalTasks++

        const task: Task = {
          id: taskId,
          status: "working",
          messages: params.input?.messages ?? [],
          artifacts: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        this.activeTasks.set(taskId.id, task)

        try {
          const result = await this.config.taskExecutor.executeTask({
            taskId,
            messages: params.input?.messages ?? [],
            instructions: params.input?.instructions,
          })

          task.status = result.status
          task.messages = result.messages
          task.artifacts = result.artifacts
          task.statusDescription = result.statusDescription
          task.updatedAt = new Date().toISOString()

          if (result.status === "completed" || result.status === "failed" || result.status === "canceled") {
            this.activeTasks.delete(taskId.id)
          }

          return createJsonRpcResult(id, task)
        } catch (err) {
          task.status = "failed"
          task.messages.push(createTextMessage("agent", `Execution error: ${err}`))
          task.updatedAt = new Date().toISOString()
          this.activeTasks.delete(taskId.id)
          return createJsonRpcResult(id, task)
        }
      }

      case A2A_METHODS.TASK_GET: {
        const params = req.params as any
        if (!params?.id?.id) {
          return createJsonRpcError(-32602, "Invalid params: id required")
        }
        const task = this.activeTasks.get(params.id.id)
        if (!task) {
          return createJsonRpcError(-32003, `Task ${params.id.id} not found`)
        }
        return createJsonRpcResult(id, task)
      }

      case A2A_METHODS.TASK_CANCEL: {
        const params = req.params as any
        if (!params?.id?.id) {
          return createJsonRpcError(-32602, "Invalid params: id required")
        }
        const task = this.activeTasks.get(params.id.id)
        if (!task) {
          return createJsonRpcError(-32003, `Task ${params.id.id} not found`)
        }
        task.status = "canceled"
        task.updatedAt = new Date().toISOString()
        this.activeTasks.delete(params.id.id)
        return createJsonRpcResult(id, task)
      }

      default:
        return createJsonRpcError(-32601, `Method not found: ${req.method}`)
    }
  }

  // ── Default Executor ────────────────────────────────

  private defaultExecutor(): A2ATaskExecutor {
    return {
      executeTask: async (params) => {
        // Simple echo executor for testing
        const responseMsg = createTextMessage("agent",
          `Received task ${params.taskId.id}. Instructions: ${params.instructions ?? "none"}`)
        return {
          status: "completed",
          messages: [...params.messages, responseMsg],
          artifacts: [],
          statusDescription: "Task completed by default executor",
        }
      },
    }
  }
}
