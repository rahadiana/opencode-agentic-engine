import { LLMEngine } from "../core/llm.js"
import type { ModelRegistry } from "../core/model-registry.js"
import type { AgentRole } from "./coordinator.js"
import { RoleRegistry } from "./role-registry.js"

export interface AgentContext {
  systemPrompt: string
  sessionId: string
  role: AgentRole | string
  taskDescription: string
  pipelineContext?: string
  pendingMessages?: Array<{ from: string; payload: string }>
  sharedMemory?: Array<{ key: string; value: string; writtenBy: string }>
  /** Per-role model preference (e.g. "deepseek-chat", "openai/gpt-4o").
   *  Applied to the engine before executing the LLM call. */
  modelPreference?: string
  /** Reasoning effort untuk model yg support (OpenAI o-series, GPT-5).
   *  Dikirim ke SDK → provider. Diabaikan kalo model gak support. */
  reasoningEffort?: 'low' | 'medium' | 'high'
  /** Explicit timeout in milliseconds. Overrides the dynamic timeout calculation.
   *  Default: min 30s, scaled by prompt size, max 600s (10 min). */
  timeoutMs?: number
}

export interface AgentResult {
  output: string
  success: boolean
  error?: string
  modelUsed?: string
}

/**
 * Manages isolated LLM runtimes per role + session.
 * Each role gets its own LLMEngine instance with a dedicated session ID,
 * so architect, developer, and QA operate in separate context windows.
 * Engines are LRU-evicted when exceeding maxEngines (10).
 */
export class AgentRuntime {
  private engines = new Map<string, LLMEngine>()
  private engineOrder: string[] = []
  private readonly maxEngines = 10
  private opencodeClient: unknown = null
  private modelRegistry?: ModelRegistry
  private roleRegistry: RoleRegistry
  /** ONE shared temp session ID for ALL sub-engine LLM calls.
   *  SDK only allows ~2-3 prompts per child session before hanging.
   *  Session is rotated (create new, delete old) after every 2 calls. */
  private _sharedSessionId: string | null = null
  private _sharedSessionCount: number = 0
  /** Track visible delegation sessions so we can clean up on dispose. */
  private _visibleSessions: Array<{ sessionId: string; role: string; description: string; createdAt: number }> = []

  constructor() {
    this.roleRegistry = new RoleRegistry()
  }

