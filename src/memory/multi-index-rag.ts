import type { Episode } from "./episodic-store.js"
import type { SkillRecord } from "./skill-store.js"
import type { ScoredResult } from "./vector-store.js"
import { VectorStore } from "./vector-store.js"
import { LocalEmbedder, type EmbedderConfig } from "./local-embedder.js"

export interface QualityDimensions {
  /** Relevance: seberapa relevan konten dengan query target (0-1) */
  relevance: number
  /** Completeness: apakah konten mencakup semua aspek penting (0-1) */
  completeness: number
  /** Consistency: apakah konten konsisten secara internal & eksternal (0-1) */
  consistency: number
  /** Factuality: seberapa faktual (bukan opini/asumsi) (0-1) */
  factuality: number
  /** Fluency: kualitas penulisan, kejelasan (0-1) */
  fluency: number
}

export interface UsageStats {
  /** Total berapa kali entry ini diretrieve */
  retrievalCount: number
  /** Berapa kali entry ini dipakai di step yang sukses */
  successCount: number
  /** Berapa kali entry ini dipakai di step yang gagal */
  failureCount: number
  /** Kapan terakhir diretrieve */
  lastRetrievedAt: string | null
  /** Kapan terakhir dipake di step sukses */
  lastSuccessAt: string | null
  /** Kapan terakhir dipake di step gagal */
  lastFailureAt: string | null
}

export interface FeedbackEntry {
  /** Timestamp feedback */
  timestamp: string
  /** Step ID atau session ID yang ngasih feedback */
  sourceId: string
  /** Positive = entry membantu, negative = entry menyesatkan */
  type: "positive" | "negative" | "neutral"
  /** Dimensi yang dikoreksi (optional) */
  dimension?: keyof QualityDimensions
  /** Catatan tambahan */
  note?: string
}

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
  /** Confidence score 0.0–1.0 (populated by searchWithConfidence) */
  confidence?: number

  // ── RAG Self-Improvement Quality Tracking (SCIM + Reflective RAG inspired) ──

  /** Multi-dimensional quality scores — default: 0.7 each */
  quality?: QualityDimensions
  /** Overall quality score (weighted average of dimensions) — auto-calculated */
  qualityScore?: number
  /** Usage statistics */
  usageStats?: UsageStats
  /** Feedback history — limited to last 50 entries */
  feedbackHistory?: FeedbackEntry[]
  /** Kapan terakhir kualitasnya diverifikasi/diupdate */
  lastVerifiedAt?: string
  /** Staleness score 0-1: 0 = fresh, 1 = completely stale.
   *  Auto-calculated based on age, last verification, and usage pattern. */
  stalenessScore?: number
  /** Source URL atau ID entry yang menjadi referensi (untuk update chain) */
  derivedFrom?: string
  /** Versi entry (increment setiap update) */
  version?: number
}

/**
 * Default quality dimensions untuk entry baru.
 */
export function createDefaultQuality(): QualityDimensions {
  return {
    relevance: 0.7,
    completeness: 0.7,
    consistency: 0.7,
    factuality: 0.7,
    fluency: 0.7,
  }
}

/**
 * Weighted average dari multi-dimensional quality.
 * SCIM-inspired weighting: relevance & factuality > completeness & consistency > fluency.
 */
export function computeQualityScore(q: QualityDimensions): number {
  return (
    q.relevance * 0.25 +
    q.factuality * 0.25 +
    q.completeness * 0.20 +
    q.consistency * 0.20 +
    q.fluency * 0.10
  )
}

/**
 * Result from searchWithConfidence — includes aggregate confidence metrics.
 */
export interface SearchWithConfidenceResult {
  entries: IndexEntry[]
  /** Average confidence across all returned entries */
  averageConfidence: number
  /** Highest single entry confidence */
  topConfidence: number
  /** True if at least one entry has confidence >= 0.6 */
  hasHighConfidence: boolean
  /** True if no results found */
  isEmpty: boolean
  /** The search query used */
  query: string
  /** Categories searched */
  categories: string[]
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

/** Index data shape — exported for type-safe deserialization from persistence. */
export type IndexData = Record<string, { episodes: Episode[]; skills: SkillRecord[]; tfidfDocs?: import("./vector-store.js").TfIdfDoc[] }>

export class MultiIndexRAG {
  private indices = new Map<string, { episodes: Episode[]; skills: SkillRecord[] }>()
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

