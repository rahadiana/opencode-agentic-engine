/**
 * Meta-Reasoning + Strategy Adaptation Layer (Comparison 22)
 *
 * Best practices applied:
 * - Strategy config: centralized tunable params with min/max bounds
 * - Performance analysis: sliding window over last N results
 * - Strategy adaptation: auto-tune params based on performance trends
 * - Strategy memory: versioned strategy history with rollback
 * - ReMA-inspired: meta-level observes execution-level performance and tunes
 *
 * References:
 * - ReMA: Learning to Meta-think for LLMs (OpenReview, 2025)
 * - EvolveR: Self-Evolving LLM Agents (ICLR 2026)
 * - "Meta-reasoning in Agents" — IEEE Computer Society (2026)
 */

// ── Strategy Parameter Definitions ──────────────────────────────────────

export interface StrategyParam {
  /** Parameter name */
  name: string
  /** Current value */
  value: number
  /** Minimum allowed value */
  min: number
  /** Maximum allowed value */
  max: number
  /** Step size for adjustments */
  step: number
  /** Description of what this param controls */
  description: string
}

export interface StrategyConfig {
  /** Unique strategy ID */
  id: string
  /** Human-readable label */
  label: string
  /** Parameter definitions */
  params: StrategyParam[]
  /** When this strategy was created */
  createdAt: number
}

export interface PerformanceRecord {
  /** ID of the task/run */
  taskId: string
  /** Whether the execution succeeded */
  success: boolean
  /** Number of retries needed */
  retries: number
  /** Critic score (0-1) if available */
  criticScore?: number
  /** Token usage */
  tokensUsed?: number
  /** When this was recorded */
  timestamp: number
}

export interface StrategyVersion {
  /** Version number (increments with each change) */
  version: number
  /** The config at this version */
  config: StrategyConfig
  /** Performance stats for this version */
  performance: {
    successRate: number
    avgRetries: number
    avgCriticScore: number
    totalRuns: number
  }
  /** Why this version was created */
  reason: string
  /** When this version was created */
  createdAt: number
}

export interface AdaptationResult {
  /** The new (or current) strategy config after adaptation */
  config: StrategyConfig
  /** What params changed */
  changes: Array<{ name: string; from: number; to: number; reason: string }>
  /** Whether the strategy was rolled back */
  rolledBack: boolean
  /** Whether adaptation was applied */
  adapted: boolean
  /** Warnings about the adaptation */
  warnings: string[]
}

export interface MetaReasonerConfig {
  /** Sliding window size for performance analysis (default: 10) */
  windowSize?: number
  /** Minimum acceptable success rate (default: 0.6) */
  minSuccessRate?: number
  /** Maximum retries before penalizing (default: 3) */
  maxRetriesThreshold?: number
  /** How often to attempt adaptation (every N records, default: 5) */
  adaptationInterval?: number
  /** Performance degradation threshold for rollback (default: -0.2) */
  degradationThreshold?: number
  /** Minimum runs before adaptation starts (default: 3) */
  minRunsBeforeAdapt?: number
}

const DEFAULTS: Required<MetaReasonerConfig> = {
  windowSize: 10,
  minSuccessRate: 0.6,
  maxRetriesThreshold: 3,
  adaptationInterval: 5,
  degradationThreshold: -0.2,
  minRunsBeforeAdapt: 3,
}

// ── Default Strategy Templates ─────────────────────────────────────────

export function createDefaultStrategy(label: string = "balanced"): StrategyConfig {
  return {
    id: `strat_${Date.now()}`,
    label,
    params: [
      { name: "exploration_rate", value: 0.3, min: 0, max: 1, step: 0.1, description: "Probability of trying novel approaches" },
      { name: "beam_width", value: 3, min: 1, max: 10, step: 1, description: "Number of plan candidates to consider" },
      { name: "max_depth", value: 5, min: 1, max: 20, step: 1, description: "Maximum plan decomposition depth" },
      { name: "reuse_threshold", value: 0.7, min: 0, max: 1, step: 0.1, description: "Minimum similarity to reuse past plans" },
      { name: "curiosity_weight", value: 0.2, min: 0, max: 1, step: 0.1, description: "Weight for exploratory goals" },
    ],
    createdAt: Date.now(),
  }
}

// ── MetaReasoner Class ──────────────────────────────────────────────────

export class MetaReasoner {
  // ponytail: cap versions to prevent unbounded growth
  private static readonly MAX_VERSIONS = 100

