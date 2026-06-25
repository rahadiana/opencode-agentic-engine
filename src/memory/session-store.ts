export interface ConversationTurn {
  role: "user" | "assistant" | "tool"
  content: string
  timestamp: number
  metadata?: Record<string, unknown>
}

export interface SessionState {
  sessionId: string
  turns: ConversationTurn[]
  plan?: import("../core/intent-parser").Plan
  artifacts: Map<string, string>
  currentTaskType?: string
  currentDomain?: string
  codeIntentMap?: import("../core/code-intent-analyzer").CodeIntentMap
}

export interface ExecutorSnapshot {
  completedSteps: string[]
  stepStates: Map<string, { id: string; success: boolean }>
}

/**
 * SessionStore — NOT thread-safe. All access must be from a single event loop.
 * Uses in-memory Maps; modifications are not locked.
 * Persistence handled externally via StateStore in index.ts startup.
 */
export class SessionStore {
  private sessions = new Map<string, SessionState>()
  private executorSnapshots = new Map<string, ExecutorSnapshot>()
  /** Per-session model preferences: role → model name */
  private modelPreferences = new Map<string, Map<string, string>>()
  /** Per-session tool model preferences: tool → model name */
  private toolModelPreferences = new Map<string, Map<string, string>>()
  /** Per-session category model preferences: category → model name */
  private categoryModelPreferences = new Map<string, Map<string, string>>()
  /** TTL in days for session expiry (0 = never expire). Config-hot-reloadable. */
  private forgetAfterDays = 30

  /** Set the TTL for session expiry — called on config hot-reload. */
  setForgetAfterDays(days: number): void {
    this.forgetAfterDays = Math.max(0, days)
  }

  /** Batch-prune expired sessions with a limit per call. */
  pruneExpiredBatched(batchSize = 50): number {
    if (this.forgetAfterDays <= 0) return 0
    const cutoff = Date.now() - this.forgetAfterDays * 24 * 60 * 60 * 1000
    let removed = 0
    for (const [id, session] of this.sessions) {
      if (removed >= batchSize) break
      const lastTurn = session.turns[session.turns.length - 1]
      if (lastTurn && lastTurn.timestamp < cutoff) {
        this.removeSession(id)
        removed++
      }
    }
    return removed
  }

  getOrCreate(sessionId: string): SessionState {
    let session = this.sessions.get(sessionId)
    if (!session) {
      session = {
        sessionId,
        turns: [],
        artifacts: new Map(),
      }
      this.sessions.set(sessionId, session)
    }
    return session
  }

  updateProgress(sessionId: string, snapshot: ExecutorSnapshot): void {
    this.executorSnapshots.set(sessionId, snapshot)
  }

  addTurn(sessionId: string, turn: ConversationTurn): void {
    const session = this.getOrCreate(sessionId)
    session.turns.push(turn)
  }

  private summarizeTurns(turns: ConversationTurn[]): string {
    if (turns.length === 0) return ""
    const roles = new Set(turns.map(t => t.role))
    const lastUser = [...turns].reverse().find(t => t.role === "user")
    const lastAssistant = [...turns].reverse().find(t => t.role === "assistant" || t.role === "tool")
    let summary = `[${turns.length} turns; roles: ${[...roles].join(", ")}]`
    if (lastUser) summary += ` last user: "${lastUser.content.slice(0, 100)}${lastUser.content.length > 100 ? "..." : ""}"`
    if (lastAssistant) summary += ` last response: "${lastAssistant.content.slice(0, 100)}${lastAssistant.content.length > 100 ? "..." : ""}"`
    return summary
  }

  getContext(sessionId: string, maxTurns = 20): ConversationTurn[] {
    const session = this.sessions.get(sessionId)
    if (!session) return []
    const recent = session.turns.slice(-maxTurns)
    if (session.turns.length > maxTurns) {
      const older = session.turns.slice(0, session.turns.length - maxTurns)
      const summary: ConversationTurn = {
        role: "tool",
        content: `[Summarized ${older.length} older turns] ${this.summarizeTurns(older)}`,
        timestamp: older[0]?.timestamp ?? Date.now(),
        metadata: { summarized: true, originalCount: older.length },
      }
      return [summary, ...recent]
    }
    return recent
  }