  /** Callback for persisting entries to disk */
  private onPersist?: (data: ReturnType<typeof this.exportAll>) => void
  /** Suppress persist notifications during batch seeding */
  private suppressPersist = false

  /**
   * Set a callback that fires whenever data is stored, so it can be persisted to disk.
   * The callback receives the full export of all RAG data.
   */
  setPersistCallback(cb: (data: ReturnType<typeof this.exportAll>) => void): void {
    this.onPersist = cb
  }

  /**
   * Batch mode: suppress individual persist notifications.
   * Call with `true` before batch seeding, then call `flush()` at the end.
   */
  setBatchMode(batch: boolean): void {
    this.suppressPersist = batch
  }

  /**
   * Flush (trigger persist) and exit batch mode.
   */
  flushPersist(): void {
    this.suppressPersist = false
    this.onPersist?.(this.exportAll())
  }

  /**
   * Notify persistence callback after a store operation.
   */
  private notifyPersist(): void {
    if (!this.suppressPersist) {
      this.onPersist?.(this.exportAll())
    }
  }

  /**
   * Index an episode in a category — overridden to trigger persistence.
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

    this.notifyPersist()
  }

  /**
   * Find an episode by ID across all categories.
   * Returns the actual stored reference (mutable).
   */
  findEpisodeById(id: string): { episode: Episode; category: string } | null {
    for (const [cat, index] of this.indices) {
      const ep = index.episodes.find(e => e.id === id)
      if (ep) return { episode: ep, category: cat }
    }
    return null
  }

  /**
   * Find episodes by title fuzzy match.
   * Returns actual stored references (mutable).
   * Used oleh RAGFeedbackLoop untuk update quality scores secara langsung.
   */
  findEpisodesByTitle(title: string): Array<{ episode: Episode; category: string }> {
    const results: Array<{ episode: Episode; category: string }> = []
    const lowerTitle = title.toLowerCase()
    for (const [cat, index] of this.indices) {
      for (const ep of index.episodes) {
        if (ep.planGoal.toLowerCase().includes(lowerTitle) || lowerTitle.includes(ep.planGoal.toLowerCase())) {
          results.push({ episode: ep, category: cat })
        }
      }
    }
    return results
  }

  /**
   * Update metadata (quality scores, usage stats, etc.) on an episode.
   * Karena Episode interface tidak punya field quality, kita simpan sebagai
   * properti on-the-fly via Object.assign atau langsung set property.
   * Returns true if episode was found and updated.
   */
  updateEpisodeMetadata(id: string, metadata: Record<string, unknown>): boolean {
    for (const [cat, index] of this.indices) {
      const ep = index.episodes.find(e => e.id === id)
      if (ep) {
        Object.assign(ep, metadata)
        // Bump version if quality/content-related fields changed
        const epAny = ep as unknown as Record<string, unknown>
        if (metadata.quality !== undefined || metadata.qualityScore !== undefined || metadata.summary !== undefined) {
          epAny.version = ((epAny.version as number) ?? 1) + 1
        }
        // Re-index TF-IDF when content/title-related fields change so search stays consistent
        if (metadata.summary !== undefined || metadata.planGoal !== undefined || metadata.decisions !== undefined) {
          this.vectorStore.index({
            id: `ep-${ep.id}`,
            category: cat,
            title: ep.planGoal,
            content: `${ep.summary}\n${(ep.decisions ?? []).join("\n")}`,
            keywords: ep.tags,
            metadata: { type: "episode", episodeId: ep.id },
          })
        }
        this.notifyPersist()
        return true
      }
    }
    return false
  }

