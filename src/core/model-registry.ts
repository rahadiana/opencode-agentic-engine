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
}

export interface ModelScore {
  model: string
  reliability: number
  hallucinationRate: number
  totalCalls: number
  status: "healthy" | "degraded" | "unstable"
}

export class ModelRegistry {
  private stats = new Map<string, ModelStats>()
  private modelAliases: Map<string, string[]> = new Map()

  private readonly maxConsecutiveFailures = 3

  constructor() {
    this.modelAliases.set("fast", [])
    this.modelAliases.set("capable", [])
  }

  registerAlias(alias: string, models: string[]): void {
    this.modelAliases.set(alias, models)
  }

  addModel(name: string): void {
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
      })
    }
  }

  recordCall(model: string, success: boolean, latencyMs: number, taskType?: string): void {
    this.addModel(model)
    const stat = this.stats.get(model)!
    stat.totalCalls++
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

  getScore(model: string): ModelScore | null {
    const stat = this.stats.get(model)
    if (!stat || stat.totalCalls === 0) {
      return {
        model,
        reliability: 0.5,
        hallucinationRate: 0,
        totalCalls: 0,
        status: "healthy",
      }
    }

    const successRate = stat.successCalls / stat.totalCalls
    const hallucinationRate = stat.hallucinationCount / stat.totalCalls
    const reliability = Math.max(0, Math.min(1, successRate - hallucinationRate * 2))

    let status: ModelScore["status"] = "healthy"
    if (stat.consecutiveFailures >= this.maxConsecutiveFailures) status = "degraded"
    if (hallucinationRate > 0.3 || successRate < 0.4) status = "unstable"

    return { model, reliability, hallucinationRate, totalCalls: stat.totalCalls, status }
  }

  getScoreByTaskType(model: string, taskType: string): ModelScore | null {
    const stat = this.stats.get(model)
    if (!stat || !stat.byTaskType || !stat.byTaskType[taskType]) {
      return {
        model,
        reliability: 0.5,
        hallucinationRate: 0,
        totalCalls: 0,
        status: "healthy",
      }
    }

    const taskStat = stat.byTaskType[taskType]
    if (taskStat.totalCalls === 0) {
      return {
        model,
        reliability: 0.5,
        hallucinationRate: 0,
        totalCalls: 0,
        status: "healthy",
      }
    }

    const successRate = taskStat.successCalls / taskStat.totalCalls
    const hallucinationRate = taskStat.hallucinationCount / taskStat.totalCalls
    const reliability = Math.max(0, Math.min(1, successRate - hallucinationRate * 2))

    let status: ModelScore["status"] = "healthy"
    if (taskStat.consecutiveFailures >= this.maxConsecutiveFailures) status = "degraded"
    if (hallucinationRate > 0.3 || successRate < 0.4) status = "unstable"

    return { model, reliability, hallucinationRate, totalCalls: taskStat.totalCalls, status }
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
        if (resolvedModels.length === 0) return { model, score: null, blocked: false }
        
        const bestResolved = resolvedModels
          .map(m => {
            const blockStatus = blockingConfig 
              ? this.isBlocked(m, blockingConfig)
              : { blocked: false, reason: "", severity: null }
            return { 
              model: m, 
              score: this.getScoreByTaskType(m, taskType),
              blocked: blockStatus.blocked && blockStatus.severity === "hard"
            }
          })
          .filter(s => !s.blocked)
          .sort((a, b) => {
            if (!a.score || !b.score) return 0
            if (a.score.status === "healthy" && b.score.status !== "healthy") return -1
            if (a.score.status !== "healthy" && b.score.status === "healthy") return 1
            return b.score.reliability - a.score.reliability
          })[0]
        
        return bestResolved
      })
      .filter(s => s && s.score !== null)
      .sort((a, b) => {
        if (!a.score || !b.score) return 0
        if (a.score.status === "healthy" && b.score.status !== "healthy") return -1
        if (a.score.status !== "healthy" && b.score.status === "healthy") return 1
        return b.score.reliability - a.score.reliability
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

  getSummary(): string {
    const scores = this.getAllScores()
    if (scores.length === 0) return "No model data recorded yet."

    return scores.map(s => {
      const icon = s.status === "healthy" ? "✅" : s.status === "degraded" ? "⚠️" : "❌"
      return `${icon} **${s.model}** — reliability: ${(s.reliability * 100).toFixed(0)}%, hallucinations: ${(s.hallucinationRate * 100).toFixed(0)}%, calls: ${s.totalCalls}`
    }).join("\n")
  }

  toJSON(): Record<string, ModelStats> {
    return Object.fromEntries(this.stats)
  }

  fromJSON(data: Record<string, ModelStats>): void {
    for (const [key, val] of Object.entries(data)) {
      this.stats.set(key, val)
    }
  }
}
