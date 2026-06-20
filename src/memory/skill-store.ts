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
    const capability = this.inferCapability(name, keywords)

    // Check if a skill with same capability exists (for versioning)
    let parentId: string | undefined
    if (capability) {
      const existingWithCap = this.findByCapability(capability)
      if (existingWithCap) {
        parentId = existingWithCap.definition.meta.id
      }
    }

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
      "agent",
      { capability },
    )

    // Set parentId for version lineage
    if (parentId) {
      def.meta.parentId = parentId
    }

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

  /**
   * Exact-match capability lookup (deterministic).
   * Returns the skill with the exact capability string (best version by successRate), or null.
   */
  findByCapability(capability: string): SkillRecord | undefined {
    const q = capability.toLowerCase().trim()
    const matches = [...this.skills.values()].filter(
      s => s.definition.trigger.capability?.toLowerCase().trim() === q
    )
    if (matches.length === 0) return undefined
    // Return best version (highest successRate)
    return matches.sort((a, b) => b.successRate - a.successRate)[0]
  }

  /**
   * Find all versions of a skill by capability (version lineage).
   * Returns all skills with the given capability, sorted by version descending.
   */
  findAllVersions(capability: string): SkillRecord[] {
    const q = capability.toLowerCase().trim()
    return [...this.skills.values()]
      .filter(s => s.definition.trigger.capability?.toLowerCase().trim() === q)
      .sort((a, b) => (b.definition.meta.version ?? 0) - (a.definition.meta.version ?? 0))
  }

  /**
   * Infer capability from skill name and keywords.
   * Converts common patterns to capability strings (e.g. "create user" → "user.create").
   */
  private inferCapability(name: string, keywords: string[]): string | undefined {
    const lower = name.toLowerCase().trim()
    // If name itself looks like a capability (contains "."), use it directly
    if (lower.includes(".")) return lower
    // Common verb-noun patterns
    const verbPatterns = [
      { regex: /^(create|add|make|build|generate)\s+(.+)/i, prefix: (v: string, n: string) => `${n.toLowerCase().replace(/\s+/g, ".")}.${v.toLowerCase()}` },
      { regex: /^(get|find|search|fetch|retrieve|read)\s+(.+)/i, prefix: (v: string, n: string) => `${n.toLowerCase().replace(/\s+/g, ".")}.${v.toLowerCase()}` },
      { regex: /^(update|edit|modify|change|set)\s+(.+)/i, prefix: (v: string, n: string) => `${n.toLowerCase().replace(/\s+/g, ".")}.${v.toLowerCase()}` },
      { regex: /^(delete|remove|destroy|clear)\s+(.+)/i, prefix: (v: string, n: string) => `${n.toLowerCase().replace(/\s+/g, ".")}.${v.toLowerCase()}` },
    ]
    for (const pattern of verbPatterns) {
      const match = lower.match(pattern.regex)
      if (match) {
        return pattern.prefix(match[1], match[2])
      }
    }
    // Check keywords for known domain prefixes
    for (const kw of keywords) {
      const kwLower = kw.toLowerCase()
      if (kwLower.includes("auth") || kwLower.includes("login") || kwLower.includes("user")) return "auth." + lower.replace(/\s+/g, "_")
      if (kwLower.includes("db") || kwLower.includes("database") || kwLower.includes("migrate")) return "db." + lower.replace(/\s+/g, "_")
      if (kwLower.includes("api") || kwLower.includes("endpoint") || kwLower.includes("route")) return "api." + lower.replace(/\s+/g, "_")
      if (kwLower.includes("test") || kwLower.includes("spec") || kwLower.includes("assert")) return "test." + lower.replace(/\s+/g, "_")
      if (kwLower.includes("deploy") || kwLower.includes("ci") || kwLower.includes("build")) return "deploy." + lower.replace(/\s+/g, "_")
    }
    return undefined
  }

  /**
   * Calculate freshness score based on days since last use.
   * Formula: exp(-0.05 * daysIdle)
   * Returns 0.0-1.0, higher = more recently used.
   */
  private freshnessScore(lastUsed: string): number {
    const daysSinceUse = (Date.now() - new Date(lastUsed).getTime()) / 86400000
    return Math.exp(-0.05 * daysSinceUse)
  }

  /**
   * Calculate combined score for ranking skills.
   * Formula: (similarity * 0.6) + (score * 0.3) + (freshness * 0.1)
   * All inputs normalized to 0.0-1.0 range.
   */
  private combinedScore(similarity: number, successRate: number, lastUsed: string): number {
    const freshness = this.freshnessScore(lastUsed)
    return (similarity * 0.6) + (successRate * 0.3) + (freshness * 0.1)
  }

  find(query: string): SkillRecord[] {
    const q = SkillStore.normalize(query)
    const qTokens = new Set(q.split(/\s+/).filter(t => t.length > 2 && !STOP_WORDS.has(t)))
    if (qTokens.size === 0) {
      // Fallback to combined-score-based substring search if all query words are stop words
      return [...this.skills.values()]
        .filter(s =>
          s.definition.meta.name.toLowerCase().includes(q) ||
          s.definition.trigger.pattern.toLowerCase().includes(q) ||
          (s.definition.trigger.keywords ?? []).some(k => k.toLowerCase().includes(q))
        )
        .map(s => ({ record: s, score: this.combinedScore(0.5, s.successRate, s.lastUsed) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map(s => s.record)
    }

    const scored = [...this.skills.values()].map(s => {
      const name = SkillStore.normalize(s.definition.meta.name)
      const pattern = SkillStore.normalize(s.definition.trigger.pattern)
      const keywords = (s.definition.trigger.keywords ?? []).map(k => k.toLowerCase())

      let rawRelevance = 0
      const allText = [name, pattern, ...keywords].join(" ")
      const textTokens = new Set(allText.split(/\s+/).filter(t => t.length > 2 && !STOP_WORDS.has(t)))

      // Token overlap (TF component)
      let overlapCount = 0
      for (const qt of qTokens) {
        if (textTokens.has(qt)) overlapCount++
        if (name.includes(qt)) rawRelevance += 3
        if (pattern.includes(qt)) rawRelevance += 2
        for (const kw of keywords) {
          if (kw.includes(qt)) rawRelevance += 1
        }
      }
      if (textTokens.size > 0) {
        rawRelevance += overlapCount / Math.max(textTokens.size, 1) * 5
      }

      const hasTextMatch = overlapCount > 0 || rawRelevance > 0
      if (!hasTextMatch) return { record: s, score: 0 }

      // Normalize similarity to 0.0-1.0 (rawRelevance max ~10-15 empirically)
      const similarity = Math.min(1, rawRelevance / 12)
      const score = this.combinedScore(similarity, s.successRate, s.lastUsed)

      return { record: s, score }
    })
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
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

  /**
   * Reinforcement learning: update skill score after each execution.
   * Formula: newScore = (oldScore * 0.7) + (successRate * 0.3)
   * This creates a weighted moving average that smooths volatility.
   */
  reinforce(skillId: string, latestSuccess: boolean): boolean {
    const record = this.skills.get(skillId)
    if (!record) return false

    // Update sliding window
    record.successWindow.push(latestSuccess)
    if (record.successWindow.length > SUCCESS_WINDOW_SIZE) {
      record.successWindow = record.successWindow.slice(-SUCCESS_WINDOW_SIZE)
    }
    const winSuccesses = record.successWindow.filter(Boolean).length
    const currentSuccessRate = record.successWindow.length > 0
      ? winSuccesses / record.successWindow.length
      : 1.0

    // Reinforcement formula: weighted moving average
    const oldScore = record.successRate
    record.successRate = (oldScore * 0.7) + (currentSuccessRate * 0.3)

    record.usageCount++
    record.lastUsed = new Date().toISOString()
    record.definition.quality.successRate = record.successRate
    record.definition.quality.usageCount = record.usageCount
    record.definition.audit.lastUsed = record.lastUsed
    record.definition.audit.lastModified = record.lastUsed
    return true
  }

  /**
   * Apply decay to all skills based on idle time.
   * Formula: score *= exp(-0.05 * daysIdle)
   * Skills unused for many days will have their score gradually decrease.
   */
  decayAll(): { decayed: number } {
    const now = Date.now()
    let decayed = 0

    for (const [, record] of this.skills.entries()) {
      const lastUsed = new Date(record.lastUsed).getTime()
      const daysIdle = (now - lastUsed) / 86400000

      if (daysIdle > 0) {
        const decay = Math.exp(-0.05 * daysIdle)
        const oldRate = record.successRate
        record.successRate = Math.max(0.01, Math.min(1, oldRate * decay))
        record.definition.quality.successRate = record.successRate
        if (record.successRate < oldRate) decayed++
      }
    }

    return { decayed }
  }

  /**
   * Prune low-quality skills based on success rate and usage.
   * Removes skills with (successRate < minScore AND usageCount < minUsage).
   * Returns IDs of pruned skills.
   */
  prune(minScore = 0.3, minUsage = 3): string[] {
    const pruned: string[] = []
    for (const [id, record] of this.skills.entries()) {
      if (record.successRate < minScore && record.usageCount < minUsage) {
        this.skills.delete(id)
        pruned.push(id)
      }
    }
    return pruned
  }

  /**
   * Get count of skills in store.
   */
  get size(): number {
    return this.skills.size
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

  // ── Bandit Mutation ──────────────────────────────────────────────

  private readonly BANDIT_C = 2.0
  private readonly EXPLORATION_RATE = 0.2
  private readonly MAX_MUTATIONS_PER_SKILL = 3
  private readonly MAX_TOTAL_VARIANTS = 50

  ucb1Score(record: SkillRecord, c = this.BANDIT_C): number {
    const totalSelections = this.skills.size + 1
    const usage = record.usageCount + 1
    const exploitation = record.successRate
    const exploration = c * Math.sqrt(Math.log(totalSelections) / usage)
    return Math.min(1, exploitation + exploration)
  }

  findWithBandit(query: string): SkillRecord[] {
    const baseResults = this.find(query)
    if (baseResults.length === 0) return baseResults

    if (Math.random() < this.EXPLORATION_RATE && baseResults.length > 1) {
      const ucbRanked = baseResults
        .map(s => ({ record: s, score: this.ucb1Score(s) }))
        .sort((a, b) => b.score - a.score)
      const pool = ucbRanked.slice(0, 3)
      const totalScore = pool.reduce((sum, s) => sum + s.score, 0)
      if (totalScore > 0) {
        let rand = Math.random() * totalScore
        for (const item of pool) {
          rand -= item.score
          if (rand <= 0) return [item.record]
        }
      }
    }

    return baseResults
  }

  private countVariants(): number {
    let count = 0
    for (const [, record] of this.skills) {
      if (record.definition.meta.parentId) count++
    }
    return count
  }

  mutateSkill(skillId: string): string | null {
    const parent = this.skills.get(skillId)
    if (!parent) return null

    const mutationCount = [...this.skills.values()]
      .filter(s => s.definition.meta.parentId === skillId).length
    if (mutationCount >= this.MAX_MUTATIONS_PER_SKILL) return null

    if (this.countVariants() >= this.MAX_TOTAL_VARIANTS) return null

    const parentDef = parent.definition
    const steps = parentDef.workflow.steps

    let variantSteps: SkillStep[]
    if (steps.length <= 2) {
      variantSteps = [...steps]
    } else if (steps.length === 3) {
      variantSteps = [
        {
          order: 1,
          action: "execute",
          description: `${steps[0].description}; ${steps[1].description}`,
          expectedOutput: `Combined: ${steps[0].expectedOutput} and ${steps[1].expectedOutput}`,
        },
        { ...steps[2], order: 2 },
      ]
    } else {
      variantSteps = [
        {
          order: 1,
          action: "execute",
          description: `${steps[0].description}; ${steps[1].description}`,
          expectedOutput: `Combined: ${steps[0].expectedOutput} and ${steps[1].expectedOutput}`,
        },
        ...steps.slice(-2).map((s, i) => ({ ...s, order: i + 2 })),
      ]
    }

    const now = new Date().toISOString()
    const variantId = `variant-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

    const variantDef: SkillDefinition = {
      ...parentDef,
      meta: {
        ...parentDef.meta,
        id: variantId,
        name: `${parentDef.meta.name} (variant)`,
        version: (parentDef.meta.version || 1) + 1,
        parentId: skillId,
      },
      workflow: {
        ...parentDef.workflow,
        steps: variantSteps,
        estimatedDuration: `${variantSteps.length * 2}m`,
      },
      quality: {
        successRate: parent.definition.quality?.successRate ?? parent.successRate,
        usageCount: 0,
        failureScenarios: [],
      },
      audit: {
        createdAt: now,
        lastUsed: now,
        lastModified: now,
        modifiedBy: "bandit-mutation",
      },
    }

    const variantRecord: SkillRecord = {
      definition: variantDef,
      usageCount: 0,
      successRate: parent.successRate * 0.9,
      successWindow: parent.successWindow.length > 0
        ? [parent.successWindow.filter(Boolean).length > parent.successWindow.length / 2]
        : [true],
      lastUsed: now,
    }

    this.skills.set(variantId, variantRecord)
    return variantId
  }

  evaluateMutation(mutationId: string, parentId: string): boolean {
    const mutation = this.skills.get(mutationId)
    const parent = this.skills.get(parentId)
    if (!mutation || !parent) return false

    const mutationScore = this.ucb1Score(mutation)
    const parentScore = this.ucb1Score(parent)

    if (mutationScore > parentScore + 0.05) {
      parent.successRate = Math.max(parent.successRate, mutation.successRate)
      parent.definition.quality.successRate = parent.successRate
      parent.definition.audit.lastModified = new Date().toISOString()
      this.skills.delete(mutationId)
      return true
    }

    return false
  }
}
