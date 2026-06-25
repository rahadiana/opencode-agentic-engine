/**
 * Memory Orchestrator — Unified hierarchical memory.
 *
 * Prinsip 6 (Memory Agnostic): working → episodic → semantic → procedural.
 * Consolidation otomatis antar level, importance-based forgetting, cross-level query.
 *
 * Dari riset:
 * - Auton (arXiv:2602.23720): Hierarchical memory consolidation
 * - STEM Agent (arXiv:2603.22359): 4-type memory + consolidation
 * - OpenSage (arXiv:2602.16891): Graph-based hierarchical memory
 */

import { SessionStore, type SessionState } from "./session-store.js"
import { EpisodicStore, type Episode } from "./episodic-store.js"
import { SkillStore } from "./skill-store.js"
import { VectorStore } from "./vector-store.js"
import { createSkillDefinition } from "./skill-format.js"
import type { WorldModel } from "../core/world-model.js"
import type { SimulationEngine } from "../core/simulation-engine.js"
import type { SimulationInput } from "../core/simulation-engine.js"

// ── Types ──────────────────────────────────────────────────────────

export type MemoryLevel = "working" | "episodic" | "semantic" | "procedural"

export interface MemoryEntry {
  id: string
  level: MemoryLevel
  content: string
  keywords: string[]
  importance: number    // 0.0 – 1.0
  createdAt: number
  lastAccessed: number
  accessCount: number
  sourceSession?: string
  metadata?: Record<string, unknown>
}

export interface MemoryQuery {
  query: string
  levels?: MemoryLevel[]
  maxResults?: number
  minImportance?: number
}

export interface MemoryQueryResult {
  entries: MemoryEntry[]
  totalTime: number
  sources: MemoryLevel[]
}

export interface ConsolidationReport {
  workingArchived: number
  episodicPruned: number
  semanticDeduplicated: number
  patternsExtracted: number
  /** New in Phase 3A: number of patterns auto-converted to SkillDefinitions */
  skillsConverted: number
  timestamp: number
}

// ── Constants ──────────────────────────────────────────────────────

const DEFAULT_MAX_IMPORTANCE_ENTRIES = 500
const IMPORTANCE_DECAY_PER_DAY = 0.99
const MIN_IMPORTANCE_FOR_SEMANTIC = 0.3
const MIN_EPISODIC_AGE_MS = 3600_000 // 1 jam sebelum bisa di-archive

// ── MemoryOrchestrator ─────────────────────────────────────────────

export class MemoryOrchestrator {
  private workingMem: SessionStore
  private episodicStore: EpisodicStore
  private skillStore: SkillStore
  private worldModel?: WorldModel
  private simulationEngine?: SimulationEngine

  /** Entries importance index: id → { importance, level, lastAccessed, accessCount } */
  private importanceIndex = new Map<string, {
    importance: number
    level: MemoryLevel
    lastAccessed: number
    accessCount: number
  }>()

  /** Semantic/procedural entries gak disimpan di session/episodic store — di sini */
  private semanticEntries: MemoryEntry[] = []
  private proceduralEntries: MemoryEntry[] = []

  private maxImportanceEntries: number

  constructor(
    workingMem: SessionStore,
    episodicStore: EpisodicStore,
    skillStore?: SkillStore,
    /** @internal reserved for future vector similarity search */
    _vectorStore?: VectorStore,
    maxImportanceEntries = DEFAULT_MAX_IMPORTANCE_ENTRIES,
    /** Phase 3B: WorldModel for entity/relation tracking */
    worldModel?: WorldModel,
    /** Phase 3B: SimulationEngine for skill sandbox verification */
    simulationEngine?: SimulationEngine,
  ) {
    this.workingMem = workingMem
    this.episodicStore = episodicStore
    this.skillStore = skillStore ?? new SkillStore()
    this.maxImportanceEntries = maxImportanceEntries
    this.worldModel = worldModel
    this.simulationEngine = simulationEngine
  }

  // ── Store ────────────────────────────────────────────────────────

