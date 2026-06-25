import { type MCPTool } from "./mcp-client.js"

export interface DynamicToolRegistration {
  name: string
  description: string
  parameters?: Record<string, unknown>
  execute: (args: Record<string, unknown>, context?: any) => Promise<unknown>
  metadata?: {
    category?: string
    keywords?: string[]
    version?: string
    author?: string
  }
  registeredAt: number
}

export interface ToolCallResult {
  tool: string
  content: unknown
  isError: boolean
  durationMs: number
}

export class DynamicToolRegistry {
  private tools = new Map<string, DynamicToolRegistration>()

  register(registration: DynamicToolRegistration): void {
    if (!registration.name || typeof registration.name !== "string") {
      throw new Error("Tool name is required and must be a string")
    }
    if (typeof registration.execute !== "function") {
      throw new Error("Tool execute function is required")
    }
    this.tools.set(registration.name, {
      ...registration,
      registeredAt: registration.registeredAt ?? Date.now(),
    })
  }

  unregister(name: string): boolean {
    return this.tools.delete(name)
  }

  get(name: string): DynamicToolRegistration | undefined {
    return this.tools.get(name)
  }

  has(name: string): boolean {
    return this.tools.has(name)
  }

  list(): DynamicToolRegistration[] {
    return [...this.tools.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  listByCategory(category: string): DynamicToolRegistration[] {
    return this.list().filter(
      (t) => t.metadata?.category === category,
    )
  }

  search(query: string): DynamicToolRegistration[] {
    const lower = query.toLowerCase()
    return this.list().filter((t) => {
      if (t.name.toLowerCase().includes(lower)) return true
      if (t.description.toLowerCase().includes(lower)) return true
      if (t.metadata?.keywords?.some((k) => k.toLowerCase().includes(lower))) return true
      return false
    })
  }

  async call(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    const tool = this.tools.get(name)
    if (!tool) {
      return {
        tool: name,
        content: `Tool not found: ${name}`,
        isError: true,
        durationMs: 0,
      }
    }

    const start = performance.now()
    try {
      const content = await tool.execute(args)
      return {
        tool: name,
        content,
        isError: false,
        durationMs: Math.round(performance.now() - start),
      }
    } catch (err) {
      return {
        tool: name,
        content: err instanceof Error ? err.message : String(err),
        isError: true,
        durationMs: Math.round(performance.now() - start),
      }
    }
  }

  get size(): number {
    return this.tools.size
  }

  clear(): void {
    this.tools.clear()
  }

  registerBatch(registrations: DynamicToolRegistration[]): void {
    for (const reg of registrations) {
      this.register(reg)
    }
  }

  /**
   * Register a tool from pre-built components (used by registryTool helper).
   * This is a convenience wrapper over register() for tools that already have
   * parameters in JSON Schema format.
   */
  registerFromTool(
    name: string,
    description: string,
    parameters: Record<string, unknown>,
    execute: (args: Record<string, unknown>, context?: any) => Promise<unknown>,
    metadata?: { category?: string; keywords?: string[] },
  ): void {
    this.register({
      name,
      description,
      parameters,
      execute,
      metadata,
      registeredAt: Date.now(),
    })
  }

  getStats(): { total: number; byCategory: Record<string, number> } {
    const byCategory: Record<string, number> = {}
    for (const tool of this.tools.values()) {
      const cat = tool.metadata?.category ?? "other"
      byCategory[cat] = (byCategory[cat] ?? 0) + 1
    }
    return { total: this.tools.size, byCategory }
  }

  toMCPTools(): MCPTool[] {
    return this.list().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters ?? {},
    }))
  }
}
