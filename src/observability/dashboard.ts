import type { TraceEntry } from "./trace-logger"

export interface DashboardData {
  timeline: TimelineEvent[]
  statistics: Statistics
  anomalies: Anomaly[]
}

export interface TimelineEvent {
  time: string
  tool: string
  step: string
  success: boolean
  durationMs: number
}

export interface LatencyPercentiles {
  p50: number
  p95: number
  p99: number
}

export interface Statistics {
  totalCalls: number
  successRate: number
  averageLatency: number
  toolsUsed: Record<string, number>
  peakConcurrency: number
  latencyPercentiles?: LatencyPercentiles
}

export interface Anomaly {
  type: "timeout" | "loop" | "retry_storm" | "silent_failure"
  description: string
  detectedAt: string
  tool?: string
  count?: number
  severity?: "critical" | "warning" | "info"
}

export class Dashboard {
  private timelineLimit: number

  constructor(_concurrencyWindowMs = 2000, timelineLimit = 20) {
    this.timelineLimit = timelineLimit
  }

  private computeLatencyPercentiles(durations: number[]): LatencyPercentiles | undefined {
    if (durations.length === 0) return undefined
    const sorted = [...durations].sort((a, b) => a - b)
    const p = (k: number) => sorted[Math.floor((k / 100) * (sorted.length - 1))]
    return { p50: p(50), p95: p(95), p99: p(99) }
  }

  generate(traces: TraceEntry[], _sessionStart: number): DashboardData {
    const timeline: TimelineEvent[] = traces.map(t => ({
      time: t.timestamp,
      tool: t.toolUsed,
      step: t.step,
      success: t.success,
      durationMs: t.durationMs,
    }))

    const totalCalls = traces.length
    const successCount = traces.filter(t => t.success).length
    const avgLatency = traces.reduce((sum, t) => sum + t.durationMs, 0) / Math.max(totalCalls, 1)
    const toolsUsedMap = new Map<string, number>()
    for (const t of traces) {
      toolsUsedMap.set(t.toolUsed, (toolsUsedMap.get(t.toolUsed) ?? 0) + 1)
    }
    const toolsUsed: Record<string, number> = {}
    for (const [k, v] of toolsUsedMap) toolsUsed[k] = v

    const statistics: Statistics = {
      totalCalls,
      successRate: totalCalls > 0 ? successCount / totalCalls : 0,
      averageLatency: avgLatency,
      toolsUsed,
      peakConcurrency: this.computePeakConcurrency(traces),
      latencyPercentiles: this.computeLatencyPercentiles(traces.map(t => t.durationMs)),
    }

    const anomalies = this.detectAnomalies(traces)

    return { timeline, statistics, anomalies }
  }

  formatForDisplay(data: DashboardData, limit?: number): string {
    const tlLimit = limit ?? this.timelineLimit
    let output = `## Observability Dashboard\n\n`

    // Stats
    output += `### Statistics\n`
    output += `| Metric | Value |\n|--------|-------|\n`
    output += `| Total calls | ${data.statistics.totalCalls} |\n`
    output += `| Success rate | ${(data.statistics.successRate * 100).toFixed(1)}% |\n`
    output += `| Avg latency | ${data.statistics.averageLatency.toFixed(0)}ms |\n`
    output += `| Peak concurrent | ${data.statistics.peakConcurrency} |\n`
    if (data.statistics.latencyPercentiles) {
      const lp = data.statistics.latencyPercentiles
      output += `| Latency p50/p95/p99 | ${lp.p50}ms / ${lp.p95}ms / ${lp.p99}ms |\n`
    }

    // Tools used
    output += `\n### Tools Used\n`
    const toolsArr = Object.entries(data.statistics.toolsUsed).sort((a, b) => b[1] - a[1])
    for (const [tool, count] of toolsArr) {
      output += `| \`${tool}\` | ${count} |\n`
    }

    // Timeline
    output += `\n### Timeline (last ${tlLimit})\n`
    const recent = data.timeline.slice(-tlLimit)
    for (const evt of recent) {
      const icon = evt.success ? "[OK]" : "[FAIL]"
      const dur = evt.durationMs > 0 ? ` (${evt.durationMs}ms)` : ""
      output += `| ${evt.time.slice(11, 19)} | ${icon} \`${evt.tool}\` | ${evt.step}${dur} |\n`
    }

    // Anomalies
    if (data.anomalies.length > 0) {
      output += `\n### Anomalies Detected\n`
      for (const a of data.anomalies) {
        const sev = a.severity ? ` [${a.severity}]` : ""
        output += `- **${a.type}${sev}**: ${a.description}\n`
      }
    } else {
      output += `\n### [OK] No anomalies detected\n`
    }

    return output
  }

