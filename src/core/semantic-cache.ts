/**
 * Semantic Cache — Gap #7: Similarity-based LLM response caching.
 *
 * Unlike the exact-match cache in llm.ts (30s TTL, hash-based),
 * this cache uses TF-IDF + cosine similarity to find semantically
 * similar previous queries and return cached responses.
 *
 * Benefits:
 *   - Reduces LLM calls for similar queries (e.g., "fix type error in auth.ts"
 *     and "fix type error in auth.js" share semantics)
 *   - Works across minor prompt variations (wording, formatting, whitespace)
 *   - Complementary to exact-match cache (exact-match checked first)
 *
 * Algorithm:
 *   1. Tokenize query → unigrams + bigrams (Unicode-aware)
 *   2. Compute TF-IDF vector using all cached entries as corpus
 *   3. Cosine similarity against each cached entry's vector
 *   4. Return best match if similarity >= threshold && TTL not expired
 */

export interface LLMResponse {
  text: string
  usage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
    reasoningTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
  }
  metadata?: Record<string, unknown>
}

export interface SemanticCacheEntry {
  /** Original query (systemPrompt + userPrompt) */
  query: string
  /** Cached LLM response */
  response: LLMResponse
  /** When this entry was cached */
  timestamp: number
  /** Tokenized query for fast similarity computation */
  tokens: string[]
}

export interface SemanticCacheConfig {
  /** Maximum number of cached entries (default: 500) */
  maxEntries?: number
  /** Time-to-live per entry in milliseconds (default: 300s = 5 min) */
  ttlMs?: number
  /** Minimum cosine similarity to consider a cache hit (default: 0.7) */
  similarityThreshold?: number
  /** Maximum entries to evict when cache is full (default: 20% of maxEntries) */
  evictFraction?: number
}

// ─── Stop words (subset of the vector-store STOP_WORDS) ───

const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "having", "do", "does", "did", "doing",
  "will", "would", "shall", "should", "may", "might", "must", "can", "could",
  "i", "me", "my", "we", "us", "our", "you", "your", "he", "she", "it", "they", "them",
  "this", "that", "these", "those", "here", "there",
  "in", "on", "at", "to", "for", "of", "with", "from", "by", "as",
  "and", "or", "not", "but", "if", "so", "than", "then", "also", "just",
  "about", "into", "over", "after", "before", "between", "through",
  "am", "an", "no", "up", "out", "all", "any", "each", "every",
  "how", "what", "when", "where", "which", "who", "why",
])

// ─── Tokenizer (Unicode-aware, same approach as vector-store.ts) ───

function tokenize(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOP_WORDS.has(t))

  // Add bigrams for n-gram support
  const bigrams: string[] = []
  for (let i = 0; i < words.length - 1; i++) {
    bigrams.push(`${words[i]}_${words[i + 1]}`)
  }

  return [...words, ...bigrams]
}

// ─── TF-IDF + Cosine Similarity ───

function computeTf(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>()
  for (const t of tokens) {
    tf.set(t, (tf.get(t) ?? 0) + 1)
  }
  return tf
}

