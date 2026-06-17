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

export interface LiveEvalDimension {
  score: number    // 0-1
  weight: number   // bobot kontribusi ke overall
  target: number   // target minimal (0-1)
  detail: string   // human-readable
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
  private stepResults: Array<{ stepId: string; success: boolean; sessionId?: string }> = []
  private errorRecoveries: Array<{ errorId: string; recovered: boolean }> = []
  private navigations: Array<{ query: string; resultsCount: number; focused: boolean }> = []
  private delegations: Array<{ taskId: string; role: string; success: boolean }> = []
  private skillLookups: Array<{ found: boolean }> = []

  // ── Feed methods ──

  feedStepResult(step: { stepId: string; success: boolean; sessionId?: string }): void {
    this.stepResults.push(step)
  }

  feedErrorRecovery(errorId: string, recovered: boolean): void {
    this.errorRecoveries.push({ errorId, recovered })
  }

  feedNavigation(query: string, resultsCount: number): void {
    this.navigations.push({ query, resultsCount, focused: resultsCount > 0 && resultsCount <= 10 })
  }

  feedDelegation(taskId: string, role: string, success: boolean): void {
    this.delegations.push({ taskId, role, success })
  }

  feedSkillLookup(found: boolean): void {
    this.skillLookups.push({ found })
  }

  // ── Compute methods ──

  /**
   * Task success rate (SWE-bench style).
   * Berapa % step yang sukses dari total.
   */
  computeTaskSuccess(): number {
    const total = this.stepResults.length
    if (total === 0) return 0
    const successes = this.stepResults.filter(s => s.success).length
    return successes / total
  }

  /**
   * Error recovery rate.
   * Berapa % error yang berhasil pulih (retry sukses setelah error).
   */
  computeErrorRecovery(): number {
    const total = this.errorRecoveries.length
    if (total === 0) return 1 // no errors = perfect recovery
    const recovered = this.errorRecoveries.filter(e => e.recovered).length
    return recovered / total
  }

  /**
   * Context stability score.
   * Navigasi yang fokus (≤10 results) mengindikasikan pemahaman codebase yang baik.
   */
  computeContextStability(): number {
    const total = this.navigations.length
    if (total === 0) return 1 // no nav = stable (nothing drifted)
    const focused = this.navigations.filter(n => n.focused).length
    return focused / total
  }

  /**
   * Multi-agent coordination rate.
   * Berapa % delegasi yang sukses.
   */
  computeMultiAgent(): number {
    const total = this.delegations.length
    if (total === 0) return 1 // no delegation = not relevant
    const successes = this.delegations.filter(d => d.success).length
    return successes / total
  }

  /**
   * Skill reuse rate.
   * Berapa % lookup skill yang berhasil ditemukan.
   */
  computeSkillReuse(): number {
    const total = this.skillLookups.length
    if (total === 0) return 0.5 // neutral — no skill usage tracked
    const found = this.skillLookups.filter(s => s.found).length
    return found / total
  }

