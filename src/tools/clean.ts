/**
 * agentic_clean — Clean raw text by stripping debate artifacts.
 *
 * Extracted from src/index.ts to reduce monolith.
 */

import { tool } from "@opencode-ai/plugin"
import type { ToolSpec } from "./types.js"
import type { ToolContext } from "./tool-context.js"

export function makeCleanTool(ctx: ToolContext): ToolSpec {
  const { dataCleaner, traceLogger } = ctx

  return {
    description:
      "Clean raw text by stripping debate artifacts, reformatting to markdown/json, and optionally validating against a schema. Use after debate or any multi-step analysis to get clean output.",
    args: {
      text: tool.schema.string().describe("Raw text to clean"),
      format: tool.schema.enum(["markdown", "json", "text"]).optional().default("json").describe("Output format"),
      schema: tool.schema.string().optional().describe("Expected JSON schema description (e.g., 'array of {name, description}')"),
      stripDebate: tool.schema.boolean().optional().default(true).describe("Strip debate/review artifacts"),
    },
    async execute(args, _context) {
      const startTime = Date.now()

      const result = await dataCleaner.clean({
        text: args.text,
        format: args.format ?? "json",
        schema: args.schema,
        stripDebateArtifacts: args.stripDebate ?? true,
      })

      traceLogger.log({
        step: "execute",
        input: `Clean: ${args.text.slice(0, 80)}...`,
        output: `cleaned (${result.stats.removedLines} lines removed)`,
        toolUsed: "agentic_clean",
        success: true,
        durationMs: Date.now() - startTime,
      })

      return {
        output: `## 🧹 Data Cleaned\n\n**Original:** ${result.stats.originalLength} chars → **Cleaned:** ${result.stats.cleanedLength} chars (${result.stats.removedLines} lines removed)\n${result.validJson ? "✅ Valid JSON" : "ℹ️ Text output"}\n\n### Result\n\`\`\`${args.format === "json" ? "json" : args.format === "markdown" ? "markdown" : ""}\n${result.cleaned.slice(0, 2000)}\n\`\`\``,
        metadata: { cleanResult: result },
      }
    },
  }
}
