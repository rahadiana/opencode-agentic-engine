import { type SkillDefinition, type SkillStep, type SkillMeta, createSkillDefinition, inspectSkill, serializeSkill, deserializeSkill } from "./skill-format.js"
import { createMemoryEnvelope, parseMemoryEnvelope } from "./schema-version.js"
import { STOP_WORDS } from "./stopwords.js"
import { SkillExtractor, normalize } from "./skill-extractor.js"
import type { VectorStore, TfIdfDoc } from "./vector-store.js"

export { type SkillDefinition, type SkillStep, type SkillMeta, inspectSkill, serializeSkill, deserializeSkill, createSkillDefinition }

export type SkillLifecycleStage = "raw" | "validated" | "compiled" | "evolved"

export interface MaturationCriteria {
  minUsageCount: number
  minSuccessRate: number
}

import type { ProvenanceInfo, TrustLevel } from "./skill-security.js"

export interface SkillRecord {
  definition: SkillDefinition
  usageCount: number
  successRate: number
  successWindow: boolean[]  // sliding window of last N outcomes (true=success)
  lastUsed: string
  lifecycle?: SkillLifecycleStage
  /** Provenance & trust information (for imported skills) */
  provenance?: ProvenanceInfo
}

/** Sliding window size for success rate calculation */
const SUCCESS_WINDOW_SIZE = 20

export class SkillStore {
  private skills = new Map<string, SkillRecord>()
  private skillExtractor = new SkillExtractor()

