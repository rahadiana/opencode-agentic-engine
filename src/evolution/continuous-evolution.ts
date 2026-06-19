/**
 * ContinuousEvolution — auto-feedback pipeline for self-evolving agents.
 *
 * Tracks a rolling window of step results, detects performance degradation,
 * and triggers evolution analysis when anomalies are found.
 *
 * Aligns with the paper's "continuous evolution" vision:
 * agents that monitor their own performance and self-improve over time.
 */

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
  private evolveCount = 0

  constructor(windowSize = 20) {
    this.windowSize = windowSize
  }

  /** Feed a step result into the rolling window */
  feedStepResult(result: StepResult): void {
    this.results.push(result)
    // Keep bounded — retain 2× window for historical comparison
    if (this.results.length > this.windowSize * 2 + 10) {
      this.results = this.results.slice(-this.windowSize * 2)
    }
  }

  /** Feed multiple results at once (e.g. after a session completes) */
  feedBatch(results: StepResult[]): void {
    for (const r of results) {
      this.feedStepResult(r)
    }
  }

  /** Register a callback that fires when degradation is detected */
  onDegradation(cb: DegradationCallback): void {
    this.degradationCallbacks.push(cb)
  }

  /** Get current performance trend */
  getTrend(): PerformanceTrend {
    const total = this.results.length
    const successes = this.results.filter(r => r.success).length
    const overallRate = total > 0 ? successes / total : 1

    // Rolling window (most recent N)
    const recent = this.results.slice(-this.windowSize)
    const recentSuccesses = recent.filter(r => r.success).length
    const recentRate = recent.length > 0 ? recentSuccesses / recent.length : 1

    // Earlier window for comparison
    const earlier = this.results.slice(0, Math.min(this.windowSize, this.results.length - recent.length))
    const earlierSuccesses = earlier.filter(r => r.success).length
    const earlierRate = earlier.length > 0 ? earlierSuccesses / earlier.length : 1

    // Direction: ≥5% swing in either direction
    const direction = recentRate > earlierRate + 0.05
      ? "improving"
      : recentRate < earlierRate - 0.05
        ? "degrading"
        : "stable"

    const degradationDetected = direction === "degrading" && recentRate < 0.6

    const recentErrors: PerformanceTrend["recentErrors"] = []
    const categories = new Map<string, number>()
    for (const r of this.results) {
      if (!r.success) {
        if (r.category) categories.set(r.category, (categories.get(r.category) ?? 0) + 1)
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
    // Divide results into 5 chronological buckets and compute per-bucket rates
    const forecast: ForecastData = {
      nextWindowRate: recentRate,
      stepsUntilCritical: null,
      critical: false,
      bucketRates: [],
    }

    if (this.results.length >= 10) {
      const bucketSize = Math.max(1, Math.floor(this.results.length / 5))
      const bucketRates: number[] = []
      for (let i = 0; i < 5; i++) {
        const start = i * bucketSize
        const end = Math.min(start + bucketSize, this.results.length)
        const bucket = this.results.slice(start, end)
        const bucketSuccesses = bucket.filter(r => r.success).length
        bucketRates.push(bucket.length > 0 ? bucketSuccesses / bucket.length : 0)
      }
      forecast.bucketRates = bucketRates

      // Exponential smoothing: weighted average, recent buckets weighted more
      const isDecreasing = bucketRates.length >= 3 &&
        bucketRates.slice(1).every((r, i) => r < bucketRates[i]) &&
        bucketRates[0] > bucketRates[bucketRates.length - 1]

      if (isDecreasing) {
        // Exponential weighted smoothing: recent buckets get more weight
        let smoothed = bucketRates[0]
        const alpha = 0.4
        for (let i = 1; i < bucketRates.length; i++) {
          smoothed = alpha * bucketRates[i] + (1 - alpha) * smoothed
        }

        // Predict next window rate using smoothed value
        const nextRate = Math.max(0, Math.min(1, smoothed))
        forecast.nextWindowRate = nextRate
        forecast.critical = nextRate < 0.5

        // Estimate when rate would cross 50%
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

    return {
      overall: { total, success: successes, successRate: overallRate },
      rolling: { windowSize: this.windowSize, successRate: recentRate, direction },
      degradationDetected,
      anomalyCount: this.results.filter(r => !r.success).length,
      recentErrors,
      recommendations,
      forecast,
    }
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
        try { cb(trend, trigger) } catch { /* non-fatal */ }
      }
    }
    return trend
  }

  /**
   * Decide whether to auto-trigger evolution analysis.
   * Returns null if no trigger needed, or an EvolutionTrigger explaining why.
   */
  shouldEvolve(sessionId: string): EvolutionTrigger | null {
    const trend = this.getTrend()

    // Don't evolve twice in the same session
    if (this.lastEvolveSession === sessionId) return null

    // Cap total evolutions to prevent infinite loops (allow up to 20 per session)
    if (this.evolveCount >= 20) return null

    // Trigger 1: Degradation
    if (trend.degradationDetected) {
      this.lastEvolveSession = sessionId
      this.evolveCount++
      return {
        reason: `Auto-evolution triggered by performance degradation: ${(trend.rolling.successRate * 100).toFixed(0)}% success rate in recent window`,
        type: "degradation",
        metrics: {
          recentRate: trend.rolling.successRate,
          overallRate: trend.overall.successRate,
          anomalyRatio: trend.anomalyCount / Math.max(trend.overall.total, 1),
        },
      }
    }

    // Trigger 2: Milestone — every 50 completed steps, auto-evolve
    if (this.results.length > 0 && this.results.length % 50 === 0) {
      this.lastEvolveSession = sessionId
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
    this.evolveCount = 0
  }

  /** Get raw counts */
  getStats(): { totalResults: number; evolveCount: number; windowSize: number } {
    return {
      totalResults: this.results.length,
      evolveCount: this.evolveCount,
      windowSize: this.windowSize,
    }
  }

  /** Serialize for persistence */
  toJSON(): { results: StepResult[]; evolveCount: number; windowSize: number } {
    return {
      results: this.results,
      evolveCount: this.evolveCount,
      windowSize: this.windowSize,
    }
  }

  /** Restore from persisted state */
  fromJSON(data: { results: StepResult[]; evolveCount: number; windowSize: number }): void {
    this.results = data.results || []
    this.evolveCount = data.evolveCount || 0
    if (data.windowSize) this.windowSize = data.windowSize
  }
}
