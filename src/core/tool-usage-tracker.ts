/**
 * ToolUsageTracker — lightweight per-tool effectiveness tracking.
 *
 * Tracks tool calls + outcomes so the dashboard can report which tools
 * are most effective for which task categories.
 *
 * ponytail: just a Map with counters, no persistence, no framework.
 * Upgrade to SQLite-backed if tracking becomes read-heavy.
 */

export interface ToolUsageRecord {
  toolName: string
  taskCategory: string
  success: boolean
  durationMs: number
  timestamp: number
}

export interface ToolUsageStats {
  toolName: string
  totalCalls: number
  successCount: number
  successRate: number
  avgDurationMs: number
  taskCategories: Record<string, { calls: number; success: number }>
}

export class ToolUsageTracker {
  private records: ToolUsageRecord[] = []
  private maxRecords: number

  constructor(maxRecords = 500) {
    this.maxRecords = maxRecords
  }

  record(record: ToolUsageRecord): void {
    this.records.push(record)
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords)
    }
  }

  getStats(toolName?: string): ToolUsageStats[] {
    const grouped = new Map<string, ToolUsageRecord[]>()
    for (const r of this.records) {
      const key = r.toolName
      if (toolName && key !== toolName) continue
      if (!grouped.has(key)) grouped.set(key, [])
      grouped.get(key)!.push(r)
    }

    const result: ToolUsageStats[] = []
    for (const [name, recs] of grouped) {
      const total = recs.length
      const success = recs.filter(r => r.success).length
      const avgDuration = recs.reduce((a, r) => a + r.durationMs, 0) / total
      const categories: Record<string, { calls: number; success: number }> = {}
      for (const r of recs) {
        if (!categories[r.taskCategory]) categories[r.taskCategory] = { calls: 0, success: 0 }
        categories[r.taskCategory].calls++
        if (r.success) categories[r.taskCategory].success++
      }
      result.push({
        toolName: name,
        totalCalls: total,
        successCount: success,
        successRate: total > 0 ? success / total : 0,
        avgDurationMs: Math.round(avgDuration),
        taskCategories: categories,
      })
    }
    result.sort((a, b) => b.totalCalls - a.totalCalls)
    return result
  }

  clear(): void {
    this.records = []
  }
}
