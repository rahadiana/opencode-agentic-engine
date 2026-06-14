export interface ContextSummary {
  /** Condensed version of the plan and execution history */
  planSummary: string
  /** Key decisions made and why */
  decisions: string[]
  /** Files changed and what was done to them */
  fileChanges: string[]
  /** Invariants that must be preserved */
  invariants: string[]
  /** Open issues or unresolved items */
  openItems: string[]
  /** Token estimate of the compressed context */
  estimatedTokens: number
}

export class ContextCompressor {
  private windowSize = 5
  private summaryInterval = 5

  compress(planSummary: string, turns: Array<{ role: string; content: string }>, decisions: string[], fileChanges: string[]): ContextSummary {
    const relevantTurns = turns.slice(-this.windowSize * 3)

    // Extract key information from turns
    const extracted = this.extractKeyInfo(relevantTurns)

    // Combine with explicit trackers
    const allDecisions = [...new Set([...decisions, ...extracted.decisions])]
    const allFileChanges = [...new Set([...fileChanges, ...extracted.fileChanges])]
    const allInvariants = extracted.invariants
    const allOpenItems = extracted.openItems

    const summary: ContextSummary = {
      planSummary: `Goal: ${planSummary.slice(0, 200)}`,
      decisions: allDecisions.slice(-10),
      fileChanges: allFileChanges.slice(-15),
      invariants: allInvariants,
      openItems: allOpenItems,
      estimatedTokens: this.estimateTokens(planSummary, allDecisions, allFileChanges),
    }

    return summary
  }

  shouldCompress(turnCount: number, currentTokensEstimate: number, maxTokens = 100_000): boolean {
    return turnCount > this.summaryInterval * 3 || currentTokensEstimate > maxTokens * 0.7
  }

  compressToPrompt(summary: ContextSummary): string {
    const parts: string[] = [
      "## Compressed Context",
      "",
      `**Plan:** ${summary.planSummary}`,
      "",
      "### Key Decisions",
      ...summary.decisions.map((d, i) => `${i + 1}. ${d}`),
      "",
      "### Files Modified",
      ...summary.fileChanges.map(f => `- \`${f}\``),
    ]

    if (summary.invariants.length > 0) {
      parts.push("", "### Invariants (MUST be preserved)", ...summary.invariants.map(i => `- ${i}`))
    }

    if (summary.openItems.length > 0) {
      parts.push("", "### Open Items", ...summary.openItems.map(i => `- ${i}`))
    }

    parts.push("", `---`, `*Compressed context (~${summary.estimatedTokens} tokens)*`)

    return parts.join("\n")
  }

  private extractKeyInfo(turns: Array<{ role: string; content: string }>): {
    decisions: string[]
    fileChanges: string[]
    invariants: string[]
    openItems: string[]
  } {
    const decisions: string[] = []
    const fileChanges: string[] = []
    const invariants: string[] = []
    const openItems: string[] = []

    for (const turn of turns) {
      const content = turn.content ?? ""

      // Extract decisions (heuristic patterns)
      const decisionMatches = content.match(/(?:decided|chose|opted|will use|using) (.+?)(?:\.|$)/gi)
      if (decisionMatches) {
        decisions.push(...decisionMatches.map(d => d.trim()).slice(0, 3))
      }

      // Extract file paths
      const fileMatches = content.match(/(?:src|lib|test|app)\/[\w/.\-]+/gi)
      if (fileMatches) {
        fileChanges.push(...fileMatches)
      }

      // Detect invariants
      if (content.includes("must not") || content.includes("should never") || content.includes("invariant")) {
        const lines = content.split("\n").filter(l =>
          l.includes("must not") || l.includes("should never") || l.includes("invariant")
        )
        invariants.push(...lines.map(l => l.trim()).slice(0, 3))
      }

      // Detect open items (TODO, FIXME, remaining)
      if (content.includes("TODO") || content.includes("remaining") || content.includes("still need")) {
        openItems.push(content.slice(0, 120))
      }
    }

    return { decisions, fileChanges, invariants, openItems }
  }

  private estimateTokens(planSummary: string, decisions: string[], fileChanges: string[]): number {
    const text = [planSummary, ...decisions, ...fileChanges].join(" ")
    return Math.ceil(text.length / 4)
  }
}
