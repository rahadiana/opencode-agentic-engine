import type { DomainPack } from "./domain-registry.js"
import { PromptTemplate, type KnowledgeEntry } from "./prompt-template.js"
export interface ToolEntry {
  name: string
  description: string
}

export interface ToolListConfig {
  /** Whether to show the search_tools discovery hint */
  showDiscoveryHint?: boolean
  /** Whether this is a routed prompt (dynamic tool selection) */
  isRouted?: boolean
  /** Optional knowledge entries to auto-inject into <knowledge-context> section */
  knowledgeEntries?: KnowledgeEntry[]
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
    genericTools.map(x => `- **${x.name}**: ${x.description.length > 80 ? x.description.slice(0, 77) + "..." : x.description}`).join("\n") +
    `\n\n> 💡 **Need a different tool?** Use \`search_tools("what you need")\` to discover additional tools.`,
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
  const isCodeDomain = domainName === "code"

  const relevantToolNames = domain.tools ?? allTools.map(t => t.name)
  const relevantTools = allTools.filter(t => relevantToolNames.includes(t.name))
  const isRouted = config?.isRouted ?? false

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
  //
  // KNOWLEDGE-FIRST IDENTITY:
  // LLM dianggap sebagai reasoning engine, BUKAN knowledge base.
  // Semua pengetahuan HARUS dari RAG / web / arXiv / feedback loop.

  // Core identity: LLM bodoh
  t.identity(
    "⚠️ **CRITICAL IDENTITY**: You are a **reasoning engine**, NOT a knowledge base.\n\n" +
    "Your training data has a cutoff date. **Assume ALL internal knowledge may be outdated, incorrect, or irrelevant.**\n" +
    "Do NOT rely on what you \"know\" — always verify against the knowledge context provided below.",
  )

  // Tool listing header
  if (isRouted) {
    t.identity(
      `The following agentic tools have been **selected based on your current task** from a pool of 29 available tools. ` +
      `Use them when they fit. Built-in tools (\`read\`, \`edit\`, \`bash\`, \`grep\`, \`webfetch\`, \`write\`) are always available.`,
    )
  } else {
    t.identity(
      `You have access to **${relevantTools.length} specialized agentic_* tools**. ` +
      `Use them when they fit. Built-in tools (\`read\`, \`edit\`, \`bash\`, \`grep\`, \`webfetch\`, \`write\`) are always available.`,
    )
  }

  t.identity(
    `⚠️ **REMINDER**: ALL specialized tools use the "agentic_" prefix (e.g. "agentic_plan", "agentic_execute", "agentic_verify"). ` +
    `There is NO tool named just "execute", "plan", "verify", etc. Always include the prefix.`,
  )

  t.identity(
    `⚠️ **WEB TOOL NAME**: The web search tool is called **"webfetch"** — NOT "websearch", NOT "search_web", NOT "browser". ` +
    `Always use \`webfetch\`.`,
  )

  // Knowledge gathering checklist — mandatory, not optional
  const knowledgeSteps: string[] = []
  knowledgeSteps.push("## Knowledge-First Protocol (MANDATORY)")
  knowledgeSteps.push("")
  knowledgeSteps.push("**Your internal knowledge is SUSPECT.** Before implementing anything:")
  if (hasNav) knowledgeSteps.push(`1. **Scan codebase** — use \`agentic_nav\` to check project structure`)
  if (isCodeDomain) knowledgeSteps.push(`${hasNav ? "2" : "1"}. **Read files** — use \`read\` to inspect relevant files`)
  if (hasMemory) {
    const n = knowledgeSteps.length
    knowledgeSteps.push(`${n}. **Search skills**: \`agentic_skill find "relevant topic"\` — learn from past successes/failures`)
    knowledgeSteps.push(`${n + 1}. **Search episodes**: \`agentic_episodes search "similar task"\` — see what worked before`)
  }
  knowledgeSteps.push(`${knowledgeSteps.length}. **Check knowledge context** below — if <knowledge-context> is empty or low confidence, you MUST call \`webfetch\` to research`)
  knowledgeSteps.push(`${knowledgeSteps.length}. **Web research** — use \`webfetch\` to get current information (MANDATORY if confidence < 0.6)`)
  knowledgeSteps.push(`${knowledgeSteps.length}. Only after gathering ALL relevant knowledge → start implementing`)
  t.identity(knowledgeSteps.join("\n"))

  // ═══════════════════════════════════════════════════════════
  // DATA — <knowledge-context> : auto-injected knowledge
  // ═══════════════════════════════════════════════════════════

  // Inject knowledge entries if provided (from RAG/web/arXiv research)
  if (config?.knowledgeEntries && config.knowledgeEntries.length > 0) {
    t.injectKnowledge(config.knowledgeEntries)
  }

  // ═══════════════════════════════════════════════════════════
  // BODY — <instructions> : what the agent should DO
  // ═══════════════════════════════════════════════════════════

  // Knowledge-First Workflow — research is MANDATORY before implementation
  let workflow = `### Recommended Approach\n\n`
  workflow += `**Knowledge-First Workflow:** Research → Plan → Implement → Verify\n\n`
  workflow += `1. **RESEARCH FIRST** — Check <knowledge-context> above. If empty or low confidence, use \`webfetch\` / agent memory tools IMMEDIATELY\n`
  workflow += `2. **Plan** — Use a planning tool to break down the goal into clear steps\n`
  workflow += `3. **Implement** — Execute each step using the right tool\n`
  workflow += `4. **Verify** — Verify results when complete`
  if (hasAuto) {
    workflow += `\n\nOr use **agentic_auto** for fully autonomous execution (plan + execute + verify + retry in one call)`
  }
  if (!isRouted) {
    workflow += `\n\n> 💡 **Tip:** Need a different tool? Use \`search_tools("what you need")\` to discover and load additional tools on demand.`
  }
  t.instructions(workflow)

  // ═══════════════════════════════════════════════════════════
  // FOOTER — <guardrails> : constraints & closing rules
  // ═══════════════════════════════════════════════════════════

  const guardrailItems: string[] = [
    "KNOWLEDGE-FIRST: Research BEFORE implementing — do NOT rely on your internal knowledge",
    "USE the workflow: research → plan → implement → verify",
    "If <knowledge-context> is empty or ALL confidence < 0.6: you MUST call webfetch to research first",
    'Never ask "should I..." — just call the tool',
    "If a step fails, analyze it before retrying",
    "Always cite sources when making claims (URL, arXiv ID, RAG entry ID)",
  ]
  if (hasDebate) guardrailItems.push("For analysis tasks: use agentic_debate")
  if (hasRouter && hasRag) guardrailItems.push("For knowledge queries: use agentic_router then agentic_rag")
  let rules = guardrailItems.map((item, i) => `${i + 1}. ${item}`).join("\n")
  t.guardrails(rules)

  return t
}
