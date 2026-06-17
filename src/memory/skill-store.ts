import { type SkillDefinition, type SkillStep, type SkillMeta, createSkillDefinition, inspectSkill, serializeSkill, deserializeSkill } from "./skill-format.js"
import { createMemoryEnvelope, parseMemoryEnvelope, MEMORY_SCHEMA_VERSION } from "./schema-version.js"

export { type SkillDefinition, type SkillStep, type SkillMeta, inspectSkill, serializeSkill, deserializeSkill, createSkillDefinition }

export interface SkillRecord {
  definition: SkillDefinition
  usageCount: number
  successRate: number
  lastUsed: string
}

export class SkillStore {
  private skills = new Map<string, SkillRecord>()

  async extract(turn: { role: string; content: string }, contextTags: string[] = []): Promise<SkillRecord | null> {
    const content = turn.content

    if (!this.isExtractablePattern(content)) return null

    const name = this.extractName(content)
    if (!name) return null

    const steps = this.extractSteps(content)
    if (steps.length === 0) return null

    const existing = [...this.skills.values()].find(s => s.definition.meta.name === name)
    if (existing) {
      existing.usageCount++
      // Update success rate using incremental average: newAvg = (oldAvg * (n-1) + newValue) / n
      existing.successRate = (existing.successRate * (existing.usageCount - 1) + 1.0) / existing.usageCount
      existing.lastUsed = new Date().toISOString()
      existing.definition.quality.usageCount = existing.usageCount
      existing.definition.quality.successRate = existing.successRate
      existing.definition.audit.lastUsed = existing.lastUsed
      existing.definition.audit.lastModified = existing.lastUsed
      existing.definition.audit.modifiedBy = "agent"
      return existing
    }

    const keywords = this.extractKeywords(content)
    const inferredTools = this.inferTools(content)

    const def = createSkillDefinition(
      name,
      this.extractPattern(content),
      keywords,
      steps.map((s, i) => ({
        action: this.inferAction(s),
        description: s,
        tool: inferredTools[i] ?? this.inferToolForStep(s),
        expectedOutput: `Step ${i + 1} completed`,
      })),
      contextTags.length > 0 ? contextTags : undefined,
    )

    const record: SkillRecord = {
      definition: def,
      usageCount: 1,
      successRate: 1.0,
      lastUsed: new Date().toISOString(),
    }

    this.skills.set(def.meta.id, record)
    return record
  }

  find(query: string): SkillRecord[] {
    const q = query.toLowerCase()
    return [...this.skills.values()]
      .filter(s =>
        s.definition.meta.name.toLowerCase().includes(q) ||
        s.definition.trigger.pattern.toLowerCase().includes(q) ||
        (s.definition.trigger.keywords ?? []).some(k => k.toLowerCase().includes(q))
      )
      .sort((a, b) => b.successRate - a.successRate)
      .slice(0, 5)
  }

  getAll(): SkillRecord[] {
    return [...this.skills.values()].sort((a, b) => b.lastUsed.localeCompare(a.lastUsed))
  }

  getById(id: string): SkillRecord | undefined {
    return this.skills.get(id)
  }

  reportFailure(skillId: string): boolean {
    const record = this.skills.get(skillId)
    if (!record) return false

    record.usageCount++
    record.successRate = (record.successRate * (record.usageCount - 1)) / record.usageCount
    record.definition.quality.usageCount = record.usageCount
    record.definition.quality.successRate = record.successRate
    record.definition.quality.failureScenarios.push(`Failed at ${new Date().toISOString()}`)
    record.definition.audit.lastModified = new Date().toISOString()
    return true
  }

  exportEnvelope(skillId: string): string | null {
    const record = this.skills.get(skillId)
    if (!record) return null
    return JSON.stringify(createMemoryEnvelope(record.definition, "skill"), null, 2)
  }

