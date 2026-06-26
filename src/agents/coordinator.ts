import crypto from "node:crypto"
import { RoleRegistry, type AgentDef, type CustomAgentDef } from "./role-registry.js"
import type { SkillStore } from "../memory/skill-store.js"

export type AgentRole = "architect" | "developer" | "qa" | "coordinator" | "pm" | "analyst" | "builder" | "reviewer" | "planner"

export interface AgentTask {
  id: string
  assignedTo: string
  description: string
  input: string
  status: "pending" | "running" | "done" | "failed"
  result?: string
  sharedContext?: string
  validatedBy?: string[]
  pipelineRunId?: string
  delegationDepth?: number
  dependsOn?: string[]
}

export interface SharedMemoryEntry {
  key: string
  value: string
  writtenBy: string
  timestamp: number
}

export interface AgentMessage {
  id: string
  from: string
  to: string
  taskId: string
  type: "result" | "review_request" | "review_response" | "clarification" | "approval" | "revision"
  payload: string
  context?: Record<string, string>
  timestamp: number
  read: boolean
}

export type SharedMemoryListener = (entry: SharedMemoryEntry) => void

export interface BlackboardSection {
  name: string
  description: string
  entries: Map<string, SharedMemoryEntry>
  history: BlackboardChange[]
  subscribers: string[]
  locked: boolean
}

export interface BlackboardChange {
  key: string
  value: string
  writtenBy: string
  timestamp: number
  action: "write" | "delete" | "clear"
}

export interface BlackboardSnapshot {
  timestamp: number
  sections: Record<string, {
    entries: Array<{ key: string; value: string; writtenBy: string; timestamp: number }>
    description: string
  }>
}

export type SectionSubscriptionCallback = (section: string, entry: SharedMemoryEntry) => void

type ResolveLock = () => void

/** Status of the blackboard-driven agent cycle */
export type AgentPhase = "idle" | "planning" | "executing" | "critic"

// ── Phase Permission Table ──────────────────────────────────────────
const PHASE_PERMISSIONS: Record<string, AgentPhase[]> = {
  planner: ["planning"],
  architect: ["planning", "executing"],
  pm: ["planning"],
  executor: ["executing"],
  developer: ["executing"],
  builder: ["executing"],
  critic: ["critic"],
  qa: ["critic"],
  reviewer: ["critic"],
  coordinator: ["planning", "executing", "critic"],
}

export class AgentCoordinator {
  private sharedMemory = new Map<string, SharedMemoryEntry>()
  private memoryListeners: SharedMemoryListener[] = []
  private messages = new Map<string, AgentMessage[]>()
  private registry: RoleRegistry
  private tasks = new Map<string, AgentTask[]>()
  private pipelineRuns = new Map<string, string[]>()
  private maxDepth = 3
  private skillStore?: SkillStore
  private mutexQueue: ResolveLock[] = []
  private locked = false
  private readonly maxMessagesPerRole = 500
  private readonly maxTasksPerSession = 200
  private sections = new Map<string, BlackboardSection>()
  private sectionCallbacks = new Map<string, SectionSubscriptionCallback[]>()

  constructor(skillStore?: SkillStore) {
    this.registry = new RoleRegistry()
    this.skillStore = skillStore
    this.initDefaultSections()
  }

  private initDefaultSections(): void {
    const defaultSections: Array<{ name: string; description: string }> = [
      { name: "design", description: "Architecture design decisions and schemas" },
      { name: "decisions", description: "Key architectural and technical decisions" },
      { name: "issues", description: "Issues, blockers, and risks" },
      { name: "progress", description: "Task completion progress and status" },
      { name: "qa", description: "QA findings, test results, and review comments" },
      { name: "requirements", description: "Feature requirements and acceptance criteria" },
    ]
    for (const s of defaultSections) {
      this.sections.set(s.name, {
        name: s.name,
        description: s.description,
        entries: new Map(),
        history: [],
        subscribers: [],
        locked: false,
      })
    }
  }

