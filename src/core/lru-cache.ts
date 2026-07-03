/**
 * LRUCache — Simple Least Recently Used cache with get, set, and delete.
 *
 * Uses a Map as the underlying store, relying on insertion order for LRU tracking.
 * On access (get/set), the entry is moved to the end (most recently used position).
 * When capacity is exceeded, the least recently used entry (first in Map) is evicted.
 *
 * All operations are O(1) amortized.
 */

export interface LRUCacheOptions {
  /** Maximum number of entries before eviction (default: 100) */
  maxSize?: number
}

export class LRUCache<K, V> {
  private map: Map<K, V>
  private maxSize: number

  constructor(options?: LRUCacheOptions) {
    this.maxSize = options?.maxSize ?? 100
    this.map = new Map()
  }

  /**
   * Get a value by key.
   * Returns the value if found, or undefined if not present.
   * Marks the entry as recently used (moves it to the end of the Map).
   */
  get(key: K): V | undefined {
    if (!this.map.has(key)) {
      return undefined
    }
    // Move to end (most recently used) by delete+re-insert
    const value = this.map.get(key) as V
    this.map.delete(key)
    this.map.set(key, value)
    return value
  }

  /**
   * Set a key-value pair.
   * If the key already exists, updates the value and marks as recently used.
   * If the cache is full, evicts the least recently used entry first.
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

    this.map.set(key, value)
  }

  /**
   * Delete a key-value pair from the cache.
   * Returns true if the key existed and was deleted, false otherwise.
   */
  delete(key: K): boolean {
    return this.map.delete(key)
  }

  /**
   * Check if a key exists in the cache without updating access order.
   */
  has(key: K): boolean {
    return this.map.has(key)
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
   */
  values(): V[] {
    return [...this.map.values()]
  }

  /**
   * Get all entries in order from least to most recently used.
   */
  entries(): Array<[K, V]> {
    return [...this.map.entries()]
  }
}
