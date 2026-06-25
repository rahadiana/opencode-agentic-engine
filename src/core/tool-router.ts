import type { ToolEntry } from "./prompt-builder.js"

// ── Enhanced tool metadata for routing ────────────────────────────
export interface ToolMeta extends ToolEntry {
  keywords: string[]
  category: "core" | "memory" | "analysis" | "coordination" | "meta" | "blueprint"
  usageCount: number
  successRate: number
  avgLatencyMs: number
  lastUsed: number
}

export interface RoutingContext {
  /** The current user message / task description */
  taskInput: string
  /** Recent tool call history (last ~10) */
  recentTools: string[]
  /** Current domain name (code, data-science, devops, etc.) */
  domain: string
  /** Whether this is a sub-agent call */
  isSubAgent: boolean
}

export interface RoutingResult {
  tool: ToolMeta
  score: number
  reasons: string[]
}

// ── Built-in tools that are always available ──────────────────────
const ALWAYS_EXPOSE = new Set(["read", "edit", "bash", "grep", "webfetch", "write"])

// ── Colocation groups: tools that are often used together ─────────
const TOOL_COLOCATIONS: Record<string, string[]> = {
  plan: ["agentic_plan", "agentic_execute", "agentic_verify", "agentic_reflect"],
  delegate: ["agentic_delegate", "agentic_message", "agentic_pipeline"],
  search: ["agentic_nav", "agentic_rag", "grep", "glob", "read"],
  memory: ["agentic_skill", "agentic_episodes", "agentic_context", "agentic_rag"],
  debug: ["agentic_reflect", "agentic_guard", "agentic_dashboard", "grep", "read"],
  evolve: ["agentic_evolve", "agentic_skill", "agentic_dashboard"],
}

// ── Tool consolidation: tools with overlapping roles (from evaluation notes) ──
// Maps consolidated tool → primary tool(s) + when to use each
const TOOL_CONSOLIDATION: Record<string, { primary: string[]; note: string }> = {
  agentic_auto: { primary: ["agentic_plan", "agentic_execute", "agentic_verify"], note: "agentic_auto wraps plan+execute+verify. Use for simple tasks; use individual tools for complex ones." },
  agentic_debate: { primary: ["agentic_reflect", "agentic_router"], note: "agentic_debate is executor↔critic deep analysis. For simple analysis, use agentic_reflect or agentic_router instead." },
  agentic_router: { primary: ["agentic_rag", "agentic_episodes"], note: "agentic_router classifies intent before RAG search. Use agentic_rag directly if you already know the category." },
}

// ── Anti-keywords: when to AVOID a tool (from "To Call or Not to Call" framework) ──
const TOOL_ANTI_KEYWORDS: Record<string, string[]> = {
  agentic_plan: ["execute", "implement", "write code", "fix bug"],
  agentic_execute: ["plan", "decompose", "break down"],
  agentic_verify: ["plan", "search", "find"],
  agentic_delegate: ["simple", "trivial", "small", "quick", "typo"],
  agentic_pipeline: ["simple", "quick", "small", "typo", "single-step"],
  agentic_auto: ["complex", "multi-domain", "cross", "delegate", "pipeline"],
  agentic_debate: ["search", "lookup", "find", "fetch", "simple fact"],
  agentic_reflect: ["success", "completed", "done"],
  agentic_guard: ["create", "implement", "write", "build"],
}

