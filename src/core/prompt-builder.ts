import type { DomainPack } from "./domain-registry.js"
import { PromptTemplate, type KnowledgeEntry } from "./prompt-template.js"
export interface ToolEntry {
  name: string
  description: string
}

export interface ToolListConfig {
  /** Whether this is a routed prompt (dynamic tool selection) */
  isRouted?: boolean
  /** Optional knowledge entries to auto-inject into <knowledge-context> section */
  knowledgeEntries?: KnowledgeEntry[]
  /**
   * ToolRouter-selected subset (only used when isRouted=true).
   * When provided, ALL domain tools still show in "Available Tools" section,
   * and this subset shows in a separate "Selected Tools for This Task" section.
   */
  selectedTools?: ToolEntry[]
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
  config?: ToolListConfig,
): string {
  return buildTemplate(domain, allTools, config).render()
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
    `Use them when they fit. Built-in tools (\`read\`, \`edit\`, \`bash\`, \`grep\`, \`webfetch\`, \`write\`) are always available.`,
  )

  t.instructions(
    `## Workflow\n\n` +
    `1. **agentic_plan** — Break goal into steps\n` +
    `2. **agentic_execute** — Execute each step\n` +
    `3. **agentic_verify** — Verify results`,
  )

  t.instructions(
    `## Available Tools\n\n` +
    genericTools.map(x => `- **${x.name}**: ${x.description.length > 80 ? x.description.slice(0, 77) + "..." : x.description}`).join("\n"),
  )

  t.guardrails(
    `## Rules\n\n` +
    `1. Gather knowledge first before implementing\n` +
    `2. Use plan → implement → verify workflow\n` +
    `3. Never ask "should I" — just call the tool\n` +
    `4. Built-in tools (\`read\`, \`edit\`, \`bash\`, \`grep\`, \`webfetch\`, \`write\`) are always available`,
  )

  return t.renderWithFrontmatter(
    "General-purpose agentic assistant — plan, execute, verify, and learn",
  )
}

// ── Internal template builder ──