  /**
   * Public closed-loop API: update a RAG entry by id or title (fuzzy).
   * Used by RAGFeedbackLoop and callers that need explicit write-back + persist.
   *
   * Prefer `id` when known (exact). Falls back to title match via findEpisodesByTitle.
   * Returns number of entries updated (0 if none found).
   */
  updateEntry(
    selector: { id?: string; title?: string },
    patch: Record<string, unknown>,
  ): number {
    if (!selector?.id && !selector?.title) return 0
    let updated = 0

    if (selector.id) {
      if (this.updateEpisodeMetadata(selector.id, patch)) updated++
      return updated
    }

    const title = selector.title!
    const matches = this.findEpisodesByTitle(title)
    for (const { episode } of matches) {
      if (this.updateEpisodeMetadata(episode.id, patch)) updated++
    }
    return updated
  }

  /**
   * Lookup entry quality/usage snapshot by id or title (read-only).
   * Useful for tests and observability after feedback write-back.
   */
  getEntrySnapshot(selector: { id?: string; title?: string }): Array<{
    id: string
    title: string
    category: string
    qualityScore?: number
    quality?: QualityDimensions
    usageStats?: UsageStats
    version?: number
    stalenessScore?: number
    lastVerifiedAt?: string
  }> {
    const out: Array<{
      id: string
      title: string
      category: string
      qualityScore?: number
      quality?: QualityDimensions
      usageStats?: UsageStats
      version?: number
      stalenessScore?: number
      lastVerifiedAt?: string
    }> = []

    const push = (episode: Episode, category: string) => {
      const epAny = episode as unknown as Record<string, unknown>
      out.push({
        id: episode.id,
        title: episode.planGoal,
        category,
        qualityScore: epAny.qualityScore as number | undefined,
        quality: epAny.quality as QualityDimensions | undefined,
        usageStats: epAny.usageStats as UsageStats | undefined,
        version: epAny.version as number | undefined,
        stalenessScore: epAny.stalenessScore as number | undefined,
        lastVerifiedAt: epAny.lastVerifiedAt as string | undefined,
      })
    }

    if (selector.id) {
      const found = this.findEpisodeById(selector.id)
      if (found) push(found.episode, found.category)
      return out
    }
    if (selector.title) {
      for (const m of this.findEpisodesByTitle(selector.title)) {
        push(m.episode, m.category)
      }
    }
    return out
  }

  /**
   * Index a skill in a category — overridden to trigger persistence.
   */
  indexSkill(category: string, skill: SkillRecord): void {
    const index = this.indices.get(category)
    if (!index) {
      this.addCategory(category)
    }
    const targetIndex = this.indices.get(category)!

    if (!targetIndex.skills.some(s => s.definition.meta.id === skill.definition.meta.id)) {
      targetIndex.skills.push(skill)
    }

    this.vectorStore.index({
      id: `sk-${skill.definition.meta.id}`,
      category,
      title: skill.definition.meta.name,
      content: skill.definition.trigger.pattern,
      keywords: skill.definition.trigger.keywords ?? [],
      metadata: { type: "skill", skillId: skill.definition.meta.id },
    })

    this.notifyPersist()
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
    const newIndices = new Map(this.indices)
    for (const cat of categories) {
      if (!newIndices.has(cat)) {
        newIndices.set(cat, { episodes: [], skills: [] })
      }
    }
    this.indices = newIndices
  }

  // ── Private Helpers ──

  private computeKeywordBonus(
    query: string,
    index: { episodes: Episode[]; skills: SkillRecord[] },
    limit: number,
  ): Map<string, number> {
    const q = query.toLowerCase()
    const keywordBonus = new Map<string, number>()
    const kwNeeded = limit + 5

    for (const ep of index.episodes) {
      if (keywordBonus.size >= kwNeeded) break
      const epId = `ep-${ep.id}`
      let bonus = 0
      if (ep.planGoal.toLowerCase().includes(q)) bonus += 3
      if (ep.tags.some(t => q.includes(t) || t.includes(q))) bonus += 2
      if (ep.summary.toLowerCase().includes(q)) bonus += 1
      if (bonus > 0) keywordBonus.set(epId, bonus)
    }
    for (const sk of index.skills) {
      if (keywordBonus.size >= kwNeeded) break
      const skId = `sk-${sk.definition.meta.id}`
      let bonus = 0
      if (sk.definition.meta.name.toLowerCase().includes(q)) bonus += 3
      if ((sk.definition.trigger.keywords ?? []).some(k => k.toLowerCase().includes(q))) bonus += 2
      if (bonus > 0) keywordBonus.set(skId, bonus)
    }
    return keywordBonus
  }

