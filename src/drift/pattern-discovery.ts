import type { Episode } from "../memory/episodic-store.js"
import type { StepResult } from "../evolution/continuous-evolution.js"

export interface ErrorPattern {
  category: string
  sessionCount: number
  totalOccurrences: number
  sessionAffinity: number
  lastOccurrence: string
  suggestion: string
  sampleSessions: string[]
  confidenceInterval?: { lower: number; upper: number }
}

export interface FilePattern {
  filePath: string
  sessionCount: number
  totalChanges: number
  coChangedFiles: Array<{ filePath: string; coOccurrences: number }>
  isHotSpot: boolean
  suggestion: string
}

export interface SessionOutcomePattern {
  description: string
  outcomeStats: { total: number; success: number; partial: number; failed: number }
  matchingSessions: number
  successRate: number
  commonTags: string[]
  trend: "improving" | "degrading" | "stable"
  insight: string
}

export interface SkillEffectiveness {
  skillName: string
  successRate: number
  usageCount: number
  recentTrend: "improving" | "degrading" | "stable" | "insufficient_data"
  status: "healthy" | "needs_review" | "underperforming" | "highly_effective"
  suggestion: string
}

export interface Recommendation {
  priority: "high" | "medium" | "low"
  category: "error_prevention" | "architecture" | "testing" | "process" | "skill" | "infrastructure"
  description: string
  action: string
  affectedSessions: number
}

export interface PatternReport {
  timestamp: string
  totalSessions: number
  errorPatterns: ErrorPattern[]
  filePatterns: FilePattern[]
  sessionPatterns: SessionOutcomePattern[]
  skillEffectiveness: SkillEffectiveness[]
  recommendations: Recommendation[]
}

const TOP_N_FILES = 200

export class PatternDiscovery {
  private processedSessionIds = new Set<string>()
  private errorFixMemory = new Map<string, { suggestion: string; successCount: number }>()
  /** Cached last error patterns for real-time lookup */
  private lastErrorPatterns: ErrorPattern[] = []

  /** Get cached error patterns from last analysis */
  getErrorPatterns(): ErrorPattern[] {
    return this.lastErrorPatterns
  }

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

    for (const sid of sessionIds) {
      this.processedSessionIds.add(sid)
    }

    this.lastErrorPatterns = errorPatterns

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

    for (const ep of episodes) {
      if (ep.outcome !== "failed" && ep.outcome !== "partial") continue

      const relevantStepResults = stepResults.filter(sr => sr.sessionId === ep.sessionId && !sr.success)

      if (relevantStepResults.length > 0) {
        for (const sr of relevantStepResults) {
          const cat = sr.category ?? "unknown"
          let entry = errorByCategory.get(cat)
          if (!entry) {
            entry = { sessions: new Set(), count: 0, lastTimestamp: 0 }
            errorByCategory.set(cat, entry)
          }
          entry.sessions.add(sr.sessionId)
          entry.count++
          if (sr.timestamp > entry.lastTimestamp) entry.lastTimestamp = sr.timestamp
        }
      } else {
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

      const pValue = this.computeConfidenceInterval(data.sessions.size, totalSessions)
      const affinity = totalSessions > 0 ? data.sessions.size / totalSessions : 0

      patterns.push({
        category,
        sessionCount: data.sessions.size,
        totalOccurrences: data.count,
        sessionAffinity: affinity,
        lastOccurrence: data.lastTimestamp > 0 ? new Date(data.lastTimestamp).toISOString() : new Date().toISOString(),
        suggestion: this.suggestErrorFix(category, affinity),
        sampleSessions: [...data.sessions].slice(0, 3),
        confidenceInterval: {
          lower: Math.max(0, affinity - pValue),
          upper: Math.min(1, affinity + pValue),
        },
      })
    }

    patterns.sort((a, b) => b.sessionCount - a.sessionCount)
    return patterns
  }

  // ── File Change Pattern Analysis ──

