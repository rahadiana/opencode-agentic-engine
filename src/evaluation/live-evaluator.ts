// src/evaluation/live-evaluator.ts — Real-time evaluation score
// Mengukur performa agent secara live dari aktivitas sesi nyata,
// mirip metrik SWE-bench (task success) dan EvoClaw (continuous evolution).
//
// Bobot:
//   taskSuccess:   40% — % step yang sukses
//   errorRecovery: 20% — % error yang pulih setelah retry
//   contextStability: 15% — konsistensi navigasi file
//   multiAgent:   15% — % delegasi sukses
//   skillReuse:   10% — skill ditemukan & dipakai ulang

export interface LiveEvalConfidenceInterval {
  mean: number
  stddev: number
  count: number
}

export interface LiveEvalDimension {
  score: number    // 0-1
  weight: number   // bobot kontribusi ke overall
  target: number   // target minimal (0-1)
  detail: string   // human-readable
  confidenceInterval?: LiveEvalConfidenceInterval
}

export interface LiveEvalScore {
  overall: number           // 0-100
  dimensions: Record<string, LiveEvalDimension>
  totalSteps: number
  totalErrors: number
  recoveredErrors: number
  totalDelegations: number
  successfulDelegations: number
  /**
   * SWE-bench-style: berapa % task yang success dari total
   * EvoClaw-style: composite weighted score
   */
  sweBenchScore: number     // task success rate (0-100)
  evoClawScore: number      // composite score (0-100)
}

export class LiveEvaluator {
  private stepResults: Array<{ stepId: string; success: boolean; sessionId?: string; timestamp?: number }> = []
  private errorRecoveries: Array<{ errorId: string; recovered: boolean; sessionId?: string }> = []
  private navigations: Array<{ query: string; resultsCount: number; focused: boolean; sessionId?: string }> = []
  private delegations: Array<{ taskId: string; role: string; success: boolean; sessionId?: string }> = []
  private skillLookups: Array<{ found: boolean; sessionId?: string }> = []
  private stabilityThreshold = 10

  // ── Feed methods ──

  feedStepResult(step: { stepId: string; success: boolean; sessionId?: string; timestamp?: number }): void {
    this.stepResults.push({ ...step, timestamp: step.timestamp ?? Date.now() })
  }

  setStabilityThreshold(threshold: number): void {
    this.stabilityThreshold = Math.max(1, threshold)
  }

  feedErrorRecovery(errorId: string, recovered: boolean, sessionId?: string): void {
    this.errorRecoveries.push({ errorId, recovered, sessionId })
  }

  feedNavigation(query: string, resultsCount: number, sessionId?: string): void {
    this.navigations.push({ query, resultsCount, focused: resultsCount > 0 && resultsCount <= this.stabilityThreshold, sessionId })
  }

  feedDelegation(taskId: string, role: string, success: boolean, sessionId?: string): void {
    this.delegations.push({ taskId, role, success, sessionId })
  }

  feedSkillLookup(found: boolean, sessionId?: string): void {
    this.skillLookups.push({ found, sessionId })
  }

  // ── Compute methods ──

  /**
   * Task success rate (SWE-bench style).
   * Berapa % step yang sukses dari total.
   */
  computeTaskSuccess(sessionID?: string): number {
    const results = sessionID ? this.stepResults.filter(s => s.sessionId === sessionID) : this.stepResults
    const total = results.length
    if (total === 0) return 0
    const successes = results.filter(s => s.success).length
    return successes / total
  }

  /**
   * Error recovery rate.
   * Berapa % error yang berhasil pulih (retry sukses setelah error).
   */
  computeErrorRecovery(sessionID?: string): number {
    const data = sessionID ? this.errorRecoveries.filter(e => e.sessionId === sessionID) : this.errorRecoveries
    const total = data.length
    if (total === 0) return 1
    const recovered = data.filter(e => e.recovered).length
    return recovered / total
  }

  /**
   * Context stability score.
   * Navigasi yang fokus (≤10 results) mengindikasikan pemahaman codebase yang baik.
   */
  computeContextStability(sessionID?: string): number {
    const navs = sessionID ? this.navigations.filter(n => n.sessionId === sessionID) : this.navigations
    const total = navs.length
    if (total === 0) return 1
    const focused = navs.filter(n => n.focused).length
    return focused / total
  }