// ── Default enhanced metadata for all agentic tools ────────────────
const DEFAULT_METAS: Record<string, Partial<ToolMeta>> = {
  agentic_plan: { keywords: ["plan", "decompose", "break-down", "step", "subtask", "template", "rencana", "langkah", "tahap"], category: "core" },
  agentic_execute: { keywords: ["execute", "run", "do", "implement", "step-result", "record", "complete", "jalankan", "buat", "tulis"], category: "core" },
  agentic_reflect: { keywords: ["error", "fail", "debug", "analyze", "diagnose", "retry", "recover", "gagal", "salah", "error"], category: "analysis" },
  agentic_verify: { keywords: ["verify", "test", "compile", "lint", "validate", "check", "ci", "verifikasi", "tes", "cek"], category: "core" },
  agentic_status: { keywords: ["status", "progress", "dashboard", "blocked", "health", "summary", "progres", "sejauh"], category: "core" },
  agentic_nav: { keywords: ["search", "find", "file", "codebase", "scan", "explore", "lookup", "nav", "cari", "file"], category: "core" },
  agentic_context: { keywords: ["compress", "context", "token", "summary", "condense", "ringkas", "kompres"], category: "memory" },
  agentic_snapshot: { keywords: ["checkpoint", "snapshot", "save", "restore", "rollback", "backup", "simpan", "kembali"], category: "core" },
  agentic_pr: { keywords: ["pull-request", "pr", "github", "merge", "commit", "git", "description"], category: "core" },
  agentic_score: { keywords: ["debt", "quality", "score", "coupling", "maintainability", "tech-debt", "skor", "kualitas"], category: "analysis" },
  agentic_model: { keywords: ["model", "llm", "config", "provider", "gpt", "claude"], category: "meta" },
  agentic_delegate: { keywords: ["delegate", "assign", "agent", "role", "architect", "developer", "qa", "delegasi", "tugaskan"], category: "coordination" },
  agentic_pipeline: { keywords: ["pipeline", "workflow", "chain", "stage", "pm", "architect", "alur"], category: "coordination" },
  agentic_message: { keywords: ["message", "inbox", "conversation", "review", "ask", "notify", "pesan", "kirim"], category: "coordination" },
  agentic_parallel: { keywords: ["parallel", "concurrent", "race", "dependency", "simultaneous", "paralel", "bersamaan"], category: "coordination" },
  agentic_skill: { keywords: ["skill", "extract", "learn", "pattern", "template", "reuse", "pola", "kemampuan"], category: "memory" },
  agentic_episodes: { keywords: ["episode", "history", "past", "session", "memory", "recall", "riwayat", "sebelumnya"], category: "memory" },
  agentic_dashboard: { keywords: ["dashboard", "timeline", "anomaly", "stats", "trace", "observability", "statistik"], category: "meta" },
  agentic_guard: { keywords: ["hallucination", "verify", "truth", "claim", "check", "audit", "halusinasi"], category: "analysis" },
  agentic_evolve: { keywords: ["evolve", "evolusi", "self-improve", "upgrade", "inspect", "register", "tingkatkan"], category: "meta" },
  agentic_auto: { keywords: ["auto", "autonomous", "loop", "one-shot", "automatic", "end-to-end", "otomatis"], category: "core" },
  agentic_debate: { keywords: ["debate", "discuss", "argue", "analysis", "critic", "review-loop", "debat", "bahas"], category: "analysis" },
  agentic_router: { keywords: ["classify", "route", "intent", "categorize", "direct", "klasifikasi"], category: "blueprint" },
  agentic_clean: { keywords: ["clean", "strip", "format", "reformat", "remove-artifact", "bersihkan"], category: "blueprint" },
  agentic_rag: { keywords: ["rag", "search", "knowledge", "store", "retrieve", "index", "cari", "pengetahuan", "ingat", "memori", "lama", "sejarah"], category: "memory" },
  agentic_mcp: { keywords: ["mcp", "external", "connect", "server", "api", "tool-call", "eksternal"], category: "blueprint" },
  agentic_a2a: { keywords: ["a2a", "agent", "discover", "serve", "interop", "delegate"], category: "blueprint" },
  agentic_tools: { keywords: ["tools", "unified", "search", "discover", "protocol", "gateway", "mcp", "a2a"], category: "blueprint" },
  agentic_finetune: { keywords: ["finetune", "fine-tune", "training", "dataset", "openai", "model"], category: "blueprint" },
}

