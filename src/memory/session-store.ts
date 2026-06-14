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
}

export interface ExecutorSnapshot {
  completedSteps: string[]
  stepStates: Map<string, { id: string; success: boolean }>
}

export class SessionStore {
  private sessions = new Map<string, SessionState>()
  private executorSnapshots = new Map<string, ExecutorSnapshot>()

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
  }
}
