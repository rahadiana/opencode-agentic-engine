import { tool } from "@opencode-ai/plugin"
import type { ToolSpec } from "./types.js"
import type { ToolContext } from "./tool-context.js"
import { getSkillStore, getEpisodicStore, getConfigLoader } from "../core/shared-instances.js"

export function makeFinetuneTool(ctx: ToolContext): ToolSpec {
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
    worldModel, simulationEngine, dataCleaner, configLoader: _configLoader,
    logErrorToFile, detectSubAgentRole, buildSubAgentInjection, ctxDir,
  } = ctx
  const _debtScorer = techDebtScorer
  const _curator = skillCurator
  return {
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
      async execute(args: Record<string, unknown>, _ctx: Record<string, unknown>) {
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
        const skillStore = getSkillStore()
        const episodicStore = getEpisodicStore()

        // Helper: read fine-tuning config from configLoader
        const getFtConfig = () => {
          const cl = getConfigLoader()
          return (cl?.get?.()?.fineTuning ?? {}) as Record<string, unknown>
        }

        // Helper: create configured FineTuningClient
        const getClient = async (opts?: { model?: string }) => {
          const { FineTuningClient: FTC } = await import("../core/fine-tuning.js")
          const ftCfg = getFtConfig()
          const client = new FTC({
            apiKey: (ftCfg.apiKey as string) || undefined,
            baseURL: (ftCfg.baseURL as string) || undefined,
            model: opts?.model || (ftCfg.model as string) || undefined,
          })
          if (!client.isConfigured()) return null
          return client
        }

        switch (action) {
          case "prepare": {
            // Gather data
            const skills = skillStore?.getAll() ?? []
            const episodes = episodicStore?.getRecent(1000) ?? []

            let datasetStr: string
            let exampleCount: number

            if (source === "skills") {
              const { skillsToTrainingData } = await import("../memory/skill-training.js")
              const ds = skillsToTrainingData(skills, format, minQuality)
              datasetStr = ds.data
              exampleCount = ds.totalExamples
            } else if (source === "episodes") {
              const { episodesToTrainingData } = await import("../memory/skill-training.js")
              const ds = episodesToTrainingData(episodes, format, minQuality)
              datasetStr = ds.data
              exampleCount = ds.totalExamples
            } else {
              const { prepareFineTuningDataset } = await import("../memory/skill-training.js")
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

            const { saveTrainingDataToFile } = await import("../memory/skill-training.js")
            const skills = skillStore?.getAll() ?? []
            const episodes = episodicStore?.getRecent(1000) ?? []

            const { prepareFineTuningDataset } = await import("../memory/skill-training.js")
            const dataset = prepareFineTuningDataset(skills, episodes, format, minQuality)
            const savedPath = await saveTrainingDataToFile(dataset, outputPath)

            return {
              output: `Dataset saved to \`${savedPath}\`\n**Examples:** ${dataset.totalExamples}\n**Format:** ${format}`,
            }
          }

          case "upload": {
            const client = await getClient({ model })
            if (!client) return { output: "Error: OpenAI API key not configured. Set OPENAI_API_KEY env or fineTuning.apiKey in config." }

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
            } catch (err: unknown) {
              const errMsg = err instanceof Error ? err.message : String(err)
              return { output: `❌ Upload failed: ${errMsg}` }
            }
          }

          case "create-job": {
            if (!jobId) {
              return { output: "Error: 'jobId' (training file ID) is required for create-job." }
            }

            const client = await getClient({ model })
            if (!client) return { output: "Error: OpenAI API key not configured." }

            try {
                const ftCfg = getFtConfig()
                const job = await client.createJob(jobId, {
                  model: model || (ftCfg.model as string),
                  trainingEpochs: epochs || (ftCfg.trainingEpochs as number),
                  suffix: suffix || (ftCfg.suffix as string),
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
            } catch (err: unknown) {
              return { output: `❌ Create job failed: ${err instanceof Error ? err.message : String(err)}` }
            }
          }

          case "status": {
            if (!jobId) {
              return { output: "Error: 'jobId' is required for status action." }
            }

            const client = await getClient()
            if (!client) return { output: "Error: OpenAI API key not configured." }

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
            } catch (err: unknown) {
              return { output: `❌ Status check failed: ${err instanceof Error ? err.message : String(err)}` }
            }
          }

          case "list": {
            const client = await getClient()
            if (!client) return { output: "Error: OpenAI API key not configured." }

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
            } catch (err: unknown) {
              return { output: `❌ List jobs failed: ${err instanceof Error ? err.message : String(err)}` }
            }
          }

          case "cancel": {
            if (!jobId) {
              return { output: "Error: 'jobId' is required for cancel action." }
            }

            const client = await getClient()
            if (!client) return { output: "Error: OpenAI API key not configured." }

            try {
              const job = await client.cancelJob(jobId)
              return {
                output: `✅ Job ${job.id} cancelled. Status: ${job.status}`,
              }
            } catch (err: unknown) {
              return { output: `❌ Cancel failed: ${err instanceof Error ? err.message : String(err)}` }
            }
          }

          case "full-pipeline": {
            const { saveTrainingDataToFile, prepareFineTuningDataset } = await import("../memory/skill-training.js")

            const client = await getClient({ model })
            if (!client) return { output: "Error: OpenAI API key not configured. Set OPENAI_API_KEY env or fineTuning.apiKey in config." }

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
              const ftCfg = getFtConfig()
              const job = await client.createJob(file.id, {
                model: model || (ftCfg.model as string),
                trainingEpochs: epochs || (ftCfg.trainingEpochs as number),
                suffix: suffix || (ftCfg.suffix as string),
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
            } catch (err: unknown) {
              return { output: `❌ Pipeline failed at step: ${err instanceof Error ? err.message : String(err)}` }
            }
          }

          case "full-pipeline-wait": {
            const { saveTrainingDataToFile, prepareFineTuningDataset } = await import("../memory/skill-training.js")

            const client = await getClient({ model })
            if (!client) return { output: "Error: OpenAI API key not configured." }

            const skills = skillStore?.getAll() ?? []
            const episodes = episodicStore?.getRecent(1000) ?? []
            const savePath = outputPath ?? ".agentic/fine-tuning-data.jsonl"
            const dataset = prepareFineTuningDataset(skills, episodes, "openai", minQuality)
            await saveTrainingDataToFile(dataset, savePath)

            try {
              const ftCfg = getFtConfig()
              const result = await client.fullPipeline(savePath, {
                model: model || (ftCfg.model as string),
                trainingEpochs: epochs || (ftCfg.trainingEpochs as number),
                suffix: suffix || (ftCfg.suffix as string),
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
            } catch (err: unknown) {
              return { output: `❌ Full pipeline failed: ${err instanceof Error ? err.message : String(err)}` }
            }
          }

          default:
            return { output: "Unknown action. Available: prepare, save, upload, create-job, status, list, cancel, full-pipeline, full-pipeline-wait" }
        }
      },
  }
}
