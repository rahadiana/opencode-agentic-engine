import type { LLMEngine } from "../core/llm.js"
import type { LocalEmbedder } from "./local-embedder.js"
import { createRequire } from "node:module"

const _require = createRequire(import.meta.url)

export type DocumentType = "episode" | "skill" | "file" | "code"

export interface DocumentMeta {
  type: DocumentType
  sessionId?: string
  tags?: string[]
  [key: string]: unknown
}

export interface SearchResult {
  id: string
  content: string
  metadata: DocumentMeta
  score: number
}

export type SearchMode = "sparse" | "dense" | "hybrid" | "llm-rerank"

/**
 * Stop words dari package `stopword` (62 bahasa, zero deps).
 * Di-load lazy via require — esbuild akan bundle seluruh package.
 */
let stopWordModule: Record<string, string[]> | null = null
let stopWordLoadAttempted = false

function loadStopWords(): Record<string, string[]> | null {
  if (stopWordLoadAttempted) return stopWordModule
  stopWordLoadAttempted = true
  try {
    stopWordModule = _require("stopword") as Record<string, string[]>
  } catch {
    stopWordModule = null
  }
  return stopWordModule
}

const combinedStopCache = new Map<string, Set<string>>()

function getStopWordSet(langs: string[]): Set<string> {
  const key = [...langs].sort().join(",")
  const cached = combinedStopCache.get(key)
  if (cached) return cached

  const mod = loadStopWords()
  const words = new Set<string>()

  if (mod) {
    for (const lang of langs) {
      const arr = mod[lang]
      if (Array.isArray(arr)) {
        for (const w of arr) words.add(w)
      }
    }
  }

  // Fallback: minimal English + Indonesian stop words built-in
  if (words.size === 0) {
    const FALLBACK = new Set([
      "yang", "dan", "di", "ke", "dari", "ini", "itu", "dan", "atau",
      "tidak", "adalah", "akan", "dengan", "untuk", "pada", "dalam",
      "the", "and", "is", "are", "was", "were", "be", "been",
      "a", "an", "to", "for", "of", "in", "on", "at", "by", "with",
      "this", "that", "these", "those", "it", "its", "we", "our",
      "you", "your", "they", "them", "their", "i", "me", "my",
    ])
    for (const w of FALLBACK) words.add(w)
  }

  combinedStopCache.set(key, words)
  return words
}

interface VectorEntry {
  id: string
  content: string
  metadata: DocumentMeta
  tfidf: Map<string, number>
  norm: number
  dense?: Float32Array
}

export class VectorStore {
  private documents: Map<string, VectorEntry> = new Map()
  private vocabulary: Map<string, number> = new Map()
  private maxCacheSize = 100
  private searchCache: Map<string, SearchResult[]> = new Map()
  private semanticCache: Map<string, SearchResult[]> = new Map()
  private llmEngine: LLMEngine | null = null
  private embedder: LocalEmbedder | null = null
  private embedQueue: Array<{ id: string; content: string }> = []
  private embedProcessing = false
  /** Search weights — from config */
  private keywordWeight = 0.3
  private vectorWeight = 0.7
  /** Remote embedding config — dari config, bukan local embedder */
  private remoteEmbedModel: string | null = null
  private remoteEmbedEndpoint: string | null = null
  private remoteEmbedApiKey: string | null = null
  /** ISO 639-3 language codes for stop word filtering */
  private stopWordsLanguages: string[] = ["ind", "eng"]

  setLLM(llm: LLMEngine): void {
    this.llmEngine = llm
  }

  setEmbedder(embedder: LocalEmbedder): void {
    this.embedder = embedder
  }

  /** Set search weights from config — menggantikan hardcoded alpha */
  setSearchWeights(keyword: number, vector: number): void {
    this.keywordWeight = keyword
    this.vectorWeight = vector
  }

  /** Set remote embedding config — untuk full vector mode */
  setEmbeddingConfig(model: string, endpoint: string | null, apiKey: string | null): void {
    this.remoteEmbedModel = model
    this.remoteEmbedEndpoint = endpoint
    this.remoteEmbedApiKey = apiKey
  }

  /** Set stop word languages — dari config */
  setStopWordsLanguages(langs: string[]): void {
    if (langs.length > 0) this.stopWordsLanguages = langs
  }

  /** Get remote embedding config */
  getEmbeddingConfig(): { model: string; endpoint: string | null; apiKey: string | null } | null {
    if (!this.remoteEmbedModel) return null
    return { model: this.remoteEmbedModel, endpoint: this.remoteEmbedEndpoint, apiKey: this.remoteEmbedApiKey }
  }

  private queueDenseEmbed(id: string, content: string): void {
    if (!this.embedder) return
    this.embedQueue.push({ id, content })
    this.processEmbedQueue()
  }

  private async processEmbedQueue(): Promise<void> {
    if (this.embedProcessing || !this.embedder) return
    this.embedProcessing = true

    while (this.embedQueue.length > 0) {
      const batch = this.embedQueue.splice(0, 5)
      await Promise.all(batch.map(async ({ id, content }) => {
        try {
          const vec = await this.embedder!.embed(content)
          if (vec) {
            const doc = this.documents.get(id)
            if (doc) doc.dense = vec
          }
        } catch { /* skip failed embeddings */ }
      }))
    }

    this.embedProcessing = false
  }

