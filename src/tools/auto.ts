import { tool } from "@opencode-ai/plugin"
import type { ToolSpec } from "./types.js"
import type { ToolContext } from "./tool-context.js"
import { join } from "node:path"
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { parseFileEntries, writeFiles as writeFilesHelper } from "../core/execution-helpers.js"
import { getSecondBrain } from "../memory/second-brain.js"
import { getSchemaValidator, getConsolidationScheduler } from "../core/shared-instances.js"
import { evaluateWorkflowPolicy, formatWorkflowPolicyDecisions } from "../core/workflow-policy.js"
import { runAutoEvolve } from "../evolution/auto-evolve.js"
import { TechDebtScorer } from "../core/tech-debt-scorer.js"
import { AutoRetryManager } from "../core/auto-retry.js"
import type { TaskIntent, Subtask } from "../core/intent-parser.js"
import { ResearchAgent5W1H, type ResearchReport } from "../core/5w1h-framework.js"

export function makeAutoTool(ctx: ToolContext): ToolSpec {
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
  const _debtScorer = techDebtScorer
  const _curator = skillCurator
  return {
      description: "Fully autonomous engineering orchestrator. One call handles: memory + skills → architecture → code → guard check → verify → score → learn.",
      args: {
        goal: tool.schema.string().describe("The overall goal / task description"),
        constraints: tool.schema.array(tool.schema.string()).optional().describe("Constraints or requirements"),
        thorough: tool.schema.boolean().optional().describe("Extra: memory + skills + guard + tech-debt post-processing (non-blocking, default: true)"),
        maxSteps: tool.schema.number().optional().describe("Maximum number of steps (default: auto)"),
      },
      async execute(args, context) {
        const projectDir = ctxDir(context)
        const startTime = Date.now()
        const thorough = args.thorough !== false

        // ── Second Brain: checklist + resume ──
        try {
          const sb = getSecondBrain()
          if (sb) {
            // Resume from crash: check for latest snapshot
            const snapshots = sessionStore.getOrCreate(context.sessionID).artifacts ?? new Map()
            const snapKeys = [...snapshots.keys()].filter(k => k.startsWith("snapshot:"))
            if (snapKeys.length > 0) {
              const latest = snapKeys.sort().reverse()[0]
              log.info(`[agentic_auto] Found saved snapshot: ${latest} — resuming with memory context`)
            }
            // Ensure memory loaded
            const check = sb.ensureMemoryLoaded(context.sessionID)
            if (!check.loaded && check.warning) {
              log.info(`[agentic_auto] ${check.warning}`)
            }
          }
        } catch (e) { log.warn("Silent catch: non-fatal", { error: String(e) }) }

        // ═══════════════════════════════════════════════
        // PHASE 1: Knowledge — scan + memory + skills
        // ═══════════════════════════════════════════════
        let codebaseSummary = ""
        const relevantFiles: string[] = []
        const memoryContexts: string[] = []
        const skillContexts: string[] = []

        try {
          await navigator.scan(projectDir).catch((err) => log.warn(`[agentic_auto] navigator scan failed:`, err))
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
              skillContexts.push(`${d.meta?.name || "skill"} (${(sk.successRate * 100).toFixed(0)}% success) — ${steps.slice(0, 2).map((w: { description?: string; action?: string }) => w.description || w.action || "").join("; ")}`)
            }
          }
        } catch (e) { log.warn("Silent catch: non-fatal", { error: String(e) }) }
        // Record research artifact for WorkflowPolicy
        sessionStore.getOrCreate(context.sessionID).artifacts.set("workflow:researched", String(Date.now()))

        // ═══════════════════════════════════════════════
        // PHASE 1b: 5W1H Research — investigate before planning
        // ═══════════════════════════════════════════════
        let researchReport: ResearchReport | null = null
        const researchAgent = new ResearchAgent5W1H()
        try {
          researchReport = await researchAgent.research({
            goal: args.goal,
            projectDir,
            llm: llmEngine,
            rag: multiIndexRAG,
            episodicStore,
            skillStore,
            navigator,
          })
          if (researchReport) {
            // Store findings for delegation context
            const researchCtx = researchAgent.formatForDelegation(researchReport)
            sessionStore.getOrCreate(context.sessionID).artifacts.set("5w1h:report", JSON.stringify(researchReport))
            sessionStore.getOrCreate(context.sessionID).artifacts.set("5w1h:context", researchCtx)

            // Store to RAG for cross-session reuse
            researchAgent.storeResearchToRAG(researchReport, multiIndexRAG, projectId).catch((e: unknown) =>
              log.warn(`[agentic_auto] 5W1H RAG store failed: ${e}`)
            )

            // Log findings summary
            const dimCount = researchReport.findings.length
            const gaps = researchReport.missingDimensions
            log.info(`[agentic_auto] 5W1H research: ${dimCount} findings, ${gaps.length > 0 ? `⚠️ gaps: ${gaps.join(", ")}` : "✅ all dimensions covered"}`)
            if (researchReport.techStack.frameworks.length > 0 || researchReport.techStack.databases.length > 0) {
              log.info(`[agentic_auto] Tech stack detected: ${[
                ...researchReport.techStack.languages,
                ...researchReport.techStack.frameworks,
                ...researchReport.techStack.databases,
              ].join(", ")}`)
            }
          }
        } catch (e) {
          log.warn(`[agentic_auto] 5W1H research failed (non-blocking): ${e}`)
        }

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
          } catch (e) { log.warn("Silent catch: fallback", { error: String(e) }) }
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
        // Record plan artifact for WorkflowPolicy
        sessionStore.getOrCreate(context.sessionID).artifacts.set("workflow:planned", String(Date.now()))

        // ═══════════════════════════════════════════════
        // PHASE 3: Implement — pipeline delegation or fast LLM
        // ═══════════════════════════════════════════════
        const fileContents: Record<string, string> = {}
        for (const f of relevantFiles) {
          try { fileContents[f] = readFileSync(join(projectDir, f), "utf-8").slice(0, 1000) } catch (e) { log.warn("Silent catch: skip", { error: String(e) }) }
        }

        const filesBlock = Object.entries(fileContents)
          .map(([p, c]) => `${p}:\n${c.slice(0, 600)}`).join("\n---\n")
        const pipelineId = orchestrator.getSuggestedPipeline(args.goal)
        const pipeline = orchestrator.getPipeline(pipelineId)
        // Hanya aktifkan pipeline untuk task yang benar-benar butuh multi-agent.
        // Pipeline = 4-5 LLM calls sequential — overkill untuk task sederhana.
        const hasComplexKeywords = /\b(feature|module|endpoint|api|pipeline|architecture|database|schema|multi[\s-]?step|complex)\b/i.test(args.goal)
        const hasSimpleKeywords = /\b(fix|typo|comment|rename|change|update|bump|remove|delete|add\s+\w+\s+to)\b/i.test(args.goal)
        // Don't treat as simple if we found relevant files (config/import tasks need file reading)
        const hasRelevantFiles = relevantFiles.length > 0 && relevantFiles.some(f => f.startsWith("src/") || f.endsWith(".json") || f.endsWith(".ts") || f.endsWith(".js"))
        const isSimpleOrTrivial = hasRelevantFiles ? false : ((args.goal.length < 100 && hasSimpleKeywords) || (!hasComplexKeywords && args.goal.length < 60) || activeSteps.length <= 1)
        const usePipeline = thorough && !isSimpleOrTrivial && pipeline && pipeline.stages.length >= 2 && activeSteps.length >= 2
        const useAgentLoop = thorough && !usePipeline && !isSimpleOrTrivial && activeSteps.length >= 2

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

          // Inject 5W1H research context into pipeline shared memory
          if (researchReport) {
            const researchCtx = researchAgent.formatForDelegation(researchReport)
            coordinator.writeSharedMemory("5w1h:research", researchCtx, "coordinator")
            if (researchReport.bestPractices.length > 0) {
              coordinator.writeSharedMemory("5w1h:best-practices", researchReport.bestPractices.join("\n"), "coordinator")
            }
          }

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
            schemaValidator: getSchemaValidator() as import("../core/skill-schema.js").SchemaValidator | undefined,
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
        } else if (useAgentLoop) {
          // ── AgentLoop path: DAG-based execution for complex tasks ──
          // AgentLoop handles per-step execution, verification, confidence scoring,
          // recovery, and emits events for Second Brain tracking.
          const stepExecutor = async (subtask: Subtask): Promise<{ success: boolean; output: string; filesModified: string[]; error?: string }> => {
            const subtaskGoal = subtask.description
            // Inject 5W1H research context if available — best practices + tech stack
            const researchContextStr = researchReport && researchReport.bestPractices.length > 0
              ? `\n\n## 5W1H Research Context\nTech Stack: ${[...researchReport.techStack.frameworks, ...researchReport.techStack.languages, ...researchReport.techStack.databases].join(", ") || "unknown"}\n\n### Mandatory Best Practices\n${researchReport.bestPractices.slice(0, 8).map(bp => `- ${bp}`).join("\n")}\n`
              : ""
            const llmSystemPrompt = `Return JSON array of {path, content}. Write COMPLETE file contents.
      Rules: ESM imports (.js) · match existing patterns · valid imports
      {"files":[{"path":"src/x.ts","content":"..."}]} or {"noChanges":true}${researchContextStr}`

            const fileContentsForSubtask: Record<string, string> = {}
            for (const f of relevantFiles) {
              try { fileContentsForSubtask[f] = readFileSync(join(projectDir, f), "utf-8").slice(0, 1000) } catch (e) { log.warn("Silent catch: skip", { error: String(e) }) }
            }
            const filesBlockForSubtask = Object.entries(fileContentsForSubtask)
              .map(([p, c]) => `${p}:\n${c.slice(0, 600)}`).join("\n---\n")

            const userPrompt = `${subtaskGoal}\n${codebaseSummary.slice(0, 100)}\n\n${filesBlockForSubtask || "(new)"}`
            const llmResult = await llmEngine.call({
              systemPrompt: llmSystemPrompt,
              userPrompt,
              temperature: 0.2,
              maxTokens: 2048,
              jsonMode: true,
            })
            const output = llmResult.content || ""
            if (output.includes("[NO_LLM]") || output === "NO_LLM") {
              hasNoLLM = true
              return { success: false, output: "No LLM", filesModified: [], error: "No LLM (mock)" }
            }
            const filesToWrite = parseFileEntries(output, relevantFiles[0]?.replace(/^\/+/, "") || "src/index.ts")
            const writtenPaths = writeFilesHelper(filesToWrite, projectDir, context.sessionID, eventBus)
            allModified.push(...writtenPaths)
            return {
              success: writtenPaths.length > 0 || filesToWrite.some((f: import("../core/execution-helpers.js").FileWriteEntry & { noChanges?: boolean }) => !!f.noChanges),
              output: `Generated ${writtenPaths.length} files`,
              filesModified: writtenPaths,
              error: writtenPaths.length === 0 ? "No files generated" : undefined,
            }
          }

          // Init AgentLoop state
          const planSubtaskList: Subtask[] = activeSteps.map(s => ({
            id: s.id, description: s.description,
            dependsOn: s.dependsOn ?? [],
            verificationCriteria: s.verificationCriteria ?? [],
            domain: undefined,
          }))
          executor.initExecution(context.sessionID, {
            intent: {
              goal: args.goal, subtasks: planSubtaskList,
              constraints: args.constraints ?? [],
              context: { relevantFiles: [], dependencies: [] },
            },
            estimatedSteps: planSubtaskList.length,
            complexity: planSubtaskList.length <= 3 ? "low" : planSubtaskList.length <= 8 ? "medium" : "high",
            warnings: [],
          })

          // P0: Set workflow state from session artifacts before autonomous execution
          {
            const artifacts = sessionStore.getOrCreate(context.sessionID).artifacts
            agentLoop.setWorkflowState({
              hasPlan: artifacts.has("workflow:planned"),
              hasResearch: artifacts.has("workflow:researched"),
              hasReflection: artifacts.has("workflow:reflected"),
            })
          }
          const loopResult = await agentLoop.runLoop(
            context.sessionID,
            executor,
            verifier,
            errorAnalyzer,
            depTracker,
            projectDir,
            stepExecutor,
            async (fix: string) => {
              try {
                const filesToWrite = parseFileEntries(fix, "src/index.ts")
                const writtenPaths = writeFilesHelper(filesToWrite, projectDir, context.sessionID, eventBus)
                allModified.push(...writtenPaths)
                return writtenPaths.length > 0
              } catch (_e) { log.warn("Silent catch: writeFiles helper failed"); return false }
            },
          )
          verifyPassed = loopResult.success
          completedSteps.push(...loopResult.completedSteps)
          // P1: Store adapted strategy for future planning feedback loop
          if (loopResult.adaptedStrategy) {
            const artifacts = sessionStore.getOrCreate(context.sessionID).artifacts
            artifacts.set("meta:adaptedStrategy", JSON.stringify(loopResult.adaptedStrategy))
          }
          verifyNote = loopResult.success
            ? `✅ AgentLoop: ${loopResult.completedSteps.length} steps`
            : `⚠️ AgentLoop: ${loopResult.completedSteps.length} ok, ${loopResult.failedSteps.length} failed`
        } else {
          // ── Fast path: monolithic LLM call with adaptive retry loop ──
          const systemPrompt = `Return JSON array of {path, content}. Write COMPLETE file contents.
Rules: ESM imports (.js) · match existing patterns · valid imports
{"files":[{"path":"src/x.ts","content":"..."}]} or {"noChanges":true}`

          const userPrompt = `${args.goal}${args.constraints?.length ? `\nConstraints: ${args.constraints.join(", ")}` : ""}${[...memoryContexts.slice(0, 2), ...skillContexts.slice(0, 1)].join("; ") ? `\nContext: ${[...memoryContexts.slice(0, 2), ...skillContexts.slice(0, 1)].join("; ")}` : ""}\n\n${filesBlock || "(new)"}\n${codebaseSummary.slice(0, 100)}`

          const isSimple = args.goal.length < 80 && activeSteps.length < 3
          const maxTokens = isSimple ? 1024 : 2048

          // ── Helper: parse LLM JSON output → {path, content}[] (shared) ──
          const parseLLMOutput = (output: string) =>
            parseFileEntries(output, relevantFiles[0]?.replace(/^\/+/, "") || "src/index.ts")

          // Capture pre-change git state for rollback
          try {
            if (git.isAvailable()) {
              const stashResult = execFileSync("git", ["stash", "create"], { cwd: projectDir, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim()
              preChangeCommit = stashResult || execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectDir, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim()
              hasGitRollback = true
            }
          } catch (e) { log.warn("Silent catch: non-fatal — rollback not available", { error: String(e) }) }

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

            // Parse & write files (shared helper with event emission)
            const filesToWrite = parseLLMOutput(output)
            const writtenPaths = writeFilesHelper(filesToWrite, projectDir, context.sessionID, eventBus)
            allModified.push(...writtenPaths)

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
                } catch (e) { log.warn("Silent catch: rollback best-effort", { error: String(e) }) }
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
            } catch (_e) { log.warn("Silent catch: verify error in auto loop")
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
            } catch (_e) { log.warn("Silent catch: git rollback failed")
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

        // ═══════════════════════════════════════════════
        // WorkflowPolicy Final Gate (P0)
        // ═══════════════════════════════════════════════
        const autoSession = sessionStore.getOrCreate(context.sessionID)
        const autoAgentCfg = configLoader.get().agent
        const autoWfMode = autoAgentCfg.dumbModelMode ? "strict" : (autoAgentCfg.workflowPolicyMode ?? "advisory")
        // verification evidence from whichever path actually ran
        const autoHasVerify = verifyPassed
          || (useAgentLoop && completedSteps.length > 0)
          || (usePipeline && allModified.length > 0 && hasNoLLM === false)
        if (autoHasVerify) {
          autoSession.artifacts.set("workflow:verified", String(Date.now()))
        }
        const autoFinalDecisions = evaluateWorkflowPolicy({
          action: "finalize",
          stepId: "auto",
          filesModified: allModified,
          success: !hasNoLLM && allModified.length > 0,
          hasPlan: true,
          hasResearch: true,
          hasVerificationEvidence: autoHasVerify,
        }, { mode: autoWfMode })
        const autoBlocked = autoFinalDecisions.some(d => d.severity === "block")
        if (autoBlocked) {
          verifyNote = "🛑 " + formatWorkflowPolicyDecisions(autoFinalDecisions.filter(d => d.severity === "block"))
        }
        // ponytail: autoFinalDecisions already used for block check above, no need to format again
        // ─── POST-PHASE: hanya kalau thorough ───
        // Guard + debate + post-processing semuanya fire-and-forget
        // supaya gak ngeblok response utama
        if (thorough && !hasNoLLM && allModified.length > 0) {
          ;(async () => {
            // Guard — verifikasi file claims (sync, fast)
            try {
              const checkOutput = `Created files: ${allModified.join(", ")}, wrote implementations for ${activeSteps.map(s => s.description).join(", ")}`
              const guardResult = hallucinationGuard.check(checkOutput, allModified)
              if (guardResult?.claims) {
                const failedClaims = guardResult.claims.filter((c: { verified: boolean }) => !c.verified)
                const conf = guardResult.overallConfidence !== undefined ? ` (conf: ${guardResult.overallConfidence.toFixed(2)})` : ''
                verifyNote += (failedClaims.length > 0 ? ` ⚠️ Guard:${failedClaims.length} issues` : " ✅ Guard") + conf
              }
            } catch (e) { log.warn("Silent catch: non-fatal", { error: String(e) }) }

            // Save episode
            try {
              episodicStore.record(context.sessionID, args.goal, verifyPassed ? "success" : "partial",
                [`Auto via agentic_auto`, `Verify: ${verifyPassed}`, `Files: ${allModified.length}`], allModified,
                domainRegistry.getCurrentDomain() ?? undefined, projectId)
            } catch (e) { log.warn("Silent catch: non-fatal", { error: String(e) }) }

            // Extract skill (async)
            try {
              const skillOutput = `Goal: ${args.goal}\nFiles: ${allModified.join(", ")}\nVerify: ${verifyPassed ? "passed" : "failed"}\nSteps: ${activeSteps.map(s => s.description).join("; ")}`
              await skillStore.extract({ role: "auto", content: skillOutput }, [args.goal])
            } catch (e) { log.warn("Silent catch: non-fatal", { error: String(e) }) }

            // Tech debt score
            try {
              const scorer = new TechDebtScorer()
              const absFiles = allModified.map(f => join(projectDir, f))
              const contents = new Map<string, string>()
              for (const f of absFiles) {
                try { contents.set(f, readFileSync(f, "utf-8")) } catch (e) { log.warn("Silent catch: skip", { error: String(e) }) }
              }
              scorer.score(args.goal, absFiles, contents)
            } catch (e) { log.warn("Silent catch: non-fatal", { error: String(e) }) }

            // Memory consolidation — archive working → episodic + pattern extraction
            try {
              const report = memoryOrchestrator.consolidate(sessionStore.getActiveSessions())
              if (report.workingArchived > 0 || report.patternsExtracted > 0) {
                const cs = getConsolidationScheduler()
                if (cs && typeof (cs as any).onSessionEnd === "function") (cs as any).onSessionEnd()
              }
            } catch (e) { log.warn("Silent catch: non-fatal", { error: String(e) }) }

            // Phase 4B: Auto-evolution — check if evolution should be triggered
            try {
              const evoTrigger = continuousEvolution.shouldEvolve(context.sessionID)
              if (evoTrigger) {
                runAutoEvolve(ctx).catch(() => { /* non-fatal */ })
              }
            } catch (e) { log.warn("Silent catch: non-fatal", { error: String(e) }) }

            // 5W1H Research Summary — inject findings into output
            if (researchReport) {
              const techStr = [...researchReport.techStack.frameworks, ...researchReport.techStack.languages, ...researchReport.techStack.databases].join(", ")
              const bpCount = researchReport.bestPractices.length
              const gapStr = researchReport.missingDimensions.length > 0 ? ` ⚠️ gaps: ${researchReport.missingDimensions.join(", ")}` : ""
              log.info(`[agentic_auto] 5W1H research: ${researchReport.findings.length} findings, ${bpCount} best practices${gapStr}`)
              if (techStr) log.info(`[agentic_auto] Tech stack: ${techStr}`)
            }

            // Phase 4A: Auto-mature skills that meet next-stage criteria
            try {
              const matureSummary = skillStore.autoMature()
              const matureKeys = Object.keys(matureSummary)
              if (matureKeys.length > 0) {
                // Log for observability
                const totalMatured = Object.values(matureSummary).reduce((a: number, b: number) => a + b, 0)
                if (totalMatured > 0) {
                  log.debug(`[auto] Auto-matured ${totalMatured} skills: ${JSON.stringify(matureSummary)}`)
                }
              }
            } catch (e) { log.warn("Silent catch: non-fatal", { error: String(e) }) }
          })().catch((err) => log.warn(`[agentic_auto] thorough post-processing error:`, err))
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
        const researchNote = researchReport
          ? `\n🔬 5W1H Research: ${researchReport.findings.length} findings, ${researchReport.bestPractices.length} best practices, stack: ${[...researchReport.techStack.frameworks, ...researchReport.techStack.languages, ...researchReport.techStack.databases].join(", ") || "auto-detected"}`
          : ""

        return {
          output: `## 🤖 Auto Complete\n\n**Goal:** ${args.goal}\n**Duration:** ${duration}s\n**Files:** ${allModified.length}\n**Verify:** ${verifyNote}${researchNote}${rolledBack}${memNote}${skillNote}${fileList}`,
          metadata: { result, success: allSuccess, plan, filesModified: allModified, episodes: memoryContexts.length, skills: skillContexts.length, rolledBack: hasGitRollback && !verifyPassed },
        }
      },
  }
}
