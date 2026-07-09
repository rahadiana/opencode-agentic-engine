import type { Plugin, PluginModule } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync, readdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join, dirname, resolve } from "node:path"
import { homedir } from "node:os"
import { DomainRegistry, type DomainPack } from "./core/domain-registry.js"
import { genericDomain } from "./core/domains/generic.js"
import { codeDomain } from "./core/domains/code.js"
import { securityDomain } from "./core/domains/security.js"
import { devopsDomain } from "./core/domains/devops.js"
import { dataScienceDomain } from "./core/domains/data-science.js"
import { mobileDomain } from "./core/domains/mobile.js"
import { IntentParser, type TaskIntent, type Subtask } from "./core/intent-parser.js"
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
import { SkillCurator } from "./curation/skill-curator.js"
import { EpisodicStore, type Episode } from "./memory/episodic-store.js"
import { MemoryOrchestrator } from "./memory/memory-orchestrator.js"
import { ConsolidationScheduler } from "./memory/consolidation-scheduler.js"
import { initSecondBrain, getSecondBrain } from "./memory/second-brain.js"
import { HallucinationGuard, type ClaimResult, type HallucinationCheck } from "./drift/hallucination-guard.js"
import { ParallelExecutor, parseLLMStepImplementation } from "./core/parallel.js"
import { Dashboard } from "./observability/dashboard.js"
import { createLogger, setGlobalLogClient, type LogClient } from "./observability/logger.js"
import { CheckpointSystem } from "./drift/checkpoints.js"
import { SessionStore } from "./memory/session-store.js"
import { TOOL_COMPLEXITY } from "./core/llm-types.js"
import { TraceLogger } from "./observability/trace-logger.js"
import { RoleRegistry, type PromptEntry } from "./agents/role-registry.js"

import { MemorySchemaVersion, createMemoryEnvelope } from "./memory/schema-version.js"
import { createSkillDefinition, inspectSkill, serializeSkill, formatAntiRationalizations } from "./memory/skill-format.js"
import { detectTaskType } from "./core/task-classifier.js"
import { skillsToTrainingData, trainingDatasetSummary, skillToTrainingExample } from "./memory/skill-training.js"
import { SelfEvolver } from "./evolution/self-evolver.js"
import { ContinuousEvolution } from "./evolution/continuous-evolution.js"
import { LLMEngine } from "./core/llm.js"
import { AgentLoop } from "./core/agent-loop.js"
import { StateStore } from "./core/state-store.js"
import { SQLitePersistence } from "./memory/sqlite-persistence.js"
import { ModelRegistry } from "./core/model-registry.js"
import { ConfigLoader } from "./core/config.js"
import { BudgetTracker } from "./core/budget-tracker.js"
import { AutoRetryManager } from "./core/auto-retry.js"
import { EventBus } from "./core/event-bus.js"
import { WorkflowEngine } from "./core/workflow-engine.js"
import { PatternDiscovery } from "./drift/pattern-discovery.js"
import { LiveEvaluator } from "./evaluation/live-evaluator.js"
import { DebateLoop } from "./core/debate-loop.js"
import { RouterAgent, detectLifecyclePhase } from "./core/router-agent.js"
import { DataCleaner } from "./core/data-cleaner.js"
import { MultiIndexRAG } from "./memory/multi-index-rag.js"
import { MCPClient } from "./core/mcp-client.js"
import { ProtocolAdapter } from "./core/protocol-adapter.js"
import { DynamicToolRegistry } from "./core/dynamic-tool-registry.js"
import { MCPServer } from "./core/mcp-server.js"
import { buildAgenticSystemInstructions, type ToolEntry } from "./core/prompt-builder.js"
import { AGENTIC_TOOL_REGISTRY } from "./core/tool-catalog.js"
import { detectProjectContext, type ProjectContext } from "./core/project-context.js"
import { type KnowledgeEntry } from "./core/prompt-template.js"
import { ToolRouter } from "./core/tool-router.js"
import { ConfidenceScorer, ConfidenceStore, type ConfidenceScore } from "./core/confidence-scorer.js"
import { codeIntentAnalyzer } from "./core/code-intent-analyzer.js"
import { SchemaValidator } from "./core/skill-schema.js"
import { parseFileEntries, writeFiles as writeFilesHelper } from "./core/execution-helpers.js"
import { DslExecutor } from "./core/dsl-executor.js"
import { ErrorRecovery } from "./core/error-recovery.js"
import { AlignmentGate } from "./core/alignment-gate.js"
import { EconomicModel } from "./core/economic-model.js"
import { ConstraintManifold } from "./core/constraint-manifold.js"
import { WorldModel } from "./core/world-model.js"
import { SimulationEngine, type SimulatedStep } from "./core/simulation-engine.js"
import { MetaReasoner } from "./core/meta-reasoner.js"
import { ToolUsageTracker } from "./core/tool-usage-tracker.js"
import { BlueprintParser, BlueprintResolver, type ModelSpecMap } from "./core/agent-blueprint.js"
import { autoUpdatePlugin } from "./core/plugin-updater.js"
import { evaluateWorkflowPolicy, formatWorkflowPolicyDecisions, verificationEvidenceFailed } from "./core/workflow-policy.js"
import { setSkillStore, setEpisodicStore, setAgenticKnowledge, setConfigLoader, getSkillStore, getEpisodicStore, getConfigLoader, getA2AClient, setA2AClient, getA2AServer, setA2AServer } from "./core/shared-instances.js"
import { makeStatusTool } from "./tools/status.js"
import { makeCleanTool } from "./tools/clean.js"
import { makeSnapshotTool } from "./tools/snapshot.js"
import { makeBudgetTool } from "./tools/budget.js"

// ── Build-time version injected by esbuild define ──
declare const __VERSION__: string

type VerificationEvidence = {
  build?: "passed" | "failed" | "skipped"
  lint?: "passed" | "failed" | "skipped"
  techDebt?: "low" | "medium" | "high" | "critical"
  tests?: Array<{ command?: string; passed?: number; failed?: number }>
}

