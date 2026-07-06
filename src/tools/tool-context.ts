/**
 * ToolContext — shared state passed to all tool group registration functions.
 *
 * This is a minimal interface capturing the subset of dependencies each tool
 * needs. Every property is intentionally optional in the type (but provided at
 * runtime) so that unit tests can inject only what they need.
 *
 * NOTE: Some properties are typed loosely to avoid circular deps between
 * tools/ and core/ directories. Runtime validation is the responsibility
 * of each tool's execute function.
 */

import type { SessionStore } from "../memory/session-store.js"
import type { DomainRegistry } from "../core/domain-registry.js"
import type { CodebaseNavigator } from "../core/navigator.js"
import type { Planner } from "../core/planner.js"
import type { Verifier } from "../core/verifier.js"
import type { BudgetTracker } from "../core/budget-tracker.js"
import type { EventBus } from "../core/event-bus.js"
import type { StateStore } from "../core/state-store.js"
import type { LLMEngine } from "../core/llm.js"
import type { GitIntegration } from "../core/git.js"
import type { TechDebtScorer } from "../core/tech-debt-scorer.js"
import type { AgentCoordinator } from "../agents/coordinator.js"
import type { Orchestrator } from "../agents/orchestrator.js"
import type { SkillStore } from "../memory/skill-store.js"
import type { SkillCurator } from "../curation/skill-curator.js"
import type { EpisodicStore } from "../memory/episodic-store.js"
import type { MemoryOrchestrator } from "../memory/memory-orchestrator.js"
import type { HallucinationGuard } from "../drift/hallucination-guard.js"
import type { Dashboard } from "../observability/dashboard.js"
import type { TraceLogger } from "../observability/trace-logger.js"
import type { CheckpointSystem } from "../drift/checkpoints.js"
import type { ParallelExecutor } from "../core/parallel.js"
import type { WorldModel } from "../core/world-model.js"
import type { SimulationEngine } from "../core/simulation-engine.js"
import type { MetaReasoner } from "../core/meta-reasoner.js"
import type { ModelRegistry } from "../core/model-registry.js"
import type { MultiIndexRAG } from "../memory/multi-index-rag.js"
import type { PatternDiscovery } from "../drift/pattern-discovery.js"
import type { LiveEvaluator } from "../evaluation/live-evaluator.js"
import type { ErrorAnalyzer } from "../core/error-analyzer.js"
import type { ContextCompressor } from "../drift/context-compressor.js"
import type { Executor } from "../core/executor.js"
import type { PlannerCritic } from "../core/planner-critic.js"
import type { IntentParser } from "../core/intent-parser.js"
import type { AgentLoop } from "../core/agent-loop.js"
import type { ErrorRecovery } from "../core/error-recovery.js"
import type { AlignmentGate } from "../core/alignment-gate.js"
import type { EconomicModel } from "../core/economic-model.js"
import type { ConstraintManifold } from "../core/constraint-manifold.js"
import type { ToolRouter } from "../core/tool-router.js"
import type { ConfidenceScorer, ConfidenceStore } from "../core/confidence-scorer.js"
import type { WorkflowEngine } from "../core/workflow-engine.js"
import type { RoleRegistry } from "../agents/role-registry.js"
import type { SelfEvolver } from "../evolution/self-evolver.js"
import type { ContinuousEvolution } from "../evolution/continuous-evolution.js"
import type { MCPServer } from "../core/mcp-server.js"
import type { MCPClient } from "../core/mcp-client.js"
import type { ProtocolAdapter } from "../core/protocol-adapter.js"
import type { DynamicToolRegistry } from "../core/dynamic-tool-registry.js"
import type { DebateLoop } from "../core/debate-loop.js"
import type { RouterAgent } from "../core/router-agent.js"
import type { DataCleaner } from "../core/data-cleaner.js"
import type { ConfigLoader } from "../core/config.js"
import type { DomainPack } from "../core/domain-registry.js"
import type { AgentRuntime } from "../agents/agent-runtime.js"
import type { ProjectContext } from "../core/project-context.js"
import type { ToolEntry } from "../core/prompt-builder.js"
import type { ToolUsageTracker } from "../core/tool-usage-tracker.js"
import type { Logger } from "../observability/logger.js"