  /** Store data at the appropriate memory level */
  store(level: MemoryLevel, data: {
    id: string
    content: string
    keywords?: string[]
    importance?: number
    sourceSession?: string
    metadata?: Record<string, unknown>
  }): void {
    const entry: MemoryEntry = {
      id: data.id,
      level,
      content: data.content,
      keywords: data.keywords ?? [],
      importance: data.importance ?? this.computeDefaultImportance(level),
      createdAt: Date.now(),
      lastAccessed: Date.now(),
      accessCount: 0,
      sourceSession: data.sourceSession,
      metadata: data.metadata,
    }

    switch (level) {
      case "working":
        // Working memory is handled by SessionStore — just index it
        break
      case "episodic":
        // Episodic memory tracks sessions — handled by EpisodicStore
        break
      case "semantic":
        this.semanticEntries.push(entry)
        break
      case "procedural":
        this.proceduralEntries.push(entry)
        break
    }

    this.indexImportance(entry.id, level, entry.importance)
  }

  // ── Query ────────────────────────────────────────────────────────

  /** Query across all (or selected) memory levels, ranked by relevance + importance */
  query(opts: MemoryQuery): MemoryQueryResult {
    const start = Date.now()
    const levels = opts.levels ?? ["working", "episodic", "semantic", "procedural"]
    const maxResults = opts.maxResults ?? 10
    const minImportance = opts.minImportance ?? 0
    const queryStr = opts.query.toLowerCase()

    const results: MemoryEntry[] = []

    for (const level of levels) {
      const entries = this.getEntriesByLevel(level)
      for (const entry of entries) {
        const imp = this.importanceIndex.get(entry.id)
        if (imp && imp.importance < minImportance) continue

        // Relevance scoring: keyword match + content match
        const relevance = this.scoreRelevance(entry, queryStr)
        if (relevance > 0) {
          results.push(entry)
          // Update access
          if (imp) {
            imp.lastAccessed = Date.now()
            imp.accessCount++
            entry.lastAccessed = Date.now()
            entry.accessCount++
          }
        }
      }
    }

    // Sort by (relevance + importance) descending
    results.sort((a, b) => {
      const scoreA = this.scoreRelevance(a, queryStr) + a.importance
      const scoreB = this.scoreRelevance(b, queryStr) + b.importance
      return scoreB - scoreA
    })

    const elapsed = Date.now() - start
    return {
      entries: results.slice(0, maxResults),
      totalTime: elapsed,
      sources: [...new Set(results.map(e => e.level))],
    }
  }

  // ── Consolidation ────────────────────────────────────────────────

  /**
   * Consolidate memory: archive working → episodic, prune episodic,
   * extract patterns episodic → semantic.
   * Returns report of what was done.
   */
  consolidate(sessions?: SessionState[]): ConsolidationReport {
    const report: ConsolidationReport = {
      workingArchived: 0,
      episodicPruned: 0,
      semanticDeduplicated: 0,
      patternsExtracted: 0,
      skillsConverted: 0,
      timestamp: Date.now(),
    }

    // 1. Working → Episodic: archive finished sessions
    if (sessions) {
      for (const session of sessions) {
        if (!session.plan || session.turns.length === 0) continue

        // Skip very recent sessions
        const lastTurn = session.turns[session.turns.length - 1]
        if (lastTurn && Date.now() - lastTurn.timestamp < MIN_EPISODIC_AGE_MS) continue

        // Archive ke episodic store (match EpisodicStore.record() API)
        const planGoal = session.plan?.intent?.goal ?? "unknown"
        const planSubtasks = session.plan?.intent?.subtasks?.map(s => s.description) ?? []

        // Cek duplikasi sebelum archive
        const existing = this.episodicStore.search(planGoal)
        if (existing.length === 0 || existing[0].planGoal !== planGoal) {
          this.episodicStore.record(
            session.sessionId,
            planGoal,
            "success",
            [],
            undefined,         // filesChanged
            session.currentDomain,
            undefined,         // projectId
            planSubtasks,      // plan
          )
          report.workingArchived++
        }
      }
    }

    // 2. Episodic → Prune: remove low-importance episodes
    const episodes = this.episodicStore.getAll()
    const now = Date.now()
    for (const ep of episodes) {
      const ageDays = (now - new Date(ep.timestamp).getTime()) / 86400_000
      // Decay importance: older + unused → lower
      const importance = ep.score * Math.pow(IMPORTANCE_DECAY_PER_DAY, ageDays) *
        (1 + 0.3 * Math.log2(ep.usageCount + 1))

      if (importance < 0.1 && ageDays > 7) {
        this.episodicStore.remove(ep.id)
        report.episodicPruned++
      }
    }

    // 3. Semantic: dedup entries with similar content
    const seen = new Set<string>()
    const deduped: MemoryEntry[] = []
    for (const entry of this.semanticEntries) {
      const key = entry.content.slice(0, 100).toLowerCase()
      if (seen.has(key)) {
        report.semanticDeduplicated++
        continue
      }
      seen.add(key)
      deduped.push(entry)
    }
    this.semanticEntries = deduped

    // 4. Extract patterns: episodic → semantic (keyword-based pattern extraction)
    const patternKeywords = [
      { pattern: /error|fail|timeout|crash/i, tag: "error_pattern" },
      { pattern: /refactor|rewrite|restruct/i, tag: "refactoring_pattern" },
      { pattern: /test|verify|assert/i, tag: "testing_pattern" },
      { pattern: /migrate|upgrade|version/i, tag: "migration_pattern" },
      { pattern: /security|auth|permission|injection/i, tag: "security_pattern" },
    ]

    for (const ep of episodes) {
      if (ep.score < MIN_IMPORTANCE_FOR_SEMANTIC) continue
      for (const { pattern, tag } of patternKeywords) {
        if (pattern.test(ep.planGoal) || ep.tags.some(t => pattern.test(t))) {
          const existingPattern = this.semanticEntries.some(
            e => e.keywords.includes(tag) && e.content.includes(ep.planGoal.slice(0, 50)),
          )
          if (!existingPattern) {
            this.semanticEntries.push({
              id: `pattern-${tag}-${ep.id}`,
              level: "semantic",
              content: `Pattern "${tag}" from: ${ep.planGoal}`,
              keywords: [tag, ...ep.tags],
              importance: Math.min(1, ep.score * 1.2),
              createdAt: Date.now(),
              lastAccessed: Date.now(),
              accessCount: 0,
              sourceSession: ep.sessionId,
              metadata: { patternType: tag, sourceEpisode: ep.id },
            })
            report.patternsExtracted++
          }
        }
      }
    }

    // 5. Pattern → Skill: convert high-confidence patterns to formal SkillDefinitions
    report.skillsConverted = this.convertPatternsToSkills(report)

    // Prune importance index if too large
    this.pruneImportanceIndex()

    return report
  }

