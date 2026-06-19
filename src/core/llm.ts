import { execFileSync } from "node:child_process"

// Error logging helper for silent catch blocks
function logParseError(context: string, error: unknown): void {
  if (process.env.DEBUG_LLM_PARSING) {
    console.error(`[LLM Parse Error] ${context}:`, error);
  }
}

export interface LLMConfig {
  provider: "openai" | "anthropic" | "local" | "opencode"
  apiKey?: string
  baseURL?: string
  model?: string
  maxTokens?: number
  temperature?: number
  variant?: string
}

export interface LLMRequest {
  systemPrompt: string
  userPrompt: string
  maxTokens?: number
  temperature?: number
  jsonMode?: boolean
  /** Source context untuk event llm.response — terisi jika dari agentic_execute step */
  sourceStepId?: string
  /** Source context untuk event llm.response — terisi jika dari pipeline stage */
  sourceTaskId?: string
  /** Source context untuk event llm.response — terisi jika dari pipeline multi-stage */
  sourcePipelineRunId?: string
}

export interface LLMResponse {
  content: string
  usage?: {
    promptTokens: number
    completionTokens: number
    reasoningTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
  }
  finishReason?: string
}

const DEFAULT_MODELS: Record<string, string> = {
  openai: "gpt-4o",
  anthropic: "claude-3-5-sonnet-20240620",
  local: "codellama",
  opencode: "opencode-default",
}

