import type { Plugin, PluginModule } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
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
import type { AgentRole, AgentTask } from "./agents/coordinator.js"
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
import { LLMEngine } from "./core/llm.js"
import { AgentLoop } from "./core/agent-loop.js"
import { PersistenceLayer } from "./memory/persistence.js"
import { VectorStore } from "./memory/vector-store.js"

const createEngine = async (input: Parameters<Plugin>[0], _options: Parameters<Plugin>[1]) => {
  const intentParser = new IntentParser()
  const executor = new Executor()
  const verifier = new Verifier()
  const errorAnalyzer = new ErrorAnalyzer()
  const planner = new Planner()
  const navigator = new CodebaseNavigator()
  const depTracker = new DependencyTracker()
  const contextCompressor = new ContextCompressor()
  const git = new GitIntegration(input.worktree)
  const debtScorer = new TechDebtScorer()
  const coordinator = new AgentCoordinator()
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
  const llmEngine = new LLMEngine()
  llmEngine.setOpencodeClient(input.client)
  llmEngine.setMemoryStores({
    searchEpisodes: (query: string) => episodicStore.search(query),
    findSkills: (query: string) => skillStore.find(query).map(s => ({ name: s.definition.meta.name, successRate: s.successRate })),
  })
  const agentLoop = new AgentLoop(llmEngine)
  const persistence = new PersistenceLayer(input.worktree)
  const vectorStore = new VectorStore()
  vectorStore.setLLM(llmEngine)

  contextCompressor.setLLM(llmEngine)
  verifier.detectLanguage(input.worktree)

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
        description: "Record completion of a subtask. Auto-verifies compilation on success. Includes error recovery guidance + error propagation analysis on failure.",
        args: {
          stepId: tool.schema.string().describe("The ID of the step that was executed"),
          success: tool.schema.boolean().describe("Whether the step completed successfully"),
          output: tool.schema.string().describe("Summary of what was done — what files changed, what was implemented"),
          filesModified: tool.schema.array(tool.schema.string()).optional().describe("List of files that were modified or created in this step"),
          error: tool.schema.string().optional().describe("Error message if the step failed"),
          autoVerify: tool.schema.boolean().optional().describe("Auto-run compile verification (default: true when success=true)"),
        },
        async execute(args, context) {
          llmEngine.setSessionId(context.sessionID)
          const startTime = Date.now()
          const projectDir = ctxDir(context)

          if (args.filesModified && args.filesModified.length > 0) {
            depTracker.recordChange(context.sessionID, args.stepId, args.filesModified)
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
            const analysis = errorAnalyzer.analyze(args.error ?? args.output, modifiedFiles)
            const canRetry = executor.canRetry(context.sessionID, args.stepId)
            const retriesUsed = executor.getRetryCount(context.sessionID, args.stepId)
            const retriesLeft = 3 - retriesUsed

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
              response += `\n🔄 **Retries remaining:** ${retriesLeft}/3 — fix the issue and call \`agentic_execute\` again.`
            } else {
              response += `\n🛑 **Max retries reached.** Address the underlying issue or revise the plan.`
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
          const analysis = errorAnalyzer.analyze(errorText, modifiedFiles)
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

          const analysis = errorAnalyzer.analyze(result.errors.join("\n"), [])
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

            const summary = contextCompressor.compress(
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

          // Compress
          const summary = contextCompressor.compress(
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
        description: "Assign a task to a specialized agent role (architect/developer/qa/coordinator/pm). The tool auto-suggests the best role based on the task description.",
        args: {
          taskId: tool.schema.string().describe("Unique ID for this delegated task"),
          description: tool.schema.string().describe("What this agent should do"),
          role: tool.schema.enum(["architect", "developer", "qa", "coordinator", "pm"]).optional().describe("Target role (auto-detected if omitted)"),
          context: tool.schema.string().optional().describe("Additional context or instructions for the agent"),
        },
        async execute(args, context) {
          const role: AgentRole = args.role ?? coordinator.getSuggestedRole(args.description)
          const agent = coordinator.getAgent(role)
          if (!agent) {
            return { output: `Unknown role "${role}". Available: architect, developer, qa, coordinator.` }
          }

          const task = coordinator.delegate(role, {
            id: args.taskId,
            assignedTo: role,
            description: args.description,
            input: args.context ?? args.description,
            status: "pending",
          }, context.sessionID)

          const allTasks = coordinator.getTasks(context.sessionID)

          let output = `## 🤖 Task Delegated\n\n`
          output += `**Task:** \`${args.taskId}\`\n`
          output += `**Role:** ${role} (${agent.name})\n`
          output += `**Description:** ${args.description}\n`
          output += `**Status:** Pending\n\n`
          output += `### Agent Prompt\n\`\`\`\n${agent.prompt}\n\`\`\`\n\n`
          output += `### Available Tools\n${agent.tools.map(t => `- \`${t}\``).join("\n")}\n\n`
          output += `### Active Tasks (${allTasks.length})\n`
          output += allTasks.map(t =>
            `- ${t.status === "done" ? "✅" : t.status === "failed" ? "❌" : "⏳"} **${t.id}** → ${t.assignedTo}: ${t.description}`
          ).join("\n")

          traceLogger.log({
            step: "delegate",
            input: args.taskId,
            output: `→ ${role}`,
            toolUsed: "agentic_delegate",
            success: true,
            durationMs: 0,
          })

          return { output }
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
        description: "Analyze the current plan for parallel execution opportunities. Identifies which steps can run concurrently and detects potential file conflicts. Use to speed up multi-step workflows.",
        args: {},
        async execute(args, context) {
          const session = sessionStore.getOrCreate(context.sessionID)
          if (!session.plan) return { output: "No plan found. Create one with `agentic_plan` first." }

          const subtasks = session.plan.intent.subtasks
          const completed = executor.getCompletedSteps(context.sessionID)
          const plan = parallelExec.analyzeParallelism(subtasks)

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
            // Group by parallel group
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
          }

          // Detect conflicts
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
        description: "Generate an observability dashboard from execution traces. Shows timeline, statistics, tool usage, and anomaly detection (timeouts, retry storms, silent failures).",
        args: {},
        async execute(args, _context) {
          // Read traces from file (the trace-logger writes asynchronously, flush first)
          await traceLogger.flush()

          const tracePath = `${input.worktree}/.agentic/trace.jsonl`
          let traces = []
          try {
            const content = readFileSync(tracePath, "utf-8")
            traces = content.trim().split("\n").filter(Boolean).map(l => JSON.parse(l))
          } catch {
            return { output: "No trace data available yet. Execute some steps first to generate traces." }
          }

          if (traces.length === 0) {
            return { output: "No trace data available yet." }
          }

          const data = dashboard.generate(traces, Date.now())
          const output = dashboard.formatForDisplay(data)
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

              if (patchedSkills.length > 0) {
                out += `### ✅ Auto-Patched Skills\n`
                for (const name of patchedSkills) {
                  out += `- **${name}** — patched automatically\n`
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

          // 2. LLM-driven plan
          const intent = await planner.decomposeWithLLM(llmEngine, args.goal, summary)
          const plan = intentParser.createPlan({
            goal: args.goal,
            constraints: args.constraints ?? [],
            context: { relevantFiles: [], dependencies: [] },
            subtasks: intent.subtasks,
          })
          executor.initExecution(context.sessionID, plan)

          // 3. Execute steps via AgentLoop.runLoop()
          const stepExecutor = async (step: Subtask) => {
            const stepsSoFar = executor.getCompletedSteps(context.sessionID)
            const resp = await llmEngine.call({
              systemPrompt: `You are an autonomous software engineer implementing a step of a larger plan. Generate implementation as JSON with:
- "files": [{ "path": "relative/file/path", "content": "file content" }]
- "summary": "what was done"
Only include files that need changing. Return ONLY valid JSON.` + llmEngine.getMemoryContext(step.description),
              userPrompt: `Goal: ${args.goal}\nStep (${step.id}): ${step.description}\nDir: ${projectDir}\nCompleted steps: ${stepsSoFar.join(", ") || "none"}`,
              jsonMode: true,
              temperature: 0.3,
            })

            let impl: { files?: Array<{ path: string; content: string }>; summary?: string }
            try { impl = JSON.parse(resp.content) } catch {
              return { success: false, output: "LLM response not valid JSON", filesModified: [], error: "Parse error" }
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

          // 5. Report
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
