/**
 * Second Brain — Active memory subsystem.
 *
 * Implements the missing pieces from the Second Brain architecture:
 *   - Decision Log (ADR)
 *   - TODO tracking
 *   - Reflection Loop
 *   - Minimal Graph (entity-relation adjacency list)
 *   - Checklist enforcement
 *
 * All stores use StateStore for persistence (survives restart).
 * Knowledge is injected into every LLM call via the knowledge-first pipeline.
 *
 * Papers referenced:
 *   - arXiv:2606.05608 (Agentic Software Engineering — self-evaluation loop)
 *   - arXiv:2604.01707 (Memory in the LLM Era — unified memory framework)
 *   - arXiv:2603.15642 (CraniMem — hierarchical memory consolidation)
 */

import type { StateStore } from "../core/state-store.js"
import type { SessionStore } from "./session-store.js"
import type { MemoryOrchestrator } from "./memory-orchestrator.js"
import type { LLMEngine } from "../core/llm.js"
import type { AgentRuntime } from "../agents/agent-runtime.js"

// ── Types ──────────────────────────────────────────────────────────

export interface Decision {
  id: string
  title: string
  context: string       // Why this decision was made
  alternatives?: string // What other options were considered
  consequence?: string  // Expected impact
  timestamp: number
  sessionId?: string
}

export interface Todo {
  id: string
  text: string
  status: "pending" | "in_progress" | "done" | "cancelled"
  priority: "low" | "medium" | "high" | "critical"
  createdAt: number
  updatedAt: number
  sessionId?: string
  category?: string   // e.g. "backend", "security", "bug"
}

export interface Reflection {
  id: string
  timestamp: number
  summary: string
  conflicts: string[]       // Conflicting decisions found
  planUpdates: string[]     // Suggested plan changes
  newInfo: string[]         // New information discovered
  actionItems: string[]     // Follow-up tasks
  sessionId?: string
}

export interface GraphEdge {
  source: string
  target: string
  relation: string          // e.g. "depends_on", "implements", "uses", "blocks"
  weight?: number
  metadata?: Record<string, unknown>
}

export interface KnowledgeSnapshot {
  decisions: Decision[]
  todos: Todo[]
  reflections: Reflection[]
  graph: GraphEdge[]
}

// ── Constants ──────────────────────────────────────────────────────

const NS_DECISIONS = "decisions"
const NS_TODOS = "todos"
const NS_REFLECTIONS = "reflections"
const NS_GRAPH = "graph"
const MAX_TODOS = 100
const MAX_DECISIONS = 500
const MAX_REFLECTIONS = 200

// ── SecondBrain ────────────────────────────────────────────────────

export class SecondBrain {
  private stateStore: StateStore
  private sessionStore?: SessionStore
  private memoryOrchestrator?: MemoryOrchestrator
  private llmEngine?: LLMEngine
  private agentRuntime?: AgentRuntime

  constructor(
    stateStore: StateStore,
    sessionStore?: SessionStore,
    memoryOrchestrator?: MemoryOrchestrator,
    llmEngine?: LLMEngine,
    agentRuntime?: AgentRuntime,
  ) {
    this.stateStore = stateStore
    this.sessionStore = sessionStore
    this.memoryOrchestrator = memoryOrchestrator
    this.llmEngine = llmEngine
    this.agentRuntime = agentRuntime
  }

  // ── Decisions ────────────────────────────────────────────────────

