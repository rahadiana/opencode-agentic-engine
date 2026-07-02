import type { LLMConfig, LLMRequest, LLMResponse, CostSwitchEvent } from './llm-types.js'
import { TOOL_COMPLEXITY } from './llm-types.js'
import type { ModelRegistry } from "./model-registry.js"
import type { BudgetTracker } from "./budget-tracker.js"
import { SessionReader } from "./session-reader.js"
import { SemanticCache } from "./semantic-cache.js"
import type { MemoryOrchestrator } from "../memory/memory-orchestrator.js"
import { createLogger } from "../observability/logger.js"

const log = createLogger("LLM")

// Error logging helper for silent catch blocks
function logParseError(context: string, error: unknown): void {
  if (process.env.DEBUG_LLM_PARSING) {
    log.error(`[LLM Parse Error] ${context}`, { error });
  }
}

export class LLMEngine {
  private config: LLMConfig
  private opencodeClient: unknown = null
  private pluginSessionId: string | null = null
  private modelRegistry?: ModelRegistry
  private sessionStore?: import("../memory/session-store.js").SessionStore
  private memoryStores?: {
    searchEpisodes: (query: string) => Array<{ planGoal: string; outcome: string; timestamp: string }>
    findSkills: (query: string) => Array<{ name: string; successRate: number }>
  }
  private budgetTracker?: BudgetTracker
  private sessionReader: SessionReader
  private eventBus?: import("./event-bus.js").EventBus
  private responseCache = new Map<string, { response: LLMResponse; timestamp: number }>()
  private readonly CACHE_TTL = 30_000 // 30s cache for identical requests
  private readonly CACHE_MAX_ENTRIES = 1000 // prevent unbounded memory growth
  private semanticCache?: SemanticCache // Gap #7: semantic similarity-based cache
  /** Flag: true if running in chat mode (set via experimental.chat.system.transform hook).
   *  In chat mode, session.prompt({ noReply: false }) would hang waiting for user input.
   *  When set, callOpenCode() returns fallback immediately instead of calling session.prompt(). */
  private _chatMode: boolean = false
  /** Per-call tool context for auto model resolution (tool→category→default) */
  private _toolContext?: string
  /** Last successfully resolved model, set after every successful LLM call.
   *  Allows getCurrentModel() to return the actual model instead of undefined.
   *  Format: "providerID/modelID" (e.g. "opencode/deepseek-v4-flash-free") */
  private _lastKnownModel?: string
  /** Memory orchestrator for knowledge-first injection */
  private memoryOrchestrator?: MemoryOrchestrator
  /** Cached temp session ID for chat mode — reuse instead of create+delete per call. */
  private _tempSessionId: string | null = null
  /** Backup of original pluginSessionId when chat mode overrides it. */
  private _backupSessionId: string | null = null

  /** Cost auto-switch tracking */
  private costSwitchStats = { totalSwitches: 0, totalSavingsUsd: 0, switches: [] as CostSwitchEvent[] }
  /** Cost auto-switch observer callback */
  private _onCostSwitch?: (event: CostSwitchEvent) => void

  constructor(config: Partial<LLMConfig> = {}) {
    this.config = {
      maxTokens: config.maxTokens ?? 4096,
      temperature: config.temperature ?? 0.3,
      fallbackModels: config.fallbackModels ?? [],
      maxFallbackAttempts: config.maxFallbackAttempts ?? 3,
      costAutoSwitch: config.costAutoSwitch ?? {
        enabled: true,
        minReliability: 0.5,
        minUserSatisfaction: 0.3,
        maxCostPerCall: 0.01,
        budgetTightMultiplier: 0.5,
        categories: ["quick", "unspecified-low"],
      },
    }
    this.sessionReader = new SessionReader()
  }

  setSessionReader(reader: SessionReader): void {
    this.sessionReader = reader
  }

  setMemoryOrchestrator(orchestrator: MemoryOrchestrator): void {
    this.memoryOrchestrator = orchestrator
  }

  setMemoryStores(stores: {
    searchEpisodes: (query: string) => Array<{ planGoal: string; outcome: string; timestamp: string }>
    findSkills: (query: string) => Array<{ name: string; successRate: number }>
  }): void {
    this.memoryStores = stores
  }

  getMemoryContext(query: string): string {
    return this.buildMemoryContext(query)
  }

  private buildMemoryContext(query: string): string {
    if (!this.memoryStores) return ""
    const parts: string[] = []
    try {
      const episodes = this.memoryStores.searchEpisodes(query).slice(0, 3)
      if (episodes.length > 0) {
        parts.push("Relevant past sessions:")
        parts.push(episodes.map(e => `- ${e.outcome === "success" ? "✅" : e.outcome === "partial" ? "⚠️" : "❌"} ${e.planGoal} (${e.timestamp.slice(0, 10)})`).join("\n"))
      }
      const skills = this.memoryStores.findSkills(query).slice(0, 3)
      if (skills.length > 0) {
        parts.push("Relevant known skills:")
        parts.push(skills.map(s => `- ${s.name} (${(s.successRate * 100).toFixed(0)}% success rate)`).join("\n"))
      }
    } catch (error) {
      logParseError('buildMemoryContext', error);
    }
    return parts.length > 0 ? `\n\n## Memory Context\n${parts.join("\n\n")}` : ""
  }

  setOpencodeClient(client: unknown): void {
    this.opencodeClient = client
    this.sessionReader.setOpencodeClient(client)
  }

  setSessionId(sessionId: string): void {
    this.pluginSessionId = sessionId
    this.sessionReader.setSessionId(sessionId)
  }

  setModelRegistry(registry: ModelRegistry): void {
    this.modelRegistry = registry
  }

  setBudgetTracker(tracker: BudgetTracker): void {
    this.budgetTracker = tracker
    this.sessionReader.setBudgetTracker(tracker)
  }

  setEventBus(bus: import("./event-bus.js").EventBus): void {
    this.eventBus = bus
  }