  async extract(turn: { role: string; content: string }, contextTags: string[] = []): Promise<SkillRecord | null> {
    const content = turn.content

    const extracted = this.skillExtractor.extract(content)
    if (!extracted) return null

    const { name, steps, pattern, keywords, tools, capability } = extracted

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
      pattern,
      keywords,
      steps.map((s, i) => ({
        action: this.skillExtractor.inferAction(s),
        description: s,
        tool: tools[i] ?? this.skillExtractor.inferToolForStep(s),
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
    const q = normalize(query)
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
      const name = normalize(s.definition.meta.name)
      const pattern = normalize(s.definition.trigger.pattern)
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

  importFromEnvelope(obj: unknown, provenance?: import("./skill-security.js").ProvenanceInfo): boolean {
    const envelope = typeof obj === "string" ? JSON.parse(obj) : obj
    const parsed = parseMemoryEnvelope<SkillDefinition>(envelope)
    if (!parsed || parsed.type !== "skill") return false

    const existing = this.skills.get(parsed.data.meta.id)
    if (existing) {
      existing.definition = parsed.data
      existing.usageCount = parsed.data.quality.usageCount
      existing.successRate = parsed.data.quality.successRate
      existing.lastUsed = parsed.data.audit.lastUsed
      if (provenance) existing.provenance = provenance
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
      ...(provenance ? { provenance } : {}),
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
   * Directly record a SkillDefinition into the store.
   * Wraps it in a SkillRecord with default tracking metadata.
   * Returns the created SkillRecord, or updates existing if skill with same ID exists.
   */
  record(definition: SkillDefinition): SkillRecord {
    const existing = this.skills.get(definition.meta.id)
    if (existing) {
      existing.definition = definition
      existing.usageCount++
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
      return existing
    }

    const record: SkillRecord = {
      definition,
      usageCount: 1,
      successRate: 1.0,
      successWindow: [true],
      lastUsed: new Date().toISOString(),
    }
    this.skills.set(definition.meta.id, record)
    return record
  }

  /**
   * Get count of skills in store.
   */
  get size(): number {
    return this.skills.size
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

  /** Tracks which skill IDs have been indexed into the VectorStore */
  private vectorIndexed = new Set<string>()

  /**
   * Find skills using vector similarity search with capability-aware re-ranking.
   *
   * Re-ranking formula: `(vectorSim * 0.7) + (skillSuccessRate * 0.3)`
   * If no results meet the threshold, falls back to keyword-based find().
   *
   * Skills are lazily indexed into the vector store on first call.
   */
  findWithVectors(query: string, vectorStore: VectorStore, threshold = 0.75): SkillRecord[] {
    // ── Lazy index all skills not yet in vector store ──
    for (const [id, record] of this.skills) {
      if (this.vectorIndexed.has(id)) continue
      const def = record.definition
      const doc: TfIdfDoc = {
        id,
        category: "skill",
        title: def.meta.name,
        content: [
          def.workflow.steps.map(s => s.description).join(". "),
          def.workflow.steps.map(s => s.expectedOutput).join(". "),
          def.workflow.steps.map(s => s.action).join(" "),
          def.trigger.pattern,
          ...(def.trigger.keywords ?? []),
        ].join(" "),
        keywords: [
          def.meta.name,
          ...(def.trigger.keywords ?? []),
        ].filter(Boolean),
        metadata: { skillId: id },
      }
      vectorStore.index(doc)
      this.vectorIndexed.add(id)
    }

    // ── Vector search ──
    const vectorResults = vectorStore.searchAll(query, 10)
    if (vectorResults.length === 0) return this.find(query)

    // ── Re-rank with formula: (sim * 0.7) + (skillScore * 0.3) ──
    const ranked: Array<{ record: SkillRecord; score: number }> = []

    for (const vr of vectorResults) {
      const skillId = vr.doc.metadata?.skillId as string | undefined
      if (!skillId) continue
      const record = this.skills.get(skillId)
      if (!record) continue

      // Normalize vector similarity to 0-1 range (TF-IDF scores vary)
      const rawSim = vr.score
      const normalizedSim = Math.min(1, rawSim / 10)

      // Re-ranking formula from Comparison 09
      const rerankScore = (normalizedSim * 0.7) + (record.successRate * 0.3)

      ranked.push({ record, score: rerankScore })
    }

    if (ranked.length === 0) return this.find(query)

    // Sort by re-ranked score descending
    ranked.sort((a, b) => b.score - a.score)

    // Threshold: if best score >= threshold → return vector results
    if (ranked[0].score >= threshold) {
      return ranked.slice(0, 5).map(r => r.record)
    }

    // Below threshold: fallback to keyword search
    return this.find(query)
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

  // ── Skill Lifecycle (Phase 4A) ─────────────────────────────────

  /** Lifecycle stages with their maturation criteria */
  private static readonly LIFECYCLE_ORDER: SkillLifecycleStage[] = ["raw", "validated", "compiled", "evolved"]

  private static readonly MATURATION_CRITERIA: Record<string, MaturationCriteria> = {
    raw:       { minUsageCount: 3,  minSuccessRate: 0.7 },
    validated: { minUsageCount: 10, minSuccessRate: 0.85 },
    compiled:  { minUsageCount: 25, minSuccessRate: 0.95 },
    evolved:   { minUsageCount: Infinity, minSuccessRate: Infinity }, // terminal stage
  }

  /** Get the lifecycle stage of a skill */
  /** Delete all skills from the store. Returns count of removed skills. */
  clearAll(): number {
    const count = this.skills.size
    this.skills.clear()
    return count
  }

  getLifecycle(skillId: string): SkillLifecycleStage {
    const record = this.skills.get(skillId)
    return record?.lifecycle ?? "raw"
  }

  /** Get the next lifecycle stage, or null if at terminal stage */
  getNextStage(skillId: string): SkillLifecycleStage | null {
    const current = this.getLifecycle(skillId)
    const idx = SkillStore.LIFECYCLE_ORDER.indexOf(current)
    if (idx < 0 || idx >= SkillStore.LIFECYCLE_ORDER.length - 1) return null
    return SkillStore.LIFECYCLE_ORDER[idx + 1]
  }

  /** Check if a skill meets criteria to advance to the next lifecycle stage */
  canMature(skillId: string): boolean {
    const current = this.getLifecycle(skillId)
    const next = this.getNextStage(skillId)
    if (!next) return false
    const criteria = SkillStore.MATURATION_CRITERIA[current]
    const record = this.skills.get(skillId)
    if (!record) return false
    return record.usageCount >= criteria.minUsageCount && record.successRate >= criteria.minSuccessRate
  }

  /** Advance a skill to the next lifecycle stage if criteria are met */
  mature(skillId: string): SkillLifecycleStage | null {
    if (!this.canMature(skillId)) return this.getLifecycle(skillId)
    const next = this.getNextStage(skillId)
    if (!next) return null
    const record = this.skills.get(skillId)
    if (record) {
      record.lifecycle = next
      record.definition.audit.lastModified = new Date().toISOString()
    }
    return next
  }

  /** Auto-mature all eligible skills in bulk. Returns count of promotions per stage. */
  autoMature(): Record<string, number> {
    const summary: Record<string, number> = {}
    for (const [id, record] of this.skills) {
      const before = record.lifecycle ?? "raw"
      const after = this.mature(id)
      if (after && after !== before) {
        summary[`${before}->${after}`] = (summary[`${before}->${after}`] ?? 0) + 1
      }
    }
    return summary
  }

  /** Get lifecycle distribution statistics */
  getLifecycleStats(): { raw: number; validated: number; compiled: number; evolved: number } {
    const stats = { raw: 0, validated: 0, compiled: 0, evolved: 0 }
    for (const record of this.skills.values()) {
      const stage = record.lifecycle ?? "raw"
      stats[stage]++
    }
    return stats
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
