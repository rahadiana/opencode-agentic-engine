export interface ModelStats {
  model: string
  totalCalls: number
  successCalls: number
  failedCalls: number
  hallucinationCount: number
  avgLatencyMs: number
  lastUsed: number
  consecutiveFailures: number
  consecutiveSuccesses: number
  quarantineUntil: number
  byTaskType?: Record<string, Omit<ModelStats, 'model' | 'byTaskType'>>
  /** User satisfaction per task type — dari feedback positive/negative */
  userFeedback?: Record<string, { positive: number; negative: number }>
  /** Cost-aware routing: accumulated USD cost */
  totalCost?: number
  /** Running average cost per call in USD */
  avgCostPerCall?: number
}

export interface ModelScore {
  model: string
  reliability: number
  hallucinationRate: number
  totalCalls: number
  status: "healthy" | "degraded" | "unstable" | "untested"
  /** Cost-aware routing: average cost per call in USD */
  avgCostPerCall?: number
}

export class ModelRegistry {
  private stats = new Map<string, ModelStats>()
  private modelAliases: Map<string, string[]> = new Map()

  private readonly maxConsecutiveFailures = 3

  constructor() {
    this.modelAliases.set("fast", [])
    this.modelAliases.set("capable", [])
  }

  /**
   * Resolve the canonical key for a model name, merging bare+prefixed duplicates.
   * If both `model` and `opencode/${model}` exist, merge into the prefixed form
   * and return it. Otherwise keep the given name — bare is fine for custom providers.
   */
  private _resolveKey(model: string): string {
    if (model.includes("/")) return model
    const prefixed = `opencode/${model}`
    // Merge: if prefixed form exists, absorb bare stats into it, return prefixed
    if (this.stats.has(prefixed)) {
      const bare = this.stats.get(model)
      if (bare) {
        const p = this.stats.get(prefixed)!
        p.totalCalls += bare.totalCalls
        p.successCalls += bare.successCalls
        p.failedCalls += bare.failedCalls
        p.hallucinationCount += bare.hallucinationCount
        if (bare.lastUsed > p.lastUsed) p.lastUsed = bare.lastUsed
        this.stats.delete(model)
      }
      return prefixed
    }
    return model
  }

  registerAlias(alias: string, models: string[]): void {
    this.modelAliases.set(alias, models)
  }

  addModel(name: string): void {
    name = this._resolveKey(name)
    if (!this.stats.has(name)) {
      this.stats.set(name, {
        model: name,
        totalCalls: 0,
        successCalls: 0,
        failedCalls: 0,
        hallucinationCount: 0,
        avgLatencyMs: 0,
        lastUsed: 0,
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
        quarantineUntil: 0,
        byTaskType: {},
        totalCost: 0,
        avgCostPerCall: 0,
      })
    }
  }

