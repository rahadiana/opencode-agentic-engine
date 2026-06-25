import type { Plugin, PluginModule } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, cpSync, rmSync, mkdtempSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { homedir, tmpdir } from "node:os"
import { DomainRegistry, type DomainPack } from "./core/domain-registry.js"
import { genericDomain } from "./core/domains/generic.js"
import { codeDomain } from "./core/domains/code.js"
import { securityDomain } from "./core/domains/security.js"
import { devopsDomain } from "./core/domains/devops.js"
import { dataScienceDomain } from "./core/domains/data-science.js"
import { mobileDomain } from "./core/domains/mobile.js"
import { IntentParser, type TaskIntent } from "./core/intent-parser.js"
import { Executor } from "./core/executor.js"
import { Verifier } from "./core/verifier.js"
import { ErrorAnalyzer } from "./core/error-analyzer.js"
import { Planner } from "./core/planner.js"
import { PlannerCritic } from "./core/planner-critic.js"
import { CodebaseNavigator } from "./core/navigator.js"
import { DependencyTracker } from "./drift/dependency-tracker.js"
import { ContextCompressor } from "./drift/context-compressor.js"
import { GitIntegration } from "./core/git.js"
import { TechDebtScorer } from "./core/tech-debt-scorer.js"
import { AgentCoordinator } from "./agents/coordinator.js"
import { AgentRuntime } from "./agents/agent-runtime.js"
import type { AgentRole, AgentTask } from "./agents/coordinator.js"
import { Orchestrator, type WorkflowPipeline } from "./agents/orchestrator.js"
import { SkillStore } from "./memory/skill-store.js"
import { EpisodicStore } from "./memory/episodic-store.js"
import { MemoryOrchestrator } from "./memory/memory-orchestrator.js"
import { ConsolidationScheduler } from "./memory/consolidation-scheduler.js"
import { HallucinationGuard, type ClaimResult, type HallucinationCheck } from "./drift/hallucination-guard.js"
import { ParallelExecutor } from "./core/parallel.js"
import { Dashboard } from "./observability/dashboard.js"
import { CheckpointSystem } from "./drift/checkpoints.js"
import { SessionStore } from "./memory/session-store.js"
import { TraceLogger } from "./observability/trace-logger.js"
import { RoleRegistry, type PromptEntry } from "./agents/role-registry.js"

import { MemorySchemaVersion, createMemoryEnvelope } from "./memory/schema-version.js"
import { createSkillDefinition, inspectSkill, serializeSkill } from "./memory/skill-format.js"
import { detectTaskType } from "./core/task-classifier.js"
import { skillsToTrainingData, trainingDatasetSummary, skillToTrainingExample } from "./memory/skill-training.js"
import { SelfEvolver } from "./evolution/self-evolver.js"
import { ContinuousEvolution } from "./evolution/continuous-evolution.js"
import { LLMEngine } from "./core/llm.js"
import { AgentLoop } from "./core/agent-loop.js"
import { PersistenceLayer } from "./memory/persistence.js"
import { SQLitePersistence } from "./memory/sqlite-persistence.js"
import { ModelRegistry } from "./core/model-registry.js"
import { ConfigLoader } from "./core/config.js"
import { BudgetTracker } from "./core/budget-tracker.js"
import { AutoRetryManager } from "./core/auto-retry.js"
import { EventBus } from "./core/event-bus.js"
import { PatternDiscovery } from "./drift/pattern-discovery.js"
import { LiveEvaluator } from "./evaluation/live-evaluator.js"
import { DebateLoop } from "./core/debate-loop.js"
import { RouterAgent } from "./core/router-agent.js"
import { DataCleaner } from "./core/data-cleaner.js"
import { MultiIndexRAG } from "./memory/multi-index-rag.js"
import { MCPClient } from "./core/mcp-client.js"
import { buildAgenticSystemInstructions, type ToolEntry } from "./core/prompt-builder.js"
import { type KnowledgeEntry } from "./core/prompt-template.js"
import { ToolRouter } from "./core/tool-router.js"
import { ConfidenceScorer, ConfidenceStore, type ConfidenceScore } from "./core/confidence-scorer.js"
import { codeIntentAnalyzer } from "./core/code-intent-analyzer.js"
import { SchemaValidator } from "./core/skill-schema.js"
import { DslExecutor } from "./core/dsl-executor.js"
import { SkillImprover } from "./core/skill-improver.js"
import { AttentionScheduler } from "./core/attention-scheduler.js"
void AttentionScheduler // available via import for direct usage
import { WorldModel } from "./core/world-model.js"
import { SimulationEngine, type SimulatedStep } from "./core/simulation-engine.js"
import { MetaReasoner } from "./core/meta-reasoner.js"
import { BlueprintParser, BlueprintResolver, type ModelSpecMap } from "./core/agent-blueprint.js"
import { ConstraintManifold } from "./core/constraint-manifold.js"

// ── Build-time version injected by esbuild define ──
declare const __VERSION__: string

/**
 * Compare semver strings: returns true if latest > current
 */
function isNewerVersion(latest: string, current: string): boolean {
  const l = latest.split(".").map(Number)
  const c = current.split(".").map(Number)
  for (let i = 0; i < Math.max(l.length, c.length); i++) {
    if ((l[i] ?? 0) > (c[i] ?? 0)) return true
    if ((l[i] ?? 0) < (c[i] ?? 0)) return false
  }
  return false
}

/**
 * Auto-update: fire-and-forget. Fetch latest version from npm, download and
 * overwrite local plugin files if newer. User must restart OpenCode to apply.
 */
async function autoUpdatePlugin(currentVersion: string): Promise<void> {
  if (typeof __VERSION__ === "undefined") return
  try {
    const res = await fetch(
      "https://registry.npmjs.org/opencode-agentic-engine/latest",
      { signal: AbortSignal.timeout(5000) }
    )
    if (!res.ok) return
    const data = await res.json() as { version: string }
    const latest = data.version
    if (!isNewerVersion(latest, currentVersion)) return

    // Find own location: import.meta.url points to dist/index.js
    const ownFile = fileURLToPath(import.meta.url)
    const distDir = dirname(ownFile)
    const pluginDir = dirname(distDir)

    // Temp dir for npm pack
    const tmpDir = mkdtempSync(join(tmpdir(), "opencode-agentic-engine-"))
    try {
      execFileSync("npm", ["pack", "opencode-agentic-engine@latest"], {
        cwd: tmpDir,
        stdio: "pipe",
        timeout: 30000,
      })

      // Find tarball
      const tarball = readdirSync(tmpDir).find(f => f.endsWith(".tgz"))
      if (!tarball) return

      // Extract
      execFileSync("tar", ["-xzf", tarball], {
        cwd: tmpDir,
        stdio: "pipe",
        timeout: 10000,
      })

      // Overwrite plugin files
      const extractDir = join(tmpDir, "package")
      if (existsSync(extractDir)) {
        cpSync(extractDir, pluginDir, { recursive: true, force: true })
      }

      // Notify user (console — not visible in OpenCode chat, but shows in process stderr)
      process.stderr.write(
        `\n[AgenticEngine] ✅ Auto-updated v${currentVersion} → v${latest}. Restart OpenCode to apply.\n`
      )
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  } catch {
    // Silent fail — never block plugin startup
  }
}

const createEngine: Plugin = async (input, _options) => {
  // ── Normalize worktree: jangan sampai "/" (root) karena akan crash ──
  // Pakai input.directory dulu (paling akurat), fallback ke worktree, lalu HOME
  const rawWorktree = input.directory || input.worktree || process.env.HOME || process.cwd()

  // Safety: list of system/OS directories that should never be used as worktree
  const systemDirs = ["/", "/home", "/lib", "/usr", "/var", "/etc", "/boot", "/sys", "/proc", "/dev", "/run", "/tmp"]

  // Normalize: reject system directories, prefer input.directory, validate it's a project
  let worktree = rawWorktree
  if (systemDirs.includes(worktree) || systemDirs.some(s => worktree.startsWith(s + "/") && worktree.split("/").length <= 2)) {
    // System directory detected — try input.directory first, then fallback
    worktree = input.directory || process.env.HOME || process.cwd()
  }

  // If still looks like a system dir and we have input.directory, use it
  if (systemDirs.includes(worktree) && input.directory && !systemDirs.includes(input.directory)) {
    worktree = input.directory
  }

  // ── Config (load first, everything else depends on it) ──
  const configLoader = new ConfigLoader(worktree)
  const config = configLoader.load()
  configLoader.startWatch()

  // ── Project identity (for scoped memory isolation) ──
  // Derive projectId from worktree path basename or input.project.name.
  // Used to isolate episodes/evolution/evaluation per-project while keeping
  // skills/models/prompts shared globally.
  const projectId = ((): string => {
    // Prefer explicit project name from input
    if (input.project && "name" in input.project) return (input.project as { name: string }).name
    // Fallback to worktree dirname, sanitised
    const name = worktree.split("/").filter(Boolean).pop() || "unknown"
    return name.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 64)
  })()

  // ── Tool registry (shared between prompt builder and tool definitions) ──
  // Each description follows the MCP 6-component rubric from arXiv:2602.14878:
  // Purpose + Guidelines + Limitations + Parameter Explanation + Length + Examples
  const TOOL_REGISTRY: ToolEntry[] = [
    { name: "agentic_plan", description: "Break a goal into subtasks. Use when starting any multi-step task. Avoid on single-step tasks — just execute directly. Key: `goal` (what to accomplish), `autoDecompose` (auto-breakdown). Example: plan `goal=\"add auth\"` → 4 steps." },
    { name: "agentic_execute", description: "Mark a step complete with auto-verify. Use after finishing each subtask. Avoid claiming success when verification failed. Key: `stepId` (from plan), `filesModified` (for dependency tracking). Example: execute `stepId=\"step-1\" success=true`." },
    { name: "agentic_reflect", description: "Analyze a failed step: error category + propagation trace. Use when execute returned failed or compile error. Avoid on success steps. Key: `stepId` (the failed step), `errorDetails` (stack trace). Example: reflect `stepId=\"step-1\"`." },
    { name: "agentic_verify", description: "Run compile + lint + test suite. Use before final commit or after major changes. Avoid per-file — use execute's auto-verify for incremental checks. Key: `projectDir` (defaults to worktree). Example: verify `stepId=\"final\"`." },
    { name: "agentic_status", description: "Show execution progress, blocked steps, file changes, model reliability. Use to check what's left or blocked. No args needed." },
    { name: "agentic_nav", description: "Scan codebase for relevant files by keyword. Use before implementing to understand structure. Avoid for file content — use `read` instead. Key: `query` (feature/module name), `showSummary` (full structure). Example: nav `query=\"auth\"`." },
    { name: "agentic_context", description: "Compress conversation when approaching token limits. Use to free context window. Key: `action` — \"view\" to check size, \"compress\" to compact." },
    { name: "agentic_snapshot", description: "Save/restore execution checkpoints. Use before risky refactoring. Key: `action` (save/list/restore), `label` (name). Example: snapshot `action=\"save\" label=\"before-auth-refactor\"`." },
    { name: "agentic_pr", description: "Generate PR description from plan + step results. Use when task is complete and verified. Avoid if no plan was created. Key: `action` — \"generate\" (default) or \"create\" (via gh CLI)." },
    { name: "agentic_score", description: "Analyze technical debt: coupling, complexity, patterns. Use after refactoring or before finalizing. Key: `files` (optional — defaults to all modified)." },
    { name: "agentic_model", description: "Configure which LLM model per agent role for the session. Use to switch models without config file changes. Key: `action` (set/get/list/clear), `role`, `model` name." },
    { name: "agentic_model_reset", description: "Reset model statistics to recover from degraded performance. Use when models become unreliable. Key: `action` (reset/reset-stale/reset-all), `model` name. Example: reset `model=\"gpt-4o\"`." },
    { name: "agentic_budget", description: "Set, view, or reset resource budget limits (tokens, steps, time, cost). Use to prevent runaway loops. Acts as circuit breaker for autonomous execution. Key: `action` (set/get/status/reset), `scope` (session/task). Example: budget `action=set maxSteps=10`." },
    { name: "agentic_delegate", description: "Assign work to architect/developer/QA/coordinator. Use for complex sub-tasks needing specialist context. Avoid for trivial edits. Key: `taskId`, `description`, `role`. Supports pipeline auto-advance." },
    { name: "agentic_pipeline", description: "Define and run multi-agent pipelines: PM → Architect → Developer → QA. Use for end-to-end feature development. Key: `action` (define/list/run/status/suggest), `stages`." },
    { name: "agentic_message", description: "Send messages between agent roles, request reviews, check inbox. Use in multi-agent workflows. Key: `action` (send/inbox/conversation/mark-read), `to`, `message`." },
    { name: "agentic_parallel", description: "Analyze dependencies and run ready steps concurrently. Use for independent sub-tasks. Avoid on sequential tasks. Key: `action` analyze or execute." },
    { name: "agentic_skill", description: "Extract, search, and reuse skills from successful task patterns. Use to learn from past work. Key: `action` (extract/find/list), `query` (for find)." },
    { name: "agentic_episodes", description: "Search past session outcomes across projects. Use before planning similar tasks. Key: `action` (search/recent/stats), `query` (keywords)." },
    { name: "agentic_dashboard", description: "View timeline, stats, anomaly detection, model reliability. Use for observability. No args needed. Combines trace + model + pattern data." },
    { name: "agentic_guard", description: "Re-check truthfulness of file/function/import claims. Auto-runs on execute — only call manually for re-audit. Key: `stepId` to re-check." },
    { name: "agentic_evolve", description: "Inspect system, register custom roles, export skills, manage prompts (Stage IV). Use for system administration. Key: `action` (inspect/register-role/evolve/read-prompt/edit-prompt)." },
    { name: "agentic_auto", description: "One-call autonomous loop: plan → execute → verify → retry. Use for simple, well-defined tasks. Avoid for complex multi-domain tasks — use pipeline instead. Key: `goal`, `thorough` (extra checks)." },
    { name: "agentic_debate", description: "Multi-turn executor ↔ critic debate for deep analysis. Use for complex analysis, data validation, or when uncertain. Avoid for simple fact lookup — use websearch instead. Key: `task`, `maxRounds` (max 5)." },
    { name: "agentic_router", description: "Classify user intent into categories and route to the right knowledge index. Use before searching memory to scope results. Lightweight — keyword+LLM hybrid." },
    { name: "agentic_clean", description: "Strip debate artifacts and reformat raw text to clean markdown/JSON. Use after debate or multi-step analysis. Key: `format` (markdown/json/text), `schema` (validation)." },
    { name: "agentic_rag", description: "Store, search, and retrieve knowledge across category-segregated indexes. Use with agentic_router for scoped search. Key: `action` (search/store/stats/categories), `query`." },
    { name: "agentic_mcp", description: "Connect to external servers (DB, APIs) via stdio/HTTP to call remote tools. Use when task needs real-world data (weather, DB, API). Key: `action` (connect/list/call/disconnect)." },
    { name: "agentic_a2a", description: "Agent-to-Agent protocol: discover remote agents, delegate tasks, start/stop A2A server. Google A2A standard for cross-framework interoperability. Key: `action` (serve/discover/delegate/list/ping/stats)." },
    { name: "agentic_finetune", description: "End-to-end pipeline: prepare training data from skills → upload to OpenAI → create/monitor jobs. Use to fine-tune models from agent experience. Key: `action` (prepare/save/upload/create-job/status)." },
    { name: "agentic_db", description: "SQLite database backend untuk persistence — query, save, load, stats. Lebih cepat dari file JSON. Support structured queries dengan WHERE, JOIN, GROUP BY." },
  ]

  // ── Sub-agent detection (dynamic via RoleRegistry + fallback signatures) ──
  // Sub-agents have limited tool sets and role-specific prompts. Injecting the
  // full agentic prompt would conflict (wrong tool count, wrong workflow).
  // Detection is dynamic: checks ALL registered roles (built-in + custom via
  // agentic_evolve) plus orchestrator pipeline-stage prompts.
  function detectSubAgentRole(systemText: string): { role: string; tools: string[] } | null {
    // 1) Check built-in roles
    for (const def of roleRegistry.getAllBuiltIn()) {
      if (def.prompt && systemText.includes(def.prompt.slice(0, 50))) {
        return { role: def.role, tools: def.tools ?? [] }
      }
    }
    // 2) Check custom roles (agentic_evolve register-role)
    for (const def of roleRegistry.getAllCustom()) {
      if (def.prompt && systemText.includes(def.prompt.slice(0, 50))) {
        return { role: def.role, tools: def.tools ?? [] }
      }
    }
    // 3) Fallback: orchestrator pipeline-stage hardcoded prompts
    const pipelineSigs: Array<{ sig: string; role: string; tools: string[] }> = [
      { sig: "You are a PM. Define requirements", role: "pm", tools: ["agentic_plan", "agentic_nav", "agentic_delegate", "agentic_episodes", "read"] },
      { sig: "You are an architect. Design architecture", role: "architect", tools: ["read", "grep", "glob", "agentic_nav", "agentic_score", "agentic_delegate", "agentic_skill"] },
      { sig: "Return JSON array of {path, content}", role: "developer", tools: ["read", "edit", "write", "bash", "glob", "grep", "agentic_skill"] },
      { sig: "You are QA. Review the implementation", role: "qa", tools: ["read", "glob", "grep", "bash", "agentic_verify", "agentic_skill"] },
      { sig: "You are a coordinator. Verify pipeline", role: "coordinator", tools: ["read", "agentic_verify", "agentic_plan"] },
    ]
    for (const ps of pipelineSigs) {
      if (systemText.includes(ps.sig)) return { role: ps.role, tools: ps.tools }
    }
    // 4) Debate agents: pure text generation, no tools. Minimal injection.
    const debateSigs: Array<{ sig: string; role: string }> = [
      { sig: "You are an **executor agent**", role: "debate-executor" },
      { sig: "You are a **critic agent**", role: "debate-critic" },
      { sig: "You are a **data cleaner**", role: "debate-cleaner" },
    ]
    for (const ds of debateSigs) {
      if (systemText.includes(ds.sig)) return { role: ds.role, tools: [] }
    }
    return null
  }

  function buildSubAgentInjection(role: string, tools: string[]): string {
    const isDebateAgent = role.startsWith("debate-")
    if (isDebateAgent) {
      // Debate agents are pure text generation — they don't call tools.
      // Inject nothing — their prompts are fully self-contained.
      // Only add webfetch reminder since they might search for reference.
      return "Note: the web fetch tool is `webfetch` (not `websearch`)."
    }
    const toolList = tools.length > 0
      ? `Your available tools: ${tools.map(t => `\`${t}\``).join(", ")}`
      : "Use the tools provided by your role definition."
    return [
      `## ⚠️ Role: ${role}`,
      toolList,
      `- Web search: use \`webfetch\` (NOT \`websearch\`)`,
      `- All agentic tools use \`agentic_\` prefix — no bare names`,
      `- On failure: call \`agentic_reflect\` before retrying`,
    ].join("\n")
  }

  // ── Agent identity ──
  // Agent registration is done programmatically via the `config` hook
  // (see return hooks below), which sets config.mode.agentic (appears in
  // agent switcher) and config.agent.agentic (available as subagent).
  // ALL dynamic instructions (tools, CRITICAL RULES, domain context)
  // are injected per-LLM-call via `experimental.chat.system.transform` hook.
  // This avoids file I/O latency, stale prompts, and corrupt-agent errors.
  let currentInjectDomain: DomainPack = genericDomain

  // Write initial prompt (deferred — after persistence is available for smart cache)

  const intentParser = new IntentParser()
  const executor = new Executor()
  const budgetTracker = new BudgetTracker()
  executor.setBudgetTracker(budgetTracker)
  const verifier = new Verifier()
  const errorAnalyzer = new ErrorAnalyzer()
  const domainRegistry = new DomainRegistry()
  domainRegistry.register(genericDomain)
  domainRegistry.register(codeDomain)
  domainRegistry.register(securityDomain)
  domainRegistry.register(devopsDomain)
  domainRegistry.register(dataScienceDomain)
  domainRegistry.register(mobileDomain)
  domainRegistry.activate("generic")
  executor.setDomainRegistry(domainRegistry)
  errorAnalyzer.setDomainRegistry(domainRegistry)
  const planner = new Planner()
  // Register ALL domain decomposition rules upfront (tagged by domain)
  for (const pack of domainRegistry.getAll()) {
    if (pack.decompositionRules) {
      for (const rule of pack.decompositionRules) {
        planner.registerRule({ ...rule, domain: pack.name })
      }
    }
  }
  const navigator = new CodebaseNavigator()
  const depTracker = new DependencyTracker()
  // Build initial file-level dependency graph from project source
  try {
    const sourceDir = join(worktree, "src")
    if (existsSync(sourceDir)) {
      const scanBatch: Record<string, string> = {}
      const walkDir = (dir: string, depth = 0) => {
        if (depth > 10) return // Prevent infinite recursion from symlink loops
        try {
          for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name)
            if (entry.isDirectory() && !["node_modules", ".git", "dist", ".agentic"].includes(entry.name))
              walkDir(full, depth + 1)
            else if (entry.isFile() && /\.(ts|tsx|js|jsx|mjs)$/.test(entry.name) && Object.keys(scanBatch).length < 100)
              try { scanBatch[full] = readFileSync(full, "utf-8") } catch { /* non-fatal */ }
          }
        } catch { /* non-fatal */ }
      }
      walkDir(sourceDir)
      depTracker.scanFiles(scanBatch, worktree)
    }
  } catch { /* non-fatal */ }
  const contextCompressor = new ContextCompressor()
  const git = new GitIntegration(worktree)
  const debtScorer = new TechDebtScorer()
  const skillStore = new SkillStore()
  const coordinator = new AgentCoordinator(skillStore)
  const orchestrator = new Orchestrator()
  for (const pipeline of orchestrator.getBuiltInPipelines()) {
    orchestrator.definePipeline(pipeline)
  }
  const episodicStore = new EpisodicStore()
  const checkpoints = new CheckpointSystem()
  const hallucinationGuard = new HallucinationGuard(worktree)
  const parallelExec = new ParallelExecutor()
  const dashboard = new Dashboard()
  const sessionStore = new SessionStore()
  const worldModel = new WorldModel()
  const simulationEngine = new SimulationEngine()
  const memoryOrchestrator = new MemoryOrchestrator(sessionStore, episodicStore, skillStore, undefined, undefined, worldModel, simulationEngine)
  const consolidationScheduler = new ConsolidationScheduler(memoryOrchestrator, sessionStore)
  consolidationScheduler.start()
  const traceLogger = new TraceLogger(worktree)
  const roleRegistry = new RoleRegistry()
  const schemaVersion = new MemorySchemaVersion()
  const selfEvolver = new SelfEvolver()
  const continuousEvolution = new ContinuousEvolution()
  const patternDiscovery = new PatternDiscovery()
