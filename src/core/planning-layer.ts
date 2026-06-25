/**
 * PlanningLayer — Graph Harness §3.1: Plan versioning & validation.
 *
 * Paper ref: arXiv:2604.11378 (Graph Harness)
 *   Commitment 1: Execution plans are immutable within a plan version.
 *   Commitment 2: Planning, execution, and recovery are separated into three layers.
 *
 * Responsibilities:
 *   - Accept user goal → produce DAGPlan (via Planner + template decomposition)
 *   - Validate DAG correctness (cycle detection, missing deps)
 *   - Version plans (immutable per version, new version = new plan)
 *   - Coarse-grained task decomposition (LLM optional)
 *
 * Related:
 *   - ExecutionLayer: consumes DAGPlan and executes nodes
 *   - RecoveryLayer: handles failures with strict escalation
 */

import type { Subtask } from "./intent-parser.js"
import { DAGEngine, type DAGPlan, type DAGExecutionContext } from "./dag-engine.js"

export interface PlanningLayerConfig {
  /** Max parallel nodes (default: 4) */
  maxParallel?: number
  /** Enable circuit breaker (default: true) */
  circuitBreaker?: boolean
  /** Default recovery strategy (default: "restart-node") */
  recoveryStrategy?: "restart-node" | "restart-plan" | "escalate"
  /** Max steps before circuit breaker (default: 50) */
  maxSteps?: number
}

export interface PlanVersion {
  /** Monotonic version number */
  version: number
  /** The DAG plan for this version */
  plan: DAGPlan
  /** Timestamp when this version was created */
  createdAt: number
  /** Human-readable change summary */
  changeSummary: string
}

export interface PlanValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  nodeCount: number
  dependencyCount: number
  cycleDetected: boolean
}

/**
 * PlanningLayer — creates, validates, and versions DAG execution plans.
 *
 * Graph Harness §3.1:
 *   "Execution plans are immutable within a plan version.
 *    Any change to the plan creates a new version."
 */
export class PlanningLayer {
  private dagEngine: DAGEngine
  private config: Required<PlanningLayerConfig>
  private planVersions: Map<string, PlanVersion[]> = new Map()
  private currentVersion: Map<string, number> = new Map()

  constructor(dagEngine: DAGEngine, config?: PlanningLayerConfig) {
    this.dagEngine = dagEngine
    this.config = {
      maxParallel: config?.maxParallel ?? 4,
      circuitBreaker: config?.circuitBreaker ?? true,
      recoveryStrategy: config?.recoveryStrategy ?? "restart-node",
      maxSteps: config?.maxSteps ?? 50,
    }
  }

  /**
   * Create a DAG plan from a goal and subtasks.
   * Returns an immutable plan version (v1).
   */
  createPlan(
    goal: string,
    subtasks: Subtask[],
    overrides?: Partial<DAGPlan["metadata"]>,
  ): { plan: DAGPlan; context: DAGExecutionContext; version: PlanVersion } {
    const { plan, context } = this.dagEngine.buildDAG(goal, subtasks, {
      maxParallel: overrides?.maxParallel ?? this.config.maxParallel,
      circuitBreaker: overrides?.circuitBreaker ?? this.config.circuitBreaker,
      recoveryStrategy: overrides?.recoveryStrategy ?? this.config.recoveryStrategy,
      maxSteps: overrides?.maxSteps ?? this.config.maxSteps,
    })

    const version = this.incrementVersion(goal, plan, "Initial plan")
    return { plan, context, version }
  }

  /**
   * Create a NEW plan version from modified subtasks (immutable replan).
   *
   * Graph Harness Commitment 1: "Execution plans are immutable within a plan version."
   * Instead of mutating the existing plan (via executor.replanStep), this method:
   *   1. Replaces the failed step with new subtasks
   *   2. Rewires dependencies: subtasks that depended on the failed step now depend on the last new subtask
   *   3. Creates a new PlanVersion (version N+1), preserving version N immutably
   *   4. Returns the new DAGPlan + DAGExecutionContext + PlanVersion
   *
   * @param goal - Original plan goal
   * @param originalSubtasks - Original subtask list (from the executor state)
   * @param failedStepId - ID of the step that failed and needs replacement
   * @param newSubtasks - Replacement subtasks (will have IDs like `${failedStepId}-replan-{i+1}` if duplicate)
   * @param overrides - Optional DAGPlan metadata overrides
   * @returns New plan version with its own DAGPlan and execution context
   */
  createPlanVersion(
    goal: string,
    originalSubtasks: Subtask[],
    failedStepId: string,
    newSubtasks: Subtask[],
    overrides?: Partial<DAGPlan["metadata"]>,
  ): { plan: DAGPlan; context: DAGExecutionContext; version: PlanVersion } {
    // 1. Build modified subtask list: remove failed step, add new subtasks
    const dedupedSubtasks = newSubtasks.map((s, i) => {
      // Auto-rename if ID conflicts with existing subtask
      if (originalSubtasks.some(orig => orig.id === s.id && orig.id !== failedStepId)) {
        return { ...s, id: `${failedStepId}-replan-${i + 1}` }
      }
      return s
    })

    // 2. Remove failed step from deps of all surviving subtasks
    //    Then wire them to depend on the LAST new subtask (sequential dependency)
    const lastReplanId = dedupedSubtasks[dedupedSubtasks.length - 1]?.id || `${failedStepId}-replan-${dedupedSubtasks.length}`
    const modifiedSubtasks: Subtask[] = originalSubtasks
      .filter(s => s.id !== failedStepId)
      .map(s => ({
        ...s,
        dependsOn: s.dependsOn
          .filter(d => d !== failedStepId)       // remove dep on failed step
          .concat(dedupedSubtasks.length > 0 && s.dependsOn.includes(failedStepId) ? [lastReplanId] : []), // add dep on last replan step
      }))

    // 3. Ensure new subtasks don't depend on the failed step
    const cleanNewSubtasks = dedupedSubtasks.map(s => ({
      ...s,
      dependsOn: s.dependsOn.filter(d => d !== failedStepId),
    }))

    modifiedSubtasks.push(...cleanNewSubtasks)

    // 4. Create new DAG and version
    const changeSummary = `Replan v${(this.currentVersion.get(this.goalKey(goal)) ?? 0) + 1}: replaced "${failedStepId}" with ${newSubtasks.length} subtask(s)`
    const { plan, context } = this.dagEngine.buildDAG(goal, modifiedSubtasks, {
      maxParallel: overrides?.maxParallel ?? this.config.maxParallel,
      circuitBreaker: overrides?.circuitBreaker ?? this.config.circuitBreaker,
      recoveryStrategy: overrides?.recoveryStrategy ?? this.config.recoveryStrategy,
      maxSteps: overrides?.maxSteps ?? this.config.maxSteps,
    })

    const version = this.incrementVersion(goal, plan, changeSummary)
    return { plan, context, version }
  }

