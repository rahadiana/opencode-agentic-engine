import { tool } from "@opencode-ai/plugin"
import type { ToolSpec } from "./types.js"
import type { ToolContext } from "./tool-context.js"

export function makePrTool(ctx: ToolContext): ToolSpec {
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
        } catch (e) { log.warn("Silent catch: non-fatal — fall back to template", { error: String(e) }) }

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
  }
}
