import type { Episode } from "./episodic-store.js"
import type { SkillRecord } from "./skill-store.js"
import { VectorStore } from "./vector-store.js"
import { LocalEmbedder, type EmbedderConfig } from "./local-embedder.js"

export interface IndexEntry {
  category: string
  episode?: Episode
  skill?: SkillRecord
  timestamp: string
  keywords: string[]
  title: string
  /** TF-IDF score (if available) */
  tfidfScore?: number
  /** Vector cosine similarity score (if available) */
  vectorScore?: number
  /** Combined hybrid score */
  hybridScore?: number
}

export interface IndexSearchResult {
  entries: IndexEntry[]
  category: string
  totalInCategory: number
  query: string
}

export interface RAGConfig {
  /** Keyword (TF-IDF) weight in hybrid search (default: 0.3) */
  keywordWeight: number
  /** Vector similarity weight in hybrid search (default: 0.7) */
  vectorWeight: number
  /** Embedding model config (null = TF-IDF only) */
  embedding: EmbedderConfig | null
}

export interface RAGStats {
  categories: string[]
  totalEpisodes: number
  totalSkills: number
  totalTfidfDocs: number
  perCategory: Record<string, { episodes: number; skills: number; tfidfDocs: number; mode: string }>
}

const DEFAULT_CATEGORIES = [
  "automotive", "financial", "personal", "tech", "general",
]

/**
 * Multi-Index RAG with hybrid search (TF-IDF + Vector).
 *
 * TF-IDF mode: zero external dependencies, fast, works anywhere.
 * Vector mode: uses LLM provider embedding endpoint for semantic search.
 * Hybrid: combines both with configurable weights.
 */
export class MultiIndexRAG {
  private indices = new Map<string, { episodes: Episode[]; skills: SkillRecord[] }>()
  private onIndex?: (entry: IndexEntry) => void

  /** TF-IDF sparse vector store */
  readonly vectorStore: VectorStore
  /** Dense vector embedder (optional) */
  readonly embedder: LocalEmbedder | null
  /** Search weights */
  readonly config: RAGConfig

  constructor(
    categories: string[] = DEFAULT_CATEGORIES,
    config?: Partial<RAGConfig>,
  ) {
    for (const cat of categories) {
      this.indices.set(cat, { episodes: [], skills: [] })
    }

    this.config = {
      keywordWeight: config?.keywordWeight ?? 0.3,
      vectorWeight: config?.vectorWeight ?? 0.7,
      embedding: config?.embedding ?? null,
    }

    this.vectorStore = new VectorStore()
    this.embedder = this.config.embedding
      ? new LocalEmbedder(this.config.embedding)
      : null
  }

  /** Current search mode name */
  get mode(): string {
    return this.embedder ? `hybrid (TF-IDF + vector @ ${this.config.vectorWeight})` : "TF-IDF"
  }

  setPersistenceCallback(cb: (entry: IndexEntry) => void): void {
    this.onIndex = cb
  }

  /**
   * Add or sync categories dynamically.
   */
  addCategory(category: string): void {
    if (!this.indices.has(category)) {
      this.indices.set(category, { episodes: [], skills: [] })
    }
  }

  syncCategories(categories: string[]): void {
    for (const cat of categories) {
      if (!this.indices.has(cat)) {
        this.indices.set(cat, { episodes: [], skills: [] })
      }
    }
  }

  /**
   * Store an episode in a category index.
   * Also indexes into TF-IDF VectorStore and optionally computes embedding.
   */
  indexEpisode(category: string, episode: Episode): void {
    const index = this.indices.get(category)
    if (!index) {
      this.addCategory(category)
    }
    const targetIndex = this.indices.get(category)!

    // Check for duplicate before adding
    if (!targetIndex.episodes.some(e => e.id === episode.id)) {
      targetIndex.episodes.push(episode)
    }

    // Index into TF-IDF vector store (idempotent — re-indexing replaces old entry)
    this.vectorStore.index({
      id: `ep-${episode.id}`,
      category,
      title: episode.planGoal,
      content: `${episode.summary}\n${episode.decisions.join("\n")}`,
      keywords: episode.tags,
      metadata: { type: "episode", episodeId: episode.id },
    })

    this.onIndex?.({
      category,
      episode,
      timestamp: episode.timestamp,
      keywords: episode.tags,
      title: episode.planGoal,
    })
  }

