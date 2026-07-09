import { tool } from "@opencode-ai/plugin"
import type { ToolSpec } from "./types.js"
import type { ToolContext } from "./tool-context.js"
import { getSecondBrain } from "../memory/second-brain.js"

export function makeMemoTool(ctx: ToolContext): ToolSpec {
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
    techDebtScorer: _techDebtScorer,
    constraintManifold: _constraintManifold,
    navigator: _navigator,
    toolRouter: _toolRouter,
    routerAgent: _routerAgent,
    skillStore: _skillStore,
    skillCurator: _skillCurator,
    episodicStore: _episodicStore,
    memoryOrchestrator: _memoryOrchestrator,
    secondBrain: _secondBrain,
    rag: _multiIndexRAG,
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
    stateStore: _stateStore,
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
  return {
      description: "Second Brain: manage decisions (ADR), TODOs, run reflection, and inspect knowledge graph. Actions: decision (record ADR), todo (add/list/update/done), list (show pending), reflect (run reflection), graph (entity relations).",
      args: {
        action: tool.schema.enum(["decision", "todo", "todo-done", "list", "reflect", "graph"]).describe("Action: decision (record ADR), todo (add item), todo-done (mark done), list (show pending), reflect (run reflection), graph (entity relations)"),
        title: tool.schema.string().optional().describe("Decision title (for action=decision)"),
        context: tool.schema.string().optional().describe("Decision context/rationale (for action=decision)"),
        alternatives: tool.schema.string().optional().describe("Alternative options considered (for action=decision)"),
        consequence: tool.schema.string().optional().describe("Expected consequence (for action=decision)"),
        text: tool.schema.string().optional().describe("TODO text (for action=todo)"),
        priority: tool.schema.enum(["low", "medium", "high", "critical"]).optional().describe("TODO priority (for action=todo)"),
        category: tool.schema.string().optional().describe("TODO/Search category (optional)"),
        todoId: tool.schema.string().optional().describe("TODO ID (for action=todo-done)"),
        source: tool.schema.string().optional().describe("Entity name (for action=graph)"),
        target: tool.schema.string().optional().describe("Related entity name (for action=graph)"),
        relation: tool.schema.string().optional().describe("Relation type (for action=graph)"),
      },
      execute: async (args: Record<string, unknown>, _context: Record<string, unknown>) => {
        const context = _context as Record<string, unknown>
        const sb = getSecondBrain()
        if (!sb) return { output: "Second Brain not initialized." }

        switch (args.action) {
          case "decision": {
            if (!args.title || !args.context) return { output: "`title` and `context` are required for decisions." }
            const dec = sb.addDecision({
              title: args.title as string,
              context: args.context as string,
              alternatives: args.alternatives as string | undefined,
              consequence: args.consequence as string | undefined,
              sessionId: context.sessionID as string,
            })
            return { output: `✅ Decision recorded: **${dec.title}**\nID: \`${dec.id}\`` }
          }

          case "todo": {
            if (!args.text) return { output: "`text` is required for TODOs." }
            const todo = sb.addTodo({
              text: args.text as string,
              priority: (args.priority as "low" | "medium" | "high" | "critical") ?? "medium",
              category: args.category as string | undefined,
              sessionId: context.sessionID as string,
            })
            return { output: `✅ TODO added: **${todo.text}** [${todo.priority}]\nID: \`${todo.id}\`` }
          }

          case "todo-done": {
            if (!args.todoId) return { output: "`todoId` is required." }
            const ok = sb.updateTodoStatus(args.todoId as string, "done")
            return { output: ok ? `✅ TODO \`${args.todoId}\` marked done.` : `⚠️ TODO \`${args.todoId}\` not found.` }
          }

          case "list": {
            const todos = sb.getPendingTodos(20)
            const decisions = sb.getRecentDecisions(10)
            const lines: string[] = []
            if (todos.length > 0) {
              lines.push("### 📋 Pending TODOs")
              lines.push(todos.map(t => `- [${t.priority}] \`${t.id.slice(0, 20)}\` ${t.text}${t.category ? ` (${t.category})` : ""}`).join("\n"))
            } else {
              lines.push("No pending TODOs.")
            }
            if (decisions.length > 0) {
              lines.push("\n### 🏛️ Recent Decisions")
              lines.push(decisions.map(d => `- **${d.title}**: ${d.context.slice(0, 120)}`).join("\n"))
            }
            const reflection = sb.getLatestReflection()
            if (reflection) {
              lines.push(`\n### 🔄 Last Reflection\n${reflection.summary.slice(0, 200)}`)
              if (reflection.actionItems.length > 0) {
                lines.push(`Action items: ${reflection.actionItems.join(", ")}`)
              }
            }
            return { output: lines.join("\n") || "No Second Brain data yet." }
          }

          case "reflect": {
            const reflection = await sb.reflect(context.sessionID as string)
            let out = `## 🔄 Reflection Complete\n\n${reflection.summary}`
            if (reflection.conflicts.length > 0) out += `\n\n**Conflicts found:**\n${reflection.conflicts.map(c => `- ${c}`).join("\n")}`
            if (reflection.planUpdates.length > 0) out += `\n\n**Plan updates:**\n${reflection.planUpdates.map(p => `- ${p}`).join("\n")}`
            if (reflection.newInfo.length > 0) out += `\n\n**New info:**\n${reflection.newInfo.map(n => `- ${n}`).join("\n")}`
            if (reflection.actionItems.length > 0) out += `\n\n**Action items created:**\n${reflection.actionItems.map(a => `- ${a}`).join("\n")}`
            return { output: out }
          }

          case "graph": {
            if (args.source && args.target && args.relation) {
              sb.addEdge({
                source: args.source as string,
                target: args.target as string,
                relation: args.relation as string,
              })
              return { output: `✅ Relation: \`${args.source}\` --[${args.relation}]--> \`${args.target}\`` }
            }
            // List graph
            if (args.source) {
              const neighbors = sb.findNeighbors(args.source as string)
              return { output: neighbors.length > 0
                ? `🔗 Relations for **${args.source}**: ${neighbors.join(", ")}`
                : `No relations found for **${args.source}**.` }
            }
            const edges = sb.getEdges()
            if (edges.length === 0) return { output: "No relations recorded yet." }
            return { output: `🔗 **${edges.length} relations**\n${edges.slice(0, 20).map(e => `- \`${e.source}\` --[${e.relation}]--> \`${e.target}\``).join("\n")}` }
          }

          default:
            return { output: `Unknown action: ${args.action}. Use: decision, todo, todo-done, list, reflect, graph.` }
        }
      },
  }
}
