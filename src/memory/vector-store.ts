import type { LLMEngine } from "../core/llm.js"

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

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
  "being", "have", "has", "had", "do", "does", "did", "will", "would",
  "could", "should", "may", "might", "shall", "can", "need", "dare",
  "ought", "used", "it", "its", "this", "that", "these", "those",
  "i", "me", "my", "we", "our", "you", "your", "he", "him", "his",
  "she", "her", "they", "them", "their", "what", "which", "who",
  "whom", "when", "where", "why", "how", "all", "each", "every",
  "both", "few", "more", "most", "other", "some", "such", "no",
  "not", "only", "own", "same", "so", "than", "too", "very", "just",
  "about", "above", "after", "again", "also", "as", "before",
  "between", "into", "through", "during", "while", "if", "then",
  "else", "there", "here", "up", "down", "out", "off", "over",
  "under", "now", "new", "any", "get", "set", "put",
])

interface VectorEntry {
  id: string
  content: string
  metadata: DocumentMeta
  tfidf: Map<string, number>
  norm: number
}

export class VectorStore {
  private documents: Map<string, VectorEntry> = new Map()
  private vocabulary: Map<string, number> = new Map()
  private searchCache: Map<string, SearchResult[]> = new Map()
  private maxCacheSize = 100
  private llmEngine: LLMEngine | null = null
  private semanticCache: Map<string, SearchResult[]> = new Map()

  setLLM(llm: LLMEngine): void {
    this.llmEngine = llm
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
  }

  search(query: string, topK = 5): SearchResult[] {
    const cacheKey = `${query}::${topK}`
    const cached = this.searchCache.get(cacheKey)
    if (cached) return cached

    const queryTokens = this.tokenize(query)
    if (queryTokens.length === 0 || this.documents.size === 0) return []

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
    const results = scores.slice(0, topK)

    if (this.searchCache.size >= this.maxCacheSize) {
      const firstKey = this.searchCache.keys().next().value
      if (firstKey !== undefined) this.searchCache.delete(firstKey)
    }
    this.searchCache.set(cacheKey, results)

    return results
  }

  async semanticSearch(query: string, topK = 5): Promise<SearchResult[]> {
    if (this.documents.size === 0) return []

    const cached = this.semanticCache.get(`${query}::${topK}`)
    if (cached) return cached

    // TF-IDF sparse vector cosine similarity retrieval
    const tfidfResults = this.search(query, Math.max(topK * 2, 10))

    if (tfidfResults.length <= topK || !this.llmEngine) {
      const results = tfidfResults.slice(0, topK)
      this.semanticCache.set(`${query}::${topK}`, results)
      return results
    }

    // LLM rerank on top-K results
    try {
      const docList = tfidfResults.map((r, i) => `[${i}] ${r.content.slice(0, 200)}`).join("\n")
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
        if (idx >= 0 && idx < tfidfResults.length && !seen.has(idx)) {
          reranked.push({ ...tfidfResults[idx], score: 1 - reranked.length / rankings.length })
          seen.add(idx)
        }
      }
      for (let i = 0; i < tfidfResults.length; i++) {
        if (!seen.has(i)) reranked.push({ ...tfidfResults[i], score: 0.1 })
      }

      const results = reranked.slice(0, topK)
      this.semanticCache.set(`${query}::${topK}`, results)
      return results
    } catch {
      const results = tfidfResults.slice(0, topK)
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
    return text.toLowerCase().split(/[^a-z0-9_]+/).filter(t => t.length > 1 && !STOP_WORDS.has(t))
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
