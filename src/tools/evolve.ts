import { tool } from "@opencode-ai/plugin"
import type { ToolSpec } from "./types.js"
import type { ToolContext } from "./tool-context.js"
import { join } from "node:path"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { getSecondBrain } from "../memory/second-brain.js"
import { getSchemaVersion, getBlueprintParser, getBlueprintResolver } from "../core/shared-instances.js"
import { skillsToTrainingData, trainingDatasetSummary, skillToTrainingExample } from "../memory/skill-training.js"
import { createMemoryEnvelope, MemorySchemaVersion } from "../memory/schema-version.js"
import { createSkillDefinition, serializeSkill, inspectSkill } from "../memory/skill-format.js"
import { gatherEvolutionData } from "../evolution/auto-evolve.js"

export function makeEvolveTool(ctx: ToolContext): ToolSpec {
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
  const _debtScorer = techDebtScorer
  const _curator = skillCurator
return {
  description: "Inspect and extend the agent system itself (Stage IV). Register custom agent roles, define versioned memory schemas, and export skills in self-describing format for other agents to consume.",
  args: {
      action: tool.schema.enum(["inspect", "register-role", "export-skill", "memory-schema", "evolve", "read-prompt", "edit-prompt", "prompt-history", "rollback-prompt", "export-training-data"]).describe("What to do: inspect system state, register a custom agent role, export a skill, view memory schema, run self-evolution, manage agent prompts (Stage IV), or export skills as training data for fine-tuning"),
      name: tool.schema.string().optional().describe("Role name or skill name (for register-role, export-skill)"),
      prompt: tool.schema.string().optional().describe("Agent prompt template (for register-role) or new instruction to append (for edit-prompt)"),
      tools: tool.schema.array(tool.schema.string()).optional().describe("Tools available to custom role"),
      skillId: tool.schema.string().optional().describe("Skill ID to export or inspect"),
      role: tool.schema.string().optional().describe("Agent role (for read-prompt, edit-prompt, prompt-history, rollback-prompt)"),
      version: tool.schema.number().optional().describe("Version number (for rollback-prompt)"),
      description: tool.schema.string().optional().describe("Description for the prompt change (for edit-prompt)"),
      format: tool.schema.enum(["openai", "instructions"]).optional().describe("Output format for training data (for export-training-data, default: openai)"),
      minSuccessRate: tool.schema.number().optional().describe("Minimum skill success rate to include (for export-training-data, default: 0.5)"),
      spec: tool.schema.string().optional().describe("Blueprint YAML/JSON spec (for register-role). Overrides prompt/tools with blueprint fields. Contoh: `spec=\"\"\"\\nagent:\\n  identity: 'You are a...'\\n  model_tiers:\\n    default: capable\\n  tools: [read, edit]\\n\"\"\"`"),
    },
    async execute(args, _context) {
      switch (args.action) {
        case "inspect": {
          const builtIn = roleRegistry.getAllBuiltIn()
          const custom = roleRegistry.getAllCustom()
          const sv = getSchemaVersion()
          const migrations = sv && typeof (sv as any).getMigrations === "function" ? (sv as any).getMigrations() : []

          let out = `## 🔮 Agent System State (Stage IV)\n\n`
          out += `**Memory schema version:** ${MemorySchemaVersion.currentVersion()}\n`
          out += `**Registered migrations:** ${migrations.length}\n\n`
          out += `### Built-in Roles (${builtIn.length})\n`
          for (const r of builtIn) {
            out += `- **${r.name}** (\`${r.role}\`) — ${r.tools.length} tools\n`
          }
          if (custom.length > 0) {
            out += `\n### Custom Roles (${custom.length})\n`
            for (const r of custom) {
              out += `- **${r.name}** (\`${r.role}\`) — ${r.tools.length} tools\n`
            }
          }
          out += `\n### Extensibility\n`
          out += `- Custom roles: \`agentic_evolve register-role\`\n`
          out += `- Export skills: \`agentic_evolve export-skill\`\n`
          out += `- Schema info: \`agentic_evolve memory-schema\`\n`
          return { output: out }
        }

        case "register-role": {
          // Blueprint mode: spec YAML/JSON → parse + register
          if (args.spec) {
            try {
              const blueprint = (getBlueprintParser() as any).parse(args.spec)
              const roleId = blueprint.metadata.name.toLowerCase().replace(/\s+/g, "-")

              // Resolve model tiers → actual model recommendations
              const allModels = modelRegistry.getAllScores().map(s => s.model)
              const resolvedTiers = (getBlueprintResolver() as any).resolveBlueprint(blueprint, allModels.length > 0 ? allModels : ["default"])

              const tierInfo = Object.entries(resolvedTiers)
                .map(([tier, model]) => `  - **${tier}** → \`${model}\``)
                .join("\n")

              roleRegistry.registerCustom({
                role: roleId,
                name: blueprint.metadata.name,
                prompt: blueprint.agent.identity,
                tools: blueprint.agent.tools ?? ["read", "edit", "write", "bash", "agentic_verify", "agentic_skill"],
              })

              stateStore.set("evolution", "trend", continuousEvolution.toJSON(), projectId)

              let out = `### ✅ Blueprint Registered: **${blueprint.metadata.name}** (\`${roleId}\`)\n\n`
              out += `**Identity:** ${blueprint.agent.identity.slice(0, 100)}...\n`
              out += `\n**Model Tiers Resolved:**\n${tierInfo}\n`
              if (blueprint.agent.capabilities?.length) {
                out += `\n**Capabilities:** ${blueprint.agent.capabilities.join(", ")}\n`
              }
              if (blueprint.agent.safety?.max_steps) {
                out += `\n**Safety:** max_steps=${blueprint.agent.safety.max_steps}\n`
              }
              out += `\nPakai: \`agentic_delegate role=${roleId}\``
              out += `\nExport ke file: \`agentic_evolve export-blueprint name=${roleId}\``
              return { output: out }
            } catch (e) {
              return { output: `❌ Blueprint parse error: ${(e as Error).message}\n\nGunakan format YAML atau JSON yang valid. Contoh:\n\`\`\`yaml\nagent:\n  identity: "You are a developer"\n  model_tiers:\n    default: capable\n\`\`\`` }
            }
          }

          // Legacy mode: name + prompt + tools
          if (!args.name || !args.prompt) {
            return { output: "Both `name` and `prompt` are required to register a custom role.\n\nAtau gunakan `spec` parameter dengan blueprint format:\n`agentic_evolve register-role spec='{\"agent\":{\"identity\":\"...\",\"model_tiers\":{\"default\":\"capable\"}}}'`" }
          }
          const roleId = args.name.toLowerCase().replace(/\s+/g, "-")
          roleRegistry.registerCustom({
            role: roleId,
            name: args.name,
            prompt: args.prompt,
            tools: args.tools ?? ["read", "edit", "write", "bash"],
          })
          // Auto-save evolution trend after role registration
          stateStore.set("evolution", "trend", continuousEvolution.toJSON(), projectId)
          return { output: `Custom role "${args.name}" registered as \`${roleId}\`. Available via \`agentic_delegate role=${roleId}\`.` }
        }

        case "export-skill": {
          const skillData = createSkillDefinition(
            args.name ?? "unnamed-skill",
            args.name ?? "generic pattern",
            args.tools ?? [],
            [{ action: "implement", description: args.name ?? "task", expectedOutput: "completed" }],
          )

          const json = serializeSkill(skillData)
          const inspection = inspectSkill(skillData)

          let out = inspection
          out += `\n\n### Machine-Readable Export (agentic-skill/v1)\n\`\`\`json\n${json}\n\`\`\``
          return { output: out }
        }

        case "memory-schema": {
          let out = `## 🧠 Memory Schema v${MemorySchemaVersion.currentVersion()}\n\n`
          out += `### Envelope Format\n\`\`\`ts\n${JSON.stringify(createMemoryEnvelope({ example: true }, "example"), null, 2)}\n\`\`\`\n\n`
          out += `### Registered Migrations\n`
          const sv2 = getSchemaVersion()
          const migrations = sv2 && typeof (sv2 as any).getMigrations === "function" ? (sv2 as any).getMigrations() : []
          if (migrations.length === 0) {
            out += `No migrations registered yet. Schema v${MemorySchemaVersion.currentVersion()} is current.\n`
          } else {
            for (const m of migrations) {
              out += `- v${m.from} → v${m.to}: ${m.description}\n`
            }
          }
          out += `\n### Upgrading\n`
          out += `Data is stored with \`schema_version\`. On read, the system auto-migrates from any version to current.\n`
          out += `New migrations can be registered via schema version API.\n`
          out += `\n### Compatibility\n`
          out += `All episodes, skills, and artifacts support schema evolution without data loss.\n`
          return { output: out }
        }

        case "evolve": {
          const { allEpisodes, allStepStates } = await gatherEvolutionData(ctx)

          // Feed execution data to MetaReasoner (Comparison 22)
          for (const state of allStepStates) {
            metaReasoner.recordExecution({
              taskId: state.stepId,
              success: state.success,
              retries: 0,
              timestamp: Date.now(),
            })
          }
          const metaAdaptation = metaReasoner.adapt()

          const report = selfEvolver.evolve()

          // Auto-apply role suggestions
          const appliedRoles: string[] = []
          for (const role of report.roleSuggestions) {
            try {
              coordinator.registerCustomRole({
                role: role.name,
                name: role.name,
                tools: role.suggestedTools,
                prompt: `You are ${role.name}. ${role.reason}\n\nTrigger: ${role.triggerPattern}`,
              })
              appliedRoles.push(role.name)
            } catch (e) { log.warn("Silent catch: non-fatal", { error: String(e) }) }
          }

          // Auto-apply skill patches
          const patchedSkills: string[] = []
          for (const patch of report.skillPatches) {
            const record = skillStore.getById(patch.skillId)
            if (!record) continue
            const def = record.definition
            let modified = false

            for (const change of patch.suggestedChanges) {
              if (change.type === "add_rollback") {
                for (const step of def.workflow.steps) {
                  if (!step.rollback) {
                    step.rollback = change.detail
                    modified = true
                  }
                }
              }
              if (change.type === "add_step") {
                const newStep: import("../memory/skill-format.js").SkillStep = {
                  order: def.workflow.steps.length + 1,
                  action: "verify",
                  description: change.detail,
                  expectedOutput: "Step completed successfully",
                }
                def.workflow.steps.push(newStep)
                modified = true
              }
            }

            if (modified) {
              def.quality.usageCount = record.usageCount
              def.quality.successRate = record.successRate
              def.audit.lastModified = new Date().toISOString()
              def.audit.modifiedBy = "system"
              def.meta.version++
              stateStore.set("skills", def.meta.id, def)
              patchedSkills.push(patch.skillName)
            }
          }

          let out = `## 🔮 Self-Evolution Report\n\n`
          out += `**Improvement Score:** ${report.improvementScore}/100\n`
          out += `**Sessions Analyzed:** ${report.metrics.totalSessions}\n`
          out += `**Steps Analyzed:** ${report.metrics.totalSteps}\n`
          out += `**Overall Success Rate:** ${(report.metrics.successRate * 100).toFixed(0)}%\n`
          out += `**Retry Rate:** ${(report.metrics.retryRate * 100).toFixed(0)}%\n\n`

          if (appliedRoles.length > 0) {
            out += `### ✅ Auto-Registered Roles\n`
            for (const name of appliedRoles) {
              out += `- **${name}** — registered automatically\n`
            }
            out += `\n`
          }

          // Auto-apply prompt patches (Stage IV: versioned, source-tracked)
          const appliedPatches: string[] = []
          for (const patch of report.promptPatches) {
            try {
              const existingPrompt = roleRegistry.getPrompt(patch.role)
              if (existingPrompt && !existingPrompt.includes(patch.instruction.slice(0, 40))) {
                const newPrompt = existingPrompt + `\n\n## Auto-Patched Instruction (from ${patch.errorCategory} errors)\n${patch.instruction}`
                roleRegistry.updatePrompt(patch.role as "architect" | "developer" | "qa" | "coordinator" | "pm", newPrompt, "auto-evolve", `Patch from ${patch.errorCategory} errors (${patch.occurrences}x)`)
                stateStore.set("prompts", "state", roleRegistry.getAllPromptStates())
                appliedPatches.push(`${patch.role}: "${patch.instruction.slice(0, 60)}..."`)
              }
            } catch (e) { log.warn("Silent catch: non-fatal", { error: String(e) }) }
          }

          if (patchedSkills.length > 0) {
            out += `### ✅ Auto-Patched Skills\n`
            for (const name of patchedSkills) {
              out += `- **${name}** — patched automatically\n`
            }
            out += `\n`
          }

          if (appliedPatches.length > 0) {
            out += `### ✅ Auto-Patched Prompts\n`
            for (const p of appliedPatches) {
              out += `- ${p}\n`
            }
            out += `\n`
          }

          out += `### Recommendations\n`
          if (report.metrics.recommendations.length === 0) {
            out += `All metrics within healthy ranges. No changes recommended.\n`
          } else {
            for (const rec of report.metrics.recommendations) {
              out += `- ${rec}\n`
            }
          }

          if (report.skillPatches.length > 0) {
            out += `\n### 🔧 Skill Patches (${report.skillPatches.length})\n`
            for (const patch of report.skillPatches) {
              out += `\n**${patch.skillName}** — ${patch.failures} failures\n`
              for (const change of patch.suggestedChanges) {
                out += `- [${change.type}] ${change.description}\n`
                out += `  → ${change.detail}\n`
              }
            }
          }

          if (report.roleSuggestions.length > 0) {
            out += `\n### 👥 Role Suggestions (${report.roleSuggestions.length})\n`
            for (const role of report.roleSuggestions) {
              out += `\n**${role.name}**\n`
              out += `- Trigger: "${role.triggerPattern}"\n`
              out += `- Tools: ${role.suggestedTools.map(t => `\`${t}\``).join(", ")}\n`
              out += `- Reason: ${role.reason}\n`
            }
          }

          if (report.metrics.topErrorCategories.length > 0) {
            out += `\n### 📊 Top Error Categories\n`
            for (const err of report.metrics.topErrorCategories) {
              out += `- **${err.category}**: ${err.count} occurrence(s)\n`
            }
          }

          if (report.promptPatches.length > 0) {
            out += `\n### 📝 Prompt Auto-Patches (${report.promptPatches.length})\n`
            for (const pp of report.promptPatches) {
              const priorityIcon = pp.priority === "high" ? "🔴" : pp.priority === "medium" ? "🟡" : "🟢"
              out += `${priorityIcon} **${pp.role}** — ${pp.errorCategory} (${pp.occurrences}x)\n`
              out += `  → ${pp.instruction}\n`
            }
          }

          // Cross-session pattern discovery (Gap #3)
          const allSkillsForPd = skillStore.getAll().map(s => ({
            name: s.definition.meta.name,
            successRate: s.successRate,
            usageCount: s.usageCount,
          }))
          const patternReport = patternDiscovery.analyze(allEpisodes, [], allSkillsForPd)
          if (patternReport.recommendations.length > 0) {
            out += `\n### 🔍 Cross-Session Patterns\n`
            out += `**Total sessions analyzed:** ${patternReport.totalSessions}\n\n`

            const highRecs = patternReport.recommendations.filter(r => r.priority === "high")
            if (highRecs.length > 0) {
              out += `**⚠️ High Priority (${highRecs.length})**\n`
              for (const rec of highRecs) {
                out += `- ${rec.description}\n`
                out += `  → ${rec.action}\n`
              }
              out += "\n"
            }

            const medRecs = patternReport.recommendations.filter(r => r.priority === "medium")
            if (medRecs.length > 0) {
              out += `**Medium Priority (${medRecs.length})**\n`
              for (const rec of medRecs) {
                out += `- ${rec.description}\n`
              }
              out += "\n"
            }

            if (patternReport.errorPatterns.length > 0) {
              out += `**Error Patterns:**\n`
              for (const ep of patternReport.errorPatterns) {
                out += `- \`${ep.category}\`: ${ep.sessionCount}/${patternReport.totalSessions} sessions (${(ep.sessionAffinity * 100).toFixed(0)}%)\n`
              }
              out += "\n"
            }

            if (patternReport.filePatterns.some(f => f.isHotSpot)) {
              out += `**Hot Spot Files:**\n`
              for (const fp of patternReport.filePatterns.filter(f => f.isHotSpot).slice(0, 5)) {
                out += `- \`${fp.filePath}\` → ${fp.sessionCount} sessions`
                if (fp.coChangedFiles.length > 0) {
                  out += ` (co-changed: ${fp.coChangedFiles.map(c => `\`${c.filePath}\``).join(", ")}`
                }
                out += ")\n"
              }
            }
          }

          // Meta-Reasoning Strategy Adaptation (Comparison 22)
          const metaStats = metaReasoner.getAdaptationStats()
          if (metaStats.totalRuns > 0) {
            out += `\n### 🧠 Meta-Reasoning Adaptation\n`
            out += `**Strategy:** \`${metaReasoner.getCurrentConfig().label}\` (v${metaReasoner.getCurrentVersion()})\n`
            out += `**Runs analyzed:** ${metaStats.totalRuns} | **Adaptations made:** ${metaStats.adaptationCount}\n`
            if (metaAdaptation.adapted) {
              out += `\n**Params adapted this cycle:**\n`
              for (const change of metaAdaptation.changes) {
                out += `- \`${change.name}\`: ${change.from} → ${change.to} (${change.reason})\n`
              }
            }
            if (metaAdaptation.rolledBack) {
              out += `\n⚠️ **Rolled back** to previous strategy version\n`
              for (const w of metaAdaptation.warnings) {
                out += `- ${w}\n`
              }
            }
            const metaPerf = metaReasoner.getCurrentPerformance()
            out += `\n**Current performance:** ${(metaPerf.successRate * 100).toFixed(0)}% success rate, ${metaPerf.avgRetries.toFixed(1)} avg retries\n`
          }

          // Auto-save evolution trend after evolve run
          stateStore.set("evolution", "trend", continuousEvolution.toJSON(), projectId)
          stateStore.set("evaluation", "live", liveEvaluator.toJSON(), projectId)
          return { output: out }
        }

        case "read-prompt": {
          const targetRole = args.role ?? "developer"
          const prompt = roleRegistry.getPrompt(targetRole)
          if (!prompt) return { output: `Role "${targetRole}" not found.` }
          const state = roleRegistry.getPromptState(targetRole)
          const ver = state?.currentVersion ?? 1
          return {
            output: `## 📖 Prompt for \`${targetRole}\` (v${ver})\n\n\`\`\`\n${prompt}\n\`\`\``,
          }
        }

        case "edit-prompt": {
          const targetRole = args.role ?? "developer"
          if (!args.prompt) return { output: "`prompt` (instruction to append) is required for edit-prompt." }
          const existingPrompt = roleRegistry.getPrompt(targetRole)
          if (!existingPrompt) return { output: `Role "${targetRole}" not found.` }
          const newPrompt = existingPrompt + `\n\n## Self-Patched Instruction (agent-driven)\n${args.prompt}`
          const updated = roleRegistry.updatePrompt(targetRole as "architect" | "developer" | "qa" | "coordinator" | "pm", newPrompt, "agent-self", args.description ?? "Agent self-modification")
          if (!updated) return { output: `Failed to update prompt for role "${targetRole}". Only built-in roles can be edited.` }
          stateStore.set("prompts", "state", roleRegistry.getAllPromptStates())
          return {
            output: `✅ Prompt for \`${targetRole}\` updated (v${roleRegistry.getPromptState(targetRole)?.currentVersion}). New instruction appended at the end.`,
          }
        }

        case "prompt-history": {
          const targetRole = args.role ?? "developer"
          const history = roleRegistry.getPromptHistory(targetRole)
          if (history.length === 0) return { output: `No prompt history for "${targetRole}".` }
          let out = `## 📜 Prompt History for \`${targetRole}\`\n\n`
          for (const entry of history) {
            const preview = entry.prompt.slice(-200).replace(/\n/g, " ")
            out += `**v${entry.version}** — ${entry.timestamp} — source: ${entry.source}`
            if (entry.description) out += ` — ${entry.description}`
            out += `\n\`\`\`\n...${preview.slice(-200)}\n\`\`\`\n\n`
          }
          return { output: out }
        }

        case "rollback-prompt": {
          const targetRole = args.role ?? "developer"
          const version = args.version
          if (!version) return { output: "`version` is required for rollback-prompt." }
          const history = roleRegistry.getPromptHistory(targetRole)
          if (history.length === 0) return { output: `No prompt history for "${targetRole}".` }
          const target = history.find(e => e.version === version)
          if (!target) return { output: `Version ${version} not found for "${targetRole}". Available versions: ${history.map(e => `v${e.version}`).join(", ")}` }
          const ok = roleRegistry.rollbackPrompt(targetRole, version)
          if (!ok) return { output: `Failed to rollback prompt for "${targetRole}".` }
          stateStore.set("prompts", "state", roleRegistry.getAllPromptStates())
          return {
            output: `✅ Prompt for \`${targetRole}\` rolled back to v${version} (from ${target.timestamp}).`,
          }
        }

        case "export-training-data": {
          const allSkills = skillStore.getAll()
          const fmt = args.format ?? "openai"
          const minRate = args.minSuccessRate ?? 0.5
          const dataset = skillsToTrainingData(allSkills, fmt, minRate)

          const filteredSkills = allSkills.filter(s => s.successRate >= minRate)
          const examples = filteredSkills.map(s => skillToTrainingExample(s))
          const summary = trainingDatasetSummary(examples)

          let out = summary
          out += `\n\n### Training Data (${dataset.format})\n`
          out += `\`\`\`\n${dataset.data.slice(0, 2000)}${dataset.data.length > 2000 ? "\n… (truncated)" : ""}\n\`\`\``
          if (dataset.data.length > 2000) {
            out += `\n\n**Full dataset:** ${dataset.data.length} characters, ${dataset.totalExamples} examples`
          }
          return { output: out }
        }

        default:
          return { output: `Unknown action: ${args.action}. Available: inspect, register-role, export-skill, memory-schema, evolve, read-prompt, edit-prompt, prompt-history, rollback-prompt, export-training-data.` }
      }
    },
}
}
