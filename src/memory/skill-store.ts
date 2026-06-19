import { type SkillDefinition, type SkillStep, type SkillMeta, createSkillDefinition, inspectSkill, serializeSkill, deserializeSkill } from "./skill-format.js"
import { createMemoryEnvelope, parseMemoryEnvelope } from "./schema-version.js"
import { STOP_WORDS } from "./stopwords.js"

export { type SkillDefinition, type SkillStep, type SkillMeta, inspectSkill, serializeSkill, deserializeSkill, createSkillDefinition }

export interface SkillRecord {
  definition: SkillDefinition
  usageCount: number
  successRate: number
  successWindow: boolean[]  // sliding window of last N outcomes (true=success)
  lastUsed: string
}

// Action verb prefixes for step validation — filters non-action lines
const ACTION_VERBS = new Set([
  "create", "add", "implement", "build", "write", "develop", "refactor",
  "delete", "remove", "modify", "update", "edit", "change", "fix", "patch",
  "rename", "move", "extract", "migrate", "upgrade", "downgrade",
  "research", "search", "find", "analyze", "investigate", "diagnose",
  "test", "verify", "check", "validate", "review", "audit", "inspect",
  "run", "execute", "deploy", "publish", "release", "build",
  "plan", "design", "architect", "configure", "setup", "install",
  "learn", "study", "document", "comment", "annotate",
  "configure", "optimize", "refine", "improve", "enhance",
  "merge", "rebase", "commit", "push", "pull",
  "connect", "integrate", "wrap", "expose", "export", "import",
  // Indonesian action verbs
  "menambahkan", "membuat", "memperbaiki", "menghapus", "mengubah",
  "memodifikasi", "mengimplementasi", "menguji", "memverifikasi",
  "merencanakan", "mendesain", "menulis", "membangun", "menjalankan",
])

// Success markers in multiple languages
const SUCCESS_MARKERS = ["✅", "✓", "✔", "success", "completed", "done", "finish",
  "selesai", "sukses", "berhasil"]

// Completion context markers
const COMPLETION_MARKERS = ["step", "langkah", "task", "tugas", "phase", "fase",
  "iteration", "iterasi", "milestone"]

/** Minimum content length to qualify as extractable (avoids trivial noise) */
const MIN_EXTRACT_CONTENT_LENGTH = 60

/** Sliding window size for success rate calculation */
const SUCCESS_WINDOW_SIZE = 20

export class SkillStore {
  private skills = new Map<string, SkillRecord>()

  /** Normalize text for search: lowercase, remove special chars */
  private static normalize(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()
  }

