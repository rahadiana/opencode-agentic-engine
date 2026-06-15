export interface ModelStats {
  model: string
  totalCalls: number
  successCalls: number
  failedCalls: number
  hallucinationCount: number
  avgLatencyMs: number
  lastUsed: number
  consecutiveFailures: number
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
      })
    }
  }

  recordCall(model: string, success: boolean, latencyMs: number): void {
    this.addModel(model)
    const stat = this.stats.get(model)!
    stat.totalCalls++
    stat.lastUsed = Date.now()

    if (success) {
      stat.successCalls++
      stat.consecutiveFailures = 0
    } else {
      stat.failedCalls++
      stat.consecutiveFailures++
    }

    stat.avgLatencyMs = stat.avgLatencyMs === 0
      ? latencyMs
      : (stat.avgLatencyMs * (stat.totalCalls - 1) + latencyMs) / stat.totalCalls
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

  suggestWithFallback(role: string, preferredModels: string[] = []): string[] {
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
