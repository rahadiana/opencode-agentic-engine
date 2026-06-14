export interface DebtScore {
  overall: "low" | "medium" | "high" | "critical"
  breakdown: DebtCategory[]
  totalIssues: number
  suggestion: string
}

export interface DebtCategory {
  category: string
  score: number
  issues: string[]
}

export class TechDebtScorer {
  score(planGoal: string, filesChanged: string[], fileContents: Map<string, string>): DebtScore {
    const breakdown: DebtCategory[] = []
    let totalIssues = 0

    // 1. Coupling analysis
    const coupling = this.analyzeCoupling(filesChanged, fileContents)
    breakdown.push(coupling)
    totalIssues += coupling.issues.length

    // 2. File size analysis
    const size = this.analyzeSize(filesChanged, fileContents)
    breakdown.push(size)
    totalIssues += size.issues.length

    // 3. Change scope analysis
    const scope = this.analyzeScope(filesChanged)
    breakdown.push(scope)
    totalIssues += scope.issues.length

    // 4. Pattern analysis
    const patterns = this.analyzePatterns(fileContents)
    breakdown.push(patterns)
    totalIssues += patterns.issues.length

    const maxScore = Math.max(...breakdown.map(b => b.score))
    let overall: DebtScore["overall"] = "low"
    if (maxScore >= 8) overall = "critical"
    else if (maxScore >= 6) overall = "high"
    else if (maxScore >= 3) overall = "medium"

    const suggestion = this.generateSuggestion(overall, breakdown, totalIssues)

    return { overall, breakdown, totalIssues, suggestion }
  }

  private analyzeCoupling(filesChanged: string[], contents: Map<string, string>): DebtCategory {
    const issues: string[] = []
    let score = 0

    if (filesChanged.length > 5) {
      issues.push(`${filesChanged.length} files modified — high coupling risk`)
      score += 3
    }

    for (const [file, content] of contents) {
      const importCount = (content.match(/^import\s/gm) || []).length
      if (importCount > 10) {
        issues.push(`${file} has ${importCount} imports — consider splitting`)
        score += 1
      }
    }

    return { category: "coupling", score: Math.min(score, 10), issues }
  }

  private analyzeSize(filesChanged: string[], contents: Map<string, string>): DebtCategory {
    const issues: string[] = []
    let score = 0

    for (const [file, content] of contents) {
      const lines = content.split("\n").length
      if (lines > 300) {
        issues.push(`${file} is ${lines} lines — too large, consider splitting`)
        score += 2
      } else if (lines > 150) {
        issues.push(`${file} is ${lines} lines — monitor size`)
        score += 1
      }
    }

    return { category: "size", score: Math.min(score, 10), issues }
  }

  private analyzeScope(filesChanged: string[]): DebtCategory {
    const issues: string[] = []
    let score = 0

    const dirs = new Set(filesChanged.map(f => f.split("/").slice(0, -1).join("/")))
    if (dirs.size > 3) {
      issues.push(`Changes span ${dirs.size} directories — broad impact`)
      score += 2
    }

    const hasTest = filesChanged.some(f => f.includes(".test.") || f.includes(".spec."))
    if (!hasTest && filesChanged.length > 0) {
      issues.push("No test files changed — add tests for new code")
      score += 2
    }

    return { category: "scope", score: Math.min(score, 10), issues }
  }

  private analyzePatterns(contents: Map<string, string>): DebtCategory {
    const issues: string[] = []
    let score = 0

    for (const [file, content] of contents) {
      if (content.includes("any")) {
        issues.push(`${file} uses 'any' type — replace with specific types`)
        score += 2
      }
      if ((content.match(/\/\/\s*TODO/g) || []).length > 2) {
        issues.push(`${file} has multiple TODOs — address before merging`)
        score += 1
      }
      if (content.includes("as unknown as")) {
        issues.push(`${file} uses 'as unknown as' cast — type-safety bypass`)
        score += 1
      }
    }

    return { category: "patterns", score: Math.min(score, 10), issues }
  }

  private generateSuggestion(overall: string, breakdown: DebtCategory[], total: number): string {
    if (overall === "low") return "Minimal debt. Proceed confidently."
    if (overall === "medium") return `${total} issue(s) found. Address before next iteration.`
    if (overall === "high") return `${total} issue(s) found. Fix before merging — add to next sprint.`
    return `${total} issue(s) found. Critical debt — block merge until resolved.`
  }
}