import type { ModelRegistry } from "./model-registry.js"
import type { BudgetTracker } from "./budget-tracker.js"

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
  private eventBus?: import("./event-bus.js").EventBus
  private responseCache = new Map<string, { response: LLMResponse; timestamp: number }>()
  private readonly CACHE_TTL = 30_000 // 30s cache for identical requests

  constructor(config: Partial<LLMConfig> = {}) {
    this.config = {
      provider: config.provider ?? this.detectProvider(),
      apiKey: config.apiKey ?? process.env.OPENAI_API_KEY,
      baseURL: config.baseURL ?? process.env.OPENAI_BASE_URL,
      model: config.model ?? process.env.OPENAI_MODEL,
      maxTokens: config.maxTokens ?? 4096,
      temperature: config.temperature ?? 0.3,
      variant: config.variant ?? process.env.OPENAI_VARIANT,
    }
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
    if (this.config.provider === "opencode" || !process.env.OPENAI_API_KEY) {
      this.config.provider = "opencode"
    }
  }

  setSessionId(sessionId: string): void {
    this.pluginSessionId = sessionId
  }

  setModelRegistry(registry: ModelRegistry): void {
    this.modelRegistry = registry
  }

  setBudgetTracker(tracker: BudgetTracker): void {
    this.budgetTracker = tracker
  }

  setEventBus(bus: import("./event-bus.js").EventBus): void {
    this.eventBus = bus
  }

  setSessionStore(store: import("../memory/session-store.js").SessionStore): void {
    this.sessionStore = store
  }

  updateConfig(config: Partial<LLMConfig>): void {
    Object.assign(this.config, config)
  }

  getCurrentModel(): string {
    return this.config.model ?? "unknown"
  }

  private getCacheKey(req: LLMRequest): string {
    return `${this.config.provider}:${this.config.model}:${req.systemPrompt.slice(0, 100)}:${req.userPrompt.slice(0, 200)}:${req.jsonMode}`
  }

  async call(req: LLMRequest): Promise<LLMResponse> {
    const startTime = Date.now()
    let success = false
    let response: LLMResponse

    // Check cache for identical requests (TTL: 30s)
    const cacheKey = this.getCacheKey(req)
    const cached = this.responseCache.get(cacheKey)
    if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
      return cached.response
    }

    try {
      switch (this.config.provider) {
        case "openai":
          response = await this.callOpenAI(req)
          break
        case "anthropic":
          response = await this.callAnthropic(req)
          break
        case "local":
          response = await this.callLocal(req)
          break
        case "opencode":
          response = await this.callOpenCode(req)
          break
        default:
          if (this.opencodeClient) response = await this.callOpenCode(req)
          else response = await this.callOpenAI(req)
      }
      success = !response.content.startsWith("LLM error") && !response.content.startsWith("[NO_LLM]") && !response.content.startsWith("LLM call failed")
    } catch (error) {
      logParseError('LLM call', error);
      response = { content: "LLM call threw an exception", finishReason: "error" }
      success = false
    }

    // Cache successful responses
    if (success) {
      this.responseCache.set(cacheKey, { response, timestamp: Date.now() })
    }

    const latency = Date.now() - startTime
    
    const taskType = this.sessionStore && this.pluginSessionId
      ? this.sessionStore.getOrCreate(this.pluginSessionId).currentTaskType
      : undefined
    this.modelRegistry?.recordCall(this.getCurrentModel(), success, latency, taskType)

    // Feed token usage to BudgetTracker
    const tInput = response.usage?.promptTokens ?? 0
    const tOutput = response.usage?.completionTokens ?? 0
    const tReasoning = response.usage?.reasoningTokens ?? 0
    const tCacheRead = response.usage?.cacheReadTokens ?? 0
    const tCacheWrite = response.usage?.cacheWriteTokens ?? 0

    if (success && this.budgetTracker) {
      this.budgetTracker.recordTokens(this.getCurrentModel(), tInput, tOutput, tReasoning, tCacheRead, tCacheWrite)
    }

    // Emit llm.response event (passive — for dashboard/trace observers)
    if (this.eventBus) {
      // Approximate cost using gpt-4o defaults (matching BudgetTracker fallback)
      const cost = (tInput * 2.5 + tOutput * 10 + tReasoning * 10 + tCacheRead * 0.3 + tCacheWrite * 2.5) / 1_000_000
      this.eventBus.emit({
        type: "llm.response",
        payload: {
          sessionID: this.pluginSessionId ?? "",
          model: this.getCurrentModel(),
          tokens: { input: tInput, output: tOutput, reasoning: tReasoning, cacheRead: tCacheRead, cacheWrite: tCacheWrite },
          costUsd: cost,
          success,
          durationMs: latency,
          sourceStepId: req.sourceStepId,
          sourceTaskId: req.sourceTaskId,
          sourcePipelineRunId: req.sourcePipelineRunId,
        },
      } as any)
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

  private detectProvider(): LLMConfig["provider"] {
    if (process.env.OPENAI_API_KEY || process.env.OPENAI_BASE_URL) return "openai"
    if (process.env.ANTHROPIC_API_KEY) return "anthropic"
    return "opencode"
  }

  private async callOpenAI(req: LLMRequest): Promise<LLMResponse> {
    const apiKey = this.config.apiKey ?? process.env.OPENAI_API_KEY ?? ""
    const baseUrl = this.config.baseURL ?? process.env.OPENAI_BASE_URL
    if (!apiKey && !baseUrl) return this.fallbackResponse(req)

    const body: Record<string, unknown> = {
      model: this.config.model ?? DEFAULT_MODELS.openai,
      messages: [
        { role: "system", content: req.systemPrompt },
        { role: "user", content: req.userPrompt },
      ],
      max_tokens: req.maxTokens ?? this.config.maxTokens,
      temperature: req.temperature ?? this.config.temperature,
    }

    if (this.config.variant) {
      body.variant = this.config.variant
    }

    if (req.jsonMode) {
      body.response_format = { type: "json_object" }
    }

    return this.httpCall(
      this.config.baseURL ?? "https://api.openai.com/v1/chat/completions",
      apiKey,
      body,
    )
  }

  private async callAnthropic(req: LLMRequest): Promise<LLMResponse> {
    const apiKey = this.config.apiKey ?? process.env.ANTHROPIC_API_KEY
    if (!apiKey) return this.fallbackResponse(req)

    const body = {
      model: this.config.model ?? DEFAULT_MODELS.anthropic,
      max_tokens: req.maxTokens ?? this.config.maxTokens,
      temperature: req.temperature ?? this.config.temperature,
      system: req.systemPrompt + (req.jsonMode ? "\nYou MUST return valid JSON only." : ""),
      messages: [{ role: "user", content: req.userPrompt }],
    }

    return this.httpCall(
      "https://api.anthropic.com/v1/messages",
      apiKey,
      body,
      { "anthropic-version": "2023-06-01" },
    )
  }

  private async callLocal(req: LLMRequest): Promise<LLMResponse> {
    try {
      const prompt = req.systemPrompt + "\n\n" + req.userPrompt
      const output = execFileSync("ollama", ["run", this.config.model ?? "codellama", prompt], {
        encoding: "utf-8",
        timeout: 60000,
        stdio: ["ignore", "pipe", "pipe"],
      })
      return { content: output.trim() }
    } catch (error) {
      logParseError('callLocal ollama', error);
      return this.fallbackResponse(req)
    }
  }

  private async callOpenCode(req: LLMRequest): Promise<LLMResponse> {
    // Try direct HTTP call first if we have credentials for any provider
    const openaiKey = this.config.apiKey ?? process.env.OPENAI_API_KEY
    const openaiBaseUrl = this.config.baseURL ?? process.env.OPENAI_BASE_URL
    const anthropicKey = process.env.ANTHROPIC_API_KEY
    if (openaiKey || openaiBaseUrl) {
      return this.callOpenAI(req)
    }
    if (anthropicKey) {
      return this.callAnthropic(req)
    }

    // Fall back to OpenCode SDK client (noReply must be false to get a response)
    if (this.opencodeClient && this.pluginSessionId) {
      try {
        const client = this.opencodeClient as {
          session: {
            prompt: (opts: {
              body: { system?: string; noReply?: boolean; parts: Array<{ type: string; text: string }> }
              path: { id: string }
            }) => Promise<{ data?: { parts?: Array<{ type: string; text?: string }> }; parts?: Array<{ type: string; text?: string }> }>
          }
        }

        const result = await client.session.prompt({
          body: {
            system: req.jsonMode
              ? `${req.systemPrompt}\n\nRespond with ONLY valid JSON. No markdown, no explanation.`
              : req.systemPrompt,
            noReply: false,
            parts: [{ type: "text", text: req.userPrompt }],
          },
          path: { id: this.pluginSessionId },
        })

        const parts = result.data?.parts ?? result.parts ?? []
        const textPart = parts.find((p: { type: string; text?: string }) => p.type === "text")
        const text = textPart?.text ?? ""

        if (text.trim()) {
          return { content: text.trim(), finishReason: "stop" }
        }
      } catch (error) {
        logParseError('callOpenCode', error);
      }
    }

    return this.fallbackResponse(req)
  }

  private async httpCall(url: string, apiKey: string, body: unknown, extraHeaders: Record<string, string> = {}): Promise<LLMResponse> {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        ...extraHeaders,
      }

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 60000)

      const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      clearTimeout(timeout)

      let data: Record<string, unknown>
      const text = await resp.text()
      try {
        data = JSON.parse(text)
      } catch {
        return { content: text.slice(0, 4096) || "LLM returned non-JSON response" }
      }

      const d = data as Record<string, any>
      if (d.error) {
        return { content: `LLM error: ${d.error.message ?? JSON.stringify(d.error)}` }
      }

      if (d.content) {
        return {
          content: typeof d.content === "string" ? d.content : d.content[0]?.text ?? JSON.stringify(d.content),
          usage: d.usage ? {
            promptTokens: d.usage.input_tokens ?? 0,
            completionTokens: d.usage.output_tokens ?? 0,
            reasoningTokens: d.usage.reasoning_tokens ?? d.usage.reasoning ?? 0,
            cacheReadTokens: d.usage.cache_read_input_tokens ?? d.usage.cache?.read ?? 0,
            cacheWriteTokens: d.usage.cache_creation_input_tokens ?? d.usage.cache?.write ?? 0,
          } : undefined,
          finishReason: d.stop_reason,
        }
      }

      const choice = d.choices?.[0]
      if (choice) {
        return {
          content: choice.message?.content ?? JSON.stringify(choice),
          usage: d.usage ? {
            promptTokens: d.usage.prompt_tokens ?? d.usage.input_tokens ?? 0,
            completionTokens: d.usage.completion_tokens ?? d.usage.output_tokens ?? 0,
            reasoningTokens: d.usage.reasoning_tokens ?? 0,
            cacheReadTokens: d.usage.cache_read_input_tokens ?? d.usage.cache?.read ?? 0,
            cacheWriteTokens: d.usage.cache_creation_input_tokens ?? d.usage.cache?.write ?? 0,
          } : undefined,
          finishReason: choice.finish_reason,
        }
      }

      return { content: JSON.stringify(data) }
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        return { content: "LLM call timed out after 60s", finishReason: "timeout" }
      }
      return { content: `LLM call failed: ${(e as Error).message}` }
    }
  }

  private fallbackResponse(req: LLMRequest): LLMResponse {
    if (req.jsonMode) {
      return { content: `{"_no_llm": true}`, finishReason: "no_llm" }
    }
    return { content: `[NO_LLM] No LLM configured. Set OPENAI_API_KEY (OpenAI/compatible), ANTHROPIC_API_KEY (Claude), or OPENAI_BASE_URL (local LLM), or run within OpenCode for native LLM access.`, finishReason: "no_llm" }
  }
}

export const llmEngine = new LLMEngine()
