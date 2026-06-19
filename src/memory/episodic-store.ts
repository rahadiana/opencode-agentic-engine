import { createMemoryEnvelope, parseMemoryEnvelope, MEMORY_SCHEMA_VERSION, MemorySchemaVersion } from "./schema-version.js"

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

  setPersistenceCallback(cb: (episode: Episode) => void): void {
    this.onRecord = cb
  }

  record(sessionId: string, planGoal: string, outcome: Episode["outcome"], decisions: string[], filesChanged?: string[], domain?: string, projectId?: string): Episode {
    const episode: Episode = {
      id: `ep-${Date.now()}`,
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
    return this.episodes
      .filter(e =>
        e.planGoal.toLowerCase().includes(q) ||
        e.tags.some(t => t.includes(q)) ||
        e.decisions.some(d => d.toLowerCase().includes(q)) ||
        (e.domain?.toLowerCase().includes(q) ?? false) ||
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
    const words = [...goal.split(/\s+/), ...decisions.join(" ").split(/\s+/)]
    return [...new Set(words.filter(w => w.length > 3).map(w => w.toLowerCase()))]
  }
}
