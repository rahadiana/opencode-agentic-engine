import { RoleRegistry, type AgentDef, type CustomAgentDef } from "./role-registry.js"

export type AgentRole = "architect" | "developer" | "qa" | "coordinator"

export interface AgentTask {
  id: string
  assignedTo: string
  description: string
  input: string
  status: "pending" | "running" | "done" | "failed"
  result?: string
}

export class AgentCoordinator {
  private registry: RoleRegistry
  private tasks = new Map<string, AgentTask[]>()

  constructor() {
    this.registry = new RoleRegistry()
  }

  getAgent(role: string): AgentDef | CustomAgentDef | undefined {
    return this.registry.getBuiltIn(role as AgentRole) ?? this.registry.getCustom(role)
  }

  delegate(role: string, task: AgentTask, sessionId: string): AgentTask {
    task.assignedTo = role
    task.status = "pending"

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
    return "developer"
  }
}
