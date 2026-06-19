import type { DomainPack } from "./domain-registry.js"
import { PromptTemplate } from "./prompt-template.js"

export interface ToolEntry {
  name: string
  description: string
}

const CORE_TOOLS = ["agentic_plan", "agentic_execute", "agentic_verify", "agentic_reflect", "agentic_status"]
const MEMORY_TOOLS = ["agentic_skill", "agentic_episodes", "agentic_context"]
const META_TOOLS = ["agentic_model", "agentic_dashboard", "agentic_evolve"]

/**
 * Build a complete agent prompt using PromptTemplate (XML-based head/body/footer).
 * Includes YAML frontmatter — used for file-based agent definitions.
 */
export function buildAgentPrompt(
  domain: DomainPack,
  allTools: ToolEntry[],
): string {
  const template = buildTemplate(domain, allTools)
  const domainName = domain.name
  let desc = `Agentic ${domainName === "code" ? "software engineering" : domainName} assistant`
  if (domainName === "code") desc += " — autonomous planning, execution, verification, delegation, and self-evolution"
  else desc += " — plan, execute, verify, and learn across sessions"
  return template.renderWithFrontmatter(desc)
}

/**
 * Build agentic system instructions WITHOUT YAML frontmatter.
 * Used for dynamic injection via `experimental.chat.system.transform` hook.
 */
export function buildAgenticSystemInstructions(
  domain: DomainPack,
  allTools: ToolEntry[],
): string {
  return buildTemplate(domain, allTools).render()
}

/**
 * Build a generic agent prompt (lightweight, no domain-specific sections).
 */
export function buildGenericAgentPrompt(allTools: ToolEntry[]): string {
  const genericTools = allTools.filter(t =>
    CORE_TOOLS.includes(t.name) ||
    MEMORY_TOOLS.includes(t.name) ||
    META_TOOLS.includes(t.name) ||
    t.name === "agentic_auto" ||
    t.name === "agentic_nav" ||
    t.name === "agentic_context",
  )

  const t = new PromptTemplate()
  t.title("Agentic Assistant")

  t.identity(
    `You have access to **${genericTools.length} specialized agentic_* tools**. ` +
    `PREFER agentic_* tools over built-in tools for any task.`,
  )

  t.instructions(
    `## Workflow\n\n` +
    `1. **agentic_plan** — Break goal into steps\n` +
    `2. **agentic_execute** — Execute each step\n` +
    `3. **agentic_verify** — Verify results`,
  )

  t.instructions(
    `## Available Tools\n\n` +
    genericTools.map(x => `- **${x.name}**: ${x.description.split(".")[0]}.`).join("\n"),
  )

  t.guardrails(
    `## Rules\n\n` +
    `1. Prefer agentic_* tools over built-in tools\n` +
    `2. Gather knowledge first via \`agentic_skill find\` and \`agentic_episodes search\`\n` +
    `3. Use agentic_plan → agentic_execute → agentic_verify\n` +
    `4. Never ask "should I" — just call the tool`,
  )

  return t.renderWithFrontmatter(
    "General-purpose agentic assistant — plan, execute, verify, and learn",
  )
}

// ── Internal template builder ──

