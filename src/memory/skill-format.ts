import type { DslInstruction } from "../core/dsl-executor.js"
import type { SchemaField } from "../core/skill-schema.js"

export { type DslInstruction } from "../core/dsl-executor.js"
export { type SchemaField } from "../core/skill-schema.js"

export interface SkillMeta {
  format: "agentic-skill/v1"
  id: string
  name: string
  version: number
  author: "agent" | "human"
  agentRole?: string
  /** ID of parent skill for version lineage (comp 10) */
  parentId?: string
}

export interface SkillDefinition {
  meta: SkillMeta
  trigger: {
    pattern: string
    keywords: string[]
    context: string[]
    /** Exact-match capability string for deterministic lookup (e.g. "auth.login", "db.migrate") */
    capability?: string
  }
  workflow: {
    steps: SkillStep[]
    estimatedDuration: string
    parallelizable: boolean
  }
  /** Schema for skill inputs — validated at runtime by SchemaValidator */
  input_schema?: Record<string, SchemaField>
  /** Schema for skill outputs — validated after execution by SchemaValidator */
  output_schema?: Record<string, SchemaField>
  /** Deterministic DSL logic for this skill (alternative to workflow steps) */
  logic?: {
    instructions: DslInstruction[]
    /** Optional MCP servers required by this skill's logic */
    requires_mcp?: string[]
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
  steps: { action: string; description: string; tool?: string; expectedOutput: string; rollback?: string }[],
  triggerContext?: string[],
  author?: "agent" | "human",
  extras?: {
    input_schema?: Record<string, SchemaField>
    output_schema?: Record<string, SchemaField>
    logic?: { instructions: DslInstruction[]; requires_mcp?: string[] }
    capability?: string
  },
): SkillDefinition {
  const now = new Date().toISOString()
  return {
    meta: {
      format: "agentic-skill/v1",
      id: `skill-${Date.now()}`,
      name,
      version: 1,
      author: author ?? "agent",
    },
    trigger: {
      pattern: triggerPattern,
      keywords: keywords.slice(0, 10),
      context: triggerContext ?? [],
      ...(extras?.capability ? { capability: extras.capability } : {}),
    },
    workflow: {
      steps: steps.map((s, i) => ({
        order: i + 1,
        action: s.action,
        description: s.description,
        tool: s.tool,
        expectedOutput: s.expectedOutput,
        rollback: s.rollback ?? inferRollback(s.action, s.description),
      })),
      estimatedDuration: `${steps.length * 2}m`,
      parallelizable: steps.some(s => s.tool === "agentic_parallel"),
    },
    ...(extras?.input_schema ? { input_schema: extras.input_schema } : {}),
    ...(extras?.output_schema ? { output_schema: extras.output_schema } : {}),
    ...(extras?.logic ? { logic: extras.logic } : {}),
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

function inferRollback(action: string, description: string): string | undefined {
  const lower = action.toLowerCase() + " " + description.toLowerCase()

  // Specific keywords first, then general
  if (lower.includes("add dep") || lower.includes("install")) {
    return "Remove dependency: npm uninstall <package>"
  }
  if (lower.includes("create file") || lower.includes("write file")) {
    return "Delete the created file or revert the addition"
  }
  if (lower.includes("rename") || lower.includes("move")) {
    return "Move file back to original location"
  }
  if (lower.includes("delete") || lower.includes("remove")) {
    return "Restore from git: git checkout -- <file>"
  }
  if (lower.includes("create") || lower.includes("add") || lower.includes("write")) {
    return "Delete the created file or revert the addition"
  }
  if (lower.includes("modify") || lower.includes("update") || lower.includes("edit")) {
    return "Revert changes: git checkout -- <file> or git revert <commit>"
  }
  if (lower.includes("migrate")) {
    return "Run down migration: <tool> migrate down"
  }

  return "Undo changes via git: git stash or git checkout"
}

function jsonSafeReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString() + "n"
  if (value === undefined) return null
  return value
}

export function serializeSkill(skill: SkillDefinition): string {
  return JSON.stringify(skill, jsonSafeReplacer, 2)
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

function escapeMd(text: string): string {
  return text.replace(/[_*[\]()`~>#+|!]/g, "\\$&")
}

export function inspectSkill(skill: SkillDefinition): string {
  let out = `## Skill: ${escapeMd(skill.meta.name)}\n\n`
  out += `**Format:** ${skill.meta.format}\n`
  out += `**Version:** ${skill.meta.version}\n`
  out += `**Author:** ${skill.meta.author}\n`
  out += `**Success Rate:** ${(skill.quality.successRate * 100).toFixed(0)}%\n`
  out += `**Usage:** ${skill.quality.usageCount}\n\n`
  out += `### Trigger\n- Pattern: "${escapeMd(skill.trigger.pattern)}"\n- Keywords: ${skill.trigger.keywords.map(escapeMd).join(", ")}\n\n`
  out += `### Workflow\n`
  for (const step of skill.workflow.steps) {
    out += `${step.order}. **${escapeMd(step.action)}** — ${escapeMd(step.description)}\n`
    if (step.tool) out += `   Tool: \`${step.tool}\`\n`
    out += `   Expected: ${escapeMd(step.expectedOutput)}\n`
  }
  return out
}
