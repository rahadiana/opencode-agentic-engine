/**
 * Local Embedder — generates vector embeddings via LLM provider.
 *
 * Supports:
 * - OpenAI-compatible embedding endpoints (text-embedding-3-small, etc.)
 * - Any OpenAI-compatible provider (OpenCode, Ollama, vLLM, etc.)
 * - Local fallback: simple hash-based embeddings for zero-dependency mode
 *
 * Config via env vars:
 *   EMBEDDING_MODEL=text-embedding-3-small   (default: text-embedding-3-small)
 *   EMBEDDING_ENDPOINT=https://...            (default: inferred from LLM provider)
 *   EMBEDDING_API_KEY=sk-...                  (default: LLM API key)
 */

import { createLogger } from "../observability/logger.js"

const log = createLogger("Embedder")

export interface EmbedderConfig {
  /** Model name for embedding (default: "text-embedding-3-small") */
  model?: string
  /** API endpoint for embedding service. Set to null or "" to use local hash fallback.
   *  Common providers:
   *  - OpenAI: "https://api.openai.com/v1/embeddings"
   *  - Ollama (local): "http://localhost:11434/v1/embeddings"
   *  - Any OpenAI-compatible embedding endpoint
   */
  endpoint?: string | null
  /** API key (required for OpenAI; not needed for local providers like Ollama) */
  apiKey?: string | null
  /** Dimension of the embedding vectors (default: 256 for local fallback) */
  dimension?: number
}

export interface EmbeddingResult {
  vector: number[]
  model: string
  dimensions: number
}

const FALLBACK_DIMENSION = 64

/**
 * Simple hash-based embedding for zero-dependency fallback.
 * Not semantically meaningful but consistent — same text → same vector.
 * Good-enough for basic similarity matching.
 */
function hashEmbedding(text: string, dim: number): number[] {
  const vec = new Array(dim).fill(0)
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean)

  for (const word of words) {
    let hash = 0
    for (let i = 0; i < word.length; i++) {
      hash = ((hash << 5) - hash) + word.charCodeAt(i)
      hash = hash & hash // Convert to 32-bit int
    }
    const idx = Math.abs(hash) % dim
    vec[idx] += 1.0 / words.length
  }

  // Normalize
  const magnitude = Math.sqrt(vec.reduce((s, v) => s + v * v, 0))
  if (magnitude > 0) {
    for (let i = 0; i < dim; i++) vec[i] /= magnitude
  }

  return vec
}

function simpleHash(text: string): string {
  let h = 0
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) - h) + text.charCodeAt(i)
    h = h & h
  }
  return Math.abs(h).toString(36)
}

export class LocalEmbedder {
  private config: Required<EmbedderConfig>
  private cache = new Map<string, { result: EmbeddingResult; ts: number }>()
  private maxCacheSize: number
  private maxCacheAgeMs: number
  private httpCall: (url: string, apiKey: string, body: unknown) => Promise<unknown>
  private ttlTimer?: ReturnType<typeof setInterval>

  constructor(
    config: EmbedderConfig = {},
    httpCall?: (url: string, apiKey: string, body: unknown) => Promise<unknown>,
    maxCacheSize = 500,
    maxCacheAgeMs = 300000,
  ) {
    this.config = {
      model: config.model ?? "text-embedding-3-small",
      endpoint: config.endpoint ?? null,
      apiKey: config.apiKey ?? null,
      dimension: config.dimension ?? FALLBACK_DIMENSION,
    }
    this.maxCacheSize = maxCacheSize
    this.maxCacheAgeMs = maxCacheAgeMs
    this.httpCall = httpCall ?? this.defaultHttpCall
    this.ttlTimer = setInterval(() => this.pruneExpired(), 60000)
    if (this.ttlTimer) this.ttlTimer.unref()
  }