  /**
   * Validate a plan for correctness before execution.
   * Checks: cycle detection, missing dependencies, node consistency.
   */
  validate(_goal: string, plan: DAGPlan): PlanValidationResult {
    const errors: string[] = []
    const warnings: string[] = []
    const allIds = new Set(plan.nodes.map(n => n.id))
    let cycleDetected = false

    // Check for missing deps
    for (const node of plan.nodes) {
      for (const dep of node.deps) {
        if (!allIds.has(dep)) {
          warnings.push(`Node "${node.id}" depends on missing "${dep}" — treating as root`)
        }
      }
    }

    // Check for circular dependencies via DFS
    const visited = new Set<string>()
    const inStack = new Set<string>()

    const dfs = (nodeId: string): boolean => {
      if (inStack.has(nodeId)) return true // cycle
      if (visited.has(nodeId)) return false
      visited.add(nodeId)
      inStack.add(nodeId)

      const node = plan.nodes.find(n => n.id === nodeId)
      if (node) {
        for (const dep of node.deps) {
          if (dfs(dep)) return true
        }
      }

      inStack.delete(nodeId)
      return false
    }

    for (const node of plan.nodes) {
      if (dfs(node.id)) {
        cycleDetected = true
        errors.push(`Cycle detected involving node "${node.id}"`)
        break
      }
    }

    // Check for empty plan
    if (plan.nodes.length === 0) {
      errors.push("Plan has zero nodes")
    }

    // Check for nodes with empty description
    const emptyDesc = plan.nodes.filter(n => !n.description.trim())
    if (emptyDesc.length > 0) {
      warnings.push(`${emptyDesc.length} node(s) have empty descriptions`)
    }

    // Warn if all nodes depend on each other (linear chain — no parallelism)
    const rootNodes = plan.nodes.filter(n => n.deps.length === 0)
    if (rootNodes.length === 1 && plan.nodes.length > 3) {
      warnings.push("Single root node — plan may be highly linear")
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      nodeCount: plan.nodes.length,
      dependencyCount: plan.nodes.reduce((sum, n) => sum + n.deps.length, 0),
      cycleDetected,
    }
  }

  /**
   * Get all versions for a plan (by goal hash).
   */
  getVersions(goal: string): PlanVersion[] {
    return this.planVersions.get(this.goalKey(goal)) ?? []
  }

  /**
   * Get current version number for a plan.
   */
  getCurrentVersionNumber(goal: string): number {
    return this.currentVersion.get(this.goalKey(goal)) ?? 0
  }

  /**
   * Get version metadata for dashboard/tracing.
   */
  getVersionStats(): { totalPlans: number; totalVersions: number } {
    let totalVersions = 0
    for (const versions of this.planVersions.values()) {
      totalVersions += versions.length
    }
    return {
      totalPlans: this.planVersions.size,
      totalVersions,
    }
  }

  // ── Private ──

  private goalKey(goal: string): string {
    // Use first 64 chars of goal as key (normalized)
    return goal.trim().toLowerCase().slice(0, 64)
  }

  private incrementVersion(goal: string, plan: DAGPlan, changeSummary?: string): PlanVersion {
    const key = this.goalKey(goal)
    const versions = this.planVersions.get(key) ?? []
    const versionNumber = versions.length + 1
    const version: PlanVersion = {
      version: versionNumber,
      plan,
      createdAt: Date.now(),
      changeSummary: changeSummary ?? (versionNumber === 1
        ? `Initial plan: ${goal.slice(0, 80)}`
        : `Revision ${versionNumber}: ${goal.slice(0, 80)}`),
    }
    versions.push(version)
    this.planVersions.set(key, versions)
    this.currentVersion.set(key, versionNumber)
    return version
  }
}