  /**
   * Convert extracted semantic patterns into formal SkillDefinitions.
   * Scans the patterns created during this consolidation run and registers
   * them as proper skills in the SkillStore.
   *
   * If a SimulationEngine is available, simulates each candidate first:
   * only high-scoring (score >= 0.6) skills are recorded.
   * If a WorldModel is available, tracks the new skill as an entity.
   */
  private convertPatternsToSkills(_report: ConsolidationReport): number {
    let count = 0

    // Find newly created pattern entries (created within last 5 seconds)
    const now = Date.now()
    const freshPatterns = this.semanticEntries.filter(e =>
      e.id.startsWith("pattern-") && (now - e.createdAt) < 5000
    )

    for (const entry of freshPatterns) {
      const tag = entry.metadata?.patternType as string | undefined
      if (!tag) continue

      const sourceId = entry.metadata?.sourceEpisode as string | undefined
      const episode = sourceId
        ? this.episodicStore.getAll().find(ep => ep.id === sourceId)
        : undefined

      // Build capability and workflow steps based on pattern type
      const capability = this.inferPatternCapability(tag)
      const name = this.inferPatternName(tag, episode)
      const steps = this.inferPatternSteps(tag, episode)

      const def = createSkillDefinition(
        name,
        entry.content.slice(0, 80),
        [...new Set([tag, ...entry.keywords, ...(episode?.tags ?? [])])],
        steps,
        [tag],
        "agent",
        { capability },
      )

      // Set the definition's quality to match entry importance
      def.quality.successRate = entry.importance
      def.quality.usageCount = 0

      // Phase 3B: Simulate skill candidate before recording
      let shouldRecord = true
      if (this.simulationEngine) {
        const simInput: SimulationInput = {
          planId: def.meta.id,
          goal: name,
          steps: def.workflow.steps.map((s, i) => ({
            stepId: `step-${i}`,
            description: s.description,
            complexity: 5,
            predictedSuccess: entry.importance,
            estimatedTokens: 2000,
            dependsOn: i > 0 ? [`step-${i - 1}`] : [],
          })),
          context: `Pattern type: ${tag}. Source: ${episode?.planGoal ?? "unknown"}`,
        }
        const simResult = this.simulationEngine.simulate(simInput)
        if (!simResult.recommended) {
          // Still record but with lower initial success rate
          def.quality.successRate = Math.min(entry.importance, simResult.score)
          if (simResult.score < 0.3) {
            shouldRecord = false // Too low to bother
          }
        }
      }

      if (!shouldRecord) continue

      // Record in SkillStore
      this.skillStore.record(def)
      count++

      // Phase 3B: Track in WorldModel if available
      if (this.worldModel) {
        const skillEntity = this.worldModel.addEntity("skill", def.meta.name, {
          skillId: def.meta.id,
          capability: def.trigger.capability,
          patternType: tag,
          sourceEpisode: sourceId,
          steps: def.workflow.steps.length,
          importance: entry.importance,
        })
        // Relate skill to source episode if available
        if (sourceId) {
          const sourceEntity = this.worldModel.findEntities("episode")
            .find(e => e.properties?.episodeId === sourceId)
          if (sourceEntity) {
            this.worldModel.addRelation(sourceEntity.id, skillEntity.id, "led_to")
          }
        }
        // Record belief about this skill
        this.worldModel.observe(
          `skill.${def.meta.id}.quality`,
          `Skill "${def.meta.name}" has success rate ${def.quality.successRate}`,
          def.quality.successRate,
          "consolidation",
          "skill_quality",
        )
      }
    }

    return count
  }

