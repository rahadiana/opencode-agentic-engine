/**
 * agentic_snapshot — Save, restore, or list execution snapshots.
 *
 * Extracted from src/index.ts to reduce monolith.
 */

import { tool } from "@opencode-ai/plugin"
import type { ToolSpec } from "./types.js"
import type { ToolContext } from "./tool-context.js"

export function makeSnapshotTool(ctx: ToolContext): ToolSpec {
  const { executor, sessionStore, traceLogger, log } = ctx

  return {
    description:
      "Save, restore, or list execution snapshots. Use 'save' to checkpoint state (plan progress, file changes, decisions). Use 'restore' to reload a previous checkpoint and reset execution state. Use 'list' to see all snapshots.",
    args: {
      action: tool.schema.enum(["save", "list", "restore"]).describe("'save' creates a checkpoint; 'restore' reloads a checkpoint; 'list' shows all saved snapshots"),
      label: tool.schema.string().optional().describe("Snapshot label to restore (required for 'restore', optional for 'save')"),
    },
    async execute(args, context) {
      if (args.action === "save") {
        const progress = executor.getProgress(context.sessionID)
        const allFiles = executor.getAllFilesModified(context.sessionID)
        const session = sessionStore.getOrCreate(context.sessionID)
        const planGoal = session.plan?.intent.goal ?? "N/A"

        const completedSteps = session.plan?.intent.subtasks.filter(s =>
          executor.getCompletedSteps(context.sessionID).includes(s.id)
        ).map(s => s.id) ?? []

        const snapshot = {
          label: args.label ?? `snap-${Date.now()}`,
          timestamp: new Date().toISOString(),
          planGoal,
          progress,
          filesModified: allFiles,
          completedSteps,
          totalSteps: session.plan?.intent.subtasks.length ?? 0,
          plan: session.plan ?? null,
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

      if (args.action === "restore") {
        if (!args.label) {
          return { output: "Provide a `label` of the snapshot to restore. Use `action: \"list\"` to see available snapshots." }
        }

        const session = sessionStore.getOrCreate(context.sessionID)
        const raw = session.artifacts.get(`snapshot:${args.label}`)
        if (!raw) {
          return { output: `Snapshot "${args.label}" not found. Use \`action: "list"\` to see available snapshots.` }
        }

        let snapshot: { plan?: unknown; completedSteps?: string[]; filesModified?: string[]; [key: string]: unknown }
        try {
          snapshot = JSON.parse(raw) as typeof snapshot
        } catch (_e) { log.warn("Silent catch: snapshot corrupted")
          return { output: `Snapshot "${args.label}" is corrupted and cannot be restored.` }
        }

        // Re-init execution with the same plan but mark completed steps from snapshot
        if (snapshot.plan) {
          executor.initExecution(context.sessionID, snapshot.plan as Parameters<typeof executor.initExecution>[1])
          // Re-mark completed steps
          for (const stepId of snapshot.completedSteps ?? []) {
            executor.recordResult(context.sessionID, {
              stepId,
              success: true,
              output: `Restored from snapshot "${args.label}"`,
              filesModified: snapshot.filesModified ?? [],
            })
          }
          // Update session plan
          session.plan = snapshot.plan as Parameters<typeof executor.initExecution>[1]
        }

        traceLogger.log({
          step: "snapshot:restore",
          input: args.label,
          output: `Restored ${snapshot.completedSteps?.length ?? 0}/${snapshot.totalSteps ?? 0} steps`,
          toolUsed: "agentic_snapshot",
          success: true,
          durationMs: 0,
        })

        const stepList = (snapshot.completedSteps ?? []).map((s: string) => `  - ✅ \`${s}\``).join("\n")
        return {
          output: `## ♻️ Snapshot Restored\n\n**Label:** \`${args.label}\`\n**Timestamp:** ${snapshot.timestamp}\n**Goal:** ${snapshot.planGoal}\n**Progress Restored:** ${snapshot.completedSteps?.length ?? 0}/${snapshot.totalSteps ?? 0} steps\n\n### Completed Steps\n${stepList || "  (none)"}\n\n### Files Modified (${snapshot.filesModified?.length ?? 0})\n${(snapshot.filesModified ?? []).map((f: string) => `  - \`${f}\``).join("\n") || "  (none)"}\n\nRun \`agentic_status\` to see current progress.`,
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

      // Show details for each snapshot
      const lines: string[] = []
      for (const label of snapshots) {
        const raw = session.artifacts.get(`snapshot:${label}`)
        if (raw) {
          try {
            const s = JSON.parse(raw)
            lines.push(`- \`${label}\` — ${s.planGoal ?? "N/A"} (${s.completedSteps?.length ?? 0}/${s.totalSteps ?? 0} steps, ${new Date(s.timestamp).toLocaleDateString()})`)
          } catch (_e) { log.warn("Silent catch: snapshot listing corrupted")
            lines.push(`- \`${label}\` (corrupted)`)
          }
        } else {
          lines.push(`- \`${label}\``)
        }
      }

      return { output: `## 📸 Snapshots (${snapshots.length})\n\n${lines.join("\n")}\n\nUse \`agentic_snapshot\` with \`action: "restore"\` and the \`label\` to reload a checkpoint.` }
    },
  }
}
