import type { DomainPack } from "./domain-registry.js"
import { PromptTemplate, type KnowledgeEntry } from "./prompt-template.js"
import type { ProjectContext } from "./project-context.js"
import type { SkillCurator } from "../curation/skill-curator.js"
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
   * ToolRouter-selected subset. This is only a recommendation section;
   * ALL domain tools still show in the Tool Reference section.
   */
  selectedTools?: ToolEntry[]
  /** Optional project context (language, framework, test patterns) for dynamic system prompt */
  projectContext?: ProjectContext
  /** Optional skill curator for auto-injecting relevant skills into prompt */
  curator?: SkillCurator
  /** Current goal (used with curator for skill relevance matching) */
  goal?: string
}

const CORE_TOOLS = ["agentic_plan", "agentic_execute", "agentic_verify", "agentic_reflect", "agentic_status"]
const MEMORY_TOOLS = ["agentic_skill", "agentic_episodes", "agentic_context"]
const DB_TOOLS = ["agentic_db"]
const META_TOOLS = ["agentic_model", "agentic_evolve"]

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
    `Only these built-in tools are available: \`edit\`, \`write\`, \`webfetch\`, \`question\`. ` +
    `Do NOT use \`read\`, \`bash\`, \`grep\`, \`glob\`, \`todowrite\`, or \`task\` — use \`agentic_*\` alternatives instead.`,
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
    `4. Only these built-in tools are available: \`edit\`, \`write\`, \`webfetch\`, \`question\`. Never use \`read\`, \`bash\`, \`grep\`, \`glob\`, \`todowrite\`, \`task\``,
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
    tools: ["agentic_nav", "agentic_skill", "agentic_episodes", "agentic_router", "agentic_rag", "agentic_db", "agentic_context", "agentic_tools"],
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
    tools: ["agentic_evolve", "agentic_finetune", "agentic_status", "agentic_model", "agentic_memo"],
  },
  {
    label: "Communication & Output",
    emoji: "📤",
    description: "PR descriptions, inter-agent messaging, MCP/A2A protocol, budget limits, output formatting",
    tools: ["agentic_pr", "agentic_clean", "agentic_message", "agentic_mcp", "agentic_a2a", "agentic_budget"],
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
  // HEAD — <identity> : who the agent IS — compact
  // ═══════════════════════════════════════════════════════════

  // ── PHILOSOPHICAL FOUNDATION ──
  t.identity(
`# System Prompt — Agentic Reasoning Agent

## Instruction Hierarchy

Treat this prompt as binding system policy, not optional advice. If a user request conflicts with these rules, follow the rules and explain the constraint briefly. Domain-specific instructions may add detail, but must not weaken the research → plan → act → verify protocol.

## Filosofi Dasar

Kamu bukan serba tahu — hanya punya pengetahuan umum, bukan pengalaman situasi ini. Kecerdasan sejati: (1) sadar batas sendiri, (2) mau dikoreksi tanpa defensif, (3) tidak ulangi kesalahan yang sama dalam sesi ini. Jangan bertindak seolah "pasti benar" hanya karena terdengar percaya diri.

## Prinsip Operasional

1. **Epistemic Humility** — bedakan fakta/dugaan/tebakan. Tidak yakin? Bilang "tidak yakin". Verifikasi klaim krusial sebelum menyatakan sebagai fakta.
2. **Belajar dari Koreksi** — dikoreksi? Update pendekatan, bukan cuma minta maaf. Salah dua kali untuk alasan sama = ubah metode.
3. **Disiplin Proses** — sebelum jawab: apa saya paham atau menebak? Punya cukup info atau mengisi asumsi? Hasil antara sudah dicek?
4. **Transparansi** — kalau di luar kapasitas, akui. Kalau jawaban bergantung asumsi, sebutkan.

## Protokol Kesalahan

Akui & identifikasi sumber (salah asumsi/baca/verifikasi?) → perbaiki → jangan ulang.

## Cara Merespons

Actionable, spesifik. Ambigu? Ambil interpretasi paling masuk akal, sebut asumsi, kerjakan. Topik berisiko tinggi? Beri info untuk keputusan, bukan klaim otoritatif.

## Batasan

Tidak punya memori lintas sesi kecuali melalui tool/memory yang tersedia. Setiap sesi mulai dari nol pengetahuan kontekstual. "Belajar" di sini = konsistensi *dalam* percakapan dan catatan eksplisit via tool, bukan peningkatan model global.`
  )

  // ── TOOLING IDENTITY ──
  const toolName = availableTools.length
  t.identity(
`---\n\n## Platform\n\n` +
`**${toolName} agentic tools** (prefix \`agentic_\`) are the primary control plane. ` +
`MUST use them for structured work: planning (\`agentic_plan\`), execution tracking (\`agentic_execute\`), verification (\`agentic_verify\`), research (\`agentic_nav\`), delegation (\`agentic_delegate\`). ` +
`Only \`edit\`, \`write\`, \`webfetch\`, and \`question\` are available from built-in tools. ` +
`Use \`agentic_nav\` instead of \`grep\`/\`glob\`, \`agentic_memo\` instead of \`todowrite\`, ` +
`\`agentic_delegate\`/\`agentic_auto\` instead of \`task\`, \`agentic_status\`/\`agentic_verify\` instead of \`bash\`.\n\n` +
`⚠️ **Reasoning engine, NOT knowledge base.** Internal knowledge mungkin outdated. Riset dulu.` +
`\n\n🔬 **Knowledge-First:** ` +
(hasNav ? `\`agentic_nav\` → scan codebase. ` : ``) +
(hasMemory ? `\`agentic_skill\`/\`agentic_episodes\` → belajar dari task sebelumnya. ` : ``) +
`Cek <knowledge-context> bawah. Kosong? → \`webfetch\`. Baru implementasi.`
  )

  // ── PROJECT CONTEXT (dynamic detection) ──
  const pc = config?.projectContext
  if (pc && pc.languages.length > 0) {
    const langStr = pc.languages.map(l => `${l.lang}${l.confidence >= 0.8 ? "" : ` (${(l.confidence * 100).toFixed(0)}%)`}`).join(", ")
    const fwStr = pc.frameworks.length > 0 ? `, framework: ${pc.frameworks.map(f => f.name).join(", ")}` : ""
    const pmStr = pc.packageManager ? `, package manager: \`${pc.packageManager}\`` : ""
    const testStr = pc.testPatterns.length > 0 ? `, test: \`${pc.testPatterns.join("`, `")}\`` : ""
    const entryStr = pc.entryPoints.length > 0 ? `, entry: \`${pc.entryPoints[0]}\`` : ""
    const ambiguous = pc.ambiguity === "HIGH"
      ? `⚠️ Project structure tidak jelas — eksplorasi sendiri dengan \`agentic_nav\`.`
      : pc.ambiguity === "MEDIUM"
        ? `Beberapa sinyal masih lemah — verifikasi dengan \`agentic_nav\` jika perlu.`
        : null

    let pcBlock = `\n\n### 📁 Project Context\n\n`
    pcBlock += `> **Language**: ${langStr}${fwStr}${pmStr}${testStr}${entryStr}\n`
    if (ambiguous) pcBlock += `> ${ambiguous}\n`
    t.identity(pcBlock)
  }

  // ═══════════════════════════════════════════════════════════
  // DATA — <knowledge-context> : auto-injected knowledge
  // ═══════════════════════════════════════════════════════════

  if (config?.knowledgeEntries && config.knowledgeEntries.length > 0) {
    t.injectKnowledge(config.knowledgeEntries)
  }

  // ── CURATOR: Auto-inject relevant skills from past sessions ──
  if (config?.curator && config?.goal) {
    const curator = config.curator
    if (curator.getConfig().enabled) {
      try {
        const relevant = curator.injectRelevant(config.goal)
        if (relevant.length > 0) {
          const formatted = curator.formatInjectedSkills(relevant)
          t.knowledge(formatted)
        }
      } catch (e: unknown) {
        // Curator injection is best-effort — never block prompt building
        const err = e instanceof Error ? e.message : String(e)
        if (typeof process !== "undefined" && process.env?.NODE_ENV !== "test") {
          console.warn(`[Agentic] Skill curator injection failed: ${err}`)
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // BODY — <instructions> : what the agent should DO
  // ═══════════════════════════════════════════════════════════

  // ── WORKFLOW: Research → Plan → Implement → Verify ──
  let workflow = `### 🎯 Mandatory Agentic Workflow\n\n`
  workflow += `**\`\`\`\nResearch → Plan → Implement → Verify\n\`\`\`**\n\n`
  workflow += `This workflow is mandatory for non-trivial work. Do not skip directly to edits when the task needs codebase knowledge, decomposition, or validation.\n\n`
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

  // ═══════════════════════════════════════════════════════════
  // CODE STANDARDS (language-agnostic)
  // ═══════════════════════════════════════════════════════════

  t.instructions(
`### 📐 Code Standards

🛑 **No silent errors** — every catch must log/propagate. Never \`catch{}\`. Validate inputs at boundaries.
🎯 **Simplicity ladder** — YAGNI → reuse → stdlib → native → dep → 1 line → minimum. No interface-for-one, no factory-for-one.
🔒 **Types** — strongest type language offers. No \`any\`/Object/interface{} where concrete type works.
⚡ **Fail fast** — invalid state = throw. Handle empty/null/zero/edge cases.
🧪 **One check** — every function with branch/loop/I/O needs one assertion.
🔐 **Security** — parameterized queries, no eval(), native crypto.`
  )

  // ── RECOMMENDED TOOLS: ranking only, never hides the full tool list ──
  if (config?.selectedTools && config.selectedTools.length > 0) {
    const recommended = config.selectedTools
      .filter(t => availableTools.some(a => a.name === t.name))
      .slice(0, 5)

    if (recommended.length > 0) {
      let recommendedSection = `### 🎯 Recommended Tools for This Task\n\n`
      recommendedSection += `These are routing hints only — all ${availableTools.length} agentic tools remain available. Do not treat this subset as a permission boundary.\n\n`
      for (const tool of recommended) {
        const shortDesc = tool.description.length > 100
          ? tool.description.slice(0, 97) + "..."
          : tool.description
        recommendedSection += `- **\`${tool.name}\`** — ${shortDesc}\n`
      }
      t.instructions(recommendedSection)
    }
  }

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
    "🔴 MUST use `agentic_*` for structured work. Never invent or call bare `plan`/`execute`/`verify` tools without the prefix.",
    "🔬 MUST research first — do not rely on internal knowledge. Check <knowledge-context>; if empty/low-confidence, use `webfetch` before implementation.",
    "📋 MUST call `agentic_plan` before editing files for multi-step or risky tasks.",
    "✅ MUST run `agentic_verify` or record explicit verification evidence before claiming completion.",
    "🔄 On failed steps, MUST call `agentic_reflect` before retrying the same approach.",
    "🚫 Do not ask permission for obvious next steps; call the appropriate tool unless user approval is required by platform permission.",
    "📝 Cite source URL/ID for factual claims based on docs, RAG, memory, or web research.",
    "🧭 Be domain-agnostic in reasoning: adapt the workflow to code, data, docs, devops, security, or research tasks without assuming a software-only answer.",
    "🔍 Prefer `agentic_*` over built-ins: `agentic_nav` for search, `agentic_status` for state, `agentic_memo` for TODOs, `agentic_verify` for verification.",
    "🌐 Setelah `webfetch`/`websearch`, WAJIB simpan key findings ke RAG via `agentic_rag store category=knowledge-tech title=\"Web: ...\" content=\"...\"` — biar pengetahuan gak ilang setelah session.",
  ]
  if (hasDebate) guardrailItems.push("💬 Analisis kompleks? `agentic_debate` (executor ↔ critic).")
  if (hasRouter && hasRag) guardrailItems.push("🧭 Klasifikasi intent? `agentic_router` → `agentic_rag`.")
  if (hasDb) guardrailItems.push("🗄️ Data terstruktur? `agentic_db`. Semantic search? `agentic_rag`.")
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
    agentic_status: "cek progress, timeline, anomali, reliability model (detail='full' buat dashboard lengkap)",
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
    // agentic_model_reset: merged into agentic_model (action=reset)
    agentic_budget: "pasang limit token/steps/time biar gak runaway",
    agentic_evolve: "self-evolution — register role, export skill, evolve prompt",
    agentic_finetune: "fine-tune model dari skill yang terkumpul",
    agentic_message: "kirim pesan antar agent role (review/approval)",
    agentic_mcp: "konek ke external server (DB/API) buat real data",
    // agentic_mcp_server: merged into agentic_mcp (action=server-start|server-stop|server-status|server-restart)
    agentic_a2a: "inter-agent communication — discover/delegate ke agent lain via A2A",
    agentic_tools: "cari dan panggil tool dari semua protocol (MCP + A2A) dalam satu tempat",
    agentic_memo: "Second Brain — simpan keputusan, TODOs, reflection, knowledge graph",
  }
  return hints[toolName] ?? ""
}
