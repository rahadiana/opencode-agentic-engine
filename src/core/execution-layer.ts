/**
 * ExecutionLayer — Graph Harness §3.2: DAG node execution with state management.
 *
 * Paper ref: arXiv:2604.11378 (Graph Harness)
 *   Commitment 2: Planning, execution, and recovery are separated into three layers.
 *
 * Responsibilities:
 *   - Consume DAGPlan from PlanningLayer
 *   - Execute nodes in topological order (respecting dependencies)
 *   - Track execution state per node (pending/running/completed/failed/skipped)
 *   - Support parallel execution within phases
 *   - Provide hooks for RecoveryLayer to intercept failures
 *
 * Related:
 *   - PlanningLayer: produces the DAGPlan
 *   - RecoveryLayer: handles failures when ExecutionLayer encounters them
 */

import type { DAGPlan, DAGExecutionContext, DAGNode, NodeRunner, DAGResult, DAGObserver, NodeStatus, ExecutionPhase } from "./dag-engine.js"
import { DAGEngine } from "./dag-engine.js"

export interface ExecutionLayerConfig {
  /** Max parallel nodes (default: 4) */
  maxParallel?: number
}

export interface NodeExecutionResult {
  nodeId: string
  success: boolean
  output: string
  error?: string
  startedAt: number
  completedAt: number
  retryCount: number
  status: NodeStatus
}

export interface PhaseExecutionResult {
  level: number
  nodeIds: string[]
  results: NodeExecutionResult[]
  successCount: number
  failedCount: number
}

export interface ExecutionSnapshot {
  completedCount: number
  failedCount: number
  runningCount: number
  pendingCount: number
  totalNodes: number
  circuitBreakerTripped: boolean
  elapsedMs: number
}

/**
 * ExecutionLayer — standalone DAG node execution manager.
 *
 * Graph Harness §3.2:
 *   "The execution layer walks the DAG in topological order,
 *    executing nodes within each phase. It does not make decisions
 *    about what to do on failure — that is delegated to the recovery layer."
 */
export class ExecutionLayer {
  private dagEngine: DAGEngine
  constructor(dagEngine: DAGEngine, _config?: ExecutionLayerConfig) {
    this.dagEngine = dagEngine
  }

  /**
   * Execute the full DAG plan.
   * Returns DAGResult with completion status and node states.
   */
  async execute(
    context: DAGExecutionContext,
    runner: NodeRunner,
    signal?: AbortSignal,
  ): Promise<DAGResult> {
    return this.dagEngine.execute(context, runner, signal)
  }

  /**
   * Execute a single node with retry logic.
   * Returns detailed execution result.
   */
  async executeNode(
    context: DAGExecutionContext,
    node: DAGNode,
    runner: NodeRunner,
    signal?: AbortSignal,
  ): Promise<NodeExecutionResult> {
    const startTs = Date.now()
    const result = await this.dagEngine.executeNode(context, node, runner, signal)
    const state = context.nodeStates.get(node.id)

    return {
      nodeId: result.nodeId,
      success: result.success,
      output: result.output,
      error: result.error,
      startedAt: startTs,
      completedAt: Date.now(),
      retryCount: state?.retryCount ?? 0,
      status: state?.status ?? "failed",
    }
  }

  /**
   * Get nodes that are ready for execution (dependencies met).
   */
  getReadyNodes(context: DAGExecutionContext): DAGNode[] {
    return this.dagEngine.getReadyNodes(context)
  }

  /**
   * Compute topological phases for the DAG.
   */
  computePhases(context: DAGExecutionContext): ExecutionPhase[] {
    // Re-throw cycle detection as more descriptive error
    try {
      return this.dagEngine.computePhases(context)
    } catch (err) {
      if (err instanceof Error && err.message.includes("cycle")) {
        throw new Error(
          `[ExecutionLayer] ${err.message}. ` +
          `Fix dependency declarations before execution.`,
        )
      }
      throw err
    }
  }

  /**
   * Get current execution progress as a snapshot.
   */
  snapshot(context: DAGExecutionContext): ExecutionSnapshot {
    const progress = this.dagEngine.getProgress(context)
    return {
      completedCount: progress.completed,
      failedCount: progress.failed,
      runningCount: progress.running,
      pendingCount: progress.pending,
      totalNodes: progress.total,
      circuitBreakerTripped: context.circuitBreakerTripped,
      elapsedMs: Date.now() - context.startTime,
    }
  }

  /**
   * Check if a node can be retried.
   */
  canRetry(context: DAGExecutionContext, nodeId: string): boolean {
    return this.dagEngine.canRetry(context, nodeId)
  }

  /**
   * Add an observer for execution events.
   */
  addObserver(observer: Partial<DAGObserver>): void {
    this.dagEngine.addObserver(observer)
  }

  /**
   * Set budget checker for circuit breaking.
   */
  setBudgetChecker(
    check: () => { exceeded?: boolean; metric?: string; current?: number; limit?: number } | null,
  ): void {
    this.dagEngine.setBudgetChecker(check)
  }

  /**
   * Convert DAGPlan back to Subtask[] for backward compat.
   */
  toSubtasks(plan: DAGPlan): import("./intent-parser.js").Subtask[] {
    return this.dagEngine.toSubtasks(plan)
  }

  /**
   * Check if a specific node has failed permanently (retries exhausted).
   */
  isPermanentlyFailed(context: DAGExecutionContext, nodeId: string): boolean {
    const state = context.nodeStates.get(nodeId)
    if (!state) return false
    if (state.status !== "failed") return false
    return !this.dagEngine.canRetry(context, nodeId)
  }

  /**
   * Reset a node's state for retry.
   */
  resetNode(context: DAGExecutionContext, nodeId: string): void {
    context.nodeStates.set(nodeId, {
      nodeId,
      status: "pending",
      retryCount: 0,
    })
  }
}
