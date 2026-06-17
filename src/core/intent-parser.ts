export interface Subtask {
  id: string
  description: string
  dependsOn: string[]
  verificationCriteria: string[]
}

export interface TaskIntent {
  goal: string
  constraints: string[]
  context: {
    relevantFiles: string[]
    dependencies: string[]
  }
  subtasks: Subtask[]
}

export interface Plan {
  intent: TaskIntent
  estimatedSteps: number
  complexity: "low" | "medium" | "high"
  warnings: string[]
}

export class IntentParser {
  createPlan(intent: TaskIntent): Plan {
    const complexity = intent.subtasks.length <= 3 ? "low"
      : intent.subtasks.length <= 8 ? "medium"
      : "high"

    const warnings: string[] = []
    if (complexity === "high") {
      warnings.push("Complex task detected. Consider breaking it down further.")
    }
    if (intent.constraints.length === 0) {
      warnings.push("No constraints specified. Consider adding guardrails.")
    }

    return {
      intent,
      estimatedSteps: intent.subtasks.length,
      complexity,
      warnings,
    }
  }

  validatePlan(plan: Plan): string[] {
    const errors: string[] = []
    const ids = new Set(plan.intent.subtasks.map(s => s.id))

    for (const step of plan.intent.subtasks) {
      for (const dep of step.dependsOn) {
        if (!ids.has(dep)) {
          errors.push(`Step "${step.id}" depends on unknown step "${dep}"`)
        }
      }
    }

    // Detect circular dependencies using DFS
    const depMap = new Map(plan.intent.subtasks.map(s => [s.id, s.dependsOn]))
    const visited = new Set<string>()
    const inStack = new Set<string>()

    const hasCycle = (node: string): boolean => {
      if (inStack.has(node)) return true
      if (visited.has(node)) return false
      visited.add(node)
      inStack.add(node)
      for (const dep of depMap.get(node) ?? []) {
        if (ids.has(dep) && hasCycle(dep)) return true
      }
      inStack.delete(node)
      return false
    }

    for (const step of plan.intent.subtasks) {
      if (hasCycle(step.id)) {
        errors.push(`Circular dependency detected involving step "${step.id}"`)
        break
      }
    }

    if (plan.intent.subtasks.length === 0) {
      errors.push("Plan has no subtasks")
    }

    return errors
  }
}