  /** Create a child session (retry once on failure). */
  private async _tryCreateChildSession(parentSessionId: string): Promise<string | null> {
    if (!this.opencodeClient) return null
    const client = this.opencodeClient as {
      session: {
        create: (opts: { body: { title?: string; parentID?: string } }) => Promise<{ data?: { id: string }; id?: string }>
        delete: (opts: { path: { id: string } }) => Promise<unknown>
      }
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const resp = await client.session.create({
          body: { title: `agentic-shared-${Date.now()}`, parentID: parentSessionId },
        })
        const id = resp.data?.id ?? (resp as Record<string, unknown>).id as string ?? null
        if (id) return id
      } catch {
        // transient failure — retry once
      }
      if (attempt === 0) await new Promise(r => setTimeout(r, 200))
    }
    return null
  }

  /** Get or rotate shared temp session. ONLY rotates if new session creation succeeds.
   *  If rotation fails, keeps the old session — never leaves us without a session. */
  private async _getOrCreateSharedSession(parentSessionId: string): Promise<string | null> {
    if (this._sharedSessionId) {
      if (this._sharedSessionCount >= 2) {
        // Try to create new session first, swap only if it works
        const newSession = await this._tryCreateChildSession(parentSessionId)
        if (newSession) {
          // New session created — safely delete old one
          if (this.opencodeClient) {
            try {
              (this.opencodeClient as { session: { delete: (opts: { path: { id: string } }) => Promise<unknown> } })
                .session.delete({ path: { id: this._sharedSessionId } }).catch(() => {})
            } catch {}
          }
          this._sharedSessionId = newSession
          this._sharedSessionCount = 0
        }
        // If creation failed, keep old session (don't rotate)
      }
      return this._sharedSessionId
    }

    // No existing session — create one
    this._sharedSessionId = await this._tryCreateChildSession(parentSessionId)
    this._sharedSessionCount = 0
    return this._sharedSessionId
  }

  /** Rotate: delete old session async, null out so next call creates new one. */
  private _rotateSharedSession(): void {
    if (this._sharedSessionId && this.opencodeClient) {
      try {
        const client = this.opencodeClient as { session: { delete: (opts: { path: { id: string } }) => Promise<unknown> } }
        client.session.delete({ path: { id: this._sharedSessionId } }).catch(() => {})
      } catch (e) { console.warn("catch: ignore", { error: String(e) }) }
    }
    this._sharedSessionId = null
    this._sharedSessionCount = 0
  }

  /** Increment prompt count on the shared session. Called after each successful LLM call. */
  private _incrementSharedSessionCount(): void {
    this._sharedSessionCount++
  }

  dispose(): void {
    const engines = [...this.engines.entries()]
    this.engines.clear()
    this.engineOrder = []
    // Delete shared temp session
    if (this._sharedSessionId && this.opencodeClient) {
      try {
        const client = this.opencodeClient as { session: { delete: (opts: { path: { id: string } }) => Promise<unknown> } }
        client.session.delete({ path: { id: this._sharedSessionId } }).catch(() => {})
      } catch (e) { console.warn("catch: ignore", { error: String(e) }) }
    }
    // Clean up visible delegation sessions
    for (const vs of this._visibleSessions) {
      if (this.opencodeClient) {
        try {
          const client = this.opencodeClient as { session: { delete: (opts: { path: { id: string } }) => Promise<unknown> } }
          client.session.delete({ path: { id: vs.sessionId } }).catch(() => {})
        } catch (e) { console.warn("catch: ignore", { error: String(e) }) }
      }
    }
    this._visibleSessions = []
    Promise.all(engines.map(([, e]) => e.disposeTempSession().catch(() => {})))
  }

  [Symbol.dispose](): void {
    this.dispose()
  }

  setOpencodeClient(client: unknown): void {
    if (client && typeof client === 'object') {
      this.opencodeClient = client
    }
  }

  setModelRegistry(registry: ModelRegistry): void {
    this.modelRegistry = registry
  }

  getRoleRegistry(): RoleRegistry {
    return this.roleRegistry
  }

  /**
   * Get or create an isolated LLM engine for a specific role + session.
   * Each engine has its own sessionId = `${parentSessionId}-${role}`.
   * LRU eviction: if > maxEngines, removes the oldest accessed engine.
   */
  private getEngine(parentSessionId: string, role: string): LLMEngine {
    const key = `${parentSessionId}::${role}`
    if (!this.engines.has(key)) {
      if (this.engines.size >= this.maxEngines) {
        const oldestKey = this.engineOrder.shift()
        if (oldestKey) {
          const oldEngine = this.engines.get(oldestKey)
          if (oldEngine) oldEngine.disposeTempSession().catch(() => {})
          this.engines.delete(oldestKey)
        }
      }
      const engine = new LLMEngine()
      engine.setOpencodeClient(this.opencodeClient)
      // Non-chat mode: use _promptWithTimeout directly on shared session
      engine.setChatMode(false)
      if (this.modelRegistry) engine.setModelRegistry(this.modelRegistry)
      this.engines.set(key, engine)
    }
    // Sync session ID EVERY time (not just on creation) — session may have
    // been rotated since the engine was first created. Using stale session
    // ID causes [NO_LLM] on the cached engine after rotation.
    const engine = this.engines.get(key)!
    if (this._sharedSessionId) {
      engine.setSessionId(this._sharedSessionId)
    } else if (parentSessionId) {
      // Fallback: use parent session directly (guaranteed to have LLM provider)
      engine.setSessionId(parentSessionId)
    }
    // Move to most-recently-used position
    const idx = this.engineOrder.indexOf(key)
    if (idx >= 0) this.engineOrder.splice(idx, 1)
    this.engineOrder.push(key)
    return engine
  }

  /**
   * Execute delegation with a VISIBLE child session.
   * Instead of using a shared temp session (invisible to user), this method:
   * 1. Creates a dedicated child session with a descriptive title (e.g. "👤 Developer: Implement login")
   * 2. Uses parentID so it appears as a sub-session in the OpenCode UI
   * 3. Keeps the session alive during delegation — user sees progress in sidebar
   * 4. Cleans up on AgentRuntime.dispose()
   */
  async executeWithVisibleDelegation(ctx: AgentContext): Promise<AgentResult> {
    if (!this.opencodeClient) {
      // Fallback: no SDK client, use regular execute
      return this.execute(ctx)
    }

    const client = this.opencodeClient as {
      session: {
        create: (opts: { body: { title?: string; parentID?: string } }) => Promise<{ data?: { id: string }; id?: string }>
        delete: (opts: { path: { id: string } }) => Promise<unknown>
      }
    }

    // 1. Create child session with descriptive title
    const taskLabel = ctx.taskDescription.length > 60
      ? ctx.taskDescription.slice(0, 57) + "..."
      : ctx.taskDescription
    const title = `👤 ${ctx.role}: ${taskLabel}`
    let childSessionId: string | null = null

    try {
      const resp = await client.session.create({
        body: { title, parentID: ctx.sessionId },
      })
      childSessionId = resp.data?.id ?? (resp as Record<string, unknown>).id as string ?? null
      if (!childSessionId) {
        return this.execute(ctx) // fallback
      }

      // Also use as shared session for subsequent execute() calls
      this._sharedSessionId = childSessionId
      this._sharedSessionCount = 0

      // Track for cleanup
      this._visibleSessions.push({
        sessionId: childSessionId,
        role: ctx.role,
        description: ctx.taskDescription,
        createdAt: Date.now(),
      })
    } catch (e) {
      console.warn("[AgentRuntime] Failed to create visible delegation session, falling back:", String(e))
      return this.execute(ctx)
    }

    // 2. Execute via dedicated child session — agent has tool access
    const roleDef = this.roleRegistry.getBuiltIn(ctx.role as AgentRole)
      ?? this.roleRegistry.getCustom(ctx.role)

    const promptParts: string[] = []
    if (ctx.systemPrompt) {
      promptParts.push(ctx.systemPrompt)
    } else if (roleDef?.prompt) {
      promptParts.push(roleDef.prompt)
    } else {
      promptParts.push(`You are a ${ctx.role} in a software engineering team.`)
    }
    promptParts.push(`\n\n## Task\n${ctx.taskDescription}`)
    if (ctx.pipelineContext) promptParts.push(`\n\n## Pipeline Context\n${ctx.pipelineContext}`)
    if (ctx.pendingMessages?.length) {
      promptParts.push(`\n\n## Pending Messages\n${ctx.pendingMessages.map(m => `From ${m.from}: ${m.payload}`).join("\n")}`)
    }
    if (ctx.sharedMemory?.length) {
      promptParts.push(`\n\n## Shared Memory\n${ctx.sharedMemory.map(m => `[${m.key}] (by ${m.writtenBy}): ${m.value.slice(0, 200)}`).join("\n")}`)
    }
    promptParts.push(`\n\n## Available Tools\nYou have access to all agentic tools (agentic_plan, agentic_execute, agentic_verify, agentic_auto, etc.) plus edit/write/read/bash. Use agentic_auto for multi-step tasks — it will plan, implement, and verify automatically. Each tool call you make will be visible as progress in this session.`)

    let modelOverride: { providerID: string; modelID: string } | undefined
    if (ctx.modelPreference) {
      const parts = ctx.modelPreference.split("/")
      modelOverride = parts.length >= 2
        ? { providerID: parts[0], modelID: parts.slice(1).join("/") }
        : { providerID: "opencode", modelID: ctx.modelPreference }
    }

    try {
      // Use a dedicated engine with the child session
      const engine = new LLMEngine()
      engine.setOpencodeClient(this.opencodeClient)
      engine.setChatMode(false) // use session.prompt() directly on child session
      engine.setSessionId(childSessionId)
      if (this.modelRegistry) engine.setModelRegistry(this.modelRegistry)

      const fullPrompt = promptParts.join("\n")
      const approxTokens = Math.ceil(fullPrompt.length / 4)
      const noiseFloor = ctx.timeoutMs ?? 30_000
      const dynamicTimeout = Math.min(Math.max(approxTokens * 300, noiseFloor), 300_000)
      const timeoutMs = Math.round(dynamicTimeout)

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

      const resp = await engine.call({
        systemPrompt: fullPrompt,
        userPrompt: `Complete the task above. Use agentic_auto for multi-step work — it plans, implements, and verifies automatically. Each tool call shows real-time progress in this session.`,
        temperature: 0.3,
        maxTokens: 4096,
        model: modelOverride,
        signal: controller.signal,
        timeoutMs,
        ...(ctx.reasoningEffort ? { reasoningEffort: ctx.reasoningEffort } : {}),
      })
      clearTimeout(timeoutId)
      const output = resp.content
      if (output.startsWith("LLM error") || output.startsWith("[NO_LLM]")) {
        console.warn(`[AgentRuntime] Child session LLM failed (${output.slice(0, 50)}), falling back to execute().`, { childSessionId: childSessionId?.slice(0, 12) })
        return this.execute(ctx)
      }

      // 3. Fetch session messages to show what the delegated agent actually did
      let conversationLog = ""
      try {
        const sdk = this.opencodeClient as Record<string, any>
        if (typeof sdk?.session?.messages === "function") {
          const messagesResp = await sdk.session.messages({
            path: { id: childSessionId },
            query: { limit: 50 },
          })
          // Response shape: { data: { 200: [...] } } or { data: [...] } or array directly
          let rawMessages: Array<Record<string, any>> = []
          if (Array.isArray(messagesResp?.data?.[200])) rawMessages = messagesResp.data[200]
          else if (Array.isArray(messagesResp?.data)) rawMessages = messagesResp.data
          else if (Array.isArray(messagesResp)) rawMessages = messagesResp

          if (rawMessages.length > 0) {
            const steps: string[] = []
            for (const msg of rawMessages) {
              const parts = msg.parts ?? []
              for (const part of parts) {
                if (part.type === "tool-call" || part.type === "tool_use") {
                  const name = part.name ?? part.tool_name ?? "unknown"
                  const args = part.arguments ?? part.input ?? {}
                  const argStr = typeof args === "object" ? Object.keys(args).slice(0, 3).map(k => `${k}=${String(args[k]).slice(0, 60)}`).join(", ") : String(args).slice(0, 80)
                  steps.push(`🔧 ${name}(${argStr})`)
                } else if (part.type === "text" && part.text?.length > 10) {
                  const prev = steps[steps.length - 1] ?? ""
                  if (!prev.startsWith("💬")) steps.push(`💬 ${part.text.slice(0, 120).replace(/\n/g, " ")}`)
                }
              }
            }
            if (steps.length > 0) {
              conversationLog = "\n\n### 📋 Delegation Log\n" + steps.join("\n")
            }
          }
        }
      } catch (_e) {
        // Session messages not available — non-critical
      }

      return { output: output + conversationLog, success: true, modelUsed: modelOverride ? `${modelOverride.providerID}/${modelOverride.modelID}` : "opencode/default" }
    } catch (e) {
      const err = e as Error
      const msg = err.message
      if (msg.includes('timeout') || msg.includes('timed out')) {
        return { output: '', success: false, error: `LLM timeout after ${Math.round((parseInt(msg.match(/\d+/)?.[0] || '0') || 0) / 1000)}s: ${msg}` }
      }
      if (msg.includes('rate limit') || msg.includes('rate_limit') || msg.includes('rateLimit')) {
        return { output: '', success: false, error: `Rate limit exceeded: ${msg}` }
      }
      if (msg.includes('abort') || msg.includes('AbortError') || msg.includes('cancelled')) {
        return { output: '', success: false, error: `LLM call cancelled: ${msg}` }
      }
      return { output: "", success: false, error: msg }
    }
    // NOTE: childSessionId is intentionally NOT deleted — user sees it in UI
    // as a completed sub-session. Cleanup happens on dispose().
  }

  /**
   * Execute a task with a dedicated LLM call using the role's system prompt.
   * The engine is isolated per (session, role) pair.
   */
  async execute(ctx: AgentContext): Promise<AgentResult> {
    // Ensure shared temp session exists, safely rotate if needed
    await this._getOrCreateSharedSession(ctx.sessionId)
    const engine = this.getEngine(ctx.sessionId, ctx.role)

    const roleDef = this.roleRegistry.getBuiltIn(ctx.role as AgentRole)
      ?? this.roleRegistry.getCustom(ctx.role)

    // Build the system prompt from the role definition + context
    const promptParts: string[] = []
    if (ctx.systemPrompt) {
      // Explicit systemPrompt overrides role prompt (used by DebateLoop sub-agents)
      promptParts.push(ctx.systemPrompt)
    } else if (roleDef?.prompt) {
      promptParts.push(roleDef.prompt)
    } else {
      promptParts.push(`You are a ${ctx.role} in a software engineering team.`)
    }
    promptParts.push(`\n\nCurrent task: ${ctx.taskDescription}`)

    if (ctx.pipelineContext) {
      promptParts.push(`\n\n## Pipeline Context\n${ctx.pipelineContext}`)
    }
    if (ctx.pendingMessages && ctx.pendingMessages.length > 0) {
      promptParts.push(`\n\n## Pending Messages\n${ctx.pendingMessages.map(m => `From ${m.from}: ${m.payload}`).join("\n")}`)
    }
    if (ctx.sharedMemory && ctx.sharedMemory.length > 0) {
      promptParts.push(`\n\n## Shared Memory\n${ctx.sharedMemory.map(m => `[${m.key}] (by ${m.writtenBy}): ${m.value.slice(0, 200)}`).join("\n")}`)
    }

    // Parse model preference string → { providerID, modelID } untuk dikirim ke SDK
    let modelOverride: { providerID: string; modelID: string } | undefined
    if (ctx.modelPreference) {
      const parts = ctx.modelPreference.split("/")
      modelOverride = parts.length >= 2
        ? { providerID: parts[0], modelID: parts.slice(1).join("/") }
        : { providerID: "opencode", modelID: ctx.modelPreference }
    }

    try {
      const fullPrompt = promptParts.join("\n")
      // Dynamic timeout: estimate ~4 chars per token, noise floor 15s, max 300s
      // Per arXiv:2606.05608 §5.2: timeout should scale with task complexity,
      // not be a fixed constant. Small tasks (~25 tokens) → ~15s (noise floor).
      // Medium (~250 tokens) → ~75s. Large (~2500 tokens) → capped at 300s.
      const approxTokens = Math.ceil(fullPrompt.length / 4)
      const noiseFloor = ctx.timeoutMs ?? 15_000
      const dynamicTimeout = Math.min(Math.max(approxTokens * 300, noiseFloor), 300_000)
      const timeoutMs = Math.round(dynamicTimeout)

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

      const resp = await engine.call({
        systemPrompt: fullPrompt,
        userPrompt: `Complete the task described in the system prompt.`, // ringkas, gak duplikasi
        temperature: 0.3,
        maxTokens: 4096,
        model: modelOverride, // ← dikirim ke SDK langsung, bukan via config
        signal: controller.signal, // ← forward AbortSignal ke bawah
        timeoutMs, // ← pass dynamic timeout so llm.ts inner timeout scales with prompt size too
        ...(ctx.reasoningEffort ? { reasoningEffort: ctx.reasoningEffort } : {}),
      })
      clearTimeout(timeoutId)
      const output = resp.content
      if (output.startsWith("LLM error") || output.startsWith("[NO_LLM]")) {
        return { output, success: false, error: output }
      }
      // Increment shared session counter after successful LLM call
      this._incrementSharedSessionCount()
      return { output, success: true, modelUsed: modelOverride ? `${modelOverride.providerID}/${modelOverride.modelID}` : "opencode/default" }
    } catch (e) {
      const err = e as Error
      const msg = err.message
      if (msg.includes('timeout') || msg.includes('timed out')) {
        return { output: '', success: false, error: `LLM timeout after ${Math.round((parseInt(msg.match(/\d+/)?.[0] || '0') || 0) / 1000)}s: ${msg}` }
      }
      if (msg.includes('rate limit') || msg.includes('rate_limit') || msg.includes('rateLimit')) {
        return { output: '', success: false, error: `Rate limit exceeded: ${msg}` }
      }
      if (msg.includes('abort') || msg.includes('AbortError') || msg.includes('cancelled')) {
        return { output: '', success: false, error: `LLM call cancelled: ${msg}` }
      }
      return { output: "", success: false, error: msg }
    }
  }
}
