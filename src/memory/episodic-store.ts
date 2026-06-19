import { createMemoryEnvelope, parseMemoryEnvelope, MEMORY_SCHEMA_VERSION, MemorySchemaVersion } from "./schema-version.js"
import { isStopWord } from "./stopwords.js"

export interface Episode {
  id: string
  sessionId: string
  projectId?: string
  planGoal: string
  summary: string
  outcome: "success" | "partial" | "failed"
  decisions: string[]
  filesChanged?: string[]
  domain?: string
  timestamp: string
  tags: string[]
}

export interface EpisodeEnvelope {
  schema_version: number
  type: "episode"
  data: Episode
  created_at: string
}

export class EpisodicStore {
  private episodes: Episode[] = []
  private migrator = new MemorySchemaVersion()
  private onRecord?: (episode: Episode) => void
  private maxEpisodes: number
  private persistLayer?: import("./persistence.js").PersistenceLayer
  private persistNs = "episodes"
  private persistInterval?: ReturnType<typeof setInterval>

  constructor(maxEpisodes = 1000) {
    this.maxEpisodes = maxEpisodes
  }

  setPersistenceCallback(cb: (episode: Episode) => void): void {
    this.onRecord = cb
  }

  /** Enable auto-save to disk every 30s */
  enableAutoSave(layer: import("./persistence.js").PersistenceLayer, namespace = "episodes"): void {
    this.persistLayer = layer
    this.persistNs = namespace
    if (this.persistInterval) clearInterval(this.persistInterval)
    this.persistInterval = setInterval(() => this.persistAll(), 30000)
    this.persistInterval.unref()
  }

  disableAutoSave(): void {
    if (this.persistInterval) {
      clearInterval(this.persistInterval)
      this.persistInterval = undefined
    }
  }

  private persistAll(): void {
    if (!this.persistLayer) return
    try {
      this.persistLayer.save(this.persistNs, "episodes", this.episodes)
    } catch (e) {
      console.error("[EpisodicStore] auto-save failed:", e)
    }
  }

  loadFromDisk(layer: import("./persistence.js").PersistenceLayer, namespace = "episodes"): void {
    const data = layer.load<Episode[]>(namespace, "episodes")
    if (Array.isArray(data)) {
      for (const ep of data) {
        if (!this.episodes.some(e => e.id === ep.id)) {
          this.episodes.push(ep)
        }
      }
    }
  }

