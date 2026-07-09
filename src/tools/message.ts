import { tool } from "@opencode-ai/plugin"
import type { ToolSpec } from "./types.js"
import type { ToolContext } from "./tool-context.js"

export function makeMessageTool(ctx: ToolContext): ToolSpec {
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
    coordinator,
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
      description: "Inter-agent messaging system. Send messages between agent roles, request reviews, check inbox, and view conversation threads. Part of the multi-agent coordination framework.",
      args: {
        action: tool.schema.enum(["send", "inbox", "conversation", "mark-read"]).describe("'send' to send a message; 'inbox' to check messages; 'conversation' to view a thread; 'mark-read' to acknowledge a message"),
        to: tool.schema.string().optional().describe("Recipient role (for send action)"),
        taskId: tool.schema.string().optional().describe("Task ID this message relates to (for send/conversation)"),
        message: tool.schema.string().optional().describe("Message content (for send action)"),
        type: tool.schema.enum(["result", "review_request", "review_response", "clarification", "approval", "revision"]).optional().describe("Message type (for send action)"),
        messageId: tool.schema.string().optional().describe("Message ID to mark as read (for mark-read action)"),
      },
      async execute(args, context) {
        switch (args.action) {
          case "send": {
            if (!args.to || !args.message) return { output: "`to` and `message` required." }
            const msg = coordinator.sendMessage({
              from: (context as { agent?: string }).agent ?? "user",
              to: args.to,
              taskId: args.taskId ?? "general",
              type: args.type ?? "clarification",
              payload: args.message,
            })
            return {
              output: `## 📨 Message Sent\n\n**From:** ${msg.from}\n**To:** ${msg.to}\n**Type:** ${msg.type}\n**ID:** \`${msg.id}\`\n\n${msg.payload.slice(0, 500)}`,
            }
          }

          case "inbox": {
            const role = (context as { agent?: string }).agent ?? "user"
            const messages = coordinator.getMessages(role, true)
            if (messages.length === 0) return { output: "📭 No unread messages." }

            let out = `## 📬 Inbox (${messages.length} unread)\n\n`
            for (const msg of messages) {
              out += `**${msg.type.toUpperCase()}** from **${msg.from}** [\`${msg.id}\`]\n`
              out += `Task: \`${msg.taskId}\` | ${new Date(msg.timestamp).toLocaleTimeString()}\n`
              out += `> ${msg.payload.slice(0, 200)}\n\n`
            }
            return { output: out }
          }

          case "conversation": {
            if (!args.taskId) return { output: "taskId required." }
            const thread = coordinator.getConversation(args.taskId)
            if (thread.length === 0) return { output: `No messages for task "${args.taskId}".` }

            let out = `## 💬 Conversation: \`${args.taskId}\`\n\n`
            for (const msg of thread) {
              const icon = msg.type === "approval" ? "✅" : msg.type === "review_request" ? "🔍" : msg.type === "revision" ? "🔄" : "💬"
              out += `${icon} **${msg.from}** → **${msg.to}** (${msg.type})\n`
              out += `> ${msg.payload.slice(0, 300)}\n\n`
            }
            return { output: out }
          }

          case "mark-read": {
            if (!args.messageId) return { output: "messageId required." }
            const ok = coordinator.markRead(args.messageId)
            return { output: ok ? `✅ Message \`${args.messageId}\` marked as read.` : `Message \`${args.messageId}\` not found.` }
          }

          default:
            return { output: `Unknown action "${args.action}". Available: send, inbox, conversation, mark-read.` }
        }
      },
  }
}
