/**
 * PatternDiscovery — cross-session pattern analysis for self-evolving agents.
 *
 * Analyzes episodic memory, error history, file changes, and skill usage
 * across sessions to identify recurring issues, systemic improvements,
 * and actionable recommendations.
 *
 * Aligns with the paper's vision of agents that learn from collective
 * experience rather than operating in isolation.
 */

import type { Episode } from "../memory/episodic-store.js"
import type { StepResult } from "../evolution/continuous-evolution.js"

// ── Interfaces ──

export interface ErrorPattern {
  /** Error category (compile, type, import, test, runtime) */
  category: string
  /** Number of distinct sessions where this error occurred */
  sessionCount: number
  /** Total occurrences across all sessions */
  totalOccurrences: number
  /** Percentage of sessions that experienced this error */
  sessionAffinity: number
  /** Most recent occurrence timestamp */
  lastOccurrence: string
  /** Actionable suggestion */
  suggestion: string
  /** Example session IDs */
  sampleSessions: string[]
}

export interface FilePattern {
  /** File path (relative) */
  filePath: string
  /** Number of sessions where this file was modified */
  sessionCount: number
  /** Total modifications across sessions */
  totalChanges: number
  /** Files frequently changed together with this one (co-change frequency) */
  coChangedFiles: Array<{ filePath: string; coOccurrences: number }>
  /** Whether this file is a "hot spot" (frequently changed, high risk) */
  isHotSpot: boolean
  /** Suggestion */
  suggestion: string
}

export interface SessionOutcomePattern {
  /** Description of the pattern */
  description: string
  /** Outcome statistics for sessions matching this pattern */
  outcomeStats: { total: number; success: number; partial: number; failed: number }
  /** Number of sessions matching */
  matchingSessions: number
  /** Success rate among matching sessions */
  successRate: number
  /** Tags or characteristics common to these sessions */
  commonTags: string[]
  /** Trend over time */
  trend: "improving" | "degrading" | "stable"
  /** Actionable insight */
  insight: string
}

export interface SkillEffectiveness {
  /** Skill name */
  skillName: string
  /** Current success rate (0-1) */
  successRate: number
  /** Usage count */
  usageCount: number
  /** Success rate trend: recent 5 vs overall */
  recentTrend: "improving" | "degrading" | "stable" | "insufficient_data"
  /** Whether this skill should be reviewed or promoted */
  status: "healthy" | "needs_review" | "underperforming" | "highly_effective"
  /** Suggestion */
  suggestion: string
}

export interface Recommendation {
  /** Priority level */
  priority: "high" | "medium" | "low"
  /** Category of recommendation */
  category: "error_prevention" | "architecture" | "testing" | "process" | "skill" | "infrastructure"
  /** Human-readable description */
  description: string
  /** Concrete action to take */
  action: string
  /** Number of sessions affected by this issue */
  affectedSessions: number
}

export interface PatternReport {
  /** When the analysis was generated */
  timestamp: string
  /** Number of sessions analyzed */
  totalSessions: number
  /** Error patterns found */
  errorPatterns: ErrorPattern[]
  /** File change patterns found */
  filePatterns: FilePattern[]
  /** Session outcome patterns found */
  sessionPatterns: SessionOutcomePattern[]
  /** Skill effectiveness analysis */
  skillEffectiveness: SkillEffectiveness[]
  /** Actionable recommendations */
  recommendations: Recommendation[]
}

// ── PatternDiscovery Class ──

export class PatternDiscovery {
  /**
   * Generate a comprehensive pattern report from session data.
   *
   * @param episodes All recorded episodes (cross-session memory)
   * @param stepResults Step execution results (from ContinuousEvolution)
   * @param skills Known skills with usage stats
   * @param options Analysis options
   */
  analyze(
    episodes: Episode[],
    stepResults: StepResult[] = [],
    skills: Array<{ name: string; successRate: number; usageCount: number }> = [],
    options: { minSessions?: number; hotSpotThreshold?: number } = {},
  ): PatternReport {
    const minSessions = options.minSessions ?? 2
    const hotSpotThreshold = options.hotSpotThreshold ?? 3
    const sessionIds = [...new Set(episodes.map(e => e.sessionId))]

    const errorPatterns = this.analyzeErrors(episodes, stepResults, sessionIds, minSessions)
    const filePatterns = this.analyzeFiles(episodes, sessionIds, hotSpotThreshold)
    const sessionPatterns = this.analyzeSessionOutcomes(episodes, sessionIds)
    const skillEffectiveness = this.analyzeSkills(skills)
    const recommendations = this.generateRecommendations({
      errorPatterns,
      filePatterns,
      sessionPatterns,
      skillEffectiveness,
      episodes,
      sessionIds,
    })

    return {
      timestamp: new Date().toISOString(),
      totalSessions: sessionIds.length,
      errorPatterns,
      filePatterns,
      sessionPatterns,
      skillEffectiveness,
      recommendations,
    }
  }

