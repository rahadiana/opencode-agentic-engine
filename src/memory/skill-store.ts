import { type SkillDefinition, type SkillStep, type SkillMeta, createSkillDefinition, inspectSkill, serializeSkill, deserializeSkill } from "./skill-format.js"
import { createMemoryEnvelope, parseMemoryEnvelope } from "./schema-version.js"

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

  importFromEnvelope(obj: unknown): boolean {
    const envelope = typeof obj === "string" ? JSON.parse(obj) : obj
    const parsed = parseMemoryEnvelope<SkillDefinition>(envelope)
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
      /(?:Created|Added|Implemented|Built|Fixed)\s+(?:the\s+)?(.{3,60}?)(?:\.|$)/i,
      /Step\s+\w+:\s*(.+?)(?:\.|$)/i,
      /Completed\s+(.+?)(?:\.|$)/i,
    ]
    for (const p of patterns) {
      const m = content.match(p)
      if (m) {
        const name = m[1].trim().slice(0, 50)
        if (name.length >= 3) return name
      }
    }
    return null
  }

  private extractSteps(content: string): string[] {
    const steps: string[] = []
    const lines = content.split("\n")
    for (const line of lines) {
      const mNum = line.match(/^\d+[.)]\s+(.+)/)
      if (mNum) { steps.push(mNum[1].trim()); continue }
      const mDash = line.match(/^[-*]\s+(.+)/)
      if (mDash) { steps.push(mDash[1].trim()); continue }
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
    if (lower.includes("create") || lower.includes("add") || lower.includes("write") || lower.includes("build") || lower.includes("develop")) return "create"
    if (lower.includes("delete") || lower.includes("remove") || lower.includes("hapus")) return "delete"
    if (lower.includes("modify") || lower.includes("update") || lower.includes("edit") || lower.includes("change") || lower.includes("ubah")) return "modify"
    if (lower.includes("research") || lower.includes("cari") || lower.includes("search") || lower.includes("find")) return "research"
    if (lower.includes("test") || lower.includes("verify") || lower.includes("check") || lower.includes("cek")) return "verify"
    if (lower.includes("run") || lower.includes("exec") || lower.includes("execute") || lower.includes("jalankan")) return "execute"
    if (lower.includes("review") || lower.includes("audit") || lower.includes("inspect") || lower.includes("review")) return "review"
    if (lower.includes("plan") || lower.includes("rencana") || lower.includes("design") || lower.includes("desain")) return "plan"
    if (lower.includes("learn") || lower.includes("belajar") || lower.includes("study") || lower.includes("pelajari")) return "learn"
    return "execute"
  }

  private inferToolForStep(stepDesc: string): string | undefined {
    const lower = stepDesc.toLowerCase()
    if (lower.includes("search") || lower.includes("cari") || lower.includes("find") || lower.includes("lookup")) return "agentic_nav"
    if (lower.includes("plan") || lower.includes("rencana") || lower.includes("design")) return "agentic_plan"
    if (lower.includes("execute") || lower.includes("run") || lower.includes("jalankan")) return "agentic_execute"
    if (lower.includes("verify") || lower.includes("test") || lower.includes("check")) return "agentic_verify"
    if (lower.includes("delegate") || lower.includes("assign")) return "agentic_delegate"
    if (lower.includes("reflect") || lower.includes("analyz")) return "agentic_reflect"
    if (lower.includes("message") || lower.includes("send")) return "agentic_message"
    if (lower.includes("snapshot") || lower.includes("checkpoint")) return "agentic_snapshot"
    if (lower.includes("debate") || lower.includes("review")) return "agentic_debate"
    return undefined
  }

  private inferTools(content: string): string[] {
    const lower = content.toLowerCase()
    const tools: string[] = []
    if (lower.includes("search") || lower.includes("find")) tools.push("agentic_nav")
    if (lower.includes("plan")) tools.push("agentic_plan")
    if (lower.includes("execute") || lower.includes("implement")) tools.push("agentic_execute")
    if (lower.includes("test") || lower.includes("verify")) tools.push("agentic_verify")
    if (lower.includes("delegate")) tools.push("agentic_delegate")
    if (lower.includes("message")) tools.push("agentic_message")
    return [...new Set(tools)]
  }
}