  /**
   * Multi-agent coordination rate.
   * Berapa % delegasi yang sukses.
   */
  computeMultiAgent(sessionID?: string): number {
    const dels = sessionID ? this.delegations.filter(d => d.sessionId === sessionID) : this.delegations
    const total = dels.length
    if (total === 0) return 1
    const successes = dels.filter(d => d.success).length
    return successes / total
  }

  /**
   * Skill reuse rate.
   * Berapa % lookup skill yang berhasil ditemukan.
   */
  computeSkillReuse(sessionID?: string): number {
    const lookups = sessionID ? this.skillLookups.filter(s => s.sessionId === sessionID) : this.skillLookups
    const total = lookups.length
    if (total === 0) return 0.5
    const found = lookups.filter(s => s.found).length
    return found / total
  }

  private computeCI(scores: number[]): LiveEvalConfidenceInterval | undefined {
    if (scores.length < 2) return undefined
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length
    const variance = scores.reduce((a, b) => a + (b - mean) ** 2, 0) / (scores.length - 1)
    return { mean, stddev: Math.sqrt(variance), count: scores.length }
  }

  private safeScore(v: number): number {
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0
  }

  /**
   * Compute overall live evaluation score, optionally scoped to a session.
   */
  computeScore(sessionID?: string): LiveEvalScore {
    const taskSuccessScore = this.safeScore(this.computeTaskSuccess(sessionID))
    const errorRecoveryScore = this.safeScore(this.computeErrorRecovery(sessionID))
    const contextStabilityScore = this.safeScore(this.computeContextStability(sessionID))
    const multiAgentScore = this.safeScore(this.computeMultiAgent(sessionID))
    const skillReuseScore = this.safeScore(this.computeSkillReuse(sessionID))

    const dimensions: Record<string, LiveEvalDimension> = {
      taskSuccess: {
        score: taskSuccessScore,
        weight: 0.40,
        target: 0.80,
        detail: `${(taskSuccessScore * 100).toFixed(0)}% step success (target >80%)`,
        confidenceInterval: this.computeCI(this.stepResults.map(() => taskSuccessScore)),
      },
      errorRecovery: {
        score: errorRecoveryScore,
        weight: 0.20,
        target: 0.70,
        detail: `${(errorRecoveryScore * 100).toFixed(0)}% error recovery (target >70%)`,
        confidenceInterval: this.computeCI(this.errorRecoveries.map(() => errorRecoveryScore)),
      },
      contextStability: {
        score: contextStabilityScore,
        weight: 0.15,
        target: 0.80,
        detail: `${(contextStabilityScore * 100).toFixed(0)}% focused navigation (target >80%)`,
        confidenceInterval: this.computeCI(this.navigations.map(() => contextStabilityScore)),
      },
      multiAgent: {
        score: multiAgentScore,
        weight: 0.15,
        target: 0.90,
        detail: `${(multiAgentScore * 100).toFixed(0)}% delegation success (target >90%)`,
        confidenceInterval: this.computeCI(this.delegations.map(() => multiAgentScore)),
      },
      skillReuse: {
        score: skillReuseScore,
        weight: 0.10,
        target: 0.50,
        detail: `${(skillReuseScore * 100).toFixed(0)}% skill found (target >50%)`,
        confidenceInterval: this.computeCI(this.skillLookups.map(() => skillReuseScore)),
      },
    }

    const weightTotal = Object.values(dimensions).reduce((s, d) => s + d.weight, 0)
    if (Math.abs(weightTotal - 1.0) > 0.001) {
      for (const d of Object.values(dimensions)) d.weight /= weightTotal
    }

    const overall = Object.values(dimensions).reduce((s, d) => s + d.score * d.weight, 0)
    const sweBenchScore = taskSuccessScore * 100
    const evoClawScore = overall * 100

    return {
      overall: Math.round(overall * 100),
      dimensions,
      totalSteps: this.stepResults.length,
      totalErrors: this.errorRecoveries.length,
      recoveredErrors: this.errorRecoveries.filter(e => e.recovered).length,
      totalDelegations: this.delegations.length,
      successfulDelegations: this.delegations.filter(d => d.success).length,
      sweBenchScore: Math.round(sweBenchScore),
      evoClawScore: Math.round(evoClawScore),
    }
  }