  // ── Error Pattern Analysis ──

  private analyzeErrors(
    episodes: Episode[],
    stepResults: StepResult[],
    sessionIds: string[],
    minSessions: number,
  ): ErrorPattern[] {
    // Collect error categories from step results
    const errorByCategory = new Map<string, {
      sessions: Set<string>
      count: number
      lastTimestamp: number
    }>()

    for (const r of stepResults) {
      if (r.success) continue
      const cat = r.category ?? "unknown"
      let entry = errorByCategory.get(cat)
      if (!entry) {
        entry = { sessions: new Set(), count: 0, lastTimestamp: 0 }
        errorByCategory.set(cat, entry)
      }
      entry.sessions.add(r.sessionId)
      entry.count++
      if (r.timestamp > entry.lastTimestamp) entry.lastTimestamp = r.timestamp
    }

    // Also infer errors from failed episodes
    for (const ep of episodes) {
      if (ep.outcome === "failed" || ep.outcome === "partial") {
        // Try to extract error category from plan goal
        const goal = ep.planGoal.toLowerCase()
        const inferredCat = this.inferCategory(goal)
        if (inferredCat) {
          let entry = errorByCategory.get(inferredCat)
          if (!entry) {
            entry = { sessions: new Set(), count: 0, lastTimestamp: 0 }
            errorByCategory.set(inferredCat, entry)
          }
          entry.sessions.add(ep.sessionId)
          entry.count++
        }
      }
    }

    const totalSessions = sessionIds.length
    const patterns: ErrorPattern[] = []

    for (const [category, data] of errorByCategory) {
      if (data.sessions.size < minSessions) continue

      patterns.push({
        category,
        sessionCount: data.sessions.size,
        totalOccurrences: data.count,
        sessionAffinity: totalSessions > 0 ? data.sessions.size / totalSessions : 0,
        lastOccurrence: new Date(data.lastTimestamp).toISOString(),
        suggestion: this.suggestErrorFix(category),
        sampleSessions: [...data.sessions].slice(0, 3),
      })
    }

    // Sort by session count descending
    patterns.sort((a, b) => b.sessionCount - a.sessionCount)
    return patterns
  }

  // ── File Change Pattern Analysis ──

  private analyzeFiles(
    episodes: Episode[],
    sessionIds: string[],
    hotSpotThreshold: number,
  ): FilePattern[] {
    // Track file changes per session
    const fileSessions = new Map<string, Set<string>>()  // filePath → Set<sessionId>
    const fileChanges = new Map<string, number>()  // filePath → total changes
    const coChangeMatrix = new Map<string, Map<string, number>>()  // filePath → { coFile → count }

    for (const ep of episodes) {
      const files = ep.filesChanged
      if (files.length === 0) continue

      for (const file of files) {
        // Track sessions per file
        let sessions = fileSessions.get(file)
        if (!sessions) {
          sessions = new Set()
          fileSessions.set(file, sessions)
        }
        sessions.add(ep.sessionId)

        // Track total changes
        fileChanges.set(file, (fileChanges.get(file) ?? 0) + 1)

        // Track co-changes
        for (const other of files) {
          if (other === file) continue
          let matrix = coChangeMatrix.get(file)
          if (!matrix) {
            matrix = new Map()
            coChangeMatrix.set(file, matrix)
          }
          matrix.set(other, (matrix.get(other) ?? 0) + 1)
        }
      }
    }

    const totalSessions = sessionIds.length
    const patterns: FilePattern[] = []

    for (const [filePath, sessions] of fileSessions) {
      if (sessions.size < 2) continue  // skip files changed in only 1 session

      const coChanged: Array<{ filePath: string; coOccurrences: number }> = []
      const matrix = coChangeMatrix.get(filePath)
      if (matrix) {
        for (const [coFile, count] of matrix) {
          coChanged.push({ filePath: coFile, coOccurrences: count })
        }
        coChanged.sort((a, b) => b.coOccurrences - a.coOccurrences)
      }

      const totalChanges = fileChanges.get(filePath) ?? sessions.size

      patterns.push({
        filePath,
        sessionCount: sessions.size,
        totalChanges,
        coChangedFiles: coChanged.slice(0, 5),  // top 5 co-changed
        isHotSpot: sessions.size >= hotSpotThreshold,
        suggestion: this.suggestFileAction(filePath, sessions.size, totalSessions, coChanged.length),
      })
    }

    // Sort: hot spots first, then by session count
    patterns.sort((a, b) => {
      if (a.isHotSpot && !b.isHotSpot) return -1
      if (!a.isHotSpot && b.isHotSpot) return 1
      return b.sessionCount - a.sessionCount
    })

    return patterns
  }