  recordCall(model: string, success: boolean, latencyMs: number, taskType?: string, costUsd?: number): void {
    model = this._resolveKey(model)
    this.addModel(model)
    const stat = this.stats.get(model)!
    stat.totalCalls++
    // Track cost for routing decisions
    if (costUsd !== undefined && costUsd > 0) {
      stat.totalCost = (stat.totalCost ?? 0) + costUsd
      stat.avgCostPerCall = stat.totalCost / stat.totalCalls
    }
    stat.lastUsed = Date.now()

    if (success) {
      stat.successCalls++
      stat.consecutiveFailures = 0
      stat.consecutiveSuccesses++
      
      const score = this.getScore(model)
      if (stat.quarantineUntil > 0 && stat.consecutiveSuccesses >= 3 && stat.totalCalls >= 5 && score && score.hallucinationRate < 0.2) {
        stat.quarantineUntil = 0
      }
    } else {
      stat.failedCalls++
      stat.consecutiveFailures++
      stat.consecutiveSuccesses = 0
      
      if (stat.consecutiveFailures >= 5) {
        this.enterQuarantine(model, 30)
      }
    }

    stat.avgLatencyMs = stat.avgLatencyMs === 0
      ? latencyMs
      : (stat.avgLatencyMs * (stat.totalCalls - 1) + latencyMs) / stat.totalCalls

    // Record per-task-type stats if taskType provided
    if (taskType && stat.byTaskType) {
      if (!stat.byTaskType[taskType]) {
        stat.byTaskType[taskType] = {
          totalCalls: 0,
          successCalls: 0,
          failedCalls: 0,
          hallucinationCount: 0,
          avgLatencyMs: 0,
          lastUsed: 0,
          consecutiveFailures: 0,
          consecutiveSuccesses: 0,
          quarantineUntil: 0,
        }
      }
      const taskStat = stat.byTaskType[taskType]
      taskStat.totalCalls++
      taskStat.lastUsed = Date.now()
      if (success) {
        taskStat.successCalls++
        taskStat.consecutiveFailures = 0
      } else {
        taskStat.failedCalls++
        taskStat.consecutiveFailures++
      }
      taskStat.avgLatencyMs = taskStat.avgLatencyMs === 0
        ? latencyMs
        : (taskStat.avgLatencyMs * (taskStat.totalCalls - 1) + latencyMs) / taskStat.totalCalls
    }
  }

  recordHallucination(model: string): void {
    this.addModel(model)
    const stat = this.stats.get(model)!
    stat.hallucinationCount++
  }

  /**
   * Record user feedback (positive/negative) per model per task type.
   * Ini yang bikin model selection makin pinter — bukan cuma technical reliability,
   * tapi juga user satisfaction.
   */
  recordUserFeedback(model: string, taskType: string, positive: boolean): void {
    this.addModel(model)
    const stat = this.stats.get(model)!
    if (!stat.userFeedback) stat.userFeedback = {}
    if (!stat.userFeedback[taskType]) {
      stat.userFeedback[taskType] = { positive: 0, negative: 0 }
    }
    if (positive) {
      stat.userFeedback[taskType].positive++
    } else {
      stat.userFeedback[taskType].negative++
    }
  }

  /**
   * Get user satisfaction score for a model on a specific task type.
   * Returns 0.0 - 1.0. Default 0.5 jika belum ada data.
   */
  getUserSatisfaction(model: string, taskType: string): number {
    const stat = this.stats.get(model)
    if (!stat?.userFeedback?.[taskType]) return 0.5

    const fb = stat.userFeedback[taskType]
    const total = fb.positive + fb.negative
    if (total === 0) return 0.5

    return fb.positive / total
  }

  getScore(model: string): ModelScore | null {
    const stat = this.stats.get(model)
    if (!stat || stat.totalCalls === 0) {
      return {
        model,
        reliability: 0,
        hallucinationRate: 0,
        totalCalls: 0,
        status: "untested",
        avgCostPerCall: stat?.avgCostPerCall,
      }
    }

    const successRate = stat.successCalls / stat.totalCalls
    const hallucinationRate = stat.hallucinationCount / stat.totalCalls
    const reliability = Math.max(0, Math.min(1, successRate - hallucinationRate * 2))

    let status: ModelScore["status"] = "healthy"
    if (stat.consecutiveFailures >= this.maxConsecutiveFailures) status = "degraded"
    if (hallucinationRate > 0.3 || successRate < 0.4) status = "unstable"

    return { model, reliability, hallucinationRate, totalCalls: stat.totalCalls, status, avgCostPerCall: stat.avgCostPerCall }
  }