  private versions: StrategyVersion[] = []
  private currentConfig: StrategyConfig
  private performanceHistory: PerformanceRecord[] = []
  private config: Required<MetaReasonerConfig>
  private adaptationCount = 0
  private totalRuns = 0

  constructor(initialConfig?: StrategyConfig, options: MetaReasonerConfig = {}) {
    this.config = { ...DEFAULTS, ...options }
    this.currentConfig = initialConfig ?? createDefaultStrategy()

    // Record initial version
    this.versions.push({
      version: 1,
      config: JSON.parse(JSON.stringify(this.currentConfig)),
      performance: { successRate: 0, avgRetries: 0, avgCriticScore: 0, totalRuns: 0 },
      reason: "initial",
      createdAt: Date.now(),
    })
    this._trimVersions()
  }

  // ── Performance Recording ────────────────────────────────────────────

  /** Record an execution result for performance analysis */
  recordExecution(record: PerformanceRecord): void {
    this.performanceHistory.push(record)
    this.totalRuns++

    // Trim to window size
    if (this.performanceHistory.length > this.config.windowSize) {
      this.performanceHistory = this.performanceHistory.slice(-this.config.windowSize)
    }

    // Update current version's performance stats
    this._updateCurrentVersionPerformance()
  }

  /** Get current performance stats */
  getCurrentPerformance(): { successRate: number; avgRetries: number; avgCriticScore: number; totalRuns: number } {
    const window = this._getWindow()
    if (window.length === 0) {
      return { successRate: 0, avgRetries: 0, avgCriticScore: 0, totalRuns: 0 }
    }

    const successes = window.filter(r => r.success).length
    const totalRetries = window.reduce((sum, r) => sum + r.retries, 0)
    const criticScores = window.filter(r => r.criticScore !== undefined).map(r => r.criticScore!)
    const avgCritic = criticScores.length > 0
      ? criticScores.reduce((a, b) => a + b, 0) / criticScores.length
      : 0

    return {
      successRate: successes / window.length,
      avgRetries: totalRetries / window.length,
      avgCriticScore: avgCritic,
      totalRuns: window.length,
    }
  }

  // ── Strategy Adaptation ─────────────────────────────────────────────

  /**
   * Analyze performance and adapt strategy if needed.
   * Returns the adaptation result (what changed and why).
   */
  adapt(): AdaptationResult {
    const window = this._getWindow()
    const changes: AdaptationResult["changes"] = []
    const warnings: string[] = []

    // Not enough data yet
    if (window.length < this.config.minRunsBeforeAdapt) {
      return {
        config: this.currentConfig,
        changes: [],
        rolledBack: false,
        adapted: false,
        warnings: ["Not enough execution data to adapt"],
      }
    }

    const perf = this.getCurrentPerformance()

    // Check if we should rollback (performance degradation)
    if (this.versions.length > 1) {
      const prevVersion = this.versions[this.versions.length - 2]
      const degradation = perf.successRate - prevVersion.performance.successRate
      if (degradation < this.config.degradationThreshold && prevVersion.performance.totalRuns > 0) {
        return this._rollback(degradation)
      }
    }

    // Check if adaptation interval has passed
    if (this.totalRuns % this.config.adaptationInterval !== 0) {
      return {
        config: this.currentConfig,
        changes: [],
        rolledBack: false,
        adapted: false,
        warnings: [],
      }
    }

    // Auto-tune based on performance
    for (const param of this.currentConfig.params) {
      const oldValue = param.value

      if (perf.successRate < this.config.minSuccessRate) {
        // Failing too much → increase exploration
        if (param.name === "exploration_rate") {
          param.value = Math.min(param.max, param.value + param.step)
        }
        if (param.name === "beam_width") {
          param.value = Math.min(param.max, param.value + param.step)
        }
      }

      if (perf.avgRetries > this.config.maxRetriesThreshold) {
        // Too many retries → increase beam width for better planning
        if (param.name === "beam_width") {
          param.value = Math.min(param.max, param.value + param.step)
        }
        // Increase max depth for more thorough decomposition
        if (param.name === "max_depth") {
          param.value = Math.min(param.max, param.value + param.step)
        }
      }

      // If performing well, slightly reduce exploration
      if (perf.successRate >= this.config.minSuccessRate + 0.2) {
        if (param.name === "exploration_rate") {
          param.value = Math.max(param.min, param.value - param.step * 0.5)
        }
      }

      // Clamp values
      param.value = Math.max(param.min, Math.min(param.max, param.value))

      if (param.value !== oldValue) {
        changes.push({
          name: param.name,
          from: oldValue,
          to: param.value,
          reason: this._getAdaptationReason(param.name, perf),
        })
      }
    }

    const adapted = changes.length > 0

    if (adapted) {
      this.adaptationCount++
      this.currentConfig.createdAt = Date.now()
      this.versions.push({
        version: this.versions.length + 1,
        config: JSON.parse(JSON.stringify(this.currentConfig)),
        performance: perf,
        reason: `auto-adapt #${this.adaptationCount}: ${changes.map(c => `${c.name}=${c.to}`).join(", ")}`,
        createdAt: Date.now(),
      })
      this._trimVersions()
    }

    return {
      config: this.currentConfig,
      changes,
      rolledBack: false,
      adapted,
      warnings,
    }
  }

