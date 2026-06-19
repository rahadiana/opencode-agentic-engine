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

export interface Statistics {
  totalCalls: number
  successRate: number
  averageLatency: number
  toolsUsed: Map<string, number>
  peakConcurrency: number
}

export interface Anomaly {
  type: "timeout" | "loop" | "retry_storm" | "silent_failure"
  description: string
  detectedAt: string
  tool?: string
  count?: number
}

export class Dashboard {
  private concurrencyWindowMs: number

  constructor(concurrencyWindowMs = 2000) {
    this.concurrencyWindowMs = concurrencyWindowMs
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
    const toolsUsed = new Map<string, number>()
    for (const t of traces) {
      toolsUsed.set(t.toolUsed, (toolsUsed.get(t.toolUsed) ?? 0) + 1)
    }

    const statistics: Statistics = {
      totalCalls,
      successRate: totalCalls > 0 ? successCount / totalCalls : 0,
      averageLatency: avgLatency,
      toolsUsed,
      peakConcurrency: this.computePeakConcurrency(traces),
    }

    const anomalies = this.detectAnomalies(traces)

    return { timeline, statistics, anomalies }
  }

  formatForDisplay(data: DashboardData): string {
    let output = `## 📈 Observability Dashboard\n\n`

    // Stats
    output += `### Statistics\n`
    output += `| Metric | Value |\n|--------|-------|\n`
    output += `| Total calls | ${data.statistics.totalCalls} |\n`
    output += `| Success rate | ${(data.statistics.successRate * 100).toFixed(1)}% |\n`
    output += `| Avg latency | ${data.statistics.averageLatency.toFixed(0)}ms |\n`
    output += `| Peak concurrent | ${data.statistics.peakConcurrency} |\n`

    // Tools used
    output += `\n### Tools Used\n`
    for (const [tool, count] of [...data.statistics.toolsUsed].sort((a, b) => b[1] - a[1])) {
      output += `| \`${tool}\` | ${count} |\n`
    }

    // Timeline
    output += `\n### Timeline (last 20)\n`
    const recent = data.timeline.slice(-20)
    for (const evt of recent) {
      const icon = evt.success ? "✅" : "❌"
      const dur = evt.durationMs > 0 ? ` (${evt.durationMs}ms)` : ""
      output += `| ${evt.time.slice(11, 19)} | ${icon} \`${evt.tool}\` | ${evt.step}${dur} |\n`
    }

    // Anomalies
    if (data.anomalies.length > 0) {
      output += `\n### ⚠️ Anomalies Detected\n`
      for (const a of data.anomalies) {
        output += `- **${a.type}**: ${a.description}\n`
      }
    } else {
      output += `\n### ✅ No anomalies detected\n`
    }

    return output
  }

  private computePeakConcurrency(traces: TraceEntry[]): number {
    if (traces.length === 0) return 0
    // Sort by timestamp, then use sweep line with configurable window
    const sorted = traces.map(t => new Date(t.timestamp).getTime()).sort((a, b) => a - b)
    let max = 0
    let concurrent = 0
    let j = 0
    for (let i = 0; i < sorted.length; i++) {
      // Move window start forward
      while (j < i && sorted[i] - sorted[j] > this.concurrencyWindowMs) {
        concurrent--
        j++
      }
      concurrent++
      max = Math.max(max, concurrent)
    }
    return max
  }

  private detectAnomalies(traces: TraceEntry[]): Anomaly[] {
    const anomalies: Anomaly[] = []

    // Slow operations (>30s)
    for (const t of traces) {
      if (t.durationMs > 30_000) {
        anomalies.push({
          type: "timeout",
          description: `Slow operation: ${t.toolUsed} took ${t.durationMs}ms`,
          detectedAt: t.timestamp,
          tool: t.toolUsed,
        })
      }
    }

    // Retry storms (>3 failures for same step)
    const failCounts = new Map<string, number>()
    for (const t of traces) {
      if (!t.success && t.step.startsWith("execute:")) {
        const stepId = t.step.replace("execute:", "")
        failCounts.set(stepId, (failCounts.get(stepId) ?? 0) + 1)
      }
    }
    for (const [stepId, count] of failCounts) {
      if (count >= 3) {
        anomalies.push({
          type: "retry_storm",
          description: `Step "${stepId}" failed ${count} times`,
          detectedAt: new Date().toISOString(),
          count,
        })
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
        anomalies.push({
          type: "loop",
          description: `Repeating pattern: ${traces[i].toolUsed} at index ${prev} and ${i}`,
          detectedAt: traces[i].timestamp,
          tool: traces[i].toolUsed,
          count: 2,
        })
        break
      }
      seen.set(key, i)
      // Evict old entries to keep map bounded
      if (seen.size > maxLookback * 2) {
        for (const [k] of seen) { seen.delete(k); break }
      }
    }

    // Silent failures (false success claims with failed verify — match by stepId)
    const verifyFailures = new Map<string, string>()
    for (const t of traces) {
      const prefix = "verify:"
      if (t.step.startsWith(prefix) && !t.success) {
        verifyFailures.set(t.step.slice(prefix.length), t.timestamp)
      }
    }
    for (const t of traces) {
      const prefix = "execute:"
      if (t.step.startsWith(prefix) && t.success) {
        const stepId = t.step.slice(prefix.length)
        const failedAt = verifyFailures.get(stepId)
        if (failedAt) {
          anomalies.push({
            type: "silent_failure",
            description: `Step "${stepId}" reported success but verification had failed`,
            detectedAt: t.timestamp,
            tool: t.toolUsed,
          })
        }
      }
    }

    return anomalies
  }
}