// ── Helpers for agentic_fetch auto-indexing ──
/** Detect content type: HTML page, source code, JSON, or plain text */
function detectContentType(content: string, contentTypeHeader: string, url: string): "html" | "code" | "json" | "text" {
  if (contentTypeHeader.startsWith("text/html") || contentTypeHeader.startsWith("application/xhtml")) return "html"
  if (contentTypeHeader.startsWith("application/json") || url.match(/\.json$/i)) return "json"
  if (content.match(/^\s*</)) return "html"
  if (url.match(/\.(ts|js|tsx|jsx|mjs|cjs|mts|cts|py|rs|go|java|c|cpp|h|hpp|rb|php|swift|kt|scala|ex|exs|hs|lua|r|sh|bash|zsh|fish|sql|graphql|css|scss|less|sass|vue|svelte|astro)$/i)) return "code"
  return "text"
}
/** Extract readable text from HTML while preserving <pre>/<code> blocks */
function htmlToText(html: string): string {
  const codeBlocks: string[] = []
  const saved = html.replace(/<(pre|code)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi, (_, _tag, inner) => {
    codeBlocks.push(inner.replace(/<[^>]+>/g, "").trim())
    return `\n---CODEBLOCK${codeBlocks.length - 1}---\n`
  })
  return saved
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/---CODEBLOCK(\d+)---/g, (_, idx) => `\n\`\`\`\n${codeBlocks[parseInt(idx as string)] || ""}\n\`\`\`\n`)
}
/** Extract meaningful summary based on content type */
function extractSummary(content: string, type: "html" | "code" | "json" | "text"): string {
  if (type === "code") {
    const lines = content.split("\n").filter(l => l.trim() && !l.trim().startsWith("//") && !l.trim().startsWith("/*") && !l.trim().startsWith("*"))
    const sigLines = lines.slice(0, Math.min(15, lines.length)).join("\n")
    const totalLines = content.split("\n").length
    return `${sigLines.slice(0, 800)}\n\n(... ${totalLines} total lines, ${content.length} chars)`
  }
  if (type === "json") {
    const first = content.replace(/\s+/g, " ").trim().slice(0, 500)
    const keys = content.match(/"([^"]+)":/g)?.slice(0, 10).map(k => k.replace(/[":]/g, "")) || []
    return `${first}\n\nTop keys: ${keys.join(", ")}`
  }
  return content.replace(/\s+/g, " ").trim().slice(0, 1000)
}
/** Build tags for a fetched URL */
function buildFetchTags(url: string, ctype: string): string[] {
  const tags: string[] = ["web-fetch"]
  const parts = url.split("/").filter(Boolean).slice(-3).map(t => t.replace(/[^a-zA-Z0-9-]/g, "").toLowerCase()).filter(Boolean)
  tags.push(...parts)
  if (ctype === "code") {
    tags.push("source-code")
    const ext = url.match(/\.([a-z0-9]+)(?:\?|$)/i)?.[1] || ""
    if (ext) tags.push(`ext-${ext}`)
    const langMap: Record<string, string> = { ts: "typescript", js: "javascript", py: "python", rs: "rust", go: "golang", rb: "ruby", java: "java", cs: "csharp", php: "php", swift: "swift", kt: "kotlin" }
    if (langMap[ext]) tags.push(langMap[ext])
  } else if (ctype === "html") {
    tags.push("html")
  } else if (ctype === "json") {
    tags.push("json")
  }
  if (tags.length < 2) tags.push("web-research")
  return [...new Set(tags)]
}

function evidenceToSignals(evidence?: VerificationEvidence): Partial<import("./core/confidence-scorer.js").ScoringSignals> {
  if (!evidence) return {}
  const testTotals = evidence.tests?.reduce<{ passed: number; failed: number }>((acc, t) => {
    acc.passed += t.passed ?? 0
    acc.failed += t.failed ?? 0
    return acc
  }, { passed: 0, failed: 0 })
  const totalTests = testTotals ? testTotals.passed + testTotals.failed : 0
  return {
    compileResult: evidence.build && evidence.build !== "skipped" ? { passed: evidence.build === "passed" } : undefined,
    lintResult: evidence.lint && evidence.lint !== "skipped" ? { passed: evidence.lint === "passed" } : undefined,
    testResult: testTotals && totalTests > 0 ? { passed: testTotals.failed === 0, total: totalTests, passedCount: testTotals.passed } : undefined,
    techDebtScore: evidence.techDebt ? { overall: evidence.techDebt } : undefined,
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

  // ── Error log file (persistent, append-only) ──
  const errorLogPath = join(worktree, ".agentic", "errors.log")
  function logErrorToFile(toolName: string, message: string, stack?: string): void {
    try {
      const dir = dirname(errorLogPath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      const timestamp = new Date().toISOString()
      const entry = `[${timestamp}] [${toolName}] ${message}${stack ? `\n${stack.split("\n").slice(0, 4).join("\n")}` : ""}\n`
      appendFileSync(errorLogPath, entry, "utf-8")
    } catch (e) { log.warn("Silent catch: non-fatal: if file write fails, nothing we can do", { error: String(e) }) }
  }

  // ── Config (load first, everything else depends on it) ──
  const configLoader = new ConfigLoader(worktree)
  setConfigLoader(configLoader)
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

  // ── Project context (auto-detect language, framework, test patterns) ──
  // Cached in .agentic/project-context.json, invalidated on config file changes.
  const projectContext: ProjectContext = detectProjectContext(worktree)

  // ── Tool registry (shared between prompt builder and tool definitions) ──
  // Single source of truth: src/core/tool-catalog.ts
  const TOOL_REGISTRY: ToolEntry[] = AGENTIC_TOOL_REGISTRY

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
  const currentInjectDomain: DomainPack = genericDomain
  const log = createLogger("Agentic")

  // Write initial prompt (deferred — after persistence is available for smart cache)

  const intentParser = new IntentParser()
  const executor = new Executor()
  const budgetTracker = new BudgetTracker()
  executor.setBudgetTracker(budgetTracker)
  const verifier = new Verifier()
  const errorRecovery = new ErrorRecovery()
  const alignmentGate = new AlignmentGate()
  const economicModel = new EconomicModel()
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
  const dynamicToolRegistry = new DynamicToolRegistry()
  const mcpServer = new MCPServer(dynamicToolRegistry, { port: 0 })

  /**
   * Helper: register a tool in both DynamicToolRegistry AND OpenCode hooks.tool.
   * Converts Zod args schema → JSON Schema using Zod 4's built-in toJSONSchema().
   * Automatically wraps execute with error handling for all tools.
   */
  function registryTool(
    name: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    def: { description: string; args: any; execute: (args: any, context: any) => Promise<any> },
    registryMeta?: { version?: string; category?: string; keywords?: string[] },
  ) {
    // Wrap execute with global error handler
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrappedExecute = async (args: any, context: any) => {
      // ponytail: context can be undefined when tools are called without session context
      if (!context?.sessionID) {
        return { output: `❌ **${name}** requires an active session. Make sure a session is created before calling this tool.`, metadata: { error: "no-session", tool: name } }
      }
      try {
        // Auto-set LLM session + tool context for model resolution
        llmEngine.setSessionId(context.sessionID as string)
        llmEngine.setToolContext(name)
        const result = await def.execute(args, context)
        return result
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err)
        const errStack = err instanceof Error ? err.stack : ""
        log.error(`[Agentic] ❌ Tool "${name}" execution failed:\n  ${errMsg}\n${errStack ? `  ${errStack.split("\n").slice(1, 4).join("\n  ")}` : ""}`)
        logErrorToFile(name, errMsg, errStack)
        return {
          output: `❌ **${name}** execution failed: ${errMsg}\n\nPlease check your inputs and try again. If the problem persists, use \`agentic_reflect\` for debugging.`,
          metadata: { error: errMsg, tool: name },
        }
      }
    }

    try {
      const zodObj = tool.schema.object(def.args)
      const jsonSchema = tool.schema.toJSONSchema(zodObj, { target: "draft-7", unrepresentable: "any" })
      dynamicToolRegistry.registerFromTool(
        name,
        def.description,
        jsonSchema as Record<string, unknown>,
        wrappedExecute as (args: Record<string, unknown>, context?: unknown) => Promise<unknown>,
        registryMeta,
      )
    } catch (e) {
      // Non-fatal: registry registration is best-effort
      const errMsg = e instanceof Error ? e.message : String(e)
      log.error(`[Agentic] ❌ Tool registration FAILED for "${name}": ${errMsg}`)
    }
    return tool({ description: def.description, args: def.args, execute: wrappedExecute as (args: Record<string, unknown>, context: Record<string, unknown>) => Promise<{ output: string }> })
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
              try { scanBatch[full] = readFileSync(full, "utf-8") } catch (e) { log.warn("Silent catch: non-fatal", { error: String(e) }) }
          }
        } catch (e) { log.warn("Silent catch: non-fatal", { error: String(e) }) }
      }
      walkDir(sourceDir)
      depTracker.scanFiles(scanBatch, worktree)
    }
  } catch (e) { log.warn("Silent catch: non-fatal", { error: String(e) }) }
  const contextCompressor = new ContextCompressor()
  const git = new GitIntegration(worktree)
  const debtScorer = new TechDebtScorer()
  const skillStore = new SkillStore()
  setSkillStore(skillStore)
  const curator = new SkillCurator(
    config.curator ?? {},
    () => skillStore.getAll(),
  )
  const coordinator = new AgentCoordinator(skillStore)
  const orchestrator = new Orchestrator()
  for (const pipeline of orchestrator.getBuiltInPipelines()) {
    orchestrator.definePipeline(pipeline)
  }
  const episodicStore = new EpisodicStore()
  setEpisodicStore(episodicStore)
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
  selfEvolver.setRoleRegistry(roleRegistry) // P2: auto-apply prompt patches to roles
  const continuousEvolution = new ContinuousEvolution()
  const patternDiscovery = new PatternDiscovery()
