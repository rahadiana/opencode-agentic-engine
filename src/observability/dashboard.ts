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
  generate(traces: TraceEntry[], sessionStart: number): DashboardData {
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
    let max = 0
    for (let i = 0; i < traces.length; i++) {
      let concurrent = 0
      const start = new Date(traces[i].timestamp).getTime()
      for (let j = 0; j < traces.length; j++) {
        const t = new Date(traces[j].timestamp).getTime()
        if (Math.abs(t - start) < 100) concurrent++
      }
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

    // Silent failures (false success claims with failed verify)
    let lastVerifyFailed = false
    for (const t of traces) {
      if (t.step.startsWith("verify:") && !t.success) lastVerifyFailed = true
      if (lastVerifyFailed && t.step.startsWith("execute:") && t.success) {
        anomalies.push({
          type: "silent_failure",
          description: `Step reported success but verification had previously failed`,
          detectedAt: t.timestamp,
          tool: t.toolUsed,
        })
        lastVerifyFailed = false
      }
    }

    return anomalies
  }
}
