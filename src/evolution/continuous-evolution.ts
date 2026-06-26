/**
 * ContinuousEvolution — auto-feedback pipeline for self-evolving agents.
 *
 * Tracks a rolling window of step results, detects performance degradation,
 * and triggers evolution analysis when anomalies are found.
 *
 * Aligns with the paper's "continuous evolution" vision:
 * agents that monitor their own performance and self-improve over time.
 */
import { createLogger } from "../observability/logger.js"

const log = createLogger("ContinuousEvo")

export interface StepResult {
  stepId: string
  success: boolean
  output: string
  sessionId: string
  timestamp: number
  category?: string
}

export interface ForecastData {
  /** Predicted success rate for the next window */
  nextWindowRate: number
  /** Estimated remaining steps until success rate drops below 50%, or null if not predictable */
  stepsUntilCritical: number | null
  /** True if the forecast shows imminent critical degradation */
  critical: boolean
  /** Per-bucket success rates for transparency */
  bucketRates: number[]
}

export interface PerformanceTrend {
  overall: { total: number; success: number; successRate: number }
  rolling: { windowSize: number; successRate: number; direction: "improving" | "stable" | "degrading" }
  degradationDetected: boolean
  anomalyCount: number
  recentErrors: Array<{ stepId: string; output: string; category: string; timestamp: number }>
  recommendations: string[]
  /** Predictive degradation forecast (Gap #12) */
  forecast: ForecastData
}

export interface EvolutionTrigger {
  reason: string
  type: "degradation" | "anomaly_spike" | "milestone"
  metrics: {
    recentRate: number
    overallRate: number
    anomalyRatio: number
  }
}

export type DegradationCallback = (trend: PerformanceTrend, trigger: EvolutionTrigger) => void

export class ContinuousEvolution {
  private windowSize: number
  private results: StepResult[] = []
  private degradationCallbacks: DegradationCallback[] = []
  private lastEvolveSession: string | null = null
  private lastEvolveTime = 0
  private evolveCount = 0
  private maxEvolvePerSession: number
  private trendCache: { key: string; trend: PerformanceTrend } | null = null
  /** Cumulative results fed (never pruned) — used for milestone triggers */
  private cumulativeResults = 0

  constructor(windowSize = 30, maxEvolvePerSession = 10) {
    this.windowSize = windowSize
    this.maxEvolvePerSession = maxEvolvePerSession
  }

  /** Feed a step result into the rolling window */
  feedStepResult(result: StepResult): void {
    this.results.push(result)
    this.cumulativeResults++
    this.trendCache = null
    if (this.results.length > this.windowSize * 2 + 10) {
      this.results = this.results.slice(-this.windowSize * 2)
    }
  }

  /** Feed multiple results at once (e.g. after a session completes) */
  feedBatch(results: StepResult[]): void {
    this.results.push(...results)
    this.cumulativeResults += results.length
    this.trendCache = null
    if (this.results.length > this.windowSize * 2 + 10) {
      this.results = this.results.slice(-this.windowSize * 2)
    }
  }

  /** Register a callback that fires when degradation is detected */
  onDegradation(cb: DegradationCallback): void {
    this.degradationCallbacks.push(cb)
  }

  private static readonly DIR_IMPROVING = "improving" as const
  private static readonly DIR_STABLE = "stable" as const
  private static readonly DIR_DEGRADING = "degrading" as const

