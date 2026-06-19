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
  score(_planGoal: string, filesChanged: string[], fileContents: Map<string, string>): DebtScore {
    const breakdown: DebtCategory[] = []
    let totalIssues = 0

    const isCodeTask = /code|implement|build|fix|refactor|test|api|function|bug/i.test(_planGoal)

    const coupling = this.analyzeCoupling(filesChanged, fileContents)
    breakdown.push(coupling)
    totalIssues += coupling.issues.length

    const size = this.analyzeSize(filesChanged, fileContents)
    breakdown.push(size)
    totalIssues += size.issues.length

    const scope = this.analyzeScope(filesChanged, isCodeTask)
    breakdown.push(scope)
    totalIssues += scope.issues.length

    const patterns = this.analyzePatterns(fileContents)
    breakdown.push(patterns)
    totalIssues += patterns.issues.length

    const avgScore = breakdown.reduce((sum, b) => sum + b.score, 0) / breakdown.length
    let overall: DebtScore["overall"] = "low"
    if (avgScore >= 8) overall = "critical"
    else if (avgScore >= 6) overall = "high"
    else if (avgScore >= 3) overall = "medium"

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
      const importCount = (content.match(/^(?:import|const\s+\w+\s*=\s*require)\s/gm) || []).length
      if (importCount > 10) {
        issues.push(`${file} has ${importCount} imports — consider splitting`)
        score += 1
      }
    }

    return { category: "coupling", score: Math.min(score, 10), issues }
  }

  private analyzeSize(_filesChanged: string[], contents: Map<string, string>): DebtCategory {
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

  private analyzeScope(filesChanged: string[], isCodeTask = true): DebtCategory {
    const issues: string[] = []
    let score = 0

    const dirs = new Set(filesChanged.map(f => f.split("/").slice(0, -1).join("/")))
    if (dirs.size > 3) {
      issues.push(`Changes span ${dirs.size} directories — broad impact`)
      score += 2
    }

    if (isCodeTask) {
      const hasTest = filesChanged.some(f => f.includes(".test.") || f.includes(".spec."))
      if (!hasTest && filesChanged.length > 0) {
        issues.push("No test files changed — add tests for new code")
        score += 2
      }
    }

    return { category: "scope", score: Math.min(score, 10), issues }
  }

  private analyzePatterns(contents: Map<string, string>): DebtCategory {
    const issues: string[] = []
    let score = 0

    for (const [file, content] of contents) {
      const lines = content.split("\n")
      const codeRegex = /:\s*any\b/
      const isComment = (line: string) => {
        const trimmed = line.trim()
        return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")
      }

      let anyMatch = false
      let todoCount = 0
      let unknownAsCount = 0
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (isComment(line)) continue
        if (!anyMatch && codeRegex.test(line)) anyMatch = true
        if (/\/\/\s*TODO/i.test(line)) todoCount++
        if (line.includes("as unknown as") && !isComment(line)) unknownAsCount++
      }

      if (anyMatch) {
        issues.push(`${file} uses 'any' type — replace with specific types`)
        score += 2
      }
      if (todoCount > 2) {
        issues.push(`${file} has ${todoCount} TODOs — address before merging`)
        score += 1
      }
      if (unknownAsCount > 0) {
        issues.push(`${file} uses 'as unknown as' cast — type-safety bypass`)
        score += 1
      }
    }

    return { category: "patterns", score: Math.min(score, 10), issues }
  }

  private generateSuggestion(overall: string, _breakdown: DebtCategory[], total: number): string {
    if (overall === "low") return "Minimal debt. Proceed confidently."
    if (overall === "medium") return `${total} issue(s) found. Address before next iteration.`
    if (overall === "high") return `${total} issue(s) found. Fix before merging — add to next sprint.`
    return `${total} issue(s) found. Critical debt — block merge until resolved.`
  }
}
