import type { MemoryLevel, MemoryEntry, MemoryQuery, MemoryQueryResult } from "./memory-orchestrator.js"
import type { SessionStore } from "./session-store.js"
import type { EpisodicStore, Episode } from "./episodic-store.js"
import type { ExecutionTracer } from "./execution-tracer.js"
import { ImportanceIndex } from "./importance-index.js"

/**
 * MemoryQueryEngine — Query subsystem for MemoryOrchestrator.
 *
 * Extracted from MemoryOrchestrator for cleaner separation of concerns.
 * Handles query routing, multi-level entry resolution, relevance scoring,
 * and cross-level search.
 */
export class MemoryQueryEngine {
  constructor(
    private getWorkingList: () => MemoryEntry[],
    private getSemanticEntries: () => MemoryEntry[],
    private getProceduralList: () => MemoryEntry[],
    private importanceIndex: ImportanceIndex,
    private workingMem: SessionStore,
    private episodicStore: EpisodicStore,
    private executionTracer: ExecutionTracer,
  ) {}

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
          entry.lastAccessed = Date.now()
          entry.accessCount++
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

  /** Get all entries at a specific memory level */
  getEntriesByLevel(level: MemoryLevel): MemoryEntry[] {
    switch (level) {
      case "working":
        return [...this.getWorkingList(), ...this.sessionToEntries()]
      case "episodic":
        return this.episodicStore.getAll().map(ep => this.episodeToEntry(ep))
      case "semantic":
        return this.getSemanticEntries()
      case "procedural":
        return [...this.getProceduralList(), ...this.executionTracer.tracesToProceduralEntries()]
    }
  }

  /** Convert active sessions to MemoryEntries for working memory queries */
  private sessionToEntries(): MemoryEntry[] {
    const entries: MemoryEntry[] = []
    const sessions = this.workingMem.getActiveSessions()
    for (const session of sessions) {
      // Entry dari session plan/goal
      if (session.plan?.intent?.goal) {
        entries.push({
          id: `working-${session.sessionId}-plan`,
          level: "working",
          content: `Goal: ${session.plan.intent.goal}`,
          keywords: session.plan.intent.goal.split(/\s+/).filter(w => w.length > 3),
          importance: 1.0,
          createdAt: Date.now(),
          lastAccessed: Date.now(),
          accessCount: 0,
          sourceSession: session.sessionId,
          metadata: { type: "plan", domain: session.currentDomain },
        })
      }
      // Entry dari recent turns (last 10)
      const recentTurns = session.turns.slice(-10)
      for (const turn of recentTurns) {
        const contentPreview = turn.content.slice(0, 200)
        entries.push({
          id: `working-${session.sessionId}-turn-${turn.timestamp}`,
          level: "working",
          content: `[${turn.role}] ${contentPreview}`,
          keywords: contentPreview.split(/\s+/).filter(w => w.length > 3).slice(0, 8),
          importance: 0.8,
          createdAt: turn.timestamp,
          lastAccessed: Date.now(),
          accessCount: 1,
          sourceSession: session.sessionId,
          metadata: { type: "turn", role: turn.role },
        })
      }
    }
    return entries
  }

  /** Convert an Episode to a MemoryEntry */
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
}