  /** Get current performance trend (cached within same tick) */
  getTrend(): PerformanceTrend {
    const cacheKey = `${this.results.length}:${this.results.slice(-5).map(r => r.success ? "1" : "0").join("")}`
    if (this.trendCache?.key === cacheKey) return this.trendCache.trend

    const total = this.results.length
    const successes = this.results.filter(r => r.success).length
    const overallRate = total > 0 ? successes / total : 1

    const recent = this.results.slice(-this.windowSize)
    const recentSuccesses = recent.filter(r => r.success).length
    const recentRate = recent.length > 0 ? recentSuccesses / recent.length : 1

    const earlier = this.results.slice(0, Math.min(this.windowSize, this.results.length - recent.length))
    const earlierSuccesses = earlier.filter(r => r.success).length
    const earlierRate = earlier.length > 0 ? earlierSuccesses / earlier.length : 1

    const direction = recentRate > earlierRate + 0.05
      ? ContinuousEvolution.DIR_IMPROVING
      : recentRate < earlierRate - 0.05
        ? ContinuousEvolution.DIR_DEGRADING
        : ContinuousEvolution.DIR_STABLE

    const degradationDetected = direction === ContinuousEvolution.DIR_DEGRADING && recentRate < 0.6

    const recentErrors: PerformanceTrend["recentErrors"] = []
    const categories = new Map<string, number>()
    for (const r of this.results) {
      if (!r.success && r.category) {
        categories.set(r.category, (categories.get(r.category) ?? 0) + 1)
      }
    }

    for (const r of this.results.slice(-5).filter(r => !r.success)) {
      recentErrors.push({
        stepId: r.stepId,
        output: r.output.slice(0, 200),
        category: r.category ?? "unknown",
        timestamp: r.timestamp,
      })
    }

    const recommendations: string[] = []

    // ── Predictive Degradation Forecast (Gap #12) ──
    const numBuckets = 5
    const forecast: ForecastData = {
      nextWindowRate: recentRate,
      stepsUntilCritical: null,
      critical: false,
      bucketRates: [],
    }

    if (this.results.length >= 10) {
      const bucketSize = Math.max(1, Math.floor(this.results.length / numBuckets))
      const bucketRates: number[] = []
      for (let i = 0; i < numBuckets; i++) {
        const start = i * bucketSize
        const end = Math.min(start + bucketSize, this.results.length)
        const bucket = this.results.slice(start, end)
        const bucketSuccesses = bucket.filter(r => r.success).length
        bucketRates.push(bucket.length > 0 ? bucketSuccesses / bucket.length : 0)
      }
      forecast.bucketRates = bucketRates

      const isDecreasing = bucketRates.length >= 3 &&
        bucketRates.slice(1).every((r, i) => r < bucketRates[i]) &&
        bucketRates[0] > bucketRates[bucketRates.length - 1]

      if (isDecreasing) {
        let smoothed = bucketRates[0]
        const alpha = 0.4
        for (let i = 1; i < bucketRates.length; i++) {
          smoothed = alpha * bucketRates[i] + (1 - alpha) * smoothed
        }

        const nextRate = Math.max(0, Math.min(1, smoothed))
        forecast.nextWindowRate = nextRate
        forecast.critical = nextRate < 0.5

        const declineRate = bucketRates[0] - bucketRates[bucketRates.length - 1]
        const avgDecline = declineRate / (bucketRates.length - 1)
        if (bucketRates[bucketRates.length - 1] > 0.5 && avgDecline > 0) {
          const stepsToCross = Math.ceil((bucketRates[bucketRates.length - 1] - 0.5) / avgDecline) * bucketSize
          forecast.stepsUntilCritical = stepsToCross
        }

        if (forecast.critical) {
          recommendations.push(`Forecast: Performance projected to drop to ${(nextRate * 100).toFixed(0)}% in the next window. ${forecast.stepsUntilCritical ? `Critical threshold (~50%) expected in ~${forecast.stepsUntilCritical} steps.` : "Consider proactive evolution analysis."}`)
        }
      }

      // Seasonality detection: compare week-over-week if timestamps available
      if (this.results.length >= 14) {
        const timestamps = this.results.map(r => r.timestamp)
        const minTs = Math.min(...timestamps)
        const maxTs = Math.max(...timestamps)
        const spanDays = (maxTs - minTs) / 86400000
        if (spanDays >= 7) {
          const weekMs = 7 * 86400000
          const recentWeek = this.results.filter(r => r.timestamp > maxTs - weekMs)
          const prevWeek = this.results.filter(r => r.timestamp <= maxTs - weekMs && r.timestamp > maxTs - 2 * weekMs)
          if (recentWeek.length >= 5 && prevWeek.length >= 5) {
            const rwRate = recentWeek.filter(r => r.success).length / recentWeek.length
            const pwRate = prevWeek.filter(r => r.success).length / prevWeek.length
            if (pwRate > 0 && Math.abs(rwRate - pwRate) / pwRate > 0.2) {
              recommendations.push(`Seasonality detected: performance changed from ${(pwRate * 100).toFixed(0)}% to ${(rwRate * 100).toFixed(0)}% week-over-week.`)
            }
          }
        }
      }
    }

    if (degradationDetected) {
      recommendations.push("Performance degradation detected. Run `agentic_evolve evolve` or enable auto-evolution to analyze root causes.")
    }
    if (categories.size > 0) {
      const topCat = [...categories.entries()].sort((a, b) => b[1] - a[1])[0]
      if (topCat && topCat[1] >= 3) {
        recommendations.push(`Recurring error pattern: "${topCat[0]}" (${topCat[1]} occurrences). Consider adding targeted verification for this category.`)
      }
    }
    if (this.results.length >= 10 && overallRate < 0.5) {
      recommendations.push("Overall success rate below 50%. Review plan decomposition granularity and verification criteria.")
    }
    if (this.results.length >= this.windowSize && recentRate === 1 && overallRate < 0.8) {
      recommendations.push("Recent improvement trend detected. Extract successful patterns as reusable skills via `agentic_skill extract`.")
    }

    const trend: PerformanceTrend = {
      overall: { total, success: successes, successRate: overallRate },
      rolling: { windowSize: this.windowSize, successRate: recentRate, direction },
      degradationDetected,
      anomalyCount: this.results.filter(r => !r.success).length,
      recentErrors,
      recommendations,
      forecast,
    }

    this.trendCache = { key: cacheKey, trend }
    return trend
  }