// ── Anti-keyword penalty (from "To Call or Not to Call" framework) ──
function antiKeywordPenalty(tool: ToolMeta, input: string): number {
  const lower = input.toLowerCase()
  const antiKeywords = TOOL_ANTI_KEYWORDS[tool.name]
  if (!antiKeywords) return 0
  let penalty = 0
  for (const ak of antiKeywords) {
    if (lower.includes(ak)) penalty += 3
  }
  return -penalty
}

// ── Keyword-based routing strategy ────────────────────────────────
function keywordScore(tool: ToolMeta, input: string): number {
  const lower = input.toLowerCase()
  let score = 0
  for (const kw of tool.keywords) {
    if (lower.includes(kw)) score += 2
  }
  // Name match
  const toolName = tool.name.toLowerCase().replace("agentic_", "")
  if (lower.includes(toolName)) score += 3
  // Description match
  const desc = tool.description.toLowerCase()
  const inputWords = lower.split(/\s+/).filter(w => w.length > 3)
  for (const w of inputWords) {
    if (desc.includes(w)) score += 1
  }
  return score
}

// ── Recency/usage bonus ──────────────────────────────────────────
function usageBonus(tool: ToolMeta): number {
  let bonus = 0
  // Favor tools with proven success
  if (tool.successRate > 0.8 && tool.usageCount > 0) bonus += 2
  // Slight demotion for tools that have failed
  if (tool.successRate < 0.3 && tool.usageCount > 2) bonus -= 1
  return bonus
}

// ── Colocation bonus: if recent tools include related tool, boost ─
function colocationBonus(tool: ToolMeta, recentTools: string[]): number {
  const recentSet = new Set(recentTools)
  for (const [, group] of Object.entries(TOOL_COLOCATIONS)) {
    if (group.includes(tool.name)) {
      for (const member of group) {
        if (member !== tool.name && recentSet.has(member)) return 3
      }
    }
  }
  return 0
}

// ── Infer task type from input ────────────────────────────────────
function inferTaskType(input: string): string[] {
  const lower = input.toLowerCase()
  const types: string[] = []
  if (/plan|decompose|break.*down|subtask|rencana|langkah/i.test(lower)) types.push("plan")
  if (/implement|create|write|build|add.*feature|fix.*bug|buat|tulis|bikin/i.test(lower)) types.push("implement")
  if (/search|find|where|lookup|locate|cari/i.test(lower)) types.push("search")
  if (/debug|error|fail|bug|issue|troubleshoot|gagal|salah/i.test(lower)) types.push("debug")
  if (/test|verify|check|validate|audit|tes|cek/i.test(lower)) types.push("verify")
  if (/delegate|assign|send|role|agent\b|tugas|kirim/i.test(lower)) types.push("delegate")
  if (/refactor|clean|improve|optimize|restructure|ubah|perbaiki|rapikan/i.test(lower)) types.push("refactor")
  if (/memory|recall|skill|learn|before|history|ingat|lama|sejarah|sebelumnya/i.test(lower)) types.push("memory")
  if (/evolve|upgrade|self.*improv|register|tingkatkan|evolusi/i.test(lower)) types.push("evolve")
  if (/deploy|release|publish|ci|cd/i.test(lower)) types.push("deploy")
  return types
}

// ── ToolRouter ────────────────────────────────────────────────────
export class ToolRouter {
  private metas: Map<string, ToolMeta> = new Map()
  private toolCallHistory: Map<string, { count: number; successes: number; totalLatency: number; lastUsed: number }> = new Map()
  private allocatedToolCount = 10  // default: show 10 agentic tools + always-expose built-ins

  // ── Transition probability graph (AutoTool-inspired: arXiv:2511.14650) ──
  // Tracks which tools follow which — used for inertia-based scoring
  private transitionGraph: Map<string, Map<string, number>> = new Map() // fromTool → { toTool: count }
  private lastTool: string | null = null

