/**
 * agentic_status — Execution dashboard.
 *
 * Extracted from src/index.ts to reduce monolith.
 * Shows progress, health, blocked steps, model reliability,
 * and optionally full observability (timeline, anomalies, etc.).
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { tool } from "@opencode-ai/plugin"
import type { ToolSpec } from "./types.js"
import type { ToolContext } from "./tool-context.js"
import type { TraceEntry } from "../observability/trace-logger.js"

export function makeStatusTool(ctx: ToolContext): ToolSpec {
  return {
    description:
      "Show execution dashboard: progress bar, health, blocked steps, dependency graph, retry history, file change summary. Use detail='full' for comprehensive observability (timeline, anomalies, model reliability, cross-session patterns).",
    args: {
      detail: tool.schema.enum(["basic", "full"]).optional().describe("'basic' (default) shows execution status; 'full' includes comprehensive observability dashboard with trace timeline, anomalies, cross-session patterns, gap analysis"),
    },
    async execute(args, context) {
      const detail = (args as { detail?: string }).detail
      const {
        sessionStore,
        executor,
        modelRegistry,
        traceLogger,
        worktree,
        dashboard,
        skillStore,
        constraintManifold,
        llmEngine,
        eventBus,
        workflowEngine,
        episodicStore,
        patternDiscovery,
        liveEvaluator,
        errorRecovery,
        alignmentGate,
        economicModel,
        toolUsageTracker,
        coordinator,
        continuousEvolution,
        confidenceStore,
        worldModel,
        log,
        configLoader,
      } = ctx

      // ── If detail='full', run comprehensive dashboard ──
      if (detail === "full") {
        const modelReliability = modelRegistry.getSummary()
        let traceSection = ""

        await traceLogger.flush()
        const tracePath = join(worktree, ".agentic", "trace.jsonl")
        let traces: Record<string, unknown>[] = []
        try {
          const content = readFileSync(tracePath, "utf-8")
          traces = content.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
        } catch (e) {
          log.warn("Silent catch: no traces yet", { error: String(e) })
        }

        if (traces.length > 0) {
          const data = dashboard.generate(
            traces as unknown as TraceEntry[],
            Date.now(),
            {
              skillStore: {
                getAll: () => skillStore.getAll(),
                getLifecycleStats: () => skillStore.getLifecycleStats(),
                get size() {
                  return skillStore.size
                },
              },
              constraintManifold: {
                snapshot: () => constraintManifold.snapshot(),
                getActiveModifications: () => constraintManifold.getActiveModifications(),
                getRecentViolations: () => constraintManifold.getRecentViolations(),
              },
              semanticCacheStats: llmEngine.getSemanticCacheStats(),
              modelRegistry: {
                getAllScores: () => modelRegistry.getAllScores(),
              },
            },
          )
          traceSection = dashboard.formatForDisplay(data)
        }

        let output = traceSection || "### 📊 Execution Overview\n\nNo trace data available yet. Execute some steps first.\n"

        // EventBus observability stats
        const eventHistory = eventBus.getHistory()
        const eventTypes = new Map<string, number>()
        for (const ev of eventHistory) {
          eventTypes.set(ev.type, (eventTypes.get(ev.type) ?? 0) + 1)
        }
        if (eventTypes.size > 0) {
          output += `\n### 🔌 Event Bus (${eventHistory.length} events, ${eventTypes.size} types)\n`
          const sorted = [...eventTypes.entries()].sort((a, b) => b[1] - a[1])
          for (const [type, count] of sorted.slice(0, 10)) {
            output += `- \`${type}\`: ${count}x\n`
          }
          output += `**Subscribers:** ${eventBus.subscriberCount}\n`
        }

        const weStatus = workflowEngine.getStatus()
        output += `\n### 🔗 Workflow Engine\n`
        output += `**Retry entries:** ${weStatus.retryEntries}\n`

        output += `\n### 🤖 Model Reliability\n${modelReliability}\n`
        // Dumb-model harness status (auto / forced)
        try {
          const { resolveDumbHarness, workflowModeForDumb } = await import("../core/dumb-model.js")
          const agentCfg = configLoader.get().agent
          const modelId = llmEngine.getCurrentModel()
          const dumb = resolveDumbHarness({
            dumbModelMode: agentCfg.dumbModelMode,
            model: modelId,
            modelRegistry,
            softBlockReliability: agentCfg.softBlockReliability,
            minSampleSize: agentCfg.minSampleSize,
          })
          const wf = workflowModeForDumb(dumb, agentCfg.workflowPolicyMode)
          output += `\n### 🛡️ Dumb-Model Harness\n`
          output += `**Status:** ${dumb.active ? "ACTIVE" : "off"} (${dumb.source})\n`
          output += `**Config:** \`${JSON.stringify(agentCfg.dumbModelMode ?? "auto")}\`\n`
          output += `**Model:** \`${modelId ?? "unknown"}\`\n`
          output += `**Reason:** ${dumb.reason}\n`
          output += `**WorkflowPolicy:** \`${wf}\` · blockOnHallucination effective: \`${dumb.active || !!agentCfg.blockOnHallucination}\`\n`
        } catch (e) { log.warn("Silent catch: dumb harness status", { error: String(e) }) }

        try {
          const ocModels = await llmEngine.listOpenCodeModels()
          if (ocModels.length > 0) {
            output += `\n### 🧠 Available Models (from OpenCode)\n`
            const byProvider = new Map<string, string[]>()
            for (const m of ocModels) {
              const list = byProvider.get(m.providerName) ?? []
              list.push(`\`${m.id}\``)
              byProvider.set(m.providerName, list)
            }
            for (const [provider, models] of byProvider) {
              output += `- **${provider}**: ${models.join(", ")}\n`
            }
          }
        } catch (e) {
          log.warn("Silent catch: silent", { error: String(e) })
        }

        const allEpisodes = episodicStore.getRecent(200)
        if (allEpisodes.length >= 3) {
          const allSkills = skillStore.getAll().map((s) => ({
            name: s.definition.meta.name,
            successRate: s.successRate,
            usageCount: s.usageCount,
          }))
          const report = patternDiscovery.analyze(allEpisodes, [], allSkills)
          if (report.errorPatterns.length > 0 || report.recommendations.length > 0) {
            output += `\n### 🔍 Cross-Session Patterns (${report.totalSessions} sessions)\n`
            if (report.errorPatterns.length > 0) {
              output += `\n**Recurring Errors:**\n`
              for (const ep of report.errorPatterns.slice(0, 3)) {
                output += `- \`${ep.category}\`: ${ep.sessionCount}/${report.totalSessions} sessions (${(ep.sessionAffinity * 100).toFixed(0)}%)\n`
              }
            }
            if (report.filePatterns.some((f) => f.isHotSpot)) {
              output += `\n**Hot Spot Files:**\n`
              for (const fp of report.filePatterns.filter((f) => f.isHotSpot).slice(0, 3)) {
                output += `- \`${fp.filePath}\`: modified in ${fp.sessionCount} sessions`
                if (fp.coChangedFiles.length > 0) {
                  output += ` (co-changes: ${fp.coChangedFiles.slice(0, 2).map((c) => `\`${c.filePath}\``).join(", ")})`
                }
                output += "\n"
              }
            }
            if (report.recommendations.length > 0) {
              const highRecs = report.recommendations.filter((r) => r.priority === "high")
              if (highRecs.length > 0) {
                output += `\n**⚠️ High Priority Recommendations:**\n`
                for (const rec of highRecs.slice(0, 3)) {
                  output += `- ${rec.description}\n`
                }
              }
            }
          }
        }

        const liveScore = liveEvaluator.computeScore()
        if (liveScore.totalSteps > 0 || liveScore.totalDelegations > 0) {
          output += `\n### 📊 Live Evaluation Score\n`
          output += liveEvaluator.formatReport(false)
        }

        output += `\n### 🩺 Error Recovery (Gap #5)\n`
        output += `${errorRecovery.getSummary()}\n`
        output += `\n### 🎯 Alignment (Gap #10)\n`
        output += `${alignmentGate.getSummary()}\n`
        output += `\n### 💰 Economics (Gap #11)\n`
        output += `${economicModel.getSummary()}\n`

        const toolStats = toolUsageTracker.getStats()
        if (toolStats.length > 0) {
          output += `\n### 🛠️ Tool Effectiveness\n`
          output += `| Tool | Calls | Success | Rate | Avg (ms) |\n`
          output += `|------|-------|---------|------|----------|\n`
          for (const s of toolStats.slice(0, 10)) {
            output += `| ${s.toolName} | ${s.totalCalls} | ${s.successCount} | ${(s.successRate * 100).toFixed(0)}% | ${s.avgDurationMs} |\n`
          }
        }

        return { output }
      }

      // ── Default: basic execution status ──
      const progress = executor.getProgress(context.sessionID)
      const nextStep = executor.getNextStep(context.sessionID)
      const blockedSteps = executor.getBlockedSteps(context.sessionID)
      const isComplete = executor.isComplete(context.sessionID)
      const isHealthy = executor.isHealthy(context.sessionID)
      const allFiles = executor.getAllFilesModified(context.sessionID)

      let output = "## 📊 Execution Dashboard\n\n"

      if (progress.total > 0) {
        const pct = Math.min(100, Math.round((progress.completed / progress.total) * 100))
        const barLen = 20
        const filled = Math.min(barLen, Math.round((pct / 100) * barLen))
        output += "```\n" + "[" + "█".repeat(filled) + "░".repeat(barLen - filled) + "] " + pct + "%\n" + "```\n"
      }

      output += `**Health:** ${isHealthy ? "✅ All passing" : "⚠️ Errors"}\n`
      output += `**Status:** ${isComplete ? "🎉 Complete" : "⏳ In progress"}\n\n`
      output += "| Status | Count |\n|--------|-------|\n"
      output += `| ✅ Done | ${progress.completed} |\n`
      output += `| ❌ Failed | ${progress.failed} |\n`
      output += `| 🔒 Blocked | ${progress.blocked} |\n`

      if (nextStep) {
        output += `\n### Next Ready\n▶ **${nextStep.id}** — ${nextStep.description}\n`
      }

      if (blockedSteps.length > 0) {
        output += "\n### 🔒 Blocked Steps\n"
        for (const b of blockedSteps) {
          output += `- **${b.id}** — ${b.description}\n`
          output += `  Waiting on: ${b.blockedBy.map((d: string) => `\`${d}\``).join(", ")}\n`
        }
      }

      if (allFiles.length > 0) {
        output += "\n### 📁 Files Modified\n"
        output += allFiles.map((f: string) => `- \`${f}\``).join("\n") + "\n"
      }

      // Delegated task status
      const delegatedTasks = coordinator.getTasks(context.sessionID)
      if (delegatedTasks.length > 0) {
        const running = delegatedTasks.filter((t: { status: string }) => t.status === "running")
        const done = delegatedTasks.filter((t: { status: string }) => t.status === "done")
        const failed = delegatedTasks.filter((t: { status: string }) => t.status === "failed")
        const pending = delegatedTasks.filter((t: { status: string }) => t.status === "pending" || !t.status)
        if (running.length > 0 || done.length > 0 || failed.length > 0 || pending.length > 0) {
          output += `\n### 🤖 Delegated Tasks (${delegatedTasks.length})\n`
          output += "| Status | Count |\n|--------|-------|\n"
          output += `| ⏳ Running | ${running.length} |\n`
          output += `| ✅ Done | ${done.length} |\n`
          output += `| ❌ Failed | ${failed.length} |\n`
          output += `| ⏸️ Pending | ${pending.length} |\n\n`
          for (const t of delegatedTasks.slice(0, 10)) {
            const icon = t.status === "done" ? "✅" : t.status === "failed" ? "❌" : t.status === "running" ? "⏳" : "⏸️"
            output += `${icon} **${t.id}** → ${t.assignedTo}: ${t.description.slice(0, 80)}\n`
          }
          if (delegatedTasks.length > 10) output += `... and ${delegatedTasks.length - 10} more\n`
        }
      }

      output += "\n### 🤖 Model Reliability\n"
      output += modelRegistry.getSummary() + "\n"

      const modelPrefs = sessionStore.getAllModelPreferences(context.sessionID)
      if (modelPrefs.length > 0) {
        output += "\n### 🎯 Per-Role Model Preferences\n"
        output += modelPrefs.map((p: { role: string; model: string }) => `- **${p.role}** → \`${p.model}\``).join("\n") + "\n"
      }

      // Evolution trend
      const trend = continuousEvolution.getTrend()
      if (trend.overall.total > 0) {
        const dirIcon = trend.rolling.direction === "improving" ? "📈" : trend.rolling.direction === "degrading" ? "📉" : "📊"
        output += "\n### 🔄 Evolution Trend\n"
        output += `**Overall:** ${(trend.overall.successRate * 100).toFixed(0)}% (${trend.overall.success}/${trend.overall.total} steps)\n`
        output += `**Recent (last ${trend.rolling.windowSize}):** ${(trend.rolling.successRate * 100).toFixed(0)}% — ${dirIcon} ${trend.rolling.direction}\n`
        if (trend.degradationDetected) {
          output += "⚠️ **Performance degradation detected!** Auto-running self-evolution...\n"
        }
        if (trend.forecast && trend.forecast.bucketRates.length > 0) {
          output += `**Forecast next window:** ${(trend.forecast.nextWindowRate * 100).toFixed(0)}%`
          if (trend.forecast.critical) output += " 🔴 **Critical**"
          if (trend.forecast.stepsUntilCritical !== null) output += ` (~${trend.forecast.stepsUntilCritical} steps to 50%)`
          output += "\n"
          output += `**Trend buckets:** ${trend.forecast.bucketRates.map((r: number) => `${(r * 100).toFixed(0)}%`).join(" → ")}\n`
        }
        if (trend.recommendations.length > 0) {
          output += "**Tips:**\n"
          output += trend.recommendations.map((r: string) => `- ${r}`).join("\n") + "\n"
        }
      }

      // Live evaluation score
      const liveScore = liveEvaluator.computeScore()
      if (liveScore.totalSteps > 0 || liveScore.totalDelegations > 0) {
        output += "\n### 📊 Live Evaluation Score\n"
        const bar = "█".repeat(Math.round(liveScore.overall / 5))
        output += `**Overall:** ${liveScore.overall}/100 ${bar.padEnd(20, "░")}\n`
        for (const [name, dim] of Object.entries(liveScore.dimensions)) {
          if (dim.weight > 0) {
            output += `- **${name}:** ${(dim.score * 100).toFixed(0)}% (target ${(dim.target * 100).toFixed(0)}%)\n`
          }
        }
        output += "\n"
      }

      // Confidence Score per Step
      const confRecords = confidenceStore.getAll()
      if (confRecords.length > 0) {
        output += "\n### 📊 Confidence per Step (Gap #2)\n"
        const avg = confidenceStore.getAverage()
        output += `**Average:** ${(avg * 100).toFixed(0)}% | **Steps scored:** ${confRecords.length}\n\n`
        for (const rec of confRecords) {
          const emoji = rec.passed ? "✅" : "⚠️"
          const bar = "█".repeat(Math.round(rec.score * 10))
          const empty = "░".repeat(10 - Math.round(rec.score * 10))
          output += `- **${rec.stepId}** ${emoji} ${bar}${empty} ${(rec.score * 100).toFixed(0)}%\n`
        }
        const lowConf = confidenceStore.getLowConfidence()
        if (lowConf.length > 0) {
          output += `\n⚠️ **${lowConf.length} step(s) below threshold** — review recommended\n`
        }
        output += "\n"
      }

      // World Model Beliefs
      const wmStats = worldModel.getStats()
      if (wmStats.beliefs > 0) {
        output += "\n### 🧠 World Model Beliefs\n"
        output += `**Entities:** ${wmStats.entities} | **Relations:** ${wmStats.relations} | **Beliefs:** ${wmStats.beliefs} | **Cycles:** ${wmStats.cycles}\n`
        const uncertain = worldModel.getUncertainBeliefs()
        if (uncertain.length > 0) {
          output += `⚠️ **${uncertain.length} low-confidence belief(s)** — may be stale\n`
        }
        const topBeliefs = worldModel.getAllBeliefs().sort((a, b) => b.confidence - a.confidence).slice(0, 5)
        if (topBeliefs.length > 0) {
          output += "\n**Top beliefs:**\n"
          for (const b of topBeliefs) {
            output += `- \`${b.key}\`: ${(b.confidence * 100).toFixed(0)}% — ${b.fact.slice(0, 80)} (${b.category})\n`
          }
        }
        output += "\n"
      }

      return { output, metadata: { progress, nextStep: nextStep?.id, blockedSteps, isComplete, isHealthy } }
    },
  }
}
