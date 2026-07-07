import { tool } from "@opencode-ai/plugin"
import type { ToolSpec } from "./types.js"
import type { ToolContext } from "./tool-context.js"
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, readdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join, dirname, resolve } from "node:path"
import { createHash } from "node:crypto"
import { parseFileEntries, writeFiles as writeFilesHelper } from "../core/execution-helpers.js"
import { getSecondBrain } from "../memory/second-brain.js"
import { evaluateWorkflowPolicy, formatWorkflowPolicyDecisions, verificationEvidenceFailed } from "../core/workflow-policy.js"
import { getSkillStore, getEpisodicStore, getConfigLoader, getA2AClient, setA2AClient, getA2AServer, setA2AServer, setSchemaValidator, setConsolidationScheduler, setDslExecutor, setSchemaVersion, setBlueprintParser, setBlueprintResolver } from "../core/shared-instances.js"
import { makeStatusTool } from "./status.js"
import { makeCleanTool } from "./clean.js"
import { makeSnapshotTool } from "./snapshot.js"
import { makeBudgetTool } from "./budget.js"
import { makeExecuteTool } from "./execute.js"
import { makeAutoTool } from "./auto.js"
import { makeEvolveTool } from "./evolve.js"
import { makeRagTool } from "./rag.js"
import { makeDelegateTool } from "./delegate.js"
import { makeModelTool } from "./model.js"
import { makeFinetuneTool } from "./finetune.js"
import { makePlanTool } from "./plan.js"
import { makeNavTool } from "./nav.js"
import { makeReflectTool } from "./reflect.js"
import { makeVerifyTool } from "./verify.js"
import { makeContextTool } from "./context.js"
import { makePipelineTool } from "./pipeline.js"
import { makePrTool } from "./pullRequest.js"
import { makeScoreTool } from "./score.js"
import { makeMessageTool } from "./message.js"
import { makeSkillTool } from "./skill.js"
import { makeEpisodesTool } from "./episodes.js"
import { makeParallelTool } from "./parallel.js"
import { makeGuardTool } from "./guard.js"
import { makeDebateTool } from "./debate.js"
import { makeRouterTool } from "./router.js"
import { makeMcpTool } from "./mcp.js"
import { makeA2aTool } from "./a2a.js"
import { makeToolsTool } from "./tools.js"
import { makeDbTool } from "./db.js"
import { makeMemoTool } from "./memo.js"
import { makeFetchTool } from "./fetch.js"
import { TOOL_COMPLEXITY } from "../core/llm-types.js"
import { detectTaskType } from "../core/task-classifier.js"
import { skillsToTrainingData, trainingDatasetSummary, skillToTrainingExample } from "../memory/skill-training.js"
import { createSkillDefinition, inspectSkill, serializeSkill } from "../memory/skill-format.js"
import { codeIntentAnalyzer } from "../core/code-intent-analyzer.js"
import { buildAgenticSystemInstructions } from "../core/prompt-builder.js"
import { detectProjectContext } from "../core/project-context.js"
import { MemorySchemaVersion, createMemoryEnvelope } from "../memory/schema-version.js"
import { BlueprintParser, BlueprintResolver } from "../core/agent-blueprint.js"
import { HallucinationGuard } from "../drift/hallucination-guard.js"
import { TechDebtScorer } from "../core/tech-debt-scorer.js"
import { AutoRetryManager } from "../core/auto-retry.js"
import { runAutoEvolve, gatherEvolutionData } from "../evolution/auto-evolve.js"
import { SchemaValidator } from "../core/skill-schema.js"
import { ConsolidationScheduler } from "../memory/consolidation-scheduler.js"
import { DslExecutor } from "../core/dsl-executor.js"
import type { TaskIntent, Subtask } from "../core/intent-parser.js"