function buildTemplate(domain: DomainPack, allTools: ToolEntry[], config?: ToolListConfig): PromptTemplate {
  const domainName = domain.name

  // `allTools` should be the FULL tool registry (all domain tools).
  // `selectedTools` are ToolRouter's dynamic subset (shown in separate section when routed).
  const selectedTools = config?.selectedTools
  const isRouted = config?.isRouted ?? false
  const domainToolNames = domain.tools ?? allTools.map(t => t.name)

  // Available = all domain tools (always the full set)
  const availableTools = allTools.filter(t => domainToolNames.includes(t.name))

  // Selected = routed subset (falls back to availableTools when not routed)
  const activeTools = isRouted && selectedTools ? selectedTools : availableTools

  const hasMemory = activeTools.some(t => MEMORY_TOOLS.includes(t.name))
  const hasDebate = activeTools.some(t => t.name === "agentic_debate")
  const hasRouter = activeTools.some(t => t.name === "agentic_router")
  const hasRag = activeTools.some(t => t.name === "agentic_rag")
  const hasAuto = activeTools.some(t => t.name === "agentic_auto")
  const hasNav = activeTools.some(t => t.name === "agentic_nav")

  const t = new PromptTemplate()
  t.title(`Agentic ${domainName === "code" ? "Engineering" : domainName === "generic" ? "Assistant" : domainName} Agent`)

  // ═══════════════════════════════════════════════════════════
  // HEAD — <identity> : who the agent IS
  // ═══════════════════════════════════════════════════════════

  // Core identity: reasoning engine, not knowledge base
  t.identity(
    "You are an autonomous software engineering agent.\n\n" +
    "⚠️ **CRITICAL**: You are a **reasoning engine**, NOT a knowledge base. " +
    "Assume ALL internal knowledge may be outdated.",
  )

  // Tool listing header (concise)
  if (isRouted) {
    t.identity(
      `The following **${activeTools.length} agentic tools** have been **selected for your task** (from ${availableTools.length} total). ` +
      `Built-in tools (\`read\`, \`edit\`, \`bash\`, \`grep\`, \`webfetch\`, \`write\`) are always available.`,
    )
  } else {
    t.identity(
      `You have access to **${availableTools.length} specialized agentic_* tools**. ` +
      `Built-in tools (\`read\`, \`edit\`, \`bash\`, \`grep\`, \`webfetch\`, \`write\`) are always available.`,
    )
  }

  t.identity(
    `⚠️ **REMINDER**: ALL specialized tools use the "agentic_" prefix (e.g. "agentic_plan"). ` +
    `There is NO tool named just "execute", "plan", "verify". Always include the prefix.`,
  )

  t.identity(
    `⚠️ **WEB TOOL**: The web tool is called **\`webfetch\`** — NOT "websearch" or "search_web". Always use \`webfetch\`.`,
  )

  // Knowledge gathering checklist — dynamic numbering
  const knowledgeSteps: string[] = []
  knowledgeSteps.push("### Knowledge-First Protocol")
  knowledgeSteps.push("Research BEFORE implementing:")
  let stepNum = 1
  if (hasNav) knowledgeSteps.push(`${stepNum++}. \`agentic_nav\` — scan codebase for relevant files`)
  if (hasMemory) {
    knowledgeSteps.push(`${stepNum++}. \`agentic_skill find\` / \`agentic_episodes search\` — learn from past tasks`)
  }
  knowledgeSteps.push(`${stepNum++}. Check <knowledge-context> below. If empty or low confidence → \`webfetch\` to research`)
  knowledgeSteps.push(`${stepNum++}. Only after all relevant knowledge is gathered → start implementing`)
  t.identity(knowledgeSteps.join("\n"))

  // ═══════════════════════════════════════════════════════════
  // DATA — <knowledge-context> : auto-injected knowledge
  // ═══════════════════════════════════════════════════════════

  if (config?.knowledgeEntries && config.knowledgeEntries.length > 0) {
    t.injectKnowledge(config.knowledgeEntries)
  }

  // ═══════════════════════════════════════════════════════════
  // BODY — <instructions> : what the agent should DO
  // ═══════════════════════════════════════════════════════════

  // Workflow instructions (concise)
  let workflow = `### Recommended Approach\n\n`
  workflow += `**Research → Plan → Implement → Verify**\n\n`
  workflow += `1. **Research** — Scan codebase (\`agentic_nav\`), read files (\`read\`), search memory (\`agentic_skill\`/\`agentic_episodes\`), web research (\`webfetch\`)\n`
  workflow += `2. **Plan** — \`agentic_plan\` to decompose the goal into ordered steps\n`
  workflow += `3. **Implement** — Execute each step with \`agentic_execute\`. For complex sub-tasks, use \`agentic_delegate\` to assign to specialist agents.\n`
  workflow += `4. **Verify** — \`agentic_verify\` for final compile+lint+test+security check. Check progress with \`agentic_status\`.`
  if (hasAuto) {
    workflow += `\n\n**Quick path**: \`agentic_auto\` does plan+execute+verify+retry in one call for simple tasks.`
  }
  t.instructions(workflow)

  // ── Tool list (so LLM knows exact tool names & descriptions) ──
  if (availableTools.length > 0) {
    let toolList = `### Available Tools (${availableTools.length})\n\n`
    for (const tool of availableTools) {
      const cleanDesc = tool.description.length > 150
        ? tool.description.slice(0, 147) + "..."
        : tool.description
      toolList += `- **${tool.name}**: ${cleanDesc}\n`
    }
    t.instructions(toolList)
  }

  // NOTE: Selected Tools section removed per user feedback (2026-06-22).
  // LLM modern cukup lihat 29 tools + deskripsi — mereka bisa milih sendiri.
  // ToolRouter masih digunakan untuk dashboard/statistik, bukan untuk filter tools.

  // ═══════════════════════════════════════════════════════════
  // FOOTER — <guardrails> : constraints & closing rules
  // ═══════════════════════════════════════════════════════════

  const guardrailItems: string[] = [
    "Research FIRST — do NOT rely on internal knowledge",
    "Use the workflow: research → plan → implement → verify",
    'Never ask "should I..." — just call the tool',
    "If a step fails, call \`agentic_reflect\` to analyze before retrying",
    "Always cite sources (URL, arXiv ID, RAG entry ID)",
  ]
  if (hasDebate) guardrailItems.push("For deep analysis: use \`agentic_debate\` (executor ↔ critic)")
  if (hasRouter && hasRag) guardrailItems.push("For knowledge queries: \`agentic_router\` then \`agentic_rag\`")
  let rules = guardrailItems.map((item, i) => `${i + 1}. ${item}`).join("\n")
  t.guardrails(rules)

  return t
}
