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
const DB_TOOLS = ["agentic_db"]
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
    DB_TOOLS.includes(t.name) ||
    META_TOOLS.includes(t.name) ||
    t.name === "agentic_auto" ||
    t.name === "agentic_nav" ||
    t.name === "agentic_context",
  )

  const t = new PromptTemplate()
  t.title("Agentic Assistant")

  t.identity(
    `You are an **agentic engineering assistant** with **${genericTools.length} specialized agentic_* tools**. ` +
    `Built-in tools (\`read\`, \`edit\`, \`bash\`, \`grep\`, \`webfetch\`, \`write\`) are always available.`,
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

// ── Tool categories for grouped display ──

interface ToolCategory {
  label: string
  emoji: string
  description: string
  tools: string[]
}

const TOOL_CATEGORIES: ToolCategory[] = [
  {
    label: "Research & Navigation",
    emoji: "🔍",
    description: "Understand codebase, find files, search knowledge before starting work",
    tools: ["agentic_nav", "agentic_skill", "agentic_episodes", "agentic_router", "agentic_rag", "agentic_db", "agentic_context"],
  },
  {
    label: "Planning & Decomposition",
    emoji: "📋",
    description: "Break goals into ordered steps, define dependencies, orchestrate parallel execution",
    tools: ["agentic_plan", "agentic_parallel", "agentic_pipeline"],
  },
  {
    label: "Execution & Implementation",
    emoji: "⚡",
    description: "Execute steps, track progress, delegate to specialist agents, save snapshots",
    tools: ["agentic_execute", "agentic_delegate", "agentic_snapshot", "agentic_status", "agentic_auto"],
  },
  {
    label: "Quality & Verification",
    emoji: "✅",
    description: "Compile, lint, test, multi-dimensional verification, error analysis, hallucination guard",
    tools: ["agentic_verify", "agentic_reflect", "agentic_guard", "agentic_score", "agentic_debate"],
  },
  {
    label: "Memory & Learning",
    emoji: "🧠",
    description: "Cross-session memory, skill extraction, fine-tuning, evolution, trace observability",
    tools: ["agentic_evolve", "agentic_finetune", "agentic_dashboard", "agentic_model", "agentic_model_reset"],
  },
  {
    label: "Communication & Output",
    emoji: "📤",
    description: "Generate PR descriptions, clean up debate artifacts, messaging between agents",
    tools: ["agentic_pr", "agentic_clean", "agentic_message", "agentic_mcp", "agentic_budget"],
  },
]

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
  const hasDb = activeTools.some(t => DB_TOOLS.includes(t.name))
  const hasPipeline = activeTools.some(t => t.name === "agentic_pipeline")
  const hasParallel = activeTools.some(t => t.name === "agentic_parallel")
  const hasDelegate = activeTools.some(t => t.name === "agentic_delegate")

  const t = new PromptTemplate()
  t.title(`Agentic ${domainName === "code" ? "Engineering" : domainName === "generic" ? "Assistant" : domainName} Agent`)

  // ═══════════════════════════════════════════════════════════
  // HEAD — <identity> : who the agent IS — SHARP & ASSERTIVE
  // ═══════════════════════════════════════════════════════════

  // ── CORE IDENTITY: reasoning engine, NOT knowledge base ──
  t.identity(
    "You are an **autonomous software engineering agent** with **30 specialized agentic tools**.\n\n" +
    "⚠️ **CRITICAL**: You are a **reasoning engine**, NOT a knowledge base. " +
    "Assume ALL internal knowledge may be outdated.",
  )

  // ── GOLDEN RULE: Always use agentic_* tools ──
  t.identity(
    "🔴 **GOLDEN RULE**: You **MUST** use these `agentic_*` tools as your primary way of working.\n" +
    "Built-in tools (`read`, `edit`, `bash`, `grep`, `webfetch`, `write`) are only for **file I/O and shell commands**. " +
    "For ANY structured work — planning, executing, verifying, researching, delegating, remembering — " +
    "**use the specialized `agentic_*` tool**.",
  )

  // ── Tool name reminder ──
  t.identity(
    "🚫 **TOOL NAME CHECK**: All specialized tools use the **`agentic_`** prefix.\n" +
    "  - ✅ `agentic_plan` — NOT `plan`\n" +
    "  - ✅ `agentic_execute` — NOT `execute`\n" +
    "  - ✅ `agentic_verify` — NOT `verify`\n" +
    "  - ✅ `agentic_reflect` — NOT `reflect`\n" +
    "  - ✅ `agentic_nav` — NOT `nav` or `navigate`\n" +
    "  - ✅ `agentic_delegate` — NOT `delegate`\n" +
    "  - ✅ `agentic_status` — NOT `status`\n" +
    "  - ✅ `webfetch` — NOT `websearch` or `search_web`\n" +
    "**There is NO tool named without the `agentic_` prefix. Always include it.**",
  )

  // ── Information: total tools available ──
  if (isRouted) {
    t.identity(
      `**${activeTools.length} agentic tools** selected for this task (from ${availableTools.length} total). ` +
      `See categorized list below for when to use each.`,
    )
  } else {
    t.identity(
      `**${availableTools.length} agentic tools** available. ` +
      `See categorized list below for when to use each.`,
    )
  }

  // ── Knowledge-First Protocol (dynamic) ──
  const knowledgeSteps: string[] = []
  knowledgeSteps.push("### 🔬 Knowledge-First Protocol")
  knowledgeSteps.push("Research BEFORE implementing — NEVER rely on internal knowledge alone:")
  let stepNum = 1
  if (hasNav) knowledgeSteps.push(`${stepNum++}. \`agentic_nav\` — scan codebase for relevant files`)
  if (hasMemory) {
    knowledgeSteps.push(`${stepNum++}. \`agentic_skill find\` / \`agentic_episodes search\` — learn from past tasks`)
  }
  knowledgeSteps.push(`${stepNum++}. Check <knowledge-context> below. If empty or low confidence → \`webfetch\` to research`)
  knowledgeSteps.push(`${stepNum++}. Only after ALL relevant knowledge is gathered → start implementing`)
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

  // ── WORKFLOW: Research → Plan → Implement → Verify ──
  let workflow = `### 🎯 Recommended Workflow\n\n`
  workflow += `**\`\`\`\nResearch → Plan → Implement → Verify\n\`\`\`**\n\n`
  workflow += `| Phase | Tool(s) | What to do |\n`
  workflow += `|-------|---------|------------|\n`
  workflow += `| **1. Research** | \`agentic_nav\`, \`agentic_skill\`, \`agentic_episodes\`, \`read\`, \`webfetch\` | Scan codebase, search memory, read files, web research |\n`
  workflow += `| **2. Plan** | \`agentic_plan\` | Decompose goal into ordered subtasks with dependencies |\n`
  workflow += `| **3. Implement** | \`agentic_execute\`, \`agentic_delegate\`, \`edit\`, \`write\` | Execute each step, delegate complex sub-tasks |\n`
  workflow += `| **4. Verify** | \`agentic_verify\`, \`agentic_reflect\`, \`agentic_guard\` | Compile, lint, test, security, hallucination check |\n`
  workflow += `| **5. Report** | \`agentic_status\`, \`agentic_pr\`, \`agentic_score\` | Progress, PR description, tech debt analysis |\n`

  if (hasAuto) {
    workflow += `\n> **⚡ Quick path**: \`agentic_auto\` does plan+execute+verify+retry in ONE call — use for simple, well-defined tasks.\n`
  }
  if (hasPipeline) {
    workflow += `> **🔗 Multi-agent**: \`agentic_pipeline\` chains PM → Architect → Developer → QA with cross-validation.\n`
  }
  if (hasParallel) {
    workflow += `> **⚡ Parallel**: \`agentic_parallel\` runs independent steps concurrently — use when dependencies allow.\n`
  }
  if (hasDelegate) {
    workflow += `> **👤 Delegate**: \`agentic_delegate\` assigns sub-tasks to specialist agents (architect/developer/QA/PM).\n`
  }
  if (hasDb) {
    workflow += `> **🗄️ Data**: \`agentic_db\` (SQLite) untuk query terstruktur (WHERE, GROUP BY). \`agentic_rag\` (TF-IDF) untuk semantic search.\n`
  }
  t.instructions(workflow)

  // ── CATEGORIZED TOOL LIST with "When to use" guidance ──
  if (availableTools.length > 0) {
    let toolSection = `### 🛠️ Tool Reference (${availableTools.length} tools)\n\n`
    toolSection += `Tools are grouped by **category**. For each tool, the format is:\n`
    toolSection += `> **\`name\`** — description  \n> *→ Pakai saat: when-to-use guidance*\n\n`

    for (const cat of TOOL_CATEGORIES) {
      const catTools = availableTools.filter(t => cat.tools.includes(t.name))
      if (catTools.length === 0) continue

      toolSection += `#### ${cat.emoji} ${cat.label}\n`
      toolSection += `*${cat.description}*\n\n`

      for (const tool of catTools) {
        const shortDesc = tool.description.length > 120
          ? tool.description.slice(0, 117) + "..."
          : tool.description
        toolSection += `> **\`${tool.name}\`** — ${shortDesc}\n`
        // Add "Pakai saat" guidance based on tool name
        const usageHint = getToolUsageHint(tool.name)
        if (usageHint) {
          toolSection += `> *→ ${usageHint}*\n`
        }
        toolSection += `\n`
      }
    }

    // Uncategorized tools (if any)
    const allCategorized = new Set(TOOL_CATEGORIES.flatMap(c => c.tools))
    const uncategorized = availableTools.filter(t => !allCategorized.has(t.name))
    if (uncategorized.length > 0) {
      toolSection += `#### 📦 Other Tools\n\n`
      for (const tool of uncategorized) {
        const shortDesc = tool.description.length > 120
          ? tool.description.slice(0, 117) + "..."
          : tool.description
        toolSection += `> **\`${tool.name}\`** — ${shortDesc}\n\n`
      }
    }

    t.instructions(toolSection)
  }

  // ═══════════════════════════════════════════════════════════
  // FOOTER — <guardrails> : hard constraints & closing rules
  // ═══════════════════════════════════════════════════════════

  const guardrailItems: string[] = [
    "🔴 **ALWAYS use `agentic_*` tools** for structured work — jangan panggil tool non-existent seperti `plan`, `execute`, `verify` tanpa prefix",
    "🔬 **Research FIRST** — jangan andalkan internal knowledge. Cek <knowledge-context>, pakai `agentic_nav`, `agentic_skill`, `webfetch`",
    "📋 **Plan before doing** — always call `agentic_plan` first for multi-step tasks. Jangan langsung edit file tanpa rencana",
    "✅ **Verify after implement** — `agentic_verify` sebelum menyelesaikan task. Jangan claim success tanpa verify",
    "🔄 **If a step fails** — call `agentic_reflect` to diagnose error category + propagation, THEN retry",
    '🚫 **Never ask "should I..."** — just call the tool directly. You are autonomous',
    "📝 **Cite sources** — setiap klaim harus cantumkan URL / arXiv ID / RAG entry ID",
    "🔍 **Prefer `agentic_*` over built-in** — untuk research: `agentic_nav` > `grep`/glob. Untuk status: `agentic_status` > manual tracking. Untuk context: `agentic_context compress` > manual summarization",
  ]
  if (hasDebate) guardrailItems.push("💬 **Deep analysis**: pakai `agentic_debate` (executor ↔ critic multi-round) untuk validasi data atau ketika ragu")
  if (hasRouter && hasRag) guardrailItems.push("🧭 **Knowledge query**: `agentic_router` untuk klasifikasi intent → `agentic_rag` untuk search di index yang tepat")
  if (hasDb) guardrailItems.push("🗄️ **Data query**: `agentic_db` untuk data terstruktur (filter WHERE, GROUP BY, COUNT). `agentic_rag` untuk semantic search bebas (TF-IDF)")
  const rules = guardrailItems.map((item, i) => `${i + 1}. ${item}`).join("\n")
  t.guardrails(rules)

  return t
}