  /**
   * Store a skill in a category index.
   * Also indexes into TF-IDF VectorStore.
   */
  indexSkill(category: string, skill: SkillRecord): void {
    const index = this.indices.get(category)
    if (!index) {
      this.addCategory(category)
    }
    const targetIndex = this.indices.get(category)!

    // Check for duplicate before adding
    if (!targetIndex.skills.some(s => s.definition.meta.id === skill.definition.meta.id)) {
      targetIndex.skills.push(skill)
    }

    // Index into TF-IDF vector store (idempotent — re-indexing replaces old entry)
    this.vectorStore.index({
      id: `sk-${skill.definition.meta.id}`,
      category,
      title: skill.definition.meta.name,
      content: skill.definition.trigger.pattern,
      keywords: skill.definition.trigger.keywords ?? [],
      metadata: { type: "skill", skillId: skill.definition.meta.id },
    })

    this.onIndex?.({
      category,
      skill,
      timestamp: skill.lastUsed,
      keywords: skill.definition.trigger.keywords ?? [],
      title: skill.definition.meta.name,
    })
  }

  /**
   * Search within a specific category using hybrid TF-IDF + Vector scoring.
   */
  searchByCategory(query: string, category: string, limit = 10): IndexSearchResult {
    const index = this.indices.get(category)
    if (!index) {
      return { entries: [], category, totalInCategory: 0, query }
    }

    // 1. TF-IDF scoring via VectorStore
    const tfidfResults = this.vectorStore.search(query, category, limit * 2)

    // 2. Fallback: keyword matching for anything not caught by TF-IDF
    //    (episodes/skills that don't have enough TF-IDF signal)
    const q = query.toLowerCase()
    const keywordBonus = new Map<string, number>()

    for (const ep of index.episodes) {
      const epId = `ep-${ep.id}`
      let bonus = 0
      if (ep.planGoal.toLowerCase().includes(q)) bonus += 3
      if (ep.tags.some(t => q.includes(t) || t.includes(q))) bonus += 2
      if (ep.summary.toLowerCase().includes(q)) bonus += 1
      if (bonus > 0) keywordBonus.set(epId, bonus)
    }
    for (const sk of index.skills) {
      const skId = `sk-${sk.definition.meta.id}`
      let bonus = 0
      if (sk.definition.meta.name.toLowerCase().includes(q)) bonus += 3
      if ((sk.definition.trigger.keywords ?? []).some(k => k.toLowerCase().includes(q))) bonus += 2
      if (bonus > 0) keywordBonus.set(skId, bonus)
    }

    // 3. Build scored result map
    const scoredMap = new Map<string, { entry: IndexEntry; tfidfScore: number; kwBonus: number }>()

    // From TF-IDF
    for (const result of tfidfResults) {
      const id = result.doc.id
      const isEpisode = id.startsWith("ep-")
      const ep = isEpisode ? index.episodes.find(e => `ep-${e.id}` === id) : undefined
      const sk = !isEpisode ? index.skills.find(s => `sk-${s.definition.meta.id}` === id) : undefined
      if (!ep && !sk) continue

      scoredMap.set(id, {
        entry: {
          category,
          episode: ep,
          skill: sk,
          timestamp: ep?.timestamp ?? sk!.lastUsed,
          keywords: ep?.tags ?? sk!.definition.trigger.keywords ?? [],
          title: ep?.planGoal ?? sk!.definition.meta.name,
          tfidfScore: result.score,
          hybridScore: result.score,
        },
        tfidfScore: result.score,
        kwBonus: keywordBonus.get(id) ?? 0,
      })
      keywordBonus.delete(id) // Already counted
    }

    // From keyword bonus only (items TF-IDF missed)
    for (const [id, bonus] of keywordBonus) {
      if (scoredMap.has(id)) {
        scoredMap.get(id)!.kwBonus += bonus
        continue
      }
      const isEpisode = id.startsWith("ep-")
      const ep = isEpisode ? index.episodes.find(e => `ep-${e.id}` === id) : undefined
      const sk = !isEpisode ? index.skills.find(s => `sk-${s.definition.meta.id}` === id) : undefined
      if (!ep && !sk) continue

      scoredMap.set(id, {
        entry: {
          category,
          episode: ep,
          skill: sk,
          timestamp: ep?.timestamp ?? sk!.lastUsed,
          keywords: ep?.tags ?? sk!.definition.trigger.keywords ?? [],
          title: ep?.planGoal ?? sk!.definition.meta.name,
          tfidfScore: 0,
          hybridScore: bonus,
        },
        tfidfScore: 0,
        kwBonus: bonus,
      })
    }

    // 4. Vector scores are computed asynchronously via enrichWithVectors().
    //    The sync path uses TF-IDF + keyword bonus only.
    //    This keeps searchByCategory synchronous and fast.

    // 5. Compute combined TF-IDF + keyword score
    for (const [id, data] of scoredMap) {
      const tfidf = data.tfidfScore
      const kw = data.kwBonus

      // Normalize TF-IDF to 0-1 range
      const maxTfidf = Math.max(...[...scoredMap.values()].map(v => v.tfidfScore), 1)
      const normTfidf = tfidf / maxTfidf

      // Normalize keyword bonus to 0-1
      const maxKw = Math.max(...[...scoredMap.values()].map(v => v.kwBonus), 1)
      const normKw = kw / maxKw

      // Combined score (TF-IDF heavy, keyword as boost)
      const combined = (0.7 * normTfidf) + (0.3 * normKw)

      data.entry.hybridScore = combined
      data.entry.tfidfScore = tfidf
    }

    // 6. Sort by combined score descending
    const sorted = [...scoredMap.values()]
      .sort((a, b) => (b.entry.hybridScore ?? 0) - (a.entry.hybridScore ?? 0))
      .slice(0, limit)
      .map(d => d.entry)

    const catIndex = this.indices.get(category)
    return {
      entries: sorted,
      category,
      totalInCategory: catIndex ? catIndex.episodes.length + catIndex.skills.length : sorted.length,
      query,
    }
  }

