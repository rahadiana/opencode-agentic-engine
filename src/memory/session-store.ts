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
}

export interface ExecutorSnapshot {
  completedSteps: string[]
  stepStates: Map<string, { id: string; success: boolean }>
}

export class SessionStore {
  private sessions = new Map<string, SessionState>()
  private executorSnapshots = new Map<string, ExecutorSnapshot>()
  /** Per-session model preferences: role → model name */
  private modelPreferences = new Map<string, Map<string, string>>()
  /** TTL in days for session expiry (0 = never expire). Config-hot-reloadable. */
  private forgetAfterDays = 30

  /** Set the TTL for session expiry — called on config hot-reload. */
  setForgetAfterDays(days: number): void {
    this.forgetAfterDays = Math.max(0, days)
  }

  /** Remove sessions that haven't been touched since TTL. */
  pruneExpired(): number {
    if (this.forgetAfterDays <= 0) return 0
    const cutoff = Date.now() - this.forgetAfterDays * 24 * 60 * 60 * 1000
    let removed = 0
    for (const [id, session] of this.sessions) {
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

  getContext(sessionId: string, maxTurns = 20): ConversationTurn[] {
    const session = this.sessions.get(sessionId)
    if (!session) return []
    return session.turns.slice(-maxTurns)
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
}