  getScoreByTaskType(model: string, taskType: string): ModelScore | null {
    const stat = this.stats.get(model)
    if (!stat || !stat.byTaskType || !stat.byTaskType[taskType]) {
      return {
        model,
        reliability: 0,
        hallucinationRate: 0,
        totalCalls: 0,
        status: "untested",
        avgCostPerCall: stat?.avgCostPerCall,
      }
    }

    const taskStat = stat.byTaskType[taskType]
    if (taskStat.totalCalls === 0) {
      return {
        model,
        reliability: 0,
        hallucinationRate: 0,
        totalCalls: 0,
        status: "untested",
        avgCostPerCall: stat.avgCostPerCall,
      }
    }

    const successRate = taskStat.successCalls / taskStat.totalCalls
    const hallucinationRate = taskStat.hallucinationCount / taskStat.totalCalls
    const reliability = Math.max(0, Math.min(1, successRate - hallucinationRate * 2))

    let status: ModelScore["status"] = "healthy"
    if (taskStat.consecutiveFailures >= this.maxConsecutiveFailures) status = "degraded"
    if (hallucinationRate > 0.3 || successRate < 0.4) status = "unstable"

    return { model, reliability, hallucinationRate, totalCalls: taskStat.totalCalls, status, avgCostPerCall: stat.avgCostPerCall }
  }

  getAllScores(): ModelScore[] {
    const models = new Set<string>()
    for (const key of this.stats.keys()) models.add(key)
    for (const [, aliases] of this.modelAliases) {
      for (const m of aliases) models.add(m)
    }
    return [...models].map(m => this.getScore(m)!).sort((a, b) => b.reliability - a.reliability)
  }

  resolveAlias(alias: string): string[] {
    return this.modelAliases.get(alias) ?? (alias ? [alias] : [])
  }

  suggestWithFallback(_role: string, preferredModels: string[] = []): string[] {
    const candidates = new Set<string>()

    for (const m of preferredModels) {
      const resolved = this.resolveAlias(m)
      for (const r of resolved) if (r) candidates.add(r)
    }

    for (const key of this.stats.keys()) candidates.add(key)

    if (candidates.size === 0) return ["default"]

    const scored = [...candidates]
      .map(m => ({ model: m, score: this.getScore(m) }))
      .sort((a, b) => {
        if (!a.score || !b.score) return 0
        if (a.score.status === "healthy" && b.score.status !== "healthy") return -1
        if (a.score.status !== "healthy" && b.score.status === "healthy") return 1
        return b.score.reliability - a.score.reliability
      })

    return scored.map(s => s.model)
  }

  isBlocked(model: string, config: { hardBlockReliability: number; softBlockReliability: number; minSampleSize: number }): { blocked: boolean; reason: string; severity: "hard" | "soft" | null } {
    const stat = this.stats.get(model)
    if (!stat) return { blocked: false, reason: "", severity: null }

    if (stat.quarantineUntil > 0 && Date.now() < stat.quarantineUntil) {
      const remainingMinutes = Math.ceil((stat.quarantineUntil - Date.now()) / (60 * 1000))
      return { blocked: true, reason: `In quarantine for ${remainingMinutes} more minutes`, severity: "hard" }
    }

    if (stat.totalCalls < config.minSampleSize) {
      return { blocked: false, reason: "", severity: null }
    }

    const score = this.getScore(model)
    if (!score) return { blocked: false, reason: "", severity: null }

    if (score.reliability < config.hardBlockReliability) {
      return { blocked: true, reason: `Reliability ${(score.reliability * 100).toFixed(0)}% < ${(config.hardBlockReliability * 100).toFixed(0)}%`, severity: "hard" }
    }
    if (stat.consecutiveFailures >= 5) {
      return { blocked: true, reason: `${stat.consecutiveFailures} consecutive failures`, severity: "hard" }
    }
    if (score.hallucinationRate > 0.5) {
      return { blocked: true, reason: `Hallucination rate ${(score.hallucinationRate * 100).toFixed(0)}% > 50%`, severity: "hard" }
    }

    if (score.reliability < config.softBlockReliability) {
      return { blocked: true, reason: `Reliability ${(score.reliability * 100).toFixed(0)}% < ${(config.softBlockReliability * 100).toFixed(0)}%`, severity: "soft" }
    }

    return { blocked: false, reason: "", severity: null }
  }