  /**
   * Search across ALL categories.
   */
  searchAll(query: string, limit = 10): IndexSearchResult[] {
    const results: IndexSearchResult[] = []

    for (const [category] of this.indices) {
      const catResult = this.searchByCategory(query, category, limit)
      if (catResult.entries.length > 0) {
        results.push(catResult)
      }
    }

    // Sort results by highest scoring entry across categories
    results.sort((a, b) => {
      const aMax = Math.max(...a.entries.map(e => e.hybridScore ?? 0), 0)
      const bMax = Math.max(...b.entries.map(e => e.hybridScore ?? 0), 0)
      return bMax - aMax
    })

    return results
  }

  /**
   * Auto-select the best category based on TF-IDF scoring.
   */
  autoCategory(query: string): string {
    const scores = new Map<string, number>()

    for (const [category] of this.indices) {
      const results = this.vectorStore.search(query, category, 5)
      let score = results.reduce((s, r) => s + r.score, 0)

      // Category name bonus
      if (query.toLowerCase().includes(category)) {
        score += 2
      }

      scores.set(category, score)
    }

    let best = "general"
    let bestScore = 0
    for (const [cat, score] of scores) {
      if (score > bestScore) {
        bestScore = score
        best = cat
      }
    }

    return best
  }

  /**
   * Get statistics about all indices.
   */
  getStats(): RAGStats {
    const categories: string[] = []
    const perCategory: Record<string, { episodes: number; skills: number; tfidfDocs: number; mode: string }> = {}

    for (const [cat, index] of this.indices) {
      categories.push(cat)
      perCategory[cat] = {
        episodes: index.episodes.length,
        skills: index.skills.length,
        tfidfDocs: this.vectorStore.docCountOf(cat),
        mode: this.mode,
      }
    }

    return {
      categories,
      totalEpisodes: [...this.indices.values()].reduce((s, i) => s + i.episodes.length, 0),
      totalSkills: [...this.indices.values()].reduce((s, i) => s + i.skills.length, 0),
      totalTfidfDocs: this.vectorStore.size,
      perCategory,
    }
  }