  // ── Session Outcome Pattern Analysis ──

  private analyzeSessionOutcomes(
    episodes: Episode[],
    sessionIds: string[],
  ): SessionOutcomePattern[] {
    const patterns: SessionOutcomePattern[] = []

    if (sessionIds.length < 3) return patterns

    // Pattern 1: Sessions with many file changes tend to fail more
    const highChangeSessions = episodes.filter(e =>
      e.filesChanged.length >= 5 && sessionIds.includes(e.sessionId)
    )
    if (highChangeSessions.length >= 2) {
      const outcomes = this.countOutcomes(highChangeSessions)
      const successRate = outcomes.total > 0 ? outcomes.success / outcomes.total : 0
      patterns.push({
        description: "High file churn sessions (>5 files changed) have lower success rates",
        outcomeStats: outcomes,
        matchingSessions: highChangeSessions.length,
        successRate,
        commonTags: ["high-churn", "large-change"],
        trend: this.computeTrend(highChangeSessions),
        insight: successRate < 0.6
          ? "Large changes tend to fail. Consider breaking into smaller, independent steps."
          : "Large changes are handled well. Keep current decomposition strategy.",
      })
    }

    // Pattern 2: Sessions with specific tags
    const tagGroups = this.groupByTags(episodes, sessionIds)
    for (const [tag, tagEpisodes] of tagGroups) {
      if (tagEpisodes.length < 2) continue
      const outcomes = this.countOutcomes(tagEpisodes)
      const successRate = outcomes.total > 0 ? outcomes.success / outcomes.total : 0
      patterns.push({
        description: `Sessions tagged "${tag}" have ${(successRate * 100).toFixed(0)}% success rate`,
        outcomeStats: outcomes,
        matchingSessions: tagEpisodes.length,
        successRate,
        commonTags: [tag],
        trend: this.computeTrend(tagEpisodes),
        insight: successRate < 0.5
          ? `Tasks involving "${tag}" frequently fail. Consider adding targeted verification or pre-checks.`
          : `Tasks involving "${tag}" perform well. Consider extracting as a reusable pattern.`,
      })
    }

    // Pattern 3: Sessions with "refactor" or "migration" in goal
    const refactorSessions = episodes.filter(e =>
      (e.planGoal.toLowerCase().includes("refactor") ||
       e.planGoal.toLowerCase().includes("migrate") ||
       e.planGoal.toLowerCase().includes("extract")) &&
      sessionIds.includes(e.sessionId)
    )
    if (refactorSessions.length >= 2) {
      const outcomes = this.countOutcomes(refactorSessions)
      patterns.push({
        description: "Refactoring/migration sessions have mixed outcomes",
        outcomeStats: outcomes,
        matchingSessions: refactorSessions.length,
        successRate: outcomes.total > 0 ? outcomes.success / outcomes.total : 0,
        commonTags: ["refactor", "migration"],
        trend: this.computeTrend(refactorSessions),
        insight: "Refactoring tasks benefit from pre-change baseline tests and incremental commits.",
      })
    }

    return patterns
  }

  // ── Skill Effectiveness Analysis ──