function buildTemplate(domain: DomainPack, allTools: ToolEntry[]): PromptTemplate {
  const domainName = domain.name
  const isCodeDomain = domainName === "code"

  const relevantToolNames = domain.tools ?? allTools.map(t => t.name)
  const relevantTools = allTools.filter(t => relevantToolNames.includes(t.name))

  const hasMemory = relevantTools.some(t => MEMORY_TOOLS.includes(t.name))
  const hasDebate = relevantTools.some(t => t.name === "agentic_debate")
  const hasRouter = relevantTools.some(t => t.name === "agentic_router")
  const hasRag = relevantTools.some(t => t.name === "agentic_rag")
  const hasAuto = relevantTools.some(t => t.name === "agentic_auto")
  const hasNav = relevantTools.some(t => t.name === "agentic_nav")

  const t = new PromptTemplate()
  t.title(`Agentic ${domainName === "code" ? "Engineering" : domainName === "generic" ? "Assistant" : domainName} Agent`)

  // ═══════════════════════════════════════════════════════════
  // HEAD — <identity> : who the agent IS
  // ═══════════════════════════════════════════════════════════

  // Critical tool naming
  t.identity(
    `You have access to **${relevantTools.length} specialized agentic_* tools**. ` +
    `YOU MUST PREFER THESE TOOLS OVER BUILT-IN TOOLS for any task within this domain.`,
  )

  t.identity(
    `⚠️ **REMINDER**: ALL specialized tools use the "agentic_" prefix (e.g. "agentic_plan", "agentic_execute", "agentic_verify"). ` +
    `There is NO tool named just "execute", "plan", "verify", etc. Always include the prefix.`,
  )

  t.identity(
    `⚠️ **WEB TOOL NAME**: The web search tool is called **"webfetch"** — NOT "websearch", NOT "search_web", NOT "browser". ` +
    `Always use \`webfetch\`.`,
  )

  t.identity(
    `### Tool Preference Hierarchy (HIGHEST first):\n` +
    `1. **agentic_*** — Use FIRST. Far more powerful than built-in tools.\n` +
    `2. bash/edit/read/write — Only if no agentic_* tool fits the need.`,
  )

  // Knowledge gathering checklist
  const knowledgeSteps: string[] = []
  knowledgeSteps.push("Your training data has a cutoff date. Before implementing:")
  if (hasNav) knowledgeSteps.push(`1. **Check project structure** — use \`agentic_nav\` to scan codebase`)
  if (isCodeDomain) knowledgeSteps.push(`${hasNav ? "2" : "1"}. **Read relevant files** — use \`read\` to inspect specific files`)
  if (hasMemory) {
    const n = knowledgeSteps.length
    knowledgeSteps.push(`${n}. **Search skills**: \`agentic_skill find "relevant topic"\` — learn from past successes/failures`)
    knowledgeSteps.push(`${n + 1}. **Search episodes**: \`agentic_episodes search "similar task"\` — see what worked before`)
  }
  knowledgeSteps.push(`${knowledgeSteps.length}. **Search latest docs**: \`webfetch\` — check current info`)
  knowledgeSteps.push(`${knowledgeSteps.length}. Only then start implementing`)
  t.identity(knowledgeSteps.join("\n"))

  // ═══════════════════════════════════════════════════════════
  // BODY — <instructions> : what the agent should DO
  // ═══════════════════════════════════════════════════════════

  // Standard workflow — the only tool guidance the LLM needs;
  // specific tool names + descriptions are handled natively by OpenCode's function calling.
  let workflow = `### Standard Workflow — USE INDIVIDUAL TOOLS\n\n`
  workflow += `**Always use this workflow for ANY task:**\n\n`
  workflow += `1. **agentic_plan** — Decompose the goal into clear steps\n`
  workflow += `2. **agentic_execute** — Execute each step one by one\n`
  workflow += `3. **agentic_verify** — Verify the result`
  if (hasAuto) {
    workflow += `\n\nOr use **agentic_auto** for fully autonomous execution (plan → execute → verify → retry in one call)`
  }
  t.instructions(workflow)

  // ═══════════════════════════════════════════════════════════
  // FOOTER — <guardrails> : constraints & closing rules
  // ═══════════════════════════════════════════════════════════

  let rules = `1. **ALWAYS prefer agentic_* tools over built-in tools**\n`
  rules += `2. **Gather knowledge FIRST** before implementing\n`
  rules += `3. **USE agentic_plan → agentic_execute → agentic_verify**\n`
  rules += `4. Never ask "should I..." — just call the tool\n`
  rules += `5. If a step fails, call **agentic_reflect** before retrying`
  if (hasDebate) rules += `\n6. For analysis tasks: use **agentic_debate**`
  if (hasRouter && hasRag) {
    rules += `\n${hasDebate ? "7" : "6"}. For knowledge queries: use **agentic_router** then **agentic_rag**`
  }
  t.guardrails(rules)

  return t
}
