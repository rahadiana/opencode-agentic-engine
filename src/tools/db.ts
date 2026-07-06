import { tool } from "@opencode-ai/plugin"
import type { ToolSpec } from "./types.js"
import type { ToolContext } from "./tool-context.js"

export function makeDbTool(ctx: ToolContext): ToolSpec {
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
      description: "SQLite database backend. Query, save, load, list, stats. Structured queries support WHERE, JOIN, GROUP BY.",
      args: {
        action: tool.schema.enum(["query", "save", "load", "list", "stats", "tables", "migrate"]).describe("Action: query (raw SQL), save (key-value), load (by key), list (all keys), stats, tables (list tables), migrate (JSON→SQLite)"),
        sql: tool.schema.string().optional().describe("SQL query (for action=query)"),
        namespace: tool.schema.string().optional().describe("Namespace (for save/load/list)"),
        key: tool.schema.string().optional().describe("Key (for save/load)"),
        scope: tool.schema.string().optional().describe("Scope/projectId (optional)"),
        data: tool.schema.string().optional().describe("JSON data string (for action=save)"),
        params: tool.schema.string().optional().describe("JSON array of query parameters (for action=query)"),
      },
      async execute(args: Record<string, unknown>, _ctx: Record<string, unknown>) {
        const action = args.action as string

        // Jika SQLite tidak tersedia (Bun tanpa better-sqlite3, dll)
        if (!sqliteDB) {
          return { output: "❌ SQLite database not available. Install better-sqlite3 (Node) or run in Bun for built-in SQLite support.\n\nFallback: use file-based persistence via agentic_rag and agentic_skill (data saved to .agentic/store/)." }
        }

        switch (action) {
          case "query": {
            const sql = args.sql as string
            if (!sql) return { output: "Error: 'sql' parameter is required for query action." }
            try {
              const params = args.params ? JSON.parse(args.params as string) : undefined
              const rows = sqliteDB.query(sql, params)
              const preview = JSON.stringify(rows.slice(0, 20), null, 2)
              const total = rows.length
              return {
                output: [
                  `## 📊 SQLite Query Result`,
                  `**SQL:** \`${sql}\``,
                  `**Rows:** ${total}${total > 20 ? " (showing first 20)" : ""}`,
                  ``,
                  "```json",
                  preview,
                  "```",
                ].join("\n"),
                metadata: { rows: total, data: rows.slice(0, 50) },
              }
            } catch (err: unknown) {
              return { output: `❌ Query failed: ${err instanceof Error ? err.message : String(err)}` }
            }
          }

          case "save": {
            const namespace = args.namespace as string
            const key = args.key as string
            const dataStr = args.data as string
            if (!namespace || !key || !dataStr) {
              return { output: "Error: 'namespace', 'key', and 'data' parameters are required." }
            }
            try {
              const data = JSON.parse(dataStr)
              const scope = args.scope as string | undefined
              sqliteDB.save(namespace, key, data, scope)
              return { output: `✅ Saved \`${namespace}:${key}\`${scope ? ` (scope: ${scope})` : ""}` }
            } catch (err: unknown) {
              return { output: `❌ Save failed: ${err instanceof Error ? err.message : String(err)}` }
            }
          }

          case "load": {
            const namespace = args.namespace as string
            const key = args.key as string
            if (!namespace || !key) {
              return { output: "Error: 'namespace' and 'key' parameters are required." }
            }
            const scope = args.scope as string | undefined
            const data = sqliteDB.load(namespace, key, scope)
            if (data === null) {
              return { output: `Not found: \`${namespace}:${key}\`${scope ? ` (scope: ${scope})` : ""}` }
            }
            return {
              output: [
                `## Loaded: \`${namespace}:${key}\``,
                ``,
                "```json",
                JSON.stringify(data, null, 2),
                "```",
              ].join("\n"),
              metadata: { data },
            }
          }

          case "list": {
            const namespace = args.namespace as string
            if (!namespace) return { output: "Error: 'namespace' parameter is required." }
            const scope = args.scope as string | undefined
            const keys = sqliteDB.listKeys(namespace, scope)
            if (keys.length === 0) {
              return { output: `No entries in namespace \`${namespace}\`${scope ? ` (scope: ${scope})` : ""}` }
            }
            return {
              output: [
                `## 📋 Keys in \`${namespace}\`${scope ? ` (scope: ${scope})` : ""}`,
                `**Total:** ${keys.length}`,
                ``,
                ...keys.map((k: string) => `  - \`${k}\``),
              ].join("\n"),
              metadata: { keys },
            }
          }

          case "tables": {
            const rows = sqliteDB.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name") as Array<{ name: string }>
            const counts = sqliteDB.query("SELECT 'store' as name, COUNT(*) as cnt FROM store") as Array<{ name: string; cnt: number }>
            return {
              output: [
                `## 📋 SQLite Tables`,
                `**Database:** ${sqliteDB.stats().dbPath}`,
                ``,
                "| Table | Rows |",
                "|-------|------|",
                ...rows.map(r => {
                  const cnt = counts.find(c => c.name === r.name)?.cnt ?? 0
                  return `| \`${r.name}\` | ${cnt} |`
                }),
                ``,
                `**File size:** ${(sqliteDB.stats().fileSize / 1024).toFixed(1)} KB`,
              ].join("\n"),
            }
          }

          case "stats": {
            const stats = sqliteDB.stats()
            return {
              output: [
                `## 📊 SQLite Database Stats`,
                `**Path:** ${stats.dbPath}`,
                `**File size:** ${(stats.fileSize / 1024).toFixed(1)} KB`,
                ``,
                `| Namespace | Scopes | Keys |`,
                `|-----------|--------|------|`,
                ...stats.namespaces.map((n: string) =>
                  `| \`${n.namespace}\` | ${n.scopes} | ${n.keys} |`
                ),
              ].join("\n"),
              metadata: stats,
            }
          }

          case "migrate": {
            // Migrate all data from JSON files to SQLite (one-time operation)
            const migrated: string[] = []
            const skipped: string[] = []
            const namespaces = ["rag", "episodes", "skills", "models", "prompts", "evolution", "evaluation"]

            for (const ns of namespaces) {
              try {
                const items = stateStore.getAll(ns as import("../core/state-store.js").StateNamespace)
                if (items.length === 0) {
                  skipped.push(`${ns} (empty)`)
                  continue
                }
                for (const item of items) {
                  // Detect scope from key pattern
                  if (ns === "episodes" && item.key.includes("-")) {
                    // episodes have scope from projectId
                    const loaded = stateStore.get(ns as import("../core/state-store.js").StateNamespace, item.key)
                    if (loaded) sqliteDB.save(ns, item.key, loaded)
                  } else {
                    sqliteDB.save(ns, item.key, item.data)
                  }
                }
                migrated.push(`${ns} (${items.length} items)`)
    } catch (err: unknown) {
                skipped.push(`${ns} (error: ${err instanceof Error ? err.message : String(err)})`)
              }
            }

            return {
              output: [
                `## 🔄 Migration: JSON → SQLite`,
                ``,
                `**Migrated:**`,
                ...migrated.map(m => `  ✅ ${m}`),
                ``,
                `**Skipped:**`,
                ...skipped.map(s => `  ⏭️ ${s}`),
                ``,
                `**SQLite DB:** ${sqliteDB.stats().dbPath}`,
              ].join("\n"),
            }
          }

          default:
            return { output: "Unknown action. Available: query, save, load, list, stats, tables, migrate" }
        }
      },
  }
}
