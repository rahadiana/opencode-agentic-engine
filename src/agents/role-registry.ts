import type { AgentRole } from "./coordinator.js"

export interface AgentDef {
  role: AgentRole
  name: string
  prompt: string
  tools: string[]
  model?: string
}

export type CustomRole = string

export interface CustomAgentDef {
  role: CustomRole
  name: string
  prompt: string
  tools: string[]
  model?: string
}

/** Complexity level for model suggestion */
export type TaskComplexity = "simple" | "moderate" | "complex"

export type PromptSource = "auto-evolve" | "agent-self" | "manual" | "initial"

export interface PromptEntry {
  version: number
  prompt: string
  timestamp: string
  source: PromptSource
  description?: string
}

export interface PromptState {
  currentVersion: number
  history: PromptEntry[]
}

export class RoleRegistry {
  private builtIn: Map<AgentRole, AgentDef> = new Map()
  private custom: Map<CustomRole, CustomAgentDef> = new Map()
  private promptHistory: Map<string, PromptState> = new Map()
  private aliases: Map<string, string> = new Map()

  private defaultModels: Partial<Record<AgentRole, string>> = {
    analyst: "fast",
    builder: "capable",
    reviewer: "fast",
    coordinator: "capable",
    planner: "fast",
    architect: "fast",
    developer: "capable",
    qa: "fast",
    pm: "fast",
  }

  constructor(initialPrompts?: Array<{ role: string; history: PromptEntry[] }>) {
    if (initialPrompts) {
      for (const entry of initialPrompts) {
        const latest = entry.history.reduce((a, b) => a.version > b.version ? a : b)
        this.promptHistory.set(entry.role, { currentVersion: latest.version, history: entry.history })
      }
    }

    this.registerGenericRoles()
    this.registerCodeRoles()

    const allBuiltIn = [...this.builtIn.keys()]
    for (const role of allBuiltIn) {
      if (!this.promptHistory.has(role)) {
        this.addHistoryEntry(role, this.builtIn.get(role)!.prompt, "initial", "Built-in prompt")
      }
    }
  }

  private registerGenericRoles(): void {
    this.builtIn.set("analyst", {
      role: "analyst",
      name: "Analyst",
      prompt: `You are an analyst. Understand requirements and break them down into clear, actionable tasks.

## Output Format
Always structure your output as:
- **Requirements**: what needs to be done
- **Constraints**: limitations or boundaries
- **Deliverables**: what the output should look like
- **Dependencies**: what must exist first

Be concise. Focus on clarity, not assumptions.`,
      tools: ["read", "agentic_plan", "agentic_nav", "agentic_episodes"],
    })

    this.builtIn.set("builder", {
      role: "builder",
      name: "Builder",
      prompt: `You are a builder. Create artifacts based on the plan provided.

## Rules
1. Understand the requirements before starting
2. Follow the plan exactly
3. Verify your work against the acceptance criteria
4. After completing, call agentic_skill with action "extract" to save a reusable skill

Be thorough. Quality over speed.`,
      tools: ["read", "edit", "write", "bash", "glob", "grep", "agentic_skill"],
    })

    this.builtIn.set("reviewer", {
      role: "reviewer",
      name: "Reviewer",
      prompt: `You are a reviewer. Check work for completeness, correctness, and quality.

## Review Checklist
- Does the output meet all requirements?
- Are there any missing pieces?
- Is the quality acceptable?

## Output Format
For each issue:
- **Issue**: description
- **Severity**: critical | high | medium | low
- **Fix**: suggested improvement

Be honest and thorough. Report real issues, not preferences.`,
      tools: ["read", "glob", "grep", "agentic_verify", "agentic_skill"],
    })

    this.builtIn.set("coordinator", {
      role: "coordinator",
      name: "Coordinator",
      prompt: `You are a coordinator. Decompose goals into tasks, delegate to the right roles, and ensure completion.

## Workflow
1. Understand the goal fully
2. Break into ordered subtasks with clear dependencies
3. Delegate each subtask to the correct role
4. Track progress
5. Resolve blockers by re-assigning or adjusting scope
6. After all done, extract skills

Think like a lead. Prioritize, delegate, verify.`,
      tools: ["agentic_plan", "agentic_delegate", "agentic_status", "agentic_skill"],
    })

    this.builtIn.set("planner", {
      role: "planner",
      name: "Planner",
      prompt: `You are a planner. Translate goals into structured specifications.

## Output Format
For each requirement:
- **Goal**: what we want to achieve
- **Success Criteria**: how we know it's done
- **Dependencies**: what must exist first
- **Scope**: what is NOT included

Focus on the "what" and "why". Leave the "how" to builders.`,
      tools: ["agentic_plan", "agentic_nav", "agentic_delegate", "agentic_episodes", "read"],
    })

    this.aliases.set("pm", "planner")
    this.aliases.set("architect", "analyst")
  }

