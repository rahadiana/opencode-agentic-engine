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
import type { SessionStore, SessionState } from "./session-store.js"
import type { MemoryOrchestrator } from "./memory-orchestrator.js"
import type { LLMEngine } from "../core/llm.js"
import type { AgentRuntime } from "../agents/agent-runtime.js"

// ── Reflection payload schema ──────────────────────────────────────

/** EvoClaw-inspired reflection trigger types */
export type ReflectionTrigger = "gap" | "drift" | "contradiction" | "growth" | "refinement"

/** Shape expected from LLM reflection JSON output */
export interface ReflectionPayload {
  summary: string
  conflicts: string[]
  planUpdates: string[]
  newInfo: string[]
  actionItems: string[]
  /** EvoClaw-inspired trigger checklist: gap/drift/contradiction/growth/refinement (optional, backward-compat) */
  triggers?: ReflectionTrigger[]
}

/**
 * Parse and validate LLM reflection JSON. Returns null on invalid shape.
 * Ensures every field is the correct type; garbage from weak models is rejected.
 */
/** Valid trigger values for reflection trigger checklist */
const VALID_TRIGGERS: readonly string[] = ["gap", "drift", "contradiction", "growth", "refinement"]

export function parseReflectionPayload(raw: string): ReflectionPayload | null {
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null
    if (typeof parsed.summary !== "string") return null
    if (!Array.isArray(parsed.conflicts) || !parsed.conflicts.every((c: unknown) => typeof c === "string")) return null
    if (!Array.isArray(parsed.planUpdates) || !parsed.planUpdates.every((c: unknown) => typeof c === "string")) return null
    if (!Array.isArray(parsed.newInfo) || !parsed.newInfo.every((c: unknown) => typeof c === "string")) return null
    if (!Array.isArray(parsed.actionItems) || !parsed.actionItems.every((c: unknown) => typeof c === "string")) return null
    const result: ReflectionPayload = {
      summary: parsed.summary,
      conflicts: parsed.conflicts,
      planUpdates: parsed.planUpdates,
      newInfo: parsed.newInfo,
      actionItems: parsed.actionItems,
    }
    // Optional triggers (backward-compat): validate each trigger is a known value
    if (Array.isArray(parsed.triggers)) {
      const filtered = parsed.triggers.filter((t: unknown) => VALID_TRIGGERS.includes(t as string))
      if (filtered.length > 0) result.triggers = filtered
    }
    return result
  } catch {
    return null
  }
}

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
  /** EvoClaw-inspired trigger checklist */
  triggers: ReflectionTrigger[]
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
    this.stateStore.set(NS_DECISIONS, "global", trimmed)

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
    const stored = this.stateStore.get<Decision[]>(NS_DECISIONS, "global")
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
    this.stateStore.set(NS_TODOS, "global", trimmed)
    return entry
  }

  /** Update a TODO's status */
  updateTodoStatus(id: string, status: Todo["status"]): boolean {
    const all = this.getTodos()
    const idx = all.findIndex(t => t.id === id)
    if (idx === -1) return false
    all[idx].status = status
    all[idx].updatedAt = Date.now()
    this.stateStore.set(NS_TODOS, "global", all)
    return true
  }

  /** Get all TODOs */
  getTodos(): Todo[] {
    const stored = this.stateStore.get<Todo[]>(NS_TODOS, "global")
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
    let triggers: ReflectionTrigger[] = []
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
              "4. Action items based on this reflection.\n" +
              "5. Which triggers apply (EvoClaw-style): gap (missing workflow/knowledge), drift (degradation), contradiction (conflicting decisions), growth (success pattern), refinement (workflow optimization).\n\n" +
              "Return VALID JSON only: {\"summary\":\"...\",\"conflicts\":[],\"planUpdates\":[],\"newInfo\":[],\"actionItems\":[],\"triggers\":[]}",
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
              triggers = delegateResult.triggers
            }
          } else {
            const validated = parseReflectionPayload(resp.content)
            if (validated) {
              summary = validated.summary
              conflicts = validated.conflicts
              planUpdates = validated.planUpdates
              newInfo = validated.newInfo
              actionItems = validated.actionItems
              triggers = validated.triggers ?? []
            } else {
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
      triggers,
      sessionId,
    }

    // Store reflection
    const all = this.getReflections()
    all.push(reflection)
    const trimmed = all.slice(-MAX_REFLECTIONS)
    this.stateStore.set(NS_REFLECTIONS, "global", trimmed)

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
  ): Promise<{ summary: string; conflicts: string[]; planUpdates: string[]; newInfo: string[]; actionItems: string[]; triggers: ReflectionTrigger[] } | null> {
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
      "4. Action items based on this reflection.\n" +
      "5. Which triggers apply (EvoClaw-style): gap (missing workflow/knowledge), drift (degradation), contradiction (conflicting decisions), growth (success pattern), refinement (workflow optimization).\n\n" +
      "Return VALID JSON only: {\"summary\":\"...\",\"conflicts\":[],\"planUpdates\":[],\"newInfo\":[],\"actionItems\":[],\"triggers\":[]}"

    try {
      const result = await this.agentRuntime.execute({
        systemPrompt,
        sessionId: sessionId ?? "reflect",
        role: "coordinator",
        taskDescription: contextParts.join("\n\n"),
      })

      if (!result.success || !result.output) return null

      const validated = parseReflectionPayload(result.output)
      if (validated) return { ...validated, triggers: validated.triggers ?? [] }
      return {
        summary: `Delegated reflection: ${result.output.slice(0, 300)}`,
        conflicts: [],
        planUpdates: [],
        newInfo: [],
        actionItems: [],
        triggers: [],
      }
    } catch {
      return null
    }
  }

  /** Get all reflections */
  getReflections(): Reflection[] {
    const stored = this.stateStore.get<Reflection[]>(NS_REFLECTIONS, "global")
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
      this.stateStore.set(NS_GRAPH, "global", all)
    }
  }

  /** Get all edges */
  getEdges(): GraphEdge[] {
    const stored = this.stateStore.get<GraphEdge[]>(NS_GRAPH, "global")
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
      if (latest.triggers?.length > 0) {
        parts.push(`Triggers: ${latest.triggers.join(", ")}`)
      }
      if (latest.actionItems?.length > 0) {
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
    const lastLoad = (session as SessionState & { _lastMemoryLoad?: number })._lastMemoryLoad ?? 0
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
      ;(session as SessionState & { _lastMemoryLoad?: number })._lastMemoryLoad = now

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

  /** Decision-indicating keywords in step output */
  private static DECISION_KEYWORDS = [
    "decided", "decide", "memutuskan", "memilih",
    "architecture decision", "architectural change",
    "migrate to", "switch to", "refactor to",
    "chose", "selected", "opted for", "migrasi",
  ]

  /** Simple heuristic: does output contain decision-like phrasing? */
  private _looksLikeDecision(output: string): boolean {
    const lower = output.toLowerCase()
    return SecondBrain.DECISION_KEYWORDS.some(kw => lower.includes(kw))
  }

  /**
   * Handle an event from the event bus and auto-store relevant info.
   *
   * Auto-capture rules:
   *   step.completed        → track files, auto-detect decisions
   *   step.failed            → track error patterns
   *   file.written           → track file→step graph
   *   guard.check.completed  → track hallucination patterns
   *   task.completed         → track delegation results
   *   memory.skill.extracted → track skill origins
   *   llm.response           → accumulate model usage stats
   *   plan.created           → track plan goal
   *   plan.completed         → trigger reflection
   *
   * Events that are only in the taxonomy but not yet emitted are
   * handled for forward-compatibility.
   */
  handleEvent(type: string, payload: Record<string, unknown>, _sessionId?: string): void {
    try {
      const sessionId = _sessionId ?? (payload.sessionID as string | undefined)

      switch (type) {
        // ── Step lifecycle ──
        case "step.completed": {
          const stepId = payload.stepId as string
          const output = (payload.output as string) ?? ""
          const files = payload.filesModified as string[] | undefined

          // Decision auto-capture: if output mentions a decision, save ADR
          if (output && this._looksLikeDecision(output)) {
            // Extract a short title from the first sentence or decision phrase
            const firstSentence = output.split(/[.!?\n]/).find(s => s.trim().length > 20)?.trim() ?? output.slice(0, 120)
            this.addDecision({
              title: firstSentence.slice(0, 80),
              context: output.slice(0, 500),
              sessionId,
            })
          }

          // Track file modifications in graph
          if (files && files.length > 0) {
            for (const f of files) {
              this.addEdge({
                source: f,
                target: stepId,
                relation: "modified_by",
                metadata: { event: "step.completed", timestamp: Date.now() },
              })
            }
          }
          break
        }

        case "step.failed": {
          const stepId = payload.stepId as string
          const error = (payload.error as string) ?? "unknown"
          const errorCategory = (payload.errorCategory as string) ?? "unknown"
          const files = payload.filesModified as string[] | undefined

          // Track error→file relations
          if (files && files.length > 0) {
            for (const f of files) {
              this.addEdge({
                source: f,
                target: stepId,
                relation: `error:${errorCategory}`,
                metadata: { error: error.slice(0, 200), timestamp: Date.now() },
              })
            }
          }

          // Track error category
          this.addEdge({
            source: stepId,
            target: errorCategory,
            relation: "has_error",
            metadata: { error: error.slice(0, 200), timestamp: Date.now() },
          })
          break
        }

        case "step.retrying": {
          const stepId = payload.stepId as string
          const attempt = payload.attempt as number
          this.addEdge({
            source: stepId,
            target: `retry-${attempt}`,
            relation: "retried",
            metadata: { attempt, timestamp: Date.now() },
          })
          break
        }

        // ── Plan lifecycle ──
        case "plan.created": {
          const planGoal = payload.goal as string
          if (planGoal) {
            this.addDecision({
              title: `Plan: ${planGoal.slice(0, 80)}`,
              context: `${planGoal} (${payload.subtaskCount as number} subtasks)`,
              sessionId,
            })
          }
          break
        }

        case "plan.completed": {
          const passed = payload.allPassed as boolean
          const goal = payload.goal as string
          if (!passed && goal) {
            this.addTodo({
              text: `[plan] Follow up on failed plan: ${goal.slice(0, 100)}`,
              priority: "high",
              category: "plan",
              sessionId,
            })
          }
          break
        }

        // ── Pipeline lifecycle ──
        case "pipeline.stage.completed": {
          const role = payload.role as string
          const issues = payload.issues as string[] | undefined
          if (issues && issues.length > 0) {
            this.addEdge({
              source: `pipeline:${payload.runId as string}`,
              target: `${role}:stage${payload.stageIndex as number}`,
              relation: "has_issues",
              metadata: { issueCount: issues.length, timestamp: Date.now() },
            })
          }
          break
        }

        case "pipeline.completed": {
          const crossValidated = payload.crossValidationPassed as boolean
          if (!crossValidated) {
            this.addTodo({
              text: `[pipeline] Cross-validation failed for ${(payload.pipelineId as string) ?? "pipeline"}`,
              priority: "high",
              category: "pipeline",
              sessionId,
            })
          }
          break
        }

        // ── Budget ──
        case "budget.limit.exceeded": {
          this.addTodo({
            text: `[budget] ${(payload.metric as string) ?? "resource"} limit exceeded (${(payload.current as number) ?? "?"}/${(payload.limit as number) ?? "?"})`,
            priority: "high",
            category: "budget",
            sessionId,
          })
          break
        }

        case "budget.threshold.warning": {
          this.addTodo({
            text: `[budget] ${(payload.metric as string) ?? "resource"} at ${(payload.usagePercent as number)?.toFixed(0) ?? "?"}%`,
            priority: "medium",
            category: "budget",
            sessionId,
          })
          break
        }

        // ── Guard ──
        case "guard.check.completed": {
          const passed = payload.passed as boolean
          const rate = payload.hallucinationRate as number
          if (!passed && rate > 0.3) {
            this.addEdge({
              source: payload.stepId as string,
              target: "hallucination",
              relation: "guard_failed",
              metadata: { rate, timestamp: Date.now() },
            })
            this.addTodo({
              text: `[guard] Hallucination check failed (rate: ${(rate * 100).toFixed(0)}%) in step ${payload.stepId as string}`,
              priority: "medium",
              category: "quality",
              sessionId,
            })
          }
          break
        }

        // ── Task delegation ──
        case "task.delegated": {
          this.addEdge({
            source: payload.role as string,
            target: payload.taskId as string,
            relation: "assigned",
            metadata: { description: (payload.description as string)?.slice(0, 200), timestamp: Date.now() },
          })
          break
        }

        case "task.completed": {
          const success = payload.success as boolean
          this.addEdge({
            source: payload.taskId as string,
            target: payload.role as string,
            relation: success ? "completed_by" : "failed_by",
            metadata: { timestamp: Date.now() },
          })
          if (!success) {
            this.addTodo({
              text: `[task] Delegated task ${payload.taskId as string} (${payload.role as string}) failed`,
              priority: "medium",
              category: "task",
              sessionId,
            })
          }
          break
        }

        // ── LLM ──
        case "llm.response": {
          // Track model usage — accumulate cost for future reflection
          const model = payload.model as string
          const cost = payload.costUsd as number
          if (model && cost != null) {
            this.addEdge({
              source: "llm",
              target: model,
              relation: "cost",
              metadata: { costUsd: cost, timestamp: Date.now() },
            })
          }
          break
        }

        // ── File ──
        case "file.written": {
          const filePath = payload.filePath as string
          const sourceStepId = payload.sourceStepId as string | undefined
          if (filePath && sourceStepId) {
            this.addEdge({
              source: sourceStepId,
              target: filePath,
              relation: "wrote",
              metadata: { bytes: payload.bytesWritten as number, timestamp: Date.now() },
            })
          }
          break
        }

        // ── Memory ──
        case "memory.skill.extracted": {
          this.addEdge({
            source: payload.skillId as string,
            target: (payload.sourceStepId as string) ?? "unknown",
            relation: "extracted_from",
            metadata: { name: payload.name as string, timestamp: Date.now() },
          })
          break
        }

        case "memory.episode.recorded": {
          // Episodes are already stored via EpisodicStore — just track in graph
          this.addEdge({
            source: "episode",
            target: payload.episodeId as string,
            relation: "recorded",
            metadata: { outcome: payload.outcome as string, timestamp: Date.now() },
          })
          break
        }

        // ── Gap #9: Feedback ──
        case "feedback.recorded": {
          const stepId = payload.stepId as string
          const fb = payload.feedback as string
          const model = payload.model as string
          const taskType = payload.taskType as string
          const errorCat = payload.errorCategory as string | undefined

          // Negative feedback → high-priority TODO to review
          if (fb === "negative") {
            this.addTodo({
              text: `Review failed step: ${stepId} (model: ${model}, task: ${taskType}${errorCat ? `, error: ${errorCat}` : ""})`,
              priority: "high",
              category: "feedback",
              sessionId,
            })
          }

          // Track in graph regardless of feedback type
          this.addEdge({
            source: "feedback",
            target: stepId,
            relation: `user_${fb}`,
            metadata: { model, taskType, errorCategory: errorCat, timestamp: Date.now() },
          })
          break
        }

        default:
          // Unknown events are silently ignored
          break
      }
    } catch {
      // Non-fatal: don't let Second Brain errors break the event loop
      // Ponytail: single catch-all instead of per-branch try/catch
    }
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
