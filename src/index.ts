import type { Plugin, PluginModule } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join, dirname } from "node:path"
import { IntentParser, type TaskIntent, type Subtask } from "./core/intent-parser.js"
import { Executor } from "./core/executor.js"
import { Verifier } from "./core/verifier.js"
import { ErrorAnalyzer } from "./core/error-analyzer.js"
import { Planner } from "./core/planner.js"
import { CodebaseNavigator } from "./core/navigator.js"
import { DependencyTracker } from "./drift/dependency-tracker.js"
import { ContextCompressor } from "./drift/context-compressor.js"
import { GitIntegration } from "./core/git.js"
import { TechDebtScorer } from "./core/tech-debt-scorer.js"
import { AgentCoordinator } from "./agents/coordinator.js"
import { AgentRuntime } from "./agents/agent-runtime.js"
import type { AgentRole, AgentTask } from "./agents/coordinator.js"
import { Orchestrator, type WorkflowPipeline, type CrossValidationResult } from "./agents/orchestrator.js"
import { SkillStore } from "./memory/skill-store.js"
import { EpisodicStore } from "./memory/episodic-store.js"
import { HallucinationGuard } from "./drift/hallucination-guard.js"
import { ParallelExecutor } from "./core/parallel.js"
import { Dashboard } from "./observability/dashboard.js"
import { CheckpointSystem } from "./drift/checkpoints.js"
import { SessionStore } from "./memory/session-store.js"
import { TraceLogger } from "./observability/trace-logger.js"
import { RoleRegistry } from "./agents/role-registry.js"
import { MemorySchemaVersion, createMemoryEnvelope, parseMemoryEnvelope } from "./memory/schema-version.js"
import { createSkillDefinition, inspectSkill, serializeSkill, deserializeSkill } from "./memory/skill-format.js"
import { SelfEvolver } from "./evolution/self-evolver.js"
import { ContinuousEvolution } from "./evolution/continuous-evolution.js"
import { LLMEngine } from "./core/llm.js"
import { AgentLoop } from "./core/agent-loop.js"
import { PersistenceLayer } from "./memory/persistence.js"
import { VectorStore } from "./memory/vector-store.js"
import { ModelRegistry } from "./core/model-registry.js"
import { ConfigLoader } from "./core/config.js"

