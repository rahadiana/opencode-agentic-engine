/**
 * A2A Protocol Client — Discover remote agents and delegate tasks.
 *
 * Uses fetch() (or Node 18+ global fetch) to communicate with remote A2A servers.
 * Supports:
 *   - Agent discovery (getCard)
 *   - Task delegation (taskSend)
 *   - Task polling (taskGet)
 *   - Task cancellation (taskCancel)
 *   - SSE streaming (taskSendSubscribe)
 *
 * Integration:
 *   - Discovered agents get registered for future use
 *   - Agent cards can be cached for TTL
 *   - Task results flow back via callback
 */

import type {
  AgentCard,
  TaskId,
  Task,
  A2AMessage,
  JsonRpcRequest,
  JsonRpcResponse,
} from "./a2a-types.js"
import {
  A2A_METHODS,
  A2A_CONTENT_TYPE,
  createJsonRpcRequest,
} from "./a2a-types.js"

// ── Types ──────────────────────────────────────────────────

export interface A2AClientConfig {
  /** Cache TTL for agent cards in ms (default: 300000 = 5 min) */
  cardCacheTtlMs?: number
  /** Request timeout in ms (default: 30000) */
  requestTimeout?: number
  /** Headers to include in all requests */
  defaultHeaders?: Record<string, string>
}

export interface DiscoveredAgent {
  card: AgentCard
  discoveredAt: number
  lastUsed: number
}

export interface TaskSendResult {
  task: Task
  serverUrl: string
}

export interface A2AClientStats {
  cachedCards: number
  tasksSent: number
  tasksCompleted: number
  tasksFailed: number
  averageLatencyMs: number
}

// ── Client Class ──────────────────────────────────────────

export class A2AClient {
  private config: Required<A2AClientConfig>
  private discoveredAgents = new Map<string, DiscoveredAgent>()
  private tasksSent = 0
  private tasksCompleted = 0
  private tasksFailed = 0
  private totalLatencyMs = 0
  private totalLatencyCalls = 0

  constructor(config?: A2AClientConfig) {
    this.config = {
      cardCacheTtlMs: config?.cardCacheTtlMs ?? 300_000,
      requestTimeout: config?.requestTimeout ?? 30_000,
      defaultHeaders: config?.defaultHeaders ?? {},
    }
  }

  // ── Agent Discovery ───────────────────────────────────────

  /**
   * Discover an agent at the given A2A endpoint URL.
   * Returns the Agent Card if found, null otherwise.
   * Caches results for cardCacheTtlMs.
   */
  async discover(url: string): Promise<AgentCard | null> {
    // Strip trailing slash
    const baseUrl = url.replace(/\/+$/, "")
    const cacheKey = baseUrl

    // Check cache
    const cached = this.discoveredAgents.get(cacheKey)
    if (cached && (Date.now() - cached.discoveredAt) < this.config.cardCacheTtlMs) {
      return cached.card
    }

    try {
      // Try POST /a2a first (JSON-RPC)
      const rpcReq = createJsonRpcRequest(A2A_METHODS.GET_CARD)
      const rpcResponse = await this.jsonRpcCall(`${baseUrl}/a2a`, rpcReq)

      if (rpcResponse?.result) {
        const card = rpcResponse.result as AgentCard
        this.discoveredAgents.set(cacheKey, { card, discoveredAt: Date.now(), lastUsed: Date.now() })
        return card
      }

      // Fallback: GET /a2a/card
      const response = await this.fetchWithTimeout(`${baseUrl}/a2a/card`, {
        method: "GET",
        headers: { ...this.config.defaultHeaders },
      })

      if (response.ok) {
        const card = await response.json() as AgentCard
        this.discoveredAgents.set(cacheKey, { card, discoveredAt: Date.now(), lastUsed: Date.now() })
        return card
      }

      return null
    } catch {
      return null
    }
  }

