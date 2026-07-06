import { tool } from "@opencode-ai/plugin"
import type { ToolSpec } from "./types.js"
import type { ToolContext } from "./tool-context.js"
import { getSchemaValidator } from "../core/shared-instances.js"

export function makePipelineTool(ctx: ToolContext): ToolSpec {
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
  return {
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
              schemaValidator: getSchemaValidator(),
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
  }
}