  private registerCodeRoles(): void {
    this.builtIn.set("architect", {
      role: "architect",
      name: "Software Architect",
      prompt: `You are a software architect. Analyze requirements and produce architecture decisions.

## Output Format
### Architecture Decisions
- **Decision**: <what was decided>
- **Rationale**: <why this decision>
- **Alternatives Considered**: <other options>

### Interface Contracts
- Interface / function signature — contract description

### Trade-offs
- trade-off description

## Examples

**Input**: "Add user authentication with JWT"
**Output**:
### Architecture Decisions
- **Decision**: Use JWT with refresh tokens
- **Rationale**: Stateless, scales horizontally
- **Alternatives Considered**: Session-based (needs Redis)

### Interface Contracts
- signToken(payload: object, expiresIn: string): string
- verifyToken(token: string): TokenPayload | null

### Trade-offs
- JWT without server revocation means tokens live until expiry

Be concise. Focus on structure, not implementation details.`,
      tools: ["read", "grep", "glob", "agentic_nav", "agentic_score", "agentic_delegate", "agentic_skill"],
    })

    this.builtIn.set("developer", {
      role: "developer",
      name: "Software Developer",
      prompt: `You are a senior developer. Implement features following existing codebase patterns.

## Rules
1. Read existing files first to understand patterns
2. Write tests for all new code
3. Follow project conventions
4. Don't break existing tests
5. After completing, extract a reusable skill

Be concise. Write clean, correct code.`,
      tools: ["read", "edit", "write", "bash", "glob", "grep", "agentic_skill"],
    })

    this.builtIn.set("qa", {
      role: "qa",
      name: "QA Engineer",
      prompt: `You are a QA engineer. Review implementations for bugs, edge cases, and security issues.

## Review Checklist
- Edge cases: empty inputs, boundary values
- Error handling: are errors caught?
- Security: injection risks, auth bypass
- Test quality: do tests verify behavior?
- Regression: do existing tests pass?

## Output Format
For each issue: [severity] title — description — fix suggestion

Be thorough. Report real issues only.`,
      tools: ["read", "glob", "grep", "bash", "agentic_verify", "agentic_skill"],
    })

    this.builtIn.set("pm", {
      role: "pm",
      name: "Product Manager",
      prompt: `You are a product manager. Translate business goals into technical specifications.

## Output Format
### Feature: name
**Business Value**: why this matters
**Acceptance Criteria**: list of criteria
**Dependencies**: what must exist first
**Scope Boundary**: what is NOT included

Focus on the "what" and "why".`,
      tools: ["agentic_plan", "agentic_nav", "agentic_delegate", "agentic_episodes", "read"],
    })
  }

  registerCustom(def: CustomAgentDef): void {
    if (!def.role || !def.role.trim()) throw new Error("Custom role must have a non-empty role name")
    if (!def.name || !def.name.trim()) throw new Error("Custom role must have a non-empty name")
    if (!def.prompt || !def.prompt.trim()) throw new Error("Custom role must have a non-empty prompt")
    this.custom.set(def.role, def)
    if (!this.promptHistory.has(def.role)) {
      this.addHistoryEntry(def.role, def.prompt, "manual", `Custom role: ${def.name}`)
    }
  }

