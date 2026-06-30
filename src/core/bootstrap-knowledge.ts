/**
 * Bootstrap knowledge for the plugin's Knowledge-First architecture.
 * Seeds the RAG index with high-confidence documentation about the plugin
 * itself, so the agent has reliable knowledge when working on this codebase.
 */
import { createLogger } from "../observability/logger.js"
import type { MultiIndexRAG } from "../memory/multi-index-rag.js"

const log = createLogger("Bootstrap")

export interface BootstrapEntry {
  goal: string
  summary: string
  tags: string[]
  decisions: string[]
}

const BOOTSTRAP_NOWLEDGE: BootstrapEntry[] = [
  {
    goal: "Understand opencode-agentic-engine architecture",
    summary: "opencode-agentic-engine is an OpenCode plugin implementing agentic software engineering. It has TypeScript source files across 6 layers: core/ (engine: planning, execution, verification, LLM, git, budget), agents/ (multi-agent coordination + A2A protocol), drift/ (error detection, hallucination guard), memory/ (episodic store, skill store, vector store, RAG), evaluation/ (live evaluator), observability/ (trace logger, dashboard). The entry point is src/index.ts which registers 31 agentic tools and OpenCode hooks.",
    tags: ["architecture", "structure", "overview", "plugin"],
    decisions: ["Entry: src/index.ts", "Core engine: src/core/", "Multi-agent: src/agents/", "Memory: src/memory/"]
  },
  {
    goal: "What are the 31 agentic tools?",
    summary: "Stage I Foundation (5): agentic_plan, agentic_execute, agentic_reflect, agentic_verify, agentic_status. Stage II Intelligence (9): agentic_nav, agentic_context, agentic_snapshot, agentic_pr, agentic_score, agentic_model (includes reset), agentic_budget, agentic_db, agentic_memo. Stage III Orchestration (8): agentic_delegate, agentic_pipeline, agentic_message, agentic_parallel, agentic_skill, agentic_episodes, agentic_guard, agentic_finetune. Stage IV Evolution (1): agentic_evolve. Stage V Autonomous (1): agentic_auto. Blueprint (7): agentic_debate, agentic_router, agentic_clean, agentic_rag, agentic_mcp, agentic_a2a, agentic_tools. All tools use the agentic_ prefix.",
    tags: ["tools", "agentic", "reference", "list"],
    decisions: ["31 registered agentic tools total; agentic_dashboard and agentic_model_reset are merged into agentic_status detail=full and agentic_model reset actions", "Grouped by stage (I-V + Blueprint)", "All public tools prefixed with agentic_"]
  },
  {
    goal: "Recommended workflow: research → plan → implement → verify",
    summary: "Phase 1 (Research): Use agentic_nav to scan codebase, agentic_skill find to find reusable skills, agentic_episodes search to learn from past sessions. Phase 2 (Plan): agentic_plan to decompose the goal into ordered subtasks with dependencies. Phase 3 (Implement): agentic_execute for each step, agentic_delegate for complex sub-tasks, agentic_parallel for concurrent independent steps. Phase 4 (Verify): agentic_verify for deep multi-dimensional checks (compile, lint, test, security, performance, architecture, deps). If a step fails, use agentic_reflect to diagnose error category and propagation.",
    tags: ["workflow", "pattern", "recommended", "best-practice"],
    decisions: ["Research first: nav + skill + episodes", "Plan: decompose with dependencies", "Implement: execute steps, delegate complex", "Verify: multi-dimensional checks"]
  },
  {
    goal: "How model preferences work",
    summary: "The plugin has a 3-level model resolution system: (1) Per-call explicit model override via llmEngine.call({ model: {...} }), (2) Per-tool override via agentic_model set tool=agentic_plan model=..., (3) Category fallback by complexity tier (quick, unspecified-low, unspecified-high, deep). Tool complexity: agentic_nav/clean/pr/router are 'quick', agentic_debate/plan are 'unspecified-high', agentic_verify/finetune are 'deep'. Model preferences are persisted to .agentic/models.json.",
    tags: ["model", "preference", "configuration", "llm"],
    decisions: ["3-level resolution: call > tool > category > default", "Persisted to .agentic/models.json", "Per-role preferences for delegation"]
  },
  {
    goal: "How error analysis and recovery works",
    summary: "When a step fails, agentic_reflect calls ErrorAnalyzer which categorizes errors into: import, type, compile, test, runtime, or unknown. The DependencyTracker traces error propagation across the step chain — if step A depends on step B and B failed, A is marked as affected. The AgentLoop has auto-retry with exponential backoff and jitter (via auto-retry.ts). After maxRetries, it attempts LLM-based repair via attemptRepair(). HallucinationGuard checks file/function/import claims on every successful execute.",
    tags: ["error", "recovery", "reflect", "retry", "debugging"],
    decisions: ["Error categories: import, type, compile, test, runtime, unknown", "Auto-retry with exponential backoff + jitter", "LLM-based repair on repeated failure", "HallucinationGuard on every execute"]
  },
  {
    goal: "How multi-agent coordination works",
    summary: "The agents/ layer has: Orchestrator (multi-agent workflow pipelines), Coordinator (task delegation, shared memory, inter-agent messaging), AgentRuntime (sub-process spawner), RoleRegistry (built-in roles: architect, developer, qa, coordinator, pm + custom). Pipelines chain PM → Architect → Developer → QA with cross-validation between stages. Inter-agent messaging supports: result, review_request, review_response, clarification, approval, revision.",
    tags: ["multi-agent", "pipeline", "delegate", "orchestrator"],
    decisions: ["Roles: architect, developer, qa, coordinator, pm", "Pipeline: PM → Architect → Developer → QA", "Cross-validation between stages", "Inter-agent messaging with review/approval flow"]
  },
  {
    goal: "How memory and skills work across sessions",
    summary: "The memory/ layer provides cross-session persistence: EpisodicStore (past task outcomes with project scoping), SkillStore (reusable skill extraction from successful tasks with success rate tracking), VectorStore (TF-IDF sparse retrieval), MultiIndexRAG (hybrid TF-IDF + vector search with category segregation), LocalEmbedder (text embedding via API or hash fallback). Skills use self-describing format (agentic-skill/v1 schema). Episodes are scoped per project. Skills are globally shared.",
    tags: ["memory", "skills", "episodes", "RAG", "cross-session"],
    decisions: ["Episodes: project-scoped", "Skills: globally shared", "Vector: TF-IDF + optional embedding", "RAG: hybrid search with category segregation"]
  },
  {
    goal: "How to add a new feature to the plugin",
    summary: "1) Create source file in appropriate src/ subdirectory. 2) Add import + instance in src/index.ts. 3) Add tool definition in the tools object. 4) Add to expected tool list in test/run.mjs, test/dropin.mjs, test/load-samedir.mjs. 5) Add ≥2 test cases (happy path + error path). 6) Run npm run build && node test/run.mjs. 7) If Docker: ./test-container.sh. Conventions: English for code, Indonesian for communication, ESM imports with .js extensions, use execFileSync not execSync for shell safety.",
    tags: ["development", "contribution", "new-feature", "howto"],
    decisions: ["File in appropriate subdirectory", "Register in src/index.ts tools object", "Add to 3 test files", "2+ test cases per tool", "npm run build && node test/run.mjs"]
  },
  {
    goal: "OpenCode Plugin API and hooks",
    summary: "The plugin implements 5 hooks: config (agent registration), experimental.chat.system.transform (injects Knowledge-First system prompt with RAG results), chat.params (model tracking), tool.execute.after (observability tracing), and dispose (cleanup). All LLM calls go through client.session.prompt() via LLMEngine, never directly to external APIs. The experimental.chat.system.transform hook is the ONLY way to dynamically inject system prompt content — it appends RAG results, tool definitions, guardrails, and mandatory research instructions to every chat-mode LLM call.",
    tags: ["hooks", "plugin-api", "opencode", "sdk", "integration"],
    decisions: ["5 hooks: config, system.transform, chat.params, tool.execute.after, dispose", "All LLM via SDK client.session.prompt()", "No direct external API calls for LLM inference"]
  },
  {
    goal: "How testing works",
    summary: "Tests live in test/run.mjs (1117+ unit tests spanning 50+ sections). Additional test files: dropin.mjs (plugin discovery), load-samedir.mjs (E2E workflow), e2e-scenario.mjs (EvoClaw benchmark), swebench-harness.mjs (SWE-bench), e2e-llm.mjs (LLM E2E). Tests use custom assert() functions, not Jest/Mocha. Each tool must have ≥2 test cases. Run with: node test/run.mjs for unit tests, LLM_OFF=true node test/swebench-harness.mjs for mock mode.",
    tags: ["testing", "test", "run.mjs", "e2e", "benchmark"],
    decisions: ["1117+ unit tests in run.mjs", "22+ test files total", "Custom assert() framework", "Each tool: 2+ test cases"]
  }
]

let _seeded = false

/**
 * Seed the RAG with bootstrap knowledge on first init.
 * Idempotent — only runs once per plugin instance.
 */
export function bootstrapKnowledge(rag: MultiIndexRAG, projectId: string): void {
  if (_seeded) return
  _seeded = true

  const now = new Date().toISOString()
  let count = 0

  for (const entry of BOOTSTRAP_NOWLEDGE) {
    const id = `bootstrap-${entry.goal.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase().slice(0, 40)}`
    rag.indexEpisode("knowledge-tech", {
      id,
      sessionId: "bootstrap",
      planGoal: entry.goal,
      summary: entry.summary,
      outcome: "success",
      decisions: entry.decisions,
      filesChanged: [],
      timestamp: now,
      tags: [...entry.tags, "bootstrap", "high-confidence"],
      projectId,
      score: 0.95,
      usageCount: 1,
    })
    count++
  }

  if (process.env.DEBUG_AGENTIC) {
    log.debug(`Seeded ${count} entries into RAG`)
  }
}
