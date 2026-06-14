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

interface DocumentEntry {
  id: string
  content: string
  metadata: DocumentMeta
  tokens: string[]
  tokenFreq: Map<string, number>
}

export class VectorStore {
  private documents: Map<string, DocumentEntry> = new Map()
  private vocabulary: Map<string, number> = new Map()
  private searchCache: Map<string, SearchResult[]> = new Map()
  private maxCacheSize = 100

  addDocument(id: string, content: string, metadata: DocumentMeta): void {
    const tokens = this.tokenize(content)
    const tokenFreq = new Map<string, number>()
    for (const t of tokens) {
      tokenFreq.set(t, (tokenFreq.get(t) ?? 0) + 1)
    }

    const existing = this.documents.get(id)
    if (existing) {
      for (const t of existing.tokens) {
        this.decrementVocab(t)
      }
    }

    const entry: DocumentEntry = { id, content, metadata, tokens, tokenFreq }
    this.documents.set(id, entry)

    for (const t of new Set(entry.tokens)) {
      this.vocabulary.set(t, (this.vocabulary.get(t) ?? 0) + 1)
    }

    this.searchCache.clear()
  }

  search(query: string, topK = 5): SearchResult[] {
    const cacheKey = `${query}::${topK}`
    const cached = this.searchCache.get(cacheKey)
    if (cached) return cached

    const queryTokens = this.tokenize(query)
    if (queryTokens.length === 0 || this.documents.size === 0) {
      return []
    }

    const totalDocs = this.documents.size
    const queryTF = new Map<string, number>()
    for (const t of queryTokens) {
      queryTF.set(t, (queryTF.get(t) ?? 0) + 1)
    }

    const queryWeights = new Map<string, number>()
    for (const t of queryTokens) {
      const df = this.vocabulary.get(t) ?? 0
      if (df > 0) {
        const tf = (queryTF.get(t) ?? 0) / queryTokens.length
        const idf = Math.log((totalDocs + 1) / (df + 1)) + 1
        queryWeights.set(t, tf * idf)
      }
    }

    const scores: SearchResult[] = []
    for (const doc of this.documents.values()) {
      const score = this.computeScore(doc, queryTokens, totalDocs, queryWeights)
      if (score > 0) {
        scores.push({
          id: doc.id,
          content: doc.content,
          metadata: { ...doc.metadata },
          score,
        })
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

  searchByType(query: string, type: DocumentType, topK = 5): SearchResult[] {
    const results = this.search(query, topK * 2)
    return results
      .filter(r => r.metadata.type === type)
      .slice(0, topK)
  }

  removeDocument(id: string): boolean {
    const entry = this.documents.get(id)
    if (!entry) return false

    for (const t of new Set(entry.tokens)) {
      this.decrementVocab(t)
    }

    this.documents.delete(id)
    this.searchCache.clear()
    return true
  }

  getVocabulary(): Map<string, number> {
    return new Map(this.vocabulary)
  }

  size(): number {
    return this.documents.size
  }

  clear(): void {
    this.documents.clear()
    this.vocabulary.clear()
    this.searchCache.clear()
  }

  clearCache(): void {
    this.searchCache.clear()
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .filter(t => t.length > 1 && !STOP_WORDS.has(t))
  }

  private decrementVocab(term: string): void {
    const count = this.vocabulary.get(term)
    if (count !== undefined) {
      if (count <= 1) {
        this.vocabulary.delete(term)
      } else {
        this.vocabulary.set(term, count - 1)
      }
    }
  }

  private computeScore(
    doc: DocumentEntry,
    queryTokens: string[],
    totalDocs: number,
    queryWeights: Map<string, number>,
  ): number {
    let score = 0
    const docLen = doc.tokens.length
    if (docLen === 0) return 0

    for (const qt of queryTokens) {
      const tf = (doc.tokenFreq.get(qt) ?? 0) / docLen
      if (tf === 0) continue

      const df = this.vocabulary.get(qt) ?? 0
      const idf = Math.log((totalDocs + 1) / (df + 1)) + 1
      const qw = queryWeights.get(qt) ?? 0

      score += tf * idf * qw
    }

    return score / Math.sqrt(queryTokens.length)
  }
}