  addDocument(id: string, content: string, metadata: DocumentMeta): void {
    const tokens = this.tokenize(content)
    const tf = new Map<string, number>()
    for (const t of tokens) {
      tf.set(t, (tf.get(t) ?? 0) + 1)
    }

    const existing = this.documents.get(id)
    if (existing) {
      for (const t of existing.tfidf.keys()) {
        const prev = this.vocabulary.get(t)
        if (prev !== undefined) {
          if (prev <= 1) this.vocabulary.delete(t)
          else this.vocabulary.set(t, prev - 1)
        }
      }
    }

    const tfs = tokenFreqToTF(tokens, tf)
    const totalDocs = this.documents.size + 1
    const tfidf = new Map<string, number>()
    for (const [term, tfVal] of tfs) {
      const df = (this.vocabulary.get(term) ?? 0) + 1
      const idf = Math.log((totalDocs) / df) + 1
      if (idf > 0) tfidf.set(term, tfVal * idf)
    }

    let norm = 0
    for (const v of tfidf.values()) norm += v * v
    norm = Math.sqrt(norm)

    this.documents.set(id, { id, content, metadata, tfidf, norm })

    for (const t of tokens) {
      this.vocabulary.set(t, (this.vocabulary.get(t) ?? 0) + 1)
    }

    this.searchCache.clear()
    this.semanticCache.clear()

    this.queueDenseEmbed(id, content)
  }

  search(query: string, topK = 5): SearchResult[] {
    return this.sparseSearch(query, topK)
  }

  async searchWithMode(query: string, topK = 5, mode: SearchMode = "hybrid"): Promise<SearchResult[]> {
    const cacheKey = `${mode}::${query}::${topK}`
    const cached = this.searchCache.get(cacheKey)
    if (cached) return cached

    if (this.documents.size === 0) return []

    let results: SearchResult[]

    switch (mode) {
      case "dense":
        results = await this.denseSearch(query, topK)
        break
      case "hybrid":
        results = await this.hybridSearch(query, topK)
        break
      case "sparse":
      default:
        results = this.sparseSearch(query, topK)
        break
    }

    if (this.searchCache.size >= this.maxCacheSize) {
      const firstKey = this.searchCache.keys().next().value
      if (firstKey !== undefined) this.searchCache.delete(firstKey)
    }
    this.searchCache.set(cacheKey, results)

    return results
  }

  private sparseSearch(query: string, topK: number): SearchResult[] {
    const queryTokens = this.tokenize(query)
    if (queryTokens.length === 0) return []

    const queryTF = new Map<string, number>()
    for (const t of queryTokens) {
      queryTF.set(t, (queryTF.get(t) ?? 0) + 1)
    }
    const qTf = tokenFreqToTF(queryTokens, queryTF)
    const totalDocs = this.documents.size

    let qNorm = 0
    const qWeight = new Map<string, number>()
    for (const [term, tfVal] of qTf) {
      const df = this.vocabulary.get(term) ?? 0
      const idf = df > 0 ? Math.log((totalDocs) / df) + 1 : 1
      const w = tfVal * idf
      qWeight.set(term, w)
      qNorm += w * w
    }
    qNorm = Math.sqrt(qNorm)
    if (qNorm === 0) return []

    const scores: SearchResult[] = []
    for (const doc of this.documents.values()) {
      let dot = 0
      for (const [term, qw] of qWeight) {
        const dw = doc.tfidf.get(term)
        if (dw) dot += qw * dw
      }
      const score = doc.norm > 0 ? dot / (qNorm * doc.norm) : 0
      if (score > 0.01) {
        scores.push({ id: doc.id, content: doc.content, metadata: { ...doc.metadata }, score })
      }
    }

    scores.sort((a, b) => b.score - a.score)
    return scores.slice(0, topK)
  }

  private async denseSearch(query: string, topK: number): Promise<SearchResult[]> {
    if (!this.embedder || !this.embedder.ready) {
      return this.sparseSearch(query, topK)
    }

    const hasDense = [...this.documents.values()].some(d => d.dense)
    if (!hasDense) return this.sparseSearch(query, topK)

    const qVec = await this.embedder.embed(query)
    if (!qVec) return this.sparseSearch(query, topK)

    const results: SearchResult[] = []
    for (const doc of this.documents.values()) {
      if (!doc.dense) continue
      let dot = 0, nA = 0, nB = 0
      for (let i = 0; i < doc.dense.length; i++) {
        const qv = qVec[i] ?? 0
        const dv = doc.dense[i] ?? 0
        dot += qv * dv
        nA += qv * qv
        nB += dv * dv
      }
      const sim = Math.sqrt(nA) * Math.sqrt(nB)
      const score = sim === 0 ? 0 : dot / sim
      if (score > 0.1) {
        results.push({ id: doc.id, content: doc.content, metadata: { ...doc.metadata }, score })
      }
    }

    results.sort((a, b) => b.score - a.score)
    return results.slice(0, topK)
  }

