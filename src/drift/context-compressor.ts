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
  private maxTokensDefault: number

  constructor(maxTokens = 100_000) {
    this.maxTokensDefault = maxTokens
  }

  setLLM(llm: LLMEngine): void {
    this.llm = llm
  }

  compress(planSummary: string, turns: Array<{ role: string; content: string }>, decisions: string[], fileChanges: string[]): ContextSummary {
    const relevantTurns = turns.slice(-this.windowSize * 3)
    const extracted = this.extractKeyInfo(relevantTurns)

    const allDecisions = this.deduplicateFuzzy([...decisions, ...extracted.decisions]).slice(-10)
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
        decisions: this.deduplicateFuzzy([...decisions, ...extracted.decisions]).slice(-10),
        fileChanges: [...new Set([...fileChanges, ...extracted.fileChanges])].slice(-15),
        invariants: extracted.invariants,
        openItems: extracted.openItems,
        estimatedTokens: this.estimateTokens(llmSummary, [], []),
      }
    } catch {
      return this.compress(planGoal, turns, decisions, fileChanges)
    }
  }

  shouldCompress(turnCount: number, currentTokensEstimate: number, maxTokens?: number): boolean {
    const limit = maxTokens ?? this.maxTokensDefault
    return turnCount > this.summaryInterval * 3 || currentTokensEstimate > limit * 0.7
  }

  compressToPrompt(summary: ContextSummary, maxTokens?: number): string {
    const tokenBudget = maxTokens ?? this.maxTokensDefault
    const estTokens = summary.estimatedTokens

    const parts: string[] = [
      "## Compressed Context",
      "",
      `**Plan:** ${summary.planSummary}`,
    ]

    let remainingBudget = tokenBudget - estTokens

    const addSectionIfBudget = (items: string[], header: string, formatter: (s: string, i: number) => string): void => {
      if (items.length === 0 || remainingBudget <= 0) return
      const sectionHeader = `\n### ${header}`
      const sectionCost = Math.ceil(sectionHeader.length / 4) + 5
      if (remainingBudget < sectionCost) return
      parts.push("", `### ${header}`)
      remainingBudget -= sectionCost

      for (let i = 0; i < items.length; i++) {
        const line = formatter(items[i], i)
        const lineCost = Math.ceil(line.length / 4) + 1
        if (remainingBudget < lineCost && i > 0) break
        parts.push(line)
        remainingBudget -= lineCost
      }
    }

    addSectionIfBudget(summary.decisions, "Key Decisions", (d, i) => `${i + 1}. ${d}`)
    addSectionIfBudget(summary.fileChanges, "Files Modified", f => `- \`${f}\``)
    addSectionIfBudget(summary.invariants, "Invariants (MUST be preserved)", i => `- ${i}`)
    addSectionIfBudget(summary.openItems, "Open Items", i => `- ${i}`)

    parts.push("", "---", `*Compressed context (~${estTokens} tokens)*`)

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
    let tokens = 0
    let i = 0
    while (i < text.length) {
      const ch = text[i]
      if (/\s/.test(ch)) {
        tokens += 0.25
        i++
      } else if (/[A-Za-z0-9]/.test(ch)) {
        tokens += 0.25
        i++
        while (i < text.length && /[A-Za-z0-9]/.test(text[i])) {
          tokens += 0.1
          i++
        }
      } else {
        tokens += 0.5
        i++
      }
    }
    return Math.max(1, Math.ceil(tokens))
  }

  private levenshtein(a: string, b: string): number {
    const m = a.length; const n = b.length
    const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
    for (let i = 0; i <= m; i++) dp[i][0] = i
    for (let j = 0; j <= n; j++) dp[0][j] = j
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
      }
    }
    return dp[m][n]
  }

  private deduplicateFuzzy(items: string[], threshold = 0.85): string[] {
    const result: string[] = []
    for (const item of items) {
      let isDup = false
      for (const existing of result) {
        const maxLen = Math.max(item.length, existing.length)
        if (maxLen === 0) continue
        const dist = this.levenshtein(item.toLowerCase(), existing.toLowerCase())
        const similarity = 1 - dist / maxLen
        if (similarity >= threshold) {
          isDup = true
          break
        }
      }
      if (!isDup) result.push(item)
    }
    return result
  }
}
