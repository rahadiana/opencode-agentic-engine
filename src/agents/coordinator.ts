import { RoleRegistry, type AgentDef, type CustomAgentDef } from "./role-registry.js"
import type { SkillStore } from "../memory/skill-store.js"

export type AgentRole = "architect" | "developer" | "qa" | "coordinator" | "pm"

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

export class AgentCoordinator {
  private sharedMemory = new Map<string, SharedMemoryEntry>()
  private memoryListeners: SharedMemoryListener[] = []
  private messages = new Map<string, AgentMessage[]>()
  private registry: RoleRegistry
  private tasks = new Map<string, AgentTask[]>()
  private pipelineRuns = new Map<string, string[]>()
  private maxDepth = 3
  private skillStore?: SkillStore

  constructor(skillStore?: SkillStore) {
    this.registry = new RoleRegistry()
    this.skillStore = skillStore
  }

  /** Set max delegation depth (from config hot-reload) */
  setMaxDepth(depth: number): void {
    this.maxDepth = depth
  }

  /** Get current max delegation depth */
  getMaxDepth(): number {
    return this.maxDepth
  }

  onSharedMemoryWrite(listener: SharedMemoryListener): void {
    this.memoryListeners.push(listener)
  }

  writeSharedMemory(key: string, value: string, agentRole: string): SharedMemoryEntry {
    const entry: SharedMemoryEntry = { key, value, writtenBy: agentRole, timestamp: Date.now() }
    this.sharedMemory.set(key, entry)
    for (const listener of this.memoryListeners) {
      try { listener(entry) } catch { }
    }
    return entry
  }

  writeSharedMemoryBatch(entries: Array<{ key: string; value: string; agentRole: string }>): void {
    for (const e of entries) {
      this.writeSharedMemory(e.key, e.value, e.agentRole)
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

  // --- Message Bus ---

  sendMessage(msg: Omit<AgentMessage, "id" | "timestamp" | "read">): AgentMessage {
    const message: AgentMessage = {
      ...msg,
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      read: false,
    }
    const inbox = this.messages.get(msg.to) ?? []
    inbox.push(message)
    this.messages.set(msg.to, inbox)
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

  // --- Task Management ---

  delegate(role: string, task: AgentTask, sessionId: string, parentDepth = 0, relevantSkills?: Array<{ name: string; successRate: number; steps: string }>): AgentTask {
    task.assignedTo = role
    task.status = "pending"
    task.delegationDepth = parentDepth + 1

    if (!relevantSkills && this.skillStore) {
      const foundSkills = this.skillStore.find(task.description).slice(0, 3)
      relevantSkills = foundSkills.map((s: any) => ({
        name: s.name,
        successRate: s.successRate,
        steps: s.steps.map((step: any) => step.description).join(" → ")
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
      task.sharedContext = contextParts.join("\n\n")
    }

    const sessionTasks = this.tasks.get(sessionId) ?? []
    sessionTasks.push(task)
    this.tasks.set(sessionId, sessionTasks)

    return task
  }

  getTasks(sessionId: string): AgentTask[] {
    return this.tasks.get(sessionId) ?? []
  }

  getTasksByRole(sessionId: string, role: string): AgentTask[] {
    return (this.tasks.get(sessionId) ?? []).filter(t => t.assignedTo === role)
  }

  updateTask(sessionId: string, taskId: string, status: AgentTask["status"], result?: string): boolean {
    const tasks = this.tasks.get(sessionId)
    if (!tasks) return false

    const task = tasks.find(t => t.id === taskId)
    if (!task) return false

    task.status = status
    if (result) task.result = result

    if (status === "done" && task.assignedTo) {
      this.writeSharedMemory(`task:${taskId}:result`, result ?? "completed", task.assignedTo)
    }

    return true
  }

  /** Get downstream tasks that depend on a completed task via the pipeline */
  getNextInPipeline(taskId: string, sessionId: string): AgentTask | null {
    const tasks = this.tasks.get(sessionId) ?? []
    const currentIdx = tasks.findIndex(t => t.id === taskId)
    if (currentIdx < 0 || currentIdx >= tasks.length - 1) return null

    const current = tasks[currentIdx]
    if (current.status !== "done") return null

    for (let i = currentIdx + 1; i < tasks.length; i++) {
      const next = tasks[i]
      if (next.status === "pending") return next
    }
    return null
  }

  // --- Pipeline Run Tracking ---

  setPipelineRun(sessionId: string, pipelineId: string, taskIds: string[]): void {
    this.pipelineRuns.set(sessionId, taskIds)
    this.writeSharedMemory(`pipeline:${sessionId}`, pipelineId, "coordinator")
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
      } catch { /* fall through to keyword */ }
    }

    // Keyword fallback
    const d = description.toLowerCase()
    if (d.includes("architect") || d.includes("design") || d.includes("structure") || d.includes("api contract")) return "architect"
    if (d.includes("test") || d.includes("qa") || d.includes("verify") || d.includes("validate") || d.includes("check")) return "qa"
    if (d.includes("coordinate") || d.includes("orchestrate") || d.includes("plan") || d.includes("overview")) return "coordinator"
    if (d.includes("pm") || d.includes("product") || d.includes("requirement") || d.includes("spec") || d.includes("acceptance")) return "pm"
    return "developer"
  }
}