  constructor() {
    for (const [name, meta] of Object.entries(DEFAULT_METAS)) {
      this.metas.set(name, {
        name,
        description: "",
        keywords: meta.keywords ?? [],
        category: meta.category ?? "blueprint",
        usageCount: 0,
        successRate: 1.0,
        avgLatencyMs: 0,
        lastUsed: 0,
      })
    }
  }

  /** Update tool descriptions from the registered TOOL_REGISTRY */
  setDescriptions(entries: ToolEntry[]): void {
    for (const e of entries) {
      const existing = this.metas.get(e.name)
      if (existing) {
        existing.description = e.description
      }
    }
  }

  /** Record a tool call result for adaptive routing */
  recordCall(name: string, success: boolean, latencyMs: number): void {
    const existing = this.toolCallHistory.get(name) ?? { count: 0, successes: 0, totalLatency: 0, lastUsed: 0 }
    existing.count++
    if (success) existing.successes++
    existing.totalLatency += latencyMs
    existing.lastUsed = Date.now()
    this.toolCallHistory.set(name, existing)

    // Sync to meta
    const meta = this.metas.get(name)
    if (meta) {
      meta.usageCount = existing.count
      meta.successRate = existing.count > 0 ? existing.successes / existing.count : 1.0
      meta.avgLatencyMs = existing.count > 0 ? existing.totalLatency / existing.count : 0
      meta.lastUsed = existing.lastUsed
    }

    // ── Transition tracking (AutoTool: tool usage inertia) ──
    if (this.lastTool && this.lastTool !== name) {
      if (!this.transitionGraph.has(this.lastTool)) {
        this.transitionGraph.set(this.lastTool, new Map())
      }
      const targets = this.transitionGraph.get(this.lastTool)!
      targets.set(name, (targets.get(name) ?? 0) + 1)
    }
    this.lastTool = name
  }

  /** Get transition probability from one tool to another (0-1) */
  getTransitionProbability(from: string, to: string): number {
    const targets = this.transitionGraph.get(from)
    if (!targets || targets.size === 0) return 0
    const total = [...targets.values()].reduce((s, c) => s + c, 0)
    return (targets.get(to) ?? 0) / total
  }

  /** Build the consolidation hints for tool descriptions */
  buildConsolidationHint(toolName: string): string {
    const c = TOOL_CONSOLIDATION[toolName]
    if (!c) return ""
    return ` | Overlaps with: ${c.primary.join(", ")} — ${c.note}`
  }

  /** Get all consolidation entries */
  getConsolidationMap(): Record<string, { primary: string[]; note: string }> {
    return { ...TOOL_CONSOLIDATION }
  }

  /** Get the current tool usage stats (for dashboard) */
  getStats(): Record<string, { count: number; successRate: number; avgLatency: number }> {
    const stats: Record<string, { count: number; successRate: number; avgLatency: number }> = {}
    for (const [name, meta] of this.metas) {
      stats[name] = { count: meta.usageCount, successRate: meta.successRate, avgLatency: meta.avgLatencyMs }
    }
    return stats
  }