  /** Check trend and fire callbacks if degradation found. Returns current trend. */
  checkAndNotify(): PerformanceTrend {
    const trend = this.getTrend()
    if (trend.degradationDetected) {
      const trigger: EvolutionTrigger = {
        reason: `Success rate dropped to ${(trend.rolling.successRate * 100).toFixed(0)}% in last ${trend.rolling.windowSize} steps (direction: ${trend.rolling.direction})`,
        type: "degradation",
        metrics: {
          recentRate: trend.rolling.successRate,
          overallRate: trend.overall.successRate,
          anomalyRatio: trend.anomalyCount / Math.max(trend.overall.total, 1),
        },
      }
      for (const cb of this.degradationCallbacks) {
        try { cb(trend, trigger) } catch (err) { log.error("callback error", { error: err }) }
      }
    }
    return trend
  }

  /**
   * Decide whether to auto-trigger evolution analysis.
   * Returns null if no trigger needed, or an EvolutionTrigger explaining why.
   * Includes hysteresis to prevent rapid re-triggering from transient noise.
   */
  shouldEvolve(sessionId: string): EvolutionTrigger | null {
    const trend = this.getTrend()

    // Hysteresis: don't evolve if same session or within cooldown period
    if (this.lastEvolveSession === sessionId) {
      // Allow re-trigger after 2 minutes if degradation worsened
      if (this.lastEvolveTime > 0 && Date.now() - this.lastEvolveTime < 120000) return null
    }

    // Cap total evolutions to prevent infinite loops (configurable)
    if (this.evolveCount >= this.maxEvolvePerSession) return null

    // Require minimum data points before evolution triggers
    if (this.results.length < 10) return null

    // Trigger 1: Degradation — requires sustained degradation, not single dip
    if (trend.degradationDetected) {
      // Check that degradation is sustained over at least 3 checks
      // by looking at the bucket rates
      const bucketRates = trend.forecast.bucketRates
      const isSustained = bucketRates.length >= 3 &&
        bucketRates.slice(-3).every((r, i, arr) =>
          i === 0 || r < arr[i - 1] // strictly decreasing
        )

      // Only trigger if sustained degradation or very low rate (<0.4)
      if (isSustained || trend.rolling.successRate < 0.4) {
        this.lastEvolveSession = sessionId
        this.lastEvolveTime = Date.now()
        this.evolveCount++
        return {
          reason: `Auto-evolution triggered by ${isSustained ? "sustained" : "severe"} performance degradation: ${(trend.rolling.successRate * 100).toFixed(0)}% success rate in recent window`,
          type: "degradation",
          metrics: {
            recentRate: trend.rolling.successRate,
            overallRate: trend.overall.successRate,
            anomalyRatio: trend.anomalyCount / Math.max(trend.overall.total, 1),
          },
        }
      }
      // Single dip: log but don't trigger
      return null
    }

    // Trigger 2: Milestone — every 100 completed steps (uses cumulative counter, not pruned window)
    if (this.cumulativeResults > 0 && this.cumulativeResults % 100 === 0 && this.cumulativeResults >= 100) {
      this.lastEvolveSession = sessionId
      this.lastEvolveTime = Date.now()
      this.evolveCount++
      return {
        reason: `Milestone reached: ${this.results.length} steps completed. Periodic evolution analysis.`,
        type: "milestone",
        metrics: {
          recentRate: trend.rolling.successRate,
          overallRate: trend.overall.successRate,
          anomalyRatio: trend.anomalyCount / Math.max(trend.overall.total, 1),
        },
      }
    }

    return null
  }

  /** Reset state (for testing) */
  reset(): void {
    this.results = []
    this.lastEvolveSession = null
    this.lastEvolveTime = 0
    this.evolveCount = 0
    this.trendCache = null
    this.cumulativeResults = 0
  }

  /** Get raw counts */
  getStats(): { totalResults: number; cumulativeResults: number; evolveCount: number; windowSize: number } {
    return {
      totalResults: this.results.length,
      cumulativeResults: this.cumulativeResults,
      evolveCount: this.evolveCount,
      windowSize: this.windowSize,
    }
  }

  /** Serialize for persistence */
  toJSON(): { results: StepResult[]; evolveCount: number; windowSize: number; lastEvolveSession: string | null; cumulativeResults: number } {
    return {
      results: this.results,
      evolveCount: this.evolveCount,
      windowSize: this.windowSize,
      lastEvolveSession: this.lastEvolveSession,
      cumulativeResults: this.cumulativeResults,
    }
  }

  /** Restore from persisted state */
  fromJSON(data: { results: StepResult[]; evolveCount: number; windowSize: number; lastEvolveSession?: string | null; cumulativeResults?: number }): void {
    this.results = data.results || []
    this.evolveCount = data.evolveCount || 0
    this.windowSize = Math.max(1, data.windowSize ?? this.windowSize)
    this.lastEvolveSession = data.lastEvolveSession ?? null
    this.cumulativeResults = data.cumulativeResults ?? this.results.length
  }
}