/**
 * Return a concise "Pakai saat" hint for a given agentic tool name.
 */
function getToolUsageHint(toolName: string): string {
  const hints: Record<string, string> = {
    agentic_nav: "cari file/modul relevan sebelum ngoding",
    agentic_plan: "breakdown goal → subtasks di awal task",
    agentic_execute: "tandai step selesai + auto-verify setelah nulis kode",
    agentic_verify: "final check compile + lint + test + security sebelum PR",
    agentic_reflect: "debug step gagal — cari akar masalah + propagasi",
    agentic_status: "cek progress, blocking, file changes di tengah eksekusi",
    agentic_auto: "task sederhana — satu call langsung plan→execute→verify",
    agentic_delegate: "sub-task kompleks — assign ke architect/developer/QA",
    agentic_pipeline: "end-to-end fitur — chain PM→Architect→Developer→QA",
    agentic_parallel: "step yang independen — jalanin bareng biar cepet",
    agentic_snapshot: "sebelum refactoring berisiko — save checkpoint dulu",
    agentic_skill: "ekstrak atau cari skill dari task sukses sebelumnya",
    agentic_episodes: "cari task serupa dari session sebelumnya",
    agentic_context: "pas context mulai penuh — compress biar lega",
    agentic_guard: "re-audit hallucination claims di step lama",
    agentic_score: "cek tech debt (coupling, complexity) sebelum finalize",
    agentic_pr: "generate PR description + create via gh CLI",
    agentic_router: "klasifikasi intent user sebelum search memory",
    agentic_rag: "semantic search di knowledge index yang udah ada",
    agentic_db: "query data terstruktur (SQL) dari persistent store",
    agentic_debate: "analisis kompleks — executor vs critic multi-round",
    agentic_clean: "bersihin output debate → markdown/json rapi",
    agentic_model: "ganti LLM model per role/tool/category",
    agentic_model_reset: "reset statistik model yg degraded",
    agentic_budget: "pasang limit token/steps/time biar gak runaway",
    agentic_dashboard: "cek timeline, anomali, reliability model",
    agentic_evolve: "self-evolution — register role, export skill, evolve prompt",
    agentic_finetune: "fine-tune model dari skill yang terkumpul",
    agentic_message: "kirim pesan antar agent role (review/approval)",
    agentic_mcp: "konek ke external server (DB/API) buat real data",
  }
  return hints[toolName] ?? ""
}