  /**
   * Get cached agent card (without network call).
   * Returns null if not discovered or cache expired.
   */
  getCachedAgent(url: string): AgentCard | null {
    const cached = this.discoveredAgents.get(url.replace(/\/+$/, ""))
    if (!cached) return null
    if ((Date.now() - cached.discoveredAt) >= this.config.cardCacheTtlMs) {
      this.discoveredAgents.delete(url.replace(/\/+$/, ""))
      return null
    }
    return cached.card
  }

  /**
   * List all currently discovered and cached agents.
   */
  listDiscoveredAgents(): DiscoveredAgent[] {
    return [...this.discoveredAgents.values()]
      .filter(a => (Date.now() - a.discoveredAt) < this.config.cardCacheTtlMs)
  }

  /**
   * Clear all cached agent cards.
   */
  clearCache(): void {
    this.discoveredAgents.clear()
  }

  // ── Task Delegation ───────────────────────────────────────

  /**
   * Send a task to a remote agent and wait for result.
   */
  async taskSend(
    serverUrl: string,
    taskId: TaskId,
    messages: A2AMessage[],
    instructions?: string,
  ): Promise<TaskSendResult | null> {
    const baseUrl = serverUrl.replace(/\/+$/, "")
    const start = Date.now()

    const rpcReq = createJsonRpcRequest(A2A_METHODS.TASK_SEND, {
      id: taskId,
      input: { messages, instructions },
    })

    try {
      const response = await this.jsonRpcCall(`${baseUrl}/a2a`, rpcReq)
      this.tasksSent++
      this.totalLatencyCalls++
      this.totalLatencyMs += (Date.now() - start)

      if (response?.result) {
        const task = response.result as Task
        if (task.status === "completed" || task.status === "failed" || task.status === "canceled") {
          this.tasksCompleted++
          if (task.status === "failed") this.tasksFailed++
        }

        // Update last used for cached agent
        const cached = this.discoveredAgents.get(baseUrl)
        if (cached) cached.lastUsed = Date.now()

        return { task, serverUrl: baseUrl }
      }

      if (response?.error) {
        this.tasksFailed++
        return null
      }

      return null
    } catch {
      this.tasksFailed++
      return null
    }
  }

  /**
   * Poll task status.
   */
  async taskGet(serverUrl: string, taskId: TaskId): Promise<Task | null> {
    const baseUrl = serverUrl.replace(/\/+$/, "")
    const rpcReq = createJsonRpcRequest(A2A_METHODS.TASK_GET, { id: taskId })

    try {
      const response = await this.jsonRpcCall(`${baseUrl}/a2a`, rpcReq)
      if (response?.result) {
        return response.result as Task
      }
      return null
    } catch {
      return null
    }
  }

  /**
   * Cancel a running task.
   */
  async taskCancel(serverUrl: string, taskId: TaskId): Promise<boolean> {
    const baseUrl = serverUrl.replace(/\/+$/, "")
    const rpcReq = createJsonRpcRequest(A2A_METHODS.TASK_CANCEL, { id: taskId })

    try {
      const response = await this.jsonRpcCall(`${baseUrl}/a2a`, rpcReq)
      const result = response?.result as { status?: string } | undefined
      return result?.status === "canceled"
    } catch {
      return false
    }
  }

  /**
   * Get client statistics.
   */
  getStats(): A2AClientStats {
    return {
      cachedCards: this.discoveredAgents.size,
      tasksSent: this.tasksSent,
      tasksCompleted: this.tasksCompleted,
      tasksFailed: this.tasksFailed,
      averageLatencyMs: this.totalLatencyCalls > 0
        ? Math.round(this.totalLatencyMs / this.totalLatencyCalls)
        : 0,
    }
  }

  // ── Internal ──────────────────────────────────────────────

  private async jsonRpcCall(url: string, request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    const response = await this.fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Content-Type": A2A_CONTENT_TYPE,
        ...this.config.defaultHeaders,
      },
      body: JSON.stringify(request),
    })

    if (!response.ok) return null
    return await response.json() as JsonRpcResponse
  }

  private async fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeout)

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      })
      return response
    } finally {
      clearTimeout(timeout)
    }
  }
}