  record(sessionId: string, planGoal: string, outcome: Episode["outcome"], decisions: string[], filesChanged?: string[], domain?: string, projectId?: string): Episode {
    const episode: Episode = {
      id: `ep-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      sessionId,
      projectId,
      planGoal,
      summary: `${outcome === "success" ? "Completed" : outcome === "partial" ? "Partially completed" : "Failed"}: ${planGoal}`,
      outcome,
      decisions,
      filesChanged,
      domain,
      timestamp: new Date().toISOString(),
      tags: this.extractTags(planGoal, decisions),
    }

    this.episodes.push(episode)

    // Evict oldest if over limit
    if (this.episodes.length > this.maxEpisodes) {
      this.episodes.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      this.episodes.splice(0, this.episodes.length - this.maxEpisodes)
    }

    this.onRecord?.(episode)
    return episode
  }

  /** Get episodes scoped to a specific project, sorted by recency */
  getByProject(projectId: string, limit = 100): Episode[] {
    return this.episodes
      .filter(e => e.projectId === projectId)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, limit)
  }

  search(query: string): Episode[] {
    const q = query.toLowerCase()
    const qTokens = new Set(q.split(/\s+/).filter(t => t.length > 2))
    if (qTokens.size === 0) {
      return [...this.episodes]
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
        .slice(0, 10)
    }

    // Relevance scoring: token overlap + recency
    const scored = this.episodes.map(e => {
      let score = 0
      const goal = e.planGoal.toLowerCase()
      const decisions = e.decisions.map(d => d.toLowerCase())
      const tags = e.tags

      // Token overlap with planGoal (highest weight)
      let overlap = 0
      const goalTokens = new Set(goal.split(/\s+/).filter(t => t.length > 2))
      for (const qt of qTokens) {
        if (goal.includes(qt)) score += 5
        if (goalTokens.has(qt)) score += 3
        if (tags.some(t => t.includes(qt))) score += 2
        if (decisions.some(d => d.includes(qt))) score += 1
        if (e.filesChanged?.some(f => f.toLowerCase().includes(qt))) score += 2
        if (e.domain?.toLowerCase().includes(qt)) score += 2
        overlap += goalTokens.has(qt) ? 1 : 0
      }

      // TF score
      if (goalTokens.size > 0) {
        score += (overlap / Math.max(goalTokens.size, 1)) * 5
      }

      // Recency bonus (up to +3 for today)
      const daysSince = (Date.now() - new Date(e.timestamp).getTime()) / 86400000
      if (daysSince < 1) score += 3
      else if (daysSince < 7) score += 2
      else if (daysSince < 30) score += 1

      // Success bonus
      if (e.outcome === "success") score += 1

      return { episode: e, score }
    })
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(s => s.episode)

    return scored.length > 0
      ? scored
      : [...this.episodes]
          .filter(e =>
            e.planGoal.toLowerCase().includes(q) ||
            e.decisions.some(d => d.toLowerCase().includes(q)) ||
            (e.filesChanged?.some(f => f.toLowerCase().includes(q)) ?? false)
          )
          .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
          .slice(0, 10)
  }

  getRecent(limit = 10): Episode[] {
    return [...this.episodes]
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, limit)
  }

  getBySession(sessionId: string): Episode[] {
    return this.episodes.filter(e => e.sessionId === sessionId)
  }

  getStats(): { total: number; successful: number; partial: number; failed: number } {
    return {
      total: this.episodes.length,
      successful: this.episodes.filter(e => e.outcome === "success").length,
      partial: this.episodes.filter(e => e.outcome === "partial").length,
      failed: this.episodes.filter(e => e.outcome === "failed").length,
    }
  }

  exportEpisode(id: string): EpisodeEnvelope | null {
    const ep = this.episodes.find(e => e.id === id)
    if (!ep) return null
    return createMemoryEnvelope(ep, "episode") as EpisodeEnvelope
  }

  importEpisode(envelope: EpisodeEnvelope): boolean {
    const parsed = parseMemoryEnvelope<Episode>(envelope)
    if (!parsed || parsed.type !== "episode") return false

    // Check for duplicate before importing
    if (this.episodes.some(e => e.id === parsed.data.id)) {
      return false
    }

    if (parsed.version < MEMORY_SCHEMA_VERSION) {
      const upgraded = this.migrator.upgrade(parsed.data, parsed.version)
      this.episodes.push(upgraded)
      return true
    }

    this.episodes.push(parsed.data)
    return true
  }

  exportAll(): EpisodeEnvelope[] {
    return this.episodes.map(e => createMemoryEnvelope(e, "episode") as EpisodeEnvelope)
  }

  getMigrator(): MemorySchemaVersion {
    return this.migrator
  }

  private extractTags(goal: string, decisions: string[]): string[] {
    // Uses centralized multilingual stop word set (58 languages via stopwords-iso)
    // plus software engineering domain-specific words

    const words = [...goal.split(/\s+/), ...decisions.join(" ").split(/\s+/)]
    const raw = words
      .filter(w => w.length > 3 && !isStopWord(w))
      .map(w => w.toLowerCase())

    // TF-based deduplication: only keep tags that appear at least twice
    const freq = new Map<string, number>()
    for (const w of raw) freq.set(w, (freq.get(w) ?? 0) + 1)

    return [...freq.entries()]
      .filter(([, count]) => count >= 2 || raw.length < 10)  // if few words, keep all
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([word]) => word)
  }

  snapshot(): Episode[] {
    return JSON.parse(JSON.stringify(this.episodes))
  }

  restore(snapshot: Episode[]): void {
    this.episodes = JSON.parse(JSON.stringify(snapshot))
  }
}
