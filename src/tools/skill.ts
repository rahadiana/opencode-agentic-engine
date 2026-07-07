import { tool } from "@opencode-ai/plugin"
import type { ToolSpec } from "./types.js"
import type { ToolContext } from "./tool-context.js"

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
      description: "Manage reusable skills extracted from successful task completions. Use 'extract' to create a skill from a completed step. Use 'find' to search existing skills. Use 'capability' for exact-match lookup. Use 'clear' to delete all skills.",
      args: {
        action: tool.schema.enum(["extract", "find", "list", "capability", "clear"]).describe("'extract' creates a skill; 'find' searches; 'list' shows all; 'capability' exact-match lookup; 'clear' deletes all skills"),
        query: tool.schema.string().optional().describe("Search query, extraction target (stepId), or capability string"),
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