  /** Set callback for cost switch events (for dashboard/logging). */
  setOnCostSwitch(callback: (event: CostSwitchEvent) => void): void {
    this._onCostSwitch = callback
  }

  /** Get cost switch statistics for dashboard. */
  getCostSwitchStats(): { totalSwitches: number; totalSavingsUsd: number; recentSwitches: CostSwitchEvent[] } {
    return {
      totalSwitches: this.costSwitchStats.totalSwitches,
      totalSavingsUsd: this.costSwitchStats.totalSavingsUsd,
      recentSwitches: [...this.costSwitchStats.switches].reverse().slice(0, 20),
    }
  }

  setSessionStore(store: import("../memory/session-store.js").SessionStore): void {
    this.sessionStore = store
  }

  updateConfig(config: Partial<LLMConfig>): void {
    Object.assign(this.config, config)
  }

  /**
   * Configure fallback models for multi-provider auto fallback.
   * These models are tried in order when the primary model fails.
   *
   * @param models - Ordered list of "providerID/modelID" strings
   * @param maxAttempts - Maximum total attempts (including primary). Default: 3.
   */
  setFallbackModels(models: string[], maxAttempts?: number): void {
    this.config.fallbackModels = [...models]
    if (maxAttempts !== undefined) {
      this.config.maxFallbackAttempts = maxAttempts
    }
  }

  /**
   * Get current fallback configuration.
   */
  getFallbackConfig(): { models: string[]; maxAttempts: number } {
    return {
      models: [...(this.config.fallbackModels ?? [])],
      maxAttempts: this.config.maxFallbackAttempts ?? 3,
    }
  }

  /**
   * Preview the fallback chain that would be used for a given primary model.
   * Useful for debugging and testing.
   *
   * @param primaryModel - The model that would be tried first (e.g., "deepseek/deepseek-chat")
   * @param taskType - Optional task type for registry scoring
   * @returns Ordered list of fallback models that would be tried
   */
  previewFallbackChain(primaryModel: string, taskType?: string): string[] {
    return this.resolveFallbackChain(primaryModel, taskType)
  }

  /**
   * Nama model untuk display fallback.
   * Mengembalikan model terakhir yang berhasil di-resolve dari OpenCode SDK.
   * Di-update setiap kali call() sukses (dari auto-resolve atau explicit model).
   *
   * Kalau belum pernah ada LLM call yang sukses, return undefined —
   * caller harus handle fallback ke "unknown" sendiri.
   *
   * Untuk model real-time dari session (bukan cache), pake getOpenCodeModel() async.
   */
  getCurrentModel(): string | undefined {
    return this._lastKnownModel
  }

  /**
   * Set current model dari external source (misalnya dari _input.model di chat hook).
   * Biar getCurrentModel() bisa return model yg bener meski belum ada LLM call.
   */
  setCurrentModel(modelStr: string): void {
    if (modelStr && modelStr !== "opencode/default" && modelStr !== "unknown" && modelStr !== "opencode/unknown") {
      this._lastKnownModel = modelStr
    }
  }

  /** Enable Gap #7 semantic cache with optional config */
  enableSemanticCache(config?: import("./semantic-cache.js").SemanticCacheConfig): void {
    if (!this.semanticCache) {
      this.semanticCache = new SemanticCache(config)
    } else if (config) {
      this.semanticCache.updateConfig(config)
    }
  }

  /** Disable semantic cache and clear all entries */
  disableSemanticCache(): void {
    if (this.semanticCache) {
      this.semanticCache.clear()
      this.semanticCache = undefined
    }
  }

  /** Get semantic cache stats (or null if disabled) */
  getSemanticCacheStats(): { size: number; hits: number; misses: number; hitRate: number } | null {
    return this.semanticCache?.stats() ?? null
  }

  /**
   * Build ordered fallback chain for multi-provider auto fallback.
   * Returns models to try in order (excluding the primary model).
   *
   * Priority:
   * 1. Config-level fallbackModels (user-configured via LLMConfig)
   * 2. Registry-ranked models (healthy > degraded > unstable)
   * 3. Empty chain (caller falls back to session default)
   *
   * @param primaryModel - The model that already failed (excluded from chain)
   * @param taskType - Optional task type for registry scoring
   * @returns Ordered list of "providerID/modelID" strings to try
   */
  private resolveFallbackChain(primaryModel: string | null, taskType?: string): string[] {
    const chain: string[] = []
    const seen = new Set<string>()

    // Exclude primary model from candidates
    if (primaryModel) seen.add(primaryModel)

    // 1. Config-level fallback models (user-configured priority)
    const configFallbacks = this.config.fallbackModels ?? []
    for (const model of configFallbacks) {
      if (!seen.has(model)) {
        chain.push(model)
        seen.add(model)
      }
    }

    // 2. Registry-ranked models (if registry available)
    if (this.modelRegistry) {
      const allScores = this.modelRegistry.getAllScores()
      for (const score of allScores) {
        if (!seen.has(score.model) && score.status !== "unstable") {
          chain.push(score.model)
          seen.add(score.model)
        }
      }

      // Also consider task-type-specific scores
      if (taskType) {
        for (const score of allScores) {
          if (!seen.has(score.model)) {
            const taskScore = this.modelRegistry.getScoreByTaskType(score.model, taskType)
            if (taskScore && taskScore.status !== "unstable") {
              chain.push(score.model)
              seen.add(score.model)
            }
          }
        }
      }
    }

    // Respect maxFallbackAttempts (minus 1 for the primary attempt)
    const maxChainLength = (this.config.maxFallbackAttempts ?? 3) - 1
    return chain.slice(0, maxChainLength)
  }