  /** Infer capability string from pattern tag */
  private inferPatternCapability(tag: string): string {
    const tagMap: Record<string, string> = {
      error_pattern: "error.verify",
      refactoring_pattern: "refactor.analyze",
      testing_pattern: "test.verify",
      migration_pattern: "migrate.execute",
      security_pattern: "security.audit",
    }
    return tagMap[tag] ?? `pattern.${tag}.apply`
  }

  /** Infer skill name from pattern tag and episode goal */
  private inferPatternName(tag: string, episode?: Episode): string {
    if (episode?.planGoal) {
      const verbMap: Record<string, string> = {
        error_pattern: "Verify error handling in",
        refactoring_pattern: "Refactor",
        testing_pattern: "Test",
        migration_pattern: "Migrate",
        security_pattern: "Security audit of",
      }
      const verb = verbMap[tag] ?? "Apply pattern to"
      return `${verb} ${episode.planGoal.slice(0, 50)}`
    }
    return `Apply ${tag.replace(/_/g, " ")}`
  }

  /** Infer workflow steps from pattern tag and episode plan */
  private inferPatternSteps(tag: string, episode?: Episode):
    { action: string; description: string; tool?: string; expectedOutput: string }[] {
    // If episode has a detailed plan, use it
    if (episode?.plan && episode.plan.length > 0) {
      return episode.plan.map((step, i) => ({
        action: step.toLowerCase().includes("create") || step.toLowerCase().includes("implement") ? "create"
              : step.toLowerCase().includes("test") || step.toLowerCase().includes("verify") ? "verify"
              : step.toLowerCase().includes("delete") || step.toLowerCase().includes("remove") ? "delete"
              : step.toLowerCase().includes("refactor") || step.toLowerCase().includes("modify") ? "modify"
              : "execute",
        description: step.slice(0, 200),
        tool: step.toLowerCase().includes("search") ? "agentic_nav"
            : step.toLowerCase().includes("test") ? "agentic_verify"
            : step.toLowerCase().includes("delegate") ? "agentic_delegate"
            : undefined,
        expectedOutput: `Step ${i + 1} completed`,
      }))
    }

    // Generic steps based on pattern type
    const genericSteps: Record<string, { action: string; description: string; tool?: string; expectedOutput: string }[]> = {
      error_pattern: [
        { action: "research", description: "Identify error type and root cause", tool: "agentic_reflect", expectedOutput: "Error category identified" },
        { action: "modify", description: "Apply error fix based on diagnosis", expectedOutput: "Fix implemented" },
        { action: "verify", description: "Run tests to confirm fix", tool: "agentic_verify", expectedOutput: "Tests pass" },
      ],
      refactoring_pattern: [
        { action: "plan", description: "Analyze current code structure and plan refactor", tool: "agentic_score", expectedOutput: "Refactoring plan created" },
        { action: "modify", description: "Execute code refactoring", expectedOutput: "Refactored code" },
        { action: "verify", description: "Verify no regression", tool: "agentic_verify", expectedOutput: "Tests pass" },
      ],
      testing_pattern: [
        { action: "create", description: "Write unit/integration tests for the component", tool: "agentic_execute", expectedOutput: "Tests written" },
        { action: "verify", description: "Run test suite and fix failures", tool: "agentic_verify", expectedOutput: "All tests pass" },
      ],
      migration_pattern: [
        { action: "plan", description: "Assess migration scope and dependencies", expectedOutput: "Migration plan" },
        { action: "execute", description: "Run migration scripts", expectedOutput: "Migration completed" },
        { action: "verify", description: "Verify post-migration integrity", tool: "agentic_verify", expectedOutput: "Validation passed" },
      ],
      security_pattern: [
        { action: "research", description: "Security audit: identify vulnerabilities", tool: "agentic_verify", expectedOutput: "Vulnerabilities identified" },
        { action: "modify", description: "Apply security fixes", expectedOutput: "Fixes applied" },
        { action: "verify", description: "Re-audit security posture", tool: "agentic_verify", expectedOutput: "Security verified" },
      ],
    }

    return genericSteps[tag] ?? [
      { action: "research", description: "Analyze the task", expectedOutput: "Analysis complete" },
      { action: "execute", description: "Implement the solution", expectedOutput: "Implementation done" },
    ]
  }

