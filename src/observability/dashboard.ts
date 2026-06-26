import type { TraceEntry } from "./trace-logger"

export interface DashboardData {
  timeline: TimelineEvent[]
  statistics: Statistics
  anomalies: Anomaly[]
  evolutionMetrics?: EvolutionMetrics
  constraintMetrics?: ConstraintMetrics
  performanceMetrics?: PerformanceMetrics
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

// ── Phase 5: Evolution, Constraint & Performance Metrics ─────

export interface LifecycleDistribution {
  raw: number
  validated: number
  compiled: number
  evolved: number
}

export interface EvolutionMetrics {
  totalSkills: number
  lifecycleDistribution: LifecycleDistribution
  averageSuccessRate: number
  totalMatureEvents: number
  recentMatureSummary: Record<string, number>
  totalMatureCalls: number
  evolutionTriggerCount: number
  totalSkillUsageCount: number
}

export interface ViolationCategoryBreakdown {
  file_safety: number
  budget: number  // violations with severity "warning"
  resource: number  // concurrent modification errors
  circuit_breaker: number
  invariant: number
  dependency: number
  other: number
}

export interface ConstraintMetrics {
  totalViolations: number
  totalChecks: number
  categoryBreakdown: ViolationCategoryBreakdown
  activeModifications: number
  blockedActions: number
  circuitBreakerTripped: boolean
}

export interface ToolLatencyStats {
  tool: string
  calls: number
  avgLatencyMs: number
  maxLatencyMs: number
}

export interface PerformanceMetrics {
  semanticCacheHitRate: number
  semanticCacheSize: number
  topSlowestTools: ToolLatencyStats[]
  toolLatencyStats: ToolLatencyStats[]
  modelCount: number
  totalModelCalls: number
  averageModelLatencyMs: number
}

// ── Context for gathering extra metrics ──────────────────────

export interface DashboardContext {
  skillStore?: {
    getAll(): Array<{
      usageCount: number
      successRate: number
      definition: { meta: { name: string }; quality: { usageCount: number; successRate: number } }
    }>
    getLifecycleStats(): LifecycleDistribution
    size: number
  }
  constraintManifold?: {
    snapshot(): {
      violationCount: number
      enabledCategories: string[]
      policy: { blockFileDeletion: boolean; maxTokensPerAction: number; maxFilesPerAction: number }
    }
    getActiveModifications(): string[]
    getRecentViolations(): Array<{
      category: string
      severity: string
      message: string
    }>
  }
  semanticCacheStats?: {
    size: number
    hits: number
    misses: number
    hitRate: number
  } | null
  modelRegistry?: {
    getAllScores(): Array<{
      model: string
      reliability: number
      hallucinationRate: number
      totalCalls: number
      status: string
    }>
  }
  evolutionEvents?: Array<{
    type: string
    timestamp: string
    details?: string
  }>
  matureCallCount?: number
  evolutionTriggerCount?: number
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

  generate(traces: TraceEntry[], _sessionStart: number, ctx?: DashboardContext): DashboardData {
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

    // ── Phase 5: Evolution Metrics ──
    const evolutionMetrics = ctx?.skillStore ? this.computeEvolutionMetrics(ctx) : undefined

    // ── Phase 5: Constraint Metrics ──
    const constraintMetrics = ctx?.constraintManifold ? this.computeConstraintMetrics(ctx) : undefined

    // ── Phase 5: Performance Metrics ──
    const performanceMetrics = this.computePerformanceMetrics(traces, ctx)

    return {
      timeline, statistics, anomalies,
      evolutionMetrics,
      constraintMetrics,
      performanceMetrics,
    }
  }

  private computeEvolutionMetrics(ctx: DashboardContext): EvolutionMetrics {
    const store = ctx.skillStore!
    const all = store.getAll()
    const lifecycleDistribution = store.getLifecycleStats()
    const avgSuccessRate = all.length > 0
      ? all.reduce((sum, s) => sum + s.successRate, 0) / all.length
      : 0
    const totalUsage = all.reduce((sum, s) => sum + s.usageCount, 0)

    return {
      totalSkills: store.size,
      lifecycleDistribution,
      averageSuccessRate: Number(avgSuccessRate.toFixed(3)),
      totalMatureEvents: ctx.matureCallCount ?? 0,
      recentMatureSummary: {},
      totalMatureCalls: ctx.matureCallCount ?? 0,
      evolutionTriggerCount: ctx.evolutionTriggerCount ?? 0,
      totalSkillUsageCount: totalUsage,
    }
  }