  importFromEnvelope(json: string): boolean {
    const parsed = parseMemoryEnvelope<SkillDefinition>(JSON.parse(json))
    if (!parsed || parsed.type !== "skill") return false

    const existing = this.skills.get(parsed.data.meta.id)
    if (existing) {
      existing.definition = parsed.data
      existing.usageCount = parsed.data.quality.usageCount
      existing.successRate = parsed.data.quality.successRate
      existing.lastUsed = parsed.data.audit.lastUsed
      return true
    }

    this.skills.set(parsed.data.meta.id, {
      definition: parsed.data,
      usageCount: parsed.data.quality.usageCount,
      successRate: parsed.data.quality.successRate,
      lastUsed: parsed.data.audit.lastUsed,
    })
    return true
  }

  private isExtractablePattern(content: string): boolean {
    const lower = content.toLowerCase()
    return (lower.includes("✅") || lower.includes("success")) && (lower.includes("step") || lower.includes("complete") || lower.includes("done"))
  }

  private extractName(content: string): string | null {
    const patterns = [
      /(?:created|added|implemented|built)\s+(\w[\w\s]{3,40})/i,
      /Step\s+\w+:\s*(.+?)(?:\.|$)/i,
      /Completed\s+(.+?)(?:\.|$)/i,
    ]
    for (const p of patterns) {
      const m = content.match(p)
      if (m) return m[1].trim().slice(0, 50)
    }
    return null
  }

  private extractSteps(content: string): string[] {
    const steps: string[] = []
    const lines = content.split("\n")
    for (const line of lines) {
      const m = line.match(/^\d+\.\s+(.+)/)
      if (m) steps.push(m[1].trim())
    }
    return steps
  }

  private extractPattern(content: string): string {
    const keywords = content.match(/\b(\w{4,})\b/g)
    return (keywords ?? []).slice(0, 5).join(" ")
  }

  private extractKeywords(content: string): string[] {
    return [...new Set(content.match(/\b(\w{3,})\b/g) ?? [])].slice(0, 10)
  }

  private inferAction(stepDesc: string): string {
    const lower = stepDesc.toLowerCase()
    if (lower.includes("create") || lower.includes("add") || lower.includes("write")) return "create"
    if (lower.includes("delete") || lower.includes("remove")) return "delete"
    if (lower.includes("modify") || lower.includes("update") || lower.includes("edit") || lower.includes("change")) return "modify"
    if (lower.includes("install") || lower.includes("setup")) return "install"
    if (lower.includes("test") || lower.includes("verify") || lower.includes("check")) return "verify"
    if (lower.includes("run") || lower.includes("exec")) return "execute"
    if (lower.includes("review") || lower.includes("audit") || lower.includes("inspect")) return "review"
    return "execute"
  }

  private inferToolForStep(stepDesc: string): string | undefined {
    const lower = stepDesc.toLowerCase()
    if (lower.includes("read") || lower.includes("check file")) return "read"
    if (lower.includes("write") || lower.includes("create file")) return "write"
    if (lower.includes("edit") || lower.includes("modify")) return "edit"
    if (lower.includes("run") || lower.includes("test") || lower.includes("exec")) return "bash"
    if (lower.includes("install") || lower.includes("npm") || lower.includes("pip")) return "bash"
    if (lower.includes("search") || lower.includes("find")) return "grep"
    return undefined
  }

  private inferTools(content: string): string[] {
    const tools: string[] = []
    const toolPatterns: Array<{ pattern: RegExp; tool: string }> = [
      { pattern: /\b(read|Read)\b/, tool: "read" },
      { pattern: /\b(edit|Edit)\b/, tool: "edit" },
      { pattern: /\b(write|Write)\b/, tool: "write" },
      { pattern: /\b(bash|Bash|exec|run)\b/, tool: "bash" },
      { pattern: /\b(grep|search|find)\b/, tool: "grep" },
    ]
    for (const { pattern, tool } of toolPatterns) {
      if (pattern.test(content)) tools.push(tool)
    }
    return [...new Set(tools)]
  }
}
