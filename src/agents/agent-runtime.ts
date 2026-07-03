import { LLMEngine } from "../core/llm.js"
import type { LLMResponse } from "../core/llm-types.js"
import type { ModelRegistry } from "../core/model-registry.js"
import type { AgentRole } from "./coordinator.js"
import { RoleRegistry } from "./role-registry.js"
import { TimeoutError } from "../core/errors.js"

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
  constructor() {
    this.roleRegistry = new RoleRegistry()
  }

  dispose(): void {
    const engines = [...this.engines.entries()]
    this.engines.clear()
    this.engineOrder = []
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
      // Use the REAL parent session ID for ALL LLM calls.
      // Sub-engines share the parent session — sequential calls only,
      // no concurrent prompt risk since delegate waits for completion.
      // The synthetic `${parentSessionId}-${role}` is NOT used because
      // it's not a valid OpenCode session.
      engine.setSessionId(parentSessionId)
      // No chat mode — use non-chat _promptWithTimeout directly on parent
      engine.setChatMode(false)
      if (this.modelRegistry) engine.setModelRegistry(this.modelRegistry)
      this.engines.set(key, engine)
    }
    // Move to most-recently-used position
    const idx = this.engineOrder.indexOf(key)
    if (idx >= 0) this.engineOrder.splice(idx, 1)
    this.engineOrder.push(key)
    return this.engines.get(key)!
  }

  /**
   * Execute a task with a dedicated LLM call using the role's system prompt.
   * The engine is isolated per (session, role) pair.
   */
  async execute(ctx: AgentContext): Promise<AgentResult> {
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
      // Dynamic timeout: estimate ~4 chars per token, min 30s, max 600s (10 menit)
      const approxTokens = Math.ceil(fullPrompt.length / 4)
      const minTimeout = ctx.timeoutMs ?? 120_000
      const dynamicTimeout = Math.min(Math.max(approxTokens * 0.3, minTimeout), 600_000)
      const timeoutMs = Math.round(dynamicTimeout)

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

      const resp = await Promise.race([
        engine.call({
          systemPrompt: fullPrompt,
          userPrompt: `Complete the task described in the system prompt.`, // ringkas, gak duplikasi
          temperature: 0.3,
          maxTokens: 4096,
          model: modelOverride, // ← dikirim ke SDK langsung, bukan via config
          signal: controller.signal, // ← forward AbortSignal ke bawah
          timeoutMs, // ← pass dynamic timeout so llm.ts inner timeout scales with prompt size too
          ...(ctx.reasoningEffort ? { reasoningEffort: ctx.reasoningEffort } : {}),
        }),
        new Promise<LLMResponse>((_, reject) => {
          controller.signal.addEventListener("abort", () => {
            reject(new TimeoutError("LLM call", timeoutMs))
          })
        }),
      ])
      clearTimeout(timeoutId)
      const output = resp.content
      if (output.startsWith("LLM error") || output.startsWith("[NO_LLM]")) {
        return { output, success: false, error: output }
      }
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