const liveEvaluator = new LiveEvaluator()
const modelRegistry = new ModelRegistry()
const eventBus = new EventBus()
const confidenceScorer = new ConfidenceScorer()
const confidenceStore = new ConfidenceStore()
  const llmEngine = new LLMEngine()
  llmEngine.setOpencodeClient(input.client)
    llmEngine.setModelRegistry(modelRegistry)
    llmEngine.setSessionStore(sessionStore)
    llmEngine.setBudgetTracker(budgetTracker)
    llmEngine.setEventBus(eventBus)
  orchestrator.setLLMEngine(llmEngine)
  errorAnalyzer.setLLM(llmEngine)
  verifier.setLLM(llmEngine)
  verifier.setDomainRegistry(domainRegistry)

  // PlannerCritic — self-reflection loop for plan quality (comp 13)
  const plannerCritic = new PlannerCritic(llmEngine)
  planner.setCritic(plannerCritic)

  // Wire up CodeIntentAnalyzer for Gap #3: program-analysis grounding
  codeIntentAnalyzer.setNavigator(navigator)
  codeIntentAnalyzer.setDependencyTracker(depTracker)
  codeIntentAnalyzer.setLLM(llmEngine)

  const agentRuntime = new AgentRuntime()
  agentRuntime.setOpencodeClient(input.client)
  agentRuntime.setModelRegistry(modelRegistry)

  // Discover models from OpenCode client + env vars
  ;(async () => {
    try {
      const client = input.client as { config?: { providers?: () => Promise<{ 200?: { providers: Array<{ name: string; id: string; models?: Record<string, unknown> }>; default?: Record<string, string> } }> }; models?: () => Promise<Array<{ id: string }>> }
      const allModels: string[] = []

      // 1. Try client.config.providers() — daftar provider + model dari OpenCode
      if (client?.config?.providers) {
        const provResp = await client.config.providers()
        const providers = provResp?.[200]?.providers ?? []
        const defaultMap = provResp?.[200]?.default ?? {}
        const defaultModelName = defaultMap[Object.keys(defaultMap)[0] ?? ""]?.split("/")?.pop() || ""
        if (defaultModelName) allModels.push(defaultModelName)
        for (const p of providers) {
          if (p.models) {
            for (const modelKey of Object.keys(p.models)) {
              const name = modelKey.includes("/") ? modelKey.split("/").pop()! : modelKey
              if (name && !allModels.includes(name)) allModels.push(name)
            }
          }
        }
      }

      // 2. Try client.models() — alternatif
      if (allModels.length === 0 && typeof client?.models === "function") {
        const models = await client.models()
        for (const m of models) {
          if (m.id && !allModels.includes(m.id)) allModels.push(m.id)
        }
      }

      // 3. Fallback: env vars
      const envModel = process.env.OPENAI_MODEL || process.env.LLM_MODEL || ""
      if (envModel && !allModels.includes(envModel)) allModels.push(envModel)

      // 4. Register semua model yang ditemukan
      const fastModel = process.env.FAST_MODEL || allModels[0] || ""
      const capableModel = process.env.CAPABLE_MODEL || allModels[0] || ""

      for (const m of allModels) modelRegistry.addModel(m)
      if (fastModel) modelRegistry.registerAlias("fast", [fastModel])
      if (capableModel && capableModel !== fastModel) modelRegistry.addModel(capableModel)
      if (capableModel) modelRegistry.registerAlias("capable", [capableModel])
    } catch {
      // Silent fallback — discovery gagal, pake env var
      const envModel = process.env.OPENAI_MODEL || process.env.LLM_MODEL || ""
      const fastModel = process.env.FAST_MODEL || envModel
      const capableModel = process.env.CAPABLE_MODEL || envModel
      if (fastModel) { modelRegistry.addModel(fastModel); modelRegistry.registerAlias("fast", [fastModel]) }
      if (capableModel && capableModel !== fastModel) modelRegistry.addModel(capableModel)
      if (capableModel) modelRegistry.registerAlias("capable", [capableModel])
    }
  })()

  // ── Load models.json cache for BlueprintResolver ──
  const blueprintParser = new BlueprintParser()
  const modelsDb: ModelSpecMap = new Map()
  const blueprintResolver = new BlueprintResolver(modelRegistry, modelsDb)
  // Fire-and-forget: load models.json from OpenCode cache
  ;(async () => {
    try {
      const modelsCachePath = join(homedir(), ".cache", "opencode", "models.json")
      if (existsSync(modelsCachePath)) {
        const raw = readFileSync(modelsCachePath, "utf-8")
        const parsed = JSON.parse(raw)
        for (const [, info] of Object.entries(parsed)) {
          const pInfo = info as { models?: Record<string, Record<string, unknown>> }
          if (pInfo.models) {
            for (const [modelKey, spec] of Object.entries(pInfo.models)) {
              modelsDb.set(modelKey, spec as import("./core/agent-blueprint.js").ModelSpec)
            }
          }
        }
        blueprintResolver.setModelsDb(modelsDb)
      }
    } catch {
      // Silent — models.json cache gak wajib ada
    }
  })()

  llmEngine.setMemoryStores({
    searchEpisodes: (query: string) => episodicStore.search(query),
    findSkills: (query: string) => skillStore.find(query).map(s => ({ name: s.definition.meta.name, successRate: s.successRate })),
  })
  new AgentLoop(llmEngine, { maxIterations: 10, autoRetry: true, maxRetries: 2, verifyAfterEach: false })
  const persistence = new PersistenceLayer(worktree)
  // SQLite backend — lebih cepat dari file JSON, support structured queries
  // Graceful fallback: jika better-sqlite3 (Node) atau bun:sqlite (Bun) gak available
  let sqliteDB: SQLitePersistence | null = null
  try {
    sqliteDB = new SQLitePersistence()
  } catch (e) {
    console.log("[Agentic] SQLite not available — agentic_db tool disabled:", (e as Error).message)
  }
  // Build RAG config from config file
  const ragConfig: import("./memory/multi-index-rag.js").RAGConfig = {
    keywordWeight: config.memory.search.keywordWeight,
    vectorWeight: config.memory.search.vectorWeight,
    embedding: config.embedding, // null = TF-IDF only
  }
  const multiIndexRAG = new MultiIndexRAG(undefined, ragConfig)

  // Load persisted RAG data from disk (global, unscoped — shared across all projects)
  const savedRAG = persistence.loadAll("rag")
  for (const item of savedRAG) {
    multiIndexRAG.importAll(item.data as import("./memory/multi-index-rag.js").IndexData)
  }
  // Auto-persist RAG every time data is stored (via indexEpisode/indexSkill)
  multiIndexRAG.setPersistCallback((data) => {
    persistence.save("rag", "global", data)
  })

  const debateLoop = new DebateLoop(llmEngine)
  const routerAgent = new RouterAgent(llmEngine)
  const dataCleaner = new DataCleaner(llmEngine)
  const mcpClient = new MCPClient()
  const toolRouter = new ToolRouter()
  toolRouter.setDescriptions(TOOL_REGISTRY)
  const recentToolCalls: string[] = []  // last 20 tool calls for routing context
  const diagnosticStore = new Map<string, { errors: number; lastOk: number; lastError: string }>()

  contextCompressor.setLLM(llmEngine)
  verifier.detectLanguage(worktree)

  // Restore persisted model stats
  const savedModels = persistence.loadAll<Record<string, import("./core/model-registry.js").ModelStats>>("models")
  for (const m of savedModels) {
    modelRegistry.fromJSON(m.data)
  }

  // Restore persisted evolution trend + evaluator score (scoped per project)
  const savedEvo = persistence.load<{ results: any[]; evolveCount: number; windowSize: number }>("evolution", "trend", projectId)
  if (savedEvo) continuousEvolution.fromJSON(savedEvo)
  const savedEval = persistence.load<Record<string, unknown>>("evaluation", "live", projectId)
  if (savedEval) liveEvaluator.fromJSON(savedEval)

  // Restore persisted episodes (scoped per project)
  const savedEpisodes = persistence.loadAll<{ planGoal: string; outcome: string; decisions: string[]; filesChanged: string[]; sessionId: string; timestamp: string; tags: string[]; projectId?: string }>("episodes", projectId)
  for (const ep of savedEpisodes) {
    episodicStore.record(ep.data.sessionId, ep.data.planGoal, ep.data.outcome as "success" | "partial" | "failed", ep.data.decisions, ep.data.filesChanged, undefined, projectId)
  }
  // Auto-save episodes when recorded (scoped per project)
  episodicStore.setPersistenceCallback((episode) => {
    persistence.save("episodes", episode.sessionId, episode, projectId)
  })
  const savedSkills = persistence.loadAll<import("./memory/skill-format.js").SkillDefinition>("skills") // global — shared across projects
  for (const sk of savedSkills) {
    skillStore.importFromEnvelope(JSON.stringify(createMemoryEnvelope(sk.data, "skill")))
  }

  // Seed RAG from persisted episodes + skills so it's not empty on fresh sessions
  multiIndexRAG.setBatchMode(true)  // suppress individual persist calls
  for (const ep of savedEpisodes) {
    const epData = ep.data as { planGoal: string; summary?: string; sessionId: string; outcome?: string; decisions?: string[]; filesChanged?: string[]; timestamp: string; tags?: string[]; projectId?: string }
    const cat = multiIndexRAG.autoCategory(epData.planGoal + " " + (epData.summary || ""))
    multiIndexRAG.indexEpisode(cat, {
      id: epData.sessionId,
      sessionId: epData.sessionId,
      planGoal: epData.planGoal,
      summary: epData.summary || "",
      outcome: (epData.outcome || "partial") as "success" | "partial" | "failed",
      decisions: epData.decisions || [],
      filesChanged: epData.filesChanged || [],
      timestamp: epData.timestamp,
      tags: epData.tags || [],
      projectId: epData.projectId,
      score: 0.5,
      usageCount: 0,
    })
  }
  for (const sk of savedSkills) {
    const skData = sk.data as { meta?: { name?: string }; definition?: { meta?: { name?: string }; trigger?: { pattern?: string } }; trigger?: { pattern?: string }; usageCount?: number; successRate?: number; successWindow?: boolean[]; lastUsed?: string; audit?: { lastUsed?: string } }
    const cat = multiIndexRAG.autoCategory(skData.meta?.name || skData.definition?.meta?.name || "" + " " + skData.trigger?.pattern || skData.definition?.trigger?.pattern || "")
    const skillRecord: import("./memory/skill-store.js").SkillRecord = {
      definition: (skData.definition || skData) as import("./memory/skill-format.js").SkillDefinition,
      usageCount: skData.usageCount ?? 0,
      successRate: skData.successRate ?? 0.5,
      successWindow: skData.successWindow ?? [],
      lastUsed: skData.lastUsed || skData.audit?.lastUsed || new Date().toISOString(),
    }
    multiIndexRAG.indexSkill(cat, skillRecord)
  }
  multiIndexRAG.flushPersist()  // persist once after all seeding

  // ── Bootstrap knowledge — seed RAG with plugin documentation (high confidence) ──
  const { bootstrapKnowledge } = await import("./core/bootstrap-knowledge.js")
  bootstrapKnowledge(multiIndexRAG, projectId)

  // ── SchemaValidator + DslExecutor (Phase 2) ──
  const schemaValidator = new SchemaValidator()
  const dslExecutor = new DslExecutor()
  dslExecutor.setMCPClient(mcpClient)
  // Wire skillResolver — lookup skill by capability via SkillStore
  dslExecutor.setSkillResolver((capability: string) => {
    const skillRecord = skillStore.findByCapability(capability)
    if (!skillRecord || !skillRecord.definition.logic?.instructions) return null
    return { instructions: skillRecord.definition.logic.instructions }
  })

  // ── SkillImprover (Comparison 01: Self-Improvement Loop) ──
  const skillImprover = new SkillImprover(skillStore, schemaValidator)
  void skillImprover // available via import for direct usage

  // ── MetaReasoner (Comparison 22: Meta-Reasoning Strategy) ──
  const metaReasoner = new MetaReasoner()

  // ── ConstraintManifold (Phase 4C: Safety by design) ──
  const constraintManifold = new ConstraintManifold()
  void constraintManifold // available via import for direct usage

  // Load cross-session knowledge artifact
  try {
    const knowledgePath = resolve(worktree, ".agentic", "knowledge.json")
    const knowledgeRaw = readFileSync(knowledgePath, "utf-8")
    const knowledge = JSON.parse(knowledgeRaw)
    if (knowledge?.sessions?.length > 0) {
      console.debug(`[init] Loaded ${knowledge.sessions.length} prior session(s) from knowledge.json`)
    }
    // Store in a global for tool access
    ;(globalThis as { __agenticKnowledge?: typeof knowledge }).__agenticKnowledge = knowledge
  } catch { /* knowledge.json may not exist yet — first session */ }

  // Restore persisted prompt states (Stage IV: versioned prompt history) — global
  const savedPrompts = persistence.loadAll<Array<{ role: string; history: PromptEntry[] }>>("prompts") // global
  if (savedPrompts.length > 0) {
    // Find the latest state and pass to RoleRegistry constructor
    const latest = savedPrompts.reduce((a, b) => {
      const aTime = new Date(a.updatedAt).getTime()
      const bTime = new Date(b.updatedAt).getTime()
      return aTime > bTime ? a : b
    })
    const promptData = latest.data
    for (const entry of promptData) {
      const state = roleRegistry.getPromptState(entry.role)
      if (state) {
        // Role already has initial history — skip
        continue
      }
      // Replay history into RoleRegistry (construct already set initial prompts)
      for (const hist of entry.history) {
        const currentPrompt = roleRegistry.getPrompt(entry.role)
        if (currentPrompt && hist.prompt !== currentPrompt) {
          roleRegistry.updatePrompt(entry.role as "architect" | "developer" | "qa" | "coordinator" | "pm", hist.prompt, hist.source, hist.description)
        }
      }
    }
  }

  try { await traceLogger.init() } catch { /* non-fatal: cannot create trace dir */ }

  // ── Auto-update: fire-and-forget version check + download ──
  autoUpdatePlugin(__VERSION__)

  // ── Config hot-reload propagation ──
  // Ketika config berubah di disk, module-module berikut di-update
  configLoader.onChange((newConfig) => {
    // 1. MultiIndexRAG: keywordWeight + vectorWeight are set at construction time.
    //    For hot-reload, log the change — weights take effect on next restart.
    //    (TF-IDF is stateless — no need to re-index)

    // 2. Agent delegation depth — propagate ke coordinator (akan dipakai untuk validasi depth)
    const maxDepth = newConfig.agent.maxDelegationDepth
    if (maxDepth > 0) {
      coordinator.setMaxDepth(maxDepth)
    }

    // 4. Session store TTL — propagate ke session store untuk expired session cleanup
    const forgetDays = newConfig.memory.forgetAfterDays
    if (forgetDays > 0) {
      sessionStore.setForgetAfterDays(forgetDays)
    }

    // 5. Trace retention — propagate ke trace logger untuk pruning
    const retentionDays = newConfig.storage.traceRetentionDays
    if (retentionDays > 0) {
      traceLogger.setRetentionDays(retentionDays)
    }
  })

  /** Helper: run the full self-evolution cycle and return a summary */
  async function runAutoEvolve(): Promise<string> {
    await traceLogger.flush()

    const allSkills = skillStore.getAll()
    const allEpisodes = episodicStore.getRecent(50)
    const uniqueSessions = new Set(allEpisodes.map(e => e.sessionId))

    let allTasks: AgentTask[] = []
    for (const sid of uniqueSessions) {
      allTasks = allTasks.concat(coordinator.getTasks(sid))
    }

    const allStepStates: Array<{ stepId: string; success: boolean; output: string }> = []
    for (const sid of uniqueSessions) {
      const session = sessionStore.getOrCreate(sid)
      const subtasks = session.plan?.intent.subtasks ?? []
      for (const step of subtasks) {
        const state = executor.getStepState(sid, step.id)
        if (state?.result) {
          allStepStates.push({
            stepId: step.id,
            success: state.result.success,
            output: state.result.output,
          })
        }
      }
    }

    const traces: Array<{ toolUsed: string; success: boolean; step: string }> = []
    const tracePath = `${worktree}/.agentic/trace.jsonl`
    try {
      const content = readFileSync(tracePath, "utf-8")
      for (const line of content.trim().split("\n").filter(Boolean)) {
        const parsed = JSON.parse(line)
        traces.push({
          toolUsed: parsed.toolUsed ?? "unknown",
          success: parsed.success ?? true,
          step: parsed.step ?? "",
        })
      }
    } catch { /* no traces yet */ }

    selfEvolver.feedSkills(allSkills)
    selfEvolver.feedEpisodes(allEpisodes)
    selfEvolver.feedTasks(allTasks)
    selfEvolver.feedStepStates(allStepStates)
    selfEvolver.feedTraces(traces)

    // Index trace entries ke TF-IDF vector store biar bisa di-search via agentic_rag tanpa bash
    try {
      const tracePath = `${worktree}/.agentic/trace.jsonl`
      const content = readFileSync(tracePath, "utf-8")
      const lines = content.trim().split("\n").filter(Boolean)
      // Ambil 200 baris terakhir aja (recent lebih relevan, hemat memory)
      const recentTraces = lines.slice(-200)
      for (const line of recentTraces) {
        try {
          const parsed = JSON.parse(line)
          const tool = parsed.toolUsed ?? "unknown"
          const input = parsed.input ?? ""
          const output = parsed.output ?? ""
          const step = parsed.step ?? ""
          multiIndexRAG.vectorStore.index({
            id: `trace:${parsed.timestamp ?? Date.now()}`,
            category: "general",
            title: `${tool}: ${String(input).slice(0, 80)}`,
            content: `${tool} ${step} ${String(output).slice(0, 200)} ${String(input).slice(0, 200)}`,
            keywords: [tool, step, ...String(input).toLowerCase().split(/\W+/).filter(Boolean).slice(0, 10)],
            metadata: { type: "trace", tool, success: parsed.success, timestamp: parsed.timestamp },
          })
        } catch { /* skip corrupted line */ }
      }
    } catch { /* no trace file yet */ }

    const report = selfEvolver.evolve()

    // Auto-apply role suggestions
    const appliedRoles: string[] = []
    for (const role of report.roleSuggestions) {
      try {
        coordinator.registerCustomRole({
          role: role.name,
          name: role.name,
          tools: role.suggestedTools,
          prompt: `You are ${role.name}. ${role.reason}\n\nTrigger: ${role.triggerPattern}`,
        })
        appliedRoles.push(role.name)
      } catch { /* non-fatal */ }
    }

    // Auto-apply skill patches
    const patchedSkills: string[] = []
    for (const patch of report.skillPatches) {
      const record = skillStore.getById(patch.skillId)
      if (!record) continue
      const def = record.definition
      let modified = false

      for (const change of patch.suggestedChanges) {
        if (change.type === "add_rollback") {
          for (const step of def.workflow.steps) {
            if (!step.rollback) {
              step.rollback = change.detail
              modified = true
            }
          }
        }
        if (change.type === "add_step") {
          const newStep: import("./memory/skill-format.js").SkillStep = {
            order: def.workflow.steps.length + 1,
            action: "verify",
            description: change.detail,
            expectedOutput: "Step completed successfully",
          }
          def.workflow.steps.push(newStep)
          modified = true
        }
      }

      if (modified) {
        def.quality.usageCount = record.usageCount
        def.quality.successRate = record.successRate
        def.audit.lastModified = new Date().toISOString()
        def.audit.modifiedBy = "system"
        def.meta.version++
        persistence.save("skills", def.meta.id, def)
        patchedSkills.push(patch.skillName)
      }
    }

    // Auto-apply prompt patches (Stage IV: versioned, source-tracked)
    const appliedPatches: string[] = []
    for (const patch of report.promptPatches) {
      try {
        const existingPrompt = roleRegistry.getPrompt(patch.role)
        if (existingPrompt && !existingPrompt.includes(patch.instruction.slice(0, 40))) {
          const newPrompt = existingPrompt + `\n\n## Auto-Patched Instruction (from ${patch.errorCategory} errors)\n${patch.instruction}`
          roleRegistry.updatePrompt(patch.role as "architect" | "developer" | "qa" | "coordinator" | "pm", newPrompt, "auto-evolve", `Patch from ${patch.errorCategory} errors (${patch.occurrences}x)`)
          persistence.save("prompts", "state", roleRegistry.getAllPromptStates())
          appliedPatches.push(`${patch.role}: "${patch.instruction.slice(0, 60)}..."`)
        }
      } catch { /* non-fatal */ }
    }

    let result = `### 🔮 Auto-Evolution Complete\n`
    result += `**Score:** ${report.improvementScore}/100\n`
    result += `**Sessions:** ${report.metrics.totalSessions} | **Steps:** ${report.metrics.totalSteps} | **Success Rate:** ${(report.metrics.successRate * 100).toFixed(0)}%\n`
    if (appliedRoles.length > 0) result += `**Roles Registered:** ${appliedRoles.join(", ")}\n`
    if (patchedSkills.length > 0) result += `**Skills Patched:** ${patchedSkills.join(", ")}\n`
    if (appliedPatches.length > 0) result += `**Prompts Patched:** ${appliedPatches.length}\n`
    if (appliedRoles.length === 0 && patchedSkills.length === 0 && appliedPatches.length === 0) {
      result += `No changes needed — system is healthy.\n`
    }
    return result.trim()
  }

  function ctxDir(context: { worktree: string; directory?: string }) {
    return context.directory || context.worktree
  }

  // ────────────────────────────────────────────────────────────────
  // G1: EventBus subscriber wiring
  // Semua subscriber didaftarkan di sini — event yang di-emit oleh
  // producer (Executor, LLMEngine, Pipeline, dll) akan otomatis
  // memicu reaksi consumer tanpa coupling langsung.
  // ────────────────────────────────────────────────────────────────

  // LiveEvaluator: track step outcomes untuk scoring real-time
  eventBus.on("step.completed", (ev: any) => {
    liveEvaluator.feedStepResult({ stepId: ev.payload.stepId, success: true, sessionId: ev.payload.sessionID })
    continuousEvolution.feedStepResult({
      stepId: ev.payload.stepId,
      success: true,
      output: ev.payload.output?.slice(0, 100) ?? "",
      sessionId: ev.payload.sessionID,
      timestamp: Date.now(),
    })
  })
  eventBus.on("step.failed", (ev: any) => {
    liveEvaluator.feedStepResult({ stepId: ev.payload.stepId, success: false, sessionId: ev.payload.sessionID })
    continuousEvolution.feedStepResult({
      stepId: ev.payload.stepId,
      success: false,
      output: ev.payload.error?.slice(0, 100) ?? "",
      sessionId: ev.payload.sessionID,
      timestamp: Date.now(),
      category: ev.payload.errorCategory,
    })
  })
  eventBus.on("task.delegated", (ev: any) => {
    liveEvaluator.feedDelegation(ev.payload.taskId, ev.payload.role, true)
  })
  eventBus.on("task.completed", (ev: any) => {
    liveEvaluator.feedDelegation(ev.payload.taskId, ev.payload.role, ev.payload.success)
  })

  // TraceLogger: log semua event ke file JSONL (wildcard)
  eventBus.onAny((ev: any) => {
    traceLogger.log({
      step: ev.type,
      input: JSON.stringify(ev.payload ?? {}).slice(0, 200),
      output: "",
      toolUsed: ev.type?.split(".")[0] ?? "event",
      success: !ev.type?.includes("failed") && !ev.type?.includes("exceeded"),
      durationMs: 0,
      metadata: { eventType: ev.type },
    })
  })

  // Orchestrator: auto-advance pipeline saat stage selesai
  eventBus.on("pipeline.stage.completed", (ev: any) => {
    orchestrator.advanceStage(ev.payload.runId, ev.payload.output, ev.payload.issues)
  })

  // ModelRegistry: catat hallucination guard failures
  eventBus.on("guard.check.completed", (ev: any) => {
    if (!ev.payload.passed) {
      modelRegistry.recordHallucination(ev.payload.sessionID)
    }
  })

  return {
    tool: {
      agentic_plan: tool({
        description: "Create a structured execution plan. Can auto-decompose feature requests using built-in templates (create/implement, fix/bug, refactor, test, deploy, migrate, doc, perf). Use `llmDecompose: true` for AI-powered decomposition. Call this FIRST for any multi-step task.",
        args: {
          goal: tool.schema.string().describe("The overall goal of the task"),
          constraints: tool.schema.array(tool.schema.string()).optional().describe("Constraints or requirements"),
          relevantFiles: tool.schema.array(tool.schema.string()).optional().describe("Files relevant to this task"),
          autoDecompose: tool.schema.boolean().optional().describe("Auto-decompose the goal into subtasks (default: true). Uses LLM first, falls back to built-in templates."),
          llmDecompose: tool.schema.boolean().optional().describe("Use LLM for smarter task decomposition (default: true, falls back to templates if LLM unavailable)"),
          criticRefine: tool.schema.boolean().optional().describe("Use PlannerCritic self-reflection loop: generate multiple candidates, evaluate, refine (default: false). Only effective when llmDecompose is true."),
          subtasks: tool.schema.array(tool.schema.object({
            id: tool.schema.string().describe("Unique identifier for this subtask"),
            description: tool.schema.string().describe("What this subtask should accomplish"),
            dependsOn: tool.schema.array(tool.schema.string()).optional().describe("IDs of subtasks that must be completed first"),
            verificationCriteria: tool.schema.array(tool.schema.string()).optional().describe("How to verify this subtask succeeded"),
          })).optional().describe("Manual subtask list. If omitted and autoDecompose is enabled, the planner will auto-generate steps."),
        },
        async execute(args, context) {
          llmEngine.setSessionId(context.sessionID)
          llmEngine.setToolContext('agentic_plan')
          let subtasks = args.subtasks ?? []

          if (subtasks.length === 0 && args.autoDecompose !== false) {
            // Episodic Plan Reuse: check for similar past successful plans first
            const reuseEpisodes = episodicStore.searchForReuse(args.goal)
            if (reuseEpisodes.length > 0) {
              const best = reuseEpisodes[0]
              episodicStore.incrementUsage(best.id)
              const adapted = episodicStore.adaptPlan(best, args.goal)
              if (adapted && adapted.length > 0) {
                subtasks = adapted.map((desc, i) => ({
                  id: `reuse-${i + 1}`,
                  description: desc,
                  dependsOn: i > 0 ? [`reuse-${i}`] : [],
                  verificationCriteria: [],
                }))
              }
            }

            // Fast path: template-based decomposition (no LLM) — only if reuse didn't produce steps
            if (subtasks.length === 0) {
            const activeDomain = domainRegistry.getCurrentDomain() ?? undefined
            const decomposition = planner.decompose(args.goal, args.relevantFiles ?? [], activeDomain)
            if (decomposition.autoGenerated) {
              subtasks = decomposition.intent.subtasks
            }

            // Optional: LLM decomposition (only if explicitly requested)
            if (subtasks.length === 0 && args.llmDecompose === true) {
              const scanDir = context.directory || context.worktree || worktree
              try {
                await navigator.scan(scanDir)
              } catch { /* non-fatal */ }
              const codebaseSummary = navigator.getSummary()
              try {
                const llmIntent = await planner.decomposeWithLLM(llmEngine, args.goal, codebaseSummary)
                subtasks = llmIntent.subtasks
              } catch {
                // Fall through to template-based
              }
            }
          }
          }

          // PlannerCritic self-reflection refinement (optional)
          if (args.criticRefine === true && subtasks.length > 0 && planner.hasCritic()) {
            try {
              const scanDir = context.directory || context.worktree || worktree
              let codebaseSummary = ""
              try { await navigator.scan(scanDir); codebaseSummary = navigator.getSummary() } catch { /* non-fatal */ }
              const criticResult = await planner.decomposeWithCritic(args.goal, codebaseSummary)
              if (criticResult.accepted && criticResult.plan.subtasks.length > 0) {
                subtasks = criticResult.plan.subtasks.map(s => ({
                  id: s.id,
                  description: s.description,
                  dependsOn: s.dependsOn ?? [],
                  verificationCriteria: s.verificationCriteria ?? [],
                }))
              }
            } catch { /* non-fatal — fall through to existing plan */ }
          }

          const intent: TaskIntent = {
            goal: args.goal,
            constraints: args.constraints ?? [],
            context: {
              relevantFiles: args.relevantFiles ?? [],
              dependencies: [],
            },
            subtasks: subtasks.map(s => ({
              id: s.id,
              description: s.description,
              dependsOn: s.dependsOn ?? [],
              verificationCriteria: s.verificationCriteria ?? [],
            })),
          }

          const plan = intentParser.createPlan(intent)
          const errors = intentParser.validatePlan(plan)

          executor.initExecution(context.sessionID, plan)
          sessionStore.getOrCreate(context.sessionID).plan = plan

          // Wire up dependency tracking from plan — step-level
          for (const step of subtasks) {
            for (const dep of (step.dependsOn ?? [])) {
              depTracker.addDependency(step.id, dep, "imports")
            }
          }

          // Wire file-level dependencies from navigator scan
          if (args.relevantFiles && args.relevantFiles.length > 0) {
            for (const file of args.relevantFiles) {
              depTracker.addDependency(`file:${file}`, `goal:${args.goal.slice(0, 40)}`, "type-ref")
            }
          }

          // Gap #3: Intent Inference via Program Analysis — ground the plan with function-level intent
          let codeIntentMap = null
          const projectDir = ctxDir(context)
          try {
            codeIntentMap = await codeIntentAnalyzer.analyze(args.goal, projectDir)
            if (codeIntentMap && codeIntentMap.files.length > 0) {
              sessionStore.getOrCreate(context.sessionID).codeIntentMap = codeIntentMap
              // Inject relevant files from intent analysis if none provided
              if (!args.relevantFiles || args.relevantFiles.length === 0) {
                plan.intent.context.relevantFiles = codeIntentMap.files.map(f => f.relativePath)
              }
            }
          } catch {
            // Non-fatal — plan works without intent analysis
          }

          traceLogger.log({
            step: "plan",
            input: args.goal,
            output: JSON.stringify(plan),
            toolUsed: "agentic_plan",
            success: errors.length === 0,
            durationMs: 0,
            metadata: { errors, complexity: plan.complexity, autoDecomposed: (!args.subtasks || args.subtasks.length === 0) && subtasks.length > 0, llmDecomposed: !!args.llmDecompose },
          })

          if (errors.length > 0) {
            return {
              output: `## Plan Created (with warnings)\n\n${errors.map(e => `⚠️  ${e}`).join("\n")}\n\n<details>\n<summary>Plan JSON</summary>\n\n\`\`\`json\n${JSON.stringify(plan, null, 2)}\n\`\`\`\n</details>`,
              metadata: { hasErrors: true, plan },
            }
          }

          const stepList = plan.intent.subtasks.map((s, i) =>
            `${i + 1}. **${s.id}** — ${s.description}${s.dependsOn.length ? ` (requires: ${s.dependsOn.join(", ")})` : ""}`
          ).join("\n")

          const autoTag = (!args.subtasks || args.subtasks.length === 0) && subtasks.length > 0 ? " (auto-decomposed)" : ""

          let planOutput = `## Plan Created${autoTag}\n\n**Goal:** ${plan.intent.goal}\n**Complexity:** ${plan.complexity}\n**Steps:** ${plan.estimatedSteps}\n\n### Steps\n${stepList}\n\nStart with \`agentic_execute\` for the first ready step.`

          const suggestedPipelineId = orchestrator.getSuggestedPipeline(args.goal)
          const suggestedPipelineObj = orchestrator.getPipeline(suggestedPipelineId)
          if (suggestedPipelineObj && suggestedPipelineObj.stages.length > 0) {
            const stageList = suggestedPipelineObj.stages.map(s => `\`${s.role}\``).join(" → ")
            planOutput += `\n\n### 💡 Suggested Pipeline\nThis goal matches the **${suggestedPipelineObj.name}** pipeline (${stageList}). Run \`agentic_pipeline action="run" pipelineId="${suggestedPipelineId}"\` to delegate to specialized agents.`
          }

          if (codeIntentMap && codeIntentMap.files.length > 0) {
            const totalFuncs = codeIntentMap.files.reduce((s, f) => s + f.functions.length, 0)
            planOutput += `\n\n### 🔍 Code Intent Analysis\n**Files analyzed:** ${codeIntentMap.files.length}  \n**Functions extracted:** ${totalFuncs}  \n**Language:** ${codeIntentMap.primaryLanguage ?? "unknown"}\n\n`
            const topFiles = codeIntentMap.files.slice(0, 3)
            for (const file of topFiles) {
              const intentTags = file.functions.slice(0, 4).map(fn => `\`${fn.functionName}\``).join(", ")
              planOutput += `- **${file.relativePath}** (${file.complexity}) — ${file.summary}`
              if (intentTags) planOutput += ` → ${intentTags}`
              planOutput += "\n"
            }
            if (codeIntentMap.files.length > 3) {
              planOutput += `  ... and ${codeIntentMap.files.length - 3} more files\n`
            }
            planOutput += `\n*Intent analysis provides program-aware grounding for implementation. Use this context with \`agentic_execute\` for better code generation.*`
          }

          // Simulation dry-run (Comparison 20: Internal Simulation)
          if (plan.intent.subtasks.length > 0) {
            try {
              const simulatedSteps: SimulatedStep[] = plan.intent.subtasks.map(s => ({
                stepId: s.id,
                description: s.description,
                complexity: Math.min(10, Math.max(1, Math.ceil(s.description.length / 50))),
                predictedSuccess: 0.7,
                estimatedTokens: 2000,
                dependsOn: s.dependsOn ?? [],
              }))
              const simResult = simulationEngine.simulate({
                planId: `plan_${Date.now()}`,
                steps: simulatedSteps,
                goal: args.goal,
              })
              if (simResult.warnings.length > 0 || !simResult.recommended) {
                planOutput += `\n\n### 🎯 Simulation Preview\n`
                planOutput += `**Score:** ${(simResult.score * 100).toFixed(0)}% | **Recommended:** ${simResult.recommended ? '✅ Yes' : '❌ No'}\n`
                planOutput += `**Overall success rate:** ${(simResult.overallSuccessRate * 100).toFixed(0)}%\n`
                if (simResult.warnings.length > 0) {
                  planOutput += `**Warnings:**\n`
                  for (const w of simResult.warnings) {
                    planOutput += `- ⚠️ ${w}\n`
                  }
                }
              }
            } catch {
              // Non-fatal — simulation is advisory
            }
          }

          return {
            output: planOutput,
            metadata: { plan },
          }
        },
      }),

      agentic_nav: tool({
        description: "Scan the project codebase and find relevant files for a task. Use this to understand the project structure before planning, or to find which files to modify.",
        args: {
          query: tool.schema.string().describe("What you're looking for — a task description, module name, or feature keyword"),
          maxResults: tool.schema.number().optional().describe("Maximum number of files to return (default: 10)"),
          showSummary: tool.schema.boolean().optional().describe("Show full project structure summary"),
        },
        async execute(args, context) {
          const maxResults = args.maxResults ?? 10
          const scanDir = context.directory || context.worktree || worktree
          await navigator.scan(scanDir)
          const files = navigator.findRelevantFiles(args.query, maxResults)

          // Index files into TF-IDF vector store for future search
          for (const file of files) {
            multiIndexRAG.vectorStore.index({
              id: `file:${file}`,
              category: "general",
              title: file,
              content: `File ${file}`,
              keywords: file.split(/[/\\]/).pop()?.split(".") ?? [],
              metadata: { type: "file", path: file },
            })
          }

          let output = `## 🔍 Codebase Navigator\n\n**Query:** ${args.query}\n\n`

          if (args.showSummary) {
            output += navigator.getSummary() + "\n\n"
          }

          if (files.length === 0) {
            output += "No matching files found. Try a different query, or use `showSummary: true` to see the project structure."
          } else {
            output += `### Matching Files (${files.length})\n`
            output += files.map(f => `- \`${f}\``).join("\n")

            const testFiles = files.flatMap(f => navigator.getTestFiles(f))
            if (testFiles.length > 0) {
              output += `\n\n### Related Test Files\n`
              output += testFiles.map(f => `- \`${f}\``).join("\n")
            }
          }

          traceLogger.log({
            step: "nav",
            input: args.query,
            output: `${files.length} files found`,
            toolUsed: "agentic_nav",
            success: true,
            durationMs: 0,
          })

          return { output, metadata: { files, projectSummary: args.showSummary ? navigator.getSummary() : undefined } }
        },
      }),

      agentic_execute: tool({
        description: "Record completion of a subtask. Auto-verifies compilation on success. Includes error recovery guidance + error propagation analysis on failure. Supports user feedback for continuous learning.",
        args: {
          stepId: tool.schema.string().describe("The ID of the step that was executed (leaf in ID chain: sessionID ⊃ pipelineRunId ⊃ taskId ⊃ stepId)"),
          success: tool.schema.boolean().describe("Whether the step completed successfully"),
          output: tool.schema.string().describe("Summary of what was done — what files changed, what was implemented"),
          filesModified: tool.schema.array(tool.schema.string()).optional().describe("List of files that were modified or created in this step"),
          error: tool.schema.string().optional().describe("Error message if the step failed"),
          autoVerify: tool.schema.boolean().optional().describe("Auto-run compile verification (default: true when success=true)"),
          feedback: tool.schema.enum(["positive", "negative"]).optional().describe("User feedback on the result. Positive boosts skill confidence; negative triggers adaptation (Gap #9: continuous learning from feedback)"),
        },
        async execute(args, context) {
          llmEngine.setSessionId(context.sessionID)
          llmEngine.setToolContext('agentic_execute')
          const startTime = Date.now()
          const projectDir = ctxDir(context)

          const domainPack = domainRegistry.activateFor(args.output)
          if (domainPack) {
            const prevDomain = sessionStore.getOrCreate(context.sessionID).currentDomain
            sessionStore.getOrCreate(context.sessionID).currentDomain = domainPack.name
            if (domainPack.name !== prevDomain) {
              currentInjectDomain = domainPack
            }
          }
          
          const taskType = detectTaskType(args.output)
          
          const session = sessionStore.getOrCreate(context.sessionID)
          session.currentTaskType = taskType

          if (args.filesModified && args.filesModified.length > 0) {
            depTracker.recordChange(context.sessionID, args.stepId, args.filesModified)
            // Update file-level dependency graph for modified/created files
            for (const f of args.filesModified) {
              const absPath = join(projectDir, f)
              try {
                const content = readFileSync(absPath, "utf-8")
                depTracker.updateFile(absPath, content, projectDir)
              } catch { /* non-fatal: file may have been deleted */ }
            }
          }

          executor.recordResult(context.sessionID, {
            stepId: args.stepId,
            success: args.success,
            output: args.output,
            filesModified: args.filesModified ?? [],
            error: args.error,
          })

          sessionStore.addTurn(context.sessionID, {
            role: "tool",
            content: `Step ${args.stepId}: ${args.success ? "SUCCESS" : "FAILED"} — ${args.output}`,
            timestamp: startTime,
          })

          // Checkpoints for risky operations
          const newCheckpoints = checkpoints.evaluate(args.stepId, args.output, args.filesModified ?? [])

          let response = `## Step ${args.stepId}: ${args.success ? "✅ SUCCESS" : "❌ FAILED"}\n\n${args.output}\n`

          if (newCheckpoints.length > 0) {
            response += `\n### ⚠️ Checkpoints\n`
            for (const cp of newCheckpoints) {
              const icon = cp.type === "block" ? "🛑" : cp.type === "review" ? "👀" : "⚠️"
              response += `${icon} **${cp.type.toUpperCase()}**: ${cp.description}\n`
              response += `   _${cp.context}_\n`
            }
          }

          // Enforce block checkpoints
          const blockStatus = checkpoints.isBlocked()
          if (blockStatus.blocked) {
            response += `\n### 🛑 BLOCKED\n${blockStatus.reason}\n\n`
            response += `Use \`agentic_execute\` with the same stepId to acknowledge and proceed, or investigate the issue first.`
            return { output: response, metadata: { progress: executor.getProgress(context.sessionID), blocked: true } }
          }

          let verifyResult = undefined
          if (args.success && args.autoVerify !== false) {
            response += `\n### Auto-Verify\n`
            const changedFiles = args.filesModified ?? []
            
            // Fast verification: compile ONLY (no full test suite).
            // Full suite (compile+lint+test+LLM) dijalankan di agentic_verify final.
            // Ini bikin intermediate steps CEPAT — dari ~30s jadi ~3s.
            verifier.clearCompileCache() // Force re-compile since files changed
            verifyResult = verifier.verifyFast(args.stepId, projectDir, changedFiles)
            
            if (verifyResult.passed) {
              response += `✅ All checks passed\n`
              verifyResult.checks.forEach(c => {
                response += `  ${c.passed ? "✅" : "❌"} ${c.name}\n`
              })
            } else {
              response += `❌ Verification failed after this step!\n`
              response += verifyResult.checks.map(c =>
                `${c.passed ? "✅" : "❌"} **${c.name}**\n\`\`\`\n${c.output.slice(0, 400)}\n\`\`\``
              ).join("\n\n")
              response += `\n\n⚠️ **Recommendation:** Run \`agentic_reflect\` on this step for propagation analysis and fix suggestions.`
            }
          }

          let guardResult: HallucinationCheck | undefined
          if (args.success && configLoader.get().agent.autoHallucinationCheck) {
            response += `\n### Auto-Hallucination Check\n`
            guardResult = hallucinationGuard.check(args.output, args.filesModified ?? [])

            if (guardResult.claims.length > 0) {
              const failedClaims = guardResult.claims.filter((c: ClaimResult) => !c.verified)
              const hallucinationRate = failedClaims.length / guardResult.claims.length

              if (failedClaims.length > 0) {
                response += `⚠️ Detected ${failedClaims.length}/${guardResult.claims.length} unverified claims (hallucination rate: ${(hallucinationRate * 100).toFixed(1)}%)\n`
                failedClaims.forEach((c: ClaimResult) => {
                  response += `  ❌ ${c.type}: ${c.claim}\n`
                })

                const modelId = await llmEngine.getOpenCodeModel()
                if (modelId && modelId !== "unknown") {
                  modelRegistry.recordHallucination(modelId)
                }

                const threshold = configLoader.get().agent.hallucinationThreshold
                const blockEnabled = configLoader.get().agent.blockOnHallucination
                if (hallucinationRate >= threshold && blockEnabled) {
                  response += `\n🛑 **BLOCKED**: Hallucination rate ${(hallucinationRate * 100).toFixed(1)}% exceeds threshold ${(threshold * 100).toFixed(1)}%\n`
                  response += `This step will be marked as FAILED to prevent cascading errors from phantom files/functions.\n`
                  response += `\n⚠️ **Recommendation:** Review the step output and verify all file/function references exist before proceeding.`
                  
                  executor.recordResult(context.sessionID, {
                    stepId: args.stepId,
                    success: false,
                    output: args.output,
                    filesModified: args.filesModified ?? [],
                    error: `Hallucination detected: ${failedClaims.length} unverified claims`,
                  })

                  return { output: response, metadata: { progress: executor.getProgress(context.sessionID), blocked: true, hallucinationDetected: true } }
                }
              } else {
                response += `✅ All ${guardResult.claims.length} claims verified\n`
              }
            } else {
              response += `✅ No claims detected (clean output)\n`
            }
          }

          // ── Confidence Scoring per Output (Gap #2) ──
          const modelId = await llmEngine.getOpenCodeModel()
          let confidenceScore_: ConfidenceScore | undefined
          if (args.filesModified && args.filesModified.length > 0) {
            const signals: import("./core/confidence-scorer.js").ScoringSignals = {
              stepId: args.stepId,
              modelName: modelId && modelId !== "unknown" ? modelId : undefined,
              compileResult: verifyResult ? { passed: verifyResult.passed, output: verifyResult.checks.map(c => c.output).join("\n") } : undefined,
              guardResult: guardResult ? { passed: guardResult.passed, claims: guardResult.claims } : undefined,
              testResult: undefined,
              lintResult: verifyResult?.checks.find(c => c.name === "lint") ? { passed: verifyResult.checks.find(c => c.name === "lint")!.passed } : undefined,
            }
            if (modelId) {
              const modelScore = modelRegistry.getScore(modelId)
              if (modelScore) {
                signals.modelReliability = modelScore.reliability
              }
            }
            confidenceScore_ = confidenceScorer.score(signals)
            confidenceStore.set(args.stepId, confidenceScore_, modelId ?? undefined)

            response += `\n### Confidence Score (Gap #2)\n`
            response += confidenceScorer.format(confidenceScore_)

            // Feed to LiveEvaluator
            liveEvaluator.feedStepResult({
              stepId: `confidence-${args.stepId}`,
              success: confidenceScore_.passed,
              sessionId: context.sessionID,
            })
          }

          if (!args.success) {
            const modifiedFiles = executor.getAllFilesModified(context.sessionID)
            const analysis = await errorAnalyzer.analyzeDeep(args.error ?? args.output, modifiedFiles)
            const maxAllowed = executor.getMaxRetries(analysis.category)
            const canRetry = executor.canRetry(context.sessionID, args.stepId, analysis.category)
            const retriesUsed = executor.getRetryCount(context.sessionID, args.stepId)
            const retriesLeft = maxAllowed - retriesUsed

            response += `\n### Error Analysis\n`
            response += `**Category:** \`${analysis.category}\` | **Severity:** ${analysis.severity}\n`
            response += `**Likely cause:** ${analysis.likelyRootCause}\n`

            // Error propagation trace
            const session = sessionStore.getOrCreate(context.sessionID)
            const planSteps = session.plan?.intent.subtasks.map(s => s.id) ?? []
            const propAnalysis = depTracker.analyzeErrorPropagation(context.sessionID, args.stepId, args.error ?? args.output, planSteps)

            if (propAnalysis.likelyCulprit) {
              response += `\n### 🔗 Error Propagation Trace\n`
              response += `**Likely origin:** \`${propAnalysis.likelyCulprit}\`\n`
              response += `**Propagation path:** ${propAnalysis.propagationPath.length > 0 ? propAnalysis.propagationPath.map(p => `\`${p}\``).join(" → ") : "Direct failure"}\n`
              response += `**Suggestion:** ${propAnalysis.suggestion}\n`
            }

            response += `\n**Suggested fix:** ${analysis.suggestedFix}\n`

            if (canRetry) {
              response += `\n🔄 **Retries remaining:** ${retriesLeft}/${maxAllowed} (${analysis.category}) — fix the issue and call \`agentic_execute\` again.`

              if (retriesUsed >= 2) {
                const delegateRole = analysis.category === "test" ? "qa" : (analysis.category === "compile" || analysis.category === "type") ? "developer" : "architect"
                response += `\n\n💡 **Escalate:** This step has failed ${retriesUsed}x. Delegate to **${delegateRole}** specialist: \`agentic_delegate role="${delegateRole}" taskId="${args.stepId}-delegate" description="${analysis.category} error in ${args.stepId}"\``
              }
            } else {
              response += `\n🛑 **Max retries (${maxAllowed}) reached for ${analysis.category}.** Address the underlying issue or revise the plan.`
            }

            // Feed failure to ContinuousEvolution
            continuousEvolution.feedStepResult({
              stepId: args.stepId,
              success: false,
              output: args.output,
              sessionId: context.sessionID,
              timestamp: startTime,
              category: analysis.category,
            })
          }

          if (args.success) {
            // Feed success to ContinuousEvolution
            continuousEvolution.feedStepResult({
              stepId: args.stepId,
              success: true,
              output: args.output,
              sessionId: context.sessionID,
              timestamp: startTime,
            })

            // Auto-skill extraction (P0a: wire autoSkillExtract config)
            if (configLoader.get().agent.autoSkillExtract) {
              try {
                const skill = await skillStore.extract(
                  { role: "developer", content: args.output },
                  [args.stepId, ...(args.filesModified ?? [])]
                )
                if (skill) {
                  response += `\n### 🧠 Auto-Skill\nExtracted skill: \`${skill.definition.meta.id}\` — ${skill.definition.meta.name}\n`
                  const skillId = skill.definition.meta.id

                  // Pre-flight: validate input against input_schema if present
                  if (skill.definition.input_schema) {
                    try {
                      const parsedInput = args.filesModified ? { stepId: args.stepId, filesModified: args.filesModified, ...(args.error ? { error: args.error } : {}) } : {}
                      const svResult = schemaValidator.validate(
                        skill.definition.input_schema,
                        parsedInput,
                      )
                      if (!svResult.valid) {
                        response += `⚠️ Input schema: ${svResult.errors.length} issues\n`
                        for (const err of svResult.errors.slice(0, 3)) {
                          response += `  • ${err.path}: ${err.message}\n`
                        }
                      } else {
                        response += `✅ Input schema validated\n`
                      }
                    } catch {
                      // non-fatal
                    }
                  }

                  // DSL execution if skill has logic blocks
                  let dslSuccess = false
                  if (skill.definition.logic && skill.definition.logic.instructions.length > 0) {
                    try {
                      const dslResult = dslExecutor.execute(
                        skill.definition.logic.instructions,
                        { stepId: args.stepId, output: args.output, filesModified: args.filesModified ?? [] },
                      )
                      dslSuccess = dslResult.success
                      if (dslResult.success) {
                        response += `✅ DSL logic executed (${dslResult.trace.steps.length} instructions, ${dslResult.trace.durationMs}ms)\n`
                        if (dslResult.output && Object.keys(dslResult.output).length > 0) {
                          response += `  Result: \`${JSON.stringify(dslResult.output).slice(0, 200)}\`\n`
                        }
                      } else {
                        response += `⚠️ DSL logic completed with warnings (${dslResult.trace.steps.length} instructions)\n`
                        if (dslResult.error) {
                          response += `  Error: ${dslResult.error.slice(0, 200)}\n`
                        }
                      }
                    } catch (e) {
                      response += `⚠️ DSL execution error: ${(e as Error).message}\n`
                    }
                  }

                  // Post-flight: validate output against output_schema
                  if (skill.definition.output_schema) {
                    try {
                      const parsedOutput = JSON.parse(args.output)
                      const svResult = schemaValidator.validate(
                        skill.definition.output_schema,
                        parsedOutput,
                      )
                      if (!svResult.valid) {
                        response += `⚠️ Output schema: ${svResult.errors.length} issues\n`
                        for (const err of svResult.errors.slice(0, 3)) {
                          response += `  • ${err.path}: ${err.message}\n`
                        }
                      } else {
                        response += `✅ Output schema validated\n`
                      }
                    } catch {
                      // non-fatal — output may not be JSON
                    }
                  }

                  // Reinforce skill: call reinforce() on successful execution with DSL
                  if (dslSuccess && args.success) {
                    skillStore.reinforce(skillId, true)
                    response += `✅ Skill reinforced (score: ${skill.successRate.toFixed(3)})\n`
                  } else if (args.success) {
                    // Even without DSL, record usage
                    skillStore.reinforce(skillId, true)
                  }
                }
              } catch { /* non-fatal */ }
            }
          }

          const progress = executor.getProgress(context.sessionID)
          const nextStep = executor.getNextStep(context.sessionID)

          response += `\n### Progress\n`
          response += `\`\`\`\n`
          response += `✅ Done:     ${progress.completed}\n`
          response += `❌ Failed:   ${progress.failed}\n`
          response += `🔒 Blocked:  ${progress.blocked}\n`
          response += `⏳ Remaining: ${progress.total - progress.completed - progress.failed - progress.blocked}\n`
          response += `\`\`\`\n`

          if (args.success && nextStep) {
            response += `\n### Next\n▶ **${nextStep.id}** — ${nextStep.description}`
          } else if (args.success && !nextStep) {
            response += `\n### 🎉 All steps complete!\nRun \`agentic_verify\` for final verification, or \`agentic_pipeline action="run" pipelineId="fix-verify"\` to trigger a QA review.`

            // Record episode
            const session = sessionStore.getOrCreate(context.sessionID)
            if (session.plan) {
              const allSuccess = executor.isHealthy(context.sessionID)
              const allFiles = executor.getAllFilesModified(context.sessionID)
              const decisions = executor.getCompletedSteps(context.sessionID).map(() => "completed")
              episodicStore.record(
                context.sessionID,
                session.plan.intent.goal,
                allSuccess ? "success" : "partial",
                decisions,
                allFiles,
                domainRegistry.getCurrentDomain() ?? undefined,
                projectId,
              )
            }
          }

          // ── User Feedback for Continuous Learning (Gap #9) ──
          if (args.feedback) {
            const isPositive = args.feedback === "positive"
            response += `\n### 📝 Feedback Recorded\n`
            response += `${isPositive ? "✅ Positive — confidence increased" : "❌ Negative — adapting..."}\n`

            // Record feedback ke model yang dipake — biar model selection makin pinter
            const currentModel = llmEngine.getCurrentModel()
            const taskType = sessionStore.getOrCreate(context.sessionID).currentTaskType
            if (currentModel && taskType) {
              modelRegistry.recordUserFeedback(currentModel, taskType, isPositive)
              response += `  Model feedback: \`${currentModel}\` untuk task \`${taskType}\` → ${isPositive ? "✅" : "❌"}\n`
            }

            // Update skill success rates based on feedback
            const session = sessionStore.getOrCreate(context.sessionID)
            const goal = session.plan?.intent.goal ?? args.output
            const existingSkills = skillStore.find(goal)
            for (const skill of existingSkills.slice(0, 3)) {
              if (isPositive) {
                // Boost: record success
                skill.usageCount++
                skill.successRate = Math.min(1, skill.successRate + 0.05)
                persistence.save("skills", skill.definition.meta.id, skill.definition)
              } else {
                // Penalize: report failure
                skillStore.reportFailure(skill.definition.meta.id)
              }
            }

            // Negative feedback → trigger adaptation
            if (!isPositive) {
              // Increase retry allowance for this error category
              const modifiedFiles = executor.getAllFilesModified(context.sessionID)
              const feedbackAnalysis = await errorAnalyzer.analyzeDeep(args.output, modifiedFiles)
              const currentMax = executor.getMaxRetries(feedbackAnalysis.category)
              executor.setRetryPolicy(feedbackAnalysis.category, Math.min(currentMax + 1, 5))
              response += `  **Retry limit increased:** \`${feedbackAnalysis.category}\` → ${Math.min(currentMax + 1, 5)}\n`

              // Feed into continuous evolution
              continuousEvolution.feedStepResult({
                stepId: `feedback-${args.stepId}`,
                success: false,
                output: `User negative feedback: ${args.output.slice(0, 200)}`,
                sessionId: context.sessionID,
                timestamp: Date.now(),
                category: feedbackAnalysis.category,
              })

              // Check if evolution should trigger — auto-execute if so
              const trigger = continuousEvolution.shouldEvolve(context.sessionID)
              if (trigger) {
                response += `  🔄 **Auto-evolution triggered:** ${trigger.reason}\n`
                try {
                  const evolveSummary = await runAutoEvolve()
                  response += `  ${evolveSummary.replace(/\n/g, "\n  ")}\n`
                } catch (e) {
                  response += `  ⚠️ Auto-evolution encountered an error: ${(e as Error).message}\n`
                }
              }
            }
          }

          return { output: response, metadata: { progress, nextStep: nextStep?.id, verifyResult } }
        },
      }),

      agentic_reflect: tool({
        description: "Analyze a failed step. Diagnoses the error category, traces error propagation across the step chain, and suggests a recovery plan.",
        args: {
            stepId: tool.schema.string().describe("The ID of the failed step to analyze (in ID chain: sessionID ⊃ stepId)"),
          errorDetails: tool.schema.string().optional().describe("Additional error context (full stack trace, test output, etc.)"),
          attemptedFix: tool.schema.string().optional().describe("What you tried to fix the error (if any)"),
        },
        async execute(args, context) {
          llmEngine.setSessionId(context.sessionID)
          llmEngine.setToolContext('agentic_reflect')
          const stepState = executor.getStepState(context.sessionID, args.stepId)
          if (!stepState || !stepState.result) {
            return { output: `No execution record for step "${args.stepId}". Has it been run via \`agentic_execute\`?` }
          }

          if (stepState.result.success) {
            return { output: `Step "${args.stepId}" was successful — no reflection needed.` }
          }

          const errorText = [args.errorDetails, stepState.result.output, stepState.result.error]
            .filter(Boolean)
            .join("\n")
          const modifiedFiles = executor.getAllFilesModified(context.sessionID)
          const analysis = await errorAnalyzer.analyzeDeep(errorText, modifiedFiles)
          const canRetry = executor.canRetry(context.sessionID, args.stepId)
          const retriesUsed = executor.getRetryCount(context.sessionID, args.stepId)

          if (args.attemptedFix) {
            executor.recordFixAttempt(context.sessionID, args.stepId, args.attemptedFix, false)
          }

          // Error propagation analysis
          const session = sessionStore.getOrCreate(context.sessionID)
          const planSteps = session.plan?.intent.subtasks.map(s => s.id) ?? []
          const propAnalysis = depTracker.analyzeErrorPropagation(context.sessionID, args.stepId, errorText, planSteps)

          const maxRetries = executor.getMaxRetries(analysis.category)
          let output = `## 🔍 Error Analysis: Step "${args.stepId}"\n\n`
          output += `**Category:** \`${analysis.category}\`\n`
          output += `**Severity:** ${analysis.severity}\n`
          output += `**Retry #${retriesUsed}/${maxRetries}**\n\n`
          output += `### Root Cause\n${analysis.likelyRootCause}\n\n`

          if (propAnalysis.likelyCulprit || propAnalysis.propagationPath.length > 0) {
            output += `### 🔗 Error Propagation Trace\n`
            if (propAnalysis.likelyCulprit) {
              output += `**Likely origin:** \`${propAnalysis.likelyCulprit}\`\n`
            }
            if (propAnalysis.propagationPath.length > 0) {
              output += `**Propagation path:** ${propAnalysis.propagationPath.map(p => `\`${p}\``).join(" → ")}\n`
            }
            output += `**Suggestion:** ${propAnalysis.suggestion}\n\n`
          }

          output += `### Suggested Fix\n${analysis.suggestedFix}\n`

          if (modifiedFiles.length > 0) {
            output += `\n### Modified Files (likely sources)\n`
            output += modifiedFiles.map(f => `- \`${f}\``).join("\n") + "\n"
          }

          if (analysis.category === "compile" || analysis.category === "type") {
            output += `\n### Recovery Plan\n1. Check the error output for exact file path and line number\n2. Fix the syntax/type issue\n3. Call \`agentic_execute\` with \`success: true\`\n`
          } else if (analysis.category === "test") {
            output += `\n### Recovery Plan\n1. Verify if the test expectation is still correct after changes\n2. Update code or test accordingly\n3. Retry the step\n`
          } else {
            output += `\n### Recovery Plan\n1. Review what the step was supposed to accomplish\n2. Check for unintended side effects in modified files\n3. Fix and retry\n`
          }

          if (canRetry) {
            output += `\n---\n🔄 **${maxRetries - retriesUsed} retries left.** Fix and call \`agentic_execute\` to retry.`
          } else {
            output += `\n---\n🛑 **No retries remaining.** Consider adding a new plan step for this fix.`
          }

          return { output }
        },
      }),

      agentic_verify: tool({
        description: "Run deep verification: compile + lint + test + semantic + security + performance + architecture + dependency audit. Gap #4 multi-dimensional.",
        args: {
          stepId: tool.schema.string().optional().describe("Label for this verification"),
          projectDir: tool.schema.string().optional().describe("Project directory (default: worktree)"),
          tier: tool.schema.string().optional().describe("Verification tier: 'fast', 'standard', or 'deep' (default: 'deep')"),
        },
        async execute(args, context) {
          llmEngine.setSessionId(context.sessionID)
          llmEngine.setToolContext('agentic_verify')
          const projectDir = args.projectDir ?? ctxDir(context)
          const stepId = args.stepId ?? "full"
          const tier = (args.tier ?? "deep") as import("./core/verifier.js").VerificationTier

          const result = await verifier.verifyAllDeep(stepId, projectDir, undefined, [], false, tier)

          traceLogger.log({
            step: `verify:${stepId}`,
            input: projectDir,
            output: JSON.stringify(result),
            toolUsed: "agentic_verify",
            success: result.passed,
            durationMs: 0,
          })

          const checkOutput = result.checks.map(c =>
            `${c.passed ? "✅" : "❌"} **${c.name}**\n\`\`\`\n${c.output.slice(0, 600)}\n\`\`\``
          ).join("\n\n")

          if (result.passed) {
            return { output: `## ✅ Verification Passed\n\n${checkOutput}`, metadata: result }
          }

          const analysis = await errorAnalyzer.analyzeDeep(result.errors.join("\n"), [])
          return {
            output: `## ❌ Verification Failed\n\n${checkOutput}\n\n### Analysis\n**Category:** \`${analysis.category}\`\n**Likely cause:** ${analysis.likelyRootCause}\n**Fix:** ${analysis.suggestedFix}`,
            metadata: result,
          }
        },
      }),

      agentic_status: tool({
        description: "Show execution dashboard: progress bar, health, blocked steps, dependency graph, retry history, and file change summary.",
        args: {},
        async execute(_args, context) {
          const progress = executor.getProgress(context.sessionID)
          const nextStep = executor.getNextStep(context.sessionID)
          const blockedSteps = executor.getBlockedSteps(context.sessionID)
          const isComplete = executor.isComplete(context.sessionID)
          const isHealthy = executor.isHealthy(context.sessionID)
          const allFiles = executor.getAllFilesModified(context.sessionID)

          let output = `## 📊 Execution Dashboard\n\n`

          if (progress.total > 0) {
            const pct = Math.min(100, Math.round((progress.completed / progress.total) * 100))
            const barLen = 20
            const filled = Math.min(barLen, Math.round((pct / 100) * barLen))
            output += `\`\`\`\n[${"█".repeat(filled)}${"░".repeat(barLen - filled)}] ${pct}%\n\`\`\`\n`
          }

          output += `**Health:** ${isHealthy ? "✅ All passing" : "⚠️ Errors"}\n`
          output += `**Status:** ${isComplete ? "🎉 Complete" : "⏳ In progress"}\n\n`
          output += `| Status | Count |\n|--------|-------|\n`
          output += `| ✅ Done | ${progress.completed} |\n`
          output += `| ❌ Failed | ${progress.failed} |\n`
          output += `| 🔒 Blocked | ${progress.blocked} |\n`

          if (nextStep) {
            output += `\n### Next Ready\n▶ **${nextStep.id}** — ${nextStep.description}\n`
          }

          if (blockedSteps.length > 0) {
            output += `\n### 🔒 Blocked Steps\n`
            for (const b of blockedSteps) {
              output += `- **${b.id}** — ${b.description}\n`
              output += `  Waiting on: ${b.blockedBy.map(d => `\`${d}\``).join(", ")}\n`
            }
          }

          if (allFiles.length > 0) {
            output += `\n### 📁 Files Modified\n`
            output += allFiles.map(f => `- \`${f}\``).join("\n") + "\n"
          }

          output += `\n### 🤖 Model Reliability\n`
          const modelSummary = modelRegistry.getSummary()
          output += modelSummary + "\n"

          // Session model preferences (Gap: per-role model selection)
          const modelPrefs = sessionStore.getAllModelPreferences(context.sessionID)
          if (modelPrefs.length > 0) {
            output += `\n### 🎯 Per-Role Model Preferences\n`
            output += modelPrefs.map(p => `- **${p.role}** → \`${p.model}\``).join("\n") + "\n"
          }

          // Evolution trend
          const trend = continuousEvolution.getTrend()
          if (trend.overall.total > 0) {
            const dirIcon = trend.rolling.direction === "improving" ? "📈" : trend.rolling.direction === "degrading" ? "📉" : "📊"
            output += `\n### 🔄 Evolution Trend\n`
            output += `**Overall:** ${(trend.overall.successRate * 100).toFixed(0)}% (${trend.overall.success}/${trend.overall.total} steps)\n`
            output += `**Recent (last ${trend.rolling.windowSize}):** ${(trend.rolling.successRate * 100).toFixed(0)}% — ${dirIcon} ${trend.rolling.direction}\n`
            if (trend.degradationDetected) {
              output += `⚠️ **Performance degradation detected!** Auto-running self-evolution...\n`
              try {
                output += `${(await runAutoEvolve()).replace(/\n/g, "\n")}\n`
              } catch {
                output += `⚠️ Auto-evolution encountered an error.\n`
              }
            }
            // Forecast (Gap #12)
            if (trend.forecast && trend.forecast.bucketRates.length > 0) {
              output += `**Forecast next window:** ${(trend.forecast.nextWindowRate * 100).toFixed(0)}%`
              if (trend.forecast.critical) {
                output += ` 🔴 **Critical**`
              }
              if (trend.forecast.stepsUntilCritical !== null) {
                output += ` (~${trend.forecast.stepsUntilCritical} steps to 50%)`
              }
              output += `\n`
              output += `**Trend buckets:** ${trend.forecast.bucketRates.map(r => `${(r * 100).toFixed(0)}%`).join(" → ")}\n`
            }
            if (trend.recommendations.length > 0) {
              output += `**Tips:**\n`
              output += trend.recommendations.map(r => `- ${r}`).join("\n") + "\n"
            }
          }

          // Live evaluation score
          const liveScore = liveEvaluator.computeScore()
          if (liveScore.totalSteps > 0 || liveScore.totalDelegations > 0) {
            output += `\n### 📊 Live Evaluation Score\n`
            const bar = "█".repeat(Math.round(liveScore.overall / 5))
            output += `**Overall:** ${liveScore.overall}/100 ${bar.padEnd(20, "░")}\n`
            for (const [name, dim] of Object.entries(liveScore.dimensions)) {
              if (dim.weight > 0) {
                output += `- **${name}:** ${(dim.score * 100).toFixed(0)}% (target ${(dim.target * 100).toFixed(0)}%)\n`
              }
            }
            output += `\n`
          }

          // Confidence Score per Step (Gap #2)
          const confRecords = confidenceStore.getAll()
          if (confRecords.length > 0) {
            output += `\n### 📊 Confidence per Step (Gap #2)\n`
            const avg = confidenceStore.getAverage()
            output += `**Average:** ${(avg * 100).toFixed(0)}% | **Steps scored:** ${confRecords.length}\n\n`
            for (const rec of confRecords) {
              const emoji = rec.passed ? "✅" : "⚠️"
              const bar = "█".repeat(Math.round(rec.score * 10))
              const empty = "░".repeat(10 - Math.round(rec.score * 10))
              output += `- **${rec.stepId}** ${emoji} ${bar}${empty} ${(rec.score * 100).toFixed(0)}%\n`
            }
            const lowConf = confidenceStore.getLowConfidence()
            if (lowConf.length > 0) {
              output += `\n⚠️ **${lowConf.length} step(s) below threshold** — review recommended\n`
            }
            output += "\n"
          }

          // World Model Beliefs (Comparison 19)
          const wmStats = worldModel.getStats()
          if (wmStats.beliefs > 0) {
            output += `\n### 🧠 World Model Beliefs\n`
            output += `**Entities:** ${wmStats.entities} | **Relations:** ${wmStats.relations} | **Beliefs:** ${wmStats.beliefs} | **Cycles:** ${wmStats.cycles}\n`
            const uncertain = worldModel.getUncertainBeliefs()
            if (uncertain.length > 0) {
              output += `⚠️ **${uncertain.length} low-confidence belief(s)** — may be stale\n`
            }
            const topBeliefs = worldModel.getAllBeliefs()
              .sort((a, b) => b.confidence - a.confidence)
              .slice(0, 5)
            if (topBeliefs.length > 0) {
              output += `\n**Top beliefs:**\n`
              for (const b of topBeliefs) {
                output += `- \`${b.key}\`: ${(b.confidence * 100).toFixed(0)}% — ${b.fact.slice(0, 80)} (${b.category})\n`
              }
            }
            output += "\n"
          }

          return { output, metadata: { progress, nextStep: nextStep?.id, blockedSteps, isComplete, isHealthy } }
        },
      }),

      agentic_context: tool({
        description: "View and compress the execution context. When approaching context limits, this tool summarizes the conversation history into a compact form preserving key decisions, file changes, and invariants.",
        args: {
          action: tool.schema.enum(["view", "compress"]).describe("'view' shows current context stats; 'compress' generates a compressed context prompt"),
        },
        async execute(args, context) {
          llmEngine.setSessionId(context.sessionID)
          llmEngine.setToolContext('agentic_context')
          const turns = sessionStore.getContext(context.sessionID, 100)
          const session = sessionStore.getOrCreate(context.sessionID)
          const allFiles = executor.getAllFilesModified(context.sessionID)
          const decisions: string[] = []

          if (args.action === "view") {
            let output = `## 🧠 Context Status\n\n`
            output += `**Turns in memory:** ${turns.length}\n`
            output += `**Files tracked:** ${allFiles.length}\n`
            output += `**Plan steps:** ${session.plan?.intent.subtasks.length ?? 0}\n`

            const summary = await contextCompressor.compressWithLLM(
              session.plan?.intent.goal ?? "N/A",
              turns,
              decisions,
              allFiles,
            )

            output += `**Estimated tokens:** ~${summary.estimatedTokens}\n`

            const shouldCompress = contextCompressor.shouldCompress(turns.length, summary.estimatedTokens)
            if (shouldCompress) {
              output += `\n⚠️ **Context window approaching capacity.** Run \`agentic_context\` with \`action: "compress"\` to compact.\n`
            } else {
              output += `\n✅ Context is healthy.\n`
            }

            return { output }
          }

          // Compress — use LLM-enhanced version when available
          const summary = await contextCompressor.compressWithLLM(
            session.plan?.intent.goal ?? "N/A",
            turns,
            decisions,
            allFiles,
          )

          const prompt = contextCompressor.compressToPrompt(summary)

          let output = `## 🗜️ Context Compressed\n\n`
          output += `Compressed ${turns.length} turns into ~${summary.estimatedTokens} tokens.\n\n`
          output += prompt

          traceLogger.log({
            step: "context:compress",
            input: `${turns.length} turns`,
            output: `${summary.estimatedTokens} tokens`,
            toolUsed: "agentic_context",
            success: true,
            durationMs: 0,
          })

          return { output }
        },
      }),

      agentic_snapshot: tool({
        description: "Save, restore, or list execution snapshots. Use 'save' to checkpoint state (plan progress, file changes, decisions). Use 'restore' to reload a previous checkpoint and reset execution state. Use 'list' to see all snapshots.",
        args: {
          action: tool.schema.enum(["save", "list", "restore"]).describe("'save' creates a checkpoint; 'restore' reloads a checkpoint; 'list' shows all saved snapshots"),
          label: tool.schema.string().optional().describe("Snapshot label to restore (required for 'restore', optional for 'save')"),
        },
        async execute(args, context) {
          if (args.action === "save") {
            const progress = executor.getProgress(context.sessionID)
            const allFiles = executor.getAllFilesModified(context.sessionID)
            const session = sessionStore.getOrCreate(context.sessionID)
            const planGoal = session.plan?.intent.goal ?? "N/A"

            const completedSteps = session.plan?.intent.subtasks.filter(s =>
              executor.getCompletedSteps(context.sessionID).includes(s.id)
            ).map(s => s.id) ?? []

            const snapshot = {
              label: args.label ?? `snap-${Date.now()}`,
              timestamp: new Date().toISOString(),
              planGoal,
              progress,
              filesModified: allFiles,
              completedSteps,
              totalSteps: session.plan?.intent.subtasks.length ?? 0,
              plan: session.plan ?? null,
            }

            session.artifacts.set(`snapshot:${snapshot.label}`, JSON.stringify(snapshot))

            traceLogger.log({
              step: "snapshot:save",
              input: snapshot.label,
              output: `${allFiles.length} files, ${progress.completed}/${progress.total} steps`,
              toolUsed: "agentic_snapshot",
              success: true,
              durationMs: 0,
            })

            return {
              output: `## 📸 Snapshot Saved\n\n**Label:** \`${snapshot.label}\`\n**Progress:** ${progress.completed}/${progress.total}\n**Files:** ${allFiles.length}\n**Timestamp:** ${snapshot.timestamp}`,
            }
          }

          if (args.action === "restore") {
            if (!args.label) {
              return { output: "Provide a `label` of the snapshot to restore. Use `action: \"list\"` to see available snapshots." }
            }

            const session = sessionStore.getOrCreate(context.sessionID)
            const raw = session.artifacts.get(`snapshot:${args.label}`)
            if (!raw) {
              return { output: `Snapshot "${args.label}" not found. Use \`action: "list"\` to see available snapshots.` }
            }

            let snapshot: any
            try {
              snapshot = JSON.parse(raw)
            } catch {
              return { output: `Snapshot "${args.label}" is corrupted and cannot be restored.` }
            }

            // Re-init execution with the same plan but mark completed steps from snapshot
            if (snapshot.plan) {
              executor.initExecution(context.sessionID, snapshot.plan)
              // Re-mark completed steps
              for (const stepId of snapshot.completedSteps ?? []) {
                executor.recordResult(context.sessionID, {
                  stepId,
                  success: true,
                  output: `Restored from snapshot "${args.label}"`,
                  filesModified: snapshot.filesModified ?? [],
                })
              }
              // Update session plan
              session.plan = snapshot.plan
            }

            traceLogger.log({
              step: "snapshot:restore",
              input: args.label,
              output: `Restored ${snapshot.completedSteps?.length ?? 0}/${snapshot.totalSteps ?? 0} steps`,
              toolUsed: "agentic_snapshot",
              success: true,
              durationMs: 0,
            })

            const stepList = (snapshot.completedSteps ?? []).map((s: string) => `  - ✅ \`${s}\``).join("\n")
            return {
              output: `## ♻️ Snapshot Restored\n\n**Label:** \`${args.label}\`\n**Timestamp:** ${snapshot.timestamp}\n**Goal:** ${snapshot.planGoal}\n**Progress Restored:** ${snapshot.completedSteps?.length ?? 0}/${snapshot.totalSteps ?? 0} steps\n\n### Completed Steps\n${stepList || "  (none)"}\n\n### Files Modified (${snapshot.filesModified?.length ?? 0})\n${(snapshot.filesModified ?? []).map((f: string) => `  - \`${f}\``).join("\n") || "  (none)"}\n\nRun \`agentic_status\` to see current progress.`,
            }
          }

          // List snapshots
          const session = sessionStore.getOrCreate(context.sessionID)
          const snapshots: string[] = []
          for (const [key] of session.artifacts) {
            if (key.startsWith("snapshot:")) {
              snapshots.push(key.replace("snapshot:", ""))
            }
          }

          if (snapshots.length === 0) {
            return { output: "No snapshots saved yet. Use `action: \"save\"` to create one." }
          }

          // Show details for each snapshot
          const lines: string[] = []
          for (const label of snapshots) {
            const raw = session.artifacts.get(`snapshot:${label}`)
            if (raw) {
              try {
                const s = JSON.parse(raw)
                lines.push(`- \`${label}\` — ${s.planGoal ?? "N/A"} (${s.completedSteps?.length ?? 0}/${s.totalSteps ?? 0} steps, ${new Date(s.timestamp).toLocaleDateString()})`)
              } catch {
                lines.push(`- \`${label}\` (corrupted)`)
              }
            } else {
              lines.push(`- \`${label}\``)
            }
          }

          return { output: `## 📸 Snapshots (${snapshots.length})\n\n${lines.join("\n")}\n\nUse \`agentic_snapshot\` with \`action: "restore"\` and the \`label\` to reload a checkpoint.` }
        },
      }),

      agentic_pipeline: tool({
        description: "Define and run multi-agent workflow pipelines. Chain PM → Architect → Developer → QA for complete feature development. Includes cross-validation between stages.",
        args: {
          action: tool.schema.enum(["define", "list", "run", "status", "suggest"]).describe("'define' to create a new pipeline; 'list' to show existing; 'run' to start a pipeline; 'status' to check progress; 'suggest' to auto-suggest a pipeline"),
          pipelineId: tool.schema.string().optional().describe("Pipeline ID (for define/run/status)"),
          stages: tool.schema.array(tool.schema.object({
            role: tool.schema.string().describe("Agent role for this stage"),
            description: tool.schema.string().describe("What this stage should accomplish"),
            validationCriteria: tool.schema.array(tool.schema.string()).optional().describe("Criteria to validate this stage"),
          })).optional().describe("Pipeline stages (for define action)"),
          name: tool.schema.string().optional().describe("Pipeline name (for define action)"),
          description: tool.schema.string().optional().describe("Task description (for suggest action)"),
        },
        async execute(args, context) {
          switch (args.action) {
            case "define": {
              if (!args.pipelineId || !args.stages || args.stages.length === 0) {
                return { output: "pipelineId and stages (non-empty array) required." }
              }
              const pipeline: WorkflowPipeline = {
                id: args.pipelineId,
                name: args.name ?? args.pipelineId,
                stages: args.stages,
                createdAt: Date.now(),
              }
              orchestrator.definePipeline(pipeline)
              return {
                output: `## 📋 Pipeline Defined\n\n**ID:** \`${pipeline.id}\`\n**Name:** ${pipeline.name}\n**Stages:** ${pipeline.stages.length}\n\n` +
                  pipeline.stages.map((s, i) => `${i + 1}. **${s.role}** — ${s.description}`).join("\n"),
              }
            }

            case "list": {
              const pipelines = orchestrator.listPipelines()
              if (pipelines.length === 0) return { output: "No pipelines defined. Use `action: \"define\"` to create one." }
              let out = `## 📋 Defined Pipelines (${pipelines.length})\n\n`
              for (const p of pipelines) {
                out += `**${p.name}** (\`${p.id}\`) — ${p.stages.length} stages\n`
                out += p.stages.map(s => `  - ${s.role}: ${s.description}`).join("\n") + "\n\n"
              }
              return { output: out }
            }

            case "suggest": {
              const suggested = orchestrator.getSuggestedPipeline(args.description ?? "")
              const pipeline = orchestrator.getPipeline(suggested)
              if (!pipeline) return { output: `Suggested pipeline: \`${suggested}\`. Run \`action: "run"\` with this pipelineId.` }
              let out = `## 💡 Suggested Pipeline: **${pipeline.name}**\n\n`
              out += `Run \`agentic_pipeline\` with \`action: "run"\` and \`pipelineId: "${pipeline.id}"\` to start.\n\n`
              out += pipeline.stages.map((s, i) => {
                const category = s.model ?? roleRegistry.suggestModel(s.role)
                const resolved = modelRegistry.resolveAlias(category)
                const modelLabel = resolved.length > 0 && resolved[0] !== category ? `${resolved[0]} (${category})` : category
                return `${i + 1}. **${s.role}** — ${s.description} (model: ${modelLabel})`
              }).join("\n")
              return { output: out }
            }

            case "run": {
              if (!args.pipelineId) return { output: "pipelineId required." }
              const pipeline = orchestrator.getPipeline(args.pipelineId)
              if (!pipeline) return { output: `Pipeline "${args.pipelineId}" not found. Define it first or use one of: ${orchestrator.listPipelines().map(p => p.id).join(", ")}` }

              const runId = `run-${context.sessionID}-${args.pipelineId}`
              orchestrator.startRun(runId, args.pipelineId)

              await coordinator.writeSharedMemory(`pipeline:run:${runId}`, `Started pipeline ${pipeline.name}`, "coordinator")

              // Internal orchestration — no manual delegation needed
              let out = `## 🚀 Pipeline Run: ${pipeline.name}\n\n`
              out += `**Run ID:** \`${runId}\`\n`
              out += `**Stages:** ${pipeline.stages.map(s => s.role).join(" → ")}\n\n`

              const codebaseSummary = navigator.getSummary()
              const filesBlock = ""
              const memoryContexts = episodicStore.search(args.pipelineId).slice(0, 3).map(e => `${e.planGoal}: ${e.outcome}`)
              const skillContexts = skillStore.find(args.pipelineId).map(s => `${s.definition.meta.id}: ${s.definition.meta.name}`)

              const piperesult = await orchestrator.executePipeline({
                pipeline,
                runId,
                goal: args.pipelineId,
                projectDir: ctxDir(context),
                codebaseSummary,
                filesBlock,
                memoryContexts,
                skillContexts,
                coordinator,
                sessionID: context.sessionID,
                budgetTracker,
                eventBus,
                hallucinationGuard,
                skillStore,
                configLoader,
                schemaValidator,
              })

              if (piperesult.hasNoLLM) {
                out += `❌ LLM unavailable — pipeline aborted.\n`
                return { output: out }
              }
              if (piperesult.budgetExceeded) {
                out += `⛔ Budget exceeded — ${piperesult.completedStageCount}/${pipeline.stages.length} stages completed.\n`
              } else {
                out += `✅ ${piperesult.completedStageCount} stages completed.\n`
              }
              out += `**Files modified:** ${piperesult.allFiles.length > 0 ? piperesult.allFiles.join(", ") : "(none)"}\n`
              if (piperesult.pipelineReview) out += `**QA review:** ${piperesult.pipelineReview}\n`
              if (piperesult.verifyNote) out += `**Verification:** ${piperesult.verifyNote}\n`

              return { output: out, metadata: { runId, filesModified: piperesult.allFiles.length } }
            }

            case "status": {
              const runId = args.pipelineId
                ? `run-${context.sessionID}-${args.pipelineId}`
                : null

              if (!runId) {
                return { output: "Specify pipelineId to check status." }
              }

              const current = orchestrator.getCurrentStage(runId)
              const results = orchestrator.getAllStageResults(runId)

              let out = `## 📊 Pipeline Status\n\n`
              out += `**Run:** \`${runId}\`\n`

              const pipeline = args.pipelineId ? orchestrator.getPipeline(args.pipelineId) : null
              if (pipeline) {
                out += `**Pipeline:** ${pipeline.name}\n\n`
                out += `| Stage | Status |\n|-------|--------|\n`
                for (const stage of pipeline.stages) {
                  const hasResult = results.has(stage.role)
                  const icon = hasResult ? "✅" : stage.role === current?.role ? "▶" : "⏳"
                  out += `| ${icon} ${stage.role} | ${hasResult ? "Complete" : stage.role === current?.role ? "Active" : "Pending"} |\n`
                }
              }

              if (current) {
                out += `\n### Current Stage\n**${current.role}** — ${current.description}\n`
              } else {
                out += `\n### Pipeline Complete\nAll stages finished.\n`
              }

              return { output: out }
            }

            default:
              return { output: `Unknown action "${args.action}". Available: define, list, run, status, suggest.` }
          }
        },
      }),

      agentic_pr: tool({
        description: "Generate a pull request description from the execution plan, all step results, and files changed. Use `action: 'create'` to actually open a PR via GitHub CLI (`gh`).",
        args: {
          title: tool.schema.string().optional().describe("Override the PR title (defaults to the plan goal)"),
          action: tool.schema.enum(["generate", "create"]).optional().describe("'generate' returns PR body (default); 'create' opens actual PR via gh CLI"),
          baseBranch: tool.schema.string().optional().describe("Base branch for PR creation (default: main)"),
        },
        async execute(args, context) {
          llmEngine.setSessionId(context.sessionID)
          llmEngine.setToolContext('agentic_pr')
          const session = sessionStore.getOrCreate(context.sessionID)
          const allFiles = executor.getAllFilesModified(context.sessionID)

          if (!session.plan) {
            return { output: "No plan found. Create a plan with `agentic_plan` first." }
          }

          const steps = session.plan.intent.subtasks.map(s => {
            const stepState = executor.getStepState(context.sessionID, s.id)
            return {
              id: s.id,
              description: s.description,
              success: stepState?.result?.success ?? false,
            }
          })

          const pr = git.generatePRDescription(args.title ?? session.plan.intent.goal, steps, allFiles)

          // LLM-enhanced summary if available
          let enhancedSummary = pr.summary
          let enhancedTestPlan = pr.testPlan
          let llmUsed = false

          try {
            const hasLLM = await llmEngine.call({
              systemPrompt: "You are a PR description assistant. Respond with just 'OK' to confirm availability.",
              userPrompt: "Confirm you are available.",
              maxTokens: 10,
              temperature: 0,
            }).catch(() => null)

            if (hasLLM && hasLLM.content && !hasLLM.content.includes("[NO_LLM]")) {
              const diffContext = git.getDiff("main").slice(0, 3000) || allFiles.join(", ")

              const llmSummary = await llmEngine.call({
                systemPrompt: "You are a senior engineer writing a PR description. Respond as JSON with keys: summary (concise description of what was done and why), changes (array of bullet-point changes), testPlan (steps to verify), notes (any caveats or follow-up items). Be specific and technical.",
                userPrompt: `## Goal\n${pr.title}\n\n## Files Changed\n${allFiles.map(f => `- ${f}`).join("\n")}\n\n## Steps Executed\n${steps.map(s => `${s.success ? "[DONE]" : "[FAIL]"} ${s.description}`).join("\n")}\n\n## Diff Context\n${diffContext}\n\nGenerate PR description summary, changes list, and test plan.`,
                jsonMode: true,
                temperature: 0.3,
                maxTokens: 1024,
              })

              if (llmSummary.content && !llmSummary.content.includes("[NO_LLM]")) {
                const parsed = JSON.parse(llmSummary.content)
                if (parsed.summary) enhancedSummary = parsed.summary
                if (Array.isArray(parsed.changes)) {
                  pr.changes = parsed.changes
                }
                if (parsed.testPlan) enhancedTestPlan = parsed.testPlan
                if (parsed.notes) pr.notes = parsed.notes
                llmUsed = true
              }
            }
          } catch { /* non-fatal — fall back to template */ }

          let output = `## 📋 PR Description${llmUsed ? " (LLM-enhanced)" : ""}\n\n`
          output += `---\ntitle: ${pr.title}\n---\n\n`
          output += `## Summary\n\n${enhancedSummary}\n\n`
          output += `## Changes\n\n${pr.changes.map(c => `- ${c}`).join("\n")}\n\n`
          output += `## Files Changed\n\n${allFiles.map(f => `- \`${f}\``).join("\n")}\n\n`
          output += `## Test Plan\n\n${enhancedTestPlan}\n\n`

          if (pr.breakingChanges) {
            output += `## ⚠️ Breaking Changes\n\nSome steps failed. Review carefully before merging.\n\n`
          }

          if (pr.notes) {
            output += `## 📝 Notes\n\n${pr.notes}\n\n`
          }

          output += `## Steps Executed\n\n`
          output += steps.map(s =>
            `- ${s.success ? "✅" : "❌"} **${s.id}** — ${s.description}`
          ).join("\n")

          // Auto-commit if git available
          const allSuccess = steps.every(s => s.success)
          let commitInfo = null
          if (allSuccess && allFiles.length > 0 && git.isAvailable()) {
            commitInfo = git.commit(`feat: ${pr.title}`, allFiles)
          }

          if (commitInfo) {
            output += `\n\n## 🔖 Auto-commit\n\n`
            output += `**Commit:** \`${commitInfo.hash.slice(0, 7)}\`\n`
            output += `**Message:** ${commitInfo.message}\n`
            output += `**Files:** ${commitInfo.files.length}\n`
          }

          // Create actual PR
          if (args.action === "create") {
            const prBody = `${pr.summary}\n\n## Changes\n${pr.changes.join("\n")}\n\n## Test Plan\n${pr.testPlan}`
            const base = args.baseBranch ?? "main"
            const prResult = git.createPR(pr.title, prBody, base)
            if (prResult) {
              output += `\n\n## 🚀 PR Created\n\n`
              output += `**URL:** ${prResult.url}\n`
              output += `**Number:** #${prResult.number}\n`
              output += `**Branch:** ${prResult.branch}\n`
            } else {
              output += `\n\n## ⚠️ PR Creation Failed\n\n`
              output += `Make sure \`gh\` CLI is installed and authenticated: \`gh auth login\`\n`
            }
          }

          traceLogger.log({
            step: "pr",
            input: pr.title,
            output: `${steps.length} steps, ${allFiles.length} files`,
            toolUsed: "agentic_pr",
            success: true,
            durationMs: 0,
            metadata: { commitHash: commitInfo?.hash, prCreated: args.action === "create" },
          })

          return { output }
        },
      }),

      agentic_score: tool({
        description: "Score the current changeset for technical debt. Analyzes coupling, file size, scope, and code patterns. Use before completing to ensure code quality.",
        args: {
          files: tool.schema.array(tool.schema.string()).optional().describe("Specific files to score (defaults to all modified files)"),
        },
        async execute(args, context) {
          const allFiles = executor.getAllFilesModified(context.sessionID)
          const files = args.files ?? allFiles

          if (files.length === 0) {
            return { output: "No files modified yet. Complete some steps first." }
          }

          const contents = new Map<string, string>()
          for (const file of files) {
            try {
              contents.set(file, readFileSync(file, "utf-8"))
            } catch {
              contents.set(file, `[Unable to read ${file}]`)
            }
          }

          const session = sessionStore.getOrCreate(context.sessionID)
          const score = debtScorer.score(session.plan?.intent.goal ?? "Unknown", files, contents)

          let output = `## 📊 Tech Debt Score: **${score.overall.toUpperCase()}**\n\n`
          output += `**Issues found:** ${score.totalIssues}\n\n`
          output += `### Breakdown\n\n`

          for (const cat of score.breakdown) {
            const bar = "█".repeat(Math.min(cat.score, 10)) + "░".repeat(Math.max(10 - cat.score, 0))
            output += `**${cat.category}** \`[${bar}]\` ${cat.score}/10\n`
            for (const issue of cat.issues) {
              output += `  - ${issue}\n`
            }
            output += "\n"
          }

          output += `### Suggestion\n${score.suggestion}\n`

          traceLogger.log({
            step: "score",
            input: `${files.length} files`,
            output: score.overall,
            toolUsed: "agentic_score",
            success: true,
            durationMs: 0,
            metadata: { overall: score.overall, totalIssues: score.totalIssues },
          })

          return { output }
        },
      }),

      agentic_delegate: tool({
        description: "Assign a task to a specialized agent role (architect/developer/qa/coordinator/pm). Supports pipeline-aware delegation with cross-validation between stages and inter-agent messaging.",
        args: {
          taskId: tool.schema.string().describe("Unique ID for this delegated task"),
          description: tool.schema.string().describe("What this agent should do"),
          role: tool.schema.enum(["architect", "developer", "qa", "coordinator", "pm"]).optional().describe("Target role (auto-detected if omitted)"),
          context: tool.schema.string().optional().describe("Additional context or instructions for the agent"),
          pipelineRunId: tool.schema.string().optional().describe("Pipeline run ID (format: `run-{sessionID}-{pipelineId}`). Links this task into the ID chain: sessionID ⊃ pipelineRunId ⊃ taskId ⊃ stepId"),
          result: tool.schema.string().optional().describe("Task result (set when completing a task to trigger downstream stages and cross-validation)"),
          status: tool.schema.enum(["pending", "running", "done", "failed"]).optional().describe("Set the task status"),
          requestReview: tool.schema.boolean().optional().describe("Request review from a downstream role after completing this task"),
        },
        async execute(args, context) {
          const allTasks = coordinator.getTasks(context.sessionID)

          // If result is provided, we're completing a task
          if (args.result || args.status) {
            const updated = await coordinator.updateTask(context.sessionID, args.taskId, args.status ?? "done", args.result)
            if (!updated) return { output: `Task "${args.taskId}" not found.` }

            // Write to shared memory
            await coordinator.writeSharedMemory(`task:${args.taskId}`, (args.result ?? "").slice(0, 500), args.role ?? "unknown")

            let output = `## ✅ Task Updated\n\n`
            output += `**Task:** \`${args.taskId}\` → **${args.status ?? "done"}**\n`
            if (args.result) output += `**Result:** ${args.result.slice(0, 300)}\n\n`

            // Pipeline: advance to next stage
            if (args.pipelineRunId) {
              const pipelineId = args.pipelineRunId.replace(`run-${context.sessionID}-`, "")
              const pipeline = orchestrator.getPipeline(pipelineId)
              if (pipeline) {
                const stageIssues: string[] = []
                const nextStage = orchestrator.advanceStage(args.pipelineRunId, args.result ?? "", stageIssues)
                const allResults = orchestrator.getAllStageResults(args.pipelineRunId)

                if (nextStage) {
                  const pipelineContext = orchestrator.buildContextForRole(nextStage.role, args.pipelineRunId, coordinator.getAllSharedMemory())

                  output += `### ▶ Pipeline Advancing\n`
                  output += `**Next stage:** ${nextStage.role} — ${nextStage.description}\n\n`

                  // Auto-send message to next agent
                  coordinator.sendMessage({
                    from: args.role ?? "coordinator",
                    to: nextStage.role,
                    taskId: args.taskId,
                    type: "result",
                    payload: `Stage ${args.role} completed. Next: ${nextStage.role}.\n\nContext:\n${pipelineContext}`,
                  })

                  output += `**Context forwarded** to \`${nextStage.role}\` via message bus.\n`
                } else {
                  output += `### 🎉 Pipeline Complete\nAll stages finished!\n`

                  // Run final cross-validation
                  const finalValidation = await orchestrator.crossValidate(
                    "coordinator",
                    "Pipeline completed",
                    allResults,
                  )
                  output += `\n### Cross-Validation\n**Status:** ${finalValidation.passed ? "✅ Passed" : "❌ Issues found"}\n`
                  output += `**Summary:** ${finalValidation.summary}\n`
                  if (finalValidation.issues.length > 0) {
                    output += finalValidation.issues.map(i =>
                      `- [${i.severity}] ${i.description} (from ${i.source})`
                    ).join("\n")
                  }
                }

                // Cross-validate: auto-check against previous stages
                if (args.status === "done" && allResults.size > 1) {
                  const validation = await orchestrator.crossValidate(
                    args.role ?? "unknown",
                    args.result ?? "",
                    allResults,
                  )
                  if (validation.issues.length > 0) {
                    output += `\n### 🔍 Cross-Validation Notes\n`
                    for (const issue of validation.issues) {
                      output += `- [${issue.severity}] ${issue.description}\n`
                    }
                  }
                }
              }
            }

            // Request review from next logical role
            if (args.requestReview && args.result) {
              const reviewRole = args.role === "developer" ? "qa" : args.role === "architect" ? "developer" : "qa"
              coordinator.sendMessage({
                from: args.role ?? "developer",
                to: reviewRole,
                taskId: args.taskId,
                type: "review_request",
                payload: `Review requested for task "${args.taskId}".\n\nResult:\n${args.result.slice(0, 1000)}`,
              })
              output += `\n### 📨 Review Requested\n**Reviewer:** ${reviewRole}\n**Message sent** via inter-agent message bus.\n`
            }

            traceLogger.log({
              step: "delegate:update",
              input: args.taskId,
              output: `→ ${args.status}`,
              toolUsed: "agentic_delegate",
              success: true,
              durationMs: 0,
            })

            return { output }
          }

          // Normal delegation flow (LLM-based role suggestion, Gap #6)
          const role: AgentRole = args.role ?? await coordinator.getSuggestedRole(args.description, llmEngine)
          const agent = coordinator.getAgent(role)
          if (!agent) {
            return { output: `Unknown role "${role}". Available: architect, developer, qa, coordinator.` }
          }

          const contextWithMemory = args.context ?? args.description

          // Auto-load relevant skills from skill store (Gap #4: skill-aware delegation)
          const relevantSkills = skillStore.find(args.description).slice(0, 3).map(s => ({
            name: s.definition.meta.name,
            successRate: s.successRate,
            steps: s.definition.workflow.steps.map(st => `${st.action}: ${st.description}`).join("; "),
          }))

          coordinator.delegate(role, {
            id: args.taskId,
            assignedTo: role,
            description: args.description,
            input: contextWithMemory,
            status: "running",
            pipelineRunId: args.pipelineRunId,
          }, context.sessionID, 0, relevantSkills)

          // Build pipeline context if part of a pipeline run
          let pipelineContext = ""
          if (args.pipelineRunId) {
            pipelineContext = orchestrator.buildContextForRole(role, args.pipelineRunId, coordinator.getAllSharedMemory())
          }

          // Check for pending messages for this role
          const pendingMessages = coordinator.getMessages(role, true)

          // ── Actual Agent Execution via Isolated AgentRuntime ──
          const sessionModelPref = sessionStore.getModelPreference(context.sessionID, role)
          const agentCtx = {
            systemPrompt: agent.prompt ?? `You are a ${role} in a software engineering team.`,
            sessionId: context.sessionID,
            role,
            taskDescription: contextWithMemory,
            pipelineContext: pipelineContext || undefined,
            pendingMessages: pendingMessages.length > 0 ? pendingMessages.map(m => ({ from: m.from, payload: m.payload })) : undefined,
            sharedMemory: coordinator.getAllSharedMemory().map(e => ({ key: e.key, value: e.value, writtenBy: e.writtenBy })),
            modelPreference: sessionModelPref || undefined,
          }
          const agentResultObj = await agentRuntime.execute(agentCtx)
          const agentResult = agentResultObj.success ? agentResultObj.output : ""
          const executionError = agentResultObj.success ? null : (agentResultObj.error ?? "Agent execution failed")

          if (agentResult) {
            await coordinator.updateTask(context.sessionID, args.taskId, "done", agentResult)
            await coordinator.writeSharedMemory(`task:${args.taskId}`, agentResult.slice(0, 500), role)
            await coordinator.writeSharedMemory(`task:${args.taskId}:full`, agentResult, role)
          } else {
            await coordinator.updateTask(context.sessionID, args.taskId, "failed", executionError ?? "LLM unavailable")
          }

          let output = `## 🤖 Task Delegated\n\n`
          output += `**Task:** \`${args.taskId}\`\n`
          output += `**Role:** ${role} (${agent.name})\n`
          output += `**Description:** ${args.description}\n`
          output += `**Status:** ${agentResult ? "✅ Done" : executionError ? "❌ Failed" : "⚠️ Unknown"}\n`
          if (agentResult) {
            output += `**Result:** ${agentResult.slice(0, 500)}\n`
          } else if (executionError) {
            output += `**Error:** ${executionError.slice(0, 200)}\n`
          }
          output += `**Agent Prompt:**\n\`\`\`\n${(agent.prompt ?? "No prompt available").slice(0, 400)}\n\`\`\`\n\n`

          // Model suggestion — check session preference first, then fall through
          let suggestedModel: string
          let modelLabel: string

          if (sessionModelPref) {
            // Session-seeded model preference (Gap: per-role model selection)
            suggestedModel = sessionModelPref
            modelLabel = `${suggestedModel} (session preference)`
            modelRegistry.addModel(suggestedModel)
          } else {
            const suggestedCategory = roleRegistry.suggestModel(role)
            const suggestedModels = modelRegistry.suggestWithFallback(role, [suggestedCategory])
            suggestedModel = suggestedModels.length > 0 ? suggestedModels[0] : suggestedCategory
            modelLabel = suggestedModel !== suggestedCategory ? `${suggestedModel} (${suggestedCategory})` : suggestedModel
          }
          output += `**Model Used:** ${modelLabel}\n`
          if (agent.model) output += `**Configured Model:** ${agent.model}\n`

          // Model reliability info
          const modelScore = modelRegistry.getScore(suggestedModel)
          if (modelScore) {
            if (modelScore.totalCalls > 0) {
              const icon = modelScore.status === "healthy" ? "✅" : modelScore.status === "degraded" ? "⚠️" : "❌"
              output += `**Model Status:** ${icon} ${modelScore.status} (reliability: ${(modelScore.reliability * 100).toFixed(0)}%, hallucinations: ${(modelScore.hallucinationRate * 100).toFixed(0)}%)\n`
            } else {
              output += `**Model Status:** No reliability data yet (new model)\n`
            }
          }

          if (args.pipelineRunId) {
            output += `**Pipeline Run:** \`${args.pipelineRunId}\`\n`
          }

          if (agentResult) {
            output += `\n### Agent Output\n\`\`\`\n${agentResult.slice(0, 2000)}\n\`\`\`\n`
          } else if (executionError) {
            output += `\n### Execution Error\n${executionError}\n`
          }

          if (pendingMessages.length > 0) {
            output += `\n### 📨 Pending Messages (${pendingMessages.length})\n`
            for (const msg of pendingMessages) {
              output += `- From **${msg.from}**: ${msg.payload.slice(0, 200)}\n`
            }
          }

          output += `\n### Active Tasks (${allTasks.length + 1})\n`
          output += [...coordinator.getTasks(context.sessionID)].map(t =>
            `- ${t.status === "done" ? "✅" : t.status === "failed" ? "❌" : "⏳"} **${t.id}** → ${t.assignedTo}: ${t.description}`
          ).join("\n")

          // Pipeline: auto-advance if part of pipeline
          if (agentResult && args.pipelineRunId) {
            const pipelineId = args.pipelineRunId.replace(`run-${context.sessionID}-`, "")
            const pipeline = orchestrator.getPipeline(pipelineId)
            if (pipeline) {
              const stageIssues: string[] = []
              const nextStage = orchestrator.advanceStage(args.pipelineRunId, agentResult, stageIssues)
              const allResults = orchestrator.getAllStageResults(args.pipelineRunId)
              if (nextStage) {
                const nextCtx = orchestrator.buildContextForRole(nextStage.role, args.pipelineRunId, coordinator.getAllSharedMemory())
                coordinator.sendMessage({
                  from: role, to: nextStage.role, taskId: args.taskId,
                  type: "result",
                  payload: `Stage ${role} completed. Next: ${nextStage.role}.\n\nContext:\n${nextCtx}`,
                })
                output += `\n### Pipeline: Next Stage\n▶ **${nextStage.role}** — ${nextStage.description}\n`
              } else {
                output += `\n### 🎉 Pipeline Complete\nAll stages finished!\n`
                const finalValidation = await orchestrator.crossValidate("coordinator", "Pipeline completed", allResults)
                output += `**Cross-Validation:** ${finalValidation.passed ? "✅ Passed" : "❌ Issues"}\n`
              }
            }
          }

          traceLogger.log({
            step: "delegate",
            input: args.taskId,
            output: `→ ${role}: ${agentResult ? "done" : "failed"}`,
            toolUsed: "agentic_delegate",
            success: !!agentResult,
            durationMs: 0,
          })

          return { output }
        },
      }),

      agentic_message: tool({
        description: "Inter-agent messaging system. Send messages between agent roles, request reviews, check inbox, and view conversation threads. Part of the multi-agent coordination framework.",
        args: {
          action: tool.schema.enum(["send", "inbox", "conversation", "mark-read"]).describe("'send' to send a message; 'inbox' to check messages; 'conversation' to view a thread; 'mark-read' to acknowledge a message"),
          to: tool.schema.string().optional().describe("Recipient role (for send action)"),
          taskId: tool.schema.string().optional().describe("Task ID this message relates to (for send/conversation)"),
          message: tool.schema.string().optional().describe("Message content (for send action)"),
          type: tool.schema.enum(["result", "review_request", "review_response", "clarification", "approval", "revision"]).optional().describe("Message type (for send action)"),
          messageId: tool.schema.string().optional().describe("Message ID to mark as read (for mark-read action)"),
        },
        async execute(args, context) {
          switch (args.action) {
            case "send": {
              if (!args.to || !args.message) return { output: "`to` and `message` required." }
              const msg = coordinator.sendMessage({
                from: context.agent ?? "user",
                to: args.to,
                taskId: args.taskId ?? "general",
                type: args.type ?? "clarification",
                payload: args.message,
              })
              return {
                output: `## 📨 Message Sent\n\n**From:** ${msg.from}\n**To:** ${msg.to}\n**Type:** ${msg.type}\n**ID:** \`${msg.id}\`\n\n${msg.payload.slice(0, 500)}`,
              }
            }

            case "inbox": {
              const role = context.agent ?? "user"
              const messages = coordinator.getMessages(role, true)
              if (messages.length === 0) return { output: "📭 No unread messages." }

              let out = `## 📬 Inbox (${messages.length} unread)\n\n`
              for (const msg of messages) {
                out += `**${msg.type.toUpperCase()}** from **${msg.from}** [\`${msg.id}\`]\n`
                out += `Task: \`${msg.taskId}\` | ${new Date(msg.timestamp).toLocaleTimeString()}\n`
                out += `> ${msg.payload.slice(0, 200)}\n\n`
              }
              return { output: out }
            }

            case "conversation": {
              if (!args.taskId) return { output: "taskId required." }
              const thread = coordinator.getConversation(args.taskId)
              if (thread.length === 0) return { output: `No messages for task "${args.taskId}".` }

              let out = `## 💬 Conversation: \`${args.taskId}\`\n\n`
              for (const msg of thread) {
                const icon = msg.type === "approval" ? "✅" : msg.type === "review_request" ? "🔍" : msg.type === "revision" ? "🔄" : "💬"
                out += `${icon} **${msg.from}** → **${msg.to}** (${msg.type})\n`
                out += `> ${msg.payload.slice(0, 300)}\n\n`
              }
              return { output: out }
            }

            case "mark-read": {
              if (!args.messageId) return { output: "messageId required." }
              const ok = coordinator.markRead(args.messageId)
              return { output: ok ? `✅ Message \`${args.messageId}\` marked as read.` : `Message \`${args.messageId}\` not found.` }
            }

            default:
              return { output: `Unknown action "${args.action}". Available: send, inbox, conversation, mark-read.` }
          }
        },
      }),

      agentic_skill: tool({
        description: "Manage reusable skills extracted from successful task completions. Use 'extract' to create a skill from a completed step. Use 'find' to search existing skills. Use 'capability' for exact-match lookup.",
        args: {
          action: tool.schema.enum(["extract", "find", "list", "capability"]).describe("'extract' creates a skill; 'find' searches; 'list' shows all; 'capability' exact-match lookup"),
          query: tool.schema.string().optional().describe("Search query, extraction target (stepId), or capability string"),
        },
        async execute(args, context) {
          if (args.action === "extract") {
            const stepId = args.query
            if (!stepId) return { output: "Provide a stepId as query to extract a skill from." }

            const stepState = executor.getStepState(context.sessionID, stepId)
            if (!stepState?.result) return { output: `No execution record for step "${stepId}".` }

            const skill = await skillStore.extract({
              role: "tool",
              content: stepState.result.output,
            })

            if (!skill) return { output: `Could not extract a skill from step "${stepId}". The output pattern is not recognized.` }

            persistence.save("skills", skill.definition.meta.id, skill.definition)

            let out = `## 🧠 Skill Extracted\n\n**Name:** ${skill.definition.meta.name}\n**Pattern:** \`${skill.definition.trigger.pattern}\`\n**Steps:** ${skill.definition.workflow.steps.length}\n**Success rate:** ${(skill.successRate * 100).toFixed(0)}%\n`
            if (skill.definition.trigger.capability) out += `**Capability:** \`${skill.definition.trigger.capability}\`\n`
            if (skill.definition.input_schema) out += `**Input Schema:** ${Object.keys(skill.definition.input_schema).length} fields\n`
            if (skill.definition.output_schema) out += `**Output Schema:** ${Object.keys(skill.definition.output_schema).length} fields\n`
            if (skill.definition.logic) out += `**DSL Logic:** ${skill.definition.logic.instructions.length} instructions\n`
            out += `\n\`\`\`\n${skill.definition.workflow.steps.map(s => s.description).join("\n")}\n\`\`\``
            return { output: out }
          }

          if (args.action === "capability") {
            if (!args.query) return { output: "Provide a capability string (e.g. 'auth.login')." }
            const skill = skillStore.findByCapability(args.query)
            if (!skill) return { output: `No skill with capability "${args.query}".` }
            let out = `## 🎯 Skill by Capability: "${args.query}"\n\n`
            out += `**Name:** ${skill.definition.meta.name}\n`
            out += `**Success rate:** ${(skill.successRate * 100).toFixed(0)}% (${skill.usageCount} uses)\n`
            out += `**Pattern:** \`${skill.definition.trigger.pattern}\`\n`
            if (skill.definition.input_schema) out += `**Input Schema:** ${Object.keys(skill.definition.input_schema).length} fields\n`
            if (skill.definition.output_schema) out += `**Output Schema:** ${Object.keys(skill.definition.output_schema).length} fields\n`
            if (skill.definition.logic) out += `**DSL Logic:** ${skill.definition.logic.instructions.length} instructions\n`
            out += `\n### Workflow\n`
            out += skill.definition.workflow.steps.map(s => `${s.order}. **${s.action}** — ${s.description}`).join("\n")
            return { output: out }
          }

          if (args.action === "find") {
            if (!args.query) return { output: "Provide a search query." }
            const skills = skillStore.find(args.query)
            if (skills.length === 0) return { output: `No skills found for "${args.query}".` }
            let output = `## 🔍 Skills Matching "${args.query}"\n\n`
            output += skills.map(s => {
              let line = `- **${s.definition.meta.name}** (${(s.successRate * 100).toFixed(0)}% success, ${s.usageCount} uses)\n  Pattern: \`${s.definition.trigger.pattern}\``
              if (s.definition.trigger.capability) line += `\n  Capability: \`${s.definition.trigger.capability}\``
              if (s.definition.logic) line += `\n  DSL: ${s.definition.logic.instructions.length} instructions`
              if (s.definition.input_schema) line += `\n  Input: ${Object.keys(s.definition.input_schema).length} fields`
              return line
            }).join("\n")
            return { output }
          }

          const skills = skillStore.getAll()
          if (skills.length === 0) return { output: "No skills yet. Complete tasks and use `action: \"extract\"` to build the skill library." }

          let output = `## 🧠 Skill Library (${skills.length})\n\n`
          output += skills.map(s => {
            let line = `- **${s.definition.meta.name}** — ${(s.successRate * 100).toFixed(0)}% (${s.usageCount} uses)`
            if (s.definition.trigger.capability) line += ` [${s.definition.trigger.capability}]`
            return line
          }).join("\n")
          return { output }
        },
      }),

      agentic_model: tool({
        description: "Configure per-role, per-tool, or per-category LLM model preferences. Use 'set' to assign a model. Use 'get' to check current assignment. Use 'list' to view all. Use 'clear' to remove. Accepts `role`, `tool`, or `category` parameter. Preferences are persisted to .agentic/models.json.",
        args: {
          action: tool.schema.enum(["set", "get", "list", "clear"]).describe("Action: set/get/list/clear model preference"),
          role: tool.schema.string().optional().describe("Agent role (architect, developer, qa, coordinator, pm)"),
          tool: tool.schema.string().optional().describe("Tool name (e.g. 'agentic_plan')"),
          category: tool.schema.string().optional().describe("Complexity category (quick, unspecified-low, unspecified-high, deep)"),
          model: tool.schema.string().optional().describe("Model name (e.g. 'gpt-4o', 'claude-sonnet-4-20250514')"),
        },
        async execute(args, context) {
          const projectDir = ctxDir(context)

          // ── Persistence helpers (new nested format) ──
          const modelsPath = join(projectDir, ".agentic", "models.json")

          // Built-in default preferences (kosong — fallback ke engine default model)
          const BUILTIN_DEFAULTS: PersistedPrefs = {}

          interface PersistedPrefs {
            [key: string]: unknown
            tools?: Record<string, string>
            categories?: Record<string, string>
            $schema?: string
          }

          /** Read project .agentic/models.json */
          function readProjectPrefs(): PersistedPrefs {
            try {
              if (existsSync(modelsPath)) {
                return JSON.parse(readFileSync(modelsPath, "utf-8"))
              }
            } catch { /* corrupt or missing */ }
            return {}
          }

          /** Plugin's built-in default preferences */
          function readPluginDefaults(): PersistedPrefs {
            return BUILTIN_DEFAULTS
          }

          /** Apply prefs to session store (skip empty/undefined/description values) */
          const META_KEYS = new Set(['tools', 'categories', '$schema', 'description'])
          function applyPrefsToSession(prefs: PersistedPrefs): void {
            const sid = context.sessionID
            // Load role prefs (flat keys, excluding meta keys like 'tools', 'categories', 'description')
            for (const [key, val] of Object.entries(prefs)) {
              if (META_KEYS.has(key)) continue
              if (typeof val === 'string' && val.length > 0) {
                sessionStore.setModelPreference(sid, key, val)
              }
            }
            // Load tool prefs
            if (prefs.tools) {
              for (const [tool, model] of Object.entries(prefs.tools)) {
                if (typeof model === 'string' && model.length > 0) {
                  sessionStore.setToolPreference(sid, tool, model)
                }
              }
            }
            // Load category prefs
            if (prefs.categories) {
              for (const [cat, model] of Object.entries(prefs.categories)) {
                if (typeof model === 'string' && model.length > 0) {
                  sessionStore.setCategoryPreference(sid, cat, model)
                }
              }
            }
          }

          function writeProjectPrefs(prefs: PersistedPrefs): void {
            try {
              const dir = dirname(modelsPath)
              mkdirSync(dir, { recursive: true })
              writeFileSync(modelsPath, JSON.stringify(prefs, null, 2), "utf-8")
            } catch { /* non-fatal */ }
          }

          // On first access, load: plugin defaults → project overrides
          function ensureSessionLoaded(): void {
            const existing = sessionStore.getAllModelPreferences(context.sessionID)
            if (existing.length === 0) {
              // 1. Plugin defaults (lower priority)
              const defaults = readPluginDefaults()
              applyPrefsToSession(defaults)
              // 2. Project overrides (higher priority — overwrites same keys)
              const overrides = readProjectPrefs()
              applyPrefsToSession(overrides)
            }
          }

          if (args.action === "list") {
            ensureSessionLoaded()
            const sid = context.sessionID
            const rolePrefs = sessionStore.getAllModelPreferences(sid)
            const toolPrefs = sessionStore.getAllToolPreferences(sid)
            const catPrefs = sessionStore.getAllCategoryPreferences(sid)

            let output = "## 🎯 Model Preferences\n\n"

            if (rolePrefs.length === 0 && toolPrefs.length === 0 && catPrefs.length === 0) {
              output += "No model preferences configured. Use `agentic_model set role=... model=...` or `agentic_model set tool=... model=...` or `agentic_model set category=... model=...`.\n"
            } else {
              if (rolePrefs.length > 0) {
                output += "### 👤 Per-Role\n| Role | Model |\n|------|-------|\n"
                output += rolePrefs.map(p => `| **${p.role}** | \`${p.model}\` |`).join("\n") + "\n\n"
              }
              if (toolPrefs.length > 0) {
                output += "### 🔧 Per-Tool\n| Tool | Model |\n|------|-------|\n"
                output += toolPrefs.map(p => `| **${p.tool}** | \`${p.model}\` |`).join("\n") + "\n\n"
              }
              if (catPrefs.length > 0) {
                output += "### 📊 Per-Category\n| Category | Model |\n|----------|-------|\n"
                output += catPrefs.map(p => `| **${p.category}** | \`${p.model}\` |`).join("\n") + "\n\n"
              }
              const projectPrefs = readProjectPrefs()
              const pluginPrefs = readPluginDefaults()
              const projCount = Object.keys(projectPrefs).filter(k => k !== 'tools' && k !== 'categories' && k !== '$schema').length +
                (projectPrefs.tools ? Object.keys(projectPrefs.tools).length : 0) +
                (projectPrefs.categories ? Object.keys(projectPrefs.categories).length : 0)
              const pluginCount = Object.keys(pluginPrefs).filter(k => k !== 'tools' && k !== 'categories' && k !== '$schema').length +
                (pluginPrefs.tools ? Object.keys(pluginPrefs.tools).length : 0) +
                (pluginPrefs.categories ? Object.keys(pluginPrefs.categories).length : 0)
              if (projCount > 0) {
                output += `💾 ${projCount} preference(s) in project \`.agentic/models.json\`\n`
              }
              if (pluginCount > 0) {
                output += `📦 ${pluginCount} default preference(s) from plugin defaults\n`
              }
              if (projCount === 0 && pluginCount === 0) {
                output += "Preferences are session-only (not yet persisted)"
              }
              output += "\n\n**Resolution priority:** per-tool override → category fallback → engine default"
            }

            // Also show available models from OpenCode
            try {
              const ocModels = await llmEngine.listOpenCodeModels()
              if (ocModels.length > 0) {
                output += `\n\n### 🧠 Available Models (from OpenCode)\n`
                const byProvider = new Map<string, string[]>()
                for (const m of ocModels) {
                  const list = byProvider.get(m.providerName) ?? []
                  list.push(`\`${m.id}\``)
                  byProvider.set(m.providerName, list)
                }
                for (const [provider, models] of byProvider) {
                  output += `- **${provider}**: ${models.join(", ")}\n`
                }
                output += `\nUse \`action:"set"\` to assign any of these to a role, tool, or category.`
              }
            } catch { /* silent */ }

            return { output }
          }

          if (args.action === "set") {
            if (!args.model) return { output: "Provide a `model` name (e.g. 'gpt-4o', 'claude-sonnet-4-20250514')." }
            if (!args.role && !args.tool && !args.category) {
              return { output: "Provide a `role`, `tool`, or `category` to assign the model to." }
            }

            modelRegistry.addModel(args.model)

            if (args.tool) {
              const toolLower = args.tool.toLowerCase()
              sessionStore.setToolPreference(context.sessionID, toolLower, args.model)
              // Persist
              const persisted = readProjectPrefs()
              if (!persisted.tools) persisted.tools = {}
              persisted.tools[toolLower] = args.model
              writeProjectPrefs(persisted)
              return { output: `✅ Tool model preference set: **${toolLower}** → \`${args.model}\`\nAll LLM calls from \`${toolLower}\` will use this model.\n💾 Persisted to \`.agentic/models.json\`` }
            }

            if (args.category) {
              const catLower = args.category.toLowerCase()
              sessionStore.setCategoryPreference(context.sessionID, catLower, args.model)
              // Persist
              const persisted = readProjectPrefs()
              if (!persisted.categories) persisted.categories = {}
              persisted.categories[catLower] = args.model
              writeProjectPrefs(persisted)
              return { output: `✅ Category model preference set: **${catLower}** → \`${args.model}\`\nAll tools in this category will use this model.\n💾 Persisted to \`.agentic/models.json\`` }
            }

            if (args.role) {
              const roleLower = args.role.toLowerCase()
              sessionStore.setModelPreference(context.sessionID, roleLower, args.model)
              modelRegistry.registerAlias(roleLower, [args.model])
              // Persist
              const persisted = readProjectPrefs()
              persisted[roleLower] = args.model
              writeProjectPrefs(persisted)
              return { output: `✅ Role model preference set: **${roleLower}** → \`${args.model}\`\nThis model will be used when delegating to the ${roleLower} role.\n💾 Persisted to \`.agentic/models.json\`` }
            }

            return { output: "Unknown target. Use `role`, `tool`, or `category`." }
          }

          if (args.action === "get") {
            ensureSessionLoaded()
            if (!args.role && !args.tool && !args.category) {
              return { output: "Provide a `role`, `tool`, or `category` to check." }
            }

            if (args.tool) {
              const model = sessionStore.getToolPreference(context.sessionID, args.tool)
              if (!model) return { output: `No model preference set for tool "${args.tool}". Uses category fallback or default.` }
              const persisted = readProjectPrefs()
              const isPersisted = persisted.tools?.[args.tool.toLowerCase()] === model
              return { output: `**${args.tool}** → \`${model}\`${isPersisted ? " 💾 (persisted)" : ""}` }
            }

            if (args.category) {
              const model = sessionStore.getCategoryPreference(context.sessionID, args.category)
              if (!model) return { output: `No model preference set for category "${args.category}". Uses engine default.` }
              const persisted = readProjectPrefs()
              const isPersisted = persisted.categories?.[args.category.toLowerCase()] === model
              return { output: `**${args.category}** → \`${model}\`${isPersisted ? " 💾 (persisted)" : ""}` }
            }

            if (args.role) {
              const model = sessionStore.getModelPreference(context.sessionID, args.role)
              if (!model) return { output: `No model preference set for role "${args.role}". Delegation will use default model selection.` }
              const persisted = readProjectPrefs()
              const isPersisted = persisted[args.role] === model
              return { output: `**${args.role}** → \`${model}\`${isPersisted ? " 💾 (persisted)" : ""}` }
            }

            return { output: "Unknown target." }
          }

          if (args.action === "clear") {
            if (args.tool) {
              sessionStore.clearToolPreference(context.sessionID, args.tool)
              const persisted = readProjectPrefs()
              if (persisted.tools) delete persisted.tools[args.tool.toLowerCase()]
              writeProjectPrefs(persisted)
              return { output: `Cleared model preference for tool "${args.tool}".` }
            }

            if (args.category) {
              sessionStore.clearCategoryPreference(context.sessionID, args.category)
              const persisted = readProjectPrefs()
              if (persisted.categories) delete persisted.categories[args.category.toLowerCase()]
              writeProjectPrefs(persisted)
              return { output: `Cleared model preference for category "${args.category}".` }
            }

            if (args.role) {
              sessionStore.clearModelPreference(context.sessionID, args.role)
              const persisted = readProjectPrefs()
              delete persisted[args.role]
              writeProjectPrefs(persisted)
              return { output: `Cleared model preference for role "${args.role}".` }
            }

            // Clear all
            const sid = context.sessionID
            sessionStore.clearModelPreference(sid)
            sessionStore.clearToolPreference(sid)
            sessionStore.clearCategoryPreference(sid)
            writeProjectPrefs({})
            return { output: "Cleared all model preferences (roles, tools, and categories) for this session." }
          }

          return { output: "Unknown action. Use 'set', 'get', 'list', or 'clear'." }
        },
      }),

      agentic_model_reset: tool({
        description: "Reset model statistics to recover from degraded performance. Use 'reset' to clear stats for a specific model. Use 'reset-stale' to auto-reset models not used in 7+ days. Use 'reset-all' for emergency recovery.",
        args: {
          action: tool.schema.enum(["reset", "reset-stale", "reset-all"]).describe("Action: reset (single model), reset-stale (auto-detect old models), reset-all (emergency)"),
          model: tool.schema.string().optional().describe("Model name (required for 'reset' action)"),
          staleDays: tool.schema.number().optional().describe("Days threshold for stale detection (default: 7)"),
        },
        async execute(args, _context) {
          if (args.action === "reset") {
            if (!args.model) return { output: "Provide a `model` name to reset (e.g. 'gpt-4o')." }
            
            const beforeScore = modelRegistry.getScore(args.model)
            const deleted = modelRegistry.deleteModel(args.model)
            
            return { 
              output: `✅ Removed \`${args.model}\` from registry\n\n**Before:** ${beforeScore ? `${(beforeScore.reliability * 100).toFixed(0)}% reliability, ${beforeScore.totalCalls} calls` : "No data"}\n**After:** ${deleted ? "Removed (call count will rebuild naturally)" : "Not found"}` 
            }
          }

          if (args.action === "reset-stale") {
            const staleDays = args.staleDays ?? 7
            const resetModels = modelRegistry.resetStaleModels(staleDays)
            
            if (resetModels.length === 0) {
              return { output: `No stale models found (threshold: ${staleDays} days unused).` }
            }
            
            return { output: `✅ Reset ${resetModels.length} stale model(s):\n${resetModels.map(m => `- \`${m}\``).join("\n")}\n\nThese models had not been used in ${staleDays}+ days.` }
          }

          if (args.action === "reset-all") {
            const allScores = modelRegistry.getAllScores()
            for (const score of allScores) {
              modelRegistry.deleteModel(score.model)
            }
            return { output: `⚠️ **EMERGENCY RESET:** Removed statistics for ${allScores.length} model(s).\n\nAll models now have clean slate. Use this only when all models are blocked.` }
          }

          return { output: "Unknown action. Use 'reset', 'reset-stale', or 'reset-all'." }
        },
      }),

      agentic_budget: tool({
        description: "Set, view, or reset resource budget limits. Prevents runaway loops by capping tokens, steps, time, or cost. Acts as circuit breaker for autonomous execution. Use 'set' to define limits, 'status' to view usage, 'reset' to clear counters.",
        args: {
          action: tool.schema.enum(["set", "get", "status", "reset"]).describe("'set' defines limits; 'get' shows current limits; 'status' shows usage; 'reset' clears counters"),
          scope: tool.schema.enum(["session", "task"]).optional().describe("Scope: 'session' (default) or 'task'"),
          maxTokens: tool.schema.number().optional().describe("Maximum total tokens (input+output+cache+reasoning)"),
          maxSteps: tool.schema.number().optional().describe("Maximum subtask steps"),
          maxTimeMs: tool.schema.number().optional().describe("Maximum wall-clock time in milliseconds"),
          maxCostUsd: tool.schema.number().optional().describe("Maximum cost in USD"),
          onExceeded: tool.schema.enum(["hard-stop", "request-approval", "warn"]).optional().describe("Behavior when limit exceeded (default: hard-stop)"),
          modelPrices: tool.schema.record(tool.schema.string(), tool.schema.object({
            input: tool.schema.number(),
            output: tool.schema.number(),
            cacheRead: tool.schema.number().optional(),
            cacheWrite: tool.schema.number().optional(),
          })).optional().describe("Optional per-model price overrides (USD per 1K tokens)"),
        },
        async execute(args, _context) {
          const scope = args.scope ?? "session"

          switch (args.action) {
            case "set": {
              const limits: Partial<import("./core/budget-tracker.js").BudgetLimits> = {}
              if (args.maxTokens !== undefined) limits.maxTokens = args.maxTokens
              if (args.maxSteps !== undefined) limits.maxSteps = args.maxSteps
              if (args.maxTimeMs !== undefined) limits.maxTimeMs = args.maxTimeMs
              if (args.maxCostUsd !== undefined) limits.maxCostUsd = args.maxCostUsd
              const behavior = args.onExceeded ?? "hard-stop"

              if (Object.keys(limits).length === 0) {
                return { output: "Provide at least one limit (maxTokens, maxSteps, maxTimeMs, or maxCostUsd)." }
              }

              budgetTracker.setLimits(scope, limits, behavior)

              // Override model prices jika dikirim
              if (args.modelPrices) {
                const normalized: Record<string, import("./core/budget-tracker.js").ModelPriceEntry> = {}
                for (const [modelId, price] of Object.entries(args.modelPrices)) {
                  normalized[modelId] = {
                    input: price.input,
                    output: price.output,
                    cacheRead: price.cacheRead ?? 0,
                    cacheWrite: price.cacheWrite ?? 0,
                  }
                }
                budgetTracker.setModelPrices(normalized)
              }

              const limitStr = Object.entries(limits)
                .map(([k, v]) => `${k}: ${v === Infinity ? "∞" : v}`)
                .join(", ")
              return { output: `✅ Budget limits set for scope="${scope}": ${limitStr} (behavior: ${behavior})` }
            }

            case "get": {
              const limits = budgetTracker.getLimits(scope)
              const behavior = args.onExceeded ?? "hard-stop"
              const limitStr = Object.entries(limits)
                .map(([k, v]) => `${k}: ${v === Infinity ? "∞" : v}`)
                .join(", ")
              return { output: `📊 Budget limits for scope="${scope}": ${limitStr} (behavior: ${behavior})` }
            }

            case "status": {
              const states = budgetTracker.getState([scope])
              const state = states[0]
              const usage = state.usage
              let output = `## 💰 Budget Status (${scope})\n\n`

              output += `| Metric | Usage | Limit |\n|---|---|---|\n`
              output += `| Tokens | ${usage.totalTokens.toLocaleString()} | ${state.limits.maxTokens === Infinity ? "∞" : state.limits.maxTokens.toLocaleString()} |\n`
              output += `| Steps | ${usage.totalSteps} | ${state.limits.maxSteps === Infinity ? "∞" : state.limits.maxSteps} |\n`
              output += `| Time | ${(usage.elapsedMs / 1000).toFixed(1)}s | ${state.limits.maxTimeMs === Infinity ? "∞" : (state.limits.maxTimeMs / 1000).toFixed(1) + "s"} |\n`
              output += `| Cost | $${usage.totalCostUsd.toFixed(4)} | ${state.limits.maxCostUsd === Infinity ? "∞" : "$" + state.limits.maxCostUsd.toFixed(2)} |\n`

              if (usage.byModel.length > 0) {
                output += `\n### Per-Model Breakdown\n\n`
                output += `| Model | In | Out | Reason | Cache R | Cache W | Cost |\n|---|---|---|---|---|---|---|\n`
                for (const m of usage.byModel) {
                  output += `| ${m.modelId} | ${m.inputTokens.toLocaleString()} | ${m.outputTokens.toLocaleString()} | ${m.reasoningTokens.toLocaleString()} | ${m.cacheReadTokens.toLocaleString()} | ${m.cacheWriteTokens.toLocaleString()} | $${m.cost.toFixed(4)} |\n`
                }
              }

              if (usage.waitingForApprovalMs > 0) {
                output += `\n⏳ Waiting for approval: ${(usage.waitingForApprovalMs / 1000).toFixed(1)}s\n`
              }

              if (state.exceeded) {
                output += `\n⚠️ **BUDGET EXCEEDED** — ${state.exceeded.metric} (${state.exceeded.current} / ${state.exceeded.limit})\n`
              }

              return { output }
            }

            case "reset": {
              budgetTracker.reset(scope)
              return { output: `🔄 Budget counters reset for scope="${scope}". Limits preserved.` }
            }

            default:
              return { output: "Unknown action. Use 'set', 'get', 'status', or 'reset'." }
          }
        },
      }),

      agentic_episodes: tool({
        description: "Browse cross-session memory. Search past tasks, patterns, and knowledge across all 4 memory levels (working/episodic/semantic/procedural). Use before planning similar tasks to avoid repeating mistakes.",
        args: {
          action: tool.schema.enum(["search", "recent", "stats"]).describe("'search' finds relevant past tasks; 'recent' shows latest; 'stats' shows summary"),
          query: tool.schema.string().optional().describe("Search query (for 'search' action)"),
          levels: tool.schema.array(tool.schema.string()).optional().describe("Memory levels to search (default: all). E.g. ['episodic', 'semantic']"),
          minImportance: tool.schema.number().optional().describe("Minimum importance threshold (0-1, default: 0)"),
        },
        async execute(args, _context) {
          if (args.action === "search") {
            if (!args.query) return { output: "Provide a search query." }

            // Try MemoryOrchestrator cross-level search first (if levels specified or all)
            const useOrchLevels = args.levels && args.levels.length > 0
            if (useOrchLevels || args.minImportance !== undefined) {
              const validLevels = (args.levels ?? []).filter(l =>
                ["working", "episodic", "semantic", "procedural"].includes(l))
              const result = memoryOrchestrator.query({
                query: args.query,
                levels: validLevels.length > 0 ? validLevels as any : undefined,
                minImportance: args.minImportance ?? 0,
                maxResults: 15,
              })
              if (result.entries.length === 0) return { output: `No results found for "${args.query}" across levels: ${(args.levels ?? ["all"]).join(", ")}.` }
              let output = `## 🧠 Memory Search: "${args.query}"\n\n`
              output += `*Searched levels: ${result.sources.join(", ")}* (${result.totalTime}ms)\n\n`
              for (const entry of result.entries) {
                const levelIcon = { working: "💼", episodic: "🧠", semantic: "📚", procedural: "🔧" }[entry.level] ?? "📄"
                const impBar = "█".repeat(Math.round(entry.importance * 10)) + "░".repeat(Math.max(0, 10 - Math.round(entry.importance * 10)))
                output += `${levelIcon} **${entry.level}** — ${entry.id}\n`
                output += `  ${entry.content.slice(0, 120)}${entry.content.length > 120 ? "..." : ""}\n`
                output += `  Importance: ${impBar} (${(entry.importance * 100).toFixed(0)}%) | Keywords: ${entry.keywords.slice(0, 5).join(", ")}\n`
              }
              return { output }
            }

            // Original path: episodic-only TF-IDF search (backward compat)
            const localEpisodes = episodicStore.getRecent(50)
            const allEpisodes = [...localEpisodes]
            const seenIds = new Set(localEpisodes.map(e => e.id))

            // Load episode dari project lain dari global store
            try {
              const scopes = persistence.listScopes("episodes")
              for (const scope of scopes) {
                if (scope === projectId) continue
                const globalEps = persistence.loadAll<{ planGoal: string; outcome: string; decisions: string[]; filesChanged: string[]; sessionId: string; timestamp: string; tags: string[]; projectId?: string }>("episodes", scope)
                for (const ep of globalEps) {
                  if (!seenIds.has(ep.data.sessionId)) {
                    seenIds.add(ep.data.sessionId)
                    allEpisodes.push({
                      id: ep.data.sessionId,
                      sessionId: ep.data.sessionId,
                      projectId: ep.data.projectId ?? scope,
                      planGoal: ep.data.planGoal,
                      outcome: ep.data.outcome as "success" | "partial" | "failed",
                      decisions: ep.data.decisions,
                      filesChanged: ep.data.filesChanged,
                      tags: ep.data.tags ?? [],
                      timestamp: ep.data.timestamp,
                      score: 0,
                      usageCount: 0,
                      summary: ep.data.planGoal,
                    })
                  }
                }
              }
            } catch { /* non-fatal — search tetap jalan dari local */ }

            // Index all episodes into TF-IDF vector store
            for (const ep of allEpisodes) {
              multiIndexRAG.vectorStore.index({
                id: `ep:${ep.sessionId}`,
                category: "general",
                title: ep.planGoal,
                content: `${ep.outcome} ${ep.decisions.join(" ")}`,
                keywords: ep.tags,
                metadata: { type: "episode", sessionId: ep.sessionId, outcome: ep.outcome, projectId: ep.projectId },
              })
            }
            const tfidfResults = multiIndexRAG.vectorStore.search(args.query, "general", 5)
            const episodeIds = new Set(tfidfResults.map(r => r.doc.id))
            const episodes = allEpisodes.filter(e => episodeIds.has(`ep:${e.sessionId}`))
            if (episodes.length === 0) return { output: `No episodes found for "${args.query}".` }
            let output = `## 🧠 Episodic Memory: "${args.query}"\n\n`
            output += episodes.map(e => {
              const score = tfidfResults.find(r => r.doc.id === `ep:${e.sessionId}`)?.score.toFixed(2) ?? "?"
              const projTag = e.projectId && e.projectId !== projectId ? ` 📁 ${e.projectId}` : ""
              return `- **${e.outcome === "success" ? "✅" : e.outcome === "partial" ? "⚠️" : "❌"} ${e.planGoal}**${projTag}\n  Score: ${score} | Files: ${(e.filesChanged ?? []).length} | ${e.timestamp.slice(0, 10)}`
            }).join("\n")
            return { output }
          }

          if (args.action === "recent") {
            const episodes = episodicStore.getRecent(10)
            if (episodes.length === 0) return { output: "No episode history yet." }
            let output = `## 📜 Recent Episodes\n\n`
            output += episodes.map(e =>
              `- ${e.timestamp.slice(0, 10)} — **${e.outcome.toUpperCase()}**: ${e.planGoal.slice(0, 80)}`
            ).join("\n")
            return { output }
          }

          const stats = episodicStore.getStats()
          return {
            output: `## 📊 Episode Stats\n\n**Total sessions:** ${stats.total}\n**Successful:** ${stats.successful}\n**Partial:** ${stats.partial}\n**Failed:** ${stats.failed}\n\nSuccess rate: ${stats.total > 0 ? ((stats.successful / stats.total) * 100).toFixed(0) : 0}%`,
          }
        },
      }),

      agentic_parallel: tool({
        description: "Analyze or run steps concurrently. Use action: `analyze` to see parallelism opportunities. Use action: `execute` to run ready steps in parallel. Does NOT replace agentic_execute — only orchestrates concurrent runs.",
        args: {
          action: tool.schema.enum(["analyze", "execute"]).optional().describe("'analyze' shows parallelism plan; 'execute' runs ready steps concurrently (does not replace agentic_execute for step execution)"),
          opencodePath: tool.schema.string().optional().describe("Path to `opencode` binary for sub-process spawn (execute mode)"),
          abortOnFailure: tool.schema.boolean().optional().describe("Stop all tasks in phase if one fails (default: false)"),
        },
        async execute(args, context) {
          llmEngine.setSessionId(context.sessionID)
          llmEngine.setToolContext('agentic_parallel')
          const session = sessionStore.getOrCreate(context.sessionID)
          if (!session.plan) return { output: "No plan found. Create one with `agentic_plan` first." }

          const subtasks = session.plan.intent.subtasks
          const completed = executor.getCompletedSteps(context.sessionID)
          const plan = parallelExec.analyzeParallelism(subtasks)

          if (args.action === "execute") {
            const readySteps = subtasks.filter(s =>
              !completed.includes(s.id) &&
              s.dependsOn.every(d => completed.includes(d))
            )
            if (readySteps.length === 0) {
              return { output: "No ready steps to execute. All steps are either completed or blocked by dependencies." }
            }

            const cwd = ctxDir(context)

            let stepRunner: import("./core/parallel.js").StepRunner
            if (args.opencodePath) {
              stepRunner = (step) => parallelExec.executeWithSubprocessSpawn(step, args.opencodePath!, cwd, context.sessionID)
            } else {
              stepRunner = async (step) => {
                const taskId = `parallel-${step.id}-${Date.now()}`
                coordinator.delegate("developer", {
                  id: taskId, assignedTo: "developer",
                  description: step.description, input: step.description,
                  status: "running",
                }, context.sessionID, 0)

                const sharedMem = coordinator.getAllSharedMemory()
                const memCtx = sharedMem.length > 0
                  ? `\nShared context:\n${sharedMem.slice(-3).map(e => `- ${e.key}: ${e.value.slice(0, 200)}`).join("\n")}`
                  : ""

                try {
                  const resp = await llmEngine.call({
                    systemPrompt: `You are a developer implementing step ${step.id}. Return JSON with: "files": [{path, content}], "summary": "what was done"`,
                    userPrompt: `Goal: ${session.plan!.intent.goal}\nStep: ${step.description}${memCtx}`,
                    jsonMode: true, temperature: 0.3, maxTokens: 2048,
                  })
                  let impl: { files?: Array<{ path: string; content: string }>; summary?: string }
                  try { impl = JSON.parse(resp.content) } catch {
                    await coordinator.updateTask(context.sessionID, taskId, "failed", resp.content)
                    return { stepId: step.id, success: false, error: "LLM JSON parse error", output: resp.content, filesModified: [] }
                  }
                  const files: string[] = []
                  for (const f of impl.files ?? []) {
                    const abs = join(cwd, f.path)
                    mkdirSync(dirname(abs), { recursive: true })
                    writeFileSync(abs, f.content, "utf-8")
                    files.push(f.path)
                  }
                  await coordinator.updateTask(context.sessionID, taskId, "done", impl.summary)
                  return { stepId: step.id, success: true, output: impl.summary ?? step.description, filesModified: files }
                } catch (e) {
                  await coordinator.updateTask(context.sessionID, taskId, "failed", (e as Error).message)
                  return { stepId: step.id, success: false, error: (e as Error).message, output: "", filesModified: [] }
                }
              }
            }

            const { results, durationMs } = await parallelExec.executePlanConcurrently(
              plan, stepRunner, args.abortOnFailure ?? false,
            )

            for (const r of results) {
              executor.recordResult(context.sessionID, {
                stepId: r.stepId,
                success: r.success,
                output: r.output ?? "",
                filesModified: r.filesModified,
                error: r.error,
              })
            }

            traceLogger.log({
              step: "parallel:execute",
              input: `${readySteps.length} steps`,
              output: `${results.filter(r => r.success).length}/${results.length} passed`,
              toolUsed: "agentic_parallel",
              success: results.every(r => r.success),
              durationMs,
              metadata: { total: results.length, passed: results.filter(r => r.success).length },
            })

            let output = `## ⚡ Parallel Execution Complete (${(durationMs / 1000).toFixed(1)}s)\n\n`
            output += `**Steps executed:** ${readySteps.length}\n`
            output += `**Passed:** ${results.filter(r => r.success).length}\n`
            output += `**Failed:** ${results.filter(r => !r.success).length}\n\n`

            for (const r of results) {
              const icon = r.success ? "✅" : "❌"
              output += `${icon} **${r.stepId}** — ${r.output?.slice(0, 120) ?? "no output"}\n`
              if (r.error) output += `   Error: ${r.error.slice(0, 200)}\n`
            }

            const progress = executor.getProgress(context.sessionID)
            output += `\n### Overall Progress\n`
            output += `✅ ${progress.completed}/${progress.total} | ❌ ${progress.failed} | ⏳ ${progress.total - progress.completed - progress.failed}`

            return { output, metadata: { results, durationMs } }
          }

          // Analyze mode (default)
          let output = `## ⚡ Parallel Execution Plan\n\n`
          output += `**Max parallelism:** ${plan.maxParallelism}\n`
          output += `**Phases:** ${plan.phases.length}\n\n`

          output += `| Phase | Steps | Parallel |\n|-------|-------|----------|\n`
          for (const phase of plan.phases) {
            const stepIds = phase.steps.map(s => s.id).join(", ")
            output += `| ${phase.index + 1} | ${stepIds} | ${phase.canRunInParallel ? "✅" : "🔒"} |\n`
          }

          const suggestions = parallelExec.suggestParallelTasks(subtasks, completed)
          if (suggestions.length > 1) {
            output += `\n### Currently Runnable\n`
            const groups = new Map<number, string[]>()
            for (const s of suggestions) {
              const list = groups.get(s.parallelGroup) ?? []
              list.push(s.taskId)
              groups.set(s.parallelGroup, list)
            }
            for (const [group, tasks] of groups) {
              const label = tasks.length > 1 ? `🟢 Parallel group ${group}` : `🟡 Sequential`
              output += `- **${label}**: ${tasks.map(t => `\`${t}\``).join(", ")}\n`
            }
            output += `\nRun \`agentic_parallel\` with \`action: "execute"\` to run these steps concurrently.`
          }

          const allFiles = new Map<string, string[]>()
          for (const step of subtasks) {
            const stepState = executor.getStepState(context.sessionID, step.id)
            if (stepState?.result?.filesModified) {
              allFiles.set(step.id, stepState.result.filesModified)
            }
          }
          const conflicts = parallelExec.detectConflicts(
            suggestions.map(s => s.taskId),
            allFiles,
          )
          if (conflicts.length > 0) {
            output += `\n### ⚠️ Potential Conflicts\n`
            for (const c of conflicts) {
              output += `- \`${c.taskA}\` ⚔️ \`${c.taskB}\` both touch \`${c.conflictingFile}\`\n`
            }
          }

          return { output }
        },
      }),

      agentic_dashboard: tool({
        description: "Generate an observability dashboard from execution traces. Shows timeline, statistics, tool usage, anomaly detection, and model reliability (timeouts, retry storms, silent failures).",
        args: {},
        async execute(_args, _context) {
          // Always show model reliability regardless of trace data
          const modelReliability = modelRegistry.getSummary()
          let traceSection = ""

          // Read traces from file
          await traceLogger.flush()
          const tracePath = `${worktree}/.agentic/trace.jsonl`
          let traces = []
          try {
            const content = readFileSync(tracePath, "utf-8")
            traces = content.trim().split("\n").filter(Boolean).map(l => JSON.parse(l))
          } catch { /* no traces yet */ }

          if (traces.length > 0) {
            const data = dashboard.generate(traces, Date.now(), {
              skillStore: {
                getAll: () => skillStore.getAll(),
                getLifecycleStats: () => skillStore.getLifecycleStats(),
                get size() { return skillStore.size },
              },
              constraintManifold: {
                snapshot: () => constraintManifold.snapshot(),
                getActiveModifications: () => constraintManifold.getActiveModifications(),
                getRecentViolations: () => constraintManifold.getRecentViolations(),
              },
              semanticCacheStats: llmEngine.getSemanticCacheStats(),
              modelRegistry: {
                getAllScores: () => modelRegistry.getAllScores(),
              },
            })
            traceSection = dashboard.formatForDisplay(data)
          }

          let output = traceSection || "### 📊 Execution Overview\n\nNo trace data available yet. Execute some steps first.\n"
          output += `\n### 🤖 Model Reliability\n${modelReliability}\n`

          // List models yang tersedia di OpenCode SDK
          try {
            const ocModels = await llmEngine.listOpenCodeModels()
            if (ocModels.length > 0) {
              output += `\n### 🧠 Available Models (from OpenCode)\n`
              const byProvider = new Map<string, string[]>()
              for (const m of ocModels) {
                const list = byProvider.get(m.providerName) ?? []
                list.push(`\`${m.id}\``)
                byProvider.set(m.providerName, list)
              }
              for (const [provider, models] of byProvider) {
                output += `- **${provider}**: ${models.join(", ")}\n`
              }
            }
          } catch { /* silent */ }

          // Cross-session pattern discovery
          const allEpisodes = episodicStore.getRecent(200)
          if (allEpisodes.length >= 3) {
            const allSkills = skillStore.getAll().map(s => ({
              name: s.definition.meta.name,
              successRate: s.successRate,
              usageCount: s.usageCount,
            }))
            const report = patternDiscovery.analyze(allEpisodes, [], allSkills)

            if (report.errorPatterns.length > 0 || report.recommendations.length > 0) {
              output += `\n### 🔍 Cross-Session Patterns (${report.totalSessions} sessions)\n`

              if (report.errorPatterns.length > 0) {
                output += `\n**Recurring Errors:**\n`
                for (const ep of report.errorPatterns.slice(0, 3)) {
                  output += `- \`${ep.category}\`: ${ep.sessionCount}/${report.totalSessions} sessions (${(ep.sessionAffinity * 100).toFixed(0)}%)\n`
                }
              }

              if (report.filePatterns.some(f => f.isHotSpot)) {
                output += `\n**Hot Spot Files:**\n`
                for (const fp of report.filePatterns.filter(f => f.isHotSpot).slice(0, 3)) {
                  output += `- \`${fp.filePath}\`: modified in ${fp.sessionCount} sessions`
                  if (fp.coChangedFiles.length > 0) {
                    output += ` (co-changes: ${fp.coChangedFiles.slice(0, 2).map(c => `\`${c.filePath}\``).join(", ")})`
                  }
                  output += "\n"
                }
              }

              if (report.recommendations.length > 0) {
                const highRecs = report.recommendations.filter(r => r.priority === "high")
                if (highRecs.length > 0) {
                  output += `\n**⚠️ High Priority Recommendations:**\n`
                  for (const rec of highRecs.slice(0, 3)) {
                    output += `- ${rec.description}\n`
                  }
                }
              }
            }
          }

          // Live evaluation score
          const liveScore = liveEvaluator.computeScore()
          if (liveScore.totalSteps > 0 || liveScore.totalDelegations > 0) {
            output += `\n### 📊 Live Evaluation Score\n`
            output += liveEvaluator.formatReport(false)
          }

          return { output }
        },
      }),

      agentic_guard: tool({
        description: "MANUAL re-run of the hallucination guard. NOTE: Guard already runs automatically inside `agentic_execute` on every successful step (if `autoHallucinationCheck: true` in config). This standalone tool is only needed for: (a) re-checking an older step after files changed, (b) auditing a step that was executed while auto-check was disabled, or (c) getting a detailed per-claim breakdown. Do NOT call redundantly — the auto-check already ran.",
        args: {
          stepId: tool.schema.string().describe("The step ID whose output to verify (in ID chain: sessionID ⊃ stepId)"),
        },
        async execute(args, context) {
          const stepState = executor.getStepState(context.sessionID, args.stepId)
          if (!stepState?.result) return { output: `No execution record for step "${args.stepId}".` }

          const output = stepState.result.output
          const files = executor.getAllFilesModified(context.sessionID)
          const check = hallucinationGuard.check(output, files)

          if (!check.passed) {
            const guardModelId = await llmEngine.getOpenCodeModel()
            if (guardModelId && guardModelId !== "unknown") {
              modelRegistry.recordHallucination(guardModelId)
            }
          }

          let response = `## 🛡️ Hallucination Check: Step "${args.stepId}"\n\n`
          response += `**Verdict:** ${check.passed ? "✅ All claims verified" : "❌ Unverified claims found"}\n\n`
          response += `**Summary:** ${check.summary}\n\n`

          if (check.claims.length > 0) {
            response += `### Claims Checked\n\n`
            response += `| Claim | Type | Verified |\n|-------|------|----------|\n`
            for (const c of check.claims.slice(0, 20)) {
              const icon = c.verified ? "✅" : "❌"
              response += `| ${icon} ${c.claim.slice(0, 50)} | ${c.type} | ${c.actual ?? "?"} |\n`
            }
          }

          if (!check.passed) {
            response += `\n### ⚠️ Action Required\n`
            response += `The following claims could not be verified: \n`
            for (const c of check.claims.filter(c => !c.verified)) {
              response += `- "${c.claim}" — expected ${c.expected} but got ${c.actual}\n`
            }
            response += `\nDouble-check these before proceeding. The agent may be hallucinating about files/functions that don't exist.`
          }

          response += `\n### 🤖 Model Reliability\n`
          const guardModelStr = await llmEngine.getOpenCodeModel()
          const modelScore = modelRegistry.getScore(guardModelStr)
          if (modelScore && modelScore.totalCalls > 0) {
            const icon = modelScore.status === "healthy" ? "✅" : modelScore.status === "degraded" ? "⚠️" : "❌"
            response += `${icon} **${modelScore.model}** — reliability: ${(modelScore.reliability * 100).toFixed(0)}%, hallucinations: ${(modelScore.hallucinationRate * 100).toFixed(0)}%, calls: ${modelScore.totalCalls}\n`
          } else {
            response += `No data yet for current model.\n`
          }

          traceLogger.log({
            step: `guard:${args.stepId}`,
            input: args.stepId,
            output: check.summary,
            toolUsed: "agentic_guard",
            success: check.passed,
            durationMs: 0,
          })

          return { output: response }
        },
      }),

      agentic_evolve: tool({
        description: "Inspect and extend the agent system itself (Stage IV). Register custom agent roles, define versioned memory schemas, and export skills in self-describing format for other agents to consume.",
        args: {
          action: tool.schema.enum(["inspect", "register-role", "export-skill", "memory-schema", "evolve", "read-prompt", "edit-prompt", "prompt-history", "rollback-prompt", "export-training-data"]).describe("What to do: inspect system state, register a custom agent role, export a skill, view memory schema, run self-evolution, manage agent prompts (Stage IV), or export skills as training data for fine-tuning"),
          name: tool.schema.string().optional().describe("Role name or skill name (for register-role, export-skill)"),
          prompt: tool.schema.string().optional().describe("Agent prompt template (for register-role) or new instruction to append (for edit-prompt)"),
          tools: tool.schema.array(tool.schema.string()).optional().describe("Tools available to custom role"),
          skillId: tool.schema.string().optional().describe("Skill ID to export or inspect"),
          role: tool.schema.string().optional().describe("Agent role (for read-prompt, edit-prompt, prompt-history, rollback-prompt)"),
          version: tool.schema.number().optional().describe("Version number (for rollback-prompt)"),
          description: tool.schema.string().optional().describe("Description for the prompt change (for edit-prompt)"),
          format: tool.schema.enum(["openai", "instructions"]).optional().describe("Output format for training data (for export-training-data, default: openai)"),
          minSuccessRate: tool.schema.number().optional().describe("Minimum skill success rate to include (for export-training-data, default: 0.5)"),
          spec: tool.schema.string().optional().describe("Blueprint YAML/JSON spec (for register-role). Overrides prompt/tools with blueprint fields. Contoh: `spec=\"\"\"\\nagent:\\n  identity: 'You are a...'\\n  model_tiers:\\n    default: capable\\n  tools: [read, edit]\\n\"\"\"`"),
        },
        async execute(args, _context) {
          switch (args.action) {
            case "inspect": {
              const builtIn = roleRegistry.getAllBuiltIn()
              const custom = roleRegistry.getAllCustom()
              const migrations = schemaVersion.getMigrations()

              let out = `## 🔮 Agent System State (Stage IV)\n\n`
              out += `**Memory schema version:** ${MemorySchemaVersion.currentVersion()}\n`
              out += `**Registered migrations:** ${migrations.length}\n\n`
              out += `### Built-in Roles (${builtIn.length})\n`
              for (const r of builtIn) {
                out += `- **${r.name}** (\`${r.role}\`) — ${r.tools.length} tools\n`
              }
              if (custom.length > 0) {
                out += `\n### Custom Roles (${custom.length})\n`
                for (const r of custom) {
                  out += `- **${r.name}** (\`${r.role}\`) — ${r.tools.length} tools\n`
                }
              }
              out += `\n### Extensibility\n`
              out += `- Custom roles: \`agentic_evolve register-role\`\n`
              out += `- Export skills: \`agentic_evolve export-skill\`\n`
              out += `- Schema info: \`agentic_evolve memory-schema\`\n`
              return { output: out }
            }

            case "register-role": {
              // Blueprint mode: spec YAML/JSON → parse + register
              if (args.spec) {
                try {
                  const blueprint = blueprintParser.parse(args.spec)
                  const roleId = blueprint.metadata.name.toLowerCase().replace(/\s+/g, "-")

                  // Resolve model tiers → actual model recommendations
                  const allModels = modelRegistry.getAllScores().map(s => s.model)
                  const resolvedTiers = blueprintResolver.resolveBlueprint(blueprint, allModels.length > 0 ? allModels : ["default"])

                  const tierInfo = Object.entries(resolvedTiers)
                    .map(([tier, model]) => `  - **${tier}** → \`${model}\``)
                    .join("\n")

                  roleRegistry.registerCustom({
                    role: roleId,
                    name: blueprint.metadata.name,
                    prompt: blueprint.agent.identity,
                    tools: blueprint.agent.tools ?? ["read", "edit", "write", "bash", "agentic_verify", "agentic_skill"],
                  })

                  persistence.save("evolution", "trend", continuousEvolution.toJSON(), projectId)

                  let out = `### ✅ Blueprint Registered: **${blueprint.metadata.name}** (\`${roleId}\`)\n\n`
                  out += `**Identity:** ${blueprint.agent.identity.slice(0, 100)}...\n`
                  out += `\n**Model Tiers Resolved:**\n${tierInfo}\n`
                  if (blueprint.agent.capabilities?.length) {
                    out += `\n**Capabilities:** ${blueprint.agent.capabilities.join(", ")}\n`
                  }
                  if (blueprint.agent.safety?.max_steps) {
                    out += `\n**Safety:** max_steps=${blueprint.agent.safety.max_steps}\n`
                  }
                  out += `\nPakai: \`agentic_delegate role=${roleId}\``
                  out += `\nExport ke file: \`agentic_evolve export-blueprint name=${roleId}\``
                  return { output: out }
                } catch (e) {
                  return { output: `❌ Blueprint parse error: ${(e as Error).message}\n\nGunakan format YAML atau JSON yang valid. Contoh:\n\`\`\`yaml\nagent:\n  identity: \"You are a developer\"\n  model_tiers:\n    default: capable\n\`\`\`` }
                }
              }

              // Legacy mode: name + prompt + tools
              if (!args.name || !args.prompt) {
                return { output: "Both `name` and `prompt` are required to register a custom role.\n\nAtau gunakan `spec` parameter dengan blueprint format:\n`agentic_evolve register-role spec='{\"agent\":{\"identity\":\"...\",\"model_tiers\":{\"default\":\"capable\"}}}'`" }
              }
              const roleId = args.name.toLowerCase().replace(/\s+/g, "-")
              roleRegistry.registerCustom({
                role: roleId,
                name: args.name,
                prompt: args.prompt,
                tools: args.tools ?? ["read", "edit", "write", "bash"],
              })
              // Auto-save evolution trend after role registration
              persistence.save("evolution", "trend", continuousEvolution.toJSON(), projectId)
              return { output: `Custom role "${args.name}" registered as \`${roleId}\`. Available via \`agentic_delegate role=${roleId}\`.` }
            }

            case "export-skill": {
              const skillData = createSkillDefinition(
                args.name ?? "unnamed-skill",
                args.name ?? "generic pattern",
                args.tools ?? [],
                [{ action: "implement", description: args.name ?? "task", expectedOutput: "completed" }],
              )

              const json = serializeSkill(skillData)
              const inspection = inspectSkill(skillData)

              let out = inspection
              out += `\n\n### Machine-Readable Export (agentic-skill/v1)\n\`\`\`json\n${json}\n\`\`\``
              return { output: out }
            }

            case "memory-schema": {
              let out = `## 🧠 Memory Schema v${MemorySchemaVersion.currentVersion()}\n\n`
              out += `### Envelope Format\n\`\`\`ts\n${JSON.stringify(createMemoryEnvelope({ example: true }, "example"), null, 2)}\n\`\`\`\n\n`
              out += `### Registered Migrations\n`
              const migrations = schemaVersion.getMigrations()
              if (migrations.length === 0) {
                out += `No migrations registered yet. Schema v${MemorySchemaVersion.currentVersion()} is current.\n`
              } else {
                for (const m of migrations) {
                  out += `- v${m.from} → v${m.to}: ${m.description}\n`
                }
              }
              out += `\n### Upgrading\n`
              out += `Data is stored with \`schema_version\`. On read, the system auto-migrates from any version to current.\n`
              out += `New migrations can be registered via \`schemaVersion.registerMigration()\` in plugin code.\n`
              out += `\n### Compatibility\n`
              out += `All episodes, skills, and artifacts support schema evolution without data loss.\n`
              return { output: out }
            }

            case "evolve": {
              await traceLogger.flush()

              const allSkills = skillStore.getAll()
              const allEpisodes = episodicStore.getRecent(50)

              const uniqueSessions = new Set(allEpisodes.map(e => e.sessionId))
              let allTasks: AgentTask[] = []
              for (const sid of uniqueSessions) {
                allTasks = allTasks.concat(coordinator.getTasks(sid))
              }

              const allStepStates: Array<{ stepId: string; success: boolean; output: string }> = []
              for (const sid of uniqueSessions) {
                const session = sessionStore.getOrCreate(sid)
                const subtasks = session.plan?.intent.subtasks ?? []
                for (const step of subtasks) {
                  const state = executor.getStepState(sid, step.id)
                  if (state?.result) {
                    allStepStates.push({
                      stepId: step.id,
                      success: state.result.success,
                      output: state.result.output,
                    })
                  }
                }
              }

              const traces: Array<{ toolUsed: string; success: boolean; step: string }> = []
              const tracePath = `${worktree}/.agentic/trace.jsonl`
              try {
                const content = readFileSync(tracePath, "utf-8")
                for (const line of content.trim().split("\n").filter(Boolean)) {
                  const parsed = JSON.parse(line)
                  traces.push({
                    toolUsed: parsed.toolUsed ?? "unknown",
                    success: parsed.success ?? true,
                    step: parsed.step ?? "",
                  })
                }
              } catch { /* no traces yet */ }

              selfEvolver.feedSkills(allSkills)
              selfEvolver.feedEpisodes(allEpisodes)
              selfEvolver.feedTasks(allTasks)
              selfEvolver.feedStepStates(allStepStates)
              selfEvolver.feedTraces(traces)

              // Feed execution data to MetaReasoner (Comparison 22)
              for (const state of allStepStates) {
                metaReasoner.recordExecution({
                  taskId: state.stepId,
                  success: state.success,
                  retries: 0,
                  timestamp: Date.now(),
                })
              }
              const metaAdaptation = metaReasoner.adapt()

              const report = selfEvolver.evolve()

              // Auto-apply role suggestions
              const appliedRoles: string[] = []
              for (const role of report.roleSuggestions) {
                try {
                  coordinator.registerCustomRole({
                    role: role.name,
                    name: role.name,
                    tools: role.suggestedTools,
                    prompt: `You are ${role.name}. ${role.reason}\n\nTrigger: ${role.triggerPattern}`,
                  })
                  appliedRoles.push(role.name)
                } catch { /* non-fatal */ }
              }

              // Auto-apply skill patches
              const patchedSkills: string[] = []
              for (const patch of report.skillPatches) {
                const record = skillStore.getById(patch.skillId)
                if (!record) continue
                const def = record.definition
                let modified = false

                for (const change of patch.suggestedChanges) {
                  if (change.type === "add_rollback") {
                    for (const step of def.workflow.steps) {
                      if (!step.rollback) {
                        step.rollback = change.detail
                        modified = true
                      }
                    }
                  }
                  if (change.type === "add_step") {
                    const newStep: import("./memory/skill-format.js").SkillStep = {
                      order: def.workflow.steps.length + 1,
                      action: "verify",
                      description: change.detail,
                      expectedOutput: "Step completed successfully",
                    }
                    def.workflow.steps.push(newStep)
                    modified = true
                  }
                }

                if (modified) {
                  def.quality.usageCount = record.usageCount
                  def.quality.successRate = record.successRate
                  def.audit.lastModified = new Date().toISOString()
                  def.audit.modifiedBy = "system"
                  def.meta.version++
                  persistence.save("skills", def.meta.id, def)
                  patchedSkills.push(patch.skillName)
                }
              }

              let out = `## 🔮 Self-Evolution Report\n\n`
              out += `**Improvement Score:** ${report.improvementScore}/100\n`
              out += `**Sessions Analyzed:** ${report.metrics.totalSessions}\n`
              out += `**Steps Analyzed:** ${report.metrics.totalSteps}\n`
              out += `**Overall Success Rate:** ${(report.metrics.successRate * 100).toFixed(0)}%\n`
              out += `**Retry Rate:** ${(report.metrics.retryRate * 100).toFixed(0)}%\n\n`

              if (appliedRoles.length > 0) {
                out += `### ✅ Auto-Registered Roles\n`
                for (const name of appliedRoles) {
                  out += `- **${name}** — registered automatically\n`
                }
                out += `\n`
              }

              // Auto-apply prompt patches (Stage IV: versioned, source-tracked)
              const appliedPatches: string[] = []
              for (const patch of report.promptPatches) {
                try {
                  const existingPrompt = roleRegistry.getPrompt(patch.role)
                  if (existingPrompt && !existingPrompt.includes(patch.instruction.slice(0, 40))) {
                    const newPrompt = existingPrompt + `\n\n## Auto-Patched Instruction (from ${patch.errorCategory} errors)\n${patch.instruction}`
                    roleRegistry.updatePrompt(patch.role as "architect" | "developer" | "qa" | "coordinator" | "pm", newPrompt, "auto-evolve", `Patch from ${patch.errorCategory} errors (${patch.occurrences}x)`)
                    persistence.save("prompts", "state", roleRegistry.getAllPromptStates())
                    appliedPatches.push(`${patch.role}: "${patch.instruction.slice(0, 60)}..."`)
                  }
                } catch { /* non-fatal */ }
              }

              if (patchedSkills.length > 0) {
                out += `### ✅ Auto-Patched Skills\n`
                for (const name of patchedSkills) {
                  out += `- **${name}** — patched automatically\n`
                }
                out += `\n`
              }

              if (appliedPatches.length > 0) {
                out += `### ✅ Auto-Patched Prompts\n`
                for (const p of appliedPatches) {
                  out += `- ${p}\n`
                }
                out += `\n`
              }

              out += `### Recommendations\n`
              if (report.metrics.recommendations.length === 0) {
                out += `All metrics within healthy ranges. No changes recommended.\n`
              } else {
                for (const rec of report.metrics.recommendations) {
                  out += `- ${rec}\n`
                }
              }

              if (report.skillPatches.length > 0) {
                out += `\n### 🔧 Skill Patches (${report.skillPatches.length})\n`
                for (const patch of report.skillPatches) {
                  out += `\n**${patch.skillName}** — ${patch.failures} failures\n`
                  for (const change of patch.suggestedChanges) {
                    out += `- [${change.type}] ${change.description}\n`
                    out += `  → ${change.detail}\n`
                  }
                }
              }

              if (report.roleSuggestions.length > 0) {
                out += `\n### 👥 Role Suggestions (${report.roleSuggestions.length})\n`
                for (const role of report.roleSuggestions) {
                  out += `\n**${role.name}**\n`
                  out += `- Trigger: "${role.triggerPattern}"\n`
                  out += `- Tools: ${role.suggestedTools.map(t => `\`${t}\``).join(", ")}\n`
                  out += `- Reason: ${role.reason}\n`
                }
              }

              if (report.metrics.topErrorCategories.length > 0) {
                out += `\n### 📊 Top Error Categories\n`
                for (const err of report.metrics.topErrorCategories) {
                  out += `- **${err.category}**: ${err.count} occurrence(s)\n`
                }
              }

              if (report.promptPatches.length > 0) {
                out += `\n### 📝 Prompt Auto-Patches (${report.promptPatches.length})\n`
                for (const pp of report.promptPatches) {
                  const priorityIcon = pp.priority === "high" ? "🔴" : pp.priority === "medium" ? "🟡" : "🟢"
                  out += `${priorityIcon} **${pp.role}** — ${pp.errorCategory} (${pp.occurrences}x)\n`
                  out += `  → ${pp.instruction}\n`
                }
              }

              // Cross-session pattern discovery (Gap #3)
              const allSkillsForPd = skillStore.getAll().map(s => ({
                name: s.definition.meta.name,
                successRate: s.successRate,
                usageCount: s.usageCount,
              }))
              const patternReport = patternDiscovery.analyze(allEpisodes, [], allSkillsForPd)
              if (patternReport.recommendations.length > 0) {
                out += `\n### 🔍 Cross-Session Patterns\n`
                out += `**Total sessions analyzed:** ${patternReport.totalSessions}\n\n`

                const highRecs = patternReport.recommendations.filter(r => r.priority === "high")
                if (highRecs.length > 0) {
                  out += `**⚠️ High Priority (${highRecs.length})**\n`
                  for (const rec of highRecs) {
                    out += `- ${rec.description}\n`
                    out += `  → ${rec.action}\n`
                  }
                  out += "\n"
                }

                const medRecs = patternReport.recommendations.filter(r => r.priority === "medium")
                if (medRecs.length > 0) {
                  out += `**Medium Priority (${medRecs.length})**\n`
                  for (const rec of medRecs) {
                    out += `- ${rec.description}\n`
                  }
                  out += "\n"
                }

                if (patternReport.errorPatterns.length > 0) {
                  out += `**Error Patterns:**\n`
                  for (const ep of patternReport.errorPatterns) {
                    out += `- \`${ep.category}\`: ${ep.sessionCount}/${patternReport.totalSessions} sessions (${(ep.sessionAffinity * 100).toFixed(0)}%)\n`
                  }
                  out += "\n"
                }

                if (patternReport.filePatterns.some(f => f.isHotSpot)) {
                  out += `**Hot Spot Files:**\n`
                  for (const fp of patternReport.filePatterns.filter(f => f.isHotSpot).slice(0, 5)) {
                    out += `- \`${fp.filePath}\` → ${fp.sessionCount} sessions`
                    if (fp.coChangedFiles.length > 0) {
                      out += ` (co-changed: ${fp.coChangedFiles.map(c => `\`${c.filePath}\``).join(", ")}`
                    }
                    out += ")\n"
                  }
                }
              }

              // Meta-Reasoning Strategy Adaptation (Comparison 22)
              const metaStats = metaReasoner.getAdaptationStats()
              if (metaStats.totalRuns > 0) {
                out += `\n### 🧠 Meta-Reasoning Adaptation\n`
                out += `**Strategy:** \`${metaReasoner.getCurrentConfig().label}\` (v${metaReasoner.getCurrentVersion()})\n`
                out += `**Runs analyzed:** ${metaStats.totalRuns} | **Adaptations made:** ${metaStats.adaptationCount}\n`
                if (metaAdaptation.adapted) {
                  out += `\n**Params adapted this cycle:**\n`
                  for (const change of metaAdaptation.changes) {
                    out += `- \`${change.name}\`: ${change.from} → ${change.to} (${change.reason})\n`
                  }
                }
                if (metaAdaptation.rolledBack) {
                  out += `\n⚠️ **Rolled back** to previous strategy version\n`
                  for (const w of metaAdaptation.warnings) {
                    out += `- ${w}\n`
                  }
                }
                const metaPerf = metaReasoner.getCurrentPerformance()
                out += `\n**Current performance:** ${(metaPerf.successRate * 100).toFixed(0)}% success rate, ${metaPerf.avgRetries.toFixed(1)} avg retries\n`
              }

              // Auto-save evolution trend after evolve run
              persistence.save("evolution", "trend", continuousEvolution.toJSON(), projectId)
              persistence.save("evaluation", "live", liveEvaluator.toJSON(), projectId)
              return { output: out }
            }

            case "read-prompt": {
              const targetRole = args.role ?? "developer"
              const prompt = roleRegistry.getPrompt(targetRole)
              if (!prompt) return { output: `Role "${targetRole}" not found.` }
              const state = roleRegistry.getPromptState(targetRole)
              const ver = state?.currentVersion ?? 1
              return {
                output: `## 📖 Prompt for \`${targetRole}\` (v${ver})\n\n\`\`\`\n${prompt}\n\`\`\``,
              }
            }

            case "edit-prompt": {
              const targetRole = args.role ?? "developer"
              if (!args.prompt) return { output: "`prompt` (instruction to append) is required for edit-prompt." }
              const existingPrompt = roleRegistry.getPrompt(targetRole)
              if (!existingPrompt) return { output: `Role "${targetRole}" not found.` }
              const newPrompt = existingPrompt + `\n\n## Self-Patched Instruction (agent-driven)\n${args.prompt}`
              const updated = roleRegistry.updatePrompt(targetRole as "architect" | "developer" | "qa" | "coordinator" | "pm", newPrompt, "agent-self", args.description ?? "Agent self-modification")
              if (!updated) return { output: `Failed to update prompt for role "${targetRole}". Only built-in roles can be edited.` }
              persistence.save("prompts", "state", roleRegistry.getAllPromptStates())
              return {
                output: `✅ Prompt for \`${targetRole}\` updated (v${roleRegistry.getPromptState(targetRole)?.currentVersion}). New instruction appended at the end.`,
              }
            }

            case "prompt-history": {
              const targetRole = args.role ?? "developer"
              const history = roleRegistry.getPromptHistory(targetRole)
              if (history.length === 0) return { output: `No prompt history for "${targetRole}".` }
              let out = `## 📜 Prompt History for \`${targetRole}\`\n\n`
              for (const entry of history) {
                const preview = entry.prompt.slice(-200).replace(/\n/g, " ")
                out += `**v${entry.version}** — ${entry.timestamp} — source: ${entry.source}`
                if (entry.description) out += ` — ${entry.description}`
                out += `\n\`\`\`\n...${preview.slice(-200)}\n\`\`\`\n\n`
              }
              return { output: out }
            }

            case "rollback-prompt": {
              const targetRole = args.role ?? "developer"
              const version = args.version
              if (!version) return { output: "`version` is required for rollback-prompt." }
              const history = roleRegistry.getPromptHistory(targetRole)
              if (history.length === 0) return { output: `No prompt history for "${targetRole}".` }
              const target = history.find(e => e.version === version)
              if (!target) return { output: `Version ${version} not found for "${targetRole}". Available versions: ${history.map(e => `v${e.version}`).join(", ")}` }
              const ok = roleRegistry.rollbackPrompt(targetRole, version)
              if (!ok) return { output: `Failed to rollback prompt for "${targetRole}".` }
              persistence.save("prompts", "state", roleRegistry.getAllPromptStates())
              return {
                output: `✅ Prompt for \`${targetRole}\` rolled back to v${version} (from ${target.timestamp}).`,
              }
            }

            case "export-training-data": {
              const allSkills = skillStore.getAll()
              const fmt = args.format ?? "openai"
              const minRate = args.minSuccessRate ?? 0.5
              const dataset = skillsToTrainingData(allSkills, fmt, minRate)

              const filteredSkills = allSkills.filter(s => s.successRate >= minRate)
              const examples = filteredSkills.map(s => skillToTrainingExample(s))
              const summary = trainingDatasetSummary(examples)

              let out = summary
              out += `\n\n### Training Data (${dataset.format})\n`
              out += `\`\`\`\n${dataset.data.slice(0, 2000)}${dataset.data.length > 2000 ? "\n… (truncated)" : ""}\n\`\`\``
              if (dataset.data.length > 2000) {
                out += `\n\n**Full dataset:** ${dataset.data.length} characters, ${dataset.totalExamples} examples`
              }
              return { output: out }
            }

            default:
              return { output: `Unknown action: ${args.action}. Available: inspect, register-role, export-skill, memory-schema, evolve, read-prompt, edit-prompt, prompt-history, rollback-prompt, export-training-data.` }
          }
        },
      }),

      // ── Debate Loop: multi-agent analysis with executor ↔ critic ──
      agentic_debate: tool({
        description: "Debate loop between two agents (executor ↔ critic) for thorough analysis. Produces cleaner, more accurate results than a single LLM call. Best for complex analysis, data validation, and reviews.",
        args: {
          task: tool.schema.string().describe("The task or question to analyze in depth"),
          context: tool.schema.string().optional().describe("Additional context: data, files, requirements, or previous work"),
          maxRounds: tool.schema.number().optional().default(3).describe("Maximum debate rounds (default: 3, max: 5)"),
          format: tool.schema.enum(["markdown", "json"]).optional().default("json").describe("Output format: structured JSON or readable markdown"),
        },
        async execute(args, context) {
          llmEngine.setSessionId(context.sessionID)
          llmEngine.setToolContext('agentic_debate')
          const startTime = Date.now()

          // Model per-role di-resolve otomatis via toolName di debate-loop.ts:
          //   debate-executor → unspecified-high
          //   debate-critic   → deep
          //   debate-cleaner  → quick
          // Bisa di-override via: agentic_model set tool=debate-executor model="..."
          const maxRounds = Math.min(args.maxRounds ?? 3, 5)
          const result = await debateLoop.execute({
            task: args.task,
            context: args.context,
            maxRounds,
            format: args.format ?? "json",
          })

          // Record as episode for future learning
          try {
            episodicStore.record(
              context.sessionID,
              `Debate: ${args.task.slice(0, 100)}`,
              result.approved ? "success" : "partial",
              [`${result.totalRounds} rounds`, `Approved: ${result.approved}`, result.revisionSummary],
              [],
              domainRegistry.getCurrentDomain() ?? undefined,
              projectId,
            )
          } catch { /* non-fatal */ }

          // Try to extract skill if debate was successful
          if (result.approved) {
            try {
              skillStore.extract({
                role: "tool",
                content: `✅ Debate completed: ${args.task}\nRounds: ${result.totalRounds}\nFinal output:\n${result.finalOutput.slice(0, 500)}`,
              }, [args.task])
            } catch { /* non-fatal */ }
          }

          traceLogger.log({
            step: "execute",
            input: `Debate: ${args.task}`,
            output: result.approved ? "approved" : "not-approved",
            toolUsed: "agentic_debate",
            success: result.approved,
            durationMs: Date.now() - startTime,
          })

          return {
            output: `## 🗣️ Debate Result\n\n**Task:** ${args.task}\n**Status:** ${result.approved ? "✅ Approved" : "⚠️ Not fully resolved"} after ${result.totalRounds} round(s)\n**Revision:** ${result.revisionSummary}\n\n### Final Output\n\n${(args.format ?? "json") === "json" ? "```json\n" + result.finalOutput + "\n```" : result.finalOutput}`,
            metadata: { debateResult: result },
          }
        },
      }),

      // ── Router Agent: lightweight intent-to-category routing ──
      agentic_router: tool({
        description: "Lightweight intent classifier that routes user input to the right knowledge category, RAG index, and tools. Use before searching memory to scope results to relevant domain.",
        args: {
          input: tool.schema.string().describe("User input or query to classify"),
          categories: tool.schema.array(tool.schema.object({
            id: tool.schema.string(),
            name: tool.schema.string(),
            keywords: tool.schema.array(tool.schema.string()),
            description: tool.schema.string(),
          })).optional().describe("Optional custom categories (overrides defaults)"),
        },
        async execute(args, context) {
          llmEngine.setSessionId(context.sessionID)
          llmEngine.setToolContext('agentic_router')
          const startTime = Date.now()

          if (args.categories && Array.isArray(args.categories) && args.categories.length > 0) {
            routerAgent.setCategories(args.categories as import("./core/router-agent.js").RouteCategory[])
          }

          const route = await routerAgent.route(args.input)

          traceLogger.log({
            step: "execute",
            input: `Route: ${args.input}`,
            output: route.category,
            toolUsed: "agentic_router",
            success: true,
            durationMs: Date.now() - startTime,
          })

          const confidenceBar = "█".repeat(Math.round(route.confidence * 10)) + "░".repeat(10 - Math.round(route.confidence * 10))

          return {
            output: `## 🧭 Route Result\n\n**Input:** ${args.input}\n**Intent:** ${route.intent}\n**Category:** ${route.category}\n**Confidence:** ${(route.confidence * 100).toFixed(0)}% ${confidenceBar}\n**Method:** ${route.usedLlm ? "LLM Classification" : "Keyword Fallback"}\n**RAG Index:** ${route.suggestedRagIndex}\n**Reasoning:** ${route.reasoning}\n\n> 💡 Use \`agentic_episodes search "${route.suggestedRagIndex}: ${args.input}"\` to find relevant past sessions in this category.`,
            metadata: { route },
          }
        },
      }),

      // ── Layer 3: Data Cleaner — strip artifacts, validate structure ──
      agentic_clean: tool({
        description: "Clean raw text by stripping debate artifacts, reformatting to markdown/json, and optionally validating against a schema. Use after debate or any multi-step analysis to get clean output.",
        args: {
          text: tool.schema.string().describe("Raw text to clean"),
          format: tool.schema.enum(["markdown", "json", "text"]).optional().default("json").describe("Output format"),
          schema: tool.schema.string().optional().describe("Expected JSON schema description (e.g., 'array of {name, description}')"),
          stripDebate: tool.schema.boolean().optional().default(true).describe("Strip debate/review artifacts"),
        },
        async execute(args, context) {
          llmEngine.setSessionId(context.sessionID)
          llmEngine.setToolContext('agentic_clean')
          const startTime = Date.now()

          const result = await dataCleaner.clean({
            text: args.text,
            format: args.format ?? "json",
            schema: args.schema,
            stripDebateArtifacts: args.stripDebate ?? true,
          })

          traceLogger.log({
            step: "execute",
            input: `Clean: ${args.text.slice(0, 80)}...`,
            output: `cleaned (${result.stats.removedLines} lines removed)`,
            toolUsed: "agentic_clean",
            success: true,
            durationMs: Date.now() - startTime,
          })

          return {
            output: `## 🧹 Data Cleaned\n\n**Original:** ${result.stats.originalLength} chars → **Cleaned:** ${result.stats.cleanedLength} chars (${result.stats.removedLines} lines removed)\n${result.validJson ? "✅ Valid JSON" : "ℹ️ Text output"}\n\n### Result\n\`\`\`${args.format === "json" ? "json" : args.format === "markdown" ? "markdown" : ""}\n${result.cleaned.slice(0, 2000)}\n\`\`\``,
            metadata: { cleanResult: result },
          }
        },
      }),

      // ── Layer 4: Multi-Index RAG — category-segregated memory ──
      agentic_rag: tool({
        description: "Multi-index RAG: search or store knowledge in category-segregated indices. Prevents cross-category context pollution. Use with agentic_router to scope searches to relevant domains.",
        args: {
          action: tool.schema.enum(["search", "store", "stats", "categories", "list"]).describe("Action: search across categories, store new data, view stats, list categories, or list all entries"),
          query: tool.schema.string().optional().describe("Search query (required for search/stats)"),
          category: tool.schema.string().optional().describe("Category to search within (omit for all)"),
          title: tool.schema.string().optional().describe("Title for stored entry"),
          content: tool.schema.string().optional().describe("Content to store (for store action)"),
          type: tool.schema.enum(["episode", "skill"]).optional().default("episode").describe("Type of content to store"),
        },
        async execute(args, context) {
          llmEngine.setSessionId(context.sessionID)

          switch (args.action) {
            case "search": {
              const q = args.query || ""
              const cat = args.category

              if (cat) {
                const results = await multiIndexRAG.searchByCategoryAsync(q, cat)
                const lines = [
                  `## 🔍 RAG Search Results`,
                  `**Query:** ${q}`,
                  `**Category:** ${cat}`,
                  `**Matches:** ${results.totalInCategory}`,
                  `**Mode:** ${multiIndexRAG.mode}`,
                  ``,
                ]
                for (const entry of results.entries.slice(0, 10)) {
                  const type = entry.episode ? "📖 Episode" : "🔧 Skill"
                  const title = entry.title
                  const score = entry.vectorScore !== undefined
                    ? ` [vec:${entry.vectorScore.toFixed(3)} tfidf:${(entry.tfidfScore ?? 0).toFixed(3)}]`
                    : ` [tfidf:${(entry.tfidfScore ?? 0).toFixed(3)}]`
                  lines.push(`- ${type}: **${title}** [${entry.category}]${score}`)
                }
                if (results.entries.length === 0) {
                  lines.push("*(no results)*")
                }

                return {
                  output: lines.join("\n"),
                  metadata: { searchResults: results },
                }
              } else {
                const allResults = await multiIndexRAG.searchAllAsync(q)
                const totalMatches = allResults.reduce((s, r) => s + r.entries.length, 0)
                const lines = [
                  `## 🔍 RAG Search Results (All Categories)`,
                  `**Query:** ${q}`,
                  `**Total Matches:** ${totalMatches}`,
                  ``,
                ]
                for (const catResult of allResults) {
                  lines.push(`### ${catResult.category} (${catResult.entries.length})`)
                  for (const entry of catResult.entries.slice(0, 3)) {
                    lines.push(`- **${entry.title}**`)
                  }
                }
                if (allResults.length === 0) {
                  lines.push("*(no results across any category)*")
                }

                return {
                  output: lines.join("\n"),
                  metadata: { searchResults: allResults },
                }
              }
            }

            case "list": {
              const listCat = args.category
              const allEntries = multiIndexRAG.listAll(listCat)
              const totalCount = allEntries.reduce((s, c) => s + c.entries.length, 0)

              if (totalCount === 0) {
                return {
                  output: `## 📋 RAG Entries\n\nNo entries found${listCat ? ` in category "${listCat}"` : ""}.`,
                  metadata: { listResult: allEntries },
                }
              }

              const lines = [
                `## 📋 RAG Entries`,
                `**Total:** ${totalCount} entries across ${allEntries.length} categories`,
                ``,
              ]

              for (const { category, entries } of allEntries) {
                const episodeCount = entries.filter(e => e.episode).length
                const skillCount = entries.filter(e => e.skill).length
                lines.push(`### ${category} (${entries.length} — ${episodeCount} episodes, ${skillCount} skills)`)

                const showCount = Math.min(entries.length, 30)
                for (const entry of entries.slice(0, showCount)) {
                  const type = entry.episode ? "📖" : "🔧"
                  const ts = (entry.timestamp || "").slice(0, 10)
                  lines.push(`  ${type} [${ts}] **${entry.title}**`)
                }
                if (entries.length > showCount) {
                  lines.push(`  *...and ${entries.length - showCount} more*`)
                }
              }

              return {
                output: lines.join("\n"),
                metadata: { listResult: allEntries },
              }
            }

            case "store": {
              const cat = args.category || multiIndexRAG.autoCategory(args.title || args.content || args.query || "")
              const title = args.title || args.query || "untitled"
              const content = args.content || ""

              if (args.type === "skill" && content) {
                // Extract keywords from content (filter common words)
                const words = content.toLowerCase().match(/\b[a-z]{4,}\b/g) ?? []
                const freq = new Map<string, number>()
                for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1)
                const keywords = [...freq.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 10)
                  .map(([w]) => w)

                // Parse content into multi-step workflow
                const lines = content.split("\n").map(l => l.trim()).filter(l => l.length > 0)
                const steps = lines
                  .filter(l => /^\d+[.)]|^[-*]\s/.test(l) || l.length > 30)
                  .slice(0, 8)
                  .map((l, i) => ({
                    action: l.toLowerCase().includes("create") || l.toLowerCase().includes("implement") ? "create"
                      : l.toLowerCase().includes("fix") || l.toLowerCase().includes("update") ? "modify"
                      : l.toLowerCase().includes("test") || l.toLowerCase().includes("verify") ? "verify"
                      : l.toLowerCase().includes("search") || l.toLowerCase().includes("research") ? "research"
                      : "execute",
                    description: l.replace(/^[\d\s.)*-]+/, "").slice(0, 200),
                    tool: l.toLowerCase().includes("search") ? "agentic_nav"
                      : l.toLowerCase().includes("plan") ? "agentic_plan"
                      : l.toLowerCase().includes("test") || l.toLowerCase().includes("verify") ? "agentic_verify"
                      : l.toLowerCase().includes("delegate") ? "agentic_delegate"
                      : undefined,
                    expectedOutput: `Step ${i + 1} completed`,
                  }))

                if (steps.length === 0) {
                  steps.push({
                    action: "execute",
                    description: content.slice(0, 200),
                    tool: undefined,
                    expectedOutput: "Completed",
                  })
                }

                // Create proper agentic-skill/v1 format definition
                const def = createSkillDefinition(
                  title,
                  title,
                  keywords,
                  steps.map(s => ({
                    action: s.action,
                    description: s.description,
                    tool: s.tool,
                    expectedOutput: s.expectedOutput,
                  })),
                  [cat],
                )

                // Build full SkillRecord for RAG + SkillStore
                const skillRecord = {
                  definition: def,
                  usageCount: 1,
                  successRate: 1.0,
                  successWindow: [true],
                  lastUsed: new Date().toISOString(),
                }

                // Index in RAG for in-session search
                multiIndexRAG.indexSkill(cat, skillRecord)

                // Also persist to SkillStore (disk-backed, survives restart)
                skillStore.importFromEnvelope(JSON.stringify(createMemoryEnvelope(def, "skill")))
                persistence.save("skills", def.meta.id, def)

                return {
                  output: `## ✅ Stored as Skill (agentic-skill/v1)\n\n**Category:** ${cat}\n**Title:** ${title}\n**Steps:** ${steps.length}\n**Keywords:** ${keywords.join(", ")}\n\nSkill saved to both RAG (in-session) and SkillStore (disk-persistent).`,
                  metadata: { category: cat, skillId: def.meta.id },
                }
              } else {
                // Store as an episode
                const decisions = content ? content.split("\n").filter(l => l.startsWith("-") || l.startsWith("*")).map(l => l.replace(/^[-*\s]+/, "")).slice(0, 10) : []
                const episode = {
                  id: `rag-ep-${Date.now()}`,
                  sessionId: context.sessionID,
                  planGoal: title,
                  summary: content.slice(0, 500),
                  outcome: "success" as const,
                  decisions,
                  filesChanged: [],
                  timestamp: new Date().toISOString(),
                  tags: content.toLowerCase().match(/\b[a-z]{4,}\b/g)?.slice(0, 8) ?? [],
                  score: 1.0,
                  usageCount: 0,
                }
                multiIndexRAG.indexEpisode(cat, episode)

                return {
                  output: `## ✅ Stored as Episode\n\n**Category:** ${cat}\n**Title:** ${title}\n**Tags:** ${episode.tags.join(", ")}`,
                  metadata: { category: cat },
                }
              }
            }

            case "stats": {
              const stats = multiIndexRAG.getStats()
              const lines = [
                `## 📊 RAG Statistics`,
                `**Total Episodes:** ${stats.totalEpisodes}`,
                `**Total Skills:** ${stats.totalSkills}`,
                `**Categories:** ${stats.categories.join(", ")}`,
                ``,
                `### Per Category`,
              ]
              for (const [cat, data] of Object.entries(stats.perCategory)) {
                lines.push(`- **${cat}**: ${data.episodes} episodes, ${data.skills} skills`)
              }
              return {
                output: lines.join("\n"),
                metadata: { stats },
              }
            }

            case "categories": {
              const cats = multiIndexRAG.getStats().categories
              return {
                output: `## 📂 RAG Categories\n\nAvailable: ${cats.join(", ")}\n\n> 💡 Use \`agentic_router\` to auto-detect the best category for a query.`,
                metadata: { categories: cats },
              }
            }

            default:
              return { output: "Unknown action. Use: search, store, stats, categories" }
          }
        },
      }),

      // ── Layer 1: MCP Client — connect to external tools/APIs ──
      agentic_mcp: tool({
        description: "MCP (Model Context Protocol) client. Connect to external servers (databases, APIs, tools) via stdio or HTTP, discover available tools, and call them. Lets agents interact with the real world.",
        args: {
          action: tool.schema.enum(["connect", "list", "call", "disconnect", "disconnect-all"]).describe("Action: connect to a server, list connections, call a tool, or disconnect"),
          transport: tool.schema.enum(["stdio", "http", "https"]).optional().describe("Transport type (for connect)"),
          command: tool.schema.string().optional().describe("Executable path (for stdio connect)"),
          args: tool.schema.array(tool.schema.string()).optional().describe("Command arguments (for stdio connect)"),
          url: tool.schema.string().optional().describe("Server URL (for http/https connect)"),
          name: tool.schema.string().optional().describe("Server name for identification"),
          headers: tool.schema.string().optional().describe("JSON string of extra HTTP headers"),
          server: tool.schema.string().optional().describe("Server name to call/disconnect"),
          tool: tool.schema.string().optional().describe("Tool name to call on the server"),
          params: tool.schema.string().optional().describe("JSON string of tool arguments"),
        },
        async execute(args, context) {
          llmEngine.setSessionId(context.sessionID)

          switch (args.action) {
            case "connect": {
              if (!args.transport) {
                return { output: "Parameter 'transport' diperlukan: stdio, http, atau https" }
              }
              if (!args.command && !args.url) {
                return { output: "Parameter 'command' (stdio) atau 'url' (http/https) diperlukan" }
              }

              let headers: Record<string, string> | undefined
              if (args.headers) {
                try { headers = JSON.parse(args.headers) } catch { headers = undefined }
              }

              const conn = await mcpClient.connect({
                transport: args.transport as import("./core/mcp-client.js").MCPTransport,
                command: args.command,
                args: args.args,
                url: args.url,
                headers,
                name: args.name,
              })

              const toolList = conn.tools.map(t => `  - **${t.name}**: ${t.description || "(no description)"}`).join("\n")
              return {
                output: `## 🔌 MCP Connected\n\n**Server:** ${conn.name}\n**Transport:** ${conn.transport}\n**Tools (${conn.tools.length}):**\n${toolList || "  *(none discovered)*"}`,
                metadata: { connection: conn },
              }
            }

            case "list": {
              const connections = mcpClient.listConnections()
              if (connections.length === 0) {
                return { output: "No MCP servers connected. Use `agentic_mcp action=connect` first." }
              }
              const lines = ["## 🔌 MCP Connections", ""]
              for (const conn of connections) {
                lines.push(`### ${conn.name}`)
                lines.push(`- Transport: ${conn.transport}`)
                lines.push(`- Connected: ${conn.connectedAt}`)
                lines.push(`- Tools:`)
                for (const tool of conn.tools) {
                  lines.push(`  - **${tool.name}**: ${tool.description || "(no description)"}`)
                }
                lines.push("")
              }
              return {
                output: lines.join("\n"),
                metadata: { connections },
              }
            }

            case "call": {
              if (!args.server) return { output: "Parameter 'server' diperlukan" }
              if (!args.tool) return { output: "Parameter 'tool' diperlukan" }

              let params: Record<string, unknown> = {}
              if (args.params) {
                try { params = JSON.parse(args.params) } catch { params = {} }
              }

              const result = await mcpClient.callTool(args.server, args.tool, params)
              const contentStr = typeof result.content === "string"
                ? result.content
                : JSON.stringify(result.content, null, 2)

              return {
                output: `## 🔧 MCP Tool Call\n\n**Server:** ${args.server}\n**Tool:** ${args.tool}\n**Duration:** ${result.durationMs}ms\n${result.isError ? "❌ Error" : "✅ Success"}\n\n### Result\n\`\`\`json\n${contentStr.slice(0, 3000)}\n\`\`\``,
                metadata: { callResult: result },
              }
            }

            case "disconnect": {
              if (!args.server) return { output: "Parameter 'server' diperlukan" }
              const ok = mcpClient.disconnect(args.server)
              return {
                output: ok ? `🔌 Disconnected from ${args.server}` : `⚠️ Server "${args.server}" not found`,
                metadata: { disconnected: ok },
              }
            }

            case "disconnect-all": {
              mcpClient.disconnectAll()
              return { output: "🔌 All MCP servers disconnected" }
            }

            default:
              return { output: "Unknown action. Use: connect, list, call, disconnect, disconnect-all" }
          }
        },
      }),

      // ── A2A Protocol: Agent-to-Agent Interop ──
      agentic_a2a: tool({
        description: "A2A (Agent-to-Agent) protocol: discover remote agents, delegate tasks, serve Agent Card. Google A2A standard for cross-framework interoperability.",
        args: {
          action: tool.schema.string().describe("Action: serve, stop, discover, delegate, list, ping, stats, status"),
          url: tool.schema.string().optional().describe("Remote agent URL (for discover/delegate/ping)"),
          agentName: tool.schema.string().optional().describe("Agent name for Agent Card (for serve action)"),
          port: tool.schema.number().optional().describe("Port for A2A server (default: 4123)"),
          serverUrl: tool.schema.string().optional().describe("A2A server URL for task delegation"),
          taskDescription: tool.schema.string().optional().describe("Task description (for delegate action)"),
          instructions: tool.schema.string().optional().describe("Additional instructions for delegated task"),
        },
        async execute(args: Record<string, unknown>, _context: any) {
          const action = (args.action as string) || "status"
          const g = globalThis as {
            __opencode_a2aClient?: import("./agents/a2a-client.js").A2AClient
            __opencode_a2aServer?: import("./agents/a2a-server.js").A2AServer
          }

          // Lazy-init A2A client (shared across calls)
          if (!g.__opencode_a2aClient) {
            const { A2AClient } = await import("./agents/a2a-client.js")
            g.__opencode_a2aClient = new A2AClient()
          }
          const a2aClient: import("./agents/a2a-client.js").A2AClient = g.__opencode_a2aClient

          switch (action) {
            case "serve": {
              // Start A2A server
              const name = (args.agentName as string) || "opencode-agentic-engine"
              const port = (args.port as number) || 4123

              // Build AgentCard from skill store
              const allSkills = skillStore.getAll()
              const capabilities: Array<{
                id: string; name: string; description: string
                skillId?: string; estimatedSuccessRate?: number
              }> = allSkills.slice(0, 50).map(s => ({
                id: s.definition.trigger.capability ?? s.definition.meta.name.toLowerCase().replace(/\s+/g, "."),
                name: s.definition.meta.name,
                description: `${s.definition.workflow.steps.length} steps, ${(s.successRate * 100).toFixed(0)}% success`,
                skillId: s.definition.meta.id,
                estimatedSuccessRate: s.successRate,
              }))

              // Add built-in capabilities
              capabilities.push(
                { id: "plan", name: "Task Planning", description: "Auto-decompose goals into subtasks", estimatedSuccessRate: 0.9 },
                { id: "code.execute", name: "Code Execution", description: "Read, write, edit source code", estimatedSuccessRate: 0.85 },
                { id: "code.verify", name: "Code Verification", description: "Compile, lint, test, security audit", estimatedSuccessRate: 0.8 },
                { id: "nav.search", name: "Codebase Navigation", description: "Search and analyze codebase", estimatedSuccessRate: 0.9 },
              )

              const agentCard = {
                protocolVersion: "1.0",
                name,
                description: `OpenCode Agentic Engine — ${capabilities.length} capabilities, ${allSkills.length} skills`,
                url: `http://127.0.0.1:${port}`,
                capabilities,
              }

              // Stop existing server if running
              if (g.__opencode_a2aServer) {
                try { await g.__opencode_a2aServer.stop() } catch { /* ignore */ }
              }

              const { A2AServer } = await import("./agents/a2a-server.js")
              const server = new A2AServer({
                port,
                host: "127.0.0.1",
                agentCard,
              })
              await server.start()
              g.__opencode_a2aServer = server

              const actualPort = server.port
              return {
                output: [
                  `## 🤖 A2A Server Started`,
                  ``,
                  `**Agent:** ${name}`,
                  `**Endpoint:** http://127.0.0.1:${actualPort}/a2a`,
                  `**Card:** http://127.0.0.1:${actualPort}/a2a/card`,
                  `**Capabilities:** ${capabilities.length}`,
                  `**Skills exported:** ${allSkills.length}`,
                  ``,
                  `> Other agents can discover this agent via \`agentic_a2a action=discover url=http://127.0.0.1:${actualPort}\``,
                  `> Or delegate tasks via \`agentic_a2a action=delegate serverUrl=http://127.0.0.1:${actualPort} taskDescription="..."\``,
                ].join("\n"),
                metadata: { port: actualPort, agentName: name, capabilities: capabilities.length },
              }
            }

            case "stop": {
              if (!g.__opencode_a2aServer) {
                return { output: "⚠️ No A2A server running" }
              }
              const status = g.__opencode_a2aServer.getStatus()
              await g.__opencode_a2aServer.stop()
              g.__opencode_a2aServer = undefined
              return {
                output: [
                  `## 🛑 A2A Server Stopped`,
                  ``,
                  `**Agent:** ${status.agentName}`,
                  `**Uptime:** ${(status.uptimeMs / 1000).toFixed(0)}s`,
                  `**Tasks processed:** ${status.totalTasks}`,
                ].join("\n"),
              }
            }

            case "discover": {
              const url = args.url as string
              if (!url) return { output: "Parameter 'url' diperlukan untuk discover" }

              const card = await a2aClient.discover(url)
              if (!card) {
                return { output: `❌ Could not discover agent at ${url}` }
              }

              return {
                output: [
                  `## 🧭 Remote Agent Discovered`,
                  ``,
                  `**Name:** ${card.name}`,
                  `**Description:** ${card.description}`,
                  `**URL:** ${card.url}`,
                  `**Protocol:** ${card.protocolVersion}`,
                  `**Capabilities (${card.capabilities.length}):`,
                  ...card.capabilities.map(c => `  - **${c.name}** (\`${c.id}\`)${c.estimatedSuccessRate ? ` — ${(c.estimatedSuccessRate * 100).toFixed(0)}% success` : ""}`),
                ].join("\n"),
                metadata: { card },
              }
            }

            case "delegate": {
              const serverUrl = (args.serverUrl || args.url) as string
              if (!serverUrl) return { output: "Parameter 'serverUrl' diperlukan untuk delegate" }

              const taskDesc = (args.taskDescription || args.taskDescription || "Task from A2A client") as string
              const instructions = args.instructions as string || taskDesc

              const taskId = { id: `a2a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
              const messages = [
                { role: "user" as const, parts: [{ type: "text" as const, text: taskDesc }], id: "msg-1", timestamp: new Date().toISOString() },
              ]

              const result = await a2aClient.taskSend(serverUrl, taskId, messages, instructions)

              if (!result) {
                return { output: `❌ Failed to delegate task to ${serverUrl}` }
              }

              const task = result.task
              return {
                output: [
                  `## 📤 Task Delegated`,
                  ``,
                  `**To:** ${serverUrl}`,
                  `**Task ID:** ${task.id.id}`,
                  `**Status:** ${task.status}`,
                  task.statusDescription ? `**Description:** ${task.statusDescription}` : "",
                  ``,
                  `**Messages (${task.messages.length}):`,
                  ...task.messages.map(m => `  - [${m.role}] ${m.parts.map(p => p.type === "text" ? p.text.slice(0, 100) : `[${p.type}]`).join(", ")}`),
                  ``,
                  task.artifacts.length > 0 ? `**Artifacts (${task.artifacts.length}):` : "",
                  ...task.artifacts.map(a => `  - ${a.name}: ${a.parts.length} part(s)`),
                ].filter(Boolean).join("\n"),
                metadata: { task },
              }
            }

            case "list": {
              const agents = a2aClient.listDiscoveredAgents()
              if (agents.length === 0) {
                return { output: "No remote agents discovered yet. Use `agentic_a2a action=discover url=...` first." }
              }
              return {
                output: [
                  `## 🌐 Discovered Agents (${agents.length})`,
                  ``,
                  ...agents.map(a => [
                    `### ${a.card.name}`,
                    `- URL: ${a.card.url}`,
                    `- Capabilities: ${a.card.capabilities.length}`,
                    `- Discovered: ${new Date(a.discoveredAt).toLocaleTimeString()}`,
                  ].join("\n")),
                ].join("\n\n"),
                metadata: { agents: agents.map(a => ({ name: a.card.name, url: a.card.url, capabilities: a.card.capabilities.length })) },
              }
            }

            case "ping": {
              const url = args.url as string
              if (!url) return { output: "Parameter 'url' diperlukan untuk ping" }

              const card = await a2aClient.discover(url)
              if (!card) {
                return { output: `❌ Agent at ${url} unreachable` }
              }
              return {
                output: `✅ Agent **${card.name}** reachable at ${url} — ${card.capabilities.length} capabilities`,
                metadata: { reachable: true, card },
              }
            }

            case "stats":
            case "status": {
              const stats = a2aClient.getStats()
              const lines = [
                `## 📊 A2A Protocol Status`,
                ``,
                `### Client`,
                `| Metric | Value |`,
                `|--------|-------|`,
                `| Cached agents | ${stats.cachedCards} |`,
                `| Tasks sent | ${stats.tasksSent} |`,
                `| Tasks completed | ${stats.tasksCompleted} |`,
                `| Tasks failed | ${stats.tasksFailed} |`,
                `| Avg latency | ${stats.averageLatencyMs}ms |`,
                ``,
              ]

              if (g.__opencode_a2aServer) {
                const srv = g.__opencode_a2aServer.getStatus()
                lines.push(
                  `### Server`,
                  `| Metric | Value |`,
                  `|--------|-------|`,
                  `| Running | ✅ Yes on port ${srv.port} |`,
                  `| Agent | ${srv.agentName} |`,
                  `| Capabilities | ${srv.capabilities} |`,
                  `| Active tasks | ${srv.activeTasks} |`,
                  `| Total tasks | ${srv.totalTasks} |`,
                  `| Uptime | ${(srv.uptimeMs / 1000).toFixed(0)}s |`,
                )
              } else {
                lines.push(`### Server\n\n⚠️ Not running. Use \`agentic_a2a action=serve\` to start.`)
              }

              return { output: lines.join("\n") }
            }

            default:
              return { output: "Unknown action. Use: serve, stop, discover, delegate, list, ping, stats" }
          }
        },
      }),

      // ── Stage III: Fine-Tuning Pipeline ──
      agentic_finetune: tool({
        description: "End-to-end fine-tuning pipeline: prepare dataset, save file, upload to OpenAI, create and monitor fine-tuning job.",
        args: {
          action: tool.schema.string().describe("Action: prepare, save, upload, create-job, status, list, cancel, full-pipeline"),
          source: tool.schema.string().optional().describe("Data source: 'skills', 'episodes', 'combined' (default: 'combined')"),
          format: tool.schema.string().optional().describe("Output format: 'openai' (JSONL) or 'instructions' (JSON)"),
          minQuality: tool.schema.number().optional().describe("Minimum quality/success rate filter (default: 0.5)"),
          outputPath: tool.schema.string().optional().describe("File path to save the dataset"),
          model: tool.schema.string().optional().describe("Base model for fine-tuning (e.g. gpt-4o-mini-2024-07-18)"),
          epochs: tool.schema.number().optional().describe("Number of training epochs"),
          suffix: tool.schema.string().optional().describe("Custom suffix for the fine-tuned model name"),
          jobId: tool.schema.string().optional().describe("Fine-tuning job ID (for status/cancel actions)"),
        },
        async execute(args: Record<string, unknown>, _ctx: any) {
          const action = args.action as string
          const source = (args.source as string) ?? "combined"
          const format = (args.format as "openai" | "instructions") ?? "openai"
          const minQuality = (args.minQuality as number) ?? 0.5
          const outputPath = args.outputPath as string | undefined
          const model = args.model as string | undefined
          const epochs = args.epochs as number | undefined
          const suffix = args.suffix as string | undefined
          const jobId = args.jobId as string | undefined

          // Session state for skill store and episodic store
          const g = globalThis as { __opencode_skillStore?: import("./memory/skill-store.js").SkillStore; __opencode_episodicStore?: import("./memory/episodic-store.js").EpisodicStore }
          const skillStore = g.__opencode_skillStore
          const episodicStore = g.__opencode_episodicStore

          switch (action) {
            case "prepare": {
              // Gather data
              const skills = skillStore?.getAll() ?? []
              const episodes = episodicStore?.getRecent(1000) ?? []

              let datasetStr: string
              let exampleCount: number

              if (source === "skills") {
                const { skillsToTrainingData } = await import("./memory/skill-training.js")
                const ds = skillsToTrainingData(skills, format, minQuality)
                datasetStr = ds.data
                exampleCount = ds.totalExamples
              } else if (source === "episodes") {
                const { episodesToTrainingData } = await import("./memory/skill-training.js")
                const ds = episodesToTrainingData(episodes, format, minQuality)
                datasetStr = ds.data
                exampleCount = ds.totalExamples
              } else {
                const { prepareFineTuningDataset } = await import("./memory/skill-training.js")
                const ds = prepareFineTuningDataset(skills, episodes, format, minQuality)
                datasetStr = ds.data
                exampleCount = ds.totalExamples
              }

              // Truncate preview to avoid huge responses
              const preview = datasetStr.length > 2000
                ? datasetStr.slice(0, 2000) + "\n... (truncated)"
                : datasetStr

              return {
                output: [
                  `## Fine-Tuning Dataset (${source})`,
                  `**Format:** ${format}`,
                  `**Examples:** ${exampleCount}`,
                  `**Min quality:** ${minQuality}`,
                  ``,
                  `### Preview (first 2000 chars)`,
                  `\`\`\`jsonl`,
                  preview,
                  `\`\`\``,
                  ``,
                  `> Use \`action: "save"\` to write to a file, or \`action: "upload"\` to upload to OpenAI.`,
                ].join("\n"),
              }
            }

            case "save": {
              if (!outputPath) {
                return { output: "Error: 'outputPath' is required for save action." }
              }

              const { saveTrainingDataToFile } = await import("./memory/skill-training.js")
              const skills = skillStore?.getAll() ?? []
              const episodes = episodicStore?.getRecent(1000) ?? []

              const { prepareFineTuningDataset } = await import("./memory/skill-training.js")
              const dataset = prepareFineTuningDataset(skills, episodes, format, minQuality)
              const savedPath = await saveTrainingDataToFile(dataset, outputPath)

              return {
                output: `Dataset saved to \`${savedPath}\`\n**Examples:** ${dataset.totalExamples}\n**Format:** ${format}`,
              }
            }

            case "upload": {
              const { FineTuningClient: FTC } = await import("./core/fine-tuning.js")
              // Get config from configLoader if available
              const configLoader = (globalThis as { __opencode_configLoader?: { get?: () => { fineTuning?: { apiKey?: string; baseURL?: string; model?: string; trainingEpochs?: number; suffix?: string } } } }).__opencode_configLoader
              const ftConfig = configLoader?.get?.()?.fineTuning ?? {}
              const client = new FTC({
                apiKey: ftConfig.apiKey || undefined,
                baseURL: ftConfig.baseURL || undefined,
                model: model || ftConfig.model || undefined,
              })

              if (!client.isConfigured()) {
                return { output: "Error: OpenAI API key not configured. Set OPENAI_API_KEY env or fineTuning.apiKey in config." }
              }

              if (!outputPath) {
                return { output: "Error: 'outputPath' pointing to a .jsonl file is required for upload." }
              }

              try {
                const file = await client.uploadFile(outputPath)
                return {
                  output: [
                    `✅ File uploaded successfully`,
                    `**File ID:** ${file.id}`,
                    `**Filename:** ${file.filename}`,
                    `**Size:** ${file.bytes} bytes`,
                    `**Status:** ${file.status}`,
                    ``,
                    `> Use \`action: "create-job"\` with \`jobId: "${file.id}"\` to start fine-tuning.`,
                  ].join("\n"),
                }
              } catch (err: any) {
                return { output: `❌ Upload failed: ${err.message}` }
              }
            }

            case "create-job": {
              if (!jobId) {
                return { output: "Error: 'jobId' (training file ID) is required for create-job." }
              }

              const { FineTuningClient: FTC } = await import("./core/fine-tuning.js")
              const configLoader = (globalThis as { __opencode_configLoader?: { get?: () => { fineTuning?: { apiKey?: string; baseURL?: string; model?: string; trainingEpochs?: number; suffix?: string } } } }).__opencode_configLoader
              const ftConfig = configLoader?.get?.()?.fineTuning ?? {}
              const client = new FTC({
                apiKey: ftConfig.apiKey || undefined,
                baseURL: ftConfig.baseURL || undefined,
                model: model || ftConfig.model || undefined,
              })

              if (!client.isConfigured()) {
                return { output: "Error: OpenAI API key not configured." }
              }

              try {
                const job = await client.createJob(jobId, {
                  model: model || ftConfig.model,
                  trainingEpochs: epochs || ftConfig.trainingEpochs,
                  suffix: suffix || ftConfig.suffix,
                })
                return {
                  output: [
                    `✅ Fine-tuning job created`,
                    `**Job ID:** ${job.id}`,
                    `**Model:** ${job.model}`,
                    `**Status:** ${job.status}`,
                    ``,
                    `> Use \`action: "status"\` with \`jobId: "${job.id}"\` to check progress.`,
                  ].join("\n"),
                }
              } catch (err: any) {
                return { output: `❌ Create job failed: ${err.message}` }
              }
            }

            case "status": {
              if (!jobId) {
                return { output: "Error: 'jobId' is required for status action." }
              }

              const { FineTuningClient: FTC } = await import("./core/fine-tuning.js")
              const configLoader = (globalThis as { __opencode_configLoader?: { get?: () => { fineTuning?: { apiKey?: string; baseURL?: string; model?: string; trainingEpochs?: number; suffix?: string } } } }).__opencode_configLoader
              const ftConfig = configLoader?.get?.()?.fineTuning ?? {}
              const client = new FTC({
                apiKey: ftConfig.apiKey || undefined,
                baseURL: ftConfig.baseURL || undefined,
              })

              if (!client.isConfigured()) {
                return { output: "Error: OpenAI API key not configured." }
              }

              try {
                const job = await client.getJobStatus(jobId)
                return {
                  output: [
                    `## Fine-Tuning Job Status`,
                    `**Job ID:** ${job.id}`,
                    `**Model:** ${job.model}`,
                    `**Status:** ${job.status}`,
                    job.trainedModel ? `**Fine-tuned model:** ${job.trainedModel}` : "",
                    job.epochs ? `**Epochs:** ${job.epochs}` : "",
                    job.createdAt ? `**Created:** ${job.createdAt}` : "",
                    job.finishedAt ? `**Finished:** ${job.finishedAt}` : "",
                    job.error ? `**Error:** ${job.error}` : "",
                  ].filter(Boolean).join("\n"),
                }
              } catch (err: any) {
                return { output: `❌ Status check failed: ${err.message}` }
              }
            }

            case "list": {
              const { FineTuningClient: FTC } = await import("./core/fine-tuning.js")
              const configLoader = (globalThis as { __opencode_configLoader?: { get?: () => { fineTuning?: { apiKey?: string; baseURL?: string; model?: string; trainingEpochs?: number; suffix?: string } } } }).__opencode_configLoader
              const ftConfig = configLoader?.get?.()?.fineTuning ?? {}
              const client = new FTC({
                apiKey: ftConfig.apiKey || undefined,
                baseURL: ftConfig.baseURL || undefined,
              })

              if (!client.isConfigured()) {
                return { output: "Error: OpenAI API key not configured." }
              }

              try {
                const jobs = await client.listJobs()
                if (jobs.length === 0) {
                  return { output: "No fine-tuning jobs found." }
                }
                const jobLines = jobs.map(j =>
                  `- **${j.id}** | ${j.model} | ${j.status}${j.trainedModel ? ` → ${j.trainedModel}` : ""}`
                ).join("\n")
                return {
                  output: `## Fine-Tuning Jobs (${jobs.length})\n\n${jobLines}`,
                }
              } catch (err: any) {
                return { output: `❌ List jobs failed: ${err.message}` }
              }
            }

            case "cancel": {
              if (!jobId) {
                return { output: "Error: 'jobId' is required for cancel action." }
              }

              const { FineTuningClient: FTC } = await import("./core/fine-tuning.js")
              const configLoader = (globalThis as { __opencode_configLoader?: { get?: () => { fineTuning?: { apiKey?: string; baseURL?: string; model?: string; trainingEpochs?: number; suffix?: string } } } }).__opencode_configLoader
              const ftConfig = configLoader?.get?.()?.fineTuning ?? {}
              const client = new FTC({
                apiKey: ftConfig.apiKey || undefined,
                baseURL: ftConfig.baseURL || undefined,
              })

              if (!client.isConfigured()) {
                return { output: "Error: OpenAI API key not configured." }
              }

              try {
                const job = await client.cancelJob(jobId)
                return {
                  output: `✅ Job ${job.id} cancelled. Status: ${job.status}`,
                }
              } catch (err: any) {
                return { output: `❌ Cancel failed: ${err.message}` }
              }
            }

            case "full-pipeline": {
              const { saveTrainingDataToFile, prepareFineTuningDataset } = await import("./memory/skill-training.js")
              const { FineTuningClient: FTC } = await import("./core/fine-tuning.js")

              const configLoader = (globalThis as { __opencode_configLoader?: { get?: () => { fineTuning?: { apiKey?: string; baseURL?: string; model?: string; trainingEpochs?: number; suffix?: string } } } }).__opencode_configLoader
              const ftConfig = configLoader?.get?.()?.fineTuning ?? {}
              const client = new FTC({
                apiKey: ftConfig.apiKey || undefined,
                baseURL: ftConfig.baseURL || undefined,
                model: model || ftConfig.model || undefined,
              })

              if (!client.isConfigured()) {
                return { output: "Error: OpenAI API key not configured. Set OPENAI_API_KEY env or fineTuning.apiKey in config." }
              }

              const skills = skillStore?.getAll() ?? []
              const episodes = episodicStore?.getRecent(1000) ?? []
              if (skills.length === 0 && episodes.length === 0) {
                return { output: "Error: No skills or episodes available for training data." }
              }

              // Prepare and save dataset
              const savePath = outputPath ?? ".agentic/fine-tuning-data.jsonl"
              const dataset = prepareFineTuningDataset(skills, episodes, "openai", minQuality)
              if (dataset.totalExamples === 0) {
                return { output: "Error: No training examples after filtering. Try lowering minQuality." }
              }
              await saveTrainingDataToFile(dataset, savePath)

              // Upload to OpenAI
              try {
                const file = await client.uploadFile(savePath)
                // Create job
                const job = await client.createJob(file.id, {
                  model: model || ftConfig.model,
                  trainingEpochs: epochs || ftConfig.trainingEpochs,
                  suffix: suffix || ftConfig.suffix,
                })

                return {
                  output: [
                    `## 🚀 Full Fine-Tuning Pipeline`,
                    ``,
                    `**Dataset:** ${savePath}`,
                    `**Examples:** ${dataset.totalExamples}`,
                    ``,
                    `**File Upload:**`,
                    `- ID: ${file.id}`,
                    `- Size: ${file.bytes} bytes`,
                    ``,
                    `**Job Created:**`,
                    `- Job ID: ${job.id}`,
                    `- Model: ${job.model}`,
                    `- Status: ${job.status}`,
                    ``,
                    `> Use \`action: "status"\` with \`jobId: "${job.id}"\` to monitor progress.`,
                    `> Or run \`action: "full-pipeline-wait"\` to block until completion.`,
                  ].join("\n"),
                }
              } catch (err: any) {
                return { output: `❌ Pipeline failed at step: ${err.message}` }
              }
            }

            case "full-pipeline-wait": {
              const { saveTrainingDataToFile, prepareFineTuningDataset } = await import("./memory/skill-training.js")
              const { FineTuningClient: FTC } = await import("./core/fine-tuning.js")

              const configLoader = (globalThis as { __opencode_configLoader?: { get?: () => { fineTuning?: { apiKey?: string; baseURL?: string; model?: string; trainingEpochs?: number; suffix?: string } } } }).__opencode_configLoader
              const ftConfig = configLoader?.get?.()?.fineTuning ?? {}
              const client = new FTC({
                apiKey: ftConfig.apiKey || undefined,
                baseURL: ftConfig.baseURL || undefined,
                model: model || ftConfig.model || undefined,
              })

              if (!client.isConfigured()) {
                return { output: "Error: OpenAI API key not configured." }
              }

              const skills = skillStore?.getAll() ?? []
              const episodes = episodicStore?.getRecent(1000) ?? []
              const savePath = outputPath ?? ".agentic/fine-tuning-data.jsonl"
              const dataset = prepareFineTuningDataset(skills, episodes, "openai", minQuality)
              await saveTrainingDataToFile(dataset, savePath)

              try {
                const result = await client.fullPipeline(savePath, {
                  model: model || ftConfig.model,
                  trainingEpochs: epochs || ftConfig.trainingEpochs,
                  suffix: suffix || ftConfig.suffix,
                })

                return {
                  output: [
                    `## ✅ Full Pipeline Complete`,
                    ``,
                    `**File:** ID ${result.file.id} (${result.file.bytes} bytes)`,
                    `**Job:** ${result.job.id}`,
                    `**Final Status:** ${result.result.status}`,
                    result.result.trainedModel ? `**Fine-tuned Model:** ${result.result.trainedModel}` : "",
                    result.result.error ? `**Error:** ${result.result.error}` : "",
                    ``,
                    `**Dataset saved to:** ${savePath}`,
                  ].filter(Boolean).join("\n"),
                }
              } catch (err: any) {
                return { output: `❌ Full pipeline failed: ${err.message}` }
              }
            }

            default:
              return { output: "Unknown action. Available: prepare, save, upload, create-job, status, list, cancel, full-pipeline, full-pipeline-wait" }
          }
        },
      }),

      // ── SQLite Database — persistence backend ──
      agentic_db: tool({
        description: "SQLite database backend. Query, save, load, list, stats. Structured queries support WHERE, JOIN, GROUP BY.",
        args: {
          action: tool.schema.enum(["query", "save", "load", "list", "stats", "tables", "migrate"]).describe("Action: query (raw SQL), save (key-value), load (by key), list (all keys), stats, tables (list tables), migrate (JSON→SQLite)"),
          sql: tool.schema.string().optional().describe("SQL query (for action=query)"),
          namespace: tool.schema.string().optional().describe("Namespace (for save/load/list)"),
          key: tool.schema.string().optional().describe("Key (for save/load)"),
          scope: tool.schema.string().optional().describe("Scope/projectId (optional)"),
          data: tool.schema.string().optional().describe("JSON data string (for action=save)"),
          params: tool.schema.string().optional().describe("JSON array of query parameters (for action=query)"),
        },
        async execute(args: Record<string, unknown>, _ctx: any) {
          const action = args.action as string

          // Jika SQLite tidak tersedia (Bun tanpa better-sqlite3, dll)
          if (!sqliteDB) {
            return { output: "❌ SQLite database not available. Install better-sqlite3 (Node) or run in Bun for built-in SQLite support.\n\nFallback: use file-based persistence via agentic_rag and agentic_skill (data saved to .agentic/store/)." }
          }

          switch (action) {
            case "query": {
              const sql = args.sql as string
              if (!sql) return { output: "Error: 'sql' parameter is required for query action." }
              try {
                const params = args.params ? JSON.parse(args.params as string) : undefined
                const rows = sqliteDB.query(sql, params)
                const preview = JSON.stringify(rows.slice(0, 20), null, 2)
                const total = rows.length
                return {
                  output: [
                    `## 📊 SQLite Query Result`,
                    `**SQL:** \`${sql}\``,
                    `**Rows:** ${total}${total > 20 ? " (showing first 20)" : ""}`,
                    ``,
                    "```json",
                    preview,
                    "```",
                  ].join("\n"),
                  metadata: { rows: total, data: rows.slice(0, 50) },
                }
              } catch (err: any) {
                return { output: `❌ Query failed: ${err.message}` }
              }
            }

            case "save": {
              const namespace = args.namespace as string
              const key = args.key as string
              const dataStr = args.data as string
              if (!namespace || !key || !dataStr) {
                return { output: "Error: 'namespace', 'key', and 'data' parameters are required." }
              }
              try {
                const data = JSON.parse(dataStr)
                const scope = args.scope as string | undefined
                sqliteDB.save(namespace, key, data, scope)
                return { output: `✅ Saved \`${namespace}:${key}\`${scope ? ` (scope: ${scope})` : ""}` }
              } catch (err: any) {
                return { output: `❌ Save failed: ${err.message}` }
              }
            }

            case "load": {
              const namespace = args.namespace as string
              const key = args.key as string
              if (!namespace || !key) {
                return { output: "Error: 'namespace' and 'key' parameters are required." }
              }
              const scope = args.scope as string | undefined
              const data = sqliteDB.load(namespace, key, scope)
              if (data === null) {
                return { output: `Not found: \`${namespace}:${key}\`${scope ? ` (scope: ${scope})` : ""}` }
              }
              return {
                output: [
                  `## Loaded: \`${namespace}:${key}\``,
                  ``,
                  "```json",
                  JSON.stringify(data, null, 2),
                  "```",
                ].join("\n"),
                metadata: { data },
              }
            }

            case "list": {
              const namespace = args.namespace as string
              if (!namespace) return { output: "Error: 'namespace' parameter is required." }
              const scope = args.scope as string | undefined
              const keys = sqliteDB.listKeys(namespace, scope)
              if (keys.length === 0) {
                return { output: `No entries in namespace \`${namespace}\`${scope ? ` (scope: ${scope})` : ""}` }
              }
              return {
                output: [
                  `## 📋 Keys in \`${namespace}\`${scope ? ` (scope: ${scope})` : ""}`,
                  `**Total:** ${keys.length}`,
                  ``,
                  ...keys.map(k => `  - \`${k}\``),
                ].join("\n"),
                metadata: { keys },
              }
            }

            case "tables": {
              const rows = sqliteDB.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name") as Array<{ name: string }>
              const counts = sqliteDB.query("SELECT 'store' as name, COUNT(*) as cnt FROM store") as Array<{ name: string; cnt: number }>
              return {
                output: [
                  `## 📋 SQLite Tables`,
                  `**Database:** ${sqliteDB.stats().dbPath}`,
                  ``,
                  "| Table | Rows |",
                  "|-------|------|",
                  ...rows.map(r => {
                    const cnt = counts.find(c => c.name === r.name)?.cnt ?? 0
                    return `| \`${r.name}\` | ${cnt} |`
                  }),
                  ``,
                  `**File size:** ${(sqliteDB.stats().fileSize / 1024).toFixed(1)} KB`,
                ].join("\n"),
              }
            }

            case "stats": {
              const stats = sqliteDB.stats()
              return {
                output: [
                  `## 📊 SQLite Database Stats`,
                  `**Path:** ${stats.dbPath}`,
                  `**File size:** ${(stats.fileSize / 1024).toFixed(1)} KB`,
                  ``,
                  `| Namespace | Scopes | Keys |`,
                  `|-----------|--------|------|`,
                  ...stats.namespaces.map(n =>
                    `| \`${n.namespace}\` | ${n.scopes} | ${n.keys} |`
                  ),
                ].join("\n"),
                metadata: stats,
              }
            }

            case "migrate": {
              // Migrate all data from JSON files to SQLite (one-time operation)
              const migrated: string[] = []
              const skipped: string[] = []
              const namespaces = ["rag", "episodes", "skills", "models", "prompts", "evolution", "evaluation"]

              for (const ns of namespaces) {
                try {
                  const items = persistence.loadAll(ns)
                  if (items.length === 0) {
                    skipped.push(`${ns} (empty)`)
                    continue
                  }
                  for (const item of items) {
                    // Detect scope from key pattern
                    if (ns === "episodes" && item.key.includes("-")) {
                      // episodes have scope from projectId
                      const loaded = persistence.load(ns, item.key)
                      if (loaded) sqliteDB.save(ns, item.key, loaded)
                    } else {
                      sqliteDB.save(ns, item.key, item.data)
                    }
                  }
                  migrated.push(`${ns} (${items.length} items)`)
                } catch (err: any) {
                  skipped.push(`${ns} (error: ${err.message})`)
                }
              }

              return {
                output: [
                  `## 🔄 Migration: JSON → SQLite`,
                  ``,
                  `**Migrated:**`,
                  ...migrated.map(m => `  ✅ ${m}`),
                  ``,
                  `**Skipped:**`,
                  ...skipped.map(s => `  ⏭️ ${s}`),
                  ``,
                  `**SQLite DB:** ${sqliteDB.stats().dbPath}`,
                ].join("\n"),
              }
            }

            default:
              return { output: "Unknown action. Available: query, save, load, list, stats, tables, migrate" }
          }
        },
      }),

      // ── Stage V: Autonomous Mode — fast orchestrator ──
      // Fast path: LLM call + file write + compile check (return immediately).
      // Thorough path (+async): memory + skills + guard + post-processing (fire-and-forget after return).
      agentic_auto: tool({
        description: "Fully autonomous engineering orchestrator. One call handles: memory + skills → architecture → code → guard check → verify → score → learn.",
        args: {
          goal: tool.schema.string().describe("The overall goal / task description"),
          constraints: tool.schema.array(tool.schema.string()).optional().describe("Constraints or requirements"),
          thorough: tool.schema.boolean().optional().describe("Extra: memory + skills + guard + tech-debt post-processing (non-blocking, default: true)"),
          maxSteps: tool.schema.number().optional().describe("Maximum number of steps (default: auto)"),
        },
        async execute(args, context) {
          llmEngine.setSessionId(context.sessionID)
          llmEngine.setToolContext('agentic_auto')
          const projectDir = ctxDir(context)
          const startTime = Date.now()
          const thorough = args.thorough !== false

          // ═══════════════════════════════════════════════
          // PHASE 1: Knowledge — scan + memory + skills
          // ═══════════════════════════════════════════════
          let codebaseSummary = ""
          const relevantFiles: string[] = []
          const memoryContexts: string[] = []
          const skillContexts: string[] = []

          try {
            await navigator.scan(projectDir).catch((err) => console.warn(`[agentic_auto] navigator scan failed:`, err))
            codebaseSummary = navigator.getSummary()
            const found = navigator.findRelevantFiles(args.goal, 8)
            relevantFiles.push(...found)

            if (thorough) {
              const eps = episodicStore.search(args.goal)
              for (const ep of eps.slice(0, 5)) {
                memoryContexts.push(`[${ep.outcome}] ${ep.planGoal} — decisions: ${(ep.decisions || []).slice(0, 3).join(", ")}`)
              }
              const skills = skillStore.find(args.goal)
              for (const sk of skills.slice(0, 3)) {
                const d = sk.definition
                const steps = d.workflow?.steps || []
                skillContexts.push(`${d.meta?.name || "skill"} (${(sk.successRate * 100).toFixed(0)}% success) — ${steps.slice(0, 2).map((w: any) => w.description || w.action || "").join("; ")}`)
              }
            }
          } catch { /* non-fatal */ }

          // ═══════════════════════════════════════════════
          // PHASE 2: Plan — decompose goal into steps
          // ═══════════════════════════════════════════════
          let subtasks: Array<{ id: string; description: string; dependsOn: string[]; verificationCriteria: string[] }> = []

          // Episodic Plan Reuse: check for similar past successful plans first
          const reuseEpisodes = episodicStore.searchForReuse(args.goal)
          if (reuseEpisodes.length > 0) {
            const best = reuseEpisodes[0]
            episodicStore.incrementUsage(best.id)
            const adapted = episodicStore.adaptPlan(best, args.goal)
            if (adapted && adapted.length > 0) {
              subtasks = adapted.map((desc, i) => ({
                id: `reuse-${i + 1}`,
                description: desc,
                dependsOn: i > 0 ? [`reuse-${i}`] : [],
                verificationCriteria: [],
              }))
            }
          }

          if (subtasks.length === 0) {
            const decomposition = planner.decompose(args.goal, [])
            subtasks = decomposition.intent.subtasks
          }
          if (subtasks.length === 0 && args.goal.length > 0) {
            try {
              const llmIntent = await planner.decomposeWithLLM(llmEngine, args.goal, codebaseSummary.slice(0, 1000))
              if (llmIntent.subtasks.length > 0) subtasks = llmIntent.subtasks
            } catch { /* fallback */ }
          }
          if (subtasks.length === 0) {
            subtasks = [{ id: "step-1", description: args.goal || "Execute task", dependsOn: [], verificationCriteria: [] }]
          }
          const maxSteps = Math.min(args.maxSteps ?? subtasks.length, subtasks.length)
          const activeSteps = subtasks.slice(0, maxSteps)

          const intent: TaskIntent = {
            goal: args.goal, constraints: args.constraints ?? [],
            context: { relevantFiles: [], dependencies: [] },
            subtasks: activeSteps.map(s => ({
              id: s.id, description: s.description,
              dependsOn: s.dependsOn ?? [], verificationCriteria: s.verificationCriteria ?? [],
            })),
          }
          const plan = intentParser.createPlan(intent)
          intentParser.validatePlan(plan)
          executor.initExecution(context.sessionID, plan)
          sessionStore.getOrCreate(context.sessionID).plan = plan

          // ═══════════════════════════════════════════════
          // PHASE 3: Implement — pipeline delegation or fast LLM
          // ═══════════════════════════════════════════════
          const fileContents: Record<string, string> = {}
          for (const f of relevantFiles) {
            try { fileContents[f] = readFileSync(join(projectDir, f), "utf-8").slice(0, 150) } catch { /* skip */ }
          }

          const filesBlock = Object.entries(fileContents)
            .map(([p, c]) => `${p}:\n${c.slice(0, 100)}`).join("\n---\n")
          const pipelineId = orchestrator.getSuggestedPipeline(args.goal)
          const pipeline = orchestrator.getPipeline(pipelineId)
          // Hanya aktifkan pipeline untuk task yang benar-benar butuh multi-agent.
          // Pipeline = 4-5 LLM calls sequential — overkill untuk task sederhana.
          const hasComplexKeywords = /\b(feature|module|endpoint|api|pipeline|architecture|database|schema|multi[\s-]?step|complex)\b/i.test(args.goal)
          const hasSimpleKeywords = /\b(fix|typo|comment|rename|change|update|bump|remove|delete|add\s+\w+\s+to)\b/i.test(args.goal)
          const isSimpleOrTrivial = (args.goal.length < 100 && hasSimpleKeywords) || (!hasComplexKeywords && args.goal.length < 60) || activeSteps.length <= 1
          const usePipeline = thorough && !isSimpleOrTrivial && pipeline && pipeline.stages.length >= 2 && activeSteps.length >= 2

          const allModified: string[] = []
          const completedSteps: string[] = []
          let verifyPassed = true
          let verifyNote = "—"
          let pipelineReview = ""
          let hasNoLLM = false
          let preChangeCommit = ""
          let hasGitRollback = false

          if (usePipeline) {
            // ── Pipeline path: reuse shared internal orchestrator ──
            const pipelineRunId = `run-${context.sessionID}-${pipelineId}`
            orchestrator.startRun(pipelineRunId, pipelineId)

            const piperesult = await orchestrator.executePipeline({
              pipeline,
              runId: pipelineRunId,
              goal: args.goal,
              constraints: args.constraints,
              projectDir,
              codebaseSummary,
              filesBlock,
              memoryContexts,
              skillContexts,
              coordinator,
              sessionID: context.sessionID,
              budgetTracker,
              eventBus,
              hallucinationGuard,
              skillStore,
              configLoader,
              schemaValidator,
            })

            hasNoLLM = piperesult.hasNoLLM
            pipelineReview = piperesult.pipelineReview
            verifyNote = piperesult.verifyNote
            allModified.push(...piperesult.allFiles)
            if (piperesult.budgetExceeded) {
              verifyNote = `⛔ Budget exceeded after ${piperesult.completedStageCount} stages`
            }

            // Record execution
            const allPipelineStages = pipeline.stages.map(s => s.role)
            await coordinator.writeSharedMemory("pipeline:auto:stages", allPipelineStages.join(","), "coordinator")
            for (const step of activeSteps) {
              depTracker.recordChange(context.sessionID, step.id, allModified)
              executor.recordResult(context.sessionID, {
                stepId: step.id, success: !hasNoLLM,
                output: `Pipeline: ${allPipelineStages.join("→")} — ${allModified.length} files${pipelineReview ? ` — QA: ${pipelineReview}` : ""}`,
                filesModified: allModified,
              })
              completedSteps.push(step.id)
            }
          } else {
            // ── Fast path: monolithic LLM call with adaptive retry loop ──
            const systemPrompt = `Return JSON array of {path, content}. Write COMPLETE file contents.
Rules: ESM imports (.js) · match existing patterns · valid imports
{"files":[{"path":"src/x.ts","content":"..."}]} or {"noChanges":true}`

            const userPrompt = `${args.goal}${args.constraints?.length ? `\nConstraints: ${args.constraints.join(", ")}` : ""}${[...memoryContexts.slice(0, 2), ...skillContexts.slice(0, 1)].join("; ") ? `\nContext: ${[...memoryContexts.slice(0, 2), ...skillContexts.slice(0, 1)].join("; ")}` : ""}\n\n${filesBlock || "(new)"}\n${codebaseSummary.slice(0, 100)}`

            const isSimple = args.goal.length < 80 && activeSteps.length < 3
            const maxTokens = isSimple ? 1024 : 2048

            // ── Helper: parse LLM JSON output → {path, content}[] ──
            function parseLLMOutput(output: string): Array<{ path: string; content: string }> {
              const result: Array<{ path: string; content: string }> = []
              try {
                const parsed = JSON.parse(output)
                if (parsed.files && Array.isArray(parsed.files)) {
                  for (const f of parsed.files) {
                    if (f.path && f.content) result.push({ path: f.path, content: f.content })
                  }
                }
              } catch {
                const fbRegex = /FILE:\s*(\S+)\n```(?:\w+)?\n([\s\S]*?)```/g
                let fbMatch: RegExpExecArray | null
                while ((fbMatch = fbRegex.exec(output)) !== null) {
                  result.push({ path: fbMatch[1].replace(/^\/+/, ""), content: fbMatch[2] })
                }
                if (result.length === 0 && !output.includes("NO_CHANGES") && !output.includes('"noChanges"')) {
                  const cbMatch = output.match(/```(?:\w+)?\n([\s\S]*?)```/)
                  if (cbMatch) result.push({ path: relevantFiles[0]?.replace(/^\/+/, "") || "src/index.ts", content: cbMatch[1] })
                }
              }
              return result
            }

            // ── Helper: write files to disk ──
            function writeFiles(files: Array<{ path: string; content: string }>, target: string[]): void {
              for (const fw of files) {
                try {
                  const absPath = join(projectDir, fw.path)
                  mkdirSync(dirname(absPath), { recursive: true })
                  writeFileSync(absPath, fw.content, "utf-8")
                  target.push(fw.path)
                } catch { /* skip bad paths */ }
              }
            }

            // Capture pre-change git state for rollback
            try {
              if (git.isAvailable()) {
                const stashResult = execFileSync("git", ["stash", "create"], { cwd: projectDir, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim()
                preChangeCommit = stashResult || execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectDir, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim()
                hasGitRollback = true
              }
            } catch { /* non-fatal — rollback not available */ }

            // ── Adaptive retry loop ──
            const autoRetry = new AutoRetryManager({ maxRetries: 3 })
            let retryPrompt: string | null = null
            let firstAttempt = true

            do {
              // Construct prompt: original + retry context
              const currentPrompt = retryPrompt ?? userPrompt
              const prompt = firstAttempt
                ? `${systemPrompt}\n\n${currentPrompt}`
                : `${systemPrompt}\n\nIMPORTANT: Fix the previous errors. Only output files that need changes.\n\n${currentPrompt}`

              // LLM call
              const llmResult = await llmEngine.call({
                systemPrompt: prompt,
                userPrompt: currentPrompt,
                temperature: firstAttempt ? 0.2 : 0.3,
                maxTokens: firstAttempt ? maxTokens : Math.min(maxTokens * 2, 4096),
                jsonMode: true,
              })

              const output = llmResult.content || ""
              hasNoLLM = output.includes("[NO_LLM]") || output === "NO_LLM"

              if (hasNoLLM) break

              // Parse & write files
              const filesToWrite = parseLLMOutput(output)
              writeFiles(filesToWrite, allModified)

              if (filesToWrite.length === 0) {
                verifyNote = "⚠️ No files generated"
                break
              }

              // Verify compilation
              try {
                verifier.detectLanguage(projectDir)
                const cc = verifier.verifyCompile(projectDir)
                verifyPassed = cc.passed
                verifyNote = verifyPassed ? "✅ Compile OK" : `⚠️ ${cc.output.slice(0, 200)}`

                if (verifyPassed) break // ✅ Success — exit retry loop

                // ── Error analysis + selective rollback ──
                const analysis = await errorAnalyzer.analyzeDeep(cc.output, [...allModified])
                const filesToRollback = autoRetry.getFilesToRollback(analysis, [...allModified], cc.output)

                if (filesToRollback.length > 0 && hasGitRollback && preChangeCommit) {
                  try {
                    execFileSync("git", ["checkout", "--", ...filesToRollback.map(f => join(projectDir, f))],
                      { cwd: projectDir, stdio: "pipe", timeout: 15000 })

                    // Remove rolled back files from allModified (keep successfully compiled ones)
                    const rolledBackSet = new Set(filesToRollback)
                    const keptFiles: string[] = []
                    for (const f of allModified) {
                      if (!rolledBackSet.has(f)) keptFiles.push(f)
                    }
                    allModified.length = 0
                    allModified.push(...keptFiles)
                  } catch { /* rollback best-effort */ }
                }

                // Record retry attempt
                autoRetry.recordAttempt(cc.output, analysis, filesToRollback)
                verifier.clearCompileCache()

                // Build retry prompt with failure context injection
                retryPrompt = autoRetry.buildRetryPrompt(
                  args.goal, cc.output, analysis,
                  autoRetry.getStrategyForAttempt(autoRetry.getCurrentAttempt()),
                  [...allModified],
                )

                firstAttempt = false
              } catch {
                verifyNote = "⚠️ Verify error"
                break
              }
            } while (autoRetry.canRetry())

            // ── Final fallback: if all retries failed, rollback all ──
            if (!verifyPassed && hasGitRollback && preChangeCommit && allModified.length > 0) {
              try {
                execFileSync("git", ["checkout", "--", ...allModified.map(f => join(projectDir, f))],
                  { cwd: projectDir, stdio: "pipe", timeout: 15000 })
                verifyNote += ` 🔄 Full rollback to pre-change state`
              } catch {
                verifyNote += ` ⚠️ Rollback attempted but may be incomplete`
              }
              allModified.length = 0
            }

            // Record execution
            for (const step of activeSteps) {
              depTracker.recordChange(context.sessionID, step.id, allModified)
              executor.recordResult(context.sessionID, {
                stepId: step.id,
                success: !hasNoLLM && (verifyPassed || allModified.length > 0),
                output: hasNoLLM
                  ? "No LLM (mock)"
                  : `Files: ${allModified.join(", ")}${autoRetry.getRetrySummary() ? ` ${autoRetry.getRetrySummary()}` : ""}`,
                filesModified: allModified,
              })
              completedSteps.push(step.id)
            }
          }

          // ─── POST-PHASE: hanya kalau thorough ───
          // Guard + debate + post-processing semuanya fire-and-forget
          // supaya gak ngeblok response utama
          if (thorough && !hasNoLLM && allModified.length > 0) {
            ;(async () => {
              // Guard — verifikasi file claims (sync, fast)
              try {
                const guard = new HallucinationGuard(projectDir)
                const checkOutput = `Created files: ${allModified.join(", ")}, wrote implementations for ${activeSteps.map(s => s.description).join(", ")}`
                const guardResult = guard.check(checkOutput, allModified)
                if (guardResult?.claims) {
                  const failedClaims = guardResult.claims.filter((c: any) => !c.verified)
                  verifyNote += failedClaims.length > 0 ? ` ⚠️ Guard:${failedClaims.length} issues` : " ✅ Guard"
                }
              } catch { /* non-fatal */ }

              // Save episode
              try {
                episodicStore.record(context.sessionID, args.goal, verifyPassed ? "success" : "partial",
                  [`Auto via agentic_auto`, `Verify: ${verifyPassed}`, `Files: ${allModified.length}`], allModified,
                  domainRegistry.getCurrentDomain() ?? undefined, projectId)
              } catch { /* non-fatal */ }

              // Extract skill (async)
              try {
                const skillOutput = `Goal: ${args.goal}\nFiles: ${allModified.join(", ")}\nVerify: ${verifyPassed ? "passed" : "failed"}\nSteps: ${activeSteps.map(s => s.description).join("; ")}`
                await skillStore.extract({ role: "auto", content: skillOutput }, [args.goal])
              } catch { /* non-fatal */ }

              // Tech debt score
              try {
                const scorer = new TechDebtScorer()
                const absFiles = allModified.map(f => join(projectDir, f))
                const contents = new Map<string, string>()
                for (const f of absFiles) {
                  try { contents.set(f, readFileSync(f, "utf-8")) } catch { /* skip */ }
                }
                scorer.score(args.goal, absFiles, contents)
              } catch { /* non-fatal */ }

              // Memory consolidation — archive working → episodic + pattern extraction
              try {
                const report = memoryOrchestrator.consolidate(sessionStore.getActiveSessions())
                if (report.workingArchived > 0 || report.patternsExtracted > 0) {
                  consolidationScheduler.onSessionEnd()
                }
              } catch { /* non-fatal */ }

              // Phase 4B: Auto-evolution — check if evolution should be triggered
              try {
                const evoTrigger = continuousEvolution.shouldEvolve(context.sessionID)
                if (evoTrigger) {
                  runAutoEvolve().catch(() => { /* non-fatal */ })
                }
              } catch { /* non-fatal */ }

              // Phase 4A: Auto-mature skills that meet next-stage criteria
              try {
                const matureSummary = skillStore.autoMature()
                const matureKeys = Object.keys(matureSummary)
                if (matureKeys.length > 0) {
                  // Log for observability
                  const totalMatured = Object.values(matureSummary).reduce((a: number, b: number) => a + b, 0)
                  if (totalMatured > 0) {
                    console.debug(`[auto] Auto-matured ${totalMatured} skills: ${JSON.stringify(matureSummary)}`)
                  }
                }
              } catch { /* non-fatal */ }
            })().catch((err) => console.warn(`[agentic_auto] thorough post-processing error:`, err))
          }

          const allSuccess = !hasNoLLM
          const duration = ((Date.now() - startTime) / 1000).toFixed(1)

          const result = {
            completedSteps, failedSteps: [],
            totalSteps: activeSteps.length, success: allSuccess,
            summary: `${allModified.length} files in ${duration}s · ${verifyNote}${memoryContexts.length ? ` · ${memoryContexts.length} past tasks` : ""}${skillContexts.length ? ` · ${skillContexts.length} skills` : ""}`,
          }

          traceLogger.log({
            step: "auto", input: args.goal, output: JSON.stringify(result),
            toolUsed: "agentic_auto", success: allSuccess, durationMs: Date.now() - startTime,
          })

          const rolledBack = hasGitRollback && !verifyPassed && preChangeCommit ? " 🔄 Files rolled back to pre-change state" : ""
          const fileList = allModified.length > 0
            ? `\n\n### Files Changed\n${allModified.map(f => `- \`${f}\``).join("\n")}`
            : (rolledBack ? "\n\n⚠️ All changes were rolled back due to verification failure." : "")
          const memNote = memoryContexts.length > 0 ? `\n📚 ${memoryContexts.length} similar past tasks consulted` : ""
          const skillNote = skillContexts.length > 0 ? `\n🎯 ${skillContexts.length} relevant skills applied` : ""

          return {
            output: `## 🤖 Auto Complete\n\n**Goal:** ${args.goal}\n**Duration:** ${duration}s\n**Files:** ${allModified.length}\n**Verify:** ${verifyNote}${rolledBack}${memNote}${skillNote}${fileList}`,
            metadata: { result, success: allSuccess, plan, filesModified: allModified, episodes: memoryContexts.length, skills: skillContexts.length, rolledBack: hasGitRollback && !verifyPassed },
          }
        },
      }),

    },

    // ── Config hook: register agent programmatically ──
    // OpenCode's config hook lets plugins add agent definitions directly
    // to config.agent. Set mode: "primary" or "all" to appear in agent switcher.
    config: async (config) => {
      if (typeof config !== "object" || config === null) return
      const cfg = config as Record<string, unknown>
      const agentDef: Record<string, unknown> = {
        description: "Agentic Engineering Agent — autonomous software engineering with planning, execution, and verification",
        mode: "primary",
        hidden: false,
        color: "accent",
        permission: {
          read: "allow",
          edit: "allow",
          write: "allow",
          bash: "allow",
          glob: "allow",
          grep: "allow",
          webfetch: "allow",
          websearch: "allow",
          task: "allow",
          todowrite: "allow",
          lsp: "allow",
          skill: "allow",
          external_directory: "allow",
          doom_loop: "allow",
          question: "allow",
        },
        prompt: `You are an autonomous software engineering agent.
Your full instructions, tool list, and domain-specific rules are injected dynamically into every LLM call by the agentic-engine plugin.`,
      }
      // Add to config.agent — the standard way to register agents.
      // mode: "primary" makes it appear in the agent switcher.
      // mode: "all" also works (primary + subagent).
      if (!cfg.agent) cfg.agent = {}
      ;(cfg.agent as Record<string, unknown>).agentic = agentDef
      // Set as default agent if user hasn't configured their own
      if (!cfg.default_agent) {
        cfg.default_agent = "agentic"
      }
    },

    // ── Dynamic system prompt injection per LLM call ──
    // KNOWLEDGE-FIRST ARCHITECTURE (2026):
    //   Sebelum prompt dikirim ke LLM, kita auto-inject:
    //   1. RAG results → <knowledge-context> section
    //   2. Confidence scoring → mandatory research flow
    //   3. Tool selection → instructions section
    //   4. Guardrails → anti-hallucination
    //
    //   LLM = reasoning engine, BUKAN knowledge base.
    //   Semua pengetahuan HARUS dari RAG / web / arXiv.
    "experimental.chat.system.transform": async (_input: { sessionID?: string; model: unknown }, output: { system: string[] }) => {
      let transformOk = false

      // ⚡ This hook ONLY fires in chat mode.
      // Set flag so LLMEngine can skip session.prompt() immediately
      // instead of hanging for 120s waiting for user input.
      llmEngine.setChatMode(true)

      // ── Model tracking for chat mode ──
      // Each chat turn uses the model from _input.model (OpenCode auto-resolve).
      // Track it so dashboard shows actual model usage, not just "opencode/default — calls: 0".
      try {
        if (_input.model) {
          let modelStr: string | undefined
          if (typeof _input.model === "string") {
            modelStr = _input.model
          } else if (typeof _input.model === "object" && _input.model !== null) {
            const m = _input.model as { providerID?: string; modelID?: string; id?: string }
            const pid = m.providerID ?? "opencode"
            const mid = m.modelID ?? m.id ?? "default"
            modelStr = `${pid}/${mid}`
          }
          if (modelStr && modelStr !== "opencode/default" && modelStr !== "unknown" && modelStr !== "opencode/unknown") {
            modelRegistry?.recordCall(modelStr, true, 0, "chat")
            // Sync ke llmEngine biar getCurrentModel() bisa return model yg bener
            llmEngine.setCurrentModel(modelStr)
          }
        }
      } catch { /* silent — non-critical */ }

      try {
        const systemText = output.system.join("\n")
        const subAgent = detectSubAgentRole(systemText)

        let injection: string
        let hasHighConfidenceKnowledge = false

        if (subAgent) {
          // Role-aware minimal injection
          injection = buildSubAgentInjection(subAgent.role, subAgent.tools)
          transformOk = true
        } else {
          // Full prompt for parent agent — all 29 tools shown, LLM picks which to use
          const pack = currentInjectDomain ?? domainRegistry.getCurrentPack() ?? genericDomain

          // ── KNOWLEDGE-FIRST: Auto-inject RAG results ──
          let knowledgeEntries: KnowledgeEntry[] = []
          let queryForRag = ""

          try {
            const sessionId = _input.sessionID
            if (sessionId) {
              const turns = sessionStore.getContext(sessionId, 3)
              const userTurns = turns.filter(t => t.role === "user")
              if (userTurns.length > 0) {
                queryForRag = userTurns[userTurns.length - 1].content
              }
            }

            if (!queryForRag) {
              queryForRag = systemText.slice(-2000)
            }

            const { keywords, category } = routerAgent.extractKeywords(queryForRag)
            if (keywords.length > 0) {
              const ragResult = await multiIndexRAG.searchWithConfidence(keywords.join(" "), [category], 5)
              if (!ragResult.isEmpty) {
                knowledgeEntries = ragResult.entries
                  .map(entry => ({
                    source: entry.title,
                    confidence: entry.confidence ?? 0,
                    content: entry.episode?.summary ?? entry.skill?.definition.trigger.pattern ?? "",
                    category: entry.category,
                  }))
                  .filter(e => e.content.length > 0)

                hasHighConfidenceKnowledge = knowledgeEntries.some(e => e.confidence >= 0.6)
              }
            }
          } catch (e) {
            console.error("[Agentic] RAG search failed:", e instanceof Error ? e.message : e)
          }

          // ── Tool selection: kirim SEMUA tools — LLM modern pinter milih sendiri ──
          injection = buildAgenticSystemInstructions(pack, TOOL_REGISTRY, {
            isRouted: false,  // no subset — LLM decides which tool fits
            knowledgeEntries: knowledgeEntries.length > 0 ? knowledgeEntries : undefined,
          })

          // ── Gap #3: Code Intent Injection ──
          try {
            const sessionId = _input.sessionID
            if (sessionId) {
              const session = sessionStore.getOrCreate(sessionId)
              if (session.codeIntentMap && session.codeIntentMap.files.length > 0) {
                const compactSummary = codeIntentAnalyzer.getCompactSummary(session.codeIntentMap, 4)
                if (compactSummary) {
                  injection += `\n\n---\n### 🔍 Code Analysis Context (Intent Inference)\n`
                  injection += `The following intent analysis was derived from code structure (function names, signatures, dependencies):\n\n`
                  injection += compactSummary
                  injection += `\n\nUse this context to understand what each function is intended to do before generating code.\n`
                  injection += `⚠️ This is REFERENCE DATA — function names may not reflect actual implementation.\n`
                  injection += `---`
                }
              }
            }
          } catch { /* non-fatal */ }

          // ── Mandatory research flow ──
          if (!hasHighConfidenceKnowledge) {
            injection += `\n\n---\n`
            injection += `⚠️ **MANDATORY RESEARCH REQUIRED**\n\n`
            injection += `No high-confidence knowledge was found. ` +
              `Use \`webfetch\` to research before implementing. ` +
              `Cite sources (URLs) for every claim.`
          }

          transformOk = true
        }

        if (output.system.length > 0) {
          output.system[output.system.length - 1] += "\n\n" + injection
        } else {
          output.system.push(injection)
        }
      } catch (e) {
        // GLOBAL FALLBACK: jika transform gagal total, inject tool list minimum
        console.error("[Agentic] system.transform ERROR — injecting fallback:", e instanceof Error ? e.message : e)
        const fallbackTools = TOOL_REGISTRY.map(t => `- **${t.name}**: ${t.description.slice(0, 100)}`).join("\n")
        const fallback = `\n\n## Agentic Tools\n\nYou have access to these tools. Use them with their \`agentic_\` prefix.\n\n### Tool List (${TOOL_REGISTRY.length})\n${fallbackTools}\n\nBuilt-in tools: \`read\`, \`edit\`, \`bash\`, \`grep\`, \`webfetch\`, \`write\`.`
        if (output.system.length > 0) {
          output.system[output.system.length - 1] += "\n\n" + fallback
        } else {
          output.system.push(fallback)
        }
      }

      // Track injection status for diagnostic
      try {
        const sid = _input.sessionID || "unknown"
        const diag = diagnosticStore.get(sid) || { errors: 0, lastOk: 0, lastError: "" }
        if (transformOk) {
          diag.lastOk = Date.now()
          diag.lastError = ""
        } else {
          diag.errors++
          diag.lastError = "transform completed but injection may be incomplete"
        }
        diagnosticStore.set(sid, diag)
      } catch { /* non-critical */ }
    },

    // ── Model detection via chat.params — source of truth dari OpenCode SDK ──
    // Setiap kali prompt dikirim ke LLM, hook ini fires dengan model ASLI yang dipakai.
    // Struktur input: { sessionID, agent, model: { providerID, id, name, family }, provider, message }
    // Struktur output: { temperature, topP, topK, maxOutputTokens, options }
    // Lebih akurat daripada experimental.chat.system.transform karena ini hook resmi.
    "chat.params": async (input: unknown, _output: unknown) => {
      try {
        const inp = input as Record<string, unknown>
        const mdl = inp.model as Record<string, unknown> | undefined
        const providerID = mdl?.providerID as string | undefined
        const modelID = mdl?.id as string | undefined
        if (providerID && modelID) {
          const modelStr = `${providerID}/${modelID}`
          if (modelStr !== "opencode/default" && modelStr !== "unknown" && modelStr !== "opencode/unknown") {
            // Sync ke llmEngine biar getCurrentModel() / getOpenCodeModel() return model beneran
            llmEngine.setCurrentModel(modelStr)
            // Track ke registry (dengan taskType "chat" biar gak campur aduk sama agentic)
            modelRegistry?.recordCall(modelStr, true, 0, "chat")
          }
        }
      } catch { /* silent — non-critical */ }
    },

    "tool.execute.after": async (toolInput: { tool: string; args: Record<string, unknown>; sessionID: string; callID: string }, _output: { title: string; output: string; metadata: unknown }) => {
      // Record tool call for ToolRouter adaptive routing (keep last 20)
      const toolName = toolInput.tool
      toolRouter.recordCall(toolName, true, 0)
      recentToolCalls.push(toolName)
      if (recentToolCalls.length > 20) recentToolCalls.shift()

      traceLogger.log({
        step: "tool",
        input: JSON.stringify(toolInput.args ?? {}),
        output: "completed",
        toolUsed: toolName,
        success: true,
        durationMs: 0,
      })

      // Feed LiveEvaluator from tool execution
      try {
        const args = toolInput.args ?? {}
        switch (toolInput.tool) {
          case "agentic_execute": {
            const success = args.success === true
            if (args.stepId) {
              liveEvaluator.feedStepResult({ stepId: String(args.stepId), success, sessionId: toolInput.sessionID })
              // Error recovery tracking: if retry succeeded after an error
              if (success && args.error && String(args.error).length > 0) {
                liveEvaluator.feedErrorRecovery(`exec-${args.stepId}`, true)
              } else if (!success && args.error && String(args.error).length > 0) {
                liveEvaluator.feedErrorRecovery(`exec-${args.stepId}`, false)
              }
            }
            break
          }
          case "agentic_reflect": {
            // Each reflect call counts as error recovery attempt
            if (args.stepId) {
              liveEvaluator.feedErrorRecovery(`reflect-${args.stepId}`, true)
            }
            break
          }
          case "agentic_nav": {
            if (args.query) {
              // Gunakan metadata files array untuk akurasi (bukan regex .ts count)
              // Fix: metadata.files adalah array dari navigator.findRelevantFiles()
              const meta = _output?.metadata as { files?: string[] } | undefined
              const fileCount = meta?.files?.length ?? 0
              liveEvaluator.feedNavigation(String(args.query), fileCount)
            }
            break
          }
          case "agentic_delegate": {
            if (args.taskId && args.role) {
              const outputOk = (_output?.output || "").includes("delegated") || (_output?.output || "").includes("Delegated")
              liveEvaluator.feedDelegation(String(args.taskId), String(args.role), outputOk)
            }
            break
          }
          case "agentic_skill": {
            if (args.action === "find" || args.action === "search") {
              const found = (_output?.output || "").includes("Skill") || (_output?.output || "").includes("skill")
              liveEvaluator.feedSkillLookup(found)
            }
            break
          }
          case "agentic_debate": {
            if (args.task) {
              const approved = (_output?.output || "").includes("Approved")
              liveEvaluator.feedStepResult({ stepId: `debate-${String(args.task).slice(0, 40)}`, success: approved, sessionId: toolInput.sessionID })
            }
            break
          }
          case "agentic_router": {
            if (_output?.output && typeof _output.output === "string") {
              const match = _output.output.match(/Category:\s*(\S+)/)
              if (match) liveEvaluator.feedNavigation(String(args.input), 1)
            }
            break
          }
          case "agentic_clean": {
            if (args.text && _output?.output) {
              liveEvaluator.feedStepResult({ stepId: "clean", success: true, sessionId: toolInput.sessionID })
            }
            break
          }
          case "agentic_rag": {
            if (args.action === "search" && _output?.output) {
              const match = _output.output.match(/Matches:\s*(\d+)/)
              if (match) liveEvaluator.feedSkillLookup(parseInt(match[1]) > 0)
            }
            break
          }
          case "agentic_mcp": {
            if (args.action === "connect" && _output?.output) {
              liveEvaluator.feedDelegation("mcp-connect", String(args.name || "unknown"), _output.output.includes("Connected"))
            }
            break
          }
        }
      } catch { /* non-fatal */ }
    },

    dispose: async () => {
      configLoader.stopWatch()
      persistence.save("models", "registry", modelRegistry.toJSON())
      persistence.save("prompts", "state", roleRegistry.getAllPromptStates())
      persistence.save("evolution", "trend", continuousEvolution.toJSON(), projectId)
      persistence.save("evaluation", "live", liveEvaluator.toJSON(), projectId)
      await traceLogger.dispose()
    },
  }
}