  /** Set chat mode flag. Called from experimental.chat.system.transform hook.
   *  In chat mode: swaps pluginSessionId to a unique synthetic ID so
   *  session.prompt() avoids the parent session's agent loop.
   *  This mirrors agentRuntime sub-engines which use synthetic session IDs
   *  like "${parentSessionId}-${role}" and always work in chat mode.
   */
  setChatMode(chat: boolean): void {
    this._chatMode = chat
    if (chat && this.pluginSessionId && !this._chatSessionId) {
      this._backupSessionId = this.pluginSessionId
      // Use a session ID that doesn't share the parent session's prefix,
      // so the SDK treats it as an independent session without agent loop.
      this._chatSessionId = `agentic-chat-${this._chatNonce}`
      this.pluginSessionId = this._chatSessionId
    } else if (!chat && this._backupSessionId) {
      this.pluginSessionId = this._backupSessionId
      this._backupSessionId = null
    }
  }

  /** Unique synthetic session ID for chat mode (avoids parent agent loop). */
  private _chatSessionId: string | null = null
  private _chatNonce = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

  /** Check if running in chat mode. */
  isChatMode(): boolean {
    return this._chatMode
  }

  /**
   * Set tool context for auto model resolution.
   * When set, subsequent call() will resolve model via:
   *   tool preference → category preference → engine default
   */
  setToolContext(toolName?: string): void {
    this._toolContext = toolName
  }

  /** Get current tool context, if any. */
  getToolContext(): string | undefined {
    return this._toolContext
  }

  /**
   * Mendapatkan model ASLI dari OpenCode session.
   * Lebih akurat karena ini model beneran yang dipakai sama OpenCode.
   * Fallback: this.getCurrentModel() kalau gagal baca dari session.
   */
  async getOpenCodeModel(): Promise<string> {
    try {
      const model = await this.sessionReader.getCurrentModel()
      if (model) return model
    } catch {
      // silent fallback
    }
    return this.getCurrentModel() ?? "unknown"
  }

  /**
   * List semua model yang tersedia di OpenCode.
   * Returns array [{ id, providerID, providerName }] atau [] kalau gagal.
   */
  async listOpenCodeModels(): Promise<Array<{ id: string; providerID: string; providerName: string }>> {
    try {
      return await this.sessionReader.listModels()
    } catch {
      return []
    }
  }

  private getCacheKey(req: LLMRequest): string {
    const hashContent = `${req.systemPrompt}${req.userPrompt}${req.jsonMode}${req.bypassCache}`
    let hash = 0
    for (let i = 0; i < hashContent.length; i++) {
      const chr = hashContent.charCodeAt(i)
      hash = ((hash << 5) - hash) + chr
      hash |= 0
    }
    return `opencode:${hash}`
  }