function computeIdf(term: string, corpus: Array<{ tokens: string[] }>): number {
  const df = corpus.filter(doc => doc.tokens.includes(term)).length
  return Math.log((corpus.length + 1) / (df + 1)) + 1 // +1 smoothing
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0
  let normA = 0
  let normB = 0

  for (const [term, valueA] of a) {
    const valueB = b.get(term) ?? 0
    dot += valueA * valueB
    normA += valueA * valueA
  }

  for (const [, valueB] of b) {
    normB += valueB * valueB
  }

  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

// ─── SemanticCache ───

export class SemanticCache {
  private entries: SemanticCacheEntry[] = []
  private config: Required<SemanticCacheConfig>
  private hits = 0
  private misses = 0

  constructor(config?: SemanticCacheConfig) {
    this.config = {
      maxEntries: config?.maxEntries ?? 500,
      ttlMs: config?.ttlMs ?? 300_000, // 5 minutes
      similarityThreshold: config?.similarityThreshold ?? 0.78, // Benchmark-optimized: 0 FP at >= 0.78, best F1 at >= 0.78 with zero false positives
      evictFraction: config?.evictFraction ?? 0.2,
    }
  }

  /** Look up a semantically similar query and return cached response if found */
  get(query: string): LLMResponse | null {
    if (!query || this.entries.length === 0) {
      this.misses++
      return null
    }

    const queryTokens = tokenize(query)
    if (queryTokens.length === 0) {
      this.misses++
      return null
    }

    // Build corpus: all non-expired entries + the new query
    const now = Date.now()
    const activeEntries = this.entries.filter(e => (now - e.timestamp) < this.config.ttlMs)

    if (activeEntries.length === 0) {
      this.misses++
      return null
    }

    const corpus = [
      { tokens: queryTokens },
      ...activeEntries,
    ]

    // Compute TF-IDF vector for the query
    const queryTf = computeTf(queryTokens)
    const queryVec = new Map<string, number>()
    for (const [term, count] of queryTf) {
      const idf = computeIdf(term, corpus)
      queryVec.set(term, (count / queryTokens.length) * idf)
    }

    // Find best match
    let bestSimilarity = 0
    let bestEntry: SemanticCacheEntry | null = null

    for (const entry of activeEntries) {
      const entryTf = computeTf(entry.tokens)
      const entryVec = new Map<string, number>()
      for (const [term, count] of entryTf) {
        const idf = computeIdf(term, corpus)
        entryVec.set(term, (count / entry.tokens.length) * idf)
      }

      const similarity = cosineSimilarity(queryVec, entryVec)
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity
        bestEntry = entry
      }
    }

    if (bestEntry && bestSimilarity >= this.config.similarityThreshold) {
      this.hits++
      return bestEntry.response
    }

    this.misses++
    return null
  }

  /** Cache a response for future semantic lookups */
  set(query: string, response: LLMResponse): void {
    if (!query) return

    const tokens = tokenize(query)
    if (tokens.length === 0) return

    // Evict if full
    while (this.entries.length >= this.config.maxEntries) {
      this.evictOldest()
    }

    this.entries.push({
      query,
      response,
      timestamp: Date.now(),
      tokens,
    })
  }

  /** Remove expired entries (called periodically or before stats) */
  prune(): number {
    const now = Date.now()
    const before = this.entries.length
    this.entries = this.entries.filter(e => (now - e.timestamp) < this.config.ttlMs)
    return before - this.entries.length
  }

  /** Clear all cached entries */
  clear(): void {
    this.entries = []
    this.hits = 0
    this.misses = 0
  }

  /** Get cache statistics */
  stats(): { size: number; hits: number; misses: number; hitRate: number } {
    return {
      size: this.entries.length,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits + this.misses > 0
        ? Number((this.hits / (this.hits + this.misses)).toFixed(4))
        : 0,
    }
  }

  /** Number of cached entries (including expired, until prune is called) */
  get size(): number {
    return this.entries.length
  }

  /** Get current config */
  getConfig(): Required<SemanticCacheConfig> {
    return { ...this.config }
  }

  /** Update config at runtime */
  updateConfig(partial: Partial<SemanticCacheConfig>): void {
    if (partial.maxEntries !== undefined) this.config.maxEntries = partial.maxEntries
    if (partial.ttlMs !== undefined) this.config.ttlMs = partial.ttlMs
    if (partial.similarityThreshold !== undefined) this.config.similarityThreshold = partial.similarityThreshold
    if (partial.evictFraction !== undefined) this.config.evictFraction = partial.evictFraction
  }

  // ─── Private helpers ───

  private evictOldest(): void {
    if (this.entries.length === 0) return

    const evictCount = Math.max(1, Math.ceil(this.config.maxEntries * this.config.evictFraction))
    // Evict oldest entries (lowest timestamp)
    this.entries.sort((a, b) => a.timestamp - b.timestamp)
    this.entries.splice(0, Math.min(evictCount, this.entries.length))
  }
}
