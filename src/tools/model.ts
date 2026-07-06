import { tool } from "@opencode-ai/plugin"
import type { ToolSpec } from "./types.js"
import type { ToolContext } from "./tool-context.js"
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"

export function makeModelTool(ctx: ToolContext): ToolSpec {
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
  return {
      description: "Configure per-role, per-tool, or per-category LLM model preferences. Use 'set' to assign a model. Use 'get' to check current assignment. Use 'list' to view all. Use 'clear' to remove. Use 'reset'/'reset-stale'/'reset-all' to recover from degraded model performance. Accepts `role`, `tool`, or `category` parameter. Preferences are persisted to .agentic/models.json.",
      args: {
        action: tool.schema.enum(["set", "get", "list", "clear", "reset", "reset-stale", "reset-all"]).describe("Action: set/get/list/clear model preference, or reset/reset-stale/reset-all model statistics"),
        role: tool.schema.string().optional().describe("Agent role (architect, developer, qa, coordinator, pm)"),
        tool: tool.schema.string().optional().describe("Tool name (e.g. 'agentic_plan')"),
        category: tool.schema.string().optional().describe("Complexity category (quick, unspecified-low, unspecified-high, deep)"),
        model: tool.schema.string().optional().describe("Model name (e.g. 'gpt-4o', 'claude-sonnet-4-20250514') or 'auto' to auto-discover best model"),
        staleDays: tool.schema.number().optional().describe("Days threshold for stale detection (for reset-stale, default: 7)"),
      },
      async execute(args, context) {
        const projectDir = ctxDir(context)

        // ── Persistence helpers (new nested format) ──
        const modelsPath = join(projectDir, ".agentic", "models.json")

        // Built-in default preferences (kosong — fallback ke engine default model)
        const BUILTIN_DEFAULTS: PersistedPrefs = {}

        interface PersistedPrefs {
          [key: string]: unknown
          tools?: Record<string, string>
          categories?: Record<string, string>
          $schema?: string
        }

        /** Read project .agentic/models.json */
        function readProjectPrefs(): PersistedPrefs {
          try {
            if (existsSync(modelsPath)) {
              return JSON.parse(readFileSync(modelsPath, "utf-8"))
            }
          } catch (e) { log.warn("Silent catch: corrupt or missing", { error: String(e) }) }
          return {}
        }

        /** Plugin's built-in default preferences */
        function readPluginDefaults(): PersistedPrefs {
          return BUILTIN_DEFAULTS
        }

        /** Apply prefs to session store (skip empty/undefined/description values) */
        const META_KEYS = new Set(['tools', 'categories', '$schema', 'description'])
        function applyPrefsToSession(prefs: PersistedPrefs): void {
          const sid = context.sessionID
          // Load role prefs (flat keys, excluding meta keys like 'tools', 'categories', 'description')
          for (const [key, val] of Object.entries(prefs)) {
            if (META_KEYS.has(key)) continue
            if (typeof val === 'string' && val.length > 0) {
              sessionStore.setModelPreference(sid, key, val)
            }
          }
          // Load tool prefs
          if (prefs.tools) {
            for (const [tool, model] of Object.entries(prefs.tools)) {
              if (typeof model === 'string' && model.length > 0) {
                sessionStore.setToolPreference(sid, tool, model)
              }
            }
          }
          // Load category prefs
          if (prefs.categories) {
            for (const [cat, model] of Object.entries(prefs.categories)) {
              if (typeof model === 'string' && model.length > 0) {
                sessionStore.setCategoryPreference(sid, cat, model)
              }
            }
          }
        }

        function writeProjectPrefs(prefs: PersistedPrefs): void {
          try {
            const dir = dirname(modelsPath)
            mkdirSync(dir, { recursive: true })
            writeFileSync(modelsPath, JSON.stringify(prefs, null, 2), "utf-8")
          } catch (e) { log.warn("Silent catch: non-fatal", { error: String(e) }) }
        }

        // On first access, load: plugin defaults → project overrides
        function ensureSessionLoaded(): void {
          const existing = sessionStore.getAllModelPreferences(context.sessionID)
          if (existing.length === 0) {
            // 1. Plugin defaults (lower priority)
            const defaults = readPluginDefaults()
            applyPrefsToSession(defaults)
            // 2. Project overrides (higher priority — overwrites same keys)
            const overrides = readProjectPrefs()
            applyPrefsToSession(overrides)
          }
        }

        if (args.action === "list") {
          ensureSessionLoaded()
          const sid = context.sessionID
          const rolePrefs = sessionStore.getAllModelPreferences(sid)
          const toolPrefs = sessionStore.getAllToolPreferences(sid)
          const catPrefs = sessionStore.getAllCategoryPreferences(sid)

          let output = "## 🎯 Model Preferences\n\n"

          if (rolePrefs.length === 0 && toolPrefs.length === 0 && catPrefs.length === 0) {
            output += "No model preferences configured. Use `agentic_model set role=... model=...` or `agentic_model set tool=... model=...` or `agentic_model set category=... model=...`.\n"
          } else {
            if (rolePrefs.length > 0) {
              output += "### 👤 Per-Role\n| Role | Model |\n|------|-------|\n"
              output += rolePrefs.map(p => `| **${p.role}** | \`${p.model}\` |`).join("\n") + "\n\n"
            }
            if (toolPrefs.length > 0) {
              output += "### 🔧 Per-Tool\n| Tool | Model |\n|------|-------|\n"
              output += toolPrefs.map(p => `| **${p.tool}** | \`${p.model}\` |`).join("\n") + "\n\n"
            }
            if (catPrefs.length > 0) {
              output += "### 📊 Per-Category\n| Category | Model |\n|----------|-------|\n"
              output += catPrefs.map(p => `| **${p.category}** | \`${p.model}\` |`).join("\n") + "\n\n"
            }
            const projectPrefs = readProjectPrefs()
            const pluginPrefs = readPluginDefaults()
            const projCount = Object.keys(projectPrefs).filter(k => k !== 'tools' && k !== 'categories' && k !== '$schema').length +
              (projectPrefs.tools ? Object.keys(projectPrefs.tools).length : 0) +
              (projectPrefs.categories ? Object.keys(projectPrefs.categories).length : 0)
            const pluginCount = Object.keys(pluginPrefs).filter(k => k !== 'tools' && k !== 'categories' && k !== '$schema').length +
              (pluginPrefs.tools ? Object.keys(pluginPrefs.tools).length : 0) +
              (pluginPrefs.categories ? Object.keys(pluginPrefs.categories).length : 0)
            if (projCount > 0) {
              output += `💾 ${projCount} preference(s) in project \`.agentic/models.json\`\n`
            }
            if (pluginCount > 0) {
              output += `📦 ${pluginCount} default preference(s) from plugin defaults\n`
            }
            if (projCount === 0 && pluginCount === 0) {
              output += "Preferences are session-only (not yet persisted)"
            }
            output += "\n\n**Resolution priority:** per-tool override → category fallback → engine default"
            if (projCount > 0) {
              output += "\n> 💡 Models set via `auto` are saved as explicit model names — re-run `agentic_model set ... auto` to re-discover."
            }
          }

          // Also show available models from OpenCode
          try {
            const ocModels = await llmEngine.listOpenCodeModels()
            if (ocModels.length > 0) {
              output += `\n\n### 🧠 Available Models (from OpenCode)\n`
              const byProvider = new Map<string, string[]>()
              for (const m of ocModels) {
                const list = byProvider.get(m.providerName) ?? []
                list.push(`\`${m.id}\``)
                byProvider.set(m.providerName, list)
              }
              for (const [provider, models] of byProvider) {
                output += `- **${provider}**: ${models.join(", ")}\n`
              }
              output += `\nUse \`action:"set"\` to assign any of these to a role, tool, or category.`
            }
          } catch (e) { log.warn("Silent catch: silent", { error: String(e) }) }

          return { output }
        }

        if (args.action === "set") {
          if (!args.role && !args.tool && !args.category) {
            return { output: "Provide a `role`, `tool`, or `category` to assign the model to." }
          }

          if (!args.model) return { output: "Provide a `model` name (e.g. 'gpt-4o') or 'auto' to auto-discover." }

          // Auto-discover best model
          let wasAuto = false
          if (args.model === "auto") {
            wasAuto = true
            const ocModels = await llmEngine.listOpenCodeModels()
            if (ocModels.length === 0) {
              return { output: "No models available from OpenCode. Provide explicit `model` name (e.g. 'gpt-4o')." }
            }

            // Map target → tier heuristic
            let wantsFast = false
            if (args.category) {
              const cat = args.category.toLowerCase()
              wantsFast = cat === "quick" || cat === "unspecified-low"
            } else if (args.tool) {
              const cat = TOOL_COMPLEXITY[args.tool.toLowerCase()]
              wantsFast = cat === "quick" || cat === "unspecified-low"
            } else if (args.role) {
              wantsFast = ["pm", "coordinator"].includes(args.role.toLowerCase())
            }

            // Score each available model
            const taskType = sessionStore.getOrCreate(context.sessionID).currentTaskType
            interface ScoredModel { model: string; reliability: number; userSat: number; score: number; isFast: boolean; isCapable: boolean }
            const scored: ScoredModel[] = ocModels.map(m => {
              const s = modelRegistry.getScore(m.id) || { reliability: 0.5 }
              const us = taskType ? modelRegistry.getUserSatisfaction(m.id, taskType) : 0.5
              return {
                model: m.id,
                reliability: s.reliability ?? 0.5,
                userSat: us,
                score: us * 0.6 + (s.reliability ?? 0.5) * 0.4,
                isFast: /flash|mini|small|light|nano|fast/.test(m.id),
                isCapable: /ultra|pro|reason|sonnet|opus|max|strong/.test(m.id),
              }
            })

            // Filter candidates by tier
            let candidates = scored
            if (wantsFast) {
              const fast = scored.filter(m => m.isFast)
              if (fast.length > 0) candidates = fast
            } else {
              const capable = scored.filter(m => m.isCapable)
              if (capable.length > 0) candidates = capable
            }

            candidates.sort((a, b) => b.score - a.score)
            args.model = candidates[0].model
          }

          modelRegistry.addModel(args.model)
          const autoTag = wasAuto ? ` 🤖 auto-discovered` : ""
          const changeHint = "\nTo change, use `agentic_model set ... model=...` or edit `.agentic/models.json`"

          if (args.tool) {
            const toolLower = args.tool.toLowerCase()
            sessionStore.setToolPreference(context.sessionID, toolLower, args.model)
            // Persist
            const persisted = readProjectPrefs()
            if (!persisted.tools) persisted.tools = {}
            persisted.tools[toolLower] = args.model
            writeProjectPrefs(persisted)
            return { output: `✅ Tool model preference set: **${toolLower}** → \`${args.model}\`${autoTag}\nAll LLM calls from \`${toolLower}\` will use this model.\n💾 Persisted to \`.agentic/models.json\`${changeHint}` }
          }

          if (args.category) {
            const catLower = args.category.toLowerCase()
            sessionStore.setCategoryPreference(context.sessionID, catLower, args.model)
            // Persist
            const persisted = readProjectPrefs()
            if (!persisted.categories) persisted.categories = {}
            persisted.categories[catLower] = args.model
            writeProjectPrefs(persisted)
            return { output: `✅ Category model preference set: **${catLower}** → \`${args.model}\`${autoTag}\nAll tools in this category will use this model.\n💾 Persisted to \`.agentic/models.json\`${changeHint}` }
          }

          if (args.role) {
            const roleLower = args.role.toLowerCase()
            sessionStore.setModelPreference(context.sessionID, roleLower, args.model)
            modelRegistry.registerAlias(roleLower, [args.model])
            // Persist
            const persisted = readProjectPrefs()
            persisted[roleLower] = args.model
            writeProjectPrefs(persisted)
            return { output: `✅ Role model preference set: **${roleLower}** → \`${args.model}\`${autoTag}\nThis model will be used when delegating to the ${roleLower} role.\n💾 Persisted to \`.agentic/models.json\`${changeHint}` }
          }

          return { output: "Unknown target. Use `role`, `tool`, or `category`." }
        }

        if (args.action === "get") {
          ensureSessionLoaded()
          if (!args.role && !args.tool && !args.category) {
            return { output: "Provide a `role`, `tool`, or `category` to check." }
          }

          if (args.tool) {
            const model = sessionStore.getToolPreference(context.sessionID, args.tool)
            if (!model) return { output: `No model preference set for tool "${args.tool}". Uses category fallback or default.` }
            const persisted = readProjectPrefs()
            const isPersisted = persisted.tools?.[args.tool.toLowerCase()] === model
            const hint = isPersisted ? "\nTo change, use `agentic_model set tool=... model=...`" : ""
            return { output: `**${args.tool}** → \`${model}\`${isPersisted ? " 💾 (persisted)" : ""}${hint}` }
          }

          if (args.category) {
            const model = sessionStore.getCategoryPreference(context.sessionID, args.category)
            if (!model) return { output: `No model preference set for category "${args.category}". Uses engine default.` }
            const persisted = readProjectPrefs()
            const isPersisted = persisted.categories?.[args.category.toLowerCase()] === model
            const hint = isPersisted ? "\nTo change, use `agentic_model set category=... model=...`" : ""
            return { output: `**${args.category}** → \`${model}\`${isPersisted ? " 💾 (persisted)" : ""}${hint}` }
          }

          if (args.role) {
            const model = sessionStore.getModelPreference(context.sessionID, args.role)
            if (!model) return { output: `No model preference set for role "${args.role}". Delegation will use default model selection.` }
            const persisted = readProjectPrefs()
            const isPersisted = persisted[args.role] === model
            const hint = isPersisted ? "\nTo change, use `agentic_model set role=... model=...` or edit `.agentic/models.json`" : ""
            return { output: `**${args.role}** → \`${model}\`${isPersisted ? " 💾 (persisted)" : ""}${hint}` }
          }

          return { output: "Unknown target." }
        }

        if (args.action === "clear") {
          if (args.tool) {
            sessionStore.clearToolPreference(context.sessionID, args.tool)
            const persisted = readProjectPrefs()
            if (persisted.tools) delete persisted.tools[args.tool.toLowerCase()]
            writeProjectPrefs(persisted)
            return { output: `Cleared model preference for tool "${args.tool}".` }
          }

          if (args.category) {
            sessionStore.clearCategoryPreference(context.sessionID, args.category)
            const persisted = readProjectPrefs()
            if (persisted.categories) delete persisted.categories[args.category.toLowerCase()]
            writeProjectPrefs(persisted)
            return { output: `Cleared model preference for category "${args.category}".` }
          }

          if (args.role) {
            sessionStore.clearModelPreference(context.sessionID, args.role)
            const persisted = readProjectPrefs()
            delete persisted[args.role]
            writeProjectPrefs(persisted)
            return { output: `Cleared model preference for role "${args.role}".` }
          }

          // Clear all
          const sid = context.sessionID
          sessionStore.clearModelPreference(sid)
          sessionStore.clearToolPreference(sid)
          sessionStore.clearCategoryPreference(sid)
          writeProjectPrefs({})
          return { output: "Cleared all model preferences (roles, tools, and categories) for this session." }
        }

        if (args.action === "reset") {
          if (!args.model) return { output: "Provide a `model` name to reset (e.g. 'gpt-4o')." }
          const beforeScore = modelRegistry.getScore(args.model)
          const deleted = modelRegistry.deleteModel(args.model)
          return { output: `✅ Removed \`${args.model}\` from registry\n\n**Before:** ${beforeScore ? `${(beforeScore.reliability * 100).toFixed(0)}% reliability, ${beforeScore.totalCalls} calls` : "No data"}\n**After:** ${deleted ? "Removed (call count will rebuild naturally)" : "Not found"}` }
        }

        if (args.action === "reset-stale") {
          const staleDays = args.staleDays ?? 7
          const resetModels = modelRegistry.resetStaleModels(staleDays)
          if (resetModels.length === 0) return { output: `No stale models found (threshold: ${staleDays} days unused).` }
          return { output: `✅ Reset ${resetModels.length} stale model(s):\n${resetModels.map(m => `- \`${m}\``).join("\n")}\n\nThese models had not been used in ${staleDays}+ days.` }
        }

        if (args.action === "reset-all") {
          const allScores = modelRegistry.getAllScores()
          for (const score of allScores) modelRegistry.deleteModel(score.model)
          return { output: `⚠️ **EMERGENCY RESET:** Removed statistics for ${allScores.length} model(s).\n\nAll models now have clean slate. Use this only when all models are blocked.` }
        }

        return { output: "Unknown action. Use 'set', 'get', 'list', 'clear', 'reset', 'reset-stale', or 'reset-all'." }
      },
  }
}