  /**
   * Export all data for persistence.
   */
  exportAll(): Record<string, { episodes: Episode[]; skills: SkillRecord[]; tfidfDocs: import("./vector-store.js").TfIdfDoc[] }> {
    const data: Record<string, { episodes: Episode[]; skills: SkillRecord[]; tfidfDocs: import("./vector-store.js").TfIdfDoc[] }> = {}
    for (const [cat, index] of this.indices) {
      data[cat] = {
        episodes: index.episodes,
        skills: index.skills,
        tfidfDocs: this.vectorStore.exportAll().filter(d => d.category === cat),
      }
    }
    return data
  }

  /**
   * Import persisted data.
   */
  importAll(data: Record<string, { episodes: Episode[]; skills: SkillRecord[]; tfidfDocs?: import("./vector-store.js").TfIdfDoc[] }>): void {
    for (const [cat, { episodes, skills, tfidfDocs }] of Object.entries(data)) {
      const index = this.indices.get(cat)
      if (index) {
        index.episodes.push(...episodes)
        index.skills.push(...skills)
      } else {
        this.indices.set(cat, { episodes: [...episodes], skills: [...skills] })
      }
      // Re-index into TF-IDF vector store
      if (tfidfDocs) {
        for (const doc of tfidfDocs) {
          this.vectorStore.index(doc)
        }
      } else {
        // Re-index from raw data
        for (const ep of episodes) {
          this.vectorStore.index({
            id: `ep-${ep.id}`,
            category: cat,
            title: ep.planGoal,
            content: `${ep.summary}\n${ep.decisions.join("\n")}`,
            keywords: ep.tags,
            metadata: { type: "episode" },
          })
        }
        for (const sk of skills) {
          this.vectorStore.index({
            id: `sk-${sk.definition.meta.id}`,
            category: cat,
            title: sk.definition.meta.name,
            content: sk.definition.trigger.pattern,
            keywords: sk.definition.trigger.keywords ?? [],
            metadata: { type: "skill" },
          })
        }
      }
    }
  }
}

/**
 * Asynchronously enrich search results with vector similarity scores.
 * Call this after searchByCategory/searchAll if embedder is configured.
 * Returns enriched results with vectorScore and updated hybridScore fields.
 */
export async function enrichWithVectors(
  embedder: LocalEmbedder,
  results: IndexSearchResult[],
  query: string,
): Promise<IndexSearchResult[]> {
  const qVec = await embedder.embed(query)

  for (const catResult of results) {
    for (const entry of catResult.entries) {
      const text = entry.title + " " + entry.keywords.join(" ")
      const docVec = await embedder.embed(text)
      const sim = embedder.cosineSimilarity(qVec.vector, docVec.vector)
      entry.vectorScore = sim
      entry.hybridScore = (entry.hybridScore ?? 0) * 0.3 + sim * 0.7
    }
    catResult.entries.sort((a, b) => (b.hybridScore ?? 0) - (a.hybridScore ?? 0))
  }

  return results
}