  private buildScoredResults(
    tfidfResults: ScoredResult[],
    index: { episodes: Episode[]; skills: SkillRecord[] },
    keywordBonus: Map<string, number>,
    category: string,
  ): Map<string, { entry: IndexEntry; tfidfScore: number; kwBonus: number }> {
    const scoredMap = new Map<string, { entry: IndexEntry; tfidfScore: number; kwBonus: number }>()

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
      keywordBonus.delete(id)
    }

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

    return scoredMap
  }

  private normalizeResults(
    scoredMap: Map<string, { entry: IndexEntry; tfidfScore: number; kwBonus: number }>,
  ): void {
    for (const [_id, data] of scoredMap) {
      const tfidf = data.tfidfScore
      const kw = data.kwBonus

      const maxTfidf = Math.max(...[...scoredMap.values()].map(v => v.tfidfScore), 1)
      const normTfidf = tfidf / maxTfidf

      const maxKw = Math.max(...[...scoredMap.values()].map(v => v.kwBonus), 1)
      const normKw = kw / maxKw

      const combined = (0.7 * normTfidf) + (0.3 * normKw)

      data.entry.hybridScore = combined
      data.entry.tfidfScore = tfidf
    }
  }

  private sortAndLimitResults(
    scoredMap: Map<string, { entry: IndexEntry; tfidfScore: number; kwBonus: number }>,
    limit: number,
    category: string,
    query: string,
  ): IndexSearchResult {
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

  // ── Search ──

  /**
   * Search by exact title match within a category — untuk dedup check.
   * Returns the first matching entry, or undefined.
   */
  searchByTitle(title: string, category?: string): IndexEntry | undefined {
    for (const [cat, index] of this.indices) {
      if (category && cat !== category) continue
      for (const ep of index.episodes) {
        if (ep.planGoal === title) {
          return { category: cat, episode: ep, timestamp: ep.timestamp, keywords: ep.tags, title: ep.planGoal }
        }
      }
      for (const sk of index.skills) {
        if (sk.definition.meta.name === title) {
          return { category: cat, skill: sk, timestamp: sk.lastUsed, keywords: sk.definition.trigger.keywords ?? [], title: sk.definition.meta.name }
        }
      }
    }
    return undefined
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

    // 2. Keyword bonus for items TF-IDF missed
    const keywordBonus = this.computeKeywordBonus(query, index, limit)

    // 3. Build scored result map
    const scoredMap = this.buildScoredResults(tfidfResults, index, keywordBonus, category)

    // 4. Vector scores are computed asynchronously via enrichWithVectors().
    //    The sync path uses TF-IDF + keyword bonus only.
    //    This keeps searchByCategory synchronous and fast.

    // 5. Normalize and compute combined scores
    this.normalizeResults(scoredMap)

    // 6. Sort and limit
    return this.sortAndLimitResults(scoredMap, limit, category, query)
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
   * Async variant of searchByCategory — adds vector similarity enrichment
   * if an embedder is configured. Falls back to sync TF-IDF search otherwise.
   */
  async searchByCategoryAsync(query: string, category: string, limit = 10): Promise<IndexSearchResult> {
    const result = this.searchByCategory(query, category, limit)

    // Enrich with vector scores if embedder is available
    if (this.embedder && result.entries.length > 0) {
      try {
        const enriched = await enrichWithVectors(this.embedder, [result], query, this.config.keywordWeight, this.config.vectorWeight)
        return enriched[0] ?? result
      } catch {
        // Partial vector fallback: TF-IDF results already populated
        return result
      }
    }

    return result
  }

  /**
   * Async variant of searchAll — adds vector similarity enrichment
   * if an embedder is configured. Falls back to sync TF-IDF search otherwise.
   */
  async searchAllAsync(query: string, limit = 10): Promise<IndexSearchResult[]> {
    const results = this.searchAll(query, limit)

    // Enrich with vector scores if embedder is available
    if (this.embedder && results.length > 0) {
      return enrichWithVectors(this.embedder, results, query, this.config.keywordWeight, this.config.vectorWeight)
    }

    return results
  }

  // ── Confidence ──

  private computeConfidenceMetrics(
    entries: IndexEntry[],
  ): { averageConfidence: number; topConfidence: number; hasHighConfidence: boolean; isEmpty: boolean } {
    const confidences = entries.map(e => e.confidence ?? 0)
    const averageConfidence = confidences.length > 0
      ? confidences.reduce((s, c) => s + c, 0) / confidences.length
      : 0
    const topConfidence = confidences.length > 0 ? Math.max(...confidences) : 0

    return {
      averageConfidence,
      topConfidence,
      hasHighConfidence: topConfidence >= 0.6,
      isEmpty: entries.length === 0,
    }
  }

  /**
   * Search with confidence scoring — designed for knowledge-first injection.
   *
   * Searches across all (or specific) categories and returns results with:
   * - Per-entry confidence scores (0.0–1.0)
   * - Aggregate metrics (average, top, hasHighConfidence)
   * - Empty detection for mandatory research flow
   *
   * Confidence heuristic:
   *   hybridScore >= 0.3  → confidence = hybridScore (scaled to 0-1)
   *   hybridScore < 0.3   → confidence = hybridScore * 0.5 (penalized)
   *   No results           → confidence = 0.0
   *
   * Thresholds: >= 0.8 = HIGH, >= 0.6 = MEDIUM, >= 0.3 = LOW, < 0.3 = UNKNOWN
   */
  async searchWithConfidence(query: string, categories?: string[], limit = 5): Promise<SearchWithConfidenceResult> {
    const cats = categories && categories.length > 0
      ? categories
      : [...this.indices.keys()]

    const allResults: IndexEntry[] = []

    for (const cat of cats) {
      if (!this.indices.has(cat)) continue
      let catResult: IndexSearchResult

      if (this.embedder) {
        catResult = await this.searchByCategoryAsync(query, cat, limit)
      } else {
        catResult = this.searchByCategory(query, cat, limit)
      }

      for (const entry of catResult.entries) {
        const rawScore = entry.hybridScore ?? 0
        const baseConfidence = rawScore >= 0.3 ? rawScore : rawScore * 0.5

        // Quality-weighted confidence (SCIM-inspired):
        // final = confidence * 0.6 + qualityScore * 0.3 + (1 - staleness) * 0.1
        const qualityScore = entry.qualityScore ?? 0.7
        const staleness = entry.stalenessScore ?? 0
        const qualityWeighted = baseConfidence * 0.6 + qualityScore * 0.3 + (1 - staleness) * 0.1

        entry.confidence = Math.min(1, Math.max(0, qualityWeighted))
        allResults.push(entry)
      }
    }

    allResults.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
    const trimmed = allResults.slice(0, limit)

    const metrics = this.computeConfidenceMetrics(trimmed)

    return {
      entries: trimmed,
      ...metrics,
      query,
      categories: cats,
    }
  }

  // ── Category Management ──

  /**
   * Auto-select the best category based on TF-IDF scoring.
   */
  autoCategory(query: string): string {
    const scores = new Map<string, number>()
    const q = query.toLowerCase()
    const domainKeywords: Record<string, string[]> = {
      automotive: ["car", "vehicle", "engine", "motor", "drive", "auto", "wheel", "transmission", "brake", "fuel"],
      financial: ["money", "bank", "finance", "account", "payment", "credit", "loan", "tax", "invest", "budget"],
      tech: ["code", "software", "api", "function", "bug", "deploy", "server", "database", "app", "web", "config", "script"],
      personal: ["user", "profile", "name", "email", "setting", "preference", "login", "password", "auth"],
    }

    for (const [category] of this.indices) {
      const results = this.vectorStore.search(query, category, 5)
      let score = results.reduce((s, r) => s + r.score, 0)

      // Category name bonus
      if (q.includes(category)) {
        score += 2
      }

      // Domain keyword heuristic
      const kws = domainKeywords[category]
      if (kws) {
        for (const kw of kws) {
          if (q.includes(kw)) {
            score += 1.5
          }
        }
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
   * List all entries across all categories (no search query needed).
   * Returns a flat array of all episodes and skills organized by category.
   */
  listAll(category?: string): { category: string; entries: IndexEntry[] }[] {
    const result: { category: string; entries: IndexEntry[] }[] = []

    for (const [cat, index] of this.indices) {
      if (category && cat !== category) continue

      const entries: IndexEntry[] = []

      for (const ep of index.episodes) {
        entries.push({
          category: cat,
          episode: ep,
          timestamp: ep.timestamp,
          keywords: ep.tags,
          title: ep.planGoal,
        })
      }

      for (const sk of index.skills) {
        entries.push({
          category: cat,
          skill: sk,
          timestamp: sk.definition.audit.createdAt,
          keywords: sk.definition.trigger.keywords ?? [],
          title: sk.definition.meta.name,
        })
      }

      result.push({ category: cat, entries })
    }

    return result
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

  // ── Import/Export ──

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
   * Hapus semua data di satu kategori (episodes, skills, TF-IDF docs).
   */
  clearCategory(category: string): void {
    const idx = this.indices.get(category)
    if (!idx) return
    idx.episodes = []
    idx.skills = []
    const docs = this.vectorStore.exportAll().filter(d => d.category === category)
    for (const doc of docs) {
      this.vectorStore.remove(doc.id)
    }
    this.notifyPersist()
  }

  /**
   * Prune low-quality RAG entries: kortom summary/konten, entry rutin >30 hari.
   * Returns number of entries removed.
   */
  pruneEntries(minContentLength = 20, routineMaxAgeDays = 30): number {
    let removed = 0
    const now = Date.now()
    for (const [, idx] of this.indices) {
      idx.episodes = idx.episodes.filter(ep => {
        // Hapus entry dengan summary terlalu pendek
        if (ep.summary.trim().length < minContentLength) {
          this.vectorStore.remove(`ep-${ep.id}`)
          removed++
          return false
        }
        // Hapus entry routine > N hari (low-value web fetch artifacts)
        if (ep.significance === "routine" && ep.usageCount === 0) {
          const ageDays = (now - new Date(ep.timestamp).getTime()) / 86400_000
          if (ageDays > routineMaxAgeDays) {
            this.vectorStore.remove(`ep-${ep.id}`)
            removed++
            return false
          }
        }
        return true
      })
    }
    if (removed > 0) this.notifyPersist()
    return removed
  }

  /**
   * Import persisted data.
   */
  importAll(data: IndexData): void {
    for (const [cat, { episodes, skills, tfidfDocs }] of Object.entries(data)) {
      const index = this.indices.get(cat)
      const epSet = new Set(index?.episodes.map(e => e.id) ?? [])
      const skSet = new Set(index?.skills.map(s => s.definition.meta.id) ?? [])
      const dedupedEpisodes = episodes.filter(e => !epSet.has(e.id))
      const dedupedSkills = skills.filter(s => !skSet.has(s.definition.meta.id))
      if (index) {
        index.episodes.push(...dedupedEpisodes)
        index.skills.push(...dedupedSkills)
      } else {
        this.indices.set(cat, { episodes: [...dedupedEpisodes], skills: [...dedupedSkills] })
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
  keywordWeight = 0.3,
  vectorWeight = 0.7,
): Promise<IndexSearchResult[]> {
  const qVec = await embedder.embed(query)

  for (const catResult of results) {
    const enriched = await Promise.all(
      catResult.entries.map(async (entry) => {
        const text = entry.title + " " + entry.keywords.join(" ")
        const docVec = await embedder.embed(text)
        const sim = embedder.cosineSimilarity(qVec.vector, docVec.vector)
        entry.vectorScore = sim
        entry.hybridScore = (entry.hybridScore ?? 0) * keywordWeight + sim * vectorWeight
        return entry
      })
    )
    catResult.entries = enriched
    catResult.entries.sort((a, b) => (b.hybridScore ?? 0) - (a.hybridScore ?? 0))
  }

  return results
}
