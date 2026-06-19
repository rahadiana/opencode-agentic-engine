import type { LLMEngine } from "../core/llm.js"

export interface ContextSummary {
  planSummary: string
  decisions: string[]
  fileChanges: string[]
  invariants: string[]
  openItems: string[]
  estimatedTokens: number
}

export class ContextCompressor {
  private windowSize = 5
  private summaryInterval = 5
  private llm: LLMEngine | null = null

  setLLM(llm: LLMEngine): void {
    this.llm = llm
  }

  compress(planSummary: string, turns: Array<{ role: string; content: string }>, decisions: string[], fileChanges: string[]): ContextSummary {
    const relevantTurns = turns.slice(-this.windowSize * 3)

    const extracted = this.extractKeyInfo(relevantTurns)

    const allDecisions = [...new Set([...decisions, ...extracted.decisions])].slice(-10)
    const allFileChanges = [...new Set([...fileChanges, ...extracted.fileChanges])].slice(-15)
    const allInvariants = [...new Set(extracted.invariants)].slice(-5)
    const allOpenItems = [...new Set(extracted.openItems)].slice(-5)

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

  async compressWithLLM(planGoal: string, turns: Array<{ role: string; content: string }>, decisions: string[], fileChanges: string[]): Promise<ContextSummary> {
    if (!this.llm) return this.compress(planGoal, turns, decisions, fileChanges)

    try {
      const turnTexts = turns.map(t => `[${t.role}]: ${t.content}`)
      const llmSummary = await this.llm.summarizeContext(planGoal, turnTexts)

      const extracted = this.extractKeyInfo(turns)

      return {
        planSummary: `Goal: ${planGoal.slice(0, 200)}\n\nLLM Summary: ${llmSummary.slice(0, 500)}`,
        decisions: [...new Set([...decisions, ...extracted.decisions])].slice(-10),
        fileChanges: [...new Set([...fileChanges, ...extracted.fileChanges])].slice(-15),
        invariants: extracted.invariants,
        openItems: extracted.openItems,
        estimatedTokens: Math.ceil(llmSummary.length / 4),
      }
    } catch {
      return this.compress(planGoal, turns, decisions, fileChanges)
    }
  }

  shouldCompress(turnCount: number, currentTokensEstimate: number, maxTokens = 100_000): boolean {
    return turnCount > this.summaryInterval * 3 || currentTokensEstimate > maxTokens * 0.7
  }

  compressToPrompt(summary: ContextSummary): string {
    const parts: string[] = [
      "## Compressed Context",
      "",
      `**Plan:** ${summary.planSummary}`,
    ]

    if (summary.decisions.length > 0) {
      parts.push("", "### Key Decisions", ...summary.decisions.map((d, i) => `${i + 1}. ${d}`))
    }

    if (summary.fileChanges.length > 0) {
      parts.push("", "### Files Modified", ...summary.fileChanges.map(f => `- \`${f}\``))
    }

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

      const decisionMatches = content.match(/(?:\bdecided\b|\bchose\b|\bopted\b|\bwill use\b|\busing\b|\bselected\b|\bpicked\b) (.+?)(?:\.|$)/gi)
      if (decisionMatches) {
        decisions.push(...decisionMatches.map(d => d.trim()).slice(0, 3))
      }

      const fileMatches: string[] = []
      const prefixedMatches = content.match(/(?:src|lib|test|app|pkg|cmd)\/[\w/.-]+/gi)
      if (prefixedMatches) fileMatches.push(...prefixedMatches)
      const rootFileMatches = content.match(/(?<=["'`\s])([\w-]+\.(?:ts|js|tsx|jsx|json|py|go|rs|md|yaml|yml|toml))/gi)
      if (rootFileMatches) fileMatches.push(...rootFileMatches)
      if (fileMatches) {
        fileChanges.push(...fileMatches)
      }

      if (content.includes("must not") || content.includes("should never") || content.includes("invariant") || content.includes("must preserve")) {
        const lines = content.split("\n").filter(l =>
          l.includes("must not") || l.includes("should never") || l.includes("invariant") || l.includes("must preserve")
        )
        invariants.push(...lines.map(l => l.trim()).slice(0, 3))
      }

      if (content.includes("TODO") || content.includes("FIXME") || content.includes("remaining") || content.includes("still need") || content.includes("pending")) {
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