  getContextSummary(sessionId: string): string {
    const session = this.sessions.get(sessionId)
    if (!session) return ""
    const snapshot = this.executorSnapshots.get(sessionId)

    const plan = session.plan
    const turnCount = session.turns.length
    const completedCount = snapshot?.completedSteps.length ?? 0
    const totalSteps = plan?.estimatedSteps ?? snapshot?.stepStates.size ?? 0

    let summary = `Session: ${sessionId}\n`
    summary += `Turns: ${turnCount}\n`
    summary += `Progress: ${completedCount}/${totalSteps} steps\n`

    if (plan) {
      summary += `Plan: ${plan.intent.goal}\n`
    }

    return summary
  }

  /** Get all active sessions (used by MemoryOrchestrator) */
  getActiveSessions(): SessionState[] {
    return [...this.sessions.values()]
  }

  removeSession(sessionId: string): void {
    this.sessions.delete(sessionId)
    this.executorSnapshots.delete(sessionId)
    this.modelPreferences.delete(sessionId)
  }

  // ── Session-Seeded Model Preference (Gap: per-role model selection) ──

  /** Set preferred model for a given agent role in this session. */
  setModelPreference(sessionId: string, role: string, model: string): void {
    let prefs = this.modelPreferences.get(sessionId)
    if (!prefs) {
      prefs = new Map()
      this.modelPreferences.set(sessionId, prefs)
    }
    prefs.set(role.toLowerCase(), model)
  }

  /** Get preferred model for a given agent role, or undefined. */
  getModelPreference(sessionId: string, role: string): string | undefined {
    const prefs = this.modelPreferences.get(sessionId)
    return prefs?.get(role.toLowerCase())
  }

  /** Get all model preferences for a session. Returns array of { role, model }. */
  getAllModelPreferences(sessionId: string): Array<{ role: string; model: string }> {
    const prefs = this.modelPreferences.get(sessionId)
    if (!prefs) return []
    return [...prefs.entries()].map(([role, model]) => ({ role, model }))
  }

  /** Clear model preference for a specific role, or all roles if omitted. */
  clearModelPreference(sessionId: string, role?: string): void {
    const prefs = this.modelPreferences.get(sessionId)
    if (!prefs) return
    if (role) {
      prefs.delete(role.toLowerCase())
    } else {
      this.modelPreferences.delete(sessionId)
    }
  }

  // ── Tool Model Preferences ──

  setToolPreference(sessionId: string, tool: string, model: string): void {
    let prefs = this.toolModelPreferences.get(sessionId)
    if (!prefs) {
      prefs = new Map()
      this.toolModelPreferences.set(sessionId, prefs)
    }
    prefs.set(tool.toLowerCase(), model)
  }

  getToolPreference(sessionId: string, tool: string): string | undefined {
    return this.toolModelPreferences.get(sessionId)?.get(tool.toLowerCase())
  }

  getAllToolPreferences(sessionId: string): Array<{ tool: string; model: string }> {
    const prefs = this.toolModelPreferences.get(sessionId)
    if (!prefs) return []
    return [...prefs.entries()].map(([tool, model]) => ({ tool, model }))
  }

  clearToolPreference(sessionId: string, tool?: string): void {
    const prefs = this.toolModelPreferences.get(sessionId)
    if (!prefs) return
    if (tool) {
      prefs.delete(tool.toLowerCase())
    } else {
      this.toolModelPreferences.delete(sessionId)
    }
  }

  // ── Category Model Preferences ──

  setCategoryPreference(sessionId: string, category: string, model: string): void {
    let prefs = this.categoryModelPreferences.get(sessionId)
    if (!prefs) {
      prefs = new Map()
      this.categoryModelPreferences.set(sessionId, prefs)
    }
    prefs.set(category.toLowerCase(), model)
  }

  getCategoryPreference(sessionId: string, category: string): string | undefined {
    return this.categoryModelPreferences.get(sessionId)?.get(category.toLowerCase())
  }

  getAllCategoryPreferences(sessionId: string): Array<{ category: string; model: string }> {
    const prefs = this.categoryModelPreferences.get(sessionId)
    if (!prefs) return []
    return [...prefs.entries()].map(([cat, model]) => ({ category: cat, model }))
  }

  clearCategoryPreference(sessionId: string, category?: string): void {
    const prefs = this.categoryModelPreferences.get(sessionId)
    if (!prefs) return
    if (category) {
      prefs.delete(category.toLowerCase())
    } else {
      this.categoryModelPreferences.delete(sessionId)
    }
  }
}
