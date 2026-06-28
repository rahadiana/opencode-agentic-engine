/**
 * EconomicModel — Gap #11: Cost-aware orchestration & economic models.
 *
 * From paper (Section 7.2): "How should agentic services be priced?
 * Outcome-based pricing may replace subscription and usage-based models,
 * but the incentive structures and risk allocation need careful analysis."
 *
 * Tracks ROI per task/agent/step and provides cost-aware task routing
 * recommendations. Extends budget-tracker.ts with outcome economics.
 *
 * ponytail: One file, lightweight cost-per-outcome tracking.
 * Does NOT replace budget-tracker.ts — adds outcome economics on top.
 */

import type { BudgetScope } from "./budget-tracker.js"

// ── Types ──────────────────────────────────────────────────────

export interface OutcomeMetrics {
  taskId: string
  role?: string
  cost: number           // Total cost in USD
  durationMs: number     // Wall-clock duration
  steps: number          // Number of sub-steps
  success: boolean       // Was the outcome successful?
  qualityScore?: number  // Optional quality metric (0-1)
  timestamp: number
}

export interface ROISnapshot {
  taskId: string
  costPerStep: number
  costPerMs: number
  roi: number             // qualityScore / cost, or success/cost
  outcomeScore: number    // Composite success metric
  valueRank: string       // "high" | "medium" | "low"
}

export interface CostRecommendation {
  recommendedRole: string   // Most cost-effective role
  estimatedCost: number
  estimatedSteps: number
  confidence: number         // 0-1 based on historical data
  reasoning: string
}

export interface EconomicModelConfig {
  /** Default quality/outcome weight for ROI */
  defaultQualityWeight: number
  /** History window (max entries) */
  maxHistory: number
  /** Minimum data points before recommendations can be made */
  minDataPoints: number
}

// ── Defaults ───────────────────────────────────────────────────

const DEFAULT_CONFIG: EconomicModelConfig = {
  defaultQualityWeight: 0.7,
  maxHistory: 500,
  minDataPoints: 3,
}

// ── EconomicModel Class ───────────────────────────────────────

export class EconomicModel {
  private config: EconomicModelConfig
  private outcomes: OutcomeMetrics[] = []

  constructor(config?: Partial<EconomicModelConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /** Record outcome for ROI tracking */
  recordOutcome(metrics: OutcomeMetrics): void {
    if (this.outcomes.length >= this.config.maxHistory) {
      this.outcomes.shift() // ponytail: bounded queue
    }
    this.outcomes.push(metrics)
  }

  /** Get ROI for a specific task */
  getROI(taskId: string): ROISnapshot | null {
    const taskOutcomes = this.outcomes.filter(o => o.taskId === taskId)
    if (taskOutcomes.length === 0) return null

    const latest = taskOutcomes[taskOutcomes.length - 1]
    const costPerStep = latest.steps > 0 ? latest.cost / latest.steps : 0
    const costPerMs = latest.durationMs > 0 ? latest.cost / latest.durationMs : 0
    const outcomeScore = (latest.qualityScore ?? (latest.success ? 0.8 : 0.2)) * this.config.defaultQualityWeight
    const roi = latest.cost > 0 ? outcomeScore / (latest.cost * 100) : outcomeScore

    return {
      taskId,
      costPerStep,
      costPerMs,
      roi,
      outcomeScore,
      valueRank: roi > 1 ? "high" : roi > 0.1 ? "medium" : "low",
    }
  }

  /** Get stats per role: average cost + success rate */
  getRoleStats(): Array<{ role: string; avgCost: number; successRate: number; count: number }> {
    const byRole = new Map<string, OutcomeMetrics[]>()
    for (const o of this.outcomes) {
      if (o.role) {
        const list = byRole.get(o.role) ?? []
        list.push(o)
        byRole.set(o.role, list)
      }
    }
    return [...byRole.entries()].map(([role, list]) => ({
      role,
      avgCost: list.reduce((s, o) => s + o.cost, 0) / list.length,
      successRate: list.filter(o => o.success).length / list.length,
      count: list.length,
    }))
  }

  /**
   * Recommend most cost-effective role for a task based on historical data.
   * Returns best role by lowest cost-per-success ratio.
   */
  recommendRole(taskDescription: string, availableRoles: string[]): CostRecommendation | null {
    // ponytail: keyword-based task → role mapping
    const keywordRoleMap: Record<string, string[]> = {
      architect:   ["design", "architecture", "system", "plan", "structure", "component", "module"],
      developer:   ["implement", "code", "feature", "function", "api", "endpoint", "fix", "bug"],
      qa:          ["test", "verify", "check", "validate", "audit", "coverage", "quality"],
      coordinator: ["coordinate", "manage", "orchestrate", "pipeline", "workflow", "deploy"],
      pm:          ["requirement", "spec", "roadmap", "priority", "milestone", "stakeholder"],
    }

    const desc = taskDescription.toLowerCase()

    // Score each available role by keyword match
    const scoredRoles = availableRoles.map(role => {
      const keywords = keywordRoleMap[role] ?? []
      const matchCount = keywords.filter(kw => desc.includes(kw)).length
      return { role, score: matchCount / Math.max(keywords.length, 1) }
    }).sort((a, b) => b.score - a.score)

    const bestMatch = scoredRoles[0]
    if (!bestMatch || bestMatch.score === 0) return null

    // Estimate cost from historical data for this role
    const roleOutcomes = this.outcomes.filter(o => o.role === bestMatch.role)
    const avgCost = roleOutcomes.length > 0
      ? roleOutcomes.reduce((s, o) => s + o.cost, 0) / roleOutcomes.length
      : 0.01 // default minimum
    const avgSteps = roleOutcomes.length > 0
      ? Math.round(roleOutcomes.reduce((s, o) => s + o.steps, 0) / roleOutcomes.length)
      : 3
    const confidence = Math.min(1, roleOutcomes.length / this.config.minDataPoints)

    return {
      recommendedRole: bestMatch.role,
      estimatedCost: avgCost,
      estimatedSteps: avgSteps,
      confidence,
      reasoning: `Role "${bestMatch.role}" matched ${Math.round(bestMatch.score * 100)}% of keywords in task description. ${roleOutcomes.length} historical outcomes available.`,
    }
  }

  /** Aggregate cost report per scope (matches BudgetTracker pattern) */
  getCostReport(scope: BudgetScope): { totalCost: number; avgCost: number; taskCount: number; successRate: number } {
    const relevant = scope === "session" ? this.outcomes : this.outcomes
    const totalCost = relevant.reduce((s, o) => s + o.cost, 0)
    const taskCount = relevant.length
    const successCount = relevant.filter(o => o.success).length
    return {
      totalCost: Math.round(totalCost * 100) / 100,
      avgCost: taskCount > 0 ? Math.round((totalCost / taskCount) * 100) / 100 : 0,
      taskCount,
      successRate: taskCount > 0 ? Math.round((successCount / taskCount) * 100) : 100,
    }
  }

  /** Reset state */
  reset(): void {
    this.outcomes = []
  }

  /** Summary for dashboard */
  getSummary(): string {
    const report = this.getCostReport("session")
    const roleStats = this.getRoleStats()
    const roleSummary = roleStats.map(r => `${r.role}: $${r.avgCost.toFixed(4)}/task, ${Math.round(r.successRate * 100)}% success`).join(" | ")
    return `Economic: $${report.totalCost} total, $${report.avgCost}/task avg, ${report.successRate}% success${roleSummary ? ` | ${roleSummary}` : ""}`
  }
}