  /**
   * Generate human-readable report.
   */
  formatReport(includeTips = true, sessionID?: string): string {
    const score = this.computeScore(sessionID)

    let out = `## Live Evaluation Score\n\n`
    out += `**Overall:** ${score.overall}/100\n`
    out += `**SWE-bench Score:** ${score.sweBenchScore}/100 (task success)\n`
    out += `**EvoClaw Score:** ${score.evoClawScore}/100 (composite)\n\n`

    out += `### Dimensions\n`
    for (const [name, dim] of Object.entries(score.dimensions)) {
      const bar = "#".repeat(Math.round(dim.score * 20))
      const icon = dim.score >= dim.target ? "[OK]" : dim.score >= dim.target * 0.7 ? "[WARN]" : "[FAIL]"
      out += `${icon} **${name}:** ${(dim.score * 100).toFixed(0)}% ` +
        `${bar.padEnd(20, "-")} ` +
        `(target: ${(dim.target * 100).toFixed(0)}%, weight: ${(dim.weight * 100).toFixed(0)}%)\n`
      out += `  ${dim.detail}\n`
    }

    out += `\n### Activity\n`
    out += `- **Steps:** ${score.totalSteps} | **Errors:** ${score.totalErrors} (${score.recoveredErrors} recovered)\n`
    out += `- **Delegations:** ${score.totalDelegations} (${score.successfulDelegations} successful)\n`

    if (includeTips && score.overall < 80) {
      out += `\n### Tips\n`
      if (score.dimensions.taskSuccess.score < 0.8) {
        out += `- [FIX] Task success rendah. Aktifkan \`autoVerify\` di agentic_execute.\n`
      }
      if (score.dimensions.errorRecovery.score < 0.7) {
        out += `- [FIX] Error recovery rendah. Tambah retry steps atau refine error messages.\n`
      }
      if (score.dimensions.contextStability.score < 0.8) {
        out += `- [FIX] Navigasi terlalu broad. Pakai \`agentic_context\` lebih sering.\n`
      }
      if (score.dimensions.multiAgent.score < 0.9) {
        out += `- [FIX] Delegasi sering gagal. Cek role availability.\n`
      }
      if (score.dimensions.skillReuse.score < 0.5) {
        out += `- [FIX] Skill jarang dipakai. Extract skill setelah task sukses via \`agentic_skill extract\`.\n`
      }
    }

    return out
  }

  /** Serialize for persistence */
  toJSON(): {
    stepResults: Array<{ stepId: string; success: boolean; sessionId?: string; timestamp?: number }>
    errorRecoveries: Array<{ errorId: string; recovered: boolean; sessionId?: string }>
    navigations: Array<{ query: string; resultsCount: number; focused: boolean; sessionId?: string }>
    delegations: Array<{ taskId: string; role: string; success: boolean; sessionId?: string }>
    skillLookups: Array<{ found: boolean; sessionId?: string }>
  } {
    return {
      stepResults: this.stepResults,
      errorRecoveries: this.errorRecoveries,
      navigations: this.navigations,
      delegations: this.delegations,
      skillLookups: this.skillLookups,
    }
  }

  /** Restore from persisted state — validates data shape */
  fromJSON(data: unknown): void {
    if (!data || typeof data !== "object") throw new Error("LiveEvaluator.fromJSON: invalid data")
    const d = data as Record<string, unknown>
    if (Array.isArray(d.stepResults)) {
      this.stepResults = d.stepResults as Array<{ stepId: string; success: boolean; sessionId?: string; timestamp?: number }>
    }
    if (Array.isArray(d.errorRecoveries)) {
      this.errorRecoveries = d.errorRecoveries as Array<{ errorId: string; recovered: boolean; sessionId?: string }>
    }
    if (Array.isArray(d.navigations)) {
      this.navigations = d.navigations as Array<{ query: string; resultsCount: number; focused: boolean; sessionId?: string }>
    }
    if (Array.isArray(d.delegations)) {
      this.delegations = d.delegations as Array<{ taskId: string; role: string; success: boolean; sessionId?: string }>
    }
    if (Array.isArray(d.skillLookups)) {
      this.skillLookups = d.skillLookups as Array<{ found: boolean; sessionId?: string }>
    }
  }
}
