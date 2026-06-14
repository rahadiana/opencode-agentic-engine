import { execFileSync } from "node:child_process"

export interface LLMConfig {
  provider: "openai" | "anthropic" | "local" | "opencode"
  apiKey?: string
  baseURL?: string
  model?: string
  maxTokens?: number
  temperature?: number
}

export interface LLMRequest {
  systemPrompt: string
  userPrompt: string
  maxTokens?: number
  temperature?: number
  jsonMode?: boolean
}

export interface LLMResponse {
  content: string
  usage?: { promptTokens: number; completionTokens: number }
  finishReason?: string
}

const DEFAULT_MODELS: Record<string, string> = {
  openai: "gpt-4o",
  anthropic: "claude-3-5-sonnet-20240620",
  local: "codellama",
  opencode: "opencode-default",
}

export class LLMEngine {
  private config: LLMConfig
  private opencodeClient: unknown = null
  private pluginSessionId: string | null = null

  constructor(config: Partial<LLMConfig> = {}) {
    this.config = {
      provider: config.provider ?? this.detectProvider(),
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      model: config.model,
      maxTokens: config.maxTokens ?? 4096,
      temperature: config.temperature ?? 0.3,
    }
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

  updateConfig(config: Partial<LLMConfig>): void {
    Object.assign(this.config, config)
  }

  async call(req: LLMRequest): Promise<LLMResponse> {
    switch (this.config.provider) {
      case "openai":
        return this.callOpenAI(req)
      case "anthropic":
        return this.callAnthropic(req)
      case "local":
        return this.callLocal(req)
      case "opencode":
        return this.callOpenCode(req)
      default:
        if (this.opencodeClient) return this.callOpenCode(req)
        return this.callOpenAI(req)
    }
  }

  async decomposeTask(goal: string, context: string): Promise<string[]> {
    const resp = await this.call({
      systemPrompt: "You are a software task decomposer. Break down the given goal into sequential subtasks. Each subtask should be a single, concrete action. Return ONLY a JSON array of strings.",
      userPrompt: `Goal: ${goal}\n\nContext:\n${context}\n\nBreak this down into 3-7 sequential subtasks. Return as JSON array of strings.`,
      jsonMode: true,
      temperature: 0.2,
    })
    try {
      const parsed = JSON.parse(resp.content)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      const lines = resp.content.match(/["'](.+?)["']/g)
      return (lines ?? []).map(l => l.replace(/['"]/g, ""))
    }
  }

  async summarizeContext(planGoal: string, turns: string[]): Promise<string> {
    const resp = await this.call({
      systemPrompt: "You are a context compressor. Summarize the following conversation into a compact form that preserves: key decisions made, files changed, invariants that must be preserved, and remaining tasks. Be concise.",
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
    const resp = await this.call({
      systemPrompt: "You are an error analyst. Given an error message and list of recently modified files, determine: the error category (compile/type/test/import/runtime), the likely root cause, and a specific fix suggestion. Return as JSON with keys: category, rootCause, fix.",
      userPrompt: `Error:\n${errorText}\n\nRecently modified files:\n${modifiedFiles.join("\n")}\n\nAnalyze and return JSON.`,
      jsonMode: true,
      temperature: 0.2,
    })
    try {
      return JSON.parse(resp.content)
    } catch {
      return { category: "unknown", rootCause: "Unable to analyze", fix: "Manual investigation needed" }
    }
  }

  async generatePlan(goal: string, constraints: string[], codebaseSummary: string): Promise<{
    steps: Array<{ id: string; description: string; dependsOn: string[] }>
    complexity: string
  }> {
    const resp = await this.call({
      systemPrompt: "You are a software planning assistant. Given a goal, constraints, and codebase summary, generate a structured execution plan. Return as JSON with \"steps\" (array of {id, description, dependsOn}) and \"complexity\" (\"low\"/\"medium\"/\"high\"). Steps should have sequential IDs like \"step-1\", \"step-2\". The dependsOn array should reference earlier step IDs.",
      userPrompt: `Goal: ${goal}\nConstraints: ${constraints.join(", ")}\nCodebase: ${codebaseSummary}\n\nGenerate a plan as JSON.`,
      jsonMode: true,
      temperature: 0.3,
    })
    try {
      return JSON.parse(resp.content)
    } catch {
      return {
        steps: [{ id: "step-1", description: goal, dependsOn: [] }],
        complexity: "low",
      }
    }
  }

  async reviewCode(goal: string, files: Record<string, string>): Promise<string[]> {
    const filesStr = Object.entries(files).map(([path, content]) => `### ${path}\n\`\`\`\n${content.slice(0, 2000)}\n\`\`\``).join("\n\n")
    const resp = await this.call({
      systemPrompt: "You are a code reviewer. Review the given files for potential issues: type safety, edge cases, error handling, performance, security, and maintainability. Return a JSON array of issue descriptions (strings). If no issues found, return empty array.",
      userPrompt: `Goal: ${goal}\n\nFiles:\n${filesStr}\n\nList issues found as JSON array.`,
      jsonMode: true,
      temperature: 0.2,
    })
    try {
      return JSON.parse(resp.content)
    } catch {
      return []
    }
  }

  async suggestSkillSteps(taskDescription: string, successOutput: string): Promise<{
    steps: Array<{ action: string; description: string; tool?: string; expectedOutput: string; rollback?: string }>
  }> {
    const resp = await this.call({
      systemPrompt: "You are a skill extractor. Given a task description and its successful output, extract reusable procedural steps. Each step should have: action, description, tool (optional), expectedOutput, and rollback (optional). Return as JSON with \"steps\" array.",
      userPrompt: `Task: ${taskDescription}\n\nSuccessful output:\n${successOutput}\n\nExtract reusable steps as JSON.`,
      jsonMode: true,
      temperature: 0.3,
    })
    try {
      return JSON.parse(resp.content)
    } catch {
      return { steps: [{ action: "execute", description: taskDescription, expectedOutput: "completed" }] }
    }
  }

  private detectProvider(): LLMConfig["provider"] {
    if (process.env.OPENAI_API_KEY) return "openai"
    if (process.env.ANTHROPIC_API_KEY) return "anthropic"
    return "opencode"
  }

  private async callOpenAI(req: LLMRequest): Promise<LLMResponse> {
    const apiKey = this.config.apiKey ?? process.env.OPENAI_API_KEY
    if (!apiKey) return this.fallbackResponse(req)

    const body: Record<string, unknown> = {
      model: this.config.model ?? DEFAULT_MODELS.openai,
      messages: [
        { role: "system", content: req.systemPrompt },
        { role: "user", content: req.userPrompt },
      ],
      max_tokens: req.maxTokens ?? this.config.maxTokens,
      temperature: req.temperature ?? this.config.temperature,
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
    } catch {
      return this.fallbackResponse(req)
    }
  }

  private async callOpenCode(req: LLMRequest): Promise<LLMResponse> {
    if (!this.opencodeClient || !this.pluginSessionId) {
      return this.fallbackResponse(req)
    }

    try {
      const client = this.opencodeClient as {
        session: {
          prompt: (opts: {
            body: { system?: string; noReply?: boolean; parts: Array<{ type: string; text: string }> }
            path: { id: string }
          }) => Promise<{ data?: { parts?: Array<{ type: string; text?: string }> }; parts?: Array<{ type: string; text?: string }> }>
        }
      }

      const combinedPrompt = `${req.systemPrompt}\n\n---\n\n${req.userPrompt}`

      const result = await client.session.prompt({
        body: {
          system: req.jsonMode
            ? `${combinedPrompt}\n\nRespond with ONLY valid JSON. No markdown, no explanation.`
            : combinedPrompt,
          noReply: true,
          parts: [{ type: "text", text: "Generate the requested output." }],
        },
        path: { id: this.pluginSessionId },
      })

      const parts = result.data?.parts ?? result.parts ?? []
      const textPart = parts.find((p: { type: string; text?: string }) => p.type === "text")
      const text = textPart?.text ?? ""

      return {
        content: text.trim(),
        finishReason: "stop",
      }
    } catch (e) {
      return { content: `OpenCode LLM call failed: ${(e as Error).message}. Falling back to heuristic.` }
    }
  }

  private async httpCall(url: string, apiKey: string, body: unknown, extraHeaders: Record<string, string> = {}): Promise<LLMResponse> {
    try {
      const payload = JSON.stringify(body)
      const args = [
        "-s", "-X", "POST", url,
        "-H", "Content-Type: application/json",
        "-H", `Authorization: Bearer ${apiKey}`,
      ]
      for (const [k, v] of Object.entries(extraHeaders)) {
        args.push("-H", `${k}: ${v}`)
      }
      args.push("-d", payload)

      const output = execFileSync("curl", args, {
        encoding: "utf-8",
        timeout: 60000,
        stdio: ["ignore", "pipe", "pipe"],
      })

      const data = JSON.parse(output)

      if (data.error) {
        return { content: `LLM error: ${data.error.message ?? JSON.stringify(data.error)}` }
      }

      if (data.content) {
        return {
          content: typeof data.content === "string" ? data.content : data.content[0]?.text ?? JSON.stringify(data.content),
          usage: data.usage ? { promptTokens: data.usage.input_tokens ?? 0, completionTokens: data.usage.output_tokens ?? 0 } : undefined,
          finishReason: data.stop_reason,
        }
      }

      const choice = data.choices?.[0]
      if (choice) {
        return {
          content: choice.message?.content ?? JSON.stringify(choice),
          usage: data.usage ? { promptTokens: data.usage.prompt_tokens ?? 0, completionTokens: data.usage.completion_tokens ?? 0 } : undefined,
          finishReason: choice.finish_reason,
        }
      }

      return { content: JSON.stringify(data) }
    } catch (e) {
      return { content: `LLM call failed: ${(e as Error).message}` }
    }
  }

  private fallbackResponse(req: LLMRequest): LLMResponse {
    if (req.jsonMode) {
      return { content: `{"_no_llm": true}`, finishReason: "no_llm" }
    }
    return { content: `[NO_LLM] No LLM configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY env var, or run within OpenCode for native LLM access.`, finishReason: "no_llm" }
  }
}

export const llmEngine = new LLMEngine()