  private async defaultHttpCall(url: string, apiKey: string, body: unknown): Promise<unknown> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "")
      throw new Error(`Embedding API error ${resp.status}: ${errText.slice(0, 200)}`)
    }
    return resp.json()
  }

  private hashCacheKey(text: string): string {
    return `${this.config.model}:${simpleHash(text)}:${text.length}`
  }

  private pruneCache(): void {
    if (this.cache.size <= this.maxCacheSize) return
    const toDelete = this.cache.size - this.maxCacheSize
    const keys = [...this.cache.keys()]
    for (let i = 0; i < toDelete; i++) {
      this.cache.delete(keys[i])
    }
  }

  private pruneExpired(): void {
    const now = Date.now()
    for (const [key, entry] of this.cache) {
      if (now - entry.ts > this.maxCacheAgeMs) {
        this.cache.delete(key)
      }
    }
  }

  /**
   * Embed a single text string.
   */
  async embed(text: string): Promise<EmbeddingResult> {
    const cacheKey = this.hashCacheKey(text)
    const cached = this.cache.get(cacheKey)
    if (cached) return cached.result

    // Try remote embedding endpoint
    if (this.config.endpoint !== null || this.config.apiKey !== null) {
      try {
        return await this.remoteEmbed(text)
      } catch (e) {
        log.warn(`remote embedding failed, falling back to hash`, { error: e })
      }
    }

    // Local hash-based fallback
    const result: EmbeddingResult = {
      vector: hashEmbedding(text, this.config.dimension),
      model: "hash-fallback",
      dimensions: this.config.dimension,
    }
    this.cache.set(cacheKey, { result, ts: Date.now() })
    this.pruneCache()
    return result
  }

  /**
   * Embed multiple texts in batch.
   */
  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    // Try remote batch embedding
    if (this.config.endpoint !== null || this.config.apiKey !== null) {
      try {
        const endpoint = this.config.endpoint ?? "https://api.openai.com/v1/embeddings"
        const apiKey = this.config.apiKey ?? process.env.OPENAI_API_KEY ?? ""
        const data = await this.httpCall(endpoint, apiKey, {
          model: this.config.model,
          input: texts,
        }) as { data?: Array<{ embedding: number[] }> }

        if (data.data && Array.isArray(data.data)) {
          const results = data.data.map(d => ({
            vector: d.embedding,
            model: this.config.model,
            dimensions: d.embedding.length,
          }))
          for (let i = 0; i < texts.length && i < results.length; i++) {
            const ck = this.hashCacheKey(texts[i])
            this.cache.set(ck, { result: results[i], ts: Date.now() })
          }
          this.pruneCache()
          return results
        }
      } catch (e) {
        log.warn(`batch embedding failed, falling back to hash`, { error: e })
      }
    }

    // Batch hash embedding: compute all hashes in one loop
    const results = texts.map(t => ({
      vector: hashEmbedding(t, this.config.dimension),
      model: "hash-fallback" as const,
      dimensions: this.config.dimension,
    }))
    for (let i = 0; i < texts.length; i++) {
      const ck = this.hashCacheKey(texts[i])
      this.cache.set(ck, { result: results[i], ts: Date.now() })
    }
    this.pruneCache()
    return results
  }

  private async remoteEmbed(text: string): Promise<EmbeddingResult> {
    const endpoint = this.config.endpoint ?? "https://api.openai.com/v1/embeddings"
    const apiKey = this.config.apiKey ?? process.env.OPENAI_API_KEY ?? ""

    if (!apiKey) throw new Error("No API key for remote embedding")

    const data = await this.httpCall(endpoint, apiKey, {
      model: this.config.model,
      input: text,
    }) as { data?: Array<{ embedding: number[] }> }

    if (!data.data?.[0]?.embedding) {
      throw new Error("Invalid embedding response")
    }

    const result: EmbeddingResult = {
      vector: data.data[0].embedding,
      model: this.config.model,
      dimensions: data.data[0].embedding.length,
    }

    const cacheKey = this.hashCacheKey(text)
    this.cache.set(cacheKey, { result, ts: Date.now() })
    this.pruneCache()
    return result
  }

  /**
   * Compute cosine similarity between two vectors.
   */
  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0
    let dot = 0, magA = 0, magB = 0
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i]
      magA += a[i] * a[i]
      magB += b[i] * b[i]
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB)
    return denom === 0 ? 0 : dot / denom
  }

  clearCache(): void {
    this.cache.clear()
  }

  destroy(): void {
    if (this.ttlTimer) clearInterval(this.ttlTimer)
  }
}
