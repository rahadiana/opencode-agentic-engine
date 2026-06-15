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
 */
export class AgentRuntime {
  private engines = new Map<string, LLMEngine>()
  private opencodeClient: unknown = null
  private modelRegistry?: ModelRegistry
  private roleRegistry: RoleRegistry

  constructor() {
    this.roleRegistry = new RoleRegistry()
  }

  setOpencodeClient(client: unknown): void {
    this.opencodeClient = client
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
   */
  private getEngine(parentSessionId: string, role: string): LLMEngine {
    const key = `${parentSessionId}::${role}`
    if (!this.engines.has(key)) {
      const engine = new LLMEngine()
      engine.setOpencodeClient(this.opencodeClient)
      engine.setSessionId(`${parentSessionId}-${role}`)
      if (this.modelRegistry) engine.setModelRegistry(this.modelRegistry)
      this.engines.set(key, engine)
    }
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
    if (roleDef?.prompt) {
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

    try {
      const resp = await engine.call({
        systemPrompt: promptParts.join("\n"),
        userPrompt: ctx.taskDescription,
        temperature: 0.3,
        maxTokens: 4096,
      })
      const output = resp.content
      if (output.startsWith("LLM error") || output.startsWith("[NO_LLM]")) {
        return { output, success: false, error: output }
      }
      return { output, success: true, modelUsed: engine.getCurrentModel() }
    } catch (e) {
      return { output: "", success: false, error: (e as Error).message }
    }
  }
}
