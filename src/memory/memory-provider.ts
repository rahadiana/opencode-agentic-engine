/**
 * MemoryProvider — Pluggable memory backend interface.
 *
 * Inspired by Hermes Agent's ``MemoryProvider`` abstract base class
 * (agent/memory_provider.py). Allows external memory backends (vector
 * DBs, cloud services, local stores) to plug into the agent's memory
 * lifecycle without modifying core orchestration logic.
 *
 * Lifecycle:
 *   initialize() → prefetch() before each turn → syncTurn() after
 *   each turn → query/store at runtime → shutdown() on cleanup.
 *
 * BuiltInMemoryProvider wraps the existing 4-level memory hierarchy
 * as the default provider — zero-config backward compatibility.
 */

// ── Abstract Interface ────────────────────────────────────────────

export interface PrefetchOptions {
  /** Maximum number of results */
  maxResults?: number
  /** Minimum importance threshold (0–1) */
  minImportance?: number
  /** Specific memory levels to search */
  levels?: string[]
}

export interface MemoryProviderStoreData {
  id: string
  content: string
  keywords?: string[]
  importance?: number
  sourceSession?: string
  metadata?: Record<string, unknown>
}

export interface MemoryProviderQueryResult {
  entries: Array<{
    id: string
    content: string
    keywords: string[]
    importance: number
    createdAt: number
    lastAccessed: number
    accessCount: number
    sourceSession?: string
    metadata?: Record<string, unknown>
  }>
  totalTime: number
  sources: string[]
}

export interface MemoryProvider {
  /** Short identifier for this provider (e.g. "builtin", "honcho", "mem0") */
  readonly name: string

  /** Whether this provider is ready (credentials, deps, network) */
  isAvailable(): boolean

  /**
   * Initialize for a session. Called once at agent startup.
   * May create resources, establish connections, warm caches.
   */
  initialize(sessionId: string, config?: Record<string, unknown>): Promise<void>

  /**
   * Recall relevant context for the upcoming turn.
   * Called BEFORE each API call — should be fast.
   * Return formatted text to inject as context, or empty string.
   */
  prefetch(query: string, opts?: PrefetchOptions): Promise<string>

  /**
   * Persist a completed turn to the backend.
   * Called AFTER each turn completes. Should be non-blocking.
   */
  syncTurn(userContent: string, assistantContent: string, meta?: Record<string, unknown>): Promise<void>

  /**
   * Search memory across all levels.
   */
  query(queryText: string, opts?: PrefetchOptions): Promise<MemoryProviderQueryResult>

  /**
   * Store data at the appropriate memory level.
   */
  store(level: string, data: MemoryProviderStoreData): Promise<void>

  /**
   * Clean shutdown — flush queues, close connections, save state.
   */
  shutdown(): Promise<void>
}

// ── Default no-op provider for testing ─────────────────────────────

export class NoOpMemoryProvider implements MemoryProvider {
  readonly name = "noop"

  isAvailable(): boolean { return true }
  async initialize(): Promise<void> { /* no-op */ }
  async prefetch(): Promise<string> { return "" }
  async syncTurn(): Promise<void> { /* no-op */ }
  async query(): Promise<MemoryProviderQueryResult> { return { entries: [], totalTime: 0, sources: [] } }
  async store(): Promise<void> { /* no-op */ }
  async shutdown(): Promise<void> { /* no-op */ }
}