  /**
   * Select the top-K agentic tools for the current context.
   * Always exposes built-in tools (read, edit, bash, grep, etc) without listing them.
   * Uses: keyword scoring + colocation + usage stats → ranked → top K
   */
  selectTools(context: RoutingContext, topK = this.allocatedToolCount): { selected: ToolMeta[]; reasons: string } {
    const { taskInput, recentTools } = context

    const scored: RoutingResult[] = []
    const allToolNames = [...this.metas.keys()]
    const lastTool = recentTools.length > 0 ? recentTools[recentTools.length - 1] : null

    for (const name of allToolNames) {
      const tool = this.metas.get(name)!
      const kwScore = keywordScore(tool, taskInput)
      const colo = colocationBonus(tool, recentTools)
      const usage = usageBonus(tool)

      // ── Anti-keyword penalty (arXiv:2605.00737 "To Call or Not to Call") ──
      const antiPenalty = antiKeywordPenalty(tool, taskInput)

      // ── Transition probability bonus (AutoTool: arXiv:2511.14650) ──
      let transitionBonus = 0
      if (lastTool && this.transitionGraph.has(lastTool)) {
        const prob = this.getTransitionProbability(lastTool, name)
        if (prob > 0.3) transitionBonus = 3  // strong inertia
        else if (prob > 0.1) transitionBonus = 1  // weak inertia
      }

      const total = kwScore + colo + usage + antiPenalty + transitionBonus

      const reasons: string[] = []
      if (kwScore > 0) reasons.push(`keyword:${kwScore}`)
      if (colo > 0) reasons.push(`colocation:${colo}`)
      if (usage !== 0) reasons.push(`usage:${usage}`)
      if (antiPenalty < 0) reasons.push(`anti-match:${antiPenalty}`)
      if (transitionBonus > 0) reasons.push(`inertia:${transitionBonus}`)

      scored.push({ tool, score: total, reasons })
    }

    // Sort by score descending, then by usage count descending (most proven first)
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return b.tool.usageCount - a.tool.usageCount
    })

    // Take top K with score > 0, plus always include tools from colocation groups
    // of the top-scoring tool
    const selectedNames = new Set<string>()
    const topTools = scored.filter(s => s.score > 0).slice(0, topK)
    for (const t of topTools) selectedNames.add(t.tool.name)

    // If top tool has a colocation group, include those too (ensures plan→execute→verify works)
    if (topTools.length > 0) {
      const topName = topTools[0].tool.name
      for (const [, group] of Object.entries(TOOL_COLOCATIONS)) {
        if (group.includes(topName)) {
          for (const member of group) {
            if (!selectedNames.has(member)) {
              const m = this.metas.get(member)
              if (m) { selectedNames.add(member); topTools.push({ tool: m, score: 0, reasons: ["colocation-auto"] }) }
            }
          }
          break
        }
      }
    }

    // Ensure minimum useful set: if task is about planning, include plan→execute→verify
    const taskTypes = inferTaskType(taskInput)
    for (const tt of taskTypes) {
      const group = TOOL_COLOCATIONS[tt]
      if (group) {
        for (const member of group) {
          if (!selectedNames.has(member)) {
            const m = this.metas.get(member)
            if (m) { selectedNames.add(member); topTools.push({ tool: m, score: 1, reasons: [`task:${tt}`] }) }
          }
        }
      }
    }

    // Build reason summary
    const reasonMap = new Map<string, number>()
    for (const t of topTools) {
      for (const r of t.reasons) {
        reasonMap.set(r, (reasonMap.get(r) ?? 0) + 1)
      }
    }
    const reasonSummary = [...reasonMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([r, c]) => `${r}(${c})`).join(", ")

    return {
      selected: [...selectedNames].map(n => this.metas.get(n)!).filter(Boolean),
      reasons: reasonSummary || "fallback: all tools shown",
    }
  }

  /** Build the tool listing text for prompt injection — concise format */
  buildToolList(selected: ToolMeta[]): string {
    if (selected.length === 0) return ""
    return selected.map(t => {
      // Extract a concise summary: first sentence or up to 120 chars
      const desc = t.description.length > 120 ? t.description.slice(0, 117) + "..." : t.description
      return `- **${t.name}**: ${desc}`
    }).join("\n")
  }

  /** Build the always-expose tool reminder */
  buildAlwaysExposeHint(): string {
    return `\n\nAdditionally, these built-in tools are always available: \`${[...ALWAYS_EXPOSE].join("`, `")}\`.`
  }

  /** Set how many agentic tools to show (default: 10) */
  setAllocatedToolCount(n: number): void {
    this.allocatedToolCount = Math.max(3, Math.min(15, n))
  }
}
