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
    summary: "1) Create source file in appropriate src/ subdirectory. 2) Add import + instance in src/index.ts. 3) Add tool definition in the tools object. 4) Add to expected tool list in test/run.mjs, test/dropin.mjs, test/load-samedir.mjs. 5) Add ≥2 test cases — Part A core tests in test/_runall.mjs, specialized tests in test/_b_*.mjs. 6) Run npm run build && node test/run.mjs (orchestrator runs all). 7) If Docker: ./test-container.sh. Conventions: English for code, Indonesian for communication, ESM imports with .js extensions, use execFileSync not execSync for shell safety.",
    tags: ["development", "contribution", "new-feature", "howto"],
    decisions: ["File in appropriate subdirectory", "Register in src/index.ts tools object", "Add to 3 test files + Part A in _runall.mjs or _b_*.mjs", "2+ test cases per tool", "npm run build && node test/run.mjs"]
  },
  {
    goal: "OpenCode Plugin API and hooks",
    summary: "The plugin implements 5 hooks: config (agent registration), experimental.chat.system.transform (injects Knowledge-First system prompt with RAG results), chat.params (model tracking), tool.execute.after (observability tracing), and dispose (cleanup). All LLM calls go through client.session.prompt() via LLMEngine, never directly to external APIs. The experimental.chat.system.transform hook is the ONLY way to dynamically inject system prompt content — it appends RAG results, tool definitions, guardrails, and mandatory research instructions to every chat-mode LLM call.",
    tags: ["hooks", "plugin-api", "opencode", "sdk", "integration"],
    decisions: ["5 hooks: config, system.transform, chat.params, tool.execute.after, dispose", "All LLM via SDK client.session.prompt()", "No direct external API calls for LLM inference"]
  },
  {
    goal: "How testing works",
    summary: "Tests live across multiple files: test/_runall.mjs (core), test/_b_*.mjs (specialized), and test/run.mjs (orchestrator). 2727+ unit tests total. Additional test files: dropin.mjs (plugin discovery), load-samedir.mjs (E2E workflow), e2e-scenario.mjs (EvoClaw benchmark), swebench-harness.mjs (SWE-bench), e2e-llm.mjs (LLM E2E). Tests use custom assert() functions, not Jest/Mocha. Each tool must have ≥2 test cases. Run with: node test/run.mjs for unit tests, LLM_OFF=true node test/swebench-harness.mjs for mock mode.",
    tags: ["testing", "test", "run.mjs", "e2e", "benchmark"],
    decisions: ["2727+ unit tests across multiple files", "22+ test files total", "Custom assert() framework", "Each tool: 2+ test cases"]
  },
  // ── Reference Checklists (inspired by addyosmani/agent-skills) ──
  {
    goal: "Checklist: Definition of Done — every change must clear this bar",
    summary: "CORRECTNESS: All acceptance criteria met. Code runs and behaves as intended (verified at runtime). New behavior covered by tests that fail without change and pass with it. Existing tests still pass — no regressions. Edge cases and error paths handled. QUALITY: Code reveals intent through naming and structure — no comments needed to explain WHAT it does. No duplicated business logic. No dead code, debug output, or commented-out blocks. Changes scoped to task — no unrelated refactors. Linting and formatting pass. INTEGRATION: Change works with rest of system. Database migrations, config changes, and feature flags accounted for. Backward compatibility considered for public interfaces. DOCUMENTATION: Public interfaces, APIs, and user-facing behavior documented. Architectural decisions worth preserving recorded as ADRs. SHIP-READINESS: Security implications reviewed for untrusted input, auth, data handling. Observability in place for new critical paths (logs, metrics, traces). Rollback path exists for risky changes. Human has reviewed and approved before merge.",
    tags: ["checklist", "definition-of-done", "quality", "gate", "reference"],
    decisions: ["DoD applies to EVERY change", "Not negotiable per deadline", "Acceptance criteria + DoD = done"]
  },
  {
    goal: "Checklist: Security review — OWASP Top 10 prevention",
    summary: "INPUT VALIDATION: All user input validated and sanitized at system boundaries. SQL queries parameterized (no string concatenation). Output encoded to prevent XSS. AUTHENTICATION & AUTHORIZATION: Auth checked where needed. Secrets kept out of code, logs, and version control. Use environment variables or secrets manager. Least privilege principle applied. DEPENDENCIES: Dependencies from trusted sources with no known vulnerabilities. Run `npm audit` or equivalent. No unnecessary dependencies (every dependency is a liability). DATA PROTECTION: Data from external sources (APIs, logs, user content, config files) treated as untrusted. External data flows validated at system boundaries before use in logic or rendering. No sensitive data in logs, error messages, or URLs. BOUNDARY SECURITY: Three-tier boundary system for untrusted data. CORS configured properly. Rate limiting on public endpoints.",
    tags: ["checklist", "security", "owasp", "reference", "hardening"],
    decisions: ["Validate ALL input at boundaries", "Parameterized queries always", "Secrets never in code", "Least privilege"]
  },
  {
    goal: "Checklist: Performance optimization — measure-first approach",
    summary: "MEASURE BEFORE OPTIMIZING: Establish baseline metrics before any optimization. Profile hot paths — don't guess. Use real data, not synthetic. FRONTEND: Core Web Vitals targets: LCP < 2.5s, FID < 100ms, CLS < 0.1. Bundle size audit — tree-shake unused imports. Lazy load non-critical components. Avoid layout thrashing. Minimize re-renders. BACKEND: No N+1 query patterns. Pagination on ALL list endpoints. Unbounded loops or unconstrained data fetching — flag immediately. Synchronous operations that should be async. Database query optimization — use indexes, avoid full table scans. INFRASTRUCTURE: CDN caching for static assets. Response compression enabled. Connection pooling for databases. Rate limiting to prevent abuse. ANTI-PATTERNS: Premature optimization without measurement. Over-fetching in GraphQL/REST. Missing indexes on queried columns. Blocking the event loop with CPU-intensive sync operations.",
    tags: ["checklist", "performance", "optimization", "reference", "web-vitals"],
    decisions: ["Measure first, optimize second", "Core Web Vitals as targets", "No N+1 queries", "Pagination on all lists"]
  },
  {
    goal: "Checklist: Testing patterns — test pyramid & best practices",
    summary: "TEST PYRAMID: Unit tests (~80%) — pure logic, isolated, milliseconds each. Integration tests (~15%) — component interactions, API boundaries, test DB. E2E tests (~5%) — full user flows, real browser. WRITING GOOD TESTS: Test state (outcome-based assertions), not interactions (method call verification). DAMP over DRY in tests — each test tells a complete story. Prefer real implementations over mocks (real > fake > stub > mock). Arrange-Act-Assert pattern. One assertion per concept. Descriptive test names that read like specification. THE BEYONCE RULE: If you liked it, you should have put a test on it. Infrastructure changes, refactoring, and migrations are not responsible for catching bugs — your tests are. TEST SIZES: Small (single process, no I/O, milliseconds) — pure function tests. Medium (localhost, seconds) — API tests with test DB. Large (external services, minutes) — E2E tests, performance benchmarks. ANTI-PATTERNS: Testing implementation details (tests break on refactor). Flaky tests (timing, order-dependent). Testing framework code. Snapshot abuse. No test isolation. Mocking everything.",
    tags: ["checklist", "testing", "tdd", "patterns", "reference"],
    decisions: ["Test pyramid: 80/15/5", "Test outcomes not interactions", "DAMP over DRY in tests", "Beyonce Rule applied"]
  },

  {
    goal: "Checklist: Accessibility — WCAG 2.1 AA compliance",
    summary: "KEYBOARD: All interactive elements reachable via keyboard. Focus indicators visible (not just :focus-visible). No keyboard traps. SCREEN READERS: All images have alt text. ARIA landmarks for page structure. Form inputs have associated labels. Dynamic content changes announced via live regions. VISUAL: Color contrast ratio ≥ 4.5:1 for normal text, ≥ 3:1 for large text. Content not conveyed by color alone. Text zoomable to 200% without loss. TESTING: Run axe DevTools or Lighthouse accessibility audit. Test with screen reader (VoiceOver/NVDA). Test keyboard-only navigation.",
    tags: ["checklist", "accessibility", "wcag", "a11y", "reference"],
    decisions: ["WCAG 2.1 AA minimum", "Keyboard nav required", "Screen reader tested", "Color contrast 4.5:1"]
  },
  {
    goal: "Checklist: Observability — logs, metrics, traces, alerts",
    summary: "STRUCTURED LOGGING: Log in structured format (JSON) — not plain text. Include correlation ID per request. Log levels: debug, info, warn, error — use appropriately. No sensitive data in logs. METRICS: RED metrics for services: Rate (requests/sec), Errors (failed requests/sec), Duration (latency distribution). USE metrics for resources: Utilization, Saturation, Errors. TRACING: Distributed tracing for requests crossing service boundaries. Include trace ID in all logs. Instrument database queries, external API calls, and async operations. ALERTING: Symptom-based alerting (user-visible problems) NOT cause-based (disk full). Alert on SLIs/SLOs. Runbook for every alert. ON-CALL: Clear escalation path. Documented runbooks for common issues. Dashboard for every service.",
    tags: ["checklist", "observability", "monitoring", "logging", "tracing", "reference"],
    decisions: ["RED/USE metrics", "Structured JSON logging", "Distributed tracing", "Symptom-based alerting"]
  },

  // ── P3 Procedural Checklists ──
  {
    goal: "Checklist: How to add a new agentic_ tool",
    summary: "STEP 1: Create source file in src/core/ or src/agents/ or src/memory/. STEP 2: Add import in src/index.ts at top. STEP 3: Add tool definition in the `tools` object inside AgenticEngine function — include name, description, schema, execute handler. STEP 4: Add new tool name to the expected list in test/run.mjs (EXPECTED_TOOLS array). STEP 5: Also add to test/dropin.mjs and test/load-samedir.mjs expected tool lists. STEP 6: Add ≥2 test cases — Part A core tests in test/_runall.mjs, specialized tests in test/_b_*.mjs. STEP 7: Run `npm run build` — must pass with zero errors. STEP 8: Run `node test/run.mjs` (orchestrator runs all) — all tests must pass. STEP 9: Run `node test/realtest.mjs` — 166+ tests must pass. STEP 10: Commit with descriptive message.",
    tags: ["checklist", "procedure", "new-tool", "howto", "step-by-step"],
    decisions: ["Register in src/index.ts tools object", "Update 3 test files", "2+ test cases required", "Build + test before commit"]
  },
  {
    goal: "Checklist: How to update OpenCode plugin tests",
    summary: "STEP 1: Tests live in test/_runall.mjs (core), test/_b_*.mjs (specialized), and test/run.mjs (orchestrator). STEP 2: Find the section for the tool/feature being tested (sections are numbered [1], [2], etc.). STEP 3: Add new assert() calls — use the pattern: assert(condition, 'descriptive message'). STEP 4: If testing a new export, add it to the destructured import at the top of the test file. STEP 5: Run `npm run build` first — tests import from dist/. STEP 6: Run `node test/run.mjs` — check that new tests appear in output. STEP 7: Run `node test/realtest.mjs` — must still pass (166+ tests). STEP 8: If the new feature adds a tool, also update expected tool count in test/dropin.mjs and test/load-samedir.mjs.",
    tags: ["checklist", "procedure", "testing", "howto", "step-by-step"],
    decisions: ["Tests split: _runall.mjs (core), _b_*.mjs (specialized), run.mjs (orchestrator)", "Custom assert() not Jest", "Build before test", "Check realtest.mjs too"]
  },
  {
    goal: "Checklist: How to verify prompt injection changes",
    summary: "STEP 1: Read src/core/prompt-builder.ts and src/core/prompt-template.ts to understand current prompt structure. STEP 2: Check the system.transform hook in src/index.ts — this is where RAG results and knowledge context are injected. STEP 3: Make changes to prompt sections. STEP 4: Run `npm run build`. STEP 5: Run `node test/realtest.mjs` — it validates prompt content (tool count, section presence). STEP 6: Search test/realtest.mjs for 'system.transform' or 'prompt' tests to see what's checked. STEP 7: Manually inspect generated prompt by setting DEBUG_AGENTIC=1 and running a tool. STEP 8: Verify knowledge-context XML tags are present and properly escaped.",
    tags: ["checklist", "procedure", "prompt", "injection", "howto", "step-by-step"],
    decisions: ["Prompt built in prompt-builder.ts", "Injected via system.transform hook", "realtest.mjs validates prompt", "Check XML tag escaping"]
  },
  {
    goal: "Checklist: How to recover TypeScript build failures",
    summary: "STEP 1: Run `npm run build` and read the FULL error output. STEP 2: Identify error type — TS6133 (unused import/var), TS2345 (type mismatch), TS2304 (undeclared name), TS2322 (type assignment). STEP 3: For TS6133 — remove the unused import/variable. STEP 4: For TS2345/TS2322 — check the expected type and fix the argument or assignment. STEP 5: For TS2304 — add the missing import or declaration. STEP 6: After fix, run `npm run build` again — must be zero errors. STEP 7: Run `node test/run.mjs` to ensure no regressions. STEP 8: Common pitfall: ESM requires .js extension in imports even for .ts files (e.g., import from './foo.js' not './foo.ts').",
    tags: ["checklist", "procedure", "build", "typescript", "error-recovery", "step-by-step"],
    decisions: ["Read full error output", "Fix by error code", "ESM requires .js extensions", "Build + test after every fix"]
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
      significance: "routine",
    })
    count++
  }

  if (process.env.DEBUG_AGENTIC) {
    log.debug(`Seeded ${count} entries into RAG`)
  }
}