const liveEvaluator = new LiveEvaluator()
const modelRegistry = new ModelRegistry()
const eventBus = new EventBus()
budgetTracker.setEventBus(eventBus)
const confidenceScorer = new ConfidenceScorer()
const confidenceStore = new ConfidenceStore()
  const llmEngine = new LLMEngine()
  llmEngine.setOpencodeClient(input.client)
  // ponytail: OpenCode SDK client type differs from LogClient; unknown cast needed
  setGlobalLogClient(input.client as unknown as LogClient)
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

  // WorkflowEngine — event-driven tool chaining
  const workflowEngine = new WorkflowEngine({
    eventBus,
    sessionStore,
    orchestrator,
  })

  // Discover models from OpenCode client + env vars
  ;(async () => {
    try {
      const client = input.client as { config?: { providers?: () => Promise<{ data?: { providers: Array<{ name: string; id: string; models?: Record<string, unknown> }>; default?: Record<string, string> } }> }; models?: () => Promise<Array<{ id: string }>> }
      const allModels: string[] = []

      // 1. Try client.config.providers() — daftar provider + model dari OpenCode
      // SDK response: { data: { providers: [...], default: {...} } }
      if (client?.config?.providers) {
        const provResp = await client.config.providers()
        const providers = provResp?.data?.providers ?? []
        const defaultMap = provResp?.data?.default ?? {}
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
    } catch { log.warn("Silent catch: model discovery fallback — using env vars")
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
    } catch (e) { log.warn("Silent catch: Silent — models.json cache gak wajib ada", { error: String(e) }) }
  })()

  llmEngine.setMemoryStores({
    searchEpisodes: (query: string) => episodicStore.search(query),
    findSkills: (query: string) => skillStore.find(query).map(s => ({ name: s.definition.meta.name, successRate: s.successRate })),
  })
  llmEngine.setMemoryOrchestrator(memoryOrchestrator)
  // ── MetaReasoner (Comparison 22: Meta-Reasoning Strategy) ──
  const metaReasoner = new MetaReasoner()
  const toolUsageTracker = new ToolUsageTracker()
  const agentLoop = new AgentLoop(llmEngine, { maxIterations: 10, autoRetry: true, maxRetries: 2, verifyAfterEach: false })
  agentLoop.setEventBus(eventBus)
  agentLoop.setMetaReasoner(metaReasoner)
  agentLoop.setSimulationEngine(simulationEngine)
  agentLoop.setWorldModel(worldModel)
  agentLoop.setPatternDiscovery(patternDiscovery)
  agentLoop.setToolUsageTracker(toolUsageTracker)
  // Wire ContinuousEvolution for closed learning loop (P1)
  agentLoop.setContinuousEvolution(continuousEvolution)
  // Register default degradation callback: emit event + log
  continuousEvolution.onDegradation((_trend, trigger) => {
    const msg = `Evolution triggered: ${trigger.reason} (type: ${trigger.type}, rate: ${(trigger.metrics.recentRate * 100).toFixed(0)}%)`
    console.warn(`[ContinuousEvo] ${msg}`)
    eventBus.emit({
      type: "feedback.recorded",
      payload: {
        sessionID: "",
        stepId: "continuous-evolution",
        feedback: "negative",
        model: "",
        taskType: "evolution",
      },
    })
  })
  // Wire guardrails from config
  if (config.agent.toolGuardrails) {
    agentLoop.setGuardrailConfig(config.agent.toolGuardrails)
  }
  // Wire WorkflowPolicy config (P0: enforce gates in autonomous execution)
  const wfMode = config.agent.dumbModelMode ? "strict" : (config.agent.workflowPolicyMode ?? "advisory")
  agentLoop.setWorkflowPolicyConfig({
    mode: wfMode,
    minConfidence: config.agent.dumbModelMode ? 0.2 : undefined,
  })
  const stateStore = new StateStore({ worktree })
  // SQLite backend — lebih cepat dari file JSON, support structured queries
  // Graceful fallback: jika better-sqlite3 (Node) atau bun:sqlite (Bun) gak available
  let sqliteDB: SQLitePersistence | null = null
  try {
    sqliteDB = new SQLitePersistence()
  } catch (e) {
    log.info("[Agentic] SQLite not available — agentic_db tool disabled: " + (e as Error).message)
  }
  // Second Brain — active memory subsystem (decisions, TODOs, reflection, graph, checklist)
  const secondBrain = initSecondBrain(stateStore, sessionStore, memoryOrchestrator, llmEngine, agentRuntime)
  // Wire event-driven memory: auto-save on key events
  eventBus.onAny((event: { type: string; payload: Record<string, unknown> }) => {
    try { secondBrain.handleEvent(event.type, event.payload, event.payload?.sessionID as string | undefined) } catch (e) { log.warn("Silent catch: non-fatal", { error: String(e) }) }
  })
  // Build RAG config from config file
  const ragConfig: import("./memory/multi-index-rag.js").RAGConfig = {
    keywordWeight: config.memory.search.keywordWeight,
    vectorWeight: config.memory.search.vectorWeight,
    embedding: config.embedding, // null = TF-IDF only
  }
  const multiIndexRAG = new MultiIndexRAG(undefined, ragConfig)

  // Load persisted RAG data from disk via StateStore
  const savedRAG = stateStore.getAll("rag")
  for (const item of savedRAG) {
    multiIndexRAG.importAll(item.data as import("./memory/multi-index-rag.js").IndexData)
  }
  // Auto-persist RAG via StateStore every time data is stored
  multiIndexRAG.setPersistCallback((data) => {
    stateStore.set("rag", "global", data)
  })
  // Wire RAG into MemoryOrchestrator — single coordinator for all memory
  memoryOrchestrator.setRagStore(multiIndexRAG)

  const debateLoop = new DebateLoop(llmEngine, agentRuntime)
  const routerAgent = new RouterAgent(llmEngine)
  const dataCleaner = new DataCleaner(llmEngine)
  const mcpClient = new MCPClient()
  const protocolAdapter = new ProtocolAdapter(mcpClient)
  const toolRouter = new ToolRouter()
  toolRouter.setDescriptions(TOOL_REGISTRY)
  const recentToolCalls: string[] = []  // last 20 tool calls for routing context
  const diagnosticStore = new Map<string, { errors: number; lastOk: number; lastError: string }>()

  contextCompressor.setLLM(llmEngine)
  verifier.detectLanguage(worktree)

  // Restore persisted model stats via StateStore
  const savedModels = stateStore.getAll<Record<string, import("./core/model-registry.js").ModelStats>>("models")
  for (const m of savedModels) {
    modelRegistry.fromJSON(m.data)
  }

  // Restore persisted evolution trend + evaluator score (scoped per project) via StateStore
  const savedEvo = stateStore.get<Record<string, unknown>>("evolution", "trend", projectId)
  if (savedEvo) continuousEvolution.fromJSON(savedEvo as unknown as Parameters<typeof continuousEvolution.fromJSON>[0])
  const savedEval = stateStore.get<Record<string, unknown>>("evaluation", "live", projectId)
  if (savedEval) liveEvaluator.fromJSON(savedEval)

  // Restore persisted episodes (scoped per project) via StateStore
  const savedEpisodes = stateStore.getAll<{ planGoal: string; outcome: string; decisions: string[]; filesChanged: string[]; sessionId: string; timestamp: string; tags: string[]; projectId?: string }>("episodes", projectId)
  for (const ep of savedEpisodes) {
    episodicStore.record(ep.data.sessionId, ep.data.planGoal, ep.data.outcome as "success" | "partial" | "failed", ep.data.decisions, ep.data.filesChanged, undefined, projectId)
  }
  // Auto-save episodes to StateStore when recorded
  episodicStore.setPersistenceCallback((episode) => {
    stateStore.set("episodes", episode.sessionId, episode, projectId)
  })
  const savedSkills = stateStore.getAll<import("./memory/skill-format.js").SkillDefinition>("skills")
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
      significance: "routine",
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

  // ── ConstraintManifold (Phase 4C: Safety by design) — used by dashboard ──
  const constraintManifold = new ConstraintManifold()

  // Load cross-session knowledge artifact
  try {
    const knowledgePath = resolve(worktree, ".agentic", "knowledge.json")
    const knowledgeRaw = readFileSync(knowledgePath, "utf-8")
    const knowledge = JSON.parse(knowledgeRaw)
    if (knowledge?.sessions?.length > 0) {
      log.debug(`[init] Loaded ${knowledge.sessions.length} prior session(s) from knowledge.json`)
    }
    // Store for tool access via shared-instances
    setAgenticKnowledge(knowledge)
  } catch (e) { log.warn("Silent catch: knowledge.json may not exist yet — first session", { error: String(e) }) }

  // Restore persisted prompt states (Stage IV: versioned prompt history) — global
  const savedPrompts = stateStore.getAll<Array<{ role: string; history: PromptEntry[] }>>("prompts")
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

  try { await traceLogger.init() } catch (e) { log.warn("Silent catch: non-fatal: cannot create trace dir", { error: String(e) }) }

  // ── Auto-update: fire-and-forget version check + download ──
  if (typeof __VERSION__ !== "undefined") autoUpdatePlugin(__VERSION__, import.meta.url)

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

  /** Helper: gather evolution data from stores and feed to selfEvolver */

  /** Helper: run the full self-evolution cycle and return a summary */

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
  // Auto-evolution: setiap step completion/failure → check apakah perlu evolve
  function checkAutoEvolve(sessionId: string): void {
    try {
      const trigger = continuousEvolution.shouldEvolve(sessionId)
      if (trigger) {
        log.debug(`[auto-evolve] Triggered: ${trigger.reason}`)
        runAutoEvolve().then((result) => {
          // Tampilkan hasil evolusi ke user via trace
          log.info(`[auto-evolve] ${result.replace(/\n/g, " | ")}`)
          traceLogger.log({
            toolUsed: "auto-evolve",
            success: true,
            input: trigger.reason,
            output: result.slice(0, 500),
            step: "auto-evolve",
            durationMs: 0,
          })
        }).catch((err) => log.warn(`[auto-evolve] Fire-and-forget evolution error: ${(err as Error).message}`))
      }
    } catch (e) { log.warn("Silent catch: Non-fatal — don't let evolution errors affect step execution", { error: String(e) }) }
  }

  eventBus.on("step.completed", (ev) => {
    const p = ev.payload as { stepId: string; sessionID: string; output?: string }
    liveEvaluator.feedStepResult({ stepId: p.stepId, success: true, sessionId: p.sessionID })
    continuousEvolution.feedStepResult({
      stepId: p.stepId,
      success: true,
      output: p.output?.slice(0, 100) ?? "",
      sessionId: p.sessionID,
      timestamp: Date.now(),
    })
    // Auto-evolve check on every successful step
    checkAutoEvolve(p.sessionID)
  })
  eventBus.on("step.failed", (ev) => {
    const p = ev.payload as { stepId: string; sessionID: string; error?: string; errorCategory?: string }
    liveEvaluator.feedStepResult({ stepId: p.stepId, success: false, sessionId: p.sessionID })
    continuousEvolution.feedStepResult({
      stepId: p.stepId,
      success: false,
      output: p.error?.slice(0, 100) ?? "",
      sessionId: p.sessionID,
      timestamp: Date.now(),
      category: p.errorCategory,
    })
    // Auto-evolve check on every failed step
    checkAutoEvolve(p.sessionID)
  })
  eventBus.on("task.completed", (ev) => {
    const p = ev.payload as { taskId: string; role: string; success: boolean }
    liveEvaluator.feedDelegation(p.taskId, p.role, p.success)
  })

  // TraceLogger: log semua event ke file JSONL (wildcard)
  eventBus.onAny((ev) => {
    const p = ev.payload as Record<string, unknown> | undefined
    traceLogger.log({
      step: ev.type,
      input: JSON.stringify(p ?? {}).slice(0, 200),
      output: "",
      toolUsed: ev.type?.split(".")[0] ?? "event",
      success: !ev.type?.includes("failed") && !ev.type?.includes("exceeded"),
      durationMs: 0,
      metadata: { eventType: ev.type },
    })
  })

  // Orchestrator: auto-advance pipeline saat stage selesai
  eventBus.on("pipeline.stage.completed", (ev) => {
    const p = ev.payload as { runId: string; output: string; issues: string[] }
    orchestrator.advanceStage(p.runId, p.output, p.issues)
  })

  // ModelRegistry: catat hallucination guard failures
  eventBus.on("guard.check.completed", (ev) => {
    const p = ev.payload as { passed: boolean; sessionID: string; modelName?: string }
    if (!p.passed) {
      // Use actual model name if available, not session ID (which never matches)
      const modelId = p.modelName ?? llmEngine.getCurrentModel() ?? "unknown"
      modelRegistry.recordHallucination(modelId)
    }
  })

  // ── Batch Delegate: fan-out parallel execution for multiple agents ──
  // Based on A2A Fan-Out / Anthropic orchestrator-worker pattern.
  // Groups tasks by dependency phases, runs each phase concurrently via Promise.allSettled.
  async function executeBatchDelegate(
    tasks: Array<{ taskId: string; role: string; description: string; context?: string; dependsOn?: string[] }>,
    maxParallel: number,
    abortOnFailure: boolean,
    ctx: { sessionID: string; directory?: string; worktree?: string },
  ) {
    // 1. Dependency graph + topological phases (Kahn's algorithm)
    const taskMap = new Map(tasks.map(t => [t.taskId, t]))
    const depGraph = new Map<string, string[]>()
    for (const t of tasks) depGraph.set(t.taskId, t.dependsOn?.filter(d => taskMap.has(d)) ?? [])

    const phases: string[][] = []
    const remaining = new Set(tasks.map(t => t.taskId))
    const completed = new Set<string>()

    while (remaining.size > 0) {
      const ready = [...remaining].filter(id =>
        (depGraph.get(id) ?? []).every(d => completed.has(d)))
      if (ready.length === 0) { phases.push([...remaining]); break } // circular dependency fallback
      phases.push(ready)
      for (const id of ready) { remaining.delete(id); completed.add(id) }
    }

    // 2. Phase-by-phase execution with fan-out cap
    interface BatchTaskResult { taskId: string; role: string; success: boolean; result?: string; error?: string; durationMs: number }
    const allResults: BatchTaskResult[] = []
    let aborted = false

    for (const phase of phases) {
      if (aborted) break
      for (let i = 0; i < phase.length && !aborted; i += maxParallel) {
        const chunk = phase.slice(i, i + maxParallel)
        const promises = chunk.map(async (taskId) => {
          const task = taskMap.get(taskId)!
          const start = Date.now()
          try {
            const role = task.role as AgentRole
            const agent = coordinator.getAgent(role)
            if (!agent) return { taskId, role: task.role, success: false, error: `Unknown role "${role}"`, durationMs: Date.now() - start }

            const sessionModelPref = sessionStore.getModelPreference(ctx.sessionID, role)
            const relevantSkills = skillStore.find(task.description).slice(0, 3).map(s => ({
              name: s.definition.meta.name, successRate: s.successRate,
              steps: s.definition.workflow.steps.map(st => `${st.action}: ${st.description}`).join("; "),
            }))

            coordinator.delegate(role, { id: taskId, assignedTo: role, description: task.description, input: task.context ?? task.description, status: "running" }, ctx.sessionID, 0, relevantSkills)
            eventBus.emit({ type: "task.delegated", payload: { sessionID: ctx.sessionID, taskId, role, description: task.description, delegationDepth: 0 } })

            const agentCtx = {
              systemPrompt: agent.prompt ?? `You are a ${role} in a software engineering team.`,
              sessionId: ctx.sessionID, role,
              taskDescription: task.context ?? task.description,
              modelPreference: sessionModelPref || undefined,
            }
            const resultObj = await agentRuntime.execute(agentCtx)
            const ok = resultObj.success ? resultObj.output : null
            const err = resultObj.success ? null : (resultObj.error ?? "Agent execution failed")

            if (ok) { await coordinator.updateTask(ctx.sessionID, taskId, "done", ok); await coordinator.writeSharedMemory(`task:${taskId}`, ok.slice(0, 500), role) }
            else { await coordinator.updateTask(ctx.sessionID, taskId, "failed", err ?? "Unknown error") }

            return { taskId, role: task.role, success: !!ok, result: ok ?? undefined, error: err ?? undefined, durationMs: Date.now() - start }
          } catch (e) {
            return { taskId, role: task.role, success: false, error: (e as Error).message, durationMs: Date.now() - start }
          }
        })

        const settled = await Promise.allSettled(promises)
        for (const s of settled) {
          if (s.status === "fulfilled") { allResults.push(s.value); if (abortOnFailure && !s.value.success) aborted = true }
          else { allResults.push({ taskId: "unknown", role: "unknown", success: false, error: `Task crashed: ${s.reason}`, durationMs: 0 }) }
        }
      }
    }

    // 3. Build output
    const passed = allResults.filter(r => r.success).length
    let output = `## ⚡ Batch Delegate Complete\n\n`
    output += `**Total:** ${allResults.length} tasks | **Passed:** ${passed} | **Failed:** ${allResults.length - passed}\n`
    output += `**Max Parallel:** ${maxParallel}`
    if (phases.length > 1) output += ` | **Phases:** ${phases.length}`
    output += `\n\n`
    for (const r of allResults) {
      output += `${r.success ? "✅" : "❌"} **${r.taskId}** (${r.role}) — ${(r.durationMs / 1000).toFixed(1)}s\n`
      if (r.result) output += `   Result: ${r.result.slice(0, 200)}\n`
      if (r.error) output += `   Error: ${r.error.slice(0, 200)}\n`
    }

    traceLogger.log({ step: "delegate:batch", input: `${allResults.length} tasks`, output: `${passed}/${allResults.length} passed`, toolUsed: "agentic_delegate", success: passed === allResults.length, durationMs: allResults.reduce((s, r) => s + r.durationMs, 0) / allResults.length })
    return { output }
  }

  // ── Tool context: shared state injected into every extracted tool file ──
  // Cast via double-unknown because TypeScript can't structurally match 50+ properties
  const ctx = {
    sessionStore,
    domainRegistry,
    worktree,
    projectId,
    config,
    log,
    projectContext,
    TOOL_REGISTRY,
    currentInjectDomain,
    planner,
    plannerCritic,
    executor,
    intentParser,
    agentLoop,
    verifier,
    errorAnalyzer,
    errorRecovery,
    alignmentGate,
    economicModel,
    confidenceScorer,
    confidenceStore,
    techDebtScorer: debtScorer,
    constraintManifold,
    navigator,
    toolRouter,
    routerAgent,
    skillStore,
    skillCurator: curator,
    episodicStore,
    memoryOrchestrator,
    secondBrain,
    rag: multiIndexRAG,
    coordinator,
    orchestrator,
    roleRegistry,
    agentRuntime,
    debateLoop,
    dashboard,
    traceLogger,
    liveEvaluator,
    patternDiscovery,
    toolUsageTracker,
    workflowEngine,
    llmEngine,
    modelRegistry,
    hallucinationGuard,
    checkpoints,
    stateStore,
    budgetTracker,
    eventBus,
    parallelExec,
    dependencyTracker: depTracker,
    contextCompressor,
    git,
    selfEvolver,
    continuousEvolution,
    metaReasoner,
    mcpServer,
    mcpClient,
    protocolAdapter,
    dynamicToolRegistry,
    worldModel,
    simulationEngine,
    dataCleaner,
    configLoader,
    logErrorToFile,
    detectSubAgentRole,
    buildSubAgentInjection,
    ctxDir,
  } as unknown as import("./tools/tool-context.js").ToolContext

  // Set ctx reference for deferred runAutoEvolve calls
  _ctxRef = ctx

  return {
    tool: {
      ...buildAllTools(ctx),
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
      // agentRuntime no longer uses chat mode — sub-engines share the
      // real parent session directly via setSessionId(parentSessionId).

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
            // Don't call recordCall here — it's already called in llm.ts:713
            // with real success/failure + real latency. This hook fires BEFORE
            // the LLM call completes, so latency=0 and success=true are wrong.
            // Keep setCurrentModel so getCurrentModel() returns accurate model.
            llmEngine.setCurrentModel(modelStr)
          }
        }
      } catch (e) { log.warn("Silent catch: silent — non-critical", { error: String(e) }) }

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
          // Full prompt for parent agent — all registered tools shown, LLM picks which to use
          const pack = currentInjectDomain ?? domainRegistry.getCurrentPack() ?? genericDomain

          // ── KNOWLEDGE-FIRST: Auto-inject RAG results ──
          let knowledgeEntries: KnowledgeEntry[] = []
          let queryForRag = ""

          // ── RAG cache: avoid redundant TF-IDF queries for similar inputs ──
          // Simple TTL cache (60s) with exact-match + prefix-match for dedup.
          const _ragCache = new Map<string, { entries: KnowledgeEntry[]; hasHigh: boolean; expiry: number }>()
          const RAG_CACHE_TTL = 60_000

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

            // Check RAG cache first
            const now = Date.now()
            const cacheKey = queryForRag.slice(0, 200) // limit key length
            // Also try prefix match: if current query starts with a cached query, reuse
            let cachedHit: { entries: KnowledgeEntry[]; hasHigh: boolean } | null = null
            for (const [key, val] of _ragCache) {
              if (val.expiry > now && (cacheKey === key || cacheKey.startsWith(key) || key.startsWith(cacheKey))) {
                cachedHit = { entries: val.entries, hasHigh: val.hasHigh }
                break
              }
            }

            if (cachedHit) {
              knowledgeEntries = cachedHit.entries
              hasHighConfidenceKnowledge = cachedHit.hasHigh
            } else {
              const { keywords, category } = routerAgent.extractKeywords(queryForRag)
              if (keywords.length > 0) {
                const memResult = await memoryOrchestrator.queryWithKnowledge(keywords.join(" "), category, 5)
                if (memResult.knowledge && memResult.knowledge.length > 0) {
                  knowledgeEntries = memResult.knowledge
                  hasHighConfidenceKnowledge = memResult.hasHighConfidence ?? false
                }
              }
              // Populate cache (even if empty — prevents repeated empty queries)
              _ragCache.set(cacheKey, { entries: knowledgeEntries, hasHigh: hasHighConfidenceKnowledge, expiry: now + RAG_CACHE_TTL })
              // Evict stale entries if cache grows too large
              if (_ragCache.size > 50) {
                for (const [k, v] of _ragCache) {
                  if (v.expiry < now) _ragCache.delete(k)
                }
              }
            }
          } catch (e) {
            log.error("[Agentic] RAG search failed: " + (e instanceof Error ? e.message : String(e)))
          }

          // ── Second Brain injection: decisions + TODOs + reflection ──
          try {
            const sb = getSecondBrain()
            if (sb) {
              const decisions = sb.getRecentDecisions(3)
              const todos = sb.getPendingTodos(5)
              const refl = sb.getLatestReflection()
              if (decisions.length > 0) {
                hasHighConfidenceKnowledge = true
                knowledgeEntries.push(...decisions.map(d => ({
                  source: `decision:${d.title}`,
                  confidence: 0.7,
                  content: `${d.title}: ${d.context}${d.consequence ? ` → ${d.consequence}` : ""}`,
                  category: "decision",
                })))
              }
              if (todos.length > 0) {
                knowledgeEntries.push({
                  source: "todos",
                  confidence: 0.6,
                  content: `Pending tasks: ${todos.map(t => `[${t.priority}] ${t.text}`).join("; ")}`,
                  category: "todo",
                })
              }
              if (refl && refl.actionItems.length > 0) {
                knowledgeEntries.push({
                  source: "reflection",
                  confidence: 0.6,
                  content: `Reflection action items: ${refl.actionItems.join("; ")}`,
                  category: "reflection",
                })
              }
            }
          } catch (e) { log.warn("Silent catch: non-fatal", { error: String(e) }) }

          // ── Tool recommendation: keep ALL tools visible, add ranked hints only ──
          const lifecyclePhase = (() => {
            try {
              const lc = queryForRag ? detectLifecyclePhase(queryForRag) : null
              return lc && lc.phase !== "unknown" ? lc.phase : undefined
            } catch { return undefined }
          })()
          const recommendedTools = toolRouter.selectTools({
            taskInput: queryForRag,
            recentTools: recentToolCalls,
            domain: pack.name,
            isSubAgent: false,
            lifecyclePhase,
          }, 5).selected

          injection = buildAgenticSystemInstructions(pack, TOOL_REGISTRY, {
            isRouted: false,  // no subset — LLM decides which tool fits
            selectedTools: recommendedTools,
            knowledgeEntries: knowledgeEntries.length > 0 ? knowledgeEntries : undefined,
            projectContext,
            curator,
            goal: queryForRag,  // use the same query string for skill relevance
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
          } catch (e) { log.warn("Silent catch: non-fatal", { error: String(e) }) }

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
        log.error("[Agentic] system.transform ERROR — injecting fallback: " + (e instanceof Error ? e.message : String(e)))
        const fallbackTools = TOOL_REGISTRY.map(t => `- **${t.name}**: ${t.description.slice(0, 100)}`).join("\n")
        const fallback = `\n\n## Agentic Tools\n\nYou have access to these tools. Use them with their \`agentic_\` prefix.\n\n### Tool List (${TOOL_REGISTRY.length})\n${fallbackTools}\n\nAvailable built-in tools: \`edit\`, \`write\`, \`webfetch\`, \`question\`. Do NOT use \`read\`, \`bash\`, \`grep\`, \`glob\`, \`todowrite\`, \`task\`.`
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
      } catch (e) { log.warn("Silent catch: non-critical", { error: String(e) }) }
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
            // NOT calling recordCall here — llm.ts:713 handles it with real stats.
            // This hook fires during params, not after completion.
          }
        }
      } catch (e) { log.warn("Silent catch: silent — non-critical", { error: String(e) }) }
    },

    "tool.execute.after": async (toolInput: { tool: string; args: Record<string, unknown>; sessionID: string; callID: string }, _output: { title: string; output: string; metadata: unknown }) => {
      // Record tool call for ToolRouter adaptive routing (keep last 20)
      const toolName = toolInput.tool
      toolRouter.recordCall(toolName, true, 0)
      recentToolCalls.push(toolName)
      if (recentToolCalls.length > 20) recentToolCalls.shift()

      // Detect tool failure from output
      const outputText = _output?.output || ""
      const isError = /^(Error|❌|Failed|Error:|Cannot|Not found|Unknown)/.test(outputText.trim())
        || (outputText.length > 0 && outputText.trim().startsWith("```") && outputText.includes("error"))
        || (outputText.length === 0)

      if (isError) {
        log.error(`[Agentic] Tool "${toolName}" returned error:\n${outputText.slice(0, 500)}`)
        logErrorToFile(toolName, `tool output error: ${outputText.slice(0, 300)}`)
      }

      traceLogger.log({
        step: "tool",
        input: JSON.stringify(toolInput.args ?? {}),
        output: isError ? `error: ${outputText.slice(0, 200)}` : "completed",
        toolUsed: toolName,
        success: !isError,
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
      } catch (e) { log.warn("Silent catch: non-fatal", { error: String(e) }) }
    },

    dispose: async () => {
      try { configLoader.stopWatch() } catch (e) { log.warn("Silent catch: non-fatal", { error: String(e) }) }
      try { stateStore.set("models", "registry", modelRegistry.toJSON()) } catch (e) { log.warn("Silent catch: non-fatal", { error: String(e) }) }
      try { stateStore.set("prompts", "state", roleRegistry.getAllPromptStates()) } catch (e) { log.warn("Silent catch: non-fatal", { error: String(e) }) }
      try { stateStore.set("evolution", "trend", continuousEvolution.toJSON(), projectId) } catch (e) { log.warn("Silent catch: non-fatal", { error: String(e) }) }
      try { stateStore.set("evaluation", "live", liveEvaluator.toJSON(), projectId) } catch (e) { log.warn("Silent catch: non-fatal", { error: String(e) }) }
      try { stateStore.flushSync() } catch (e) { log.warn("Silent catch: non-fatal", { error: String(e) }) } // ponytail: flush write-behind queue before shutdown
      try { await traceLogger.dispose() } catch (e) { log.warn("Silent catch: non-fatal", { error: String(e) }) }
      try { eventBus.clear() } catch (e) { log.warn("Silent catch: non-fatal", { error: String(e) }) } // ponytail: prevent subscriber leak across plugin reloads
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

export { HallucinationGuard, type HallucinationCheck, type ClaimResult } from "./drift/hallucination-guard.js"
export { ErrorAnalyzer } from "./core/error-analyzer.js"
export { RoleRegistry } from "./agents/role-registry.js"
export { VectorStore } from "./memory/vector-store.js"
export { TechDebtScorer } from "./core/tech-debt-scorer.js"
export { Verifier } from "./core/verifier.js"
export { DebateLoop, formatDebateResult, type DebateConfig, type DebateResult, type DebateRound } from "./core/debate-loop.js"
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
export { EpisodicStore, Significance } from "./memory/episodic-store.js"
export { SkillStore, createSkillDefinition, inspectSkill, serializeSkill, deserializeSkill } from "./memory/skill-store.js"
export { formatAntiRationalizations, type AntiRationalization } from "./memory/skill-format.js"
export { type SkillRecord } from "./memory/skill-store.js"
export { STOP_WORDS, isStopWord, filterStopWords, getStopWordStats } from "./memory/stopwords.js"
export { PromptTemplate, type KnowledgeEntry } from "./core/prompt-template.js"
export { ToolRouter } from "./core/tool-router.js"
export { SemanticCache } from "./core/semantic-cache.js"
export { LRUCache, type LRUCacheOptions } from "./core/lru-cache.js"
export { DslExecutor, validateDSL, resolvePath, setPath, resolveValue, type DslInstruction, type DslOp, type CompareOp, type DslContext, type DslResult, type DslFullResult, type DslStepResult, type DslTrace, type DslValidationError, type SkillDef } from "./core/dsl-executor.js"
export { SchemaValidator, type SchemaField, type SchemaFieldType, type SkillSchema, type SchemaValidationResult, type SchemaValidationError, type SchemaErrorCode } from "./core/skill-schema.js"
export { CodeSandbox, CodeModuleRegistry, checkBannedTokens, sandboxExecute, runSandboxTests, type BannedToken, type BannedTokenIssue, type CodeModule, type SandboxExecutionResult, type SandboxTestCase, type SandboxTestResult, type CodeGenerationResult, type SandboxSchemaField } from "./core/code-sandbox.js"
export { CodebaseNavigator, type ModuleInfo, type ProjectIndex, type LanguageConfig } from "./core/navigator.js"
export { TreeSearchPlanner, defaultExpansion, scoreState, diversityBonus, scoreWithDiversity, DEFAULT_BEAM_WIDTH, DEFAULT_MAX_DEPTH, EARLY_STOP_THRESHOLD, DIVERSITY_WEIGHT, type PlanState, type TreeSearchResult, type TreeSearchConfig, type ExpansionFn } from "./core/planner-tree-search.js"
export { Planner, type MacroPhase, type MicroStep, type HierarchicalPlan, type PhaseContextMapping, type PhaseErrorContext } from "./core/planner.js"
export { PlannerCritic, parsePlannerCandidatePlans, parsePlannerCriticScore, parsePlannerRefinedCandidate } from "./core/planner-critic.js"
export { SkillImprover, type SkillTestCase, type EvaluationScore, type ImprovementResult } from "./core/skill-improver.js"
export { AttentionScheduler, type AgentScheduleConfig, type AgentScheduleState, type SharedState, type CycleResult, type SchedulerMetrics } from "./core/attention-scheduler.js"
export { WorldModel, type WorldSnapshot, type Belief, type Entity, type Relation, type WorldModelConfig, type BeliefEvidence, type BeliefUpdateResult } from "./core/world-model.js"
export { SimulationEngine, type SimulationInput, type SimulationResult, type SimulatedStep, type SimulatedStepResult, type SimulationConfig } from "./core/simulation-engine.js"
export { MetaReasoner, createDefaultStrategy, type StrategyConfig, type StrategyParam, type PerformanceRecord, type StrategyVersion, type AdaptationResult, type MetaReasonerConfig } from "./core/meta-reasoner.js"
export { ToolUsageTracker, type ToolUsageRecord, type ToolUsageStats } from "./core/tool-usage-tracker.js"
export { DAGEngine, type DAGNode, type DAGPlan, type DAGNodeType, type NodeStatus, type DAGExecutionContext, type DAGResult, type ExecutionPhase, type RetryStrategy, type RecoveryStrategy, type NodeRunner, type DAGObserver } from "./core/dag-engine.js"
export { PlanningLayer, type PlanVersion, type PlanValidationResult, type PlanningLayerConfig } from "./core/planning-layer.js"
export { ExecutionLayer, type ExecutionLayerConfig, type NodeExecutionResult, type PhaseExecutionResult, type ExecutionSnapshot } from "./core/execution-layer.js"
export { RecoveryLayer, type RecoveryLevel, type RecoveryStatus, type RecoveryRecord, type RecoveryDecision, type RecoveryLayerConfig, type ReplanResult } from "./core/recovery-layer.js"
export { buildAgentPrompt, buildAgenticSystemInstructions, buildGenericAgentPrompt } from "./core/prompt-builder.js"
export { ToolGuardrailController, DEFAULT_GUARDRAIL_CONFIG, type ToolGuardrailConfig, type GuardrailDecision } from "./core/tool-guardrails.js"
export { SkillCurator, DEFAULT_CURATOR_CONFIG, type CuratorConfig, type InjectedSkill, type LifecycleReport, type CuratorLifecycleState } from "./curation/skill-curator.js"
export { NoOpMemoryProvider, type MemoryProvider, type PrefetchOptions, type MemoryProviderStoreData, type MemoryProviderQueryResult } from "./memory/memory-provider.js"
export { detectProjectContext, type ProjectContext, type DetectedLanguage, type DetectedFramework } from "./core/project-context.js"
export { SessionStore } from "./memory/session-store.js"
export { MemoryOrchestrator, type MemoryLevel, type MemoryEntry, type MemoryQuery, type MemoryQueryResult, type ConsolidationReport } from "./memory/memory-orchestrator.js"
export { ConsolidationScheduler, type ConsolidationSchedule, type ConsolidationTrigger, type SchedulerStats, type ConsolidationCallback } from "./memory/consolidation-scheduler.js"
export { ConstraintManifold, type ConstraintViolation, type ConstraintCheck, type SafetyPolicy, type ActionProposal, type ConstraintCategory, type ConstraintSeverity, type ConstraintConfig } from "./core/constraint-manifold.js"
export { type SkillLifecycleStage, type MaturationCriteria } from "./memory/skill-store.js"
export { LLMEngine } from "./core/llm.js"
export { GitIntegration } from "./core/git.js"
export { type LLMConfig, type LLMRequest, type LLMResponse, TOOL_COMPLEXITY, type CostAutoSwitchConfig, type CostSwitchEvent } from "./core/llm-types.js"
export { ParallelExecutor, parseLLMStepImplementation, type ParallelExecutionResult, type ParallelPlan, type StepRunner } from "./core/parallel.js"
export { Orchestrator, parseSemanticValidationPayload, type SemanticValidationPayload } from "./agents/orchestrator.js"
export { RouterAgent, createCategory, parseRouterClassificationPayload, detectLifecyclePhase, type RouterClassificationPayload, type RouteCategory, type LifecyclePhase, type LifecycleMatch } from "./core/router-agent.js"
export { DataCleaner, parseDataValidationPayload, type DataValidationPayload } from "./core/data-cleaner.js"
export { MCPClient, type MCPConfig, type MCPConnection, type MCPCallResult } from "./core/mcp-client.js"
export { ModelRegistry, type ModelStats, type ModelScore } from "./core/model-registry.js"
export { ProtocolAdapter, type Protocol, type ToolDescriptor, type ProtocolCallResult, type ProtocolAdapterStats } from "./core/protocol-adapter.js"
export { DynamicToolRegistry, type DynamicToolRegistration, type ToolCallResult } from "./core/dynamic-tool-registry.js"
export { EventBus } from "./core/event-bus.js"
export { WorkflowEngine, type WorkflowConfig, type ChainedResult } from "./core/workflow-engine.js"
export { StateStore, type StoreEntry, type StateNamespace } from "./core/state-store.js"
export { MCPServer, type MCPServerConfig, type MCPServerStatus } from "./core/mcp-server.js"
export { ConfidenceScorer, ConfidenceStore, type ConfidenceScore, type ConfidenceDimensions, type ScoringSignals, type StepConfidenceRecord } from "./core/confidence-scorer.js"
export { SecondBrain, initSecondBrain, parseReflectionPayload, type ReflectionPayload, type Decision, type Todo, type Reflection, type GraphEdge, type KnowledgeSnapshot } from "./memory/second-brain.js"
export { ErrorRecovery } from "./core/error-recovery.js"
export { AlignmentGate } from "./core/alignment-gate.js"
export { EconomicModel } from "./core/economic-model.js"
export { writeFiles, parseFileEntries, recordCompletion, type FileWriteEntry, type CompletionRecord, type CompletionDeps, type CompletionResult } from "./core/execution-helpers.js"
export { AgentLoop, type AgentLoopConfig, type LoopResult, type LoopObserver } from "./core/agent-loop.js"
export { evaluateWorkflowPolicy, formatWorkflowPolicyDecisions, verificationEvidenceFailed, type WorkflowPolicyInput, type WorkflowPolicyDecision, type WorkflowPolicyOptions, type WorkflowAction, type WorkflowSeverity } from "./core/workflow-policy.js"
export { ResearchAgent5W1H, type ResearchReport, type ResearchFinding, type ResearchDimension, type ResearchContext, ALL_DIMENSIONS, DIMENSION_QUESTIONS } from "./core/5w1h-framework.js"
export { TechKnowledgeRegistry, getTechKnowledgeRegistry, resetTechKnowledgeRegistry, type TechCategory, type TechKeywordEntry, type BestPracticeEntry, type TechKnowledgeData } from "./core/tech-knowledge-registry.js"
export { MultiIndexRAG, enrichWithVectors, createDefaultQuality, computeQualityScore, type IndexData, type IndexSearchResult, type IndexEntry, type QualityDimensions, type UsageStats, type FeedbackEntry, type RAGConfig, type RAGStats, type SearchWithConfidenceResult } from "./memory/multi-index-rag.js"
export { RAGQualityScorer, QUALITY_WEIGHTS, QUALITY_THRESHOLDS } from "./memory/rag-quality-scorer.js"
export { RAGFeedbackLoop, type StepFeedback, type FeedbackReport } from "./memory/rag-feedback-loop.js"
export { RAGAdaptiveRetrieval, type AdaptiveSearchResult, type RetrievalMode } from "./memory/rag-adaptive-retrieval.js"
export { MDPRetrievalAgent, type MDPState, type MDPActionChoice, type MDPLogEntry, type MDPResult, type MDPAction } from "./memory/rag-mdp-retrieval.js"
export { KnowledgeBoundaryCalibrator, type KnowledgeState, type KnowledgeQuadrant, type CalibratedEntry } from "./memory/rag-knowledge-boundary.js"
export { RAGContextOptimizer, type OptimizedContext, type ContextEntryScore } from "./memory/rag-context-optimizer.js"
export { LocalEmbedder, type EmbedderConfig, type EmbeddingResult } from "./memory/local-embedder.js"
export { SkillExtractor, normalize } from "./memory/skill-extractor.js"
export { parseSkillMd, convertSkillMdToDefinition, importSkillMdToStore, type ParsedSkillMd, type SkillMdFrontmatter } from "./memory/skill-md-importer.js"
export { scanSkillContent, formatSecurityReport, detectProvenance, BehavioralMonitor, DualReviewer, computeNextTrustLevel, type TrustLevel, type ProvenanceInfo, type ScanResult, type ScanWarning, type BehavioralProfile, type ReviewRequest, type ReviewDecision } from "./memory/skill-security.js"
export { TraceLogger } from "./observability/trace-logger.js"
export { ContextCompressor } from "./drift/context-compressor.js"
export { SQLitePersistence } from "./memory/sqlite-persistence.js"

export { debounce, throttle, type DebounceOptions, type ThrottleOptions } from "./core/rate-limit.js"
export { gatherEvolutionData, runAutoEvolve as runAutoEvolveInternal } from "./evolution/auto-evolve.js"
import { buildAllTools } from "./tools/definitions.js"
import { runAutoEvolve as _runAutoEvolve, gatherEvolutionData } from "./evolution/auto-evolve.js"

/** Simple smoke-test function — verifies the plugin builds and exports correctly */
export function hello(name?: string): string {
  return `Hello, ${name ?? "World"}!`
}

// Deferred reference to ctx (set after ctx is initialized)
let _ctxRef: import("./tools/tool-context.js").ToolContext | null = null
function runAutoEvolve() {
  if (_ctxRef) return _runAutoEvolve(_ctxRef)
  return Promise.resolve("No context yet")
}