  // ── Internal ─────────────────────────────────────────────────────

  private getEntriesByLevel(level: MemoryLevel): MemoryEntry[] {
    switch (level) {
      case "working":
        // Working memory = session store sessions — convert to entries
        return []  // Skip for now — too dynamic
      case "episodic":
        return this.episodicStore.getAll().map(ep => this.episodeToEntry(ep))
      case "semantic":
        return this.semanticEntries
      case "procedural":
        return this.proceduralEntries
    }
  }

  private episodeToEntry(ep: Episode): MemoryEntry {
    const imp = this.importanceIndex.get(ep.id)
    return {
      id: ep.id,
      level: "episodic",
      content: `${ep.planGoal}: ${ep.summary}`,
      keywords: ep.tags,
      importance: imp?.importance ?? ep.score,
      createdAt: new Date(ep.timestamp).getTime(),
      lastAccessed: imp?.lastAccessed ?? Date.now(),
      accessCount: imp?.accessCount ?? ep.usageCount,
      sourceSession: ep.sessionId,
      metadata: { outcome: ep.outcome, filesChanged: ep.filesChanged },
    }
  }

  /** Compute relevance score between query and entry */
  private scoreRelevance(entry: MemoryEntry, query: string): number {
    const queryWords = query.split(/\s+/).filter(w => w.length > 2)
    if (queryWords.length === 0) return 0

    let score = 0
    const searchText = `${entry.content} ${entry.keywords.join(" ")}`.toLowerCase()

    for (const word of queryWords) {
      if (searchText.includes(word)) score += 1
    }

    // Keyword match bonus
    for (const kw of entry.keywords) {
      if (query.includes(kw.toLowerCase())) score += 2
    }

    // Recency bonus
    const ageHours = (Date.now() - entry.createdAt) / 3600_000
    score *= Math.max(0.5, 1 - ageHours / 720) // decay over 30 days

    return score
  }

  /** Default importance based on memory level */
  private computeDefaultImportance(level: MemoryLevel): number {
    switch (level) {
      case "working": return 1.0
      case "episodic": return 0.7
      case "semantic": return 0.9
      case "procedural": return 0.95
    }
  }

  /** Track importance in the index */
  private indexImportance(id: string, level: MemoryLevel, importance: number): void {
    this.importanceIndex.set(id, {
      importance,
      level,
      lastAccessed: Date.now(),
      accessCount: 0,
    })
  }

  /** Prune importance index when too large (LRU-based) */
  private pruneImportanceIndex(): void {
    if (this.importanceIndex.size <= this.maxImportanceEntries) return

    const sorted = [...this.importanceIndex.entries()]
      .sort(([, a], [, b]) => a.lastAccessed - b.lastAccessed)

    const toRemove = sorted.slice(0, sorted.length - this.maxImportanceEntries)
    for (const [id] of toRemove) {
      this.importanceIndex.delete(id)
    }
  }

  // ── Stats ────────────────────────────────────────────────────────

  getStats(): {
    working: number
    episodic: number
    semantic: number
    procedural: number
    totalIndexed: number
  } {
    return {
      working: this.workingMem.getActiveSessions().length,
      episodic: this.episodicStore.getAll().length,
      semantic: this.semanticEntries.length,
      procedural: this.proceduralEntries.length,
      totalIndexed: this.importanceIndex.size,
    }
  }
}