  async call(req: LLMRequest): Promise<LLMResponse> {
    const startTime = Date.now()
    let success = false
    let response: LLMResponse

    // Early abort: if external signal already fired, return immediately
    if (req.signal?.aborted) {
      return { content: "[NO_LLM] LLM call cancelled before start", finishReason: "error" }
    }

    // Resolve model: per-call > tool-context > category > engine default
    const effectiveToolName = req.toolName ?? this._toolContext
    if (!req.model && effectiveToolName) {
      // Priority 1: per-tool override
      if (this.sessionStore && this.pluginSessionId) {
        const toolModel = this.sessionStore.getToolPreference(this.pluginSessionId, effectiveToolName)
        if (toolModel) {
          req.model = this.parseModelForSDK(toolModel)
        }
        // Priority 2: category by complexity tier
        if (!req.model) {
          const category = TOOL_COMPLEXITY[effectiveToolName]
          if (category) {
            const catModel = this.sessionStore.getCategoryPreference(this.pluginSessionId, category)
            if (catModel) {
              req.model = this.parseModelForSDK(catModel)
            }
          }
        }
      }
    }
    // Priority 3: NO fallback — kalo gak ada override, SDK pake session default

    // ── Cost- & Satisfaction-Aware Auto-Switch (Gap #8 + Feedback Loop) ──
    // Auto-switch to best model balancing: cost + reliability + user satisfaction.
    // Supports all tool categories (default: quick + unspecified-low).
    // Budget-aware: tightens threshold when budget > 80% utilized.
    // User satisfaction from feedback loop: models with low satisfaction are deprioritized.
    if (req.model && effectiveToolName && this.modelRegistry) {
      const category = TOOL_COMPLEXITY[effectiveToolName]
      const costCfg = this.config.costAutoSwitch ?? { enabled: true, minReliability: 0.5, minUserSatisfaction: 0.3, maxCostPerCall: 0.01, budgetTightMultiplier: 0.5, categories: ["quick", "unspecified-low"] }
      const eligibleCategories = costCfg.categories ?? ["quick", "unspecified-low"]
      const isEligible = !category || eligibleCategories.includes(category)

      if (isEligible && costCfg.enabled) {
        const currentModelStr = `${req.model.providerID}/${req.model.modelID}`
        const currentScore = this.modelRegistry.getScore(currentModelStr)
        const currentReliability = currentScore?.reliability ?? 0.5
        const taskType = this.sessionStore && this.pluginSessionId
          ? this.sessionStore.getOrCreate(this.pluginSessionId).currentTaskType
          : undefined

        // Budget-aware threshold: tighten when budget is tight
        let budgetMultiplier = 1.0
        if (this.budgetTracker) {
          try {
            const states = this.budgetTracker.getState(["session"])
            if (states.length > 0) {
              const s = states[0]
              if (s.limits?.maxCostUsd != null && s.limits.maxCostUsd > 0) {
                const utilization = (s.usage?.totalCostUsd ?? 0) / s.limits.maxCostUsd
                if (utilization > 0.8) {
                  budgetMultiplier = costCfg.budgetTightMultiplier
                }
              }
            }
          } catch {
            // budget tracker getState failed — proceed with default multiplier
          }
        }

        // Use absolute threshold (with budget adjustment), fall back to relative threshold
        const minRequiredReliability = Math.min(
          Math.max(costCfg.minReliability * budgetMultiplier, 0.2), // absolute, clamped 0.2-0.95
          Math.max(currentReliability * 0.7 * budgetMultiplier, 0.2),
        )

        // Check if current model exceeds max cost → force switch
        const forceSwitch = currentScore?.avgCostPerCall != null && currentScore.avgCostPerCall > costCfg.maxCostPerCall

        // Gather available models from fallback chain + current
        const availableModels = [currentModelStr, ...(this.config.fallbackModels ?? [])]
        const candidates = availableModels
          .map(m => ({
            model: m,
            score: this.modelRegistry!.getScore(m),
            userSat: taskType ? this.modelRegistry!.getUserSatisfaction(m, taskType) : 0.5,
          }))
          .filter(s => s.score && s.score.totalCalls >= 3) // only models with sufficient data

        // Score candidates by composite: userSat (30%) + reliability (35%) + inverse cost (35%)
        // This ensures user feedback influences model selection alongside technical metrics.
        const maxCost = candidates.reduce((max, c) => Math.max(max, c.score?.avgCostPerCall ?? 0), 0.001)
        const scored = candidates
          .map(c => ({
            model: c.model,
            score: c.score!,
            userSat: c.userSat,
            compositeScore: c.userSat * 0.3 + (c.score?.reliability ?? 0.5) * 0.35 + (1 - (c.score?.avgCostPerCall ?? 0) / maxCost) * 0.35,
          }))
          .sort((a, b) => b.compositeScore - a.compositeScore)

        // Pick best composite score that meets reliability + satisfaction thresholds
        const originalModel = { ...req.model }
        for (const candidate of scored) {
          const candidateReliability = candidate.score?.reliability ?? 0
          const meetsReliability = candidateReliability >= minRequiredReliability
          const meetsSatisfaction = candidate.userSat >= costCfg.minUserSatisfaction
          const isDifferent = candidate.model !== currentModelStr

          if (isDifferent && (meetsReliability && meetsSatisfaction) || forceSwitch) {
            const parsed = this.parseModelForSDK(candidate.model)
            if (parsed) {
              req.model = parsed
              break
            }
          }
        }

        // Record switch event if model changed
        const switchedModel = req.model
        if (switchedModel && (switchedModel.providerID !== originalModel.providerID || switchedModel.modelID !== originalModel.modelID)) {
          const newScore = this.modelRegistry.getScore(`${switchedModel.providerID}/${switchedModel.modelID}`)
          const estimatedSavings = (currentScore?.avgCostPerCall ?? 0) - (newScore?.avgCostPerCall ?? 0)
          const switchedModelSat = taskType ? this.modelRegistry.getUserSatisfaction(`${switchedModel.providerID}/${switchedModel.modelID}`, taskType) : 0.5
          const reasons: string[] = []
          if (forceSwitch) reasons.push(`cost exceeded $${costCfg.maxCostPerCall}`)
          if (switchedModelSat > (taskType ? this.modelRegistry.getUserSatisfaction(currentModelStr, taskType) : 0.5)) reasons.push(`higher user satisfaction (${(switchedModelSat * 100).toFixed(0)}%)`)
          reasons.push(`composite score: ${scored.find(s => s.model === `${switchedModel.providerID}/${switchedModel.modelID}`)?.compositeScore.toFixed(2) ?? 'N/A'}`)
          const event: CostSwitchEvent = {
            fromModel: currentModelStr,
            toModel: `${switchedModel.providerID}/${switchedModel.modelID}`,
            reason: reasons.join(', '),
            category: category ?? "unknown",
            estimatedSavingsUsd: Math.max(0, estimatedSavings),
            timestamp: Date.now(),
          }
          this.costSwitchStats.totalSwitches++
          this.costSwitchStats.totalSavingsUsd += event.estimatedSavingsUsd
          this.costSwitchStats.switches.push(event)
          // Trim history to prevent unbounded growth
          if (this.costSwitchStats.switches.length > 200) {
            this.costSwitchStats.switches.splice(0, this.costSwitchStats.switches.length - 200)
          }
          this._onCostSwitch?.(event)
        }
      }
    }

    // ── Knowledge-first injection (tool mode) ──
    // Chat mode already handled by system.transform hook.
    // In tool mode, inject RAG knowledge into system prompt before LLM call.
    if (!this._chatMode && !req.bypassCache && this.memoryOrchestrator) {
      try {
        const queryText = (req.userPrompt ?? "").slice(0, 500)
        if (queryText) {
          const memResult = await this.memoryOrchestrator.queryWithKnowledge(queryText, undefined, 5)
          if (memResult.knowledge && memResult.knowledge.length > 0 && !req.systemPrompt.includes("<knowledge-context>")) {
            const ctx = memResult.knowledge
              .map(k => `  <source url="${k.source}" confidence="${k.confidence.toFixed(2)}">${k.content}</source>`)
              .join("\n")
            req.systemPrompt += `\n\n<knowledge-context>\n${ctx}\n</knowledge-context>`
          }
        }
      } catch {
        // Non-fatal — proceed without knowledge
      }
    }

    // ── Second Brain injection (tool mode) ──
    // Inject decisions, TODOs, and last reflection alongside RAG knowledge.
    if (!this._chatMode && !req.bypassCache && !req.systemPrompt.includes("<second-brain>")) {
      try {
        const { getSecondBrain } = await import("../memory/second-brain.js")
        const sb = getSecondBrain()
        if (sb) {
          const ctx = sb.formatKnowledgeSnapshot(3, 5)
          if (ctx) req.systemPrompt += `\n${ctx}`
        }
      } catch {
        // Non-fatal
      }
    }

    // Simpan model override sebelum call — dipake buat fallback tracking
    const explicitModel = req.model ? { ...req.model } : undefined

    // ── Gap #7: Semantic cache lookup ──
    if (!req.bypassCache && this.semanticCache) {
      const query = `${req.systemPrompt}${req.userPrompt}`
      const semanticHit = this.semanticCache.get(query)
      if (semanticHit) {
        return {
          content: semanticHit.text,
          usage: semanticHit.usage ? {
            promptTokens: semanticHit.usage.inputTokens ?? 0,
            completionTokens: semanticHit.usage.outputTokens ?? 0,
            reasoningTokens: semanticHit.usage.reasoningTokens ?? 0,
            cacheReadTokens: semanticHit.usage.cacheReadTokens ?? 0,
            cacheWriteTokens: semanticHit.usage.cacheWriteTokens ?? 0,
          } : undefined,
          finishReason: "cache-hit",
        }
      }
    }

    // Check exact-match cache (TTL: 30s)
    const cacheKey = this.getCacheKey(req)
    if (!req.bypassCache) {
      const cached = this.responseCache.get(cacheKey)
      if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
        return cached.response
      }
    }