  private async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true
      return
    }
    return new Promise<void>((resolve) => {
      this.mutexQueue.push(resolve)
    })
  }

  private release(): void {
    const next = this.mutexQueue.shift()
    if (next) {
      next()
    } else {
      this.locked = false
    }
  }

  /** Set max delegation depth (from config hot-reload) */
  setMaxDepth(depth: number): void {
    this.maxDepth = depth
  }

  /** Get current max delegation depth */
  getMaxDepth(): number {
    return this.maxDepth
  }

  onSharedMemoryWrite(listener: SharedMemoryListener): () => void {
    this.memoryListeners.push(listener)
    return () => {
      const idx = this.memoryListeners.indexOf(listener)
      if (idx >= 0) this.memoryListeners.splice(idx, 1)
    }
  }

  // ── Shared Memory ──────────────────────────────────────────────

  async writeSharedMemory(key: string, value: string, agentRole: string): Promise<SharedMemoryEntry> {
    await this.acquire()
    try {
      const entry: SharedMemoryEntry = { key, value, writtenBy: agentRole, timestamp: Date.now() }
      this.sharedMemory.set(key, entry)
      for (const listener of this.memoryListeners) {
        try { listener(entry) } catch (err) { console.warn(`[Coordinator] memoryListener error:`, err) }
      }
      return entry
    } finally {
      this.release()
    }
  }

  async writeSharedMemoryBatch(entries: Array<{ key: string; value: string; agentRole: string }>): Promise<void> {
    await this.acquire()
    try {
      const temp: SharedMemoryEntry[] = []
      for (const e of entries) {
        const entry: SharedMemoryEntry = { key: e.key, value: e.value, writtenBy: e.agentRole, timestamp: Date.now() }
        temp.push(entry)
      }
      // All entries built successfully — commit atomically
      for (const entry of temp) {
        this.sharedMemory.set(entry.key, entry)
      }
      for (const entry of temp) {
        for (const listener of this.memoryListeners) {
          try { listener(entry) } catch (err) { console.warn(`[Coordinator] batch memoryListener error:`, err) }
        }
      }
    } finally {
      this.release()
    }
  }

  readSharedMemory(key: string): SharedMemoryEntry | undefined {
    return this.sharedMemory.get(key)
  }

  searchSharedMemory(query: string): SharedMemoryEntry[] {
    const q = query.toLowerCase()
    return [...this.sharedMemory.values()].filter(e =>
      e.key.toLowerCase().includes(q) || e.value.toLowerCase().includes(q)
    )
  }

  getAllSharedMemory(): SharedMemoryEntry[] {
    return [...this.sharedMemory.values()]
  }

  getAgent(role: string): AgentDef | CustomAgentDef | undefined {
    return this.registry.getBuiltIn(role as AgentRole) ?? this.registry.getCustom(role)
  }

  registerCustomRole(def: CustomAgentDef): void {
    this.registry.registerCustom(def)
  }

  // ── Message Bus ────────────────────────────────────────────────

  private pruneMessages(role: string): void {
    const inbox = this.messages.get(role)
    if (inbox && inbox.length > this.maxMessagesPerRole) {
      this.messages.set(role, inbox.slice(-this.maxMessagesPerRole))
    }
  }

  sendMessage(msg: Omit<AgentMessage, "id" | "timestamp" | "read">): AgentMessage {
    const message: AgentMessage = {
      ...msg,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      read: false,
    }
    const inbox = this.messages.get(msg.to) ?? []
    inbox.push(message)
    this.messages.set(msg.to, inbox)
    this.pruneMessages(msg.to)
    return message
  }

  getMessages(agentRole: string, unreadOnly = false): AgentMessage[] {
    const inbox = this.messages.get(agentRole) ?? []
    if (unreadOnly) return inbox.filter(m => !m.read)
    return inbox
  }

  markRead(messageId: string): boolean {
    for (const [, inbox] of this.messages) {
      const msg = inbox.find(m => m.id === messageId)
      if (msg) { msg.read = true; return true }
    }
    return false
  }

  getConversation(taskId: string): AgentMessage[] {
    const all: AgentMessage[] = []
    for (const [, inbox] of this.messages) {
      all.push(...inbox.filter(m => m.taskId === taskId))
    }
    return all.sort((a, b) => a.timestamp - b.timestamp)
  }

  // ── Task Management ────────────────────────────────────────────

  delegate(role: string, task: AgentTask, sessionId: string, parentDepth = 0, relevantSkills?: Array<{ name: string; successRate: number; steps: string }>): AgentTask {
    // Clone task to avoid mutating the caller's object
    const clonedTask: AgentTask = { ...task }
    clonedTask.assignedTo = role
    clonedTask.status = "pending"
    clonedTask.delegationDepth = parentDepth + 1

    if (!relevantSkills && this.skillStore) {
      const foundSkills = this.skillStore.find(clonedTask.description).slice(0, 3)
      relevantSkills = foundSkills.map((s) => ({
        name: s.definition.meta.name,
        successRate: s.successRate,
        steps: s.definition.workflow.steps.map((step) => step.description).join(" → ")
      }))
    }

    const entries = this.getAllSharedMemory()
    const contextParts: string[] = []
    if (entries.length > 0) {
      contextParts.push(entries
        .map(e => `[${e.key}] (by ${e.writtenBy}): ${e.value}`)
        .join("\n"))
    }

    if (relevantSkills && relevantSkills.length > 0) {
      const skillsBlock = relevantSkills.slice(0, 3).map(s =>
        `- **${s.name}** (${(s.successRate * 100).toFixed(0)}% success rate)\n  Steps: ${s.steps}`
      ).join("\n\n")
      contextParts.push(`## Relevant Skills\n${skillsBlock}\n\nConsider applying these proven patterns from past successful tasks.`)
    }

    if (contextParts.length > 0) {
      clonedTask.sharedContext = contextParts.join("\n\n")
    }

    const sessionTasks = this.tasks.get(sessionId) ?? []
    sessionTasks.push(clonedTask)
    this.tasks.set(sessionId, sessionTasks)
    this.pruneTasks(sessionId)

    return clonedTask
  }

  getTasks(sessionId: string): AgentTask[] {
    return this.tasks.get(sessionId) ?? []
  }

  getTasksByRole(sessionId: string, role: string): AgentTask[] {
    return (this.tasks.get(sessionId) ?? []).filter(t => t.assignedTo === role)
  }

  async updateTask(sessionId: string, taskId: string, status: AgentTask["status"], result?: string): Promise<boolean> {
    const tasks = this.tasks.get(sessionId)
    if (!tasks) return false

    const task = tasks.find(t => t.id === taskId)
    if (!task) return false

    task.status = status
    if (result) task.result = result

    if (status === "done" && task.assignedTo) {
      await this.writeSharedMemory(`task:${taskId}:result`, result ?? "completed", task.assignedTo)
    }

    return true
  }

  private pruneTasks(sessionId: string): void {
    const tasks = this.tasks.get(sessionId)
    if (tasks && tasks.length > this.maxTasksPerSession) {
      this.tasks.set(sessionId, tasks.slice(-this.maxTasksPerSession))
    }
  }

  /** Get downstream tasks that depend on a completed task via the pipeline */
  getNextInPipeline(taskId: string, sessionId: string): AgentTask | null {
    const tasks = this.tasks.get(sessionId) ?? []
    const current = tasks.find(t => t.id === taskId)
    if (!current || current.status !== "done") return null

    // Prefer tasks with explicit dependsOn
    const nextWithDep = tasks.find(t =>
      t.status === "pending" &&
      t.dependsOn &&
      t.dependsOn.length > 0 &&
      t.dependsOn.every(depId => {
        const dep = tasks.find(d => d.id === depId)
        return dep && dep.status === "done"
      })
    )
    if (nextWithDep) return nextWithDep

    // Fallback: sequential order
    const currentIdx = tasks.findIndex(t => t.id === taskId)
    if (currentIdx < 0 || currentIdx >= tasks.length - 1) return null
    for (let i = currentIdx + 1; i < tasks.length; i++) {
      if (tasks[i].status === "pending") return tasks[i]
    }
    return null
  }

  // ── Pipeline Run Tracking ──────────────────────────────────────

  async setPipelineRun(sessionId: string, pipelineId: string, taskIds: string[]): Promise<void> {
    this.pipelineRuns.set(sessionId, taskIds)
    await this.writeSharedMemory(`pipeline:${sessionId}`, pipelineId, "coordinator")
  }

  getPipelineRun(sessionId: string): string[] | undefined {
    return this.pipelineRuns.get(sessionId)
  }

  /**
   * Suggest the best agent role for a task description.
   * Uses LLM when available (Gap #6), falls back to keyword matching.
   */
  async getSuggestedRole(description: string, llm?: { suggestRole: (desc: string) => Promise<string | null> }): Promise<AgentRole> {
    // Try LLM first when available (paper's intelligent agent assignment)
    if (llm) {
      try {
        const llmRole = await llm.suggestRole(description)
        if (llmRole && ["architect", "developer", "qa", "coordinator", "pm"].includes(llmRole)) {
          return llmRole as AgentRole
        }
      } catch {
        console.warn(`[Coordinator] LLM suggestRole failed for "${description.slice(0, 60)}", falling back to keyword matching`)
      }
    }

    // Keyword fallback
    const d = description.toLowerCase()
    if (d.includes("architect") || d.includes("design") || d.includes("structure") || d.includes("api contract")) return "architect"
    if (d.includes("test") || d.includes("qa") || d.includes("verify") || d.includes("validate") || d.includes("check")) return "qa"
    if (d.includes("coordinate") || d.includes("orchestrate") || d.includes("plan") || d.includes("overview")) return "coordinator"
    if (d.includes("pm") || d.includes("product") || d.includes("requirement") || d.includes("spec") || d.includes("acceptance")) return "pm"
    return "developer"
  }

  // ── Blackboard Section ─────────────────────────────────────────

  createSection(name: string, description: string): boolean {
    if (this.sections.has(name)) return false
    this.sections.set(name, {
      name, description, entries: new Map(), history: [], subscribers: [], locked: false,
    })
    return true
  }

  deleteSection(name: string): boolean {
    return this.sections.delete(name)
  }

  listSections(): BlackboardSection[] {
    return [...this.sections.values()]
  }

  writeToSection(section: string, key: string, value: string, agentRole: string): SharedMemoryEntry | null {
    const sec = this.sections.get(section)
    if (!sec) return null
    if (sec.locked) return null
    const entry: SharedMemoryEntry = { key, value, writtenBy: agentRole, timestamp: Date.now() }
    sec.entries.set(key, entry)
    sec.history.push({ key, value, writtenBy: agentRole, timestamp: entry.timestamp, action: "write" })
    const cbs = this.sectionCallbacks.get(section) ?? []
    for (const cb of cbs) {
      try { cb(section, entry) } catch (err) { console.warn(`[Coordinator] sectionCallback error for section "${section}":`, err) }
    }
    return entry
  }

  readFromSection(section: string, key: string): SharedMemoryEntry | undefined {
    return this.sections.get(section)?.entries.get(key)
  }

  searchSection(section: string, query: string): SharedMemoryEntry[] {
    const sec = this.sections.get(section)
    if (!sec) return []
    const q = query.toLowerCase()
    return [...sec.entries.values()].filter(e =>
      e.key.toLowerCase().includes(q) || e.value.toLowerCase().includes(q)
    )
  }

  deleteFromSection(section: string, key: string, agentRole: string): boolean {
    const sec = this.sections.get(section)
    if (!sec || sec.locked) return false
    const deleted = sec.entries.delete(key)
    if (deleted) {
      sec.history.push({ key, value: "", writtenBy: agentRole, timestamp: Date.now(), action: "delete" })
    }
    return deleted
  }

  lockSection(section: string): boolean {
    const sec = this.sections.get(section)
    if (!sec) return false
    sec.locked = true
    return true
  }

  unlockSection(section: string): boolean {
    const sec = this.sections.get(section)
    if (!sec) return false
    sec.locked = false
    return true
  }

  isSectionLocked(section: string): boolean {
    return this.sections.get(section)?.locked ?? false
  }

  subscribeToSection(section: string, callback: SectionSubscriptionCallback): boolean {
    if (!this.sections.has(section)) return false
    const cbs = this.sectionCallbacks.get(section) ?? []
    cbs.push(callback)
    this.sectionCallbacks.set(section, cbs)
    return true
  }

  unsubscribeFromSection(section: string, callback: SectionSubscriptionCallback): boolean {
    const cbs = this.sectionCallbacks.get(section)
    if (!cbs) return false
    const idx = cbs.indexOf(callback)
    if (idx < 0) return false
    cbs.splice(idx, 1)
    return true
  }

  getSectionHistory(section: string): BlackboardChange[] {
    return this.sections.get(section)?.history ?? []
  }

  clearSection(section: string, agentRole: string): boolean {
    const sec = this.sections.get(section)
    if (!sec || sec.locked) return false
    const keys = [...sec.entries.keys()]
    for (const key of keys) {
      sec.history.push({ key, value: "", writtenBy: agentRole, timestamp: Date.now(), action: "clear" })
    }
    sec.entries.clear()
    return true
  }

  getBlackboardSnapshot(): BlackboardSnapshot {
    const sections: BlackboardSnapshot["sections"] = {}
    for (const [name, sec] of this.sections) {
      sections[name] = {
        description: sec.description,
        entries: [...sec.entries.values()].map(e => ({
          key: e.key, value: e.value, writtenBy: e.writtenBy, timestamp: e.timestamp,
        })),
      }
    }
    return { timestamp: Date.now(), sections }
  }

  restoreBlackboardSnapshot(snapshot: BlackboardSnapshot): void {
    for (const [name, data] of Object.entries(snapshot.sections)) {
      let sec = this.sections.get(name)
      if (!sec) {
        sec = { name, description: data.description, entries: new Map(), history: [], subscribers: [], locked: false }
        this.sections.set(name, sec)
      }
      sec.description = data.description
      sec.entries.clear()
      for (const e of data.entries) {
        sec.entries.set(e.key, { key: e.key, value: e.value, writtenBy: e.writtenBy, timestamp: e.timestamp })
      }
    }
  }

  // ── Phase Status System ────────────────────────────────────────

  /** Maximum blackboard agent cycles before forced stop */
  private static readonly MAX_BLACKBOARD_CYCLES = 10

  /** Current phase status of the blackboard-driven cycle */
  private phaseStatus: AgentPhase = "idle"

  /** How many cycles have run in the current blackboard session */
  private cycleCount = 0

  /** Callbacks invoked on phase status change */
  private phaseListeners: Array<(phase: AgentPhase) => void> = []

  /**
   * Set the current phase status.
   * Agents can only run when their phase matches the status.
   */
  setPhaseStatus(status: AgentPhase): void {
    this.phaseStatus = status
    for (const cb of this.phaseListeners) {
      try { cb(status) } catch (err) { console.warn(`[Coordinator] phaseListener error:`, err) }
    }
  }

  /**
   * Get the current phase status.
   */
  getPhaseStatus(): AgentPhase {
    return this.phaseStatus
  }

  /**
   * Listen for phase status changes.
   * Returns an unsubscribe function.
   */
  onPhaseChange(callback: (phase: AgentPhase) => void): () => void {
    this.phaseListeners.push(callback)
    return () => {
      const idx = this.phaseListeners.indexOf(callback)
      if (idx >= 0) this.phaseListeners.splice(idx, 1)
    }
  }

  /**
   * Check if an agent role can run in the current phase.
   * Used as phase lock — prevents agents from running in wrong phase.
   */
  canAgentRunInPhase(role: string): boolean {
    if (this.phaseStatus === "idle") return false
    const allowed = PHASE_PERMISSIONS[role]
    return allowed ? allowed.includes(this.phaseStatus) : true
  }

  /**
   * Reset the cycle counter and phase status.
   */
  resetCycle(): void {
    this.cycleCount = 0
    this.phaseStatus = "idle"
  }

  // ── Cycle Runner ────────────────────────────────────────────────

  /**
   * Run one event-driven blackboard agent cycle:
   * 1. Check MAX_CYCLES guard
   * 2. Check phase lock (can agent run?)
   * 3. Execute agent action
   * 4. Notify phase listeners
   * 5. Determine next phase
   *
   * Returns the cycle result including selected agent and next phase.
   */
  runBlackboardCycle(
    eligibleRoles: string[],
    agentSelector: (roles: string[], phase: AgentPhase) => string | null,
    agentExecutor: (role: string, phase: AgentPhase) => string | null,
  ): BlackboardCycleResult {
    this.cycleCount++

    // 1. MAX_CYCLES guard
    if (this.cycleCount > AgentCoordinator.MAX_BLACKBOARD_CYCLES) {
      return {
        cycle: this.cycleCount,
        selectedRole: null,
        phase: this.phaseStatus,
        result: null,
        nextPhase: "idle",
        maxCyclesReached: true,
      }
    }

    // 2. Phase lock — filter roles that can run in current phase
    const allowed = eligibleRoles.filter(r => this.canAgentRunInPhase(r))
    if (allowed.length === 0) {
      return {
        cycle: this.cycleCount,
        selectedRole: null,
        phase: this.phaseStatus,
        result: null,
        nextPhase: "idle",
        maxCyclesReached: false,
      }
    }

    // 3. Select agent to run
    const selectedRole = agentSelector(allowed, this.phaseStatus)
    if (!selectedRole) {
      return {
        cycle: this.cycleCount,
        selectedRole: null,
        phase: this.phaseStatus,
        result: null,
        nextPhase: "idle",
        maxCyclesReached: false,
      }
    }

    // 4. Execute agent
    const result = agentExecutor(selectedRole, this.phaseStatus)

    // 5. Determine next phase (Planner → Executor → Critic → done or back to Planner)
    const nextPhase = this.computeNextPhase(result)

    // 6. Update status and notify
    if (nextPhase !== this.phaseStatus) {
      this.setPhaseStatus(nextPhase)
    }

    return {
      cycle: this.cycleCount,
      selectedRole,
      phase: this.phaseStatus,
      result,
      nextPhase,
      maxCyclesReached: false,
    }
  }

  /**
   * Run the full Planner → Executor → Critic loop automatically.
   * Uses simple selectors: first eligible in each phase.
   * Returns array of all cycle results.
   */
  runFullCritiqueLoop(
    plannerRole: string,
    executorRole: string,
    criticRole: string,
    executor: (role: string, phase: AgentPhase, input: string) => string,
  ): BlackboardCycleResult[] {
    const results: BlackboardCycleResult[] = []
    this.resetCycle()

    // Phase 1: Planning
    this.setPhaseStatus("planning")
    const planResult = this.runBlackboardCycle(
      [plannerRole],
      (roles) => roles[0],
      (role) => executor(role, "planning", ""),
    )
    results.push(planResult)
    const plan = planResult.result ?? ""

    // Phase 2: Executing
    this.setPhaseStatus("executing")
    const execResult = this.runBlackboardCycle(
      [executorRole],
      (roles) => roles[0],
      (role) => executor(role, "executing", plan),
    )
    results.push(execResult)
    const executionOutput = execResult.result ?? ""

    // Phase 3: Critic review
    this.setPhaseStatus("critic")
    const criticResult = this.runBlackboardCycle(
      [criticRole],
      (roles) => roles[0],
      (role) => executor(role, "critic", executionOutput),
    )
    results.push(criticResult)
    const critique = criticResult.result ?? ""

    // Retry loop: if critic fails, go back to planning (up to MAX cycles total)
    let retries = 0
    const maxRetries = 3
    while (this.cycleCount < AgentCoordinator.MAX_BLACKBOARD_CYCLES && retries < maxRetries) {
      const needsRetry = this.shouldRetry(critique)
      if (!needsRetry) break

      retries++
      const retryResults = this.runRetryCycle(plannerRole, executorRole, criticRole, executor, critique, retries)
      results.push(...retryResults)
    }

    // Done
    this.setPhaseStatus("idle")

    return results
  }

  /**
   * Determine the next phase based on current phase and result.
   */
  private computeNextPhase(result: string | null): AgentPhase {
    if (this.phaseStatus === "planning") return "executing"
    if (this.phaseStatus === "executing") return "critic"
    if (this.phaseStatus === "critic") {
      // If result is empty/null, planning failed — go idle
      if (!result) return "idle"
      return "idle" // critic done — default to idle (retry handled separately)
    }
    return "idle"
  }

  /**
   * Check if the critique indicates a retry is needed.
   * Retry if the critic found issues (non-empty result starting with "fail" or "retry").
   */
  private shouldRetry(critique: string): boolean {
    const lower = critique.toLowerCase().trim()
    return lower.startsWith("fail") || lower.startsWith("retry") || lower.startsWith("reject")
  }

  /**
   * Run one full retry cycle: planning → executing → critic.
   * Extracted from runFullCritiqueLoop to reduce method size.
   */
  private runRetryCycle(
    plannerRole: string,
    executorRole: string,
    criticRole: string,
    executor: (role: string, phase: AgentPhase, input: string) => string,
    critique: string,
    retryNumber: number,
  ): BlackboardCycleResult[] {
    this.setPhaseStatus("planning")
    const rePlanResult = this.runBlackboardCycle(
      [plannerRole],
      (roles) => roles[0],
      (role) => executor(role, "planning", `Retry #${retryNumber}: ${critique}`),
    )

    this.setPhaseStatus("executing")
    const reExecResult = this.runBlackboardCycle(
      [executorRole],
      (roles) => roles[0],
      (role) => executor(role, "executing", rePlanResult.result ?? ""),
    )

    this.setPhaseStatus("critic")
    const reCriticResult = this.runBlackboardCycle(
      [criticRole],
      (roles) => roles[0],
      (role) => executor(role, "critic", reExecResult.result ?? ""),
    )

    return [rePlanResult, reExecResult, reCriticResult]
  }
}

/** Result of a single blackboard agent cycle */
export interface BlackboardCycleResult {
  /** Cycle number */
  cycle: number
  /** Which agent role was selected to run (null if none eligible) */
  selectedRole: string | null
  /** Phase when this cycle ran */
  phase: AgentPhase
  /** Result of the agent execution */
  result: string | null
  /** Next phase to transition to */
  nextPhase: AgentPhase
  /** Whether MAX_CYCLES limit was reached */
  maxCyclesReached: boolean
}