  /** Rollback to previous strategy version */
  rollback(version?: number): AdaptationResult {
    if (this.versions.length <= 1) {
      return {
        config: this.currentConfig,
        changes: [],
        rolledBack: false,
        adapted: false,
        warnings: ["No previous version to rollback to"],
      }
    }

    const targetVersion = version ?? this.versions.length - 1
    const target = this.versions.find(v => v.version === targetVersion)
    if (!target) {
      return {
        config: this.currentConfig,
        changes: [],
        rolledBack: false,
        adapted: false,
        warnings: [`Version ${targetVersion} not found`],
      }
    }

    this.currentConfig = JSON.parse(JSON.stringify(target.config))
    return {
      config: this.currentConfig,
      changes: [],
      rolledBack: true,
      adapted: false,
      warnings: [`Rolled back to version ${targetVersion}`],
    }
  }

  // ── Accessors ───────────────────────────────────────────────────────

  /** Get current strategy config */
  getCurrentConfig(): StrategyConfig {
    return this.currentConfig
  }

  /** Get all strategy versions */
  getVersionHistory(): StrategyVersion[] {
    return [...this.versions]
  }

  /** Get performance history */
  getPerformanceHistory(): PerformanceRecord[] {
    return [...this.performanceHistory]
  }

  /** Get adaptation stats */
  getAdaptationStats(): { adaptationCount: number; totalRuns: number; versionCount: number } {
    return {
      adaptationCount: this.adaptationCount,
      totalRuns: this.totalRuns,
      versionCount: this.versions.length,
    }
  }

  /** Get a specific param value by name */
  getParam(name: string): number | undefined {
    return this.currentConfig.params.find(p => p.name === name)?.value
  }

  /** Manually set a param value */
  setParam(name: string, value: number): boolean {
    const param = this.currentConfig.params.find(p => p.name === name)
    if (!param) return false
    param.value = Math.max(param.min, Math.min(param.max, value))
    return true
  }

  /** Current version number */
  getCurrentVersion(): number {
    return this.versions.length
  }

  // ── Private ─────────────────────────────────────────────────────────

  private _getWindow(): PerformanceRecord[] {
    return this.performanceHistory
  }

  private _updateCurrentVersionPerformance(): void {
    const perf = this.getCurrentPerformance()
    if (this.versions.length > 0) {
      this.versions[this.versions.length - 1].performance = perf
    }
  }

  private _rollback(degradation: number): AdaptationResult {
    const prevVersion = this.versions[this.versions.length - 2]
    this.currentConfig = JSON.parse(JSON.stringify(prevVersion.config))

    this.versions.push({
      version: this.versions.length + 1,
      config: JSON.parse(JSON.stringify(this.currentConfig)),
      performance: this.getCurrentPerformance(),
      reason: `auto-rollback (degradation: ${degradation.toFixed(2)})`,
      createdAt: Date.now(),
    })
    this._trimVersions()

    return {
      config: this.currentConfig,
      changes: [],
      rolledBack: true,
      adapted: false,
      warnings: [`Performance degraded by ${Math.abs(degradation).toFixed(2)}. Rolled back to version ${prevVersion.version}`],
    }
  }

  /** Trim versions array to prevent unbounded growth */
  private _trimVersions(): void {
    if (this.versions.length > MetaReasoner.MAX_VERSIONS) {
      this.versions = this.versions.slice(-MetaReasoner.MAX_VERSIONS)
    }
  }

  private _getAdaptationReason(_paramName: string, perf: { successRate: number; avgRetries: number }): string {
    if (perf.successRate < this.config.minSuccessRate) {
      return `Low success rate (${(perf.successRate * 100).toFixed(0)}%)`
    }
    if (perf.avgRetries > this.config.maxRetriesThreshold) {
      return `High retry rate (${perf.avgRetries.toFixed(1)} avg)`
    }
    return "Performance optimization"
  }
}
