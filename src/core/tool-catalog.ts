import type { ToolEntry } from "./prompt-builder.js"

// ── Tool category type ──────────────────────────────────────────
export type ToolCategory =
  | "core"
  | "memory"
  | "analysis"
  | "coordination"
  | "meta"
  | "blueprint"

// ── Extended entry for the catalog ──────────────────────────────
export interface ToolCatalogEntry extends ToolEntry {
  keywords: string[]
  category: ToolCategory
}

// ── Single source of truth for agentic tool metadata ──────────────
// Descriptions follow MCP 6-component rubric from arXiv:2602.14878.
// Keywords + category feed ToolRouter scoring.
export const AGENTIC_TOOL_CATALOG: ToolCatalogEntry[] = [
  { name: "agentic_plan", description: "Break a goal into subtasks. Use when starting any multi-step task. Avoid on single-step tasks — just execute directly. Key: `goal` (what to accomplish), `autoDecompose` (auto-breakdown). Example: plan `goal=\"add auth\"` → 4 steps.", keywords: ["plan", "decompose", "break-down", "step", "subtask", "template", "rencana", "langkah", "tahap"], category: "core" },
  { name: "agentic_execute", description: "Mark a step complete with auto-verify. Use after finishing each subtask. Avoid claiming success when verification failed. Key: `stepId` (from plan), `filesModified` (for dependency tracking). Example: execute `stepId=\"step-1\" success=true`.", keywords: ["execute", "run", "do", "implement", "step-result", "record", "complete", "jalankan", "buat", "tulis"], category: "core" },
  { name: "agentic_reflect", description: "Analyze a failed step: error category + propagation trace. Use when execute returned failed or compile error. Avoid on success steps. Key: `stepId` (the failed step), `errorDetails` (stack trace). Example: reflect `stepId=\"step-1\"`.", keywords: ["error", "fail", "debug", "analyze", "diagnose", "retry", "recover", "gagal", "salah", "error"], category: "analysis" },
  { name: "agentic_verify", description: "Run compile + lint + test suite. Use before final commit or after major changes. Avoid per-file — use execute's auto-verify for incremental checks. Key: `projectDir` (defaults to worktree). Example: verify `stepId=\"final\"`.", keywords: ["verify", "test", "compile", "lint", "validate", "check", "ci", "verifikasi", "tes", "cek"], category: "core" },
  { name: "agentic_status", description: "Show execution progress, blocked steps, file changes, model reliability. Use to check what's left or blocked. No args needed.", keywords: ["status", "progress", "dashboard", "blocked", "health", "summary", "progres", "sejauh", "timeline", "anomaly", "stats", "trace", "observability", "statistik"], category: "core" },
  { name: "agentic_nav", description: "Scan codebase for relevant files by keyword. Use before implementing to understand structure. Avoid for file content — use `read` instead. Key: `query` (feature/module name), `showSummary` (full structure). Example: nav `query=\"auth\"`.", keywords: ["search", "find", "file", "codebase", "scan", "explore", "lookup", "nav", "cari", "file"], category: "core" },
  { name: "agentic_context", description: "Compress conversation when approaching token limits. Use to free context window. Key: `action` — \"view\" to check size, \"compress\" to compact.", keywords: ["compress", "context", "token", "summary", "condense", "ringkas", "kompres"], category: "memory" },
  { name: "agentic_snapshot", description: "Save/restore execution checkpoints. Use before risky refactoring. Key: `action` (save/list/restore), `label` (name). Example: snapshot `action=\"save\" label=\"before-auth-refactor\"`.", keywords: ["checkpoint", "snapshot", "save", "restore", "rollback", "backup", "simpan", "kembali"], category: "core" },
  { name: "agentic_pr", description: "Generate PR description from plan + step results. Use when task is complete and verified. Avoid if no plan was created. Key: `action` — \"generate\" (default) or \"create\" (via gh CLI).", keywords: ["pull-request", "pr", "github", "merge", "commit", "git", "description"], category: "core" },
  { name: "agentic_score", description: "Analyze technical debt: coupling, complexity, patterns. Use after refactoring or before finalizing. Key: `files` (optional — defaults to all modified).", keywords: ["debt", "quality", "score", "coupling", "maintainability", "tech-debt", "skor", "kualitas"], category: "analysis" },
  { name: "agentic_model", description: "Configure which LLM model per agent role for the session. Use to switch models without config file changes. Key: `action` (set/get/list/clear), `role`, `model` name.", keywords: ["model", "llm", "config", "provider", "gpt", "claude"], category: "meta" },
  { name: "agentic_budget", description: "Set, view, or reset resource budget limits (tokens, steps, time, cost). Use to prevent runaway loops. Acts as circuit breaker for autonomous execution. Key: `action` (set/get/status/reset), `scope` (session/task). Example: budget `action=set maxSteps=10`.", keywords: ["budget", "limit", "cost", "token", "steps", "time", "circuit-breaker", "biaya", "batas"], category: "meta" },
  { name: "agentic_delegate", description: "Assign work to architect/developer/QA/coordinator. Use for complex sub-tasks needing specialist context. Avoid for trivial edits. Key: `taskId`, `description`, `role`. Supports pipeline auto-advance.", keywords: ["delegate", "assign", "agent", "role", "architect", "developer", "qa", "delegasi", "tugaskan"], category: "coordination" },
  { name: "agentic_pipeline", description: "Define and run multi-agent pipelines: PM → Architect → Developer → QA. Use for end-to-end feature development. Key: `action` (define/list/run/status/suggest), `stages`.", keywords: ["pipeline", "workflow", "chain", "stage", "pm", "architect", "alur"], category: "coordination" },
  { name: "agentic_message", description: "Send messages between agent roles, request reviews, check inbox. Use in multi-agent workflows. Key: `action` (send/inbox/conversation/mark-read), `to`, `message`.", keywords: ["message", "inbox", "conversation", "review", "ask", "notify", "pesan", "kirim"], category: "coordination" },
  { name: "agentic_parallel", description: "Analyze dependencies and run ready steps concurrently. Use for independent sub-tasks. Avoid on sequential tasks. Key: `action` analyze or execute.", keywords: ["parallel", "concurrent", "race", "dependency", "simultaneous", "paralel", "bersamaan"], category: "coordination" },
  { name: "agentic_skill", description: "Extract, search, and reuse skills from successful task patterns. Use to learn from past work. Key: `action` (extract/find/list), `query` (for find).", keywords: ["skill", "extract", "learn", "pattern", "template", "reuse", "pola", "kemampuan"], category: "memory" },
  { name: "agentic_episodes", description: "Search past session outcomes across projects. Use before planning similar tasks. Key: `action` (search/recent/stats), `query` (keywords).", keywords: ["episode", "history", "past", "session", "memory", "recall", "riwayat", "sebelumnya"], category: "memory" },
  { name: "agentic_guard", description: "Re-check truthfulness of file/function/import claims. Auto-runs on execute — only call manually for re-audit. Key: `stepId` to re-check.", keywords: ["hallucination", "verify", "truth", "claim", "check", "audit", "halusinasi"], category: "analysis" },
  { name: "agentic_evolve", description: "Inspect system, register custom roles, export skills, manage prompts (Stage IV). Use for system administration. Key: `action` (inspect/register-role/evolve/read-prompt/edit-prompt).", keywords: ["evolve", "evolusi", "self-improve", "upgrade", "inspect", "register", "tingkatkan"], category: "meta" },
  { name: "agentic_auto", description: "One-call autonomous loop: plan → execute → verify → retry. Use for simple, well-defined tasks. Avoid for complex multi-domain tasks — use pipeline instead. Key: `goal`, `thorough` (extra checks).", keywords: ["auto", "autonomous", "loop", "one-shot", "automatic", "end-to-end", "otomatis"], category: "core" },
  { name: "agentic_debate", description: "Multi-turn executor ↔ critic debate for deep analysis. Use for complex analysis, data validation, or when uncertain. Avoid for simple fact lookup — use websearch instead. Key: `task`, `maxRounds` (max 5).", keywords: ["debate", "discuss", "argue", "analysis", "critic", "review-loop", "debat", "bahas"], category: "analysis" },
  { name: "agentic_router", description: "Classify user intent into categories and route to the right knowledge index. Use before searching memory to scope results. Lightweight — keyword+LLM hybrid.", keywords: ["classify", "route", "intent", "categorize", "direct", "klasifikasi"], category: "blueprint" },
  { name: "agentic_clean", description: "Strip debate artifacts and reformat raw text to clean markdown/JSON. Use after debate or multi-step analysis. Key: `format` (markdown/json/text), `schema` (validation).", keywords: ["clean", "strip", "format", "reformat", "remove-artifact", "bersihkan"], category: "blueprint" },
  { name: "agentic_rag", description: "Store, search, and retrieve knowledge across category-segregated indexes. Use with agentic_router for scoped search. Key: `action` (search/store/stats/categories), `query`.", keywords: ["rag", "search", "knowledge", "store", "retrieve", "index", "cari", "pengetahuan", "ingat", "memori", "lama", "sejarah"], category: "memory" },
  { name: "agentic_db", description: "SQLite database backend untuk persistence — query, save, load, stats. Lebih cepat dari file JSON. Support structured queries dengan WHERE, JOIN, GROUP BY.", keywords: ["database", "sqlite", "sql", "query", "save", "load", "table", "db", "persist", "basis-data"], category: "memory" },
  { name: "agentic_memo", description: "Second Brain: record ADR decisions, manage TODOs, run reflection, and inspect knowledge graph. Key: `action` (decision/todo/todo-done/list/reflect/graph).", keywords: ["memo", "decision", "adr", "todo", "second-brain", "graph", "reflection", "keputusan", "catatan"], category: "memory" },
  { name: "agentic_mcp", description: "MCP client + server. Connect to external servers (DB, APIs), call tools, or manage the MCP server (server-start/stop/status/restart). Key: `action` (connect/list/call/disconnect/server-start/server-stop).", keywords: ["mcp", "external", "connect", "server", "api", "tool-call", "eksternal"], category: "blueprint" },
  { name: "agentic_a2a", description: "Agent-to-Agent protocol: discover remote agents, delegate tasks, start/stop A2A server. Google A2A standard for cross-framework interoperability. Key: `action` (serve/discover/delegate/list/ping/stats).", keywords: ["a2a", "agent", "discover", "serve", "interop", "delegate"], category: "blueprint" },
  { name: "agentic_tools", description: "Unified tool search and calling across MCP + A2A protocols. Search for tools by keyword, auto-route calls, list all connections, view combined stats. Key: `action` (search/call/list/stats).", keywords: ["tools", "unified", "search", "discover", "protocol", "gateway", "mcp", "a2a"], category: "blueprint" },
  { name: "agentic_finetune", description: "End-to-end pipeline: prepare training data from skills → upload to OpenAI → create/monitor jobs. Use to fine-tune models from agent experience. Key: `action` (prepare/save/upload/create-job/status).", keywords: ["finetune", "fine-tune", "training", "dataset", "openai", "model"], category: "blueprint" },
  { name: "agentic_fetch", description: "Fetch URL dan auto-index ke RAG. Hasilnya otomatis tersimpan di knowledge base dan bisa dicari lagi via agentic_rag. Gunakan ini sebagai pengganti webfetch bawaan — lebih hemat karena tidak perlu store manual.", keywords: ["fetch", "web", "url", "scrape", "research", "ambil", "dokumentasi", "web-search"], category: "core" },
]

// ── Derived convenience exports ──────────────────────────────────

/** Array of { name, description } for prompt builder and OpenCode tool definition */
export const AGENTIC_TOOL_REGISTRY: ToolEntry[] = AGENTIC_TOOL_CATALOG.map(
  ({ name, description }) => ({ name, description }),
)

/** Set of tool names for fast lookup */
export const AGENTIC_TOOL_NAMES: string[] = AGENTIC_TOOL_CATALOG.map(t => t.name)