  selectBestModel(
    taskType: string, 
    availableModels: string[], 
    blockingConfig?: { hardBlockReliability: number; softBlockReliability: number; minSampleSize: number }
  ): string {
    if (availableModels.length === 0) return "default"
    if (availableModels.length === 1) return availableModels[0]

    const scored = availableModels
      .map(model => {
        const resolvedModels = this.resolveAlias(model)
        if (resolvedModels.length === 0) return { model, score: null, blocked: false, userSat: 0.5 }
        
        const resolvedObjs = resolvedModels
          .map(m => {
            const blockStatus = blockingConfig 
              ? this.isBlocked(m, blockingConfig)
              : { blocked: false, reason: "", severity: null }
            return { 
              model: m, 
              score: this.getScoreByTaskType(m, taskType),
              blocked: blockStatus.blocked && blockStatus.severity === "hard",
              userSat: this.getUserSatisfaction(m, taskType),
            }
          })
          .filter(s => !s.blocked)
        // Cost-aware scoring: userSat (40%) + reliability (35%) + cost inverse (25%)
        const maxCost = resolvedObjs.reduce((max, o) => Math.max(max, o.score?.avgCostPerCall ?? 0), 0.001)
        const bestResolved = resolvedObjs.sort((a, b) => {
          const aCostNormalized = 1 - ((a.score?.avgCostPerCall ?? 0) / maxCost)
          const bCostNormalized = 1 - ((b.score?.avgCostPerCall ?? 0) / maxCost)
          const aScore = a.userSat * 0.4 + (a.score?.reliability ?? 0.5) * 0.35 + aCostNormalized * 0.25
          const bScore = b.userSat * 0.4 + (b.score?.reliability ?? 0.5) * 0.35 + bCostNormalized * 0.25
          return bScore - aScore
        })[0]
        
        return bestResolved
      })
      .filter(s => s && s.score !== null)
      .sort((a, b) => {
        const maxCost = scored.reduce((max, m) => Math.max(max, m?.score?.avgCostPerCall ?? 0), 0.001)
        const aCostNormalized = 1 - ((a.score?.avgCostPerCall ?? 0) / maxCost)
        const bCostNormalized = 1 - ((b.score?.avgCostPerCall ?? 0) / maxCost)
        const aScore = a.userSat * 0.4 + (a.score?.reliability ?? 0.5) * 0.35 + aCostNormalized * 0.25
        const bScore = b.userSat * 0.4 + (b.score?.reliability ?? 0.5) * 0.35 + bCostNormalized * 0.25
        return bScore - aScore
      })

    return scored.length > 0 ? scored[0].model : availableModels[0]
  }

  selectWithFallback(
    _taskType: string,
    availableModels: string[],
    blockingConfig: { hardBlockReliability: number; softBlockReliability: number; minSampleSize: number }
  ): { model: string; tier: "healthy" | "degraded" | "unstable" | "reset"; warnings: string[] } {
    if (availableModels.length === 0) {
      return { model: "default", tier: "reset", warnings: ["No models available, using default"] }
    }

    const warnings: string[] = []
    const categorized: { healthy: string[]; degraded: string[]; unstable: string[]; hardBlocked: string[] } = {
      healthy: [],
      degraded: [],
      unstable: [],
      hardBlocked: []
    }

    for (const model of availableModels) {
      const blockStatus = this.isBlocked(model, blockingConfig)
      if (blockStatus.blocked && blockStatus.severity === "hard") {
        categorized.hardBlocked.push(model)
        warnings.push(`${model}: HARD BLOCKED - ${blockStatus.reason}`)
        continue
      }

      const score = this.getScore(model)
      if (!score || score.totalCalls < blockingConfig.minSampleSize) {
        categorized.healthy.push(model)
      } else if (score.status === "healthy") {
        categorized.healthy.push(model)
      } else if (score.status === "degraded") {
        categorized.degraded.push(model)
      } else {
        categorized.unstable.push(model)
      }
    }

    if (categorized.healthy.length > 0) {
      return { model: categorized.healthy[0], tier: "healthy", warnings }
    }

    if (categorized.degraded.length > 0) {
      warnings.push(`Using degraded model ${categorized.degraded[0]} - all healthy models unavailable`)
      return { model: categorized.degraded[0], tier: "degraded", warnings }
    }

    if (categorized.unstable.length > 0) {
      warnings.push(`Using unstable model ${categorized.unstable[0]} - all healthy/degraded models unavailable`)
      return { model: categorized.unstable[0], tier: "unstable", warnings }
    }

    const leastBadModel = availableModels[0]
    this.resetModel(leastBadModel)
    warnings.push(`All models blocked - reset ${leastBadModel} and retrying`)
    return { model: leastBadModel, tier: "reset", warnings }
  }

