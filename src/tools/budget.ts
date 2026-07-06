/**
 * agentic_budget — Set, view, or reset resource budget limits.
 *
 * Extracted from src/index.ts to reduce monolith.
 * Acts as circuit breaker for autonomous execution.
 */

import { tool } from "@opencode-ai/plugin"
import type { ToolSpec } from "./types.js"
import type { ToolContext } from "./tool-context.js"
import type { BudgetLimits, ModelPriceEntry } from "../core/budget-tracker.js"

export function makeBudgetTool(ctx: ToolContext): ToolSpec {
  const { budgetTracker } = ctx

  return {
    description:
      "Set, view, or reset resource budget limits. Prevents runaway loops by capping tokens, steps, time, or cost. Acts as circuit breaker for autonomous execution. Use 'set' to define limits, 'status' to view usage, 'reset' to clear counters.",
    args: {
      action: tool.schema.enum(["set", "get", "status", "reset"]).describe("'set' defines limits; 'get' shows current limits; 'status' shows usage; 'reset' clears counters"),
      scope: tool.schema.enum(["session", "task"]).optional().describe("Scope: 'session' (default) or 'task'"),
      maxTokens: tool.schema.number().optional().describe("Maximum total tokens (input+output+cache+reasoning)"),
      maxSteps: tool.schema.number().optional().describe("Maximum subtask steps"),
      maxTimeMs: tool.schema.number().optional().describe("Maximum wall-clock time in milliseconds"),
      maxCostUsd: tool.schema.number().optional().describe("Maximum cost in USD"),
      onExceeded: tool.schema.enum(["hard-stop", "request-approval", "warn"]).optional().describe("Behavior when limit exceeded (default: hard-stop)"),
      modelPrices: tool.schema.record(tool.schema.string(), tool.schema.object({
        input: tool.schema.number(),
        output: tool.schema.number(),
        cacheRead: tool.schema.number().optional(),
        cacheWrite: tool.schema.number().optional(),
      })).optional().describe("Optional per-model price overrides (USD per 1K tokens)"),
    },
    async execute(args, _context) {
      const scope = args.scope ?? "session"

      switch (args.action) {
        case "set": {
          const limits: Partial<BudgetLimits> = {}
          if (args.maxTokens !== undefined) limits.maxTokens = args.maxTokens
          if (args.maxSteps !== undefined) limits.maxSteps = args.maxSteps
          if (args.maxTimeMs !== undefined) limits.maxTimeMs = args.maxTimeMs
          if (args.maxCostUsd !== undefined) limits.maxCostUsd = args.maxCostUsd
          const behavior = args.onExceeded ?? "hard-stop"

          if (Object.keys(limits).length === 0) {
            return { output: "Provide at least one limit (maxTokens, maxSteps, maxTimeMs, or maxCostUsd)." }
          }

          budgetTracker.setLimits(scope, limits, behavior)

          // Override model prices jika dikirim
          if (args.modelPrices) {
            const prices = args.modelPrices as Record<string, ModelPriceEntry>
            const normalized: Record<string, ModelPriceEntry> = {}
            for (const [modelId, price] of Object.entries(prices)) {
              normalized[modelId] = {
                input: price.input,
                output: price.output,
                cacheRead: price.cacheRead ?? 0,
                cacheWrite: price.cacheWrite ?? 0,
              }
            }
            budgetTracker.setModelPrices(normalized)
          }

          const limitStr = Object.entries(limits)
            .map(([k, v]) => `${k}: ${v === Infinity ? "∞" : v}`)
            .join(", ")
          return { output: `✅ Budget limits set for scope="${scope}": ${limitStr} (behavior: ${behavior})` }
        }

        case "get": {
          const limits = budgetTracker.getLimits(scope)
          const behavior = args.onExceeded ?? "hard-stop"
          const limitStr = Object.entries(limits)
            .map(([k, v]) => `${k}: ${v === Infinity ? "∞" : v}`)
            .join(", ")
          return { output: `📊 Budget limits for scope="${scope}": ${limitStr} (behavior: ${behavior})` }
        }

        case "status": {
          const states = budgetTracker.getState([scope])
          const state = states[0]
          const usage = state.usage
          let output = `## 💰 Budget Status (${scope})\n\n`

          output += `| Metric | Usage | Limit |\n|---|---|---|\n`
          output += `| Tokens | ${usage.totalTokens.toLocaleString()} | ${state.limits.maxTokens === Infinity ? "∞" : state.limits.maxTokens.toLocaleString()} |\n`
          output += `| Steps | ${usage.totalSteps} | ${state.limits.maxSteps === Infinity ? "∞" : state.limits.maxSteps} |\n`
          output += `| Time | ${(usage.elapsedMs / 1000).toFixed(1)}s | ${state.limits.maxTimeMs === Infinity ? "∞" : (state.limits.maxTimeMs / 1000).toFixed(1) + "s"} |\n`
          output += `| Cost | $${usage.totalCostUsd.toFixed(4)} | ${state.limits.maxCostUsd === Infinity ? "∞" : "$" + state.limits.maxCostUsd.toFixed(2)} |\n`

          if (usage.byModel.length > 0) {
            output += `\n### Per-Model Breakdown\n\n`
            output += `| Model | In | Out | Reason | Cache R | Cache W | Cost |\n|---|---|---|---|---|---|---|\n`
            for (const m of usage.byModel) {
              output += `| ${m.modelId} | ${m.inputTokens.toLocaleString()} | ${m.outputTokens.toLocaleString()} | ${m.reasoningTokens.toLocaleString()} | ${m.cacheReadTokens.toLocaleString()} | ${m.cacheWriteTokens.toLocaleString()} | $${m.cost.toFixed(4)} |\n`
            }
          }

          if (usage.waitingForApprovalMs > 0) {
            output += `\n⏳ Waiting for approval: ${(usage.waitingForApprovalMs / 1000).toFixed(1)}s\n`
          }

          if (state.exceeded) {
            output += `\n⚠️ **BUDGET EXCEEDED** — ${state.exceeded.metric} (${state.exceeded.current} / ${state.exceeded.limit})\n`
          }

          return { output }
        }

        case "reset": {
          budgetTracker.reset(scope)
          return { output: `🔄 Budget counters reset for scope="${scope}". Limits preserved.` }
        }

        default:
          return { output: "Unknown action. Use 'set', 'get', 'status', or 'reset'." }
      }
    },
  }
}
