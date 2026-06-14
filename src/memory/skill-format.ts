export interface SkillMeta {
  format: "agentic-skill/v1"
  id: string
  name: string
  version: number
  author: "agent" | "human"
  agentRole?: string
}

export interface SkillDefinition {
  meta: SkillMeta
  trigger: {
    pattern: string
    keywords: string[]
    context: string[]
  }
  workflow: {
    steps: SkillStep[]
    estimatedDuration: string
    parallelizable: boolean
  }
  quality: {
    successRate: number
    usageCount: number
    failureScenarios: string[]
  }
  audit: {
    createdAt: string
    lastUsed: string
    lastModified: string
    modifiedBy: string
  }
}

export interface SkillStep {
  order: number
  action: string
  description: string
  tool?: string
  expectedOutput: string
  rollback?: string
}

export function createSkillDefinition(
  name: string,
  triggerPattern: string,
  keywords: string[],
  steps: { action: string; description: string; tool?: string; expectedOutput: string }[],
): SkillDefinition {
  const now = new Date().toISOString()
  return {
    meta: {
      format: "agentic-skill/v1",
      id: `skill-${Date.now()}`,
      name,
      version: 1,
      author: "agent",
    },
    trigger: {
      pattern: triggerPattern,
      keywords: keywords.slice(0, 10),
      context: [],
    },
    workflow: {
      steps: steps.map((s, i) => ({
        order: i + 1,
        action: s.action,
        description: s.description,
        tool: s.tool,
        expectedOutput: s.expectedOutput,
        rollback: undefined,
      })),
      estimatedDuration: `${steps.length * 2}m`,
      parallelizable: steps.some(s => s.tool === "agentic_parallel"),
    },
    quality: {
      successRate: 1.0,
      usageCount: 1,
      failureScenarios: [],
    },
    audit: {
      createdAt: now,
      lastUsed: now,
      lastModified: now,
      modifiedBy: "system",
    },
  }
}

export function serializeSkill(skill: SkillDefinition): string {
  return JSON.stringify(skill, null, 2)
}

export function deserializeSkill(json: string): SkillDefinition | null {
  try {
    const parsed = JSON.parse(json)
    if (parsed?.meta?.format?.startsWith("agentic-skill/")) return parsed as SkillDefinition
    return null
  } catch {
    return null
  }
}

export function inspectSkill(skill: SkillDefinition): string {
  let out = `## Skill: ${skill.meta.name}\n\n`
  out += `**Format:** ${skill.meta.format}\n`
  out += `**Version:** ${skill.meta.version}\n`
  out += `**Author:** ${skill.meta.author}\n`
  out += `**Success Rate:** ${(skill.quality.successRate * 100).toFixed(0)}%\n`
  out += `**Usage:** ${skill.quality.usageCount}\n\n`
  out += `### Trigger\n- Pattern: "${skill.trigger.pattern}"\n- Keywords: ${skill.trigger.keywords.join(", ")}\n\n`
  out += `### Workflow\n`
  for (const step of skill.workflow.steps) {
    out += `${step.order}. **${step.action}** — ${step.description}\n`
    if (step.tool) out += `   Tool: \`${step.tool}\`\n`
    out += `   Expected: ${step.expectedOutput}\n`
  }
  return out
}