export interface ToolContext {
  // ── Core infrastructure ──
  sessionStore: SessionStore
  domainRegistry: DomainRegistry
  worktree: string
  projectId: string
  config: ReturnType<ConfigLoader["load"]>
  log: Logger
  projectContext: ProjectContext
  TOOL_REGISTRY: ToolEntry[]
  currentInjectDomain: DomainPack

  // ── Planning & Execution ──
  planner: Planner
  plannerCritic: PlannerCritic
  executor: Executor
  intentParser: IntentParser
  agentLoop: AgentLoop

  // ── Verification & Quality ──
  verifier: Verifier
  errorAnalyzer: ErrorAnalyzer
  errorRecovery: ErrorRecovery
  alignmentGate: AlignmentGate
  economicModel: EconomicModel
  confidenceScorer: ConfidenceScorer
  confidenceStore: ConfidenceStore
  techDebtScorer: TechDebtScorer
  constraintManifold: ConstraintManifold

  // ── Navigation & Search ──
  navigator: CodebaseNavigator
  toolRouter: ToolRouter
  routerAgent: RouterAgent

  // ── Memory & Knowledge ──
  skillStore: SkillStore
  skillCurator: SkillCurator
  episodicStore: EpisodicStore
  memoryOrchestrator: MemoryOrchestrator
  secondBrain: import("../memory/second-brain.js").SecondBrain
  rag: MultiIndexRAG

  // ── Agent Coordination ──
  coordinator: AgentCoordinator
  orchestrator: Orchestrator
  roleRegistry: RoleRegistry
  agentRuntime: AgentRuntime
  debateLoop: DebateLoop

  // ── Observability ──
  dashboard: Dashboard
  traceLogger: TraceLogger
  liveEvaluator: LiveEvaluator
  patternDiscovery: PatternDiscovery
  toolUsageTracker: ToolUsageTracker
  workflowEngine: WorkflowEngine

  // ── LLM & Model ──
  llmEngine: LLMEngine
  modelRegistry: ModelRegistry

  // ── Guard & Safety ──
  hallucinationGuard: HallucinationGuard
  checkpoints: CheckpointSystem

  // ── State & Persistence ──
  stateStore: StateStore
  budgetTracker: BudgetTracker
  eventBus: EventBus

  // ── Parallel & DAG ──
  parallelExec: ParallelExecutor

  // ── Drift & Context ──
  dependencyTracker: import("../drift/dependency-tracker.js").DependencyTracker
  contextCompressor: ContextCompressor

  // ── Git ──
  git: GitIntegration

  // ── Evolution ──
  selfEvolver: SelfEvolver
  continuousEvolution: ContinuousEvolution
  metaReasoner: MetaReasoner

  // ── MCP & A2A ──
  mcpServer: MCPServer
  mcpClient: MCPClient
  protocolAdapter: ProtocolAdapter
  dynamicToolRegistry: DynamicToolRegistry

  // ── Simulation ──
  worldModel: WorldModel
  simulationEngine: SimulationEngine

  // ── Data ──
  dataCleaner: DataCleaner
  configLoader: ConfigLoader

  // ── Helpers ──
  logErrorToFile: (toolName: string, message: string, stack?: string) => void
  detectSubAgentRole: (systemText: string) => { role: string; tools: string[] } | null
  buildSubAgentInjection: (role: string, tools: string[]) => string
  ctxDir: (context: { directory?: string; worktree?: string }) => string
}

/**
 * Helper: make a partial ToolContext for testing.
 */
export function createMockToolContext(overrides?: Partial<ToolContext>): ToolContext {
  return overrides as unknown as ToolContext
}