    // ── ONLY call via OpenCode SDK — NO external API calls ──
    try {
      response = await this.callOpenCode(req)
      success = !response.content.startsWith("LLM error") && !response.content.startsWith("[NO_LLM]") && !response.content.startsWith("LLM call failed")
    } catch (error) {
      logParseError('LLM call', error);
      response = { content: "LLM call threw an exception", finishReason: "error" }
      success = false
    }

    // ── Multi-provider auto fallback ──
    // Priority: explicit model → fallback chain (registry-ranked) → session default
    if (!success) {
      const primaryModel = explicitModel ? `${explicitModel.providerID}/${explicitModel.modelID}` : null
      const taskType = this.sessionStore && this.pluginSessionId
        ? this.sessionStore.getOrCreate(this.pluginSessionId).currentTaskType
        : undefined

      // Record primary model failure
      if (primaryModel) {
        this.modelRegistry?.recordCall(primaryModel, false, Date.now() - startTime, taskType)
      }

      // Build fallback chain from registry + config
      const fallbackChain = this.resolveFallbackChain(primaryModel, taskType)

      // Try each fallback model in order
      for (const fallbackModel of fallbackChain) {
        if (success || req.signal?.aborted) break

        const [providerID, ...modelParts] = fallbackModel.split('/')
        const modelID = modelParts.join('/')
        if (!modelID) continue // Skip malformed entries

        req.model = { providerID, modelID }
        try {
          response = await this.callOpenCode(req)
          success = !response.content.startsWith("LLM error") && !response.content.startsWith("[NO_LLM]") && !response.content.startsWith("LLM call failed")
        } catch (fallbackError) {
          logParseError(`LLM fallback call (${fallbackModel})`, fallbackError);
          response = { content: "LLM call threw an exception", finishReason: "error" }
          success = false
        }

        // Record fallback attempt
        this.modelRegistry?.recordCall(fallbackModel, success, Date.now() - startTime, taskType)
      }

      // Final fallback: session default (no model override)
      if (!success && !req.signal?.aborted) {
        delete req.model
        try {
          response = await this.callOpenCode(req)
          success = !response.content.startsWith("LLM error") && !response.content.startsWith("[NO_LLM]") && !response.content.startsWith("LLM call failed")
        } catch (sessionFallbackError) {
          logParseError('LLM session default fallback', sessionFallbackError);
          response = { content: "LLM call threw an exception", finishReason: "error" }
          success = false
        }
      }
    }

    // Cache successful responses
    if (success) {
      this.responseCache.set(cacheKey, { response, timestamp: Date.now() })
      // Gap #7: Also cache in semantic cache
      if (this.semanticCache) {
        const query = `${req.systemPrompt}${req.userPrompt}`
        this.semanticCache.set(query, {
          text: response.content,
          usage: response.usage ? {
            inputTokens: response.usage.promptTokens,
            outputTokens: response.usage.completionTokens,
            reasoningTokens: response.usage.reasoningTokens,
            cacheReadTokens: response.usage.cacheReadTokens,
            cacheWriteTokens: response.usage.cacheWriteTokens,
          } : undefined,
        })
      }
      // Evict oldest entries if cache exceeds limit
      if (this.responseCache.size > this.CACHE_MAX_ENTRIES) {
        const oldest = [...this.responseCache.entries()]
          .sort(([, a], [, b]) => a.timestamp - b.timestamp)
          .slice(0, Math.floor(this.CACHE_MAX_ENTRIES * 0.2))
        for (const [k] of oldest) this.responseCache.delete(k)
      }
    }

    const latency = Date.now() - startTime

    // ── Resolve model untuk tracking ──
    // Priority 1: explicit model dari req.model (set by caller / tool override / category)
    // Priority 2: auto-resolve — ambil model ASLI dari OpenCode SDK setelah LLM call
    let effectiveModel: string | undefined
    if (req.model) {
      effectiveModel = `${req.model.providerID}/${req.model.modelID}`
    } else if (success && this.sessionReader) {
      // Auto-resolve: coba ambil model beneran dari SDK (invalidate cache dulu biar fresh)
      try {
        this.sessionReader.invalidateCache()
        const sdkModel = await this.getOpenCodeModel()
        if (sdkModel && sdkModel !== "unknown" && sdkModel !== "opencode/unknown") {
          effectiveModel = sdkModel
        }
      } catch {
        // silent — leave undefined, skip tracking (same as before)
      }
    }

    // Cache model untuk getCurrentModel() — baik sukses maupun gagal
    if (effectiveModel) {
      this._lastKnownModel = effectiveModel
    }

    // ── Extract token usage ──
    const tInput = response.usage?.promptTokens ?? 0
    const tOutput = response.usage?.completionTokens ?? 0
    const tReasoning = response.usage?.reasoningTokens ?? 0
    const tCacheRead = response.usage?.cacheReadTokens ?? 0
    const tCacheWrite = response.usage?.cacheWriteTokens ?? 0