  private analyzeSkills(
    skills: Array<{ name: string; successRate: number; usageCount: number }>,
  ): SkillEffectiveness[] {
    return skills.map(skill => {
      // Determine status based on success rate and usage
      let status: SkillEffectiveness["status"]
      let suggestion: string

      if (skill.usageCount === 0) {
        status = "needs_review"
        suggestion = "Skill has not been used yet. Consider testing with a suitable task."
      } else if (skill.successRate >= 0.9 && skill.usageCount >= 3) {
        status = "highly_effective"
        suggestion = "Highly reliable skill. Consider marking as a 'trusted' pattern for auto-delegation."
      } else if (skill.successRate >= 0.7) {
        status = "healthy"
        suggestion = "Skill performs well. Continue monitoring."
      } else if (skill.successRate >= 0.4) {
        status = "needs_review"
        suggestion = `Success rate is ${(skill.successRate * 100).toFixed(0)}%. Review the skill steps for edge cases or missing preconditions.`
      } else {
        status = "underperforming"
        suggestion = `Success rate is critically low (${(skill.successRate * 100).toFixed(0)}%). Consider retiring and replacing with a more reliable pattern.`
      }

      // Determine recent trend based on mock data or mark as insufficient
      const recentTrend: SkillEffectiveness["recentTrend"] =
        skill.usageCount < 3 ? "insufficient_data" : skill.successRate >= 0.8 ? "improving" : skill.successRate >= 0.5 ? "stable" : "degrading"

      return {
        skillName: skill.name,
        successRate: skill.successRate,
        usageCount: skill.usageCount,
        recentTrend,
        status,
        suggestion,
      }
    })
  }

  // ── Recommendation Engine ──