  private analyzeFiles(
    episodes: Episode[],
    sessionIds: string[],
    hotSpotThreshold: number,
  ): FilePattern[] {
    const fileSessions = new Map<string, Set<string>>()
    const fileChanges = new Map<string, number>()
    const coChangeMatrix = new Map<string, Map<string, number>>()

    const changeFreq = new Map<string, number>()
    for (const ep of episodes) {
      const files = ep.filesChanged ?? []
      for (const f of files) {
        changeFreq.set(f, (changeFreq.get(f) ?? 0) + 1)
      }
    }
    const topFiles = new Set([...changeFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_N_FILES)
      .map(([f]) => f))

    for (const ep of episodes) {
      const files = (ep.filesChanged ?? []).filter(f => topFiles.has(f))
      if (files.length === 0) continue

      for (const file of files) {
        let sessions = fileSessions.get(file)
        if (!sessions) {
          sessions = new Set()
          fileSessions.set(file, sessions)
        }
        sessions.add(ep.sessionId)
        fileChanges.set(file, (fileChanges.get(file) ?? 0) + 1)

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
      if (sessions.size < 2) continue

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
        coChangedFiles: coChanged.slice(0, 5),
        isHotSpot: sessions.size >= hotSpotThreshold,
        suggestion: this.suggestFileAction(filePath, sessions.size, totalSessions, coChanged.length),
      })
    }

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

    if (sessionIds.length < 2) return patterns

    const highChangeSessions = episodes.filter(e =>
      (e.filesChanged?.length ?? 0) >= 5 && sessionIds.includes(e.sessionId)
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
        trend: this.computeTrendEWMA(highChangeSessions),
        insight: successRate < 0.6
          ? "Large changes tend to fail. Consider breaking into smaller, independent steps."
          : "Large changes are handled well. Keep current decomposition strategy.",
      })
    }

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
        trend: this.computeTrendEWMA(tagEpisodes),
        insight: successRate < 0.5
          ? `Tasks involving "${tag}" frequently fail. Consider adding targeted verification or pre-checks.`
          : `Tasks involving "${tag}" perform well. Consider extracting as a reusable pattern.`,
      })
    }

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
        trend: this.computeTrendEWMA(refactorSessions),
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

    const priorityOrder = { high: 0, medium: 1, low: 2 }
    recs.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])

    return recs
  }

  // ── Helpers ──

  private inferCategory(text: string): string | null {
    const lower = text.toLowerCase()
    if (/\b(import|module|require|resolve)\b/.test(lower)) return "import"
    if (/\b(type|interface|generic|typeof)\b/.test(lower)) return "type"
    if (/\b(compile|build|syntax|parse)\b/.test(lower)) return "compile"
    if (/\b(test|spec|assert|expect|mock)\b/.test(lower)) return "test"
    if (/\b(runtime|error|crash|undefined|null)\b/.test(lower)) return "runtime"
    return null
  }

  private suggestErrorFix(category: string, affinity?: number): string {
    const memKey = `${category}:${affinity ? Math.round(affinity * 10) : "default"}`
    const mem = this.errorFixMemory.get(memKey)

    const suggestion = this.buildErrorSuggestion(category)
    this.errorFixMemory.set(memKey, { suggestion, successCount: (mem?.successCount ?? 0) + 1 })

    return mem?.suggestion ?? suggestion
  }

  private buildErrorSuggestion(category: string): string {
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
      const tags = ep.tags ?? []
      for (const tag of tags) {
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

  private computeTrendEWMA(episodes: Episode[]): "improving" | "degrading" | "stable" {
    if (episodes.length < 4) return "stable"

    const sorted = [...episodes].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    const alpha = 0.3
    let ema = sorted[0].outcome === "success" ? 1 : 0

    for (let i = 1; i < sorted.length; i++) {
      const val = sorted[i].outcome === "success" ? 1 : 0
      ema = alpha * val + (1 - alpha) * ema
    }

    if (ema > 0.65) return "improving"
    if (ema < 0.35) return "degrading"
    return "stable"
  }

  private computeConfidenceInterval(sampleSize: number, populationSize: number): number {
    if (populationSize === 0) return 0
    const p = sampleSize / populationSize
    const z = 1.96
    const se = Math.sqrt((p * (1 - p)) / populationSize)
    return z * se
  }
}