  /** Check if text contains action-oriented language */
  private hasActionWords(text: string): boolean {
    const lower = text.toLowerCase()
    let actionCount = 0
    for (const verb of ACTION_VERBS) {
      const regex = new RegExp(`\\b${verb}\\b`, "i")
      if (regex.test(lower)) {
        actionCount++
        if (actionCount >= 2) return true  // at least 2 action verbs needed
      }
    }
    return actionCount >= 1 && text.length >= MIN_EXTRACT_CONTENT_LENGTH
  }

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
      // Sliding window success rate: push new success, cap at window size
      existing.successWindow.push(true)
      if (existing.successWindow.length > SUCCESS_WINDOW_SIZE) {
        existing.successWindow = existing.successWindow.slice(-SUCCESS_WINDOW_SIZE)
      }
      const winSuccesses = existing.successWindow.filter(Boolean).length
      existing.successRate = existing.successWindow.length > 0
        ? winSuccesses / existing.successWindow.length
        : 1.0
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
      successWindow: [true],  // first usage was a success
      lastUsed: new Date().toISOString(),
    }

    this.skills.set(def.meta.id, record)
    return record
  }

  find(query: string): SkillRecord[] {
    const q = SkillStore.normalize(query)
    const qTokens = new Set(q.split(/\s+/).filter(t => t.length > 2 && !STOP_WORDS.has(t)))
    if (qTokens.size === 0) {
      // Fallback to original substring search if all query words are stop words
      return [...this.skills.values()]
        .filter(s =>
          s.definition.meta.name.toLowerCase().includes(q) ||
          s.definition.trigger.pattern.toLowerCase().includes(q) ||
          (s.definition.trigger.keywords ?? []).some(k => k.toLowerCase().includes(q))
        )
        .sort((a, b) => b.successRate - a.successRate)
        .slice(0, 5)
    }

    // TF-IDF-like relevance scoring
    const scored = [...this.skills.values()].map(s => {
      const name = SkillStore.normalize(s.definition.meta.name)
      const pattern = SkillStore.normalize(s.definition.trigger.pattern)
      const keywords = (s.definition.trigger.keywords ?? []).map(k => k.toLowerCase())

      let relevance = 0
      const allText = [name, pattern, ...keywords].join(" ")
      const textTokens = new Set(allText.split(/\s+/).filter(t => t.length > 2 && !STOP_WORDS.has(t)))

      // Token overlap (TF component)
      let overlapCount = 0
      for (const qt of qTokens) {
        if (textTokens.has(qt)) overlapCount++
        // Also check substring in name (higher weight)
        if (name.includes(qt)) relevance += 3
        if (pattern.includes(qt)) relevance += 2
        for (const kw of keywords) {
          if (kw.includes(qt)) relevance += 1
        }
      }
      if (textTokens.size > 0) {
        relevance += overlapCount / Math.max(textTokens.size, 1) * 5  // TF score
      }

      // Recency bonus: skills used in last 7 days get +2
      const lastUsed = new Date(s.lastUsed).getTime()
      const daysSinceUse = (Date.now() - lastUsed) / 86400000
      if (daysSinceUse < 7) relevance += 2

      // Success rate bonus
      relevance += s.successRate * 3

      return { record: s, relevance }
    })
      .filter(s => s.relevance > 0)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, 5)
      .map(s => s.record)

    return scored
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
    // Sliding window: push failure, cap at window size
    record.successWindow.push(false)
    if (record.successWindow.length > SUCCESS_WINDOW_SIZE) {
      record.successWindow = record.successWindow.slice(-SUCCESS_WINDOW_SIZE)
    }
    const winSuccesses = record.successWindow.filter(Boolean).length
    record.successRate = record.successWindow.length > 0
      ? winSuccesses / record.successWindow.length
      : 0
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

    // Initialize sliding window from successRate (approximate window)
    const winSize = Math.min(SUCCESS_WINDOW_SIZE, Math.max(1, parsed.data.quality.usageCount))
    const winSuccesses = Math.round(winSize * parsed.data.quality.successRate)
    const successWindow: boolean[] = []
    for (let i = 0; i < winSuccesses; i++) successWindow.push(true)
    for (let i = winSuccesses; i < winSize; i++) successWindow.push(false)

    this.skills.set(parsed.data.meta.id, {
      definition: parsed.data,
      usageCount: parsed.data.quality.usageCount,
      successRate: parsed.data.quality.successRate,
      successWindow,
      lastUsed: parsed.data.audit.lastUsed,
    })
    return true
  }

  private isExtractablePattern(content: string): boolean {
    if (content.length < MIN_EXTRACT_CONTENT_LENGTH) return false

    const lower = content.toLowerCase()

    // Must have at least one success indicator
    const hasSuccess = SUCCESS_MARKERS.some(m => lower.includes(m))
    if (!hasSuccess) return false

    // Must have at least one completion context marker
    const hasCompletion = COMPLETION_MARKERS.some(m => lower.includes(m))
    if (!hasCompletion) return false

    // Must have action-oriented content (semantic gate against false positives)
    if (!this.hasActionWords(content)) return false

    return true
  }

  private extractName(content: string): string | null {
    const patterns = [
      // English action patterns
      /(?:Created|Added|Implemented|Built|Fixed|Refactored|Removed|Updated)\s+(?:the\s+)?(.{3,80}?)(?:\.|$)/i,
      /Step\s+\w+:\s*(.{3,80}?)(?:\.|$)/i,
      /Completed\s+(.{3,80}?)(?:\.|$)/i,
      // Indonesian patterns
      /(?:Menambahkan|Membuat|Memperbaiki|Menghapus|Mengubah|Mengimplementasi)\s+(.{3,80}?)(?:\.|$)/i,
      /Selesai\s+(.+?)(?:\.|$)/i,
      // Generic action pattern (last resort)
      /✅\s*(?:Step\s+\w+[:\-]?\s*)?(.{5,80}?)(?:\.|$)/i,
    ]
    for (const p of patterns) {
      const m = content.match(p)
      if (m) {
        const name = m[1].trim().slice(0, 60)
        // Skip non-informative names
        if (name.length >= 5 &&
            !STOP_WORDS.has(name.toLowerCase()) &&
            !/^(the|a|an)\s/.test(name.toLowerCase()) &&
            !/^\d+$/.test(name)) {
          return name
        }
      }
    }
    return null
  }

  private extractSteps(content: string): string[] {
    const steps: string[] = []
    const seen = new Set<string>()
    const lines = content.split("\n")

    for (const line of lines) {
      const trimmed = line.trim()

      // Skip markdown headers, code blocks, empty lines
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("```") || trimmed.startsWith(">")) continue

      let stepText: string | null = null
      const mNum = trimmed.match(/^\d+[.)]\s+(.+)/)
      if (mNum) stepText = mNum[1].trim()
      const mDash = trimmed.match(/^[-*]\s+(.+)/)
      if (mDash) stepText = mDash[1].trim()

      if (stepText && stepText.length > 5) {
        // Deduplicate by normalized content
        const normalized = SkillStore.normalize(stepText)
        const key = normalized.slice(0, 40)
        if (!seen.has(key)) {
          seen.add(key)
          // Only include if it has action-oriented language
          const lower = stepText.toLowerCase()
          const hasAction = [...ACTION_VERBS].some(v => {
            const regex = new RegExp(`\\b${v}\\b`, "i")
            return regex.test(lower)
          })
          if (hasAction || stepText.length > 20) {
            steps.push(stepText)
          }
        }
      }
    }

    return steps
  }

  private extractPattern(content: string): string {
    const words = content.match(/\b(\w{4,})\b/g) ?? []
    const significant = words.filter(w => w.length >= 4 && !STOP_WORDS.has(w.toLowerCase()))
    return [...new Set(significant)].slice(0, 5).join(" ")
  }

  private extractKeywords(content: string): string[] {
    const words = content.match(/\b(\w{4,})\b/g) ?? []
    const filtered = words.filter(w => {
      const lower = w.toLowerCase()
      return lower.length >= 4 && !STOP_WORDS.has(lower) && !ACTION_VERBS.has(lower)
    })
    // Sort by frequency (most common first) then deduplicate
    const freq = new Map<string, number>()
    for (const w of filtered) freq.set(w, (freq.get(w) ?? 0) + 1)
    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([word]) => word.toLowerCase())
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
