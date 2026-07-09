import { tool } from "@opencode-ai/plugin"
import type { ToolSpec } from "./types.js"
import type { ToolContext } from "./tool-context.js"
import { scanSkillContent, formatSecurityReport, detectProvenance } from "../memory/skill-security.js"
import { parseSkillMd, convertSkillMdToDefinition } from "../memory/skill-md-importer.js"
import { createMemoryEnvelope } from "../memory/schema-version.js"
import type { ProvenanceInfo, TrustLevel } from "../memory/skill-security.js"

export function makeSkillTool(ctx: ToolContext): ToolSpec {
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
      description: "Manage reusable skills extracted from successful task completions. Use 'extract' to create a skill from a completed step. Use 'find' to search existing skills. Use 'capability' for exact-match lookup. Use 'import-md' to securely import a SKILL.md from a URL (with security scanning + trust taxonomy). Use 'clear' to delete all skills.",
      args: {
        action: tool.schema.enum(["extract", "find", "list", "capability", "clear", "import-md"]).describe("'extract' creates a skill; 'find' searches; 'list' shows all; 'capability' exact-match lookup; 'import-md' imports external SKILL.md with security scan; 'clear' deletes all skills"),
        query: tool.schema.string().optional().describe("Search query, extraction target (stepId), capability string, or URL for import-md"),
        description: tool.schema.string().optional().describe("Optional description or context"),
      },
      async execute(args, context) {
        if (args.action === "extract") {
          const stepId = args.query
          if (!stepId) return { output: "Provide a stepId as query to extract a skill from." }

          const stepState = executor.getStepState(context.sessionID, stepId)
          if (!stepState?.result) return { output: `No execution record for step "${stepId}".` }

          const skill = await skillStore.extract({
            role: "tool",
            content: stepState.result.output,
          })

          if (!skill) return { output: `Could not extract a skill from step "${stepId}". The output pattern is not recognized.` }

          stateStore.set("skills", skill.definition.meta.id, skill.definition)

          let out = `## 🧠 Skill Extracted\n\n**Name:** ${skill.definition.meta.name}\n**Pattern:** \`${skill.definition.trigger.pattern}\`\n**Steps:** ${skill.definition.workflow.steps.length}\n**Success rate:** ${(skill.successRate * 100).toFixed(0)}%\n`
          if (skill.definition.trigger.capability) out += `**Capability:** \`${skill.definition.trigger.capability}\`\n`
          if (skill.definition.input_schema) out += `**Input Schema:** ${Object.keys(skill.definition.input_schema).length} fields\n`
          if (skill.definition.output_schema) out += `**Output Schema:** ${Object.keys(skill.definition.output_schema).length} fields\n`
          if (skill.definition.logic) out += `**DSL Logic:** ${skill.definition.logic.instructions.length} instructions\n`
          out += `\n\`\`\`\n${skill.definition.workflow.steps.map(s => s.description).join("\n")}\n\`\`\``
          return { output: out }
        }

        if (args.action === "import-md") {
          const url = args.query || args.description
          if (!url) return { output: "Provide a url as query to import a SKILL.md from. Example: agentic_skill action=import-md query=https://raw.githubusercontent.com/addyosmani/agent-skills/main/skills/code-review-and-quality/SKILL.md" }

          try {
            // ── Fetch the SKILL.md content ──
            let content: string
            try {
              const resp = await fetch(url as string)
              if (!resp.ok) return { output: `Failed to fetch URL: HTTP ${resp.status} ${resp.statusText}` }
              content = await resp.text()
              if (!content || content.length < 50) return { output: `Fetched content too short (${content?.length ?? 0} chars) — not a valid SKILL.md` }
            } catch (fetchErr) {
              return { output: `Failed to fetch URL: ${(fetchErr as Error).message}. Make sure the URL is a raw GitHub URL pointing to a SKILL.md file.` }
            }

            // ── Layer 1: Security Scan ──
            const scanResult = scanSkillContent(content, url as string)

            // ── Parse SKILL.md ──
            const parsed = parseSkillMd(content)

            // If blocked, show scan result immediately
            if (!scanResult.safe) {
              let out = formatSecurityReport(scanResult)
              out += `\n\n**❌ Import blocked.** This skill contains patterns that are too dangerous to import.\n`
              out += `If you believe this is a false positive, you can:\n`
              out += `1. Copy the content manually, review each step\n`
              out += `2. Create the skill manually via \`agentic_skill action=extract\` from a safe step\n`
              return { output: out }
            }

            if (!parsed) {
              return { output: `Could not parse SKILL.md from "${url}". The file may not be in the correct SKILL.md format (needs YAML frontmatter with name and description).\n\nRaw scan: ${scanResult.summary}` }
            }

            // ── Convert to SkillDefinition ──
            const def = convertSkillMdToDefinition(parsed)
            if (!def) return { output: `Could not convert SKILL.md to internal format. The content appears valid as SKILL.md but conversion failed.` }

            // ── Set Provenance Information ──
            const provenance = detectProvenance(url as string)
            const trustLevel: TrustLevel = scanResult.trustLevel
            const provenanceInfo: ProvenanceInfo = {
              sourceUrl: url as string,
              trustLevel,
              importedAt: new Date().toISOString(),
              importedBy: "human",
              knownSources: provenance ? [provenance.name] : [],
              successCount: 0,
              securityWarnings: scanResult.warnings.map(w => w.message),
            }

            // ── Import to SkillStore ──
            skillStore.importFromEnvelope(
              createMemoryEnvelope({ ...def }, "skill"),
              provenanceInfo,
            )

            // ── Report ──
            let out = formatSecurityReport(scanResult)
            out += `\n`

            if (trustLevel === "blocked") {
              out += `## ❌ Import Blocked\n\nSecurity scan detected critical issues. This skill cannot be imported.`
              return { output: out }
            }

            out += `## ✅ Skill Imported: "${parsed.frontmatter.name}"\n\n`
            out += `**Source:** ${url}\n`
            out += `**Trust Level:** ${trustLevel.toUpperCase()}\n`
            out += `**Steps:** ${parsed.steps.length}\n`
            out += `**Anti-Rationalizations:** ${parsed.antiRationalizations.length}\n`
            out += `**Red Flags:** ${parsed.redFlags.length}\n`
            out += `**Verification Criteria:** ${parsed.verificationCriteria.length}\n\n`

            if (trustLevel === "karantina") {
              out += `⚠️ **This skill is in KARANTINA.** It cannot be used until reviewed and promoted.\n`
              out += `To promote: \`agentic_skill action=promote-trust query="${def.meta.id}"\`\n\n`
            } else if (trustLevel === "low") {
              out += `⚠️ **Low trust level.** Each step will require explicit approval before execution.\n\n`
            }

            out += `### Workflow\n`
            out += parsed.steps.map((s, i) => `${i + 1}. **${s.action}** — ${s.description.slice(0, 120)}`).join("\n")

            if (parsed.antiRationalizations.length > 0) {
              out += `\n\n### Anti-Rationalizations (${parsed.antiRationalizations.length})\n`
              out += parsed.antiRationalizations.slice(0, 3).map(ar =>
                `- ❓ "${ar.rationalization}" → ✅ ${ar.reality}`
              ).join("\n")
              if (parsed.antiRationalizations.length > 3) out += `\n- ... and ${parsed.antiRationalizations.length - 3} more`
            }

            if (parsed.verificationCriteria.length > 0) {
              out += `\n\n### Verification\n`
              out += parsed.verificationCriteria.map(v => `- [ ] ${v}`).join("\n")
            }

            // Persist
            stateStore.set("skills", def.meta.id, { ...def, provenance: provenanceInfo })

            return { output: out }
          } catch (e) {
            return { output: `Error importing skill: ${(e as Error).message}` }
          }
        }

        if (args.action === "capability") {
          if (!args.query) return { output: "Provide a capability string (e.g. 'auth.login')." }
          const skill = skillStore.findByCapability(args.query)
          if (!skill) return { output: `No skill with capability "${args.query}".` }
          let out = `## 🎯 Skill by Capability: "${args.query}"\n\n`
          out += `**Name:** ${skill.definition.meta.name}\n`
          out += `**Success rate:** ${(skill.successRate * 100).toFixed(0)}% (${skill.usageCount} uses)\n`
          out += `**Pattern:** \`${skill.definition.trigger.pattern}\`\n`
          if (skill.definition.input_schema) out += `**Input Schema:** ${Object.keys(skill.definition.input_schema).length} fields\n`
          if (skill.definition.output_schema) out += `**Output Schema:** ${Object.keys(skill.definition.output_schema).length} fields\n`
          if (skill.definition.logic) out += `**DSL Logic:** ${skill.definition.logic.instructions.length} instructions\n`
          out += `\n### Workflow\n`
          out += skill.definition.workflow.steps.map(s => `${s.order}. **${s.action}** — ${s.description}`).join("\n")
          return { output: out }
        }

        if (args.action === "find") {
          if (!args.query) return { output: "Provide a search query." }
          const skills = skillStore.find(args.query)
          if (skills.length === 0) return { output: `No skills found for "${args.query}".` }
          let output = `## 🔍 Skills Matching "${args.query}"\n\n`
          output += skills.map(s => {
            let line = `- **${s.definition.meta.name}** (${(s.successRate * 100).toFixed(0)}% success, ${s.usageCount} uses)\n  Pattern: \`${s.definition.trigger.pattern}\``
            if (s.definition.trigger.capability) line += `\n  Capability: \`${s.definition.trigger.capability}\``
            if (s.definition.logic) line += `\n  DSL: ${s.definition.logic.instructions.length} instructions`
            if (s.definition.input_schema) line += `\n  Input: ${Object.keys(s.definition.input_schema).length} fields`
            // Show curator lifecycle
            line += `\n  Lifecycle: ${skillCurator.getLifecycle(s)}`
            return line
          }).join("\n")
          output += `\n\n> 💡 Skills shown from all past sessions. Auto-inject (top-3 most relevant) happens automatically in your prompt.\n> Use \`agentic_skill action=capability query="...exact..."\` for exact-match lookup.`
          return { output }
        }

        if (args.action === "clear") {
          const count = skillStore.clearAll()
          return { output: `## 🗑️ Skills Cleared\n\nRemoved **${count}** skills from the library.` }
        }

        const skills = skillStore.getAll()
        if (skills.length === 0) return { output: "No skills yet. Complete tasks and use `action: \"extract\"` to build the skill library." }

        let output = `## 🧠 Skill Library (${skills.length})\n\n`
        output += skills.map(s => {
          let line = `- **${s.definition.meta.name}** — ${(s.successRate * 100).toFixed(0)}% (${s.usageCount} uses)`
          if (s.definition.trigger.capability) line += ` [${s.definition.trigger.capability}]`
          return line
        }).join("\n")
        return { output }
      },
  }
}