  private computePeakConcurrency(traces: TraceEntry[]): number {
    if (traces.length === 0) return 0
    // Use start/end time ranges if metadata has _start/_end, otherwise timestamp-based
    const intervals = traces.map(t => {
      const ts = new Date(t.timestamp).getTime()
      const start = (t.metadata?._start as number) ?? ts
      const end = (t.metadata?._end as number) ?? (ts + t.durationMs)
      return { start, end }
    }).filter(i => i.end > i.start).sort((a, b) => a.start - b.start)

    if (intervals.length === 0) return 0

    let max = 0
    const ends: number[] = []
    for (const { start, end } of intervals) {
      while (ends.length > 0 && ends[0] <= start) ends.shift()
      ends.push(end)
      ends.sort((a, b) => a - b)
      max = Math.max(max, ends.length)
    }
    return max
  }

  private detectAnomalies(traces: TraceEntry[]): Anomaly[] {
    const anomaliesMap = new Map<string, Anomaly>()

    // Slow operations (>30s)
    for (const t of traces) {
      if (t.durationMs > 30_000) {
        const key = `timeout|${t.step}|${t.toolUsed}`
        if (!anomaliesMap.has(key)) {
          anomaliesMap.set(key, {
            type: "timeout",
            description: `Slow operation: ${t.toolUsed} took ${t.durationMs}ms`,
            detectedAt: t.timestamp,
            tool: t.toolUsed,
            severity: t.durationMs > 60_000 ? "critical" : "warning",
          })
        }
      }
    }

    // Retry storms (>3 failures for same step) — regex match
    const executeRe = /^execute:/i
    const failCounts = new Map<string, number>()
    for (const t of traces) {
      if (!t.success && executeRe.test(t.step)) {
        const stepId = t.step.replace(/^execute:/i, "")
        failCounts.set(stepId, (failCounts.get(stepId) ?? 0) + 1)
      }
    }
    for (const [stepId, count] of failCounts) {
      if (count >= 3) {
        const key = `retry_storm|${stepId}`
        if (!anomaliesMap.has(key)) {
          anomaliesMap.set(key, {
            type: "retry_storm",
            description: `Step "${stepId}" failed ${count} times`,
            detectedAt: new Date().toISOString(),
            count,
            severity: count >= 5 ? "critical" : "warning",
          })
        }
      }
    }

    // Loop detection: same tool/step repeating without progress (Map-based O(n))
    const seen = new Map<string, number>()
    const maxLookback = 100
    const startIdx = Math.max(0, traces.length - maxLookback)
    for (let i = startIdx; i < traces.length; i++) {
      const key = `${traces[i].step}|${traces[i].toolUsed}`
      const prev = seen.get(key)
      if (prev !== undefined && i - prev <= 5) {
        const aKey = `loop|${key}`
        if (!anomaliesMap.has(aKey)) {
          anomaliesMap.set(aKey, {
            type: "loop",
            description: `Repeating pattern: ${traces[i].toolUsed} at index ${prev} and ${i}`,
            detectedAt: traces[i].timestamp,
            tool: traces[i].toolUsed,
            count: 2,
            severity: "warning",
          })
        }
        break
      }
      seen.set(key, i)
      if (seen.size > maxLookback * 2) {
        for (const [k] of seen) { seen.delete(k); break }
      }
    }

    // Silent failures — regex match step prefix
    const verifyRe = /^verify:/i
    const executeOnlyRe = /^execute:/i
    const verifyFailures = new Map<string, string>()
    for (const t of traces) {
      if (verifyRe.test(t.step) && !t.success) {
        verifyFailures.set(t.step.replace(verifyRe, ""), t.timestamp)
      }
    }
    for (const t of traces) {
      if (executeOnlyRe.test(t.step) && t.success) {
        const stepId = t.step.replace(executeOnlyRe, "")
        const failedAt = verifyFailures.get(stepId)
        if (failedAt) {
          const key = `silent_failure|${stepId}`
          if (!anomaliesMap.has(key)) {
            anomaliesMap.set(key, {
              type: "silent_failure",
              description: `Step "${stepId}" reported success but verification had failed`,
              detectedAt: t.timestamp,
              tool: t.toolUsed,
              severity: "critical",
            })
          }
        }
      }
    }

    return [...anomaliesMap.values()]
  }
}