export const AgenticEngine: Plugin = createEngine

const pluginModule: PluginModule = {
  id: "agentic-engine",
  server: createEngine,
}
export default pluginModule

// Re-export key classes so tests can construct them directly
export { Dashboard } from "./observability/dashboard.js"
export { A2AServer } from "./agents/a2a-server.js"
export { A2AClient, type DiscoveredAgent } from "./agents/a2a-client.js"
export {
  A2A_METHODS,
  A2A_PROTOCOL_VERSION,
  createTaskId,
  createTextMessage,
  createJsonRpcRequest,
  createJsonRpcResult,
  createJsonRpcError,
  type AgentCard,
  type AgentCardCapability,
  type Task,
  type TaskId,
  type TaskStatus,
  type A2AMessage,
  type Artifact,
  type Part,
  type TextPart,
  type FilePart,
  type DataPart,
  type MessageRole,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "./agents/a2a-types.js"

export { ErrorAnalyzer } from "./core/error-analyzer.js"
export { RoleRegistry } from "./agents/role-registry.js"
export { VectorStore } from "./memory/vector-store.js"
export { Verifier } from "./core/verifier.js"
export { ContinuousEvolution } from "./evolution/continuous-evolution.js"
export { SelfEvolver } from "./evolution/self-evolver.js"
export { AgentCoordinator, type AgentPhase, type BlackboardCycleResult } from "./agents/coordinator.js"
export { Executor } from "./core/executor.js"
export { PatternDiscovery } from "./drift/pattern-discovery.js"
export { skillToTrainingExample, skillsToTrainingData, exportOpenAIJSONL, exportInstructionsJSON, trainingDatasetSummary } from "./memory/skill-training.js"
export { LiveEvaluator } from "./evaluation/live-evaluator.js"
export { BudgetTracker } from "./core/budget-tracker.js"
export { FineTuningClient } from "./core/fine-tuning.js"
export { episodeToTrainingExample, episodesToTrainingData, prepareFineTuningDataset, saveTrainingDataToFile } from "./memory/skill-training.js"
export { ConfigLoader, validateConfig } from "./core/config.js"
export { PersistenceLayer } from "./memory/persistence.js"
export { EpisodicStore } from "./memory/episodic-store.js"
export { SkillStore, createSkillDefinition, inspectSkill, serializeSkill, deserializeSkill } from "./memory/skill-store.js"
export { type SkillRecord } from "./memory/skill-store.js"
export { STOP_WORDS, isStopWord, filterStopWords, getStopWordStats } from "./memory/stopwords.js"
export { PromptTemplate, type KnowledgeEntry } from "./core/prompt-template.js"
export { ToolRouter } from "./core/tool-router.js"
export { SemanticCache } from "./core/semantic-cache.js"
export { DslExecutor, validateDSL, resolvePath, setPath, resolveValue, type DslInstruction, type DslOp, type CompareOp, type DslContext, type DslResult, type DslFullResult, type DslStepResult, type DslTrace, type DslValidationError, type SkillDef, MAX_DSL_INSTRUCTIONS, MAX_DSL_NESTING, DSL_OP_WHITELIST } from "./core/dsl-executor.js"
export { SchemaValidator, type SchemaField, type SchemaFieldType, type SkillSchema, type SchemaValidationResult, type SchemaValidationError, type SchemaErrorCode } from "./core/skill-schema.js"
export { CodeSandbox, CodeModuleRegistry, checkBannedTokens, sandboxExecute, runSandboxTests, type BannedToken, type BannedTokenIssue, type CodeModule, type SandboxExecutionResult, type SandboxTestCase, type SandboxTestResult, type CodeGenerationResult, type SandboxSchemaField, DEFAULT_BANNED_TOKENS } from "./core/code-sandbox.js"
export { TreeSearchPlanner, defaultExpansion, scoreState, diversityBonus, scoreWithDiversity, DEFAULT_BEAM_WIDTH, DEFAULT_MAX_DEPTH, EARLY_STOP_THRESHOLD, DIVERSITY_WEIGHT, type PlanState, type TreeSearchResult, type TreeSearchConfig, type ExpansionFn } from "./core/planner-tree-search.js"
export { Planner, type MacroPhase, type MicroStep, type HierarchicalPlan, type PhaseContextMapping, type PhaseErrorContext } from "./core/planner.js"
export { SkillImprover, type SkillTestCase, type EvaluationScore, type ImprovementResult } from "./core/skill-improver.js"
export { AttentionScheduler, MAX_SCHEDULER_CYCLES, type AgentScheduleConfig, type AgentScheduleState, type SharedState, type CycleResult, type SchedulerMetrics } from "./core/attention-scheduler.js"
export { WorldModel, type WorldSnapshot, type Belief, type Entity, type Relation, type WorldModelConfig, type BeliefEvidence, type BeliefUpdateResult } from "./core/world-model.js"
export { SimulationEngine, type SimulationInput, type SimulationResult, type SimulatedStep, type SimulatedStepResult, type SimulationConfig } from "./core/simulation-engine.js"
export { MetaReasoner, createDefaultStrategy, type StrategyConfig, type StrategyParam, type PerformanceRecord, type StrategyVersion, type AdaptationResult, type MetaReasonerConfig } from "./core/meta-reasoner.js"
export { DAGEngine, type DAGNode, type DAGPlan, type DAGNodeType, type NodeStatus, type DAGExecutionContext, type DAGResult, type ExecutionPhase, type RetryStrategy, type RecoveryStrategy, type NodeRunner, type DAGObserver } from "./core/dag-engine.js"
export { buildAgentPrompt, buildAgenticSystemInstructions, buildGenericAgentPrompt } from "./core/prompt-builder.js"
export { SessionStore } from "./memory/session-store.js"
export { MemoryOrchestrator, type MemoryLevel, type MemoryEntry, type MemoryQuery, type MemoryQueryResult, type ConsolidationReport } from "./memory/memory-orchestrator.js"
export { ConsolidationScheduler, type ConsolidationSchedule, type ConsolidationTrigger, type SchedulerStats, type ConsolidationCallback } from "./memory/consolidation-scheduler.js"
export { ConstraintManifold, type ConstraintViolation, type ConstraintCheck, type SafetyPolicy, type ActionProposal, type ConstraintCategory, type ConstraintSeverity, type ConstraintConfig } from "./core/constraint-manifold.js"
export { type SkillLifecycleStage, type MaturationCriteria } from "./memory/skill-store.js"
export { LLMEngine, type LLMConfig, type LLMRequest, type LLMResponse, TOOL_COMPLEXITY } from "./core/llm.js"
export { ModelRegistry, type ModelStats, type ModelScore } from "./core/model-registry.js"