  /**
   * Compute overall live evaluation score.
   */
  computeScore(): LiveEvalScore {
    const taskSuccessScore = this.computeTaskSuccess()
    const errorRecoveryScore = this.computeErrorRecovery()
    const contextStabilityScore = this.computeContextStability()
    const multiAgentScore = this.computeMultiAgent()
    const skillReuseScore = this.computeSkillReuse()

    const dimensions: Record<string, LiveEvalDimension> = {
      taskSuccess: {
        score: taskSuccessScore,
        weight: 0.40,
        target: 0.80,  // SWE-bench target
        detail: `${(taskSuccessScore * 100).toFixed(0)}% step success (target >80%)`,
      },
      errorRecovery: {
        score: errorRecoveryScore,
        weight: 0.20,
        target: 0.70,
        detail: `${(errorRecoveryScore * 100).toFixed(0)}% error recovery (target >70%)`,
      },
      contextStability: {
        score: contextStabilityScore,
        weight: 0.15,
        target: 0.80,
        detail: `${(contextStabilityScore * 100).toFixed(0)}% focused navigation (target >80%)`,
      },
      multiAgent: {
        score: multiAgentScore,
        weight: 0.15,
        target: 0.90,
        detail: `${(multiAgentScore * 100).toFixed(0)}% delegation success (target >90%)`,
      },
      skillReuse: {
        score: skillReuseScore,
        weight: 0.10,
        target: 0.50,
        detail: `${(skillReuseScore * 100).toFixed(0)}% skill found (target >50%)`,
      },
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
  formatReport(includeTips = true): string {
    const score = this.computeScore()

    let out = `## 📊 Live Evaluation Score\n\n`
    out += `**Overall:** ${score.overall}/100\n`
    out += `**SWE-bench Score:** ${score.sweBenchScore}/100 (task success)\n`
    out += `**EvoClaw Score:** ${score.evoClawScore}/100 (composite)\n\n`

    out += `### Dimensions\n`
    for (const [name, dim] of Object.entries(score.dimensions)) {
      const bar = "█".repeat(Math.round(dim.score * 20))
      const icon = dim.score >= dim.target ? "✅" : dim.score >= dim.target * 0.7 ? "⚠️" : "❌"
      out += `${icon} **${name}:** ${(dim.score * 100).toFixed(0)}% ` +
        `${bar.padEnd(20, "░")} ` +
        `(target: ${(dim.target * 100).toFixed(0)}%, weight: ${(dim.weight * 100).toFixed(0)}%)\n`
      out += `  ${dim.detail}\n`
    }

    out += `\n### Activity\n`
    out += `- **Steps:** ${score.totalSteps} | **Errors:** ${score.totalErrors} (${score.recoveredErrors} recovered)\n`
    out += `- **Delegations:** ${score.totalDelegations} (${score.successfulDelegations} successful)\n`

    if (includeTips && score.overall < 80) {
      out += `\n### Tips\n`
      if (score.dimensions.taskSuccess.score < 0.8) {
        out += `- 🔧 Task success rendah. Aktifkan \`autoVerify\` di agentic_execute.\n`
      }
      if (score.dimensions.errorRecovery.score < 0.7) {
        out += `- 🔧 Error recovery rendah. Tambah retry steps atau refine error messages.\n`
      }
      if (score.dimensions.contextStability.score < 0.8) {
        out += `- 🔧 Navigasi terlalu broad. Pakai \`agentic_context\` lebih sering.\n`
      }
      if (score.dimensions.multiAgent.score < 0.9) {
        out += `- 🔧 Delegasi sering gagal. Cek role availability.\n`
      }
      if (score.dimensions.skillReuse.score < 0.5) {
        out += `- 🔧 Skill jarang dipakai. Extract skill setelah task sukses via \`agentic_skill extract\`.\n`
      }
    }

    return out
  }

  /** Serialize for persistence */
  toJSON(): {
    stepResults: Array<{ stepId: string; success: boolean; sessionId?: string }>
    errorRecoveries: Array<{ errorId: string; recovered: boolean }>
    navigations: Array<{ query: string; resultsCount: number; focused: boolean }>
    delegations: Array<{ taskId: string; role: string; success: boolean }>
    skillLookups: Array<{ found: boolean }>
  } {
    return {
      stepResults: this.stepResults,
      errorRecoveries: this.errorRecoveries,
      navigations: this.navigations,
      delegations: this.delegations,
      skillLookups: this.skillLookups,
    }
  }

  /** Restore from persisted state */
  fromJSON(data: ReturnType<LiveEvaluator["toJSON"]>): void {
    this.stepResults = data.stepResults || []
    this.errorRecoveries = data.errorRecoveries || []
    this.navigations = data.navigations || []
    this.delegations = data.delegations || []
    this.skillLookups = data.skillLookups || []
  }
}