  private computeConstraintMetrics(ctx: DashboardContext): ConstraintMetrics {
    const cm = ctx.constraintManifold!
    const snap = cm.snapshot()
    const violations = cm.getRecentViolations()
    const activeMods = cm.getActiveModifications()

    const breakdown: ViolationCategoryBreakdown = {
      file_safety: 0, budget: 0, resource: 0,
      circuit_breaker: 0, invariant: 0, dependency: 0, other: 0,
    }

    let blockedActions = 0
    let circuitBreakerTripped = false
    for (const v of violations) {
      if (v.severity === "error") blockedActions++
      const cat = v.category as keyof ViolationCategoryBreakdown
      if (cat in breakdown) {
        (breakdown as any)[cat]++
      } else {
        breakdown.other++
      }
      if (v.category === "circuit_breaker") circuitBreakerTripped = true
    }

    return {
      totalViolations: violations.length,
      totalChecks: snap.violationCount + violations.length,
      categoryBreakdown: breakdown,
      activeModifications: activeMods.length,
      blockedActions,
      circuitBreakerTripped,
    }
  }

  private computePerformanceMetrics(traces: TraceEntry[], ctx?: DashboardContext): PerformanceMetrics | undefined {
    // Tool latency stats from traces
    const toolLatencyMap = new Map<string, { calls: number; totalMs: number; maxMs: number }>()
    for (const t of traces) {
      if (t.durationMs <= 0) continue
      const existing = toolLatencyMap.get(t.toolUsed) ?? { calls: 0, totalMs: 0, maxMs: 0 }
      existing.calls++
      existing.totalMs += t.durationMs
      existing.maxMs = Math.max(existing.maxMs, t.durationMs)
      toolLatencyMap.set(t.toolUsed, existing)
    }

    const toolLatencyStats: ToolLatencyStats[] = [...toolLatencyMap.entries()]
      .map(([tool, data]) => ({
        tool,
        calls: data.calls,
        avgLatencyMs: Math.round(data.totalMs / data.calls),
        maxLatencyMs: data.maxMs,
      }))
      .sort((a, b) => b.avgLatencyMs - a.avgLatencyMs)

    const topSlowestTools = toolLatencyStats.slice(0, 5)

    // Semantic cache stats
    const cacheStats = ctx?.semanticCacheStats
    const semanticCacheHitRate = cacheStats ? cacheStats.hitRate : 0
    const semanticCacheSize = cacheStats ? cacheStats.size : 0

    // Model registry stats
    let modelCount = 0
    let totalModelCalls = 0
    const totalModelLatency = 0
    if (ctx?.modelRegistry) {
      const scores = ctx.modelRegistry.getAllScores()
      modelCount = scores.length
      // approximate: each model's totalCalls from score
      // scores don't include latency directly, so skip avg
      for (const s of scores) {
        totalModelCalls += s.totalCalls
      }
    }

    if (toolLatencyStats.length === 0 && !cacheStats) return undefined

    return {
      semanticCacheHitRate,
      semanticCacheSize,
      topSlowestTools,
      toolLatencyStats,
      modelCount,
      totalModelCalls,
      averageModelLatencyMs: totalModelLatency,
    }
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
    output += `| Tool | Count |\n|------|-------|\n`
    const toolsArr = Object.entries(data.statistics.toolsUsed).sort((a, b) => b[1] - a[1])
    for (const [tool, count] of toolsArr) {
      output += `| \`${tool}\` | ${count} |\n`
    }

    // Timeline
    output += `\n### Timeline (last ${tlLimit})\n`
    output += `| Time | Status | Tool | Step |\n|------|--------|------|------|\n`
    const recent = data.timeline.slice(-tlLimit)
    for (const evt of recent) {
      const icon = evt.success ? "[OK]" : "[FAIL]"
      const dur = evt.durationMs > 0 ? ` (${evt.durationMs}ms)` : ""
      output += `| ${evt.time.slice(11, 19)} | ${icon} | \`${evt.tool}\` | ${evt.step}${dur} |\n`
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

    // ── Phase 5: Evolution Metrics ──
    if (data.evolutionMetrics) {
      const ev = data.evolutionMetrics
      output += `\n### 🧬 Evolution Metrics\n`
      output += `| Metric | Value |\n|--------|-------|\n`
      output += `| Total skills | ${ev.totalSkills} |\n`
      const ld = ev.lifecycleDistribution
      output += `| Lifecycle: raw / validated / compiled / evolved | ${ld.raw} / ${ld.validated} / ${ld.compiled} / ${ld.evolved} |\n`
      output += `| Avg success rate | ${(ev.averageSuccessRate * 100).toFixed(1)}% |\n`
      output += `| Total skill usage | ${ev.totalSkillUsageCount} |\n`
      output += `| Mature calls | ${ev.totalMatureCalls} |\n`
      output += `| Evolution triggers | ${ev.evolutionTriggerCount} |\n`
      if (Object.keys(ev.recentMatureSummary).length > 0) {
        output += `\n**Recent Maturation:**\n`
        for (const [key, count] of Object.entries(ev.recentMatureSummary)) {
          output += `- ${key}: ${count} skills\n`
        }
      }
    }

    // ── Phase 5: Constraint Metrics ──
    if (data.constraintMetrics) {
      const cm = data.constraintMetrics
      output += `\n### 🔒 Constraint Safety\n`
      output += `| Metric | Value |\n|--------|-------|\n`
      output += `| Total violations | ${cm.totalViolations} |\n`
      output += `| Total checks | ${cm.totalChecks} |\n`
      output += `| Blocked actions | ${cm.blockedActions} |\n`
      output += `| Active modifications | ${cm.activeModifications} |\n`
      output += `| Circuit breaker tripped | ${cm.circuitBreakerTripped ? "⚠️ Yes" : "✅ No"} |\n`

      const cb = cm.categoryBreakdown
      output += `\n**Violation Breakdown:**\n`
      output += `| Category | Count |\n|----------|-------|\n`
      const hasAny = cb.file_safety > 0 || cb.budget > 0 || cb.resource > 0 || cb.circuit_breaker > 0 || cb.invariant > 0 || cb.dependency > 0 || cb.other > 0
      if (!hasAny) output += `| _(none)_ | 0 |\n`
      if (cb.file_safety > 0) output += `| File safety | ${cb.file_safety} |\n`
      if (cb.budget > 0) output += `| Budget warnings | ${cb.budget} |\n`
      if (cb.resource > 0) output += `| Resource (concurrent) | ${cb.resource} |\n`
      if (cb.circuit_breaker > 0) output += `| Circuit breaker | ${cb.circuit_breaker} |\n`
      if (cb.invariant > 0) output += `| Invariant | ${cb.invariant} |\n`
      if (cb.dependency > 0) output += `| Dependency | ${cb.dependency} |\n`
      if (cb.other > 0) output += `| Other | ${cb.other} |\n`
    }

    // ── Phase 5: Performance Metrics ──
    if (data.performanceMetrics) {
      const pm = data.performanceMetrics
      output += `\n### ⚡ Performance Metrics\n`
      output += `| Metric | Value |\n|--------|-------|\n`
      output += `| Semantic cache hit rate | ${(pm.semanticCacheHitRate * 100).toFixed(1)}% |\n`
      output += `| Semantic cache size | ${pm.semanticCacheSize} entries |\n`
      output += `| Models tracked | ${pm.modelCount} |\n`
      output += `| Total model calls | ${pm.totalModelCalls} |\n`

      if (pm.toolLatencyStats.length > 0) {
        const top5 = pm.topSlowestTools
        if (top5.length > 0) {
          output += `\n**Top Slowest Tools (avg):**\n`
          output += `| Tool | Calls | Avg Latency | Max Latency |\n|------|-------|-------------|-------------|\n`
          for (const t of top5) {
            output += `| \`${t.tool}\` | ${t.calls} | ${t.avgLatencyMs}ms | ${t.maxLatencyMs}ms |\n`
          }
        }
      }
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
