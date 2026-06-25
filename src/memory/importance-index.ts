import type { MemoryLevel } from "./memory-orchestrator.js"

export interface ImportanceEntry {
  importance: number
  level: MemoryLevel
  lastAccessed: number
  accessCount: number
}

export class ImportanceIndex {
  private index: Map<string, ImportanceEntry>
  private maxEntries: number

  constructor(maxEntries: number = 1000) {
    this.index = new Map()
    this.maxEntries = maxEntries
  }

  get size(): number {
    return this.index.size
  }

  get(id: string): ImportanceEntry | undefined {
    const entry = this.index.get(id)
    if (entry) {
      entry.lastAccessed = Date.now()
      entry.accessCount++
    }
    return entry
  }

  set(id: string, level: MemoryLevel, importance: number): void {
    this.index.set(id, {
      importance,
      level,
      lastAccessed: Date.now(),
      accessCount: 1,
    })
  }

  delete(id: string): void {
    this.index.delete(id)
  }

  entries(): IterableIterator<[string, ImportanceEntry]> {
    return this.index.entries()
  }

  computeDefaultImportance(level: MemoryLevel): number {
    switch (level) {
      case "working": return 0.9
      case "episodic": return 0.6
      case "semantic": return 0.7
      case "procedural": return 0.8
      default: return 0.5
    }
  }

  indexImportance(entries: Array<{ id: string; level: MemoryLevel; importance?: number }>): void {
    for (const entry of entries) {
      const importance = entry.importance ?? this.computeDefaultImportance(entry.level)
      this.set(entry.id, entry.level, importance)
    }
  }

  pruneImportanceIndex(): void {
    while (this.index.size > this.maxEntries) {
      let lowestKey = ""
      let lowestScore = Infinity
      for (const [key, val] of this.index) {
        const score = val.importance * (1 - 1 / (val.accessCount + 1))
        if (score < lowestScore) {
          lowestScore = score
          lowestKey = key
        }
      }
      if (lowestKey) this.index.delete(lowestKey)
    }
  }
}