import type { Episode } from "../memory/episodic-store.js"
import type { PromptEntry } from "../agents/role-registry.js"
import type { SimulatedStep } from "../core/simulation-engine.js"
import type { HallucinationCheck, ClaimResult } from "../drift/hallucination-guard.js"
import type { WorkflowPipeline } from "../agents/orchestrator.js"
import { parseLLMStepImplementation } from "../core/parallel.js"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildAllTools(ctx: ToolContext): Record<string, any> {
  const {
    sessionStore, domainRegistry, worktree, projectId, config,
    log, projectContext, TOOL_REGISTRY, currentInjectDomain,
    planner, plannerCritic, executor, intentParser, agentLoop,
    verifier, errorAnalyzer, errorRecovery, alignmentGate,
    economicModel, confidenceScorer, confidenceStore, techDebtScorer,
    constraintManifold, navigator, toolRouter, routerAgent,
    skillStore, skillCurator, episodicStore, memoryOrchestrator,
    secondBrain, rag: multiIndexRAG, coordinator, orchestrator,
    roleRegistry, agentRuntime, debateLoop, dashboard, traceLogger,
    liveEvaluator, patternDiscovery, toolUsageTracker, workflowEngine,
    llmEngine, modelRegistry, hallucinationGuard, checkpoints,
    stateStore, budgetTracker, eventBus, parallelExec,
    dependencyTracker: depTracker, contextCompressor, git,
    selfEvolver, continuousEvolution, metaReasoner,
    mcpServer, mcpClient, protocolAdapter, dynamicToolRegistry,
    worldModel, simulationEngine, dataCleaner, configLoader,
    logErrorToFile, detectSubAgentRole, buildSubAgentInjection, ctxDir,
  } = ctx

  const schemaValidator = new (SchemaValidator as any)()
  const consolidationScheduler = new (ConsolidationScheduler as any)()
  setSchemaValidator(schemaValidator)
  setConsolidationScheduler(consolidationScheduler)
  // Registry tool wrapper: registers with dynamicToolRegistry (for MCP) + wraps execute with error handling
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const registryTool = (name: string, def: any, registryMeta?: { version?: string; category?: string; keywords?: string[] }) => {
    const wrappedExecute = async (args: Record<string, unknown>, context: Record<string, unknown>) => {
      if (!context?.sessionID) {
        return { output: '❌ **' + name + '** requires an active session.', metadata: { error: "no-session", tool: name } }
      }
      try {
        llmEngine.setSessionId(context.sessionID as string)
        llmEngine.setToolContext(name)
        return await (def.execute as (...args: unknown[]) => unknown)(args, context)
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err)
        const errStack = err instanceof Error ? err.stack : ""
        log.error('[Agentic] ❌ Tool "' + name + '" execution failed: ' + errMsg)
        logErrorToFile(name, errMsg, errStack)
        return { output: '❌ **' + name + '** execution failed: ' + errMsg, metadata: { error: errMsg, tool: name } }
      }
    }
    try {
      const zodObj = tool.schema.object(def.args as Record<string, unknown>)
      const jsonSchema = tool.schema.toJSONSchema(zodObj, { target: "draft-7", unrepresentable: "any" })
      dynamicToolRegistry.registerFromTool(name, def.description, jsonSchema as Record<string, unknown>, wrappedExecute as (...args: unknown[]) => Promise<unknown>, registryMeta)
    } catch (e) {
      log.error('[Agentic] ❌ Tool registration FAILED for "' + name + '": ' + (e instanceof Error ? e.message : String(e)))
    }
    return tool({ description: def.description, args: def.args, execute: wrappedExecute as (args: Record<string, unknown>, context: Record<string, unknown>) => Promise<{ output: string }> })
  }
  
  // Mutable local copies (destructured values from ctx are const)
  let mutableCurrentInjectDomain = currentInjectDomain
  const setCurrentInjectDomain = (val: typeof currentInjectDomain) => { mutableCurrentInjectDomain = val }

  // Aliases matching original index.ts variable names
  const debtScorer = techDebtScorer
  const curator = skillCurator
  const dslExecutor = new DslExecutor()
  const schemaVersion = new MemorySchemaVersion()
  const blueprintParser = new BlueprintParser()
  const blueprintResolver = new (BlueprintResolver as any)(modelRegistry, [])
  setDslExecutor(dslExecutor)
  setSchemaVersion(schemaVersion)
  setBlueprintParser(blueprintParser)
  setBlueprintResolver(blueprintResolver)
  const sqliteDB: any = null

  // Helper functions for agentic_fetch (originally defined in index.ts)
  function detectContentType(content: string, contentTypeHeader: string, url: string): "html" | "code" | "json" | "text" {
    if (contentTypeHeader.startsWith("text/html") || contentTypeHeader.startsWith("application/xhtml")) return "html"
    if (contentTypeHeader.startsWith("application/json") || url.match(/\.json$/i)) return "json"
    if (content.match(/^\s*</)) return "html"
    if (url.match(/\.(ts|js|tsx|jsx|mjs|cjs|mts|cts|py|rs|go|java|c|cpp|h|hpp|rb|php|swift|kt|scala|ex|exs|hs|lua|r|sh|bash|zsh|fish|sql|graphql|css|scss|less|sass|vue|svelte|astro)$/i)) return "code"
    return "text"
  }
  function htmlToText(html: string): string {
    const codeBlocks: string[] = []
    const saved = html.replace(/<(pre|code)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi, (_: unknown, _tag: string, inner: string) => {
      codeBlocks.push(inner.replace(/<[^>]+>/g, "").trim())
      return `\n---CODEBLOCK${codeBlocks.length - 1}---\n`
    })
    return saved.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[\s\S]*?<\/nav>/gi, "").replace(/<header[\s\S]*?<\/header>/gi, "")
      .replace(/<footer[\s\S]*?<\/footer>/gi, "").replace(/<[^>]+>/g, " ")
      .replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim()
      .replace(/---CODEBLOCK(\d+)---/g, (_: unknown, idx: string) => `\n\`\`\`\n${codeBlocks[parseInt(idx)] || ""}\n\`\`\`\n`)
  }
  function extractSummary(content: string, type: "html" | "code" | "json" | "text"): string {
    if (type === "code") {
      const lines = content.split("\n").filter(l => l.trim() && !l.trim().startsWith("//") && !l.trim().startsWith("/*") && !l.trim().startsWith("*"))
      return lines.slice(0, Math.min(15, lines.length)).join("\n").slice(0, 800) + `\n\n(... ${content.split("\n").length} total lines, ${content.length} chars)`
    }
    if (type === "json") {
      return content.replace(/\s+/g, " ").trim().slice(0, 500) + `\n\nTop keys: ${(content.match(/"([^"]+)":/g)?.slice(0, 10).map((k: string) => k.replace(/[":]/g, "")) || []).join(", ")}`
    }
    return content.replace(/\s+/g, " ").trim().slice(0, 1000)
  }
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
    } else if (ctype === "html") { tags.push("html") }
    else if (ctype === "json") { tags.push("json") }
    if (tags.length < 2) tags.push("web-research")
    return [...new Set(tags)]
  }

  /** Batch delegate for parallel agent execution (copied from original index.ts) */

  return {
      agentic_plan: registryTool("agentic_plan", makePlanTool(ctx)),
      agentic_nav: registryTool("agentic_nav", makeNavTool(ctx)),
      agentic_execute: registryTool("agentic_execute", makeExecuteTool(ctx)),
      agentic_reflect: registryTool("agentic_reflect", makeReflectTool(ctx)),
      agentic_verify: registryTool("agentic_verify", makeVerifyTool(ctx)),
      agentic_status: registryTool("agentic_status", makeStatusTool(ctx)),
      agentic_context: registryTool("agentic_context", makeContextTool(ctx)),
      agentic_snapshot: registryTool("agentic_snapshot", makeSnapshotTool(ctx)),
      agentic_pipeline: registryTool("agentic_pipeline", makePipelineTool(ctx)),
      agentic_pr: registryTool("agentic_pr", makePrTool(ctx)),
      agentic_score: registryTool("agentic_score", makeScoreTool(ctx)),
      agentic_delegate: registryTool("agentic_delegate", makeDelegateTool(ctx)),
      agentic_message: registryTool("agentic_message", makeMessageTool(ctx)),
      agentic_skill: registryTool("agentic_skill", makeSkillTool(ctx)),
      agentic_model: registryTool("agentic_model", makeModelTool(ctx)),
      agentic_budget: registryTool("agentic_budget", makeBudgetTool(ctx)),
      agentic_episodes: registryTool("agentic_episodes", makeEpisodesTool(ctx)),
      agentic_parallel: registryTool("agentic_parallel", makeParallelTool(ctx)),
      agentic_guard: registryTool("agentic_guard", makeGuardTool(ctx)),
      agentic_evolve: registryTool("agentic_evolve", makeEvolveTool(ctx)),
      agentic_debate: registryTool("agentic_debate", makeDebateTool(ctx)),
      agentic_router: registryTool("agentic_router", makeRouterTool(ctx)),
      agentic_clean: registryTool("agentic_clean", makeCleanTool(ctx)),
      agentic_rag: registryTool("agentic_rag", makeRagTool(ctx)),
      agentic_mcp: registryTool("agentic_mcp", makeMcpTool(ctx)),
      agentic_a2a: registryTool("agentic_a2a", makeA2aTool(ctx)),
      agentic_tools: registryTool("agentic_tools", makeToolsTool(ctx)),
      agentic_finetune: registryTool("agentic_finetune", makeFinetuneTool(ctx)),
      agentic_db: registryTool("agentic_db", makeDbTool(ctx)),
      agentic_auto: registryTool("agentic_auto", makeAutoTool(ctx)),
      agentic_memo: registryTool("agentic_memo", makeMemoTool(ctx)),
      agentic_fetch: registryTool("agentic_fetch", makeFetchTool(ctx)),
  }
}

export default buildAllTools