  resetModel(model: string): void {
    const stat = this.stats.get(model)
    if (!stat) return
    
    stat.totalCalls = 0
    stat.successCalls = 0
    stat.failedCalls = 0
    stat.hallucinationCount = 0
    stat.consecutiveFailures = 0
    stat.consecutiveSuccesses = 0
    stat.quarantineUntil = 0
    stat.byTaskType = {}
    stat.userFeedback = {}
  }

  resetStaleModels(staleDays: number = 7): string[] {
    const now = Date.now()
    const staleThreshold = staleDays * 24 * 60 * 60 * 1000
    const resetModels: string[] = []

    for (const [model, stat] of this.stats.entries()) {
      if (stat.lastUsed > 0 && (now - stat.lastUsed) > staleThreshold) {
        this.resetModel(model)
        resetModels.push(model)
      }
    }

    return resetModels
  }

  enterQuarantine(model: string, durationMinutes: number = 30): void {
    const stat = this.stats.get(model)
    if (!stat) return
    
    stat.quarantineUntil = Date.now() + (durationMinutes * 60 * 1000)
    stat.consecutiveSuccesses = 0
  }

  /**
   * Hapus model dari registry sepenuhnya (bukan cuma reset stat).
   * Dipake untuk model palsu kayak "opencode/default" yang gak pernah ada.
   */
  deleteModel(model: string): boolean {
    return this.stats.delete(model)
  }

  getSummary(): string {
    const scores = this.getAllScores()
    if (scores.length === 0) return "No model data recorded yet."

    return scores.map(s => {
      const icon = s.status === "healthy" ? "✅" : s.status === "degraded" ? "⚠️" : "❌"
      const costStr = s.avgCostPerCall !== undefined ? `, avg $${(s.avgCostPerCall * 1000).toFixed(2)}/1K calls` : ""
      return `${icon} **${s.model}** — reliability: ${(s.reliability * 100).toFixed(0)}%, hallucinations: ${(s.hallucinationRate * 100).toFixed(0)}%, calls: ${s.totalCalls}${costStr}`
    }).join("\n")
  }

  toJSON(): Record<string, ModelStats> {
    return Object.fromEntries(this.stats)
  }

  fromJSON(data: Record<string, ModelStats>): void {
    // Two-pass dedup: build canonical key map first
    const merged = new Map<string, ModelStats>()
    for (const [key, val] of Object.entries(data)) {
      // Determine canonical key: if bare name has a prefixed counterpart, merge
      let canon = key
      if (!key.includes("/")) {
        const prefixed = `opencode/${key}`
        if (data[prefixed] || merged.has(prefixed)) canon = prefixed
      }
      const existing = merged.get(canon)
      if (existing) {
        existing.totalCalls += val.totalCalls
        existing.successCalls += val.successCalls
        existing.failedCalls += val.failedCalls
        existing.hallucinationCount += val.hallucinationCount
        if (val.lastUsed > existing.lastUsed) existing.lastUsed = val.lastUsed
        if (val.avgLatencyMs > existing.avgLatencyMs) existing.avgLatencyMs = val.avgLatencyMs
      } else {
        merged.set(canon, { ...val, model: canon })
      }
    }
    for (const [key, val] of merged) {
      this.stats.set(key, val)
    }
  }
}