    // ── Calculate cost using per-model prices ──
    const modelForCost = effectiveModel ?? "unknown"
    const price = this.budgetTracker?.lookupPrice(modelForCost) ?? { input: 2.5, output: 10, cacheRead: 0.3, cacheWrite: 2.5 }
    const cost = (
      (tInput / 1000) * price.input +
      ((tOutput + tReasoning) / 1000) * price.output +
      (tCacheRead / 1000) * price.cacheRead +
      (tCacheWrite / 1000) * price.cacheWrite
    )

    // ── Record successful call to registry ──
    // Note: failures are already recorded in the fallback loop above.
    // We only record the final success here to avoid double-counting.
    const taskType = this.sessionStore && this.pluginSessionId
      ? this.sessionStore.getOrCreate(this.pluginSessionId).currentTaskType
      : undefined
    if (success && effectiveModel) {
      this.modelRegistry?.recordCall(effectiveModel, true, latency, taskType, cost)
    }

    // Feed token usage to BudgetTracker
    if (success && this.budgetTracker) {
      this.budgetTracker.recordTokens(effectiveModel ?? "unknown", tInput, tOutput, tReasoning, tCacheRead, tCacheWrite)
    }

    // Sync session data from OpenCode after successful call
    if (success && this.pluginSessionId) {
      this.sessionReader.syncToBudgetTracker().catch(() => {})
    }

    // Emit llm.response event
    if (this.eventBus) {
      this.eventBus.emit({
        type: "llm.response" as const,
        payload: {
          sessionID: this.pluginSessionId ?? "",
          model: effectiveModel ?? "unknown",
          tokens: { input: tInput, output: tOutput, reasoning: tReasoning, cacheRead: tCacheRead, cacheWrite: tCacheWrite },
          costUsd: cost,
          success,
          durationMs: latency,
          sourceStepId: req.sourceStepId,
          sourceTaskId: req.sourceTaskId,
          sourcePipelineRunId: req.sourcePipelineRunId,
        },
      })
    }

