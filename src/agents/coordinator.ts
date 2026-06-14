import { RoleRegistry, type AgentDef, type CustomAgentDef } from "./role-registry.js"

export type AgentRole = "architect" | "developer" | "qa" | "coordinator" | "pm"

export interface AgentTask {
  id: string
  assignedTo: string
  description: string
  input: string
  status: "pending" | "running" | "done" | "failed"
  result?: string
  sharedContext?: string
}

export interface SharedMemoryEntry {
  key: string
  value: string
  writtenBy: string
  timestamp: number
}

export class AgentCoordinator {
  private sharedMemory = new Map<string, SharedMemoryEntry>()
  private registry: RoleRegistry
  private tasks = new Map<string, AgentTask[]>()

  constructor() {
    this.registry = new RoleRegistry()
  }

  writeSharedMemory(key: string, value: string, agentRole: string): void {
    this.sharedMemory.set(key, {
      key,
      value,
      writtenBy: agentRole,
      timestamp: Date.now(),
    })
  }

  readSharedMemory(key: string): SharedMemoryEntry | undefined {
    return this.sharedMemory.get(key)
  }

  getAllSharedMemory(): SharedMemoryEntry[] {
    return [...this.sharedMemory.values()]
  }

  getAgent(role: string): AgentDef | CustomAgentDef | undefined {
    return this.registry.getBuiltIn(role as AgentRole) ?? this.registry.getCustom(role)
  }

  delegate(role: string, task: AgentTask, sessionId: string): AgentTask {
    task.assignedTo = role
    task.status = "pending"

    const entries = this.getAllSharedMemory()
    if (entries.length > 0) {
      const context = entries
        .map(e => `[${e.key}] (by ${e.writtenBy}): ${e.value}`)
        .join("\n")
      task.sharedContext = context
    }

    const sessionTasks = this.tasks.get(sessionId) ?? []
    sessionTasks.push(task)
    this.tasks.set(sessionId, sessionTasks)

    return task
  }

  registerCustomRole(def: CustomAgentDef): void {
    this.registry.registerCustom(def)
  }

  getTasks(sessionId: string): AgentTask[] {
    return this.tasks.get(sessionId) ?? []
  }

  updateTask(sessionId: string, taskId: string, status: AgentTask["status"], result?: string): boolean {
    const tasks = this.tasks.get(sessionId)
    if (!tasks) return false

    const task = tasks.find(t => t.id === taskId)
    if (!task) return false

    task.status = status
    if (result) task.result = result
    return true
  }

  getSuggestedRole(description: string): AgentRole {
    const d = description.toLowerCase()
    if (d.includes("architect") || d.includes("design") || d.includes("structure") || d.includes("api contract")) return "architect"
    if (d.includes("test") || d.includes("qa") || d.includes("verify") || d.includes("validate") || d.includes("check")) return "qa"
    if (d.includes("coordinate") || d.includes("orchestrate") || d.includes("plan") || d.includes("overview")) return "coordinator"
    if (d.includes("pm") || d.includes("product") || d.includes("requirement") || d.includes("spec") || d.includes("acceptance")) return "pm"
    return "developer"
  }
}
