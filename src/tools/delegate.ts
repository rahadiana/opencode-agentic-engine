import { tool } from "@opencode-ai/plugin"
import type { ToolSpec } from "./types.js"
import type { ToolContext } from "./tool-context.js"

export function makeDelegateTool(ctx: ToolContext): ToolSpec {
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

  async function executeBatchDelegate(
    tasks: Array<{ taskId: string; role: string; description: string; context?: string; dependsOn?: string[] }>,
    maxParallel: number,
    abortOnFailure: boolean,
    execCtx: { sessionID: string; directory?: string; worktree?: string },
  ) {
    const taskMap = new Map(tasks.map(t => [t.taskId, t]))
    const depGraph = new Map<string, string[]>()
    for (const t of tasks) depGraph.set(t.taskId, t.dependsOn?.filter(d => taskMap.has(d)) ?? [])
    const phases: string[][] = []
    const remaining = new Set(tasks.map(t => t.taskId))
    const completed = new Set<string>()
    while (remaining.size > 0) {
      const ready = [...remaining].filter(id => (depGraph.get(id) ?? []).every(d => completed.has(d)))
      if (ready.length === 0) { phases.push([...remaining]); break }
      phases.push(ready)
      for (const id of ready) { remaining.delete(id); completed.add(id) }
    }
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
            const agent = coordinator.getAgent(task.role as any)
            if (!agent) return { taskId, role: task.role, success: false, error: 'Unknown role "' + task.role + '"', durationMs: Date.now() - start }
            const sessionModelPref = sessionStore.getModelPreference(execCtx.sessionID, task.role)
            const relevantSkills = skillStore.find(task.description).slice(0, 3).map(s => ({
              name: s.definition.meta.name, successRate: s.successRate,
              steps: s.definition.workflow.steps.map(st => st.action + ': ' + st.description).join('; '),
            }))
            coordinator.delegate(task.role as any, { id: taskId, assignedTo: task.role, description: task.description, input: task.context ?? task.description, status: 'running' }, execCtx.sessionID, 0, relevantSkills)
            eventBus.emit({ type: 'task.delegated', payload: { sessionID: execCtx.sessionID, taskId, role: task.role, description: task.description, delegationDepth: 0 } })
            const agentCtx = {
              systemPrompt: agent.prompt ?? 'You are a ' + task.role + ' in a software engineering team.',
              sessionId: execCtx.sessionID, role: task.role as any,
              taskDescription: task.context ?? task.description,
              modelPreference: sessionModelPref || undefined,
            }
            const resultObj = await agentRuntime.execute(agentCtx)
            const ok = resultObj.success ? resultObj.output : null
            const err = resultObj.success ? null : (resultObj.error ?? 'Agent execution failed')
            if (ok) { await coordinator.updateTask(execCtx.sessionID, taskId, 'done', ok); await coordinator.writeSharedMemory('task:' + taskId, ok.slice(0, 500), task.role) }
            else { await coordinator.updateTask(execCtx.sessionID, taskId, 'failed', err ?? 'Unknown error') }
            return { taskId, role: task.role, success: !!ok, result: ok ?? undefined, error: err ?? undefined, durationMs: Date.now() - start }
          } catch (e) {
            return { taskId, role: task.role, success: false, error: (e as Error).message, durationMs: Date.now() - start }
          }
        })
        const settled = await Promise.allSettled(promises)
        for (const s of settled) {
          if (s.status === 'fulfilled') { allResults.push(s.value); if (abortOnFailure && !s.value.success) aborted = true }
          else { allResults.push({ taskId: 'unknown', role: 'unknown', success: false, error: 'Task crashed: ' + s.reason, durationMs: 0 }) }
        }
      }
    }
    const passed = allResults.filter(r => r.success).length
    let output = '## ⚡ Batch Delegate Complete\n\n'
    output += '**Total:** ' + allResults.length + ' tasks | **Passed:** ' + passed + ' | **Failed:** ' + (allResults.length - passed) + '\n'
    output += '**Max Parallel:** ' + maxParallel
    if (phases.length > 1) output += ' | **Phases:** ' + phases.length
    output += '\n\n'
    for (const r of allResults) {
      output += (r.success ? '✅' : '❌') + ' **' + r.taskId + '** (' + r.role + ') -- ' + (r.durationMs / 1000).toFixed(1) + 's\n'
      if (r.result) output += '   Result: ' + r.result.slice(0, 200) + '\n'
      if (r.error) output += '   Error: ' + r.error.slice(0, 200) + '\n'
    }
    traceLogger.log({ step: 'delegate:batch', input: allResults.length + ' tasks', output: passed + '/' + allResults.length + ' passed', toolUsed: 'agentic_delegate', success: passed === allResults.length, durationMs: allResults.reduce((s, r) => s + r.durationMs, 0) / allResults.length })
    return { output }
  }

  return {
      description: "Assign a task to a specialized agent role (architect/developer/qa/coordinator/pm). Supports pipeline-aware delegation with cross-validation between stages, inter-agent messaging, and batch parallel fan-out delegation for multiple agents.",
      args: {
        taskId: tool.schema.string().optional().describe("Unique ID for this delegated task (required for single mode)"),
        description: tool.schema.string().optional().describe("What this agent should do (required for single mode)"),
        role: tool.schema.enum(["architect", "developer", "qa", "coordinator", "pm"]).optional().describe("Target role (auto-detected if omitted)"),
        context: tool.schema.string().optional().describe("Additional context or instructions for the agent"),
        pipelineRunId: tool.schema.string().optional().describe("Pipeline run ID (format: `run-{sessionID}-{pipelineId}`). Links this task into the ID chain: sessionID ⊃ pipelineRunId ⊃ taskId ⊃ stepId"),
        result: tool.schema.string().optional().describe("Task result (set when completing a task to trigger downstream stages and cross-validation)"),
        status: tool.schema.enum(["pending", "running", "done", "failed"]).optional().describe("Set the task status"),
        requestReview: tool.schema.boolean().optional().describe("Request review from a downstream role after completing this task"),
        reasoningEffort: tool.schema.enum(["low", "medium", "high"]).optional().describe("Reasoning effort untuk model yg support (OpenAI o-series, GPT-5). low=cepat, medium=balance, high=mendalam."),
        tasks: tool.schema.array(tool.schema.object({
          taskId: tool.schema.string().describe("Unique ID for this delegated task"),
          role: tool.schema.enum(["architect", "developer", "qa", "coordinator", "pm"]).describe("Target role"),
          description: tool.schema.string().describe("What this agent should do"),
          context: tool.schema.string().optional().describe("Additional context or instructions"),
          dependsOn: tool.schema.array(tool.schema.string()).optional().describe("Task IDs this task depends on (creates execution phases)"),
        })).optional().describe("Array of tasks for batch parallel fan-out delegation. Runs independent tasks concurrently via Promise.allSettled."),
        maxParallel: tool.schema.number().optional().describe("Maximum parallel agents per phase (fan-out cap, default: 2). SDK session limit is ~2-3 concurrent prompts; higher values cause queued timeout."),
        abortOnFailure: tool.schema.boolean().optional().describe("Stop all tasks in phase if one fails (default: false)"),
      },
      async execute(args, context) {
        const delegateStartTime = Date.now()
        // ── Batch mode: multiple tasks in parallel (fan-out) ──
        if (args.tasks && Array.isArray(args.tasks) && args.tasks.length > 0) {
          // If user also passed single-mode params (taskId+description+role),
          // merge it into the batch so nothing gets silently dropped.
          let mergedTasks = args.tasks
          if (args.taskId && args.description) {
            const singleTask = { taskId: args.taskId, role: args.role ?? 'developer', description: args.description, context: args.context }
            mergedTasks = [singleTask, ...args.tasks]
          }
          return executeBatchDelegate(mergedTasks, args.maxParallel ?? 2, args.abortOnFailure ?? false, context)
        }

        // ── Single mode ──

        // Update/completion path: only needs taskId + result/status
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

        // Full delegation flow: description is required
        if (!args.description) {
          return { output: "❌ For single delegation, provide `description`. For batch parallel delegation, use `tasks` array." }
        }

        // Normal delegation flow (LLM-based role suggestion, Gap #6)
        const role = args.role ?? await coordinator.getSuggestedRole(args.description, llmEngine)
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

        // Emit delegation event so SecondBrain can track delegated tasks
        eventBus.emit({
          type: "task.delegated",
          payload: {
            sessionID: context.sessionID,
            taskId: args.taskId,
            role,
            description: args.description,
            pipelineRunId: args.pipelineRunId,
            delegationDepth: 0,
          },
        })

        // Build pipeline context if part of a pipeline run
        let pipelineContext = ""
        if (args.pipelineRunId) {
          pipelineContext = orchestrator.buildContextForRole(role, args.pipelineRunId, coordinator.getAllSharedMemory())
        }

        // Check for pending messages for this role
        const pendingMessages = coordinator.getMessages(role, true)

        // ── Compress shared memory — avoid bloat ──
        const allShared = coordinator.getAllSharedMemory()
        const compressedShared = allShared
          .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0)) // terbaru dulu
          .slice(0, 20) // max 20 entry
          .map(e => ({ key: e.key, value: e.value.slice(0, 300), writtenBy: e.writtenBy }))

        // ── Actual Agent Execution via Isolated AgentRuntime ──
        const sessionModelPref = sessionStore.getModelPreference(context.sessionID, role)
        const agentCtx = {
          systemPrompt: agent.prompt ?? `You are a ${role} in a software engineering team.`,
          sessionId: context.sessionID,
          role,
          taskDescription: contextWithMemory,
          pipelineContext: pipelineContext || undefined,
          pendingMessages: pendingMessages.length > 0 ? pendingMessages.map(m => ({ from: m.from, payload: m.payload })) : undefined,
          sharedMemory: compressedShared,
          modelPreference: sessionModelPref || undefined,
          reasoningEffort: args.reasoningEffort || undefined,
        }
        const agentResultObj = await agentRuntime.executeWithVisibleDelegation(agentCtx)
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

        output += `\n### Active Tasks (${coordinator.getTasks(context.sessionID).length})\n`
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

        // WorkflowEngine: auto-chain delegation events
        workflowEngine.relayDelegation(context.sessionID, args.taskId, role, !!agentResult, agentResult, args.pipelineRunId)

        traceLogger.log({
          step: "delegate",
          input: args.taskId,
          output: `→ ${role}: ${agentResult ? "done" : "failed"}`,
          toolUsed: "agentic_delegate",
          success: !!agentResult,
          durationMs: Date.now() - delegateStartTime,
        })

        return { output }
      },
  }
}
