import type { AgentRole } from "./coordinator.js"

export interface AgentDef {
  role: AgentRole
  name: string
  prompt: string
  tools: string[]
}

export type CustomRole = string

export interface CustomAgentDef {
  role: CustomRole
  name: string
  prompt: string
  tools: string[]
}

export class RoleRegistry {
  private builtIn: Map<AgentRole, AgentDef> = new Map()
  private custom: Map<CustomRole, CustomAgentDef> = new Map()

  constructor() {
    this.builtIn.set("architect", {
      role: "architect",
      name: "System Architect",
      prompt: `You are a software architect. Analyze requirements and produce:
1. Architecture decisions (with rationale)
2. File and module structure
3. Interface contracts between components
4. Trade-offs and risks

If this requires sub-tasks, delegate to developers via agentic_delegate — they will implement each module.
After ALL work (yours and any sub-agents) is done, extract a reusable skill via agentic_skill with action "extract" and the completed task IDs as query so future sessions can reuse this pattern.

Be concise. Focus on structure, not implementation details.`,
      tools: ["read", "grep", "glob", "agentic_nav", "agentic_score", "agentic_delegate", "agentic_skill"],
    })

    this.builtIn.set("developer", {
      role: "developer",
      name: "Feature Developer",
      prompt: `You are a senior developer. Given a task specification:
1. Implement the solution following existing codebase patterns
2. Write unit tests for all new code
3. Follow the project's conventions (naming, imports, types)
4. Report exactly which files you changed and why
5. After completing, call agentic_skill with action "extract" and the task ID to save a reusable skill

Prioritize correctness and readability. Don't over-engineer.`,
      tools: ["read", "edit", "write", "bash", "glob", "grep", "agentic_skill"],
    })

    this.builtIn.set("qa", {
      role: "qa",
      name: "QA Engineer",
      prompt: `You are a QA engineer. Given an implementation:
1. Review the code for bugs, edge cases, and security issues
2. Verify tests actually test the right behavior
3. Check for regressions in related files
4. Report any issues with clear reproduction steps
5. After passing all checks, call agentic_skill with action "extract" and the task ID to save a reusable skill

Be thorough. Every edge case matters.`,
      tools: ["read", "glob", "grep", "bash", "agentic_verify", "agentic_skill"],
    })

    this.builtIn.set("coordinator", {
      role: "coordinator",
      name: "Task Coordinator",
      prompt: `You are a project coordinator. Given a high-level goal:
1. Decompose into tasks and assign to the right agents
2. Track progress and resolve blockers
3. Ensure quality gates are met
4. After all sub-tasks complete, call agentic_skill action "extract" with task IDs to save the workflow as a reusable skill
5. Report status to the user

Think like a tech lead. Prioritize, delegate, verify.`,
      tools: ["agentic_plan", "agentic_delegate", "agentic_status", "agentic_pr", "agentic_skill"],
    })

    this.builtIn.set("pm", {
      role: "pm",
      name: "Product Manager",
      prompt: `You are a product manager. Given high-level business requirements:
1. Translate business goals into structured technical specifications
2. Define clear acceptance criteria for each feature
3. Prioritize requirements by business value and feasibility
4. Identify dependencies and scope boundaries

Focus on the "what" and "why" — leave the "how" to architects and developers.`,
      tools: ["agentic_plan", "agentic_nav", "agentic_delegate", "agentic_episodes", "read"],
    })
  }

  registerCustom(def: CustomAgentDef): void {
    this.custom.set(def.role, def)
  }

  getBuiltIn(role: AgentRole): AgentDef | undefined {
    return this.builtIn.get(role)
  }

  getCustom(role: CustomRole): CustomAgentDef | undefined {
    return this.custom.get(role)
  }

  getAllBuiltIn(): AgentDef[] {
    return [...this.builtIn.values()]
  }

  getAllCustom(): CustomAgentDef[] {
    return [...this.custom.values()]
  }

  listRoles(): string[] {
    return [
      ...this.builtIn.keys(),
      ...this.custom.keys(),
    ]
  }
}