  /** Record an architecture decision (ADR) */
  addDecision(decision: Omit<Decision, "id" | "timestamp">): Decision {
    const entry: Decision = {
      ...decision,
      id: `dec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
    }
    const all = this.getDecisions()
    all.push(entry)
    // Keep only latest N
    const trimmed = all.slice(-MAX_DECISIONS)
    this.stateStore.set(NS_DECISIONS as any, "global", trimmed)

    // Also store in memoryOrchestrator for cross-level search
    if (this.memoryOrchestrator) {
      this.memoryOrchestrator.store("semantic", {
        id: entry.id,
        content: `[Decision] ${entry.title}: ${entry.context}`,
        keywords: entry.title.split(/\s+/).filter(w => w.length > 3),
        importance: 0.8,
        sourceSession: entry.sessionId,
        metadata: { type: "decision", title: entry.title },
      })
    }

    return entry
  }

  /** Get all decisions */
  getDecisions(): Decision[] {
    const stored = this.stateStore.get<Decision[]>(NS_DECISIONS as any, "global")
    return stored ?? []
  }

  /** Get recent decisions, newest first */
  getRecentDecisions(limit = 10): Decision[] {
    return this.getDecisions()
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit)
  }

  // ── TODOs ────────────────────────────────────────────────────────

  /** Add a TODO item */
  addTodo(todo: Omit<Todo, "id" | "createdAt" | "updatedAt" | "status">): Todo {
    const entry: Todo = {
      ...todo,
      id: `todo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      status: "pending",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    const all = this.getTodos()
    all.push(entry)
    const trimmed = all.slice(-MAX_TODOS)
    this.stateStore.set(NS_TODOS as any, "global", trimmed)
    return entry
  }

  /** Update a TODO's status */
  updateTodoStatus(id: string, status: Todo["status"]): boolean {
    const all = this.getTodos()
    const idx = all.findIndex(t => t.id === id)
    if (idx === -1) return false
    all[idx].status = status
    all[idx].updatedAt = Date.now()
    this.stateStore.set(NS_TODOS as any, "global", all)
    return true
  }

  /** Get all TODOs */
  getTodos(): Todo[] {
    const stored = this.stateStore.get<Todo[]>(NS_TODOS as any, "global")
    return stored ?? []
  }

  /** Get pending TODOs, sorted by priority */
  getPendingTodos(limit = 10): Todo[] {
    const rank = { critical: 0, high: 1, medium: 2, low: 3 }
    return this.getTodos()
      .filter(t => t.status === "pending" || t.status === "in_progress")
      .sort((a, b) => (rank[a.priority] ?? 99) - (rank[b.priority] ?? 99))
      .slice(0, limit)
  }

  /** Get TODOs by category */
  getTodosByCategory(category: string): Todo[] {
    return this.getTodos().filter(t => t.category === category)
  }

  // ── Reflection ───────────────────────────────────────────────────

  /**
   * Run a reflection cycle:
   *   1. Gather recent decisions + TODOs + episodes
   *   2. If LLM available, analyze for conflicts and new info
   *   3. Store reflection result
   */
  async reflect(sessionId?: string): Promise<Reflection> {
    const decisions = this.getRecentDecisions(15)
    const pendingTodos = this.getPendingTodos(10)

    let conflicts: string[] = []
    let planUpdates: string[] = []
    let newInfo: string[] = []
    let actionItems: string[] = []
    let summary = ""

    if (this.llmEngine) {
      try {
        const contextParts: string[] = []
        if (decisions.length > 0) {
          contextParts.push("=== Recent Decisions ===")
          contextParts.push(decisions.map(d => `- ${d.title}: ${d.context}`).join("\n"))
        }
        if (pendingTodos.length > 0) {
          contextParts.push("=== Pending TODOs ===")
          contextParts.push(pendingTodos.map(t => `- [${t.priority}] ${t.text}`).join("\n"))
        }

        if (contextParts.length > 0) {
          const resp = await this.llmEngine.call({
            systemPrompt: "You are a reflection analyst. Given recent decisions and pending TODOs, analyze:\n" +
              "1. Any conflicting decisions?\n" +
              "2. Any decisions that affect plans?\n" +
              "3. Any new information that changes priorities?\n" +
              "4. Action items based on this reflection.\n\n" +
              "Return VALID JSON only: {\"summary\":\"...\",\"conflicts\":[],\"planUpdates\":[],\"newInfo\":[],\"actionItems\":[]}",
            userPrompt: contextParts.join("\n\n"),
            jsonMode: false,
            temperature: 0.2,
            maxTokens: 1000,
          })

          // [NO_LLM] in chat mode — fallback to agentRuntime delegation
          if (resp.content.startsWith("[NO_LLM]") && this.agentRuntime) {
            const delegateResult = await this._reflectViaDelegate(decisions, pendingTodos, sessionId)
            if (delegateResult) {
              summary = delegateResult.summary
              conflicts = delegateResult.conflicts
              planUpdates = delegateResult.planUpdates
              newInfo = delegateResult.newInfo
              actionItems = delegateResult.actionItems
            }
          } else {
            try {
              const parsed = JSON.parse(resp.content)
              summary = parsed.summary ?? ""
              conflicts = parsed.conflicts ?? []
              planUpdates = parsed.planUpdates ?? []
              newInfo = parsed.newInfo ?? []
              actionItems = parsed.actionItems ?? []
            } catch {
              summary = `Reflection: ${resp.content.slice(0, 300)}`
            }
          }
        }
      } catch {
        summary = "Reflection skipped — LLM unavailable"
      }
    } else {
      summary = `Reflection: ${decisions.length} decisions, ${pendingTodos.length} pending TODOs`
    }

    const reflection: Reflection = {
      id: `refl-${Date.now()}`,
      timestamp: Date.now(),
      summary: summary || "No significant findings",
      conflicts,
      planUpdates,
      newInfo,
      actionItems,
      sessionId,
    }

    // Store reflection
    const all = this.getReflections()
    all.push(reflection)
    const trimmed = all.slice(-MAX_REFLECTIONS)
    this.stateStore.set(NS_REFLECTIONS as any, "global", trimmed)

    // Auto-create TODOs for action items
    for (const item of actionItems) {
      this.addTodo({
        text: `[reflection] ${item}`,
        priority: "medium",
        category: "reflection",
        sessionId,
      })
    }

    return reflection
  }

  /**
   * Fallback reflection via agentRuntime sub-agent delegation.
   * Used in chat mode where llmEngine.call() returns [NO_LLM].
   */
  private async _reflectViaDelegate(
    decisions: Decision[],
    pendingTodos: Todo[],
    sessionId?: string,
  ): Promise<{ summary: string; conflicts: string[]; planUpdates: string[]; newInfo: string[]; actionItems: string[] } | null> {
    if (!this.agentRuntime) return null

    const contextParts: string[] = []
    if (decisions.length > 0) {
      contextParts.push("=== Recent Decisions ===")
      contextParts.push(decisions.map(d => `- ${d.title}: ${d.context}`).join("\n"))
    }
    if (pendingTodos.length > 0) {
      contextParts.push("=== Pending TODOs ===")
      contextParts.push(pendingTodos.map(t => `- [${t.priority}] ${t.text}`).join("\n"))
    }

    const systemPrompt = "You are a reflection analyst. Given recent decisions and pending TODOs, analyze:\n" +
      "1. Any conflicting decisions?\n" +
      "2. Any decisions that affect plans?\n" +
      "3. Any new information that changes priorities?\n" +
      "4. Action items based on this reflection.\n\n" +
      "Return VALID JSON only: {\"summary\":\"...\",\"conflicts\":[],\"planUpdates\":[],\"newInfo\":[],\"actionItems\":[]}"

    try {
      const result = await this.agentRuntime.execute({
        systemPrompt,
        sessionId: sessionId ?? "reflect",
        role: "coordinator",
        taskDescription: contextParts.join("\n\n"),
      })

      if (!result.success || !result.output) return null

      try {
        const parsed = JSON.parse(result.output)
        return {
          summary: parsed.summary ?? "",
          conflicts: parsed.conflicts ?? [],
          planUpdates: parsed.planUpdates ?? [],
          newInfo: parsed.newInfo ?? [],
          actionItems: parsed.actionItems ?? [],
        }
      } catch {
        return {
          summary: `Delegated reflection: ${result.output.slice(0, 300)}`,
          conflicts: [],
          planUpdates: [],
          newInfo: [],
          actionItems: [],
        }
      }
    } catch {
      return null
    }
  }

  /** Get all reflections */
  getReflections(): Reflection[] {
    const stored = this.stateStore.get<Reflection[]>(NS_REFLECTIONS as any, "global")
    return stored ?? []
  }

  /** Get latest reflection */
  getLatestReflection(): Reflection | null {
    const all = this.getReflections()
    return all.length > 0 ? all[all.length - 1] : null
  }

  // ── Minimal Graph ────────────────────────────────────────────────

  /** Add a relation between two entities */
  addEdge(edge: GraphEdge): void {
    const all = this.getEdges()
    // Avoid duplicates
    const exists = all.some(e =>
      e.source === edge.source && e.target === edge.target && e.relation === edge.relation
    )
    if (!exists) {
      all.push(edge)
      this.stateStore.set(NS_GRAPH as any, "global", all)
    }
  }

  /** Get all edges */
  getEdges(): GraphEdge[] {
    const stored = this.stateStore.get<GraphEdge[]>(NS_GRAPH as any, "global")
    return stored ?? []
  }

  /** Find all relations involving an entity */
  findRelated(entity: string): GraphEdge[] {
    return this.getEdges().filter(e => e.source === entity || e.target === entity)
  }

  /** Find direct neighbors of an entity */
  findNeighbors(entity: string): string[] {
    const edges = this.findRelated(entity)
    const neighbors = new Set<string>()
    for (const e of edges) {
      if (e.source === entity) neighbors.add(e.target)
      if (e.target === entity) neighbors.add(e.source)
    }
    return [...neighbors]
  }

  // ── Knowledge Snapshot (for context injection) ───────────────────

  /** Build a compact knowledge snapshot for LLM context injection */
  buildKnowledgeSnapshot(maxDecisions = 5, maxTodos = 5): KnowledgeSnapshot {
    return {
      decisions: this.getRecentDecisions(maxDecisions),
      todos: this.getPendingTodos(maxTodos),
      reflections: this.getReflections().slice(-2),
      graph: this.getEdges().slice(-20),
    }
  }

  /** Format knowledge snapshot as a string for system prompt injection */
  formatKnowledgeSnapshot(maxDecisions = 5, maxTodos = 5): string {
    const snap = this.buildKnowledgeSnapshot(maxDecisions, maxTodos)
    const parts: string[] = []

    if (snap.decisions.length > 0) {
      parts.push("=== Architecture Decisions ===")
      parts.push(snap.decisions.map(d =>
        `- ${d.title}: ${d.context}${d.consequence ? ` (→ ${d.consequence})` : ""}`
      ).join("\n"))
    }

    if (snap.todos.length > 0) {
      parts.push("=== Pending Tasks ===")
      parts.push(snap.todos.map(t =>
        `- [${t.priority}] ${t.text}${t.category ? ` (${t.category})` : ""}`
      ).join("\n"))
    }

    if (snap.reflections.length > 0) {
      const latest = snap.reflections[snap.reflections.length - 1]
      parts.push(`=== Last Reflection ===\n${latest.summary.slice(0, 300)}`)
      if (latest.actionItems.length > 0) {
        parts.push(`Action items: ${latest.actionItems.join(", ")}`)
      }
    }

    if (snap.graph.length > 0) {
      parts.push("=== Entity Relations ===")
      parts.push(snap.graph.slice(0, 10).map(e => `${e.source} --[${e.relation}]--> ${e.target}`).join("\n"))
    }

    return parts.length > 0
      ? `\n\n<second-brain>\n${parts.join("\n\n")}\n</second-brain>`
      : ""
  }

  // ── Checklist / Memory-first Enforcement ─────────────────────────

  /**
   * Ensure memory has been loaded for the current session.
   * Call this at the start of key tools (plan, execute, auto).
   *
   * If memory hasn't been loaded recently (within `staleMs`), returns
   * a warning string that the tool should display.
   */
  ensureMemoryLoaded(sessionId: string, staleMs = 60_000): { loaded: boolean; warning?: string } {
    if (!this.sessionStore) return { loaded: true }

    const session = this.sessionStore.getOrCreate(sessionId)
    const lastLoad = (session as any)._lastMemoryLoad ?? 0
    const now = Date.now()

    if (now - lastLoad > staleMs) {
      // Auto-query: pending TODOs + recent decisions
      const todos = this.getPendingTodos(3)
      const decisions = this.getRecentDecisions(3)
      const warning: string[] = []

      if (todos.length > 0) {
        warning.push(`Pending: ${todos.map(t => t.text).join("; ")}`)
      }
      if (decisions.length > 0) {
        warning.push(`Decisions: ${decisions.map(d => d.title).join("; ")}`)
      }

      // Mark as loaded
      ;(session as any)._lastMemoryLoad = now

      return {
        loaded: false,
        warning: warning.length > 0
          ? `Memory context loaded — ${warning.join(" | ")}`
          : undefined,
      }
    }

    return { loaded: true }
  }

  // ── Event-driven Auto-save ───────────────────────────────────────

  /**
   * Handle an event from the event bus and auto-store relevant info.
   * Call this from event handlers.
   */
  handleEvent(_type: string, _payload: Record<string, unknown>, _sessionId?: string): void {
    // Event-driven memory: automatically save relevant info from events.
    // Currently reserved for future use — the event bus listener is wired
    // so handlers can be added here without changing initialization code.
    // Example events to handle:
    //   - file.written: track file→module relations in graph
    //   - step.completed: auto-save brief memo (already handled by agentic_execute)
    //   - llm.response: track model usage per task type (already handled by modelRegistry)
  }
}

// ── Factory ────────────────────────────────────────────────────────

let _instance: SecondBrain | null = null

export function getSecondBrain(): SecondBrain | null {
  return _instance
}

export function initSecondBrain(
  stateStore: StateStore,
  sessionStore?: SessionStore,
  memoryOrchestrator?: MemoryOrchestrator,
  llmEngine?: LLMEngine,
  agentRuntime?: AgentRuntime,
): SecondBrain {
  _instance = new SecondBrain(stateStore, sessionStore, memoryOrchestrator, llmEngine, agentRuntime)
  return _instance
}