const createEngine: Plugin = async (input, _options) => {
  // ── Config (load first, everything else depends on it) ──
  const configLoader = new ConfigLoader(input.worktree)
  const config = configLoader.load()
  configLoader.startWatch()

  // ── Auto-register "agentic" agent if not present ──
  const agentsDir = join(input.worktree, ".opencode", "agents")
  const agenticAgentPath = join(agentsDir, "agentic.md")
  if (!existsSync(agenticAgentPath)) {
    try {
      mkdirSync(agentsDir, { recursive: true })
      writeFileSync(agenticAgentPath, `---
description: Multi-agent software engineering assistant (20 tools: plan, execute, reflect, verify, nav, delegate, etc.)
mode: all
---

You are an AI assistant with access to 20 agentic engineering tools (agentic_plan, agentic_execute, agentic_reflect, agentic_verify, agentic_nav, agentic_delegate, etc.). Use these tools to help the user plan, implement, verify, and manage software engineering tasks.
`, "utf-8")
    } catch { /* non-fatal: agent file is optional */ }
  }

  const intentParser = new IntentParser()
  const executor = new Executor()
  const verifier = new Verifier()
  const errorAnalyzer = new ErrorAnalyzer()
  const planner = new Planner()
  const navigator = new CodebaseNavigator()
  const depTracker = new DependencyTracker()
  // Build initial file-level dependency graph from project source
  try {
    const sourceDir = join(input.worktree, "src")
    if (existsSync(sourceDir)) {
      const scanBatch: Record<string, string> = {}
      const walkDir = (dir: string) => {
        try {
          for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name)
            if (entry.isDirectory() && !["node_modules", ".git", "dist", ".agentic"].includes(entry.name))
              walkDir(full)
            else if (entry.isFile() && /\.(ts|tsx|js|jsx|mjs)$/.test(entry.name) && Object.keys(scanBatch).length < 100)
              try { scanBatch[full] = readFileSync(full, "utf-8") } catch {}
          }
        } catch {}
      }
      walkDir(sourceDir)
      depTracker.scanFiles(scanBatch, input.worktree)
    }
  } catch { /* non-fatal */ }
  const contextCompressor = new ContextCompressor()
  const git = new GitIntegration(input.worktree)
  const debtScorer = new TechDebtScorer()
  const coordinator = new AgentCoordinator()
  const orchestrator = new Orchestrator()
  for (const pipeline of orchestrator.getBuiltInPipelines()) {
    orchestrator.definePipeline(pipeline)
  }
  const skillStore = new SkillStore()
  const episodicStore = new EpisodicStore()
  const checkpoints = new CheckpointSystem()
  const hallucinationGuard = new HallucinationGuard(input.worktree)
  const parallelExec = new ParallelExecutor()
  const dashboard = new Dashboard()
  const sessionStore = new SessionStore()
  const traceLogger = new TraceLogger(input.worktree)
  const roleRegistry = new RoleRegistry()
  const schemaVersion = new MemorySchemaVersion()
  const selfEvolver = new SelfEvolver()
  const continuousEvolution = new ContinuousEvolution()
  const modelRegistry = new ModelRegistry()
  const llmEngine = new LLMEngine()
  llmEngine.setOpencodeClient(input.client)
  llmEngine.setModelRegistry(modelRegistry)
  orchestrator.setLLMEngine(llmEngine)
  errorAnalyzer.setLLM(llmEngine)
  verifier.setLLM(llmEngine)

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
  llmEngine.setMemoryStores({
    searchEpisodes: (query: string) => episodicStore.search(query),
    findSkills: (query: string) => skillStore.find(query).map(s => ({ name: s.definition.meta.name, successRate: s.successRate })),
  })
  const agentLoop = new AgentLoop(llmEngine, { maxIterations: 10, autoRetry: true, maxRetries: 2, verifyAfterEach: false })
  const persistence = new PersistenceLayer(input.worktree)
  const vectorStore = new VectorStore()
  vectorStore.setLLM(llmEngine)
  // Set search weights from config
  vectorStore.setSearchWeights(config.memory.search.keywordWeight, config.memory.search.vectorWeight)
  // Set stop word languages from config
  vectorStore.setStopWordsLanguages(config.memory.stopWordsLanguages)

  // Embedding: dari config — kalau ada endpoint, pake remote embedding
  // Kalau null → lightweight mode (TF-IDF sparse-only, zero dep)
  const embedConfig = config.embedding
  if (embedConfig && embedConfig.model) {
    vectorStore.setEmbeddingConfig(embedConfig.model, embedConfig.endpoint, embedConfig.apiKey)
    vectorStore.setLLM(llmEngine)
  }
  // Lightweight mode: tanpa embedder → VectorStore fallback ke sparse search otomatis

  contextCompressor.setLLM(llmEngine)
  verifier.detectLanguage(input.worktree)

  // Restore persisted model stats
  const savedModels = persistence.loadAll<Record<string, import("./core/model-registry.js").ModelStats>>("models")
  for (const m of savedModels) {
    modelRegistry.fromJSON(m.data)
  }

  // Restore persisted episodes and skills
  const savedEpisodes = persistence.loadAll<{ planGoal: string; outcome: string; decisions: string[]; filesChanged: string[]; sessionId: string; timestamp: string; tags: string[] }>("episodes")
  for (const ep of savedEpisodes) {
    episodicStore.record(ep.data.sessionId, ep.data.planGoal, ep.data.outcome as "success" | "partial" | "failed", ep.data.decisions, ep.data.filesChanged)
  }
  // Auto-save episodes when recorded
  episodicStore.setPersistenceCallback((episode) => {
    persistence.save("episodes", episode.sessionId, episode)
  })
  const savedSkills = persistence.loadAll<import("./memory/skill-format.js").SkillDefinition>("skills")
  for (const sk of savedSkills) {
    skillStore.importFromEnvelope(JSON.stringify(createMemoryEnvelope(sk.data, "skill")))
  }

  await traceLogger.init()

  // ── Config hot-reload propagation ──
  // Ketika config berubah di disk, module-module berikut di-update
  configLoader.onChange((newConfig) => {
    // 1. Vector store: search weights + stop words
    vectorStore.setSearchWeights(newConfig.memory.search.keywordWeight, newConfig.memory.search.vectorWeight)
    vectorStore.setStopWordsLanguages(newConfig.memory.stopWordsLanguages)

    // 2. Embedding config
    const embedCfg = newConfig.embedding
    if (embedCfg && embedCfg.model) {
      vectorStore.setEmbeddingConfig(embedCfg.model, embedCfg.endpoint, embedCfg.apiKey)
    }

    // 3. Agent delegation depth — propagate ke coordinator (akan dipakai untuk validasi depth)
    const maxDepth = newConfig.agent.maxDelegationDepth
    if (maxDepth > 0) {
      coordinator.setMaxDepth(maxDepth)
    }
  })

  function ctxDir(context: { worktree: string; directory?: string }) {
    return context.worktree
  }

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
          subtasks: tool.schema.array(tool.schema.object({
            id: tool.schema.string().describe("Unique identifier for this subtask"),
            description: tool.schema.string().describe("What this subtask should accomplish"),
            dependsOn: tool.schema.array(tool.schema.string()).optional().describe("IDs of subtasks that must be completed first"),
            verificationCriteria: tool.schema.array(tool.schema.string()).optional().describe("How to verify this subtask succeeded"),
          })).optional().describe("Manual subtask list. If omitted and autoDecompose is enabled, the planner will auto-generate steps."),
        },
        async execute(args, context) {
          llmEngine.setSessionId(context.sessionID)
          let subtasks = args.subtasks ?? []

          if (subtasks.length === 0 && args.autoDecompose !== false) {
            if (args.llmDecompose !== false) {
              await navigator.scan(input.worktree)
              const codebaseSummary = navigator.getSummary()
              try {
                const llmIntent = await planner.decomposeWithLLM(llmEngine, args.goal, codebaseSummary)
                subtasks = llmIntent.subtasks
              } catch {
                // Fall through to template-based
              }
            }

            if (subtasks.length === 0) {
              const decomposition = planner.decompose(args.goal, args.relevantFiles ?? [])
              if (decomposition.autoGenerated) {
                subtasks = decomposition.intent.subtasks
              }
            }
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

          traceLogger.log({
            step: "plan",
            input: args.goal,
            output: JSON.stringify(plan),
            toolUsed: "agentic_plan",
            success: errors.length === 0,
            durationMs: 0,
            metadata: { errors, complexity: plan.complexity, autoDecomposed: subtasks !== args.subtasks, llmDecomposed: !!args.llmDecompose },
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

          const autoTag = subtasks !== args.subtasks ? " (auto-decomposed)" : ""

          return {
            output: `## Plan Created${autoTag}\n\n**Goal:** ${plan.intent.goal}\n**Complexity:** ${plan.complexity}\n**Steps:** ${plan.estimatedSteps}\n\n### Steps\n${stepList}\n\nStart with \`agentic_execute\` for the first ready step.`,
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
        async execute(args, _context) {
          const maxResults = args.maxResults ?? 10
          await navigator.scan(input.worktree)
          const files = navigator.findRelevantFiles(args.query, maxResults)

          // Index files into vector store for hybrid search
          for (const file of files) {
            vectorStore.addDocument(`file:${file}`, `File ${file}`, {
              type: "file",
              path: file,
              tags: [],
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
          stepId: tool.schema.string().describe("The ID of the step that was executed"),
          success: tool.schema.boolean().describe("Whether the step completed successfully"),
          output: tool.schema.string().describe("Summary of what was done — what files changed, what was implemented"),
          filesModified: tool.schema.array(tool.schema.string()).optional().describe("List of files that were modified or created in this step"),
          error: tool.schema.string().optional().describe("Error message if the step failed"),
          autoVerify: tool.schema.boolean().optional().describe("Auto-run compile verification (default: true when success=true)"),
          feedback: tool.schema.enum(["positive", "negative"]).optional().describe("User feedback on the result. Positive boosts skill confidence; negative triggers adaptation (Gap #9: continuous learning from feedback)"),
        },
        async execute(args, context) {
          llmEngine.setSessionId(context.sessionID)
          const startTime = Date.now()
          const projectDir = ctxDir(context)

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
            verifyResult = changedFiles.length > 0
              ? verifier.verifyRelated(args.stepId, projectDir, changedFiles)
              : verifier.verifyAll(args.stepId, projectDir)
            if (verifyResult.passed) {
              response += `✅ Compile + tests pass\n`

              // Semantic verification (paper's verification fidelity)
              if (changedFiles.length > 0 && verifier.hasLLM()) {
                const session = sessionStore.getOrCreate(context.sessionID)
                const intent = session.plan?.intent.goal ?? args.output
                const semanticResult = await verifier.verifySemantic(args.stepId, intent, changedFiles, projectDir)
                if (semanticResult.passed) {
                  response += `✅ Semantic check: changes match intent\n`
                } else {
                  response += `⚠️ **Semantic issues found!**\n`
                  response += `\`\`\`\n${semanticResult.output.slice(0, 400)}\n\`\`\`\n`
                  response += `Consider reviewing the logic before proceeding.\n`
                }
              }
            } else {
              response += `❌ Verification failed after this step!\n`
              response += verifyResult.checks.map(c =>
                `${c.passed ? "✅" : "❌"} **${c.name}**\n\`\`\`\n${c.output.slice(0, 400)}\n\`\`\``
              ).join("\n\n")
              response += `\n\n⚠️ **Recommendation:** Run \`agentic_reflect\` on this step for propagation analysis and fix suggestions.`
            }
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
            response += `\n### 🎉 All steps complete!\nRun \`agentic_verify\` for final verification.`

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
              )
            }
          }

          // ── User Feedback for Continuous Learning (Gap #9) ──
          if (args.feedback) {
            const isPositive = args.feedback === "positive"
            response += `\n### 📝 Feedback Recorded\n`
            response += `${isPositive ? "✅ Positive — confidence increased" : "❌ Negative — adapting..."}\n`

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

              // Check if evolution should trigger
              const trigger = continuousEvolution.shouldEvolve(context.sessionID)
              if (trigger) {
                response += `  🔄 **Auto-evolution triggered:** ${trigger.reason}\n`
                response += `  Run \`agentic_evolve evolve\` to apply changes.\n`
              }
            }
          }

          return { output: response, metadata: { progress, nextStep: nextStep?.id, verifyResult } }
        },
      }),

      agentic_reflect: tool({
        description: "Analyze a failed step. Diagnoses the error category, traces error propagation across the step chain, and suggests a recovery plan.",
        args: {
          stepId: tool.schema.string().describe("The ID of the failed step to analyze"),
          errorDetails: tool.schema.string().optional().describe("Additional error context (full stack trace, test output, etc.)"),
          attemptedFix: tool.schema.string().optional().describe("What you tried to fix the error (if any)"),
        },
        async execute(args, context) {
          llmEngine.setSessionId(context.sessionID)
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

          let output = `## 🔍 Error Analysis: Step "${args.stepId}"\n\n`
          output += `**Category:** \`${analysis.category}\`\n`
          output += `**Severity:** ${analysis.severity}\n`
          output += `**Retry #${retriesUsed}/3**\n\n`
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
            output += `\n---\n🔄 **${3 - retriesUsed} retries left.** Fix and call \`agentic_execute\` to retry.`
          } else {
            output += `\n---\n🛑 **No retries remaining.** Consider adding a new plan step for this fix.`
          }

          return { output }
        },
      }),

      agentic_verify: tool({
        description: "Run full verification: compile + lint + test suite. Auto-detects language (TypeScript, Python, Go, Rust, JavaScript). Includes error analysis on failure.",
        args: {
          stepId: tool.schema.string().optional().describe("Label for this verification"),
          projectDir: tool.schema.string().optional().describe("Project directory (default: worktree)"),
        },
        async execute(args, context) {
          const projectDir = args.projectDir ?? ctxDir(context)
          const stepId = args.stepId ?? "full"

          const result = verifier.verifyAll(stepId, projectDir)

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
              output += `⚠️ **Performance degradation detected!** Consider \`agentic_evolve evolve\`.\n`
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

          return { output, metadata: { progress, nextStep: nextStep?.id, blockedSteps, isComplete, isHealthy } }
        },
      }),

      agentic_context: tool({
        description: "View and compress the execution context. When approaching context limits, this tool summarizes the conversation history into a compact form preserving key decisions, file changes, and invariants.",
        args: {
          action: tool.schema.enum(["view", "compress"]).describe("'view' shows current context stats; 'compress' generates a compressed context prompt"),
        },
        async execute(args, context) {
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
        description: "Save or restore execution snapshots. Use 'save' to checkpoint current state (plan progress, file changes, decisions). Use 'list' to see all snapshots.",
        args: {
          action: tool.schema.enum(["save", "list"]).describe("'save' creates a checkpoint; 'list' shows all saved snapshots"),
          label: tool.schema.string().optional().describe("Optional label for the snapshot (e.g., 'after-types')"),
        },
        async execute(args, context) {
          if (args.action === "save") {
            const progress = executor.getProgress(context.sessionID)
            const allFiles = executor.getAllFilesModified(context.sessionID)
            const session = sessionStore.getOrCreate(context.sessionID)
            const planGoal = session.plan?.intent.goal ?? "N/A"

            const snapshot = {
              label: args.label ?? `snap-${Date.now()}`,
              timestamp: new Date().toISOString(),
              planGoal,
              progress,
              filesModified: allFiles,
              completedSteps: session.plan?.intent.subtasks.filter(s =>
                executor.getCompletedSteps(context.sessionID).includes(s.id)
              ).map(s => s.id) ?? [],
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

          return { output: `## 📸 Snapshots\n\n${snapshots.map(s => `- \`${s}\``).join("\n")}` }
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

              coordinator.writeSharedMemory(`pipeline:run:${runId}`, `Started pipeline ${pipeline.name}`, "coordinator")

              let out = `## 🚀 Pipeline Run Started\n\n`
              out += `**Pipeline:** ${pipeline.name} (\`${args.pipelineId}\`)\n`
              out += `**Run ID:** \`${runId}\`\n\n`
              out += `### Stages\n`
              out += pipeline.stages.map((s, i) => {
                const prefix = i === 0 ? "▶" : "⏳"
                const category = s.model ?? roleRegistry.suggestModel(s.role)
                const resolved = modelRegistry.resolveAlias(category)
                const modelLabel = resolved.length > 0 && resolved[0] !== category ? `${resolved[0]} (${category})` : category
                return `${prefix} **${s.role}** — ${s.description} (model: ${modelLabel})`
              }).join("\n")
              out += `\n\n### Next Step\nDelegate tasks to each stage. Start with \`agentic_delegate\` for the first role: **${pipeline.stages[0].role}**.`

              return { output: out, metadata: { runId, pipelineId: args.pipelineId } }
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

          let output = `## 📋 PR Description\n\n`
          output += `---\ntitle: ${pr.title}\n---\n\n`
          output += `## Summary\n\n${pr.summary}\n\n`
          output += `## Changes\n\n${pr.changes.join("\n")}\n\n`
          output += `## Files Changed\n\n${allFiles.map(f => `- \`${f}\``).join("\n")}\n\n`
          output += `## Test Plan\n\n${pr.testPlan}\n\n`

          if (pr.breakingChanges) {
            output += `## ⚠️ Breaking Changes\n\nSome steps failed. Review carefully before merging.\n\n`
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
          pipelineRunId: tool.schema.string().optional().describe("Pipeline run ID to associate this task with a pipeline stage"),
          result: tool.schema.string().optional().describe("Task result (set when completing a task to trigger downstream stages and cross-validation)"),
          status: tool.schema.enum(["pending", "running", "done", "failed"]).optional().describe("Set the task status"),
          requestReview: tool.schema.boolean().optional().describe("Request review from a downstream role after completing this task"),
        },
        async execute(args, context) {
          const allTasks = coordinator.getTasks(context.sessionID)

          // If result is provided, we're completing a task
          if (args.result || args.status) {
            const updated = coordinator.updateTask(context.sessionID, args.taskId, args.status ?? "done", args.result)
            if (!updated) return { output: `Task "${args.taskId}" not found.` }

            // Write to shared memory
            coordinator.writeSharedMemory(`task:${args.taskId}`, (args.result ?? "").slice(0, 500), args.role ?? "unknown")

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
                    coordinator.getAllSharedMemory(),
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
                    coordinator.getAllSharedMemory(),
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

          const task = coordinator.delegate(role, {
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
          const agentCtx = {
            systemPrompt: agent.prompt ?? `You are a ${role} in a software engineering team.`,
            sessionId: context.sessionID,
            role,
            taskDescription: contextWithMemory,
            pipelineContext: pipelineContext || undefined,
            pendingMessages: pendingMessages.length > 0 ? pendingMessages.map(m => ({ from: m.from, payload: m.payload })) : undefined,
            sharedMemory: coordinator.getAllSharedMemory().map(e => ({ key: e.key, value: e.value, writtenBy: e.writtenBy })),
          }
          const agentResultObj = await agentRuntime.execute(agentCtx)
          const agentResult = agentResultObj.success ? agentResultObj.output : ""
          const executionError = agentResultObj.success ? null : (agentResultObj.error ?? "Agent execution failed")

          if (agentResult) {
            coordinator.updateTask(context.sessionID, args.taskId, "done", agentResult)
            coordinator.writeSharedMemory(`task:${args.taskId}`, agentResult.slice(0, 500), role)
            coordinator.writeSharedMemory(`task:${args.taskId}:full`, agentResult, role)
          } else {
            coordinator.updateTask(context.sessionID, args.taskId, "failed", executionError ?? "LLM unavailable")
          }

          let output = `## 🤖 Task Delegated\n\n`
          output += `**Task:** \`${args.taskId}\`\n`
          output += `**Role:** ${role} (${agent.name})\n`
          output += `**Description:** ${args.description}\n`
          output += `**Status:** ${agentResult ? "✅ Done" : executionError ? "❌ Failed" : "⚠️ Unknown"}\n`

          // Model suggestion — check session preference first, then fall through
          const sessionModelPref = sessionStore.getModelPreference(context.sessionID, role)
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
                const finalValidation = await orchestrator.crossValidate("coordinator", "Pipeline completed", allResults, coordinator.getAllSharedMemory())
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
        description: "Manage reusable skills extracted from successful task completions. Use 'extract' to create a skill from a completed step. Use 'find' to search existing skills.",
        args: {
          action: tool.schema.enum(["extract", "find", "list"]).describe("'extract' creates a skill; 'find' searches; 'list' shows all"),
          query: tool.schema.string().optional().describe("Search query or extraction target (stepId)"),
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

            return {
              output: `## 🧠 Skill Extracted\n\n**Name:** ${skill.definition.meta.name}\n**Pattern:** \`${skill.definition.trigger.pattern}\`\n**Steps:** ${skill.definition.workflow.steps.length}\n**Success rate:** ${(skill.successRate * 100).toFixed(0)}%\n\n\`\`\`\n${skill.definition.workflow.steps.map(s => s.description).join("\n")}\n\`\`\``,
            }
          }

          if (args.action === "find") {
            if (!args.query) return { output: "Provide a search query." }
            const skills = skillStore.find(args.query)
            if (skills.length === 0) return { output: `No skills found for "${args.query}".` }
            let output = `## 🔍 Skills Matching "${args.query}"\n\n`
            output += skills.map(s => `- **${s.definition.meta.name}** (${(s.successRate * 100).toFixed(0)}% success, ${s.usageCount} uses)\n  Pattern: \`${s.definition.trigger.pattern}\``).join("\n")
            return { output }
          }

          const skills = skillStore.getAll()
          if (skills.length === 0) return { output: "No skills yet. Complete tasks and use `action: \"extract\"` to build the skill library." }

          let output = `## 🧠 Skill Library (${skills.length})\n\n`
          output += skills.map(s => `- **${s.definition.meta.name}** — ${(s.successRate * 100).toFixed(0)}% (${s.usageCount} uses)`).join("\n")
          return { output }
        },
      }),

      agentic_model: tool({
        description: "Configure per-role LLM model preferences for the current session. Use 'set' to assign a model to an agent role. Use 'get' to see current assignment. Use 'list' to view all preferences. Use 'clear' to remove a preference.",
        args: {
          action: tool.schema.enum(["set", "get", "list", "clear"]).describe("Action: set/get/list/clear per-role model preference"),
          role: tool.schema.string().optional().describe("Agent role (architect, developer, qa, coordinator, pm)"),
          model: tool.schema.string().optional().describe("Model name (e.g. 'gpt-4o', 'claude-sonnet-4-20250514')"),
        },
        async execute(args, context) {
          const VALID_ROLES = ["architect", "developer", "qa", "coordinator", "pm"]

          if (args.action === "list") {
            const prefs = sessionStore.getAllModelPreferences(context.sessionID)
            if (prefs.length === 0) {
              return { output: "No model preferences configured for this session. Use `action: \"set\"` to assign models to agent roles." }
            }
            let output = "## 🎯 Session Model Preferences\n\n"
            output += "| Role | Model |\n"
            output += "|------|-------|\n"
            output += prefs.map(p => `| **${p.role}** | \`${p.model}\` |`).join("\n")
            output += "\n\nThese preferences override the default model selection during delegation."
            return { output }
          }

          if (args.action === "set") {
            if (!args.role) return { output: "Provide a `role` (e.g. 'architect', 'developer', 'qa', 'coordinator', 'pm')." }
            if (!args.model) return { output: "Provide a `model` name (e.g. 'gpt-4o', 'claude-sonnet-4-20250514')." }
            const roleLower = args.role.toLowerCase()
            if (!VALID_ROLES.includes(roleLower)) {
              return { output: `Invalid role "${args.role}". Valid roles: ${VALID_ROLES.join(", ")}` }
            }
            sessionStore.setModelPreference(context.sessionID, roleLower, args.model)
            // Also register in model registry so it's tracked
            modelRegistry.addModel(args.model)
            modelRegistry.registerAlias(roleLower, [args.model])
            return { output: `✅ Model preference set: **${roleLower}** → \`${args.model}\`\nThis model will be used when delegating tasks to the ${roleLower} role in this session.` }
          }

          if (args.action === "get") {
            if (!args.role) return { output: "Provide a `role` to check (e.g. 'architect')." }
            const model = sessionStore.getModelPreference(context.sessionID, args.role)
            if (!model) {
              return { output: `No model preference set for role "${args.role}". Delegation will use default model selection.` }
            }
            return { output: `**${args.role}** → \`${model}\`` }
          }

          if (args.action === "clear") {
            sessionStore.clearModelPreference(context.sessionID, args.role)
            if (args.role) {
              return { output: `Cleared model preference for role "${args.role}".` }
            }
            return { output: "Cleared all model preferences for this session." }
          }

          return { output: "Unknown action. Use 'set', 'get', 'list', or 'clear'." }
        },
      }),

      agentic_episodes: tool({
        description: "Browse cross-session memory. Search past tasks and their outcomes to learn from previous sessions. Use before planning similar tasks to avoid repeating mistakes.",
        args: {
          action: tool.schema.enum(["search", "recent", "stats"]).describe("'search' finds relevant past tasks; 'recent' shows latest; 'stats' shows summary"),
          query: tool.schema.string().optional().describe("Search query (for 'search' action)"),
        },
        async execute(args, context) {
          if (args.action === "search") {
            if (!args.query) return { output: "Provide a search query." }

            // Index episodes into vector store for RAG-enhanced search
            const allEpisodes = episodicStore.getRecent(50)
            for (const ep of allEpisodes) {
              vectorStore.addDocument(`ep:${ep.sessionId}`, `${ep.planGoal} ${ep.outcome} ${ep.decisions.join(" ")}`, {
                type: "episode",
                sessionId: ep.sessionId,
                outcome: ep.outcome,
                tags: [],
              })
            }
            const vectorResults = await vectorStore.semanticSearch(args.query, 5)
            const episodes = allEpisodes.filter(e => vectorResults.some(r => r.id === `ep:${e.sessionId}`))
            if (episodes.length === 0) return { output: `No episodes found for "${args.query}".` }
            let output = `## 🧠 Episodic Memory (RAG): "${args.query}"\n\n`
            output += episodes.map(e =>
              `- **${e.outcome === "success" ? "✅" : e.outcome === "partial" ? "⚠️" : "❌"} ${e.planGoal}**\n  Score: ${vectorResults.find(r => r.id === `ep:${e.sessionId}`)?.score.toFixed(2) ?? "?"} | Files: ${e.filesChanged.length} | ${e.timestamp.slice(0, 10)}`
            ).join("\n")
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
        description: "Analyze or execute steps concurrently. Use `analyze` to see parallelism opportunities, or `execute` to run ready steps in parallel with Promise.all. Supports LLM-driven execution and sub-process OpenCode spawn.",
        args: {
          action: tool.schema.enum(["analyze", "execute"]).optional().describe("'analyze' (default) shows parallelism plan; 'execute' runs ready steps concurrently"),
          opencodePath: tool.schema.string().optional().describe("Path to `opencode` binary for sub-process spawn (execute mode)"),
          abortOnFailure: tool.schema.boolean().optional().describe("Stop all tasks in phase if one fails (default: false)"),
        },
        async execute(args, context) {
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
              stepRunner = parallelExec.llmStepRunner({
                llmEngine,
                projectDir: cwd,
                planGoal: session.plan.intent.goal,
                sessionId: context.sessionID,
              })
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
        async execute(args, _context) {
          // Always show model reliability regardless of trace data
          const modelReliability = modelRegistry.getSummary()
          let traceSection = ""

          // Read traces from file
          await traceLogger.flush()
          const tracePath = `${input.worktree}/.agentic/trace.jsonl`
          let traces = []
          try {
            const content = readFileSync(tracePath, "utf-8")
            traces = content.trim().split("\n").filter(Boolean).map(l => JSON.parse(l))
          } catch { /* no traces yet */ }

          if (traces.length > 0) {
            const data = dashboard.generate(traces, Date.now())
            traceSection = dashboard.formatForDisplay(data)
          }

          let output = traceSection || "### 📊 Execution Overview\n\nNo trace data available yet. Execute some steps first.\n"
          output += `\n### 🤖 Model Reliability\n${modelReliability}\n`

          return { output }
        },
      }),

      agentic_guard: tool({
        description: "Verify the truthfulness of claims made in step outputs. Checks that files referenced actually exist, functions claimed exist in code, and imports are valid. Use to catch LLM hallucinations before they corrupt the codebase.",
        args: {
          stepId: tool.schema.string().describe("The step ID whose output to verify"),
        },
        async execute(args, context) {
          const stepState = executor.getStepState(context.sessionID, args.stepId)
          if (!stepState?.result) return { output: `No execution record for step "${args.stepId}".` }

          const output = stepState.result.output
          const files = executor.getAllFilesModified(context.sessionID)
          const check = hallucinationGuard.check(output, files)

          if (!check.passed) {
            modelRegistry.recordHallucination(llmEngine.getCurrentModel())
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
          const modelScore = modelRegistry.getScore(llmEngine.getCurrentModel())
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
          action: tool.schema.enum(["inspect", "register-role", "export-skill", "memory-schema", "evolve"]).describe("What to do: inspect system state, register a custom agent role, export a skill in machine-readable format, view memory schema info, or run full self-evolution analysis"),
          name: tool.schema.string().optional().describe("Role name or skill name (for register-role, export-skill)"),
          prompt: tool.schema.string().optional().describe("Agent prompt template (for register-role)"),
          tools: tool.schema.array(tool.schema.string()).optional().describe("Tools available to custom role"),
          skillId: tool.schema.string().optional().describe("Skill ID to export or inspect"),
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
              if (!args.name || !args.prompt) {
                return { output: "Both `name` and `prompt` are required to register a custom role." }
              }
              const roleId = args.name.toLowerCase().replace(/\s+/g, "-")
              roleRegistry.registerCustom({
                role: roleId,
                name: args.name,
                prompt: args.prompt,
                tools: args.tools ?? ["read", "edit", "write", "bash"],
              })
              return { output: `Custom role "${args.name}" registered as \`${roleId}\`. Available via \`agentic_delegate role=${roleId}\`.` }
            }

            case "export-skill": {
              const skillId = args.skillId
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

              let traces: Array<{ toolUsed: string; success: boolean; step: string }> = []
              const tracePath = `${input.worktree}/.agentic/trace.jsonl`
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
                } catch { }
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

              // Auto-apply prompt patches (Gap #1)
              const appliedPatches: string[] = []
              for (const patch of report.promptPatches) {
                try {
                  const existingPrompt = roleRegistry.getPrompt(patch.role)
                  if (existingPrompt && !existingPrompt.includes(patch.instruction.slice(0, 40))) {
                    const newPrompt = existingPrompt + `\n\n## Auto-Patched Instruction (from ${patch.errorCategory} errors)\n${patch.instruction}`
                    roleRegistry.updatePrompt(patch.role as "architect" | "developer" | "qa" | "coordinator" | "pm", newPrompt)
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

              return { output: out }
            }

            default:
              return { output: `Unknown action: ${args.action}. Available: inspect, register-role, export-skill, memory-schema, evolve.` }
          }
        },
      }),

      agentic_auto: tool({
        description: "Fully autonomous engineering agent. Give it a goal and it plans, implements, verifies, and fixes code automatically — no step-by-step guidance needed.",
        args: {
          goal: tool.schema.string().describe("The goal to accomplish autonomously"),
          constraints: tool.schema.array(tool.schema.string()).optional().describe("Constraints or requirements"),
        },
        async execute(args, context) {
          llmEngine.setSessionId(context.sessionID)
          const startTime = Date.now()
          const projectDir = ctxDir(context)

          // 1. Scan codebase for context
          await navigator.scan(projectDir)
          const summary = navigator.getSummary()

          // 2. LLM-driven plan (fallback to template if LLM returns empty)
          let subtasks: Subtask[] = []
          try {
            const intent = await planner.decomposeWithLLM(llmEngine, args.goal, summary)
            if (intent.subtasks.length > 0) subtasks = intent.subtasks
          } catch { /* fall through */ }
          if (subtasks.length === 0) {
            const template = planner.decompose(args.goal, [])
            if (template.autoGenerated) subtasks = template.intent.subtasks
          }
          if (subtasks.length === 0) {
            subtasks = [
              { id: "step-1", description: args.goal, dependsOn: [], verificationCriteria: ["All code compiles", "Logic is correct"] },
            ]
          }
          if (subtasks.length === 0) {
            return {
              output: `## 🤖 Autonomous Agent Report\n\n**Goal:** ${args.goal}\n**Result:** 0/0 steps — could not decompose into subtasks. Try rephrasing the goal or using \`agentic_plan\` manually.`,
              metadata: { result: { completedSteps: [], failedSteps: [], totalIterations: 0, success: false, summary: "Planning failed: no subtasks generated" } },
            }
          }

          const plan = intentParser.createPlan({
            goal: args.goal,
            constraints: args.constraints ?? [],
            context: { relevantFiles: [], dependencies: [] },
            subtasks,
          })
          executor.initExecution(context.sessionID, plan)

          // 3. Execute steps via AgentLoop.runLoop()
          const parseStepOutput = (content: string): { files?: Array<{ path: string; content: string }>; summary?: string } => {
            const cleaned = content.trim()
            try {
              const parsed = JSON.parse(cleaned)
              if (parsed && typeof parsed === "object") return parsed
            } catch { /* try next */ }
            const jsonBlock = cleaned.match(/```(?:json)?\s*\n?(\{[\s\S]*?\})\s*\n?```/)
            if (jsonBlock) {
              try { return JSON.parse(jsonBlock[1]) } catch { /* try next */ }
            }
            const jsonMatch = cleaned.match(/\{[\s\S]*?"files"[\s\S]*?"summary"[\s\S]*?\}/)
            if (jsonMatch) {
              try {
                const p = JSON.parse(jsonMatch[0])
                if (Array.isArray(p.files) || p.summary) return p
              } catch { /* try next */ }
            }
            return { files: [], summary: cleaned.replace(/```[\s\S]*?```/g, "").slice(0, 200).trim() }
          }

          const stepExecutor = async (step: Subtask) => {
            const stepsSoFar = executor.getCompletedSteps(context.sessionID)
            const prevState = executor.getStepState(context.sessionID, step.id)
            const retryNote = prevState?.retryCount && prevState.retryCount > 0
              ? `\nPREVIOUS ATTEMPT FAILED (retry #${prevState.retryCount}/3). Errors:\n${(prevState.errorHistory || []).map(e => `- ${e.error}`).join("\n")}`
              : ""
            const resp = await llmEngine.call({
              systemPrompt: `You are an autonomous software engineer implementing a step of a larger plan. Generate implementation as JSON with:
- "files": [{ "path": "relative/file/path", "content": "file content" }]
- "summary": "what was done"
Only include files that need changing. Return ONLY valid JSON.` + llmEngine.getMemoryContext(step.description),
              userPrompt: `Goal: ${args.goal}\nStep (${step.id}): ${step.description}\nDir: ${projectDir}\nCompleted steps: ${stepsSoFar.join(", ") || "none"}${retryNote}`,
              jsonMode: false,
              temperature: prevState?.retryCount ? 0.4 : 0.3,
            })

            const impl = parseStepOutput(resp.content)

            // Validate LLM actually produced implementation
            const hasContent = (impl.files && impl.files.length > 0) || (impl.summary && impl.summary.length > 20)
            if (!hasContent) {
              return { success: false, output: `LLM produced no implementation. Raw output: ${resp.content.slice(0, 200)}`, filesModified: [] }
            }

            const files: string[] = []
            for (const file of impl.files ?? []) {
              const fullPath = join(projectDir, file.path)
              mkdirSync(dirname(fullPath), { recursive: true })
              writeFileSync(fullPath, file.content, "utf-8")
              files.push(file.path)
            }

            return { success: true, output: impl.summary ?? step.description, filesModified: files }
          }

          const fixExecutor = async (fix: string) => {
            try {
              execFileSync("bash", ["-c", fix], { cwd: projectDir, timeout: 30000, stdio: "pipe" })
              return true
            } catch { return false }
          }

          const result = await agentLoop.runLoop(
            context.sessionID, executor, verifier, errorAnalyzer, depTracker,
            projectDir, stepExecutor, fixExecutor,
          )

          // 4. Trace + episode
          const allFiles = executor.getAllFilesModified(context.sessionID)
          traceLogger.log({
            step: "auto", input: args.goal, output: JSON.stringify(result),
            toolUsed: "agentic_auto", success: result.success,
            durationMs: Date.now() - startTime, metadata: { ...result } as unknown as Record<string, unknown>,
          })

          episodicStore.record(
            context.sessionID, args.goal,
            result.success ? "success" : "partial",
            result.completedSteps.map(() => "completed"),
            allFiles,
          )

          // 5. Feed results to ContinuousEvolution
          const completedSteps = executor.getCompletedSteps(context.sessionID)
          for (const stepId of completedSteps) {
            continuousEvolution.feedStepResult({
              stepId,
              success: true,
              output: "completed",
              sessionId: context.sessionID,
              timestamp: Date.now(),
            })
          }
          for (const stepId of result.failedSteps) {
            continuousEvolution.feedStepResult({
              stepId,
              success: false,
              output: "failed",
              sessionId: context.sessionID,
              timestamp: Date.now(),
            })
          }
          const autoTrend = continuousEvolution.checkAndNotify()

          // 6. Auto-extract skill if successful
          if (result.success && result.completedSteps.length > 0) {
            const skillResult = await skillStore.extract({
              role: "tool",
              content: `✅ Successfully completed: ${args.goal}\nSteps completed: ${result.completedSteps.join(", ")}\nSummary: ${result.summary}`,
            }, [args.goal, ...(args.constraints ?? [])])
            if (skillResult) {
              persistence.save("skills", skillResult.definition.meta.id, skillResult.definition)
            }
          }

          // 7. Report
          const totalSteps = result.completedSteps.length + result.failedSteps.length
          let report = `## 🤖 Autonomous Agent Report\n\n`
          report += `**Goal:** ${args.goal}\n`
          report += `**Result:** ${result.completedSteps.length}/${totalSteps} steps (${result.totalIterations} iterations)\n`
          report += `${result.success ? "✅ All passed" : "⚠️ Some failed"}\n`
          report += `**Duration:** ${((Date.now() - startTime) / 1000).toFixed(1)}s\n\n`
          if (allFiles.length > 0) {
            report += `### Files Modified\n\`\`\`\n${[...new Set(allFiles)].join("\n")}\n\`\`\`\n`
          }
          report += `\n${result.summary}`

          // Evolution trend summary
          if (autoTrend.overall.total >= 5 || autoTrend.degradationDetected) {
            const dirIcon = autoTrend.rolling.direction === "improving" ? "📈" : autoTrend.rolling.direction === "degrading" ? "📉" : "📊"
            report += `\n\n### ${dirIcon} Evolution Trend\n`
            report += `**Overall:** ${(autoTrend.overall.successRate * 100).toFixed(0)}% (${autoTrend.overall.success}/${autoTrend.overall.total})\n`
            report += `**Recent (last ${autoTrend.rolling.windowSize}):** ${(autoTrend.rolling.successRate * 100).toFixed(0)}% — ${autoTrend.rolling.direction}\n`
            if (autoTrend.degradationDetected) {
              report += `⚠️ **Degradation detected!** Run \`agentic_evolve evolve\` to analyze and auto-apply fixes.\n`
            }
            if (autoTrend.recommendations.length > 0) {
              report += `**Suggestions:**\n${autoTrend.recommendations.map(r => `- ${r}`).join("\n")}\n`
            }
          }

          return { output: report, metadata: { result } }
        },
      }),
    },

    "tool.execute.after": async (toolInput: { tool: string; args: unknown; sessionID: string; callID: string }, _output: { title: string; output: string; metadata: unknown }) => {
      traceLogger.log({
        step: "tool",
        input: JSON.stringify(toolInput.args ?? {}),
        output: "completed",
        toolUsed: toolInput.tool,
        success: true,
        durationMs: 0,
      })
    },

    dispose: async () => {
      configLoader.stopWatch()
      persistence.save("models", "registry", modelRegistry.toJSON())
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
export { ErrorAnalyzer } from "./core/error-analyzer.js"
export { RoleRegistry } from "./agents/role-registry.js"
export { VectorStore } from "./memory/vector-store.js"
export { Verifier } from "./core/verifier.js"
export { ContinuousEvolution } from "./evolution/continuous-evolution.js"
export { SelfEvolver } from "./evolution/self-evolver.js"
export { AgentCoordinator } from "./agents/coordinator.js"
export { Executor } from "./core/executor.js"
