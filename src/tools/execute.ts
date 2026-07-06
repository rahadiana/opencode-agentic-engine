import { tool } from "@opencode-ai/plugin"
import type { ToolSpec } from "./types.js"
import type { ToolContext } from "./tool-context.js"
import type { ConfidenceScore } from "../core/confidence-scorer.js"
import { join } from "node:path"
import { readFileSync } from "node:fs"
import { detectTaskType } from "../core/task-classifier.js"
import { evaluateWorkflowPolicy, formatWorkflowPolicyDecisions, verificationEvidenceFailed } from "../core/workflow-policy.js"

export function makeExecuteTool(ctx: ToolContext): ToolSpec {
  const {
    sessionStore, domainRegistry, worktree, projectId, config,
    log, projectContext, TOOL_REGISTRY, currentInjectDomain,
    planner, plannerCritic, executor, intentParser, agentLoop,
    verifier, errorAnalyzer, _errorRecovery, alignmentGate,
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
  const debtScorer = techDebtScorer
  const curator = skillCurator

  function evidenceToSignals(evidence?: { build?: string; lint?: string; techDebt?: string; tests?: Array<{ command?: string; passed?: number; failed?: number }> }): Partial<import("../core/confidence-scorer.js").ScoringSignals> {
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
      techDebtScore: evidence.techDebt ? { overall: evidence.techDebt as "low" | "medium" | "high" | "critical" } : undefined,
    }
  }

  return {
      description: "Record completion of a subtask. Auto-verifies compilation on success. Includes error recovery guidance + error propagation analysis on failure. Supports user feedback for continuous learning.",
      args: {
        stepId: tool.schema.string().describe("The ID of the step that was executed (leaf in ID chain: sessionID ⊃ pipelineRunId ⊃ taskId ⊃ stepId)"),
        success: tool.schema.boolean().describe("Whether the step completed successfully"),
        output: tool.schema.string().describe("Summary of what was done — what files changed, what was implemented"),
        filesModified: tool.schema.array(tool.schema.string()).optional().describe("List of files that were modified or created in this step"),
        error: tool.schema.string().optional().describe("Error message if the step failed"),
        autoVerify: tool.schema.boolean().optional().describe("Auto-run compile verification (default: true when success=true)"),
        feedback: tool.schema.enum(["positive", "negative"]).optional().describe("User feedback on the result. Positive boosts skill confidence; negative triggers adaptation (Gap #9: continuous learning from feedback)"),
        verificationEvidence: tool.schema.object({
          build: tool.schema.enum(["passed", "failed", "skipped"]).optional().describe("Manual build result to sync agentic_status/confidence"),
          lint: tool.schema.enum(["passed", "failed", "skipped"]).optional().describe("Manual lint result to sync agentic_status/confidence"),
          techDebt: tool.schema.enum(["low", "medium", "high", "critical"]).optional().describe("Manual tech-debt score to sync confidence"),
          tests: tool.schema.array(tool.schema.object({
            command: tool.schema.string().optional(),
            passed: tool.schema.number().optional(),
            failed: tool.schema.number().optional(),
          })).optional().describe("Manual test summaries, e.g. [{ command, passed, failed }]"),
        }).optional().describe("Optional verification evidence from manual shell commands so agentic_status stays in sync"),
      },
      async execute(args, context) {
        const startTime = Date.now()
        const projectDir = ctxDir(context)

        const domainPack = domainRegistry.activateFor(args.output)
        if (domainPack) {
          const prevDomain = sessionStore.getOrCreate(context.sessionID).currentDomain
          sessionStore.getOrCreate(context.sessionID).currentDomain = domainPack.name
        }
        
        const taskType = detectTaskType(args.output)
        
        const session = sessionStore.getOrCreate(context.sessionID)
        session.currentTaskType = taskType
        const agentCfg = configLoader.get().agent
        const workflowPolicyMode = agentCfg.dumbModelMode ? "strict" : (agentCfg.workflowPolicyMode ?? "advisory")
        const priorState = executor.getStepState(context.sessionID, args.stepId)
        const isRetry = !!priorState?.result && !priorState.result.success && args.success
        const prePolicyDecisions = evaluateWorkflowPolicy({
          action: isRetry ? "retry" : "execute",
          stepId: args.stepId,
          filesModified: args.filesModified ?? [],
          success: args.success,
          hasPlan: !!session.plan,
          hasResearch: session.artifacts.has("workflow:researched"),
          hasReflection: session.artifacts.has(`workflow:reflected:${args.stepId}`),
          hasVerificationEvidence: !!args.verificationEvidence,
          verificationEvidenceFailed: verificationEvidenceFailed(args.verificationEvidence),
        }, { mode: workflowPolicyMode })
        const completedSteps = executor.getCompletedSteps(context.sessionID)
        const willFinalize = !!(args.success && session.plan?.intent.subtasks.every(s => s.id === args.stepId || completedSteps.includes(s.id)))
        const preFinalPolicyDecisions = willFinalize ? evaluateWorkflowPolicy({
          action: "finalize",
          stepId: args.stepId,
          filesModified: [...executor.getAllFilesModified(context.sessionID), ...(args.filesModified ?? [])],
          success: true,
          hasPlan: !!session.plan,
          hasResearch: session.artifacts.has("workflow:researched"),
          hasVerificationEvidence: !!args.verificationEvidence || session.artifacts.has("workflow:verified"),
          verificationEvidenceFailed: verificationEvidenceFailed(args.verificationEvidence),
        }, { mode: workflowPolicyMode }) : []
        const blockingPolicyDecisions = [...prePolicyDecisions, ...preFinalPolicyDecisions]
        const blocked = prePolicyDecisions.some(d => d.severity === "block")
          || preFinalPolicyDecisions.some(d => d.severity === "block")
        if (blocked) {
          return {
            output: `## Step ${args.stepId}: 🛑 BLOCKED by WorkflowPolicy\n\n${formatWorkflowPolicyDecisions(blockingPolicyDecisions)}\n\nFix the evidence/workflow issue, then call \`agentic_execute\` again.`,
            metadata: { blocked: true, policy: blockingPolicyDecisions },
          }
        }

        if (args.filesModified && args.filesModified.length > 0) {
          depTracker.recordChange(context.sessionID, args.stepId, args.filesModified)
          // Update file-level dependency graph for modified/created files
          for (const f of args.filesModified) {
            const absPath = join(projectDir, f)
            try {
              const content = readFileSync(absPath, "utf-8")
              depTracker.updateFile(absPath, content, projectDir)
            } catch (e) { log.warn("Silent catch: non-fatal: file may have been deleted", { error: String(e) }) }
          }
        }

        // Gap #2b: Execution Trace — begin step tracking
        const traceId = `exec-${context.sessionID}`
        const session_ = sessionStore.getOrCreate(context.sessionID)
        const goal = session_.plan?.intent?.goal ?? args.output.slice(0, 100)
        memoryOrchestrator.beginStep(traceId, context.sessionID, goal, args.stepId, args.output.slice(0, 200))

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
        const prePolicyText = formatWorkflowPolicyDecisions(prePolicyDecisions)
        if (prePolicyText) response += `\n### WorkflowPolicy\n${prePolicyText}\n`

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

              const dumbMode = configLoader.get().agent.dumbModelMode ?? false
              const threshold = dumbMode ? Math.min(configLoader.get().agent.hallucinationThreshold, 0.2) : configLoader.get().agent.hallucinationThreshold
              const blockEnabled = dumbMode || configLoader.get().agent.blockOnHallucination
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
          const signals: import("../core/confidence-scorer.js").ScoringSignals = {
            stepId: args.stepId,
            modelName: modelId && modelId !== "unknown" ? modelId : undefined,
            compileResult: verifyResult ? { passed: verifyResult.passed, output: verifyResult.checks.map(c => c.output).join("\n") } : undefined,
            guardResult: guardResult ? { passed: guardResult.passed, claims: guardResult.claims } : undefined,
            testResult: undefined,
            lintResult: verifyResult?.checks.find(c => c.name === "lint") ? { passed: verifyResult.checks.find(c => c.name === "lint")!.passed } : undefined,
          }
          Object.assign(signals, evidenceToSignals(args.verificationEvidence))
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

        // ── Gap #10: Alignment Check (auto-detect goal drift) ──
        if (args.success && args.filesModified && args.filesModified.length > 0) {
          const session_ = sessionStore.getOrCreate(context.sessionID)
          const originalGoal = session_.plan?.intent?.goal ?? args.output
          const alignmentResult = alignmentGate.checkAlignment(originalGoal, args.output, args.filesModified)
          if (alignmentResult.driftDetected) {
            response += `\n### 🎯 Alignment Check (Gap #10)\n`
            response += `**Overall:** ${Math.round(alignmentResult.overallScore * 100)}% aligned\n`
            for (const c of alignmentResult.checks) {
              const icon = c.severity === "aligned" ? "✅" : c.severity === "drift_warning" ? "⚠️" : "❌"
              response += `${icon} ${c.description}\n`
            }
            if (alignmentResult.recommendations.length > 0) {
              response += "\n**Recommendations:**\n" + alignmentResult.recommendations.map(r => `- ${r}`).join("\n") + "\n"
            }
            if (!alignmentResult.passed) {
              response += "\n⚠️ **Alignment check failed** — consider reviewing the step output against the original goal.\n"
            }
          }
        }

        // ── Gap #11: Economic Model — record outcome ──
        if (args.filesModified && args.filesModified.length > 0) {
          economicModel.recordOutcome({
            taskId: args.stepId,
            cost: 0, // budgetTracker tracks actual cost; placeholder for now
            durationMs: Date.now() - startTime,
            steps: 1,
            success: args.success ?? false,
            qualityScore: confidenceScore_?.overall,
            timestamp: Date.now(),
          })

          // Record cost from budget tracker if available
          const budgetState = budgetTracker.getState(["session"])
          if (budgetState[0]) {
            economicModel.recordOutcome({
              taskId: args.stepId,
              cost: budgetState[0].usage.totalCostUsd,
              durationMs: Date.now() - startTime,
              steps: 1,
              success: args.success ?? false,
              qualityScore: confidenceScore_?.overall,
              timestamp: Date.now(),
            })
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

          // Emit step.retrying event when retries are available
          if (retriesUsed > 0) {
            eventBus.emit({
              type: "step.retrying",
              payload: {
                sessionID: context.sessionID,
                stepId: args.stepId,
                attempt: retriesUsed + 1,
                maxRetries: maxAllowed,
                previousError: args.error ?? analysis.likelyRootCause ?? "",
                suggestedFix: analysis.suggestedFix,
              },
            })
          }

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
                        response += `  • ${err.path}: ${err instanceof Error ? err.message : String(err)}\n`
                      }
                    } else {
                      response += `✅ Input schema validated\n`
                    }
                  } catch (e) { log.warn("Silent catch: non-fatal", { error: String(e) }) }
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
                        response += `  • ${err.path}: ${err instanceof Error ? err.message : String(err)}\n`
                      }
                    } else {
                      response += `✅ Output schema validated\n`
                    }
                  } catch (e) { log.warn("Silent catch: non-fatal — output may not be JSON", { error: String(e) }) }
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
            } catch (e) { log.warn("Silent catch: non-fatal", { error: String(e) }) }
          }
        }

        // ── Execution Trace: complete step ──
        {
          const traceId = `exec-${context.sessionID}`
          const trace = memoryOrchestrator.getExecutionTrace(traceId)
          const stepConfidence = confidenceStore.get(args.stepId)
          memoryOrchestrator.completeStep(
            traceId,
            args.stepId,
            args.success ? "success" : "failed",
            args.error,
            stepConfidence?.score,
          )
          if (trace) {
            const modelId_ = llmEngine.getCurrentModel()
            if (modelId_ && !trace.modelUsed) trace.modelUsed = modelId_
            const budgetStates = budgetTracker.getState(["session"])
            const budgetData = budgetStates.length > 0 ? budgetStates[0] : undefined
            if (budgetData) {
              trace.tokensUsed = budgetData.usage.totalTokens
              trace.costUsd = budgetData.usage.totalCostUsd
            }
          }
        }

        const progress = executor.getProgress(context.sessionID)
        const nextStep = executor.getNextStep(context.sessionID)

        if (args.success && !nextStep) {
          const finalPolicyDecisions = evaluateWorkflowPolicy({
            action: "finalize",
            stepId: args.stepId,
            filesModified: executor.getAllFilesModified(context.sessionID),
            success: true,
            hasPlan: !!session.plan,
            hasResearch: session.artifacts.has("workflow:researched"),
            hasVerificationEvidence: !!args.verificationEvidence || !!verifyResult?.passed || session.artifacts.has("workflow:verified"),
            verificationEvidenceFailed: verificationEvidenceFailed(args.verificationEvidence),
            confidence: confidenceScore_?.overall,
          }, { mode: workflowPolicyMode })
          const finalPolicyText = formatWorkflowPolicyDecisions(finalPolicyDecisions)
          if (finalPolicyText) response += `\n### WorkflowPolicy Final Gate\n${finalPolicyText}\n`
        }

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

          // Emit feedback event for Second Brain + observability
          eventBus.emit({
            type: "feedback.recorded",
            payload: {
              sessionID: context.sessionID,
              stepId: args.stepId,
              feedback: args.feedback,
              model: currentModel ?? "unknown",
              taskType: taskType ?? "unknown",
              errorCategory: isPositive ? undefined : "unknown",
            },
          })
          if (currentModel && taskType) {
            modelRegistry.recordUserFeedback(currentModel, taskType, isPositive)
            // Persist immediately so feedback survives restart
            stateStore.set("models", "registry", modelRegistry.toJSON())
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
              stateStore.set("skills", skill.definition.meta.id, skill.definition)
            } else {
              // Penalize: report failure
              skillStore.reportFailure(skill.definition.meta.id)
              // Curator: mark skill for review
              curator.handleNegativeFeedback(skill.definition.meta.name)
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
                const evolveSummary = await runAutoEvolve(ctx)
                response += `  ${evolveSummary.replace(/\n/g, "\n  ")}\n`
              } catch (e) {
                response += `  ⚠️ Auto-evolution encountered an error: ${(e as Error).message}\n`
              }
            }
          }
        }

        // WorkflowEngine: auto-chain step events
        const chainResult = workflowEngine.relayStep(
          context.sessionID, args.stepId, args.success, args.output,
          args.filesModified ?? [], args.error, Date.now() - startTime,
        )
        if (chainResult.nextSteps.length > 0) {
          response += `\n### 🔗 Auto-Chain\nNext ready step(s): \`${chainResult.nextSteps.join("`, `")}\`\n`
        }
        if (chainResult.recoverySteps.length > 0) {
          response += `\n### 🔄 Recovery Available\nRetry #${chainResult.recoverySteps.length} — call \`agentic_reflect\` to diagnose before retrying.\n`
        }
        // Auto-chain fallback: suggest next tool even without a plan
        if (chainResult.nextSteps.length === 0 && chainResult.recoverySteps.length === 0) {
          if (args.success && !session.plan) {
            response += `\n### 💡 Suggested Next\nVerify quality: \`agentic_verify\` or check status: \`agentic_status\`\n`
          } else if (!args.success) {
            response += `\n### 💡 Suggested Next\nDiagnose failure: \`agentic_reflect stepId="${args.stepId}"\`\n`
          }
        }

        // ── Curator: periodic lifecycle maintenance (every ~10 successful executions) ──
        if (args.success && curator.getConfig().enabled) {
          try {
            // ponytail: simple modulo counter — no persistent state needed
            const execCount = executor.getExecutionCount(context.sessionID) ?? 0
            if (execCount > 0 && execCount % 10 === 0) {
              const lifecycleReport = curator.applyLifecycle()
              if (lifecycleReport.markedStale > 0 || lifecycleReport.archived > 0) {
                response += `\n### 🧠 Skill Curator\n`
                response += `Checked ${lifecycleReport.checked} skills: ${lifecycleReport.markedStale} marked stale, ${lifecycleReport.archived} archived, ${lifecycleReport.reactivated} reactivated.\n`
              }
            }
          } catch (e) { log.warn("Silent catch: curator lifecycle is best-effort", { error: String(e) }) }
        }

        return { output: response, metadata: { progress, nextStep: nextStep?.id, verifyResult } }
      },
  }
}