  private addHistoryEntry(role: string, prompt: string, source: PromptSource, description?: string): void {
    const existing = this.promptHistory.get(role)
    const version = existing ? existing.currentVersion + 1 : 1
    const entry: PromptEntry = { version, prompt, timestamp: new Date().toISOString(), source, description }
    if (existing) {
      existing.history.push(entry)
      existing.currentVersion = version
    } else {
      this.promptHistory.set(role, { currentVersion: version, history: [entry] })
    }
  }

  /**
   * Update the system prompt for a built-in role with version tracking.
   * Returns true if the role was found and updated.
   */
  updatePrompt(role: string, newPrompt: string, source: PromptSource = "manual", description?: string): boolean {
    const existing = this.builtIn.get(role as AgentRole)
    if (!existing) return false
    this.builtIn.set(role as AgentRole, { ...existing, prompt: newPrompt })
    this.addHistoryEntry(role, newPrompt, source, description)
    return true
  }

  /** Get the current prompt for a role (built-in or custom) */
  getPrompt(role: string): string | undefined {
    return this.builtIn.get(role as AgentRole)?.prompt ?? this.custom.get(role)?.prompt
  }

  /** Get prompt version history for a role */
  getPromptHistory(role: string): PromptEntry[] {
    return this.promptHistory.get(role)?.history ?? []
  }

  /** Get the full prompt state for a role (current version + history) */
  getPromptState(role: string): PromptState | undefined {
    return this.promptHistory.get(role)
  }

  /** Get all prompt states (for persistence) */
  getAllPromptStates(): Array<{ role: string; history: PromptEntry[] }> {
    return [...this.promptHistory.entries()].map(([role, state]) => ({ role, history: state.history }))
  }

  /**
   * Rollback a role's prompt to a specific version.
   * Returns true if the rollback succeeded.
   */
  rollbackPrompt(role: string, version: number): boolean {
    const state = this.promptHistory.get(role)
    if (!state) return false
    const entry = state.history.find(e => e.version === version)
    if (!entry) return false

    this.trimHistory(role, 50)

    const def = this.builtIn.get(role as AgentRole)
    if (def) {
      this.builtIn.set(role as AgentRole, { ...def, prompt: entry.prompt })
    }
    const custom = this.custom.get(role)
    if (custom) {
      this.custom.set(role, { ...custom, prompt: entry.prompt })
    }
    if (!def && !custom) return false

    this.addHistoryEntry(role, entry.prompt, "manual", `Rollback to version ${version}`)
    return true
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

  suggestModel(role: string, complexity: TaskComplexity = "moderate"): string {
    // 1. Custom role? check its model
    const custom = this.custom.get(role)
    if (custom?.model) return custom.model

    // 2. Built-in role? check if user set a model
    const builtIn = this.builtIn.get(role as AgentRole)
    if (builtIn?.model) return builtIn.model

    // 3. Auto-suggest based on role + complexity
    const base = this.defaultModels[role as AgentRole] ?? "capable"
    let result = base
    if (complexity === "simple" && base === "capable") result = "fast"
    if (complexity === "complex" && base === "fast") result = "capable"
    console.debug(`[RoleRegistry] suggestModel(role=${role}, complexity=${complexity}) => ${result}`)
    return result
  }

  setModel(role: string, model: string): void {
    const def = this.builtIn.get(role as AgentRole)
    if (def) this.builtIn.set(role as AgentRole, { ...def, model })
  }

  private trimHistory(role: string, maxEntries: number): void {
    const state = this.promptHistory.get(role)
    if (state && state.history.length > maxEntries) {
      state.history = state.history.slice(-maxEntries)
    }
  }
}
