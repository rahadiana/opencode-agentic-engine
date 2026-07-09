import { tool } from "@opencode-ai/plugin"
import type { ToolSpec } from "./types.js"
import type { ToolContext } from "./tool-context.js"
import { createMemoryEnvelope } from "../memory/schema-version.js"
import type { Episode } from "../memory/episodic-store.js"
import { createSkillDefinition } from "../memory/skill-format.js"

export function makeRagTool(ctx: ToolContext): ToolSpec {
  const {
    sessionStore: _sessionStore,
    domainRegistry: _domainRegistry,
    worktree: _worktree,
    projectId: _projectId,
    config: _config,
    log: _log,
    projectContext: _projectContext,
    TOOL_REGISTRY: _TOOL_REGISTRY,
    currentInjectDomain: _currentInjectDomain,
    planner: _planner,
    plannerCritic: _plannerCritic,
    executor: _executor,
    intentParser: _intentParser,
    agentLoop: _agentLoop,
    verifier: _verifier,
    errorAnalyzer: _errorAnalyzer,
    errorRecovery: _errorRecovery,
    alignmentGate: _alignmentGate,
    economicModel: _economicModel,
    confidenceScorer: _confidenceScorer,
    confidenceStore: _confidenceStore,
    techDebtScorer,
    constraintManifold: _constraintManifold,
    navigator: _navigator,
    toolRouter: _toolRouter,
    routerAgent: _routerAgent,
    skillStore,
    skillCurator,
    episodicStore: _episodicStore,
    memoryOrchestrator: _memoryOrchestrator,
    secondBrain: _secondBrain,
    rag: multiIndexRAG,
    coordinator: _coordinator,
    orchestrator: _orchestrator,
    roleRegistry: _roleRegistry,
    agentRuntime: _agentRuntime,
    debateLoop: _debateLoop,
    dashboard: _dashboard,
    traceLogger: _traceLogger,
    liveEvaluator: _liveEvaluator,
    patternDiscovery: _patternDiscovery,
    toolUsageTracker: _toolUsageTracker,
    workflowEngine: _workflowEngine,
    llmEngine: _llmEngine,
    modelRegistry: _modelRegistry,
    hallucinationGuard: _hallucinationGuard,
    checkpoints: _checkpoints,
    stateStore,
    budgetTracker: _budgetTracker,
    eventBus: _eventBus,
    parallelExec: _parallelExec,
    dependencyTracker: _depTracker,
    contextCompressor: _contextCompressor,
    git: _git,
    selfEvolver: _selfEvolver,
    continuousEvolution: _continuousEvolution,
    metaReasoner: _metaReasoner,
    mcpServer: _mcpServer,
    mcpClient: _mcpClient,
    protocolAdapter: _protocolAdapter,
    dynamicToolRegistry: _dynamicToolRegistry,
    worldModel: _worldModel,
    simulationEngine: _simulationEngine,
    dataCleaner: _dataCleaner,
    configLoader: _configLoader,
    logErrorToFile: _logErrorToFile,
    detectSubAgentRole: _detectSubAgentRole,
    buildSubAgentInjection: _buildSubAgentInjection,
    ctxDir: _ctxDir,
  } = ctx
  const _debtScorer = techDebtScorer
  const _curator = skillCurator
  return {
      description: "Multi-index RAG: search or store knowledge in category-segregated indices. Prevents cross-category context pollution. Use with agentic_router to scope searches to relevant domains.",
      args: {
        action: tool.schema.enum(["search", "store", "stats", "categories", "list", "clear", "detail", "edit", "delete", "reload"]).describe("Action: search, store, stats, categories, list, clear, detail (full content), edit (update entry), delete (remove single entry), or reload (restore from disk)"),
        query: tool.schema.string().optional().describe("Search query (required for search/stats)"),
        category: tool.schema.string().optional().describe("Category to search within (omit for all)"),
        title: tool.schema.string().optional().describe("Title for stored entry"),
        content: tool.schema.string().optional().describe("Content to store (for store action)"),
        type: tool.schema.enum(["episode", "skill"]).optional().default("episode").describe("Type of content to store"),
      },
      async execute(args, context) {
        switch (args.action) {
          case "search": {
            const q = args.query || ""
            const cat = args.category

            if (cat) {
              const results = await multiIndexRAG.searchByCategoryAsync(q, cat)
              const lines = [
                `## 🔍 RAG Search Results`,
                `**Query:** ${q}`,
                `**Category:** ${cat}`,
                `**Matches:** ${results.totalInCategory}`,
                `**Mode:** ${multiIndexRAG.mode}`,
                ``,
              ]
              for (const entry of results.entries.slice(0, 10)) {
                const type = entry.episode ? "📖 Episode" : "🔧 Skill"
                const title = entry.title
                const score = entry.vectorScore !== undefined
                  ? ` [vec:${entry.vectorScore.toFixed(3)} tfidf:${(entry.tfidfScore ?? 0).toFixed(3)}]`
                  : ` [tfidf:${(entry.tfidfScore ?? 0).toFixed(3)}]`
                const snippet = (entry.episode?.summary ?? entry.skill?.definition?.trigger?.pattern ?? "").slice(0, 500)
                lines.push(`- ${type}: **${title}** [${entry.category}]${score}`)
                if (snippet) lines.push(`  > ${snippet}`)
              }
              if (results.entries.length === 0) {
                lines.push("*(no results)*")
              }

              return {
                output: lines.join("\n"),
                metadata: { searchResults: results },
              }
            } else {
              const allResults = await multiIndexRAG.searchAllAsync(q)
              const totalMatches = allResults.reduce((s, r) => s + r.entries.length, 0)
              const lines = [
                `## 🔍 RAG Search Results (All Categories)`,
                `**Query:** ${q}`,
                `**Total Matches:** ${totalMatches}`,
                ``,
              ]
              for (const catResult of allResults) {
                lines.push(`### ${catResult.category} (${catResult.entries.length})`)
                for (const entry of catResult.entries.slice(0, 3)) {
                  lines.push(`- **${entry.title}**`)
                }
              }
              if (allResults.length === 0) {
                lines.push("*(no results across any category)*")
              }

              return {
                output: lines.join("\n"),
                metadata: { searchResults: allResults },
              }
            }
          }

          case "list": {
            const listCat = args.category
            const allEntries = multiIndexRAG.listAll(listCat)
            const totalCount = allEntries.reduce((s, c) => s + c.entries.length, 0)

            if (totalCount === 0) {
              return {
                output: `## 📋 RAG Entries\n\nNo entries found${listCat ? ` in category "${listCat}"` : ""}.`,
                metadata: { listResult: allEntries },
              }
            }

            const lines = [
              `## 📋 RAG Entries`,
              `**Total:** ${totalCount} entries across ${allEntries.length} categories`,
              ``,
            ]

            for (const { category, entries } of allEntries) {
              const episodeCount = entries.filter(e => e.episode).length
              const skillCount = entries.filter(e => e.skill).length
              lines.push(`### ${category} (${entries.length} — ${episodeCount} episodes, ${skillCount} skills)`)

              const showCount = Math.min(entries.length, 30)
              for (const entry of entries.slice(0, showCount)) {
                const type = entry.episode ? "📖" : "🔧"
                const ts = (entry.timestamp || "").slice(0, 10)
                const snippet = (entry.episode?.summary ?? entry.skill?.definition?.trigger?.pattern ?? "").slice(0, 400)
                lines.push(`  ${type} [${ts}] **${entry.title}**`)
                if (snippet) lines.push(`    ↳ ${snippet}`)
              }
              if (entries.length > showCount) {
                lines.push(`  *...and ${entries.length - showCount} more*`)
              }
            }

            return {
              output: lines.join("\n"),
              metadata: { listResult: allEntries },
            }
          }

          case "detail": {
            const dq = args.query || ""
            if (!dq) return { output: "Query diperlukan. Gunakan `query` untuk mencari entry yang ingin dilihat detailnya." }
            const dCat = args.category
            let dResults: import("../memory/multi-index-rag.js").IndexEntry[]
            if (dCat) {
              const dr = await multiIndexRAG.searchByCategoryAsync(dq, dCat, 1)
              dResults = dr.entries
            } else {
              const dr = await multiIndexRAG.searchAllAsync(dq, 1)
              dResults = dr.flatMap(r => r.entries).slice(0, 1)
            }
            if (dResults.length === 0) return { output: `No entry found for "${dq}".` }
            const de = dResults[0]
            const dlines: string[] = []
            if (de.episode) {
              dlines.push(`## 📖 Episode: ${de.episode.planGoal}`)
              dlines.push(`**ID:** ${de.episode.id}`)
              dlines.push(`**Outcome:** ${de.episode.outcome}`)
              dlines.push(`**Domain:** ${de.episode.domain || "—"}`)
              dlines.push(`**Tags:** ${de.episode.tags.join(", ")}`)
              dlines.push(`**Significance:** ${de.episode.significance}`)
              dlines.push(``)
              dlines.push(`### Summary`)
              dlines.push(de.episode.summary)
              if (de.episode.decisions.length > 0) {
                dlines.push(``)
                dlines.push(`### Decisions`)
                dlines.push(de.episode.decisions.map((d: string, i: number) => `${i + 1}. ${d}`).join("\n"))
              }
              if (de.episode.filesChanged && de.episode.filesChanged.length > 0) {
                dlines.push(``)
                dlines.push(`### Files Changed`)
                dlines.push(de.episode.filesChanged.map((f: string) => `- \`${f}\``).join("\n"))
              }
              if (de.episode.plan && de.episode.plan.length > 0) {
                dlines.push(``)
                dlines.push(`### Plan Steps`)
                dlines.push(de.episode.plan.map((s: string, i: number) => `${i + 1}. ${s}`).join("\n"))
              }
            } else if (de.skill) {
              const sk = de.skill.definition
              dlines.push(`## 🔧 Skill: ${sk.meta.name}`)
              dlines.push(`**ID:** ${sk.meta.id}`)
              dlines.push(`**Trigger:** ${sk.trigger.pattern}`)
              dlines.push(`**Keywords:** ${sk.trigger.keywords?.join(", ") || "—"}`)
              dlines.push(`**Success Rate:** ${(de.skill.successRate * 100).toFixed(0)}%`)
              dlines.push(`**Lifecycle:** ${de.skill.lifecycle || "raw"}`)
              dlines.push(``)
              dlines.push(`### Steps`)
              sk.workflow.steps.forEach((s: { action: string; description: string; tool?: string }, i: number) => {
                dlines.push(`${i + 1}. **[${s.action}]** ${s.description}`)
                if (s.tool) dlines.push(`   Tool: \`${s.tool}\``)
              })
            } else {
              dlines.push(`**${de.title}**`)
              dlines.push(`Category: ${de.category}`)
            }
            return { output: dlines.join("\n"), metadata: { entry: de } }
          }

          case "store": {
            const cat = args.category || multiIndexRAG.autoCategory(args.title || args.content || args.query || "")
            const content: string = args.content || ""
            const title = args.title || args.query || "untitled"

            if (args.type === "skill" && content) {
              // Extract keywords from content (filter common words)
              const words = content.toLowerCase().match(/\b[a-z]{4,}\b/g) ?? []
              const freq = new Map<string, number>()
              for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1)
              const keywords = [...freq.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10)
                .map(([w]) => w)

              // Parse content into multi-step workflow
              const lines = content.split("\n").map(l => l.trim()).filter(l => l.length > 0)
              const steps = lines
                .filter(l => /^\d+[.)]|^[-*]\s/.test(l) || l.length > 30)
                .slice(0, 8)
                .map((l, i) => ({
                  action: l.toLowerCase().includes("create") || l.toLowerCase().includes("implement") ? "create"
                    : l.toLowerCase().includes("fix") || l.toLowerCase().includes("update") ? "modify"
                    : l.toLowerCase().includes("test") || l.toLowerCase().includes("verify") ? "verify"
                    : l.toLowerCase().includes("search") || l.toLowerCase().includes("research") ? "research"
                    : "execute",
                  description: l.replace(/^[\d\s.)*-]+/, "").slice(0, 200),
                  tool: l.toLowerCase().includes("search") ? "agentic_nav"
                    : l.toLowerCase().includes("plan") ? "agentic_plan"
                    : l.toLowerCase().includes("test") || l.toLowerCase().includes("verify") ? "agentic_verify"
                    : l.toLowerCase().includes("delegate") ? "agentic_delegate"
                    : undefined,
                  expectedOutput: `Step ${i + 1} completed`,
                }))

              if (steps.length === 0) {
                steps.push({
                  action: "execute",
                  description: content.slice(0, 200),
                  tool: undefined,
                  expectedOutput: "Completed",
                })
              }

              // Create proper agentic-skill/v1 format definition
              const def = createSkillDefinition(
                title,
                title,
                keywords,
                steps.map(s => ({
                  action: s.action,
                  description: s.description,
                  tool: s.tool,
                  expectedOutput: s.expectedOutput,
                })),
                [cat],
              )

              // Build full SkillRecord for RAG + SkillStore
              const skillRecord = {
                definition: def,
                usageCount: 1,
                successRate: 1.0,
                successWindow: [true],
                lastUsed: new Date().toISOString(),
              }

              // Index in RAG for in-session search
              multiIndexRAG.indexSkill(cat, skillRecord)

              // Also persist to SkillStore (disk-backed, survives restart)
              skillStore.importFromEnvelope(JSON.stringify(createMemoryEnvelope(def, "skill")))
              stateStore.set("skills", def.meta.id, def)

              return {
                output: `## ✅ Stored as Skill (agentic-skill/v1)\n\n**Category:** ${cat}\n**Title:** ${title}\n**Steps:** ${steps.length}\n**Keywords:** ${keywords.join(", ")}\n\nSkill saved to both RAG (in-session) and SkillStore (disk-persistent).`,
                metadata: { category: cat, skillId: def.meta.id },
              }
            } else {
              // Store as an episode
              const decisions = content ? content.split("\n").filter(l => l.startsWith("-") || l.startsWith("*")).map(l => l.replace(/^[-*\s]+/, "")).slice(0, 10) : []
              const episode = {
                id: `rag-ep-${Date.now()}`,
                sessionId: context.sessionID,
                planGoal: title,
                summary: content.slice(0, 500),
                outcome: "success" as const,
                decisions,
                filesChanged: [],
                timestamp: new Date().toISOString(),
                tags: content.toLowerCase().match(/\b[a-z]{4,}\b/g)?.slice(0, 8) ?? [],
                score: 1.0,
                usageCount: 0,
                significance: "routine",
              }
              multiIndexRAG.indexEpisode(cat, episode as Episode)

              return {
                output: `## ✅ Stored as Episode\n\n**Category:** ${cat}\n**Title:** ${title}\n**Tags:** ${episode.tags.join(", ")}`,
                metadata: { category: cat },
              }
            }
          }

          case "clear": {
            const clearCat = args.category || "automotive"
            const statsBefore = multiIndexRAG.getStats().perCategory[clearCat]
            multiIndexRAG.clearCategory(clearCat)
            return {
              output: `## 🗑️ RAG Category Cleared\n\n**Category:** ${clearCat}\n**Removed:** ${statsBefore?.episodes ?? 0} episodes, ${statsBefore?.skills ?? 0} skills`,
              metadata: { category: clearCat, cleared: true },
            }
          }

          case "edit": {
            const eq = args.query || ""
            if (!eq) return { output: "Query diperlukan untuk mencari entry yang akan diedit." }
            const eCat = args.category
            let eTarget: import("../memory/multi-index-rag.js").IndexEntry | undefined
            if (eCat) {
              const er = await multiIndexRAG.searchByCategoryAsync(eq, eCat, 1)
              eTarget = er.entries[0]
            } else {
              const er = await multiIndexRAG.searchAllAsync(eq, 1)
              eTarget = er.flatMap(r => r.entries)[0]
            }
            if (!eTarget) return { output: `Tidak menemukan entry untuk "${eq}".` }
            const newContent = args.content
            if (!newContent) return { output: "Parameter `content` diperlukan untuk update konten entry." }
            // Find and update the episode in-memory
            const targetCat = eTarget.category
            const catIndex = (multiIndexRAG as unknown as {
              indices: Map<string, { episodes: import("../memory/episodic-store.js").Episode[]; skills: import("../memory/skill-store.js").SkillRecord[] }>
            }).indices.get(targetCat)
            if (!catIndex) return { output: `Category "${targetCat}" not found.` }
            const epId = eTarget.episode?.id
            if (epId) {
              const idx = catIndex.episodes.findIndex(e => e.id === epId)
              if (idx >= 0) {
                catIndex.episodes[idx].summary = newContent
                // Re-index in vector store
                multiIndexRAG.vectorStore.index({
                  id: `ep-${epId}`,
                  category: targetCat,
                  title: catIndex.episodes[idx].planGoal,
                  content: `${newContent}\n${catIndex.episodes[idx].decisions.join("\n")}`,
                  keywords: catIndex.episodes[idx].tags,
                  metadata: { type: "episode", episodeId: epId },
                })
                return { output: `## ✅ Entry Updated\n\n**Title:** ${eTarget.title}\n**Category:** ${targetCat}\n**New summary:** ${newContent.slice(0, 200)}...` }
              }
            }
            return { output: "Entry ditemukan tapi gagal di-update." }
          }

          case "delete": {
            const dq2 = args.query || ""
            if (!dq2) return { output: "Query diperlukan untuk mencari entry yang akan dihapus." }
            const dCat2 = args.category
            let dTarget: import("../memory/multi-index-rag.js").IndexEntry | undefined
            if (dCat2) {
              const dr2 = await multiIndexRAG.searchByCategoryAsync(dq2, dCat2, 1)
              dTarget = dr2.entries[0]
            } else {
              const dr2 = await multiIndexRAG.searchAllAsync(dq2, 1)
              dTarget = dr2.flatMap(r => r.entries)[0]
            }
            if (!dTarget) return { output: `Tidak menemukan entry untuk "${dq2}".` }
            const delCat = dTarget.category
            const delId = dTarget.episode?.id
            if (delId) {
              const catIdx = (multiIndexRAG as unknown as {
                indices: Map<string, { episodes: import("../memory/episodic-store.js").Episode[]; skills: import("../memory/skill-store.js").SkillRecord[] }>
              }).indices.get(delCat)
              if (catIdx) {
                const before = catIdx.episodes.length
                catIdx.episodes = catIdx.episodes.filter(e => e.id !== delId)
                multiIndexRAG.vectorStore.remove(`ep-${delId}`)
                return { output: `## 🗑️ Entry Deleted\n\n**Title:** ${dTarget.title}\n**Category:** ${delCat}\n**Removed:** ${before - catIdx.episodes.length} entry` }
              }
            }
            return { output: "Entry ditemukan tapi gagal dihapus." }
          }

          case "reload": {
            const saved = stateStore.getAll("rag")
            let loaded = 0
            for (const item of saved) {
              multiIndexRAG.importAll(item.data as import("../memory/multi-index-rag.js").IndexData)
              loaded++
            }
            return { output: `## 🔄 RAG Reloaded\n\n**Namespaces loaded:** ${loaded}\n**Stats setelah reload:** ${multiIndexRAG.getStats().totalEpisodes} episodes, ${multiIndexRAG.getStats().totalSkills} skills across ${multiIndexRAG.getStats().categories.length} categories` }
          }

          case "stats": {
            const stats = multiIndexRAG.getStats()
            const lines = [
              `## 📊 RAG Statistics`,
              `**Total Episodes:** ${stats.totalEpisodes}`,
              `**Total Skills:** ${stats.totalSkills}`,
              `**Categories:** ${stats.categories.join(", ")}`,
              ``,
              `### Per Category`,
            ]
            for (const [cat, data] of Object.entries(stats.perCategory)) {
              lines.push(`- **${cat}**: ${data.episodes} episodes, ${data.skills} skills`)
            }
            return {
              output: lines.join("\n"),
              metadata: { stats },
            }
          }

          case "categories": {
            const cats = multiIndexRAG.getStats().categories
            return {
              output: `## 📂 RAG Categories\n\nAvailable: ${cats.join(", ")}\n\n> 💡 Use \`agentic_router\` to auto-detect the best category for a query.`,
              metadata: { categories: cats },
            }
          }

          default:
            return { output: "Unknown action. Use: search, store, stats, categories, list, clear" }
        }
      },
  }
}