  private async hybridSearch(query: string, topK: number): Promise<SearchResult[]> {
    const [denseResults, sparseResults] = await Promise.all([
      this.denseSearch(query, Math.max(topK * 3, 15)),
      Promise.resolve(this.sparseSearch(query, Math.max(topK * 3, 15))),
    ])

    const combined = new Map<string, { sparseScore: number; denseScore: number; result: SearchResult }>()

    const maxSparse = sparseResults[0]?.score ?? 1
    for (const r of sparseResults) {
      combined.set(r.id, { sparseScore: r.score / maxSparse, denseScore: 0, result: r })
    }

    const maxDense = denseResults[0]?.score ?? 1
    for (const r of denseResults) {
      const existing = combined.get(r.id)
      if (existing) {
        existing.denseScore = r.score / maxDense
      } else {
        combined.set(r.id, { sparseScore: 0, denseScore: r.score / maxDense, result: r })
      }
    }

    const alpha = this.keywordWeight
    const results = [...combined.values()]
      .map(({ sparseScore, denseScore, result }) => ({
        ...result,
        score: (this.keywordWeight) * sparseScore + (this.vectorWeight) * denseScore,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)

    return results
  }

  async semanticSearch(query: string, topK = 5): Promise<SearchResult[]> {
    if (this.documents.size === 0) return []

    const cached = this.semanticCache.get(`${query}::${topK}`)
    if (cached) return cached

    const candidateCount = Math.max(topK * 2, 10)
    const hybridResults = await this.hybridSearch(query, candidateCount)

    if (!this.llmEngine || hybridResults.length <= topK) {
      const results = hybridResults.slice(0, topK)
      this.semanticCache.set(`${query}::${topK}`, results)
      return results
    }

    try {
      const docList = hybridResults.map((r, i) => `[${i}] ${r.content.slice(0, 200)}`).join("\n")
      const resp = await this.llmEngine.call({
        systemPrompt: "You are a search relevance ranker. Given a query and a list of documents, rank the documents by relevance. Return ONLY a JSON array of document indices in descending relevance order (most relevant first), e.g. [3, 0, 7].",
        userPrompt: `Query: "${query}"\n\nDocuments:\n${docList}\n\nReturn indices sorted by relevance as JSON array.`,
        jsonMode: true,
        temperature: 0,
        maxTokens: 256,
      })

      const rankings: number[] = JSON.parse(resp.content)
      const reranked: SearchResult[] = []
      const seen = new Set<number>()

      for (const idx of rankings) {
        if (idx >= 0 && idx < hybridResults.length && !seen.has(idx)) {
          reranked.push({ ...hybridResults[idx], score: 1 - reranked.length / rankings.length })
          seen.add(idx)
        }
      }
      for (let i = 0; i < hybridResults.length; i++) {
        if (!seen.has(i)) reranked.push({ ...hybridResults[i], score: 0.1 })
      }

      const results = reranked.slice(0, topK)
      this.semanticCache.set(`${query}::${topK}`, results)
      return results
    } catch {
      const results = hybridResults.slice(0, topK)
      this.semanticCache.set(`${query}::${topK}`, results)
      return results
    }
  }

  searchByType(query: string, type: DocumentType, topK = 5): SearchResult[] {
    const results = this.search(query, topK * 2)
    return results.filter(r => r.metadata.type === type).slice(0, topK)
  }

  async semanticSearchByType(query: string, type: DocumentType, topK = 5): Promise<SearchResult[]> {
    const results = await this.semanticSearch(query, topK * 2)
    return results.filter(r => r.metadata.type === type).slice(0, topK)
  }

  removeDocument(id: string): boolean {
    const entry = this.documents.get(id)
    if (!entry) return false
    for (const t of entry.tfidf.keys()) {
      const prev = this.vocabulary.get(t)
      if (prev !== undefined) {
        if (prev <= 1) this.vocabulary.delete(t)
        else this.vocabulary.set(t, prev - 1)
      }
    }
    this.documents.delete(id)
    this.searchCache.clear()
    this.semanticCache.clear()
    return true
  }

  size(): number { return this.documents.size }
  clear(): void { this.documents.clear(); this.vocabulary.clear(); this.searchCache.clear(); this.semanticCache.clear() }
  clearCache(): void { this.searchCache.clear(); this.semanticCache.clear() }

  private tokenize(text: string): string[] {
    const stopWords = getStopWordSet(this.stopWordsLanguages)
    // Unicode-aware tokenizer: dukung semua script (Latin, Arab, CJK, dll)
    // \p{L} = any Unicode letter, \p{N} = any Unicode number
    return text.toLowerCase()
      .split(/[^\p{L}\p{N}_]+/u)
      .filter(t => t.length > 1 && !stopWords.has(t))
  }
}

function tokenFreqToTF(tokens: string[], tf: Map<string, number>): Map<string, number> {
  const len = tokens.length
  const result = new Map<string, number>()
  for (const [t, c] of tf) {
    result.set(t, c / len)
  }
  return result
}