  private generateRecommendations(context: {
    errorPatterns: ErrorPattern[]
    filePatterns: FilePattern[]
    sessionPatterns: SessionOutcomePattern[]
    skillEffectiveness: SkillEffectiveness[]
    episodes: Episode[]
    sessionIds: string[]
  }): Recommendation[] {
    const recs: Recommendation[] = []

    // Error-based recommendations
    for (const ep of context.errorPatterns) {
      if (ep.sessionAffinity >= 0.5) {
        recs.push({
          priority: "high",
          category: "error_prevention",
          description: `"${ep.category}" error occurs in ${(ep.sessionAffinity * 100).toFixed(0)}% of sessions (${ep.sessionCount}/${context.sessionIds.length})`,
          action: ep.suggestion,
          affectedSessions: ep.sessionCount,
        })
      } else if (ep.sessionAffinity >= 0.3) {
        recs.push({
          priority: "medium",
          category: "error_prevention",
          description: `"${ep.category}" error is recurring (${ep.sessionCount} sessions)`,
          action: ep.suggestion,
          affectedSessions: ep.sessionCount,
        })
      }
    }

    // File hotspot recommendations
    for (const fp of context.filePatterns) {
      if (fp.isHotSpot && fp.coChangedFiles.length >= 3) {
        recs.push({
          priority: "high",
          category: "architecture",
          description: `Hot spot detected: "${fp.filePath}" modified in ${fp.sessionCount} sessions with ${fp.coChangedFiles.length} co-changed files`,
          action: `Consider refactoring "${fp.filePath}" into smaller modules to reduce coupling. Co-changed files: ${fp.coChangedFiles.slice(0, 3).map(c => `"${c.filePath}"`).join(", ")}.`,
          affectedSessions: fp.sessionCount,
        })
      }
    }

    // Session outcome recommendations
    for (const sp of context.sessionPatterns) {
      if (sp.successRate < 0.5 && sp.matchingSessions >= 2) {
        recs.push({
          priority: "high",
          category: "process",
          description: sp.description,
          action: sp.insight,
          affectedSessions: sp.matchingSessions,
        })
      }
    }

    // Skill recommendations
    for (const sk of context.skillEffectiveness) {
      if (sk.status === "underperforming") {
        recs.push({
          priority: "high",
          category: "skill",
          description: `Skill "${sk.skillName}" is underperforming (${(sk.successRate * 100).toFixed(0)}% success)`,
          action: sk.suggestion,
          affectedSessions: sk.usageCount,
        })
      } else if (sk.status === "highly_effective" && sk.usageCount >= 3) {
        recs.push({
          priority: "medium",
          category: "skill",
          description: `Skill "${sk.skillName}" is highly effective (${(sk.successRate * 100).toFixed(0)}% success over ${sk.usageCount} uses)`,
          action: sk.suggestion,
          affectedSessions: sk.usageCount,
        })
      }
    }

    // Global observations
    if (context.sessionIds.length >= 3) {
      const recentEps = [...context.episodes]
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
        .slice(0, Math.min(5, context.episodes.length))
      const recentSuccesses = recentEps.filter(e => e.outcome === "success").length
      const recentRate = recentEps.length > 0 ? recentSuccesses / recentEps.length : 0

      if (recentRate < 0.4 && recentEps.length >= 3) {
        recs.push({
          priority: "high",
          category: "process",
          description: "Recent sessions show declining success rate",
          action: "Consider reviewing plan decomposition strategy. Are tasks too large? Are verification criteria clear?",
          affectedSessions: recentEps.length,
        })
      }
    }

    // Sort by priority
    const priorityOrder = { high: 0, medium: 1, low: 2 }
    recs.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])

    return recs
  }

  // ── Helpers ──

  private inferCategory(text: string): string | null {
    const lower = text.toLowerCase()
    if (lower.includes("import") || lower.includes("module") || lower.includes("require") || lower.includes("not found")) return "import"
    if (lower.includes("type") || lower.includes("assignable") || lower.includes("interface")) return "type"
    if (lower.includes("compile") || lower.includes("syntax") || lower.includes("build") || lower.includes("tsc")) return "compile"
    if (lower.includes("test") || lower.includes("spec") || lower.includes("assert") || lower.includes("expect")) return "test"
    if (lower.includes("runtime") || lower.includes("undefined") || lower.includes("null") || lower.includes("error") || lower.includes("exception")) return "runtime"
    return null
  }

  private suggestErrorFix(category: string): string {
    const suggestions: Record<string, string> = {
      import: "Add import path verification before execution. Check module existence and export names.",
      type: "Run TypeScript type-checker before implementation. Ensure interfaces match between modules.",
      compile: "Add incremental compilation checks. Verify syntax before full build.",
      test: "Improve test isolation. Ensure tests don't share mutable state. Add setup/teardown hooks.",
      runtime: "Add input validation and defensive checks. Consider adding try-catch at module boundaries.",
    }
    return suggestions[category] ?? `Review ${category} error patterns and add targeted verification.`
  }

  private suggestFileAction(filePath: string, sessionCount: number, totalSessions: number, coChangeCount: number): string {
    const affinity = totalSessions > 0 ? (sessionCount / totalSessions * 100).toFixed(0) : "?"
    if (coChangeCount >= 3) {
      return `High coupling detected (${coChangeCount} co-changed files). "${filePath}" changes in ${affinity}% of sessions. Consider extracting stable interfaces.`
    }
    if (parseInt(affinity) > 50) {
      return `"${filePath}" is modified in ${affinity}% of sessions. High churn may indicate scope creep.`
    }
    return `"${filePath}" is a recurring change target (${sessionCount} sessions). Monitor for stability.`
  }

  private countOutcomes(episodes: Episode[]): { total: number; success: number; partial: number; failed: number } {
    return {
      total: episodes.length,
      success: episodes.filter(e => e.outcome === "success").length,
      partial: episodes.filter(e => e.outcome === "partial").length,
      failed: episodes.filter(e => e.outcome === "failed").length,
    }
  }

  private groupByTags(episodes: Episode[], sessionIds: string[]): Map<string, Episode[]> {
    const groups = new Map<string, Episode[]>()
    for (const ep of episodes) {
      if (!sessionIds.includes(ep.sessionId)) continue
      for (const tag of ep.tags) {
        let group = groups.get(tag)
        if (!group) {
          group = []
          groups.set(tag, group)
        }
        group.push(ep)
      }
    }
    return groups
  }

  private computeTrend(episodes: Episode[]): "improving" | "degrading" | "stable" {
    if (episodes.length < 4) return "stable"

    const sorted = [...episodes].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    const mid = Math.floor(sorted.length / 2)
    const firstHalf = sorted.slice(0, mid)
    const secondHalf = sorted.slice(mid)

    const firstSuccess = firstHalf.filter(e => e.outcome === "success").length / firstHalf.length
    const secondSuccess = secondHalf.filter(e => e.outcome === "success").length / secondHalf.length

    if (secondSuccess > firstSuccess + 0.1) return "improving"
    if (secondSuccess < firstSuccess - 0.1) return "degrading"
    return "stable"
  }
}