    return response
  }

  async decomposeTask(goal: string, context: string): Promise<string[]> {
    try {
      const resp = await this.call({
        systemPrompt: "You are a software task decomposer. Break down the given goal into sequential subtasks. Each subtask should be a single, concrete action. Return as JSON array of strings." + this.buildMemoryContext(goal),
        userPrompt: `Goal: ${goal}\n\nContext:\n${context}\n\nBreak this down into 3-7 sequential subtasks. Return JSON array of strings.`,
        jsonMode: false,
        temperature: 0.2,
      })

      const cleaned = resp.content.trim()
      try {
        const parsed = JSON.parse(cleaned)
        if (Array.isArray(parsed)) return parsed
        if (parsed.subtasks && Array.isArray(parsed.subtasks)) return parsed.subtasks
        if (parsed.steps && Array.isArray(parsed.steps)) return parsed.steps
      } catch (error) {
        logParseError('decomposeTask JSON parse', error);
      }

      const codeBlock = cleaned.match(/```(?:json)?\s*\n?(\[[\s\S]*?\])\s*\n?```/)
      if (codeBlock) {
        try { const arr = JSON.parse(codeBlock[1]); if (Array.isArray(arr)) return arr } catch (error) { logParseError('decomposeTask codeBlock', error); }
      }

      const arrMatch = cleaned.match(/\[[\s\S]*?\]/)
      if (arrMatch) {
        try { const arr = JSON.parse(arrMatch[0]); if (Array.isArray(arr)) return arr } catch (error) { logParseError('decomposeTask arrMatch', error); }
      }
    } catch (error) {
      logParseError('decomposeTask', error);
    }

    return []
  }

  async summarizeContext(planGoal: string, turns: string[]): Promise<string> {
    const resp = await this.call({
      systemPrompt: "You are a context compressor. Summarize the following conversation into a compact form that preserves: key decisions made, files changed, invariants that must be preserved, and remaining tasks. Be concise." + this.buildMemoryContext(planGoal),
      userPrompt: `Goal: ${planGoal}\n\nConversation:\n${turns.join("\n")}\n\nProvide a compact summary.`,
      maxTokens: 1024,
      temperature: 0.1,
    })
    return resp.content
  }

  async analyzeError(errorText: string, modifiedFiles: string[]): Promise<{
    category: string
    rootCause: string
    fix: string
  }> {
    try {
      const resp = await this.call({
        systemPrompt: "You are an error analyst. Given an error message and list of recently modified files, determine: the error category (compile/type/test/import/runtime), the likely root cause, and a specific fix suggestion. Return as JSON with keys: category, rootCause, fix." + this.buildMemoryContext(errorText),
        userPrompt: `Error:\n${errorText}\n\nRecently modified files:\n${modifiedFiles.join("\n")}\n\nAnalyze and return JSON.`,
        jsonMode: false,
        temperature: 0.2,
      })

      const cleaned = resp.content.trim()
      try {
        const parsed = JSON.parse(cleaned)
        if (parsed.category || parsed.rootCause) return parsed
      } catch (error) {
        logParseError('analyzeError JSON parse', error);
      }

      const codeBlock = cleaned.match(/```(?:json)?\s*\n?(\{[\s\S]*?\})\s*\n?```/)
      if (codeBlock) {
        try {
          const parsed = JSON.parse(codeBlock[1])
          if (parsed.category) return parsed
        } catch (error) {
          logParseError('analyzeError codeBlock', error);
        }
      }

      const jsonMatch = cleaned.match(/\{[\s\S]*?"category"[\s\S]*?"rootCause"[\s\S]*?"fix"[\s\S]*?\}/)
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0])
          if (parsed.category) return parsed
        } catch (error) {
          logParseError('analyzeError jsonMatch', error);
        }
      }
    } catch (error) {
      logParseError('analyzeError', error);
    }

    return { category: "unknown", rootCause: "Unable to analyze", fix: "Manual investigation needed" }
  }

  private extractJSON<T>(content: string, requiredKey?: string): T | null {
    const cleaned = content.trim()
    try {
      const parsed = JSON.parse(cleaned)
      if (!requiredKey || (parsed && typeof parsed === "object" && requiredKey in parsed)) return parsed as T
    } catch (error) {
      logParseError('extractJSON direct parse', error);
    }
    const codeBlock = cleaned.match(/```(?:json)?\s*\n?(\{[\s\S]*?\})\s*\n?```/)
    if (codeBlock) {
      try {
        const parsed = JSON.parse(codeBlock[1])
        if (!requiredKey || (parsed && typeof parsed === "object" && requiredKey in parsed)) return parsed as T
      } catch (error) {
        logParseError('extractJSON codeBlock', error);
      }
    }
    if (requiredKey) {
      const loose = cleaned.match(new RegExp(`\\{[\\s\\S]*?"${requiredKey}"[\\s\\S]*?\\}`))
      if (loose) {
        try {
          const parsed = JSON.parse(loose[0])
          if (requiredKey in parsed) return parsed as T
        } catch (error) {
          logParseError('extractJSON loose match', error);
        }
      }
      const arrMatch = cleaned.match(/\[[\s\S]*?\]/)
      if (requiredKey === "steps" && arrMatch) {
        try {
          const arr = JSON.parse(arrMatch[0])
          if (Array.isArray(arr)) return { steps: arr, complexity: "medium" } as unknown as T
        } catch (error) {
          logParseError('extractJSON arrMatch', error);
        }
      }
    }
    return null
  }

  async generatePlan(goal: string, _constraints: string[], codebaseSummary: string): Promise<{
    steps: Array<{ id: string; description: string; dependsOn: string[] }>
    complexity: string
  }> {
    try {
      const resp = await this.call({
        systemPrompt: `You are a software planning assistant. Generate a plan as JSON with "steps" (array of {id, description, dependsOn}) and "complexity" ("low"/"medium"/"high"). Steps IDs like "step-1", "step-2". Keep descriptions concise (max 80 chars). Max 8 steps.` + this.buildMemoryContext(goal),
        userPrompt: `Goal: ${goal}\nCodebase: ${codebaseSummary.slice(0, 2000)}\n\nGenerate plan JSON.`,
        jsonMode: false,
        temperature: 0.3,
        maxTokens: 1000,
      })
      const parsed = this.extractJSON<{ steps: Array<{ id: string; description: string; dependsOn: string[] }>; complexity: string }>(resp.content, "steps")
      if (parsed && Array.isArray(parsed.steps) && parsed.steps.length > 0) return parsed
    } catch (error) {
      logParseError('generatePlan', error);
    }
    return { steps: [], complexity: "low" }
  }

  async reviewCode(goal: string, files: Record<string, string>): Promise<string[]> {
    const filesStr = Object.entries(files).map(([path, content]) => `### ${path}\n\`\`\`\n${content.slice(0, 2000)}\n\`\`\``).join("\n\n")
    const resp = await this.call({
      systemPrompt: "You are a code reviewer. Review the given files for potential issues: type safety, edge cases, error handling, performance, security, and maintainability. Return a JSON array of issue descriptions (strings). If no issues found, return empty array." + this.buildMemoryContext(goal),
      userPrompt: `Goal: ${goal}\n\nFiles:\n${filesStr}\n\nList issues found as JSON array.`,
      jsonMode: true,
      temperature: 0.2,
    })
    try {
      return JSON.parse(resp.content)
    } catch (error) {
      logParseError('reviewCode JSON parse', error);
      return []
    }
  }

  async suggestRole(description: string): Promise<string | null> {
    try {
      const resp = await this.call({
        systemPrompt: "You are an agent role classifier. Given a task description, determine the best agent role for it. Available roles: architect (design/structure/API), developer (implementation/coding/fix), qa (testing/verification/review), coordinator (planning/orchestration/coordination), pm (requirements/specs/acceptance). Return ONLY the role name in lowercase: architect, developer, qa, coordinator, or pm. No explanation, no punctuation." + this.buildMemoryContext(description),
        userPrompt: description,
        temperature: 0.1,
        maxTokens: 20,
      })
      const role = resp.content.trim().toLowerCase()
      if (["architect", "developer", "qa", "coordinator", "pm"].includes(role)) {
        return role as "architect" | "developer" | "qa" | "coordinator" | "pm"
      }
    } catch (error) {
      logParseError('suggestAgentRole', error);
    }
    return null
  }

  async suggestSkillSteps(taskDescription: string, successOutput: string): Promise<{
    steps: Array<{ action: string; description: string; tool?: string; expectedOutput: string; rollback?: string }>
  }> {
    const resp = await this.call({
      systemPrompt: "You are a skill extractor. Given a task description and its successful output, extract reusable procedural steps. Each step should have: action, description, tool (optional), expectedOutput, and rollback (optional). Return as JSON with \"steps\" array." + this.buildMemoryContext(taskDescription),
      userPrompt: `Task: ${taskDescription}\n\nSuccessful output:\n${successOutput}\n\nExtract reusable steps as JSON.`,
      jsonMode: true,
      temperature: 0.3,
    })
    try {
      return JSON.parse(resp.content)
    } catch (error) {
      logParseError('suggestSkillSteps JSON parse', error);
      return { steps: [{ action: "execute", description: taskDescription, expectedOutput: "completed" }] }
    }
  }

  /**
   * Parse model string into providerID + modelID for OpenCode SDK.
   * Format: "providerID/modelID" (e.g. "deepseek/deepseek-chat", "anthropic/claude-sonnet-4")
   * If no "/", uses "opencode" as default providerID (OpenCode will auto-resolve).
   *
   * 🔴 Kalo dipanggil TANPA argumen (fallback), return undefined →
   *    SDK gak dikirim model → OpenCode pake session default.
   *    Plugin gak punya default model sendiri — SEMUA dari OpenCode.
   */
  private parseModelForSDK(modelStr?: string): { providerID: string; modelID: string } | undefined {
    if (!modelStr) return undefined // ← NO fallback — SDK determines model
    const parts = modelStr.split("/")
    if (parts.length >= 2) {
      return { providerID: parts[0], modelID: parts.slice(1).join("/") }
    }
    return { providerID: "opencode", modelID: modelStr }
  }

  /**
   * 🔴 THE ONLY LLM CALL PATH.
   *
   * Every LLM call goes through OpenCode SDK — NO direct external API calls.
   * If OpenCode is not available, returns [NO_LLM] fallback.
   */
  /**
   * Shared client type for session operations.
   */
  private _getClient(): {
    session: {
      create: (opts: { body: { title?: string } }) => Promise<{ data?: { id: string }; id?: string }>
      delete: (opts: { path: { id: string } }) => Promise<{ data?: boolean } | boolean>
      prompt: (opts: {
        body: {
          system?: string
          noReply?: boolean
          model?: { providerID: string; modelID: string }
          parts: Array<{ type: string; text: string }>
        }
        path: { id: string }
      }) => Promise<{ data?: { parts?: Array<{ type: string; text?: string }> }; parts?: Array<{ type: string; text?: string }> }>
    }
  } | null {
    return this.opencodeClient as ReturnType<LLMEngine['_getClient']>
  }

  /**
   * Extract text response from a session.prompt result.
   */
  private _extractResponse(result: { data?: { parts?: Array<{ type: string; text?: string }> }; parts?: Array<{ type: string; text?: string }> }): string {
    const parts = result.data?.parts ?? result.parts ?? []
    const textPart = parts.find((p: { type: string; text?: string }) => p.type === "text")
    return textPart?.text ?? ""
  }

  /**
   * Build the prompt body for a session.prompt call.
   */
  private _buildPromptBody(req: LLMRequest): {
    system: string
    noReply: false
    model?: { providerID: string; modelID: string }
    reasoningEffort?: 'low' | 'medium' | 'high'
    parts: Array<{ type: 'text'; text: string }>
  } {
    const sdkModel = req.model ?? this.parseModelForSDK()
    return {
      system: req.jsonMode
        ? `${req.systemPrompt}\n\nRespond with ONLY valid JSON. No markdown, no explanation.`
        : req.systemPrompt,
      noReply: false,
      ...(sdkModel ? { model: sdkModel } : {}),
      ...(req.reasoningEffort ? { reasoningEffort: req.reasoningEffort } : {}),
      parts: [{ type: 'text' as const, text: req.userPrompt }],
    }
  }

  /**
   * Run session.prompt with timeout + abort controller.
   */
  private async _promptWithTimeout(
    client: NonNullable<ReturnType<LLMEngine['_getClient']>>,
    sessionId: string,
    body: ReturnType<LLMEngine['_buildPromptBody']>,
    timeoutMs: number = 120_000,
    externalSignal?: AbortSignal,
  ): Promise<string> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    // Forward external abort to our controller
    const onExternalAbort = () => { controller.abort() }
    if (externalSignal) {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true })
    }

    try {
      const result = await Promise.race([
        client.session.prompt({
          body,
          path: { id: sessionId },
        }),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener('abort', () => {
            const reason = externalSignal?.aborted
              ? 'LLM call cancelled (parent timeout/abort)'
              : `OpenCode call timed out after ${timeoutMs}ms`
            reject(new Error(reason))
          })
        }),
      ])
      return this._extractResponse(result)
    } finally {
      clearTimeout(timeoutId)
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onExternalAbort)
      }
    }
  }

  private async callOpenCode(req: LLMRequest): Promise<LLMResponse> {
    if (!this.opencodeClient || !this.pluginSessionId) {
      return this.fallbackResponse(req)
    }

    const client = this._getClient()
    if (!client) return this.fallbackResponse(req)

    // Chat mode: pluginSessionId was swapped to a unique synthetic ID
    // (agentic-chat-{nonce}) by setChatMode(), so session.prompt() calls
    // an independent session without the parent session's agent loop.
    // This mirrors how agentRuntime sub-engines always work in chat mode.
    try {
      const body = this._buildPromptBody(req)
      const text = await this._promptWithTimeout(client, this.pluginSessionId, body, req.timeoutMs ?? 300_000, req.signal)

      if (text.trim()) {
        return { content: text.trim(), finishReason: 'stop' }
      }
    } catch (error) {
      logParseError('callOpenCode', error);
    }

    return this.fallbackResponse(req)
  }

  /** Dispose the cached temp session. Called when engine is no longer needed. */
  async disposeTempSession(): Promise<void> {
    if (!this._tempSessionId) return
    const client = this._getClient()
    if (client) {
      try { await client.session.delete({ path: { id: this._tempSessionId } }) } catch { /* ignore */ }
    }
    this._tempSessionId = null
    // Restore original session ID
    if (this._backupSessionId) {
      this.pluginSessionId = this._backupSessionId
      this._backupSessionId = null
    }
  }

  /**
   * Fallback response when LLM is unavailable (not running inside OpenCode,
   * SDK call failed, or running in chat mode where session.prompt() would hang).
   *
   * @param reason - Optional context for the fallback message.
   */
  private fallbackResponse(req: LLMRequest, reason?: string): LLMResponse {
    let msg: string
    if (reason === 'chat') {
      msg = '[NO_LLM] Chat mode: agentic_* tools cannot call LLM directly. Use /plan, /execute, /verify commands instead, or run in agent mode (opencode run).'
    } else if (reason === 'sdk') {
      msg = '[NO_LLM] OpenCode SDK unavailable. Plugin requires OpenCode runtime.'
    } else {
      msg = '[NO_LLM] No LLM available. Run within OpenCode for native LLM access. Plugin does NOT call external APIs directly.'
    }
    if (req.jsonMode) {
      return { content: `{"status":"no_llm","data":null,"reason":"${reason ?? 'unavailable'}"}`, finishReason: "no_llm" }
    }
    return { content: msg, finishReason: "no_llm" }
  }
}

export const llmEngine = new LLMEngine()
