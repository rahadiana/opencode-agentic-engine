/**
 * LRUCache — Simple Least Recently Used cache with get, set, and delete.
 *
 * Uses a Map as the underlying store, relying on insertion order for LRU tracking.
 * On access (get/set), the entry is moved to the end (most recently used position).
 * When capacity is exceeded, the least recently used entry (first in Map) is evicted.
 *
 * All operations are O(1) amortized. Note that `get()` uses delete+re-insert
 * to promote entries, which allocates a new Map entry on each hit.
 *
 * ## undefined Ambiguity
 * `get()` returns `undefined` both when a key is missing AND when a key
 * explicitly stores `undefined` as its value. Internally, the cache uses a
 * sentinel symbol to distinguish these cases — so a stored `undefined` IS
 * a real entry that consumes capacity and participates in eviction.
 *
 * ## Recency Semantics
 * - `get(key)` — promotes to MRU on hit
 * - `set(key, value)` — promotes to MRU (update or insert)
 * - `peek(key)` — does NOT promote (read-only)
 * - `has(key)` — does NOT promote (read-only lookup)
 * - `delete(key)` — removes entry, does not affect other entries' order
 */

/** Sentinel used internally to distinguish a stored `undefined` from a cache miss. */
const _ABSENT = Symbol('LRUCache_absent')

export interface LRUCacheOptions {
  /** Maximum number of entries before eviction (default: 100). Must be a positive integer. */
  maxSize?: number
}

export class LRUCache<K, V> {
  private map: Map<K, V | typeof _ABSENT>
  private maxSize: number

  constructor(options?: LRUCacheOptions) {
    this.maxSize = options?.maxSize ?? 100
    if (!Number.isInteger(this.maxSize) || this.maxSize < 1) {
      throw new Error(
        `LRUCache: maxSize must be a positive integer, got ${this.maxSize}`
      )
    }
    this.map = new Map<K, V | typeof _ABSENT>()
  }

  /**
   * Get a value by key and promote it to most recently used.
   *
   * Returns `undefined` in two cases:
   * 1. The key does not exist in the cache (cache miss).
   * 2. The key exists but its stored value is `undefined`.
   *
   * To distinguish between these cases, use `has(key)` before `get(key)`,
   * or use `peek(key)` for a non-promoting read.
   */
  get(key: K): V | undefined {
    if (!this.map.has(key)) {
      return undefined
    }
    // Move to end (most recently used) by delete+re-insert
    const stored = this.map.get(key) as V | typeof _ABSENT
    this.map.delete(key)
    this.map.set(key, stored)
    return stored === _ABSENT ? undefined : (stored as V)
  }

  /**
   * Set a key-value pair.
   *
   * If the key already exists, updates the value and marks it as recently used.
   * If the cache is full and the key is new, evicts the least recently used entry.
   * Storing `undefined` as a value is supported — the entry still occupies capacity.
   */
  set(key: K, value: V): void {
    // If key exists, delete first so re-insert moves to end
    if (this.map.has(key)) {
      this.map.delete(key)
    }

    // Evict LRU if at capacity (and we're adding a new key, not updating)
    if (this.map.size >= this.maxSize) {
      const oldestKey = this.map.keys().next().value
      if (oldestKey !== undefined && oldestKey !== key) {
        this.map.delete(oldestKey)
      }
    }

    // Store sentinel for undefined values so we can distinguish from cache miss
    this.map.set(key, value === undefined ? _ABSENT : value)
  }

  /**
   * Delete a key-value pair from the cache.
   * Returns true if the key existed and was deleted, false otherwise.
   */
  delete(key: K): boolean {
    return this.map.delete(key)
  }

  /**
   * Check if a key exists in the cache.
   *
   * NOTE: Does NOT update recency/LRU order. This is a pure read-only lookup.
   * Returns `true` even if the stored value is `undefined`.
   */
  has(key: K): boolean {
    return this.map.has(key)
  }

  /**
   * Get a value by key WITHOUT promoting it to most recently used.
   *
   * Returns `undefined` if the key does not exist OR if the stored value is undefined.
   * Use `has(key)` to check existence separately.
   */
  peek(key: K): V | undefined {
    if (!this.map.has(key)) {
      return undefined
    }
    const stored = this.map.get(key) as V | typeof _ABSENT
    return stored === _ABSENT ? undefined : (stored as V)
  }

  /**
   * Get the current number of entries in the cache.
   */
  get size(): number {
    return this.map.size
  }

  /**
   * Get the maximum capacity of the cache.
   */
  get capacity(): number {
    return this.maxSize
  }

  /**
   * Clear all entries from the cache.
   */
  clear(): void {
    this.map.clear()
  }

  /**
   * Get all keys in order from least to most recently used.
   */
  keys(): K[] {
    return [...this.map.keys()]
  }

  /**
   * Get all values in order from least to most recently used.
   * Entries with a stored `undefined` value are included as `undefined`
   * in the resulting array.
   */
  values(): V[] {
    return [...this.map.values()].map(v =>
      v === _ABSENT ? (undefined as unknown as V) : (v as V)
    )
  }

  /**
   * Get all entries in order from least to most recently used.
   */
  entries(): Array<[K, V]> {
    return [...this.map.entries()].map(([k, v]) => [
      k,
      v === _ABSENT ? (undefined as unknown as V) : (v as V),
    ])
  }
}
