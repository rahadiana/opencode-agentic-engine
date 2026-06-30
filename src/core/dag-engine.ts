/**
 * DAG Engine — Directed Acyclic Graph execution engine.
 *
 * Prinsip 4 (Control Agnostic): program control flow, LLM hanya reasoning.
 * LLM cuma dipanggil per-node sebagai reasoning engine, BUKAN sebagai orchestrator.
 *
 * Implementasi dari riset:
 * - Graph Harness (arXiv:2604.11378): DAG execution, 3 layer independent
 * - LLM-as-Code (arXiv:2606.15874): "LLM should NOT be the orchestrator"
 * - Omnigent: Circuit breaker + loop detection + rate limiting
 */

import type { Subtask } from "./intent-parser.js"
import { TimeoutError, BudgetExceededError, ValidationError } from "./errors.js"
import { computeBackoff, buildSummary, inferNodeType, detectLoop, LOOP_DETECTION_MAX_IDENTICAL, combinedAbort } from "./dag-helpers.js"
import { createLogger } from "../observability/logger.js"

const log = createLogger("DAG")

// ── Type Definitions ────────────────────────────────────────────────

export type DAGNodeType = "plan" | "execute" | "verify" | "reflect" | "delegate"

export type RetryStrategy = "none" | "linear" | "exponential"

export type RecoveryStrategy = "restart-node" | "restart-plan" | "escalate"

export type NodeStatus = "pending" | "running" | "completed" | "failed" | "skipped"

/** A single node in the DAG — the smallest unit of execution */
export interface DAGNode {
  id: string
  type: DAGNodeType
  description: string
  llmRequired: boolean
  deps: string[]
  config: {
    model?: string
    timeout: number
    retryStrategy: RetryStrategy
    maxRetries: number
  }
  verificationCriteria: string[]
  metadata?: Record<string, unknown>
}

/** The execution plan as a DAG — immutable selama eksekusi */
export interface DAGPlan {
  goal: string
  nodes: DAGNode[]
  metadata: {
    maxParallel: number
    circuitBreaker: boolean
    recoveryStrategy: RecoveryStrategy
    maxSteps: number
  }
}

/** Execution state of a single node */
export interface NodeState {
  nodeId: string
  status: NodeStatus
  retryCount: number
  error?: string
  output?: string
  startedAt?: number
  completedAt?: number
}

/** A topological level = set of nodes that can run in parallel */
export interface ExecutionPhase {
  level: number
  nodeIds: string[]
}

/** Full DAG execution context */
export interface DAGExecutionContext {
  plan: DAGPlan
  nodes: Map<string, DAGNode>
  nodeStates: Map<string, NodeState>
  phases: ExecutionPhase[]
  startTime: number
  circuitBreakerTripped: boolean
  completedCount: number
  failedCount: number
  /** Rolling window untuk loop detection */
  callHistory: Array<{ nodeId: string; ts: number; hash: string }>
}

/** Result of executing the full DAG */
export interface DAGResult {
  success: boolean
  completedNodes: string[]
  failedNodes: string[]
  totalNodes: number
  totalTime: number
  summary: string
  circuitBreakerTripped: boolean
  recoveryTriggered: boolean
  escalationRequired: boolean
}

/** Per-node execution function type */
export type NodeRunner = (
  node: DAGNode,
  signal: AbortSignal,
) => Promise<{ success: boolean; output: string; filesModified: string[]; error?: string }>

/** Observer untuk DAG execution events */
export interface DAGObserver {
  onNodeStart(nodeId: string): void
  onNodeComplete(nodeId: string, status: NodeStatus, output: string): void
  onPhaseStart(level: number, nodeCount: number): void
  onPhaseComplete(level: number, successCount: number): void
  onDAGComplete(result: DAGResult): void
  onRecovery(nodeId: string, strategy: string): void
  onCircuitBreaker(nodeId: string, reason: string): void
}

// ── Constants ──────────────────────────────────────────────────────

const DEFAULT_MAX_PARALLEL = 4
const DEFAULT_CIRCUIT_BREAKER = true
const DEFAULT_RECOVERY = "restart-node"
const DEFAULT_MAX_STEPS = 50
const DEFAULT_TIMEOUT = 120_000

// ── DAGEngine Class ──────────────────────────────────────────────────

export class DAGEngine {
  private observers: DAGObserver[] = []
  private budgetCheck?: () => { exceeded?: boolean; metric?: string; current?: number; limit?: number } | null

  // ── Constructor / Setup ──────────────────────────────────────────

  setBudgetChecker(
    check: () => { exceeded?: boolean; metric?: string; current?: number; limit?: number } | null,
  ): void {
    this.budgetCheck = check
  }

  /** Add an observer. Supports Partial — missing methods get no-op defaults. */
  addObserver(observer: Partial<DAGObserver>): void {
    // Wrap partial observer dengan default no-op untuk method yang gak di-implement
    const wrapped: DAGObserver = {
      onNodeStart: observer.onNodeStart ?? (() => {}),
      onNodeComplete: observer.onNodeComplete ?? (() => {}),
      onPhaseStart: observer.onPhaseStart ?? (() => {}),
      onPhaseComplete: observer.onPhaseComplete ?? (() => {}),
      onDAGComplete: observer.onDAGComplete ?? (() => {}),
      onRecovery: observer.onRecovery ?? (() => {}),
      onCircuitBreaker: observer.onCircuitBreaker ?? (() => {}),
    }
    this.observers.push(wrapped)
  }

  // ── Build ────────────────────────────────────────────────────────

  /**
   * Build a DAGPlan + DAGExecutionContext from a goal and subtasks.
   * Auto-detects missing deps, assigns node types based on description heuristics.
   */
  buildDAG(
    goal: string,
    subtasks: Subtask[],
    overrides?: Partial<DAGPlan["metadata"]>,
  ): { plan: DAGPlan; context: DAGExecutionContext } {
    const nodes: DAGNode[] = subtasks.map(s => {
      const type = inferNodeType(s)
      return {
        id: s.id,
        type,
        description: s.description,
        llmRequired: type !== "verify",
        deps: s.dependsOn ?? [],
        config: {
          timeout: DEFAULT_TIMEOUT,
          // Graph Harness §5.3: Verify nodes need retry for transient compilation issues
          // "none" → "linear" so verify failures get retried with backoff
          // 1 → 2 retries to handle intermittent build artifacts or race conditions
          retryStrategy: type === "verify" ? "linear" : "exponential",
          maxRetries: type === "verify" ? 2 : 3,
        },
        verificationCriteria: s.verificationCriteria ?? [],
      }
    })

    // Validasi DAG: gak boleh ada missing deps (selain siklus — dicek topological sort)
    const allIds = new Set(nodes.map(n => n.id))
    for (const n of nodes) {
      for (const d of n.deps) {
        if (!allIds.has(d)) {
          // Dep yang gak ada — anggap sebagai root node
          // (bisa dari external atau upstream yang gak di-include)
          log.warn(`Node "${n.id}" depends on "${d}" which is not in the plan`)
        }
      }
    }

    const plan: DAGPlan = {
      goal,
      nodes,
      metadata: {
        maxParallel: overrides?.maxParallel ?? DEFAULT_MAX_PARALLEL,
        circuitBreaker: overrides?.circuitBreaker ?? DEFAULT_CIRCUIT_BREAKER,
        recoveryStrategy: overrides?.recoveryStrategy ?? DEFAULT_RECOVERY,
        maxSteps: overrides?.maxSteps ?? DEFAULT_MAX_STEPS,
      },
    }

    const context = this.createContext(plan)
    return { plan, context }
  }

  /** Convert DAGPlan + DAGExecutionContext back to Subtask[] (untuk backward compat) */
  toSubtasks(plan: DAGPlan): Subtask[] {
    return plan.nodes.map(n => ({
      id: n.id,
      description: n.description,
      dependsOn: n.deps,
      verificationCriteria: n.verificationCriteria,
    }))
  }

  // ── Phase Computation (Topological Sort) ──────────────────────────

  /**
   * Compute topological phases using Kahn's algorithm.
   * Phase 0 = root nodes (no deps), Phase N = nodes whose deps are all in phases < N.
   * Returns phases sorted by level.
   * Throws if cycle detected.
   */
  computePhases(context: DAGExecutionContext): ExecutionPhase[] {
    const nodes = context.plan.nodes
    const inDegree = new Map<string, number>()
    const adjacency = new Map<string, string[]>() // node → dependents

    // Inisialisasi
    for (const n of nodes) {
      inDegree.set(n.id, n.deps.length)
      adjacency.set(n.id, [])
    }

    // Build adjacency (who depends on whom)
    for (const n of nodes) {
      for (const dep of n.deps) {
        const deps = adjacency.get(dep)
        if (deps) deps.push(n.id)
      }
    }

    // Kahn's algorithm
    const phases: ExecutionPhase[] = []
    let queue: string[] = []

    // Phase 0: nodes with inDegree === 0
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id)
    }

    let processed = 0
    let level = 0

    while (queue.length > 0) {
      phases.push({ level, nodeIds: [...queue] })
      level++

      const nextQueue: string[] = []

      for (const nodeId of queue) {
        processed++
        const dependents = adjacency.get(nodeId) ?? []
        for (const dep of dependents) {
          const deg = (inDegree.get(dep) ?? 1) - 1
          inDegree.set(dep, deg)
          if (deg === 0) {
            nextQueue.push(dep)
          }
        }
      }

      queue = nextQueue
    }

    // Cycle detection
    if (processed !== nodes.length) {
      const unprocessed = nodes
        .filter(n => !phases.flatMap(p => p.nodeIds).includes(n.id))
        .map(n => n.id)
      throw new ValidationError(
        `DAG cycle detected! ${unprocessed.length} nodes cannot be resolved: ${unprocessed.join(", ")}`,
      )
    }

    context.phases = phases
    return phases
  }

  // ── Query ────────────────────────────────────────────────────────

  /** Get nodes that are ready to execute (all deps met, not yet completed) */
  getReadyNodes(context: DAGExecutionContext): DAGNode[] {
    const completed = new Set(
      [...context.nodeStates.values()]
        .filter(s => s.status === "completed" || s.status === "skipped")
        .map(s => s.nodeId),
    )
    const running = new Set(
      [...context.nodeStates.values()]
        .filter(s => s.status === "running")
        .map(s => s.nodeId),
    )

    return context.plan.nodes.filter(n => {
      if (completed.has(n.id) || running.has(n.id)) return false
      const state = context.nodeStates.get(n.id)
      if (state && state.status === "failed" && !this.canRetry(context, n.id)) return false
      return n.deps.every(d => completed.has(d))
    })
  }

  /** Check if a node can be retried */
  canRetry(context: DAGExecutionContext, nodeId: string): boolean {
    const node = context.nodes.get(nodeId)
    const state = context.nodeStates.get(nodeId)
    if (!node || !state) return false
    return state.retryCount < node.config.maxRetries
  }

  /** Get current progress */
  getProgress(context: DAGExecutionContext): {
    completed: number
    total: number
    failed: number
    running: number
    pending: number
  } {
    const total = context.plan.nodes.length
    let completed = 0
    let failed = 0
    let running = 0
    let pending = 0

    for (const state of context.nodeStates.values()) {
      switch (state.status) {
        case "completed": completed++; break
        case "failed": failed++; break
        case "running": running++; break
        default: pending++
      }
    }

    return { completed, total, failed, running, pending }
  }

  // ── Execution ────────────────────────────────────────────────────

  /**
   * Execute the full DAG plan.
   * Walks through phases topologically, executing nodes in parallel within each phase.
   * Applies circuit breaker, recovery, and budget checks.
   */
  async execute(
    context: DAGExecutionContext,
    runner: NodeRunner,
    signal?: AbortSignal,
  ): Promise<DAGResult> {
    // Compute phases first
    const phases = context.phases.length > 0 ? context.phases : this.computePhases(context)
    const startTime = Date.now()
    const startNodeCount = context.completedCount
    let recoveryTriggered = false
    let escalationRequired = false

    for (const phase of phases) {
      // Circuit breaker: budget check sebelum tiap phase
      if (this.budgetCheck) {
        const budgetEvent = this.budgetCheck()
        if (budgetEvent?.exceeded) {
          context.circuitBreakerTripped = true
          this.notifyCircuitBreaker("budget", `Budget exceeded: ${budgetEvent.metric}`)
          break
        }
      }

      // Abort signal
      if (signal?.aborted) {
        context.circuitBreakerTripped = true
        break
      }

      this.observers.forEach(o => o.onPhaseStart(phase.level, phase.nodeIds.length))

      // Filter nodes: skip already-completed or permanently-failed
      const activeNodes = phase.nodeIds
        .map(id => context.nodes.get(id)!)
        .filter(n => {
          const s = context.nodeStates.get(n.id)
          return !s || (s.status !== "completed" && s.status !== "skipped" &&
            !(s.status === "failed" && !this.canRetry(context, n.id)))
        })

      if (activeNodes.length === 0) {
        this.observers.forEach(o => o.onPhaseComplete(phase.level, 0))
        continue
      }

      // Execute phase — parallel with concurrency limit
      const results = await this.executePhase(
        context, activeNodes, runner, signal,
      )

      // After phase: check for failures → recovery
      const failed = results.filter(r => !r.success)
      if (failed.length > 0 && context.plan.metadata.recoveryStrategy !== "restart-node") {
        recoveryTriggered = true

        if (context.plan.metadata.recoveryStrategy === "escalate") {
          escalationRequired = true
          this.notifyRecovery(failed[0].nodeId, "escalate")
          break
        }

        // restart-plan: mark semua node yang belum selesai sebagai skipped
        if (context.plan.metadata.recoveryStrategy === "restart-plan") {
          for (const n of context.plan.nodes) {
            const s = context.nodeStates.get(n.id)
            if (!s || s.status === "pending") {
              context.nodeStates.set(n.id, {
                nodeId: n.id,
                status: "skipped",
                retryCount: 0,
              })
            }
          }
          escalationRequired = true
          this.notifyRecovery(failed[0].nodeId, "restart-plan")
          break
        }
      }

      const successCount = results.filter(r => r.success).length
      this.observers.forEach(o => o.onPhaseComplete(phase.level, successCount))

      // Break if no progress
      if (successCount === 0 && activeNodes.length > 0) break
    }

    const totalTime = Date.now() - startTime
    const completedNodes = [...context.nodeStates.values()]
      .filter(s => s.status === "completed")
      .map(s => s.nodeId)
    const failedNodes = [...context.nodeStates.values()]
      .filter(s => s.status === "failed")
      .map(s => s.nodeId)

    const result: DAGResult = {
      success: failedNodes.length === 0 && !context.circuitBreakerTripped,
      completedNodes,
      failedNodes,
      totalNodes: context.plan.nodes.length,
      totalTime,
      summary: buildSummary(context, startNodeCount, totalTime),
      circuitBreakerTripped: context.circuitBreakerTripped,
      recoveryTriggered,
      escalationRequired,
    }

    this.observers.forEach(o => o.onDAGComplete(result))
    return result
  }

  // ── Node Execution ──────────────────────────────────────────────

  /**
   * Execute a single node with retry logic.
   * Supports linear and exponential backoff.
   * Has built-in loop detection + circuit breaker.
   */
  async executeNode(
    context: DAGExecutionContext,
    node: DAGNode,
    runner: NodeRunner,
    signal?: AbortSignal,
  ): Promise<{ nodeId: string; success: boolean; output: string; error?: string }> {
    let state = context.nodeStates.get(node.id)
    if (!state) {
      state = { nodeId: node.id, status: "pending", retryCount: 0 }
      context.nodeStates.set(node.id, state)
    }

    if (state.status === "completed") {
      return { nodeId: node.id, success: true, output: state.output ?? "(already completed)" }
    }

    // Circuit breaker: loop detection
    if (context.plan.metadata.circuitBreaker) {
      if (detectLoop(context, node.id)) {
        context.circuitBreakerTripped = true
        const errMsg = `Infinite loop detected: node "${node.id}" repeated ${LOOP_DETECTION_MAX_IDENTICAL}+ times`
        this.notifyCircuitBreaker(node.id, errMsg)
        state.status = "failed"
        state.error = errMsg
        return { nodeId: node.id, success: false, output: "", error: errMsg }
      }
    }

    this.observers.forEach(o => o.onNodeStart(node.id))
    state.status = "running"
    state.startedAt = Date.now()

    let retryCount = 0
    let lastError = ""

    while (retryCount <= node.config.maxRetries) {
      // Budget check per attempt
      if (this.budgetCheck) {
        const budgetEvent = this.budgetCheck()
        if (budgetEvent?.exceeded) {
          context.circuitBreakerTripped = true
          const msg = `Budget exceeded (${budgetEvent.metric}: ${budgetEvent.current}/${budgetEvent.limit})`
          this.notifyCircuitBreaker(node.id, msg)
          lastError = msg
          break
        }
      }

      // Abort signal
      if (signal?.aborted) {
        lastError = "Execution aborted"
        break
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), node.config.timeout)

      try {
        // P0: properly cleanup timeout — no Promise.race leak
        const nodeSignal = signal
          ? combinedAbort(signal, controller.signal)
          : controller.signal

        const result = await runner(node, nodeSignal)
        clearTimeout(timeoutId)

        if (result.success) {
          state.status = "completed"
          state.output = result.output
          state.completedAt = Date.now()
          context.completedCount++
          this.observers.forEach(o => o.onNodeComplete(node.id, "completed", result.output))
          return { nodeId: node.id, success: true, output: result.output }
        }

        lastError = result.error ?? result.output ?? "Unknown error"
        state.error = lastError
        retryCount++
        state.retryCount = retryCount

        if (retryCount > node.config.maxRetries) break

        // Backoff
        const delay = computeBackoff(node.config.retryStrategy, retryCount)
        await sleep(delay)

      } catch (err) {
        clearTimeout(timeoutId)
        lastError = err instanceof Error ? err.message : String(err)
        retryCount++
        state.retryCount = retryCount

        if (err instanceof TimeoutError || err instanceof BudgetExceededError || signal?.aborted) {
          break
        }

        if (retryCount > node.config.maxRetries) break

        const delay = computeBackoff(node.config.retryStrategy, retryCount)
        await sleep(delay)
      }
    }

    state.status = "failed"
    state.error = lastError
    state.completedAt = Date.now()
    context.failedCount++
    this.observers.forEach(o => o.onNodeComplete(node.id, "failed", lastError))
    return { nodeId: node.id, success: false, output: lastError, error: lastError }
  }

  // ── Internal Helpers ──────────────────────────────────────────────

  private createContext(plan: DAGPlan): DAGExecutionContext {
    const nodeStates = new Map<string, NodeState>()
    const nodes = new Map<string, DAGNode>()

    for (const n of plan.nodes) {
      nodes.set(n.id, n)
      nodeStates.set(n.id, { nodeId: n.id, status: "pending", retryCount: 0 })
    }

    return {
      plan,
      nodes,
      nodeStates,
      phases: [],
      startTime: Date.now(),
      circuitBreakerTripped: false,
      completedCount: 0,
      failedCount: 0,
      callHistory: [],
    }
  }

  /** Execute a phase: run all nodes in parallel (with concurrency limit) */
  private async executePhase(
    context: DAGExecutionContext,
    nodes: DAGNode[],
    runner: NodeRunner,
    signal?: AbortSignal,
  ): Promise<Array<{ nodeId: string; success: boolean }>> {
    const maxParallel = context.plan.metadata.maxParallel
    const results: Array<{ nodeId: string; success: boolean }> = []

    if (maxParallel <= 1 || nodes.length <= 1) {
      // Sequential
      for (const node of nodes) {
        if (signal?.aborted) break
        const r = await this.executeNode(context, node, runner, signal)
        results.push(r)
      }
    } else {
      // Parallel with concurrency limit via pooling
      const pool = new NodePool(this, context, runner, signal)
      results.push(...await pool.runAll(nodes, maxParallel))
    }

    return results
  }

  private notifyCircuitBreaker(nodeId: string, reason: string): void {
    this.observers.forEach(o => o.onCircuitBreaker(nodeId, reason))
  }

  private notifyRecovery(nodeId: string, strategy: string): void {
    this.observers.forEach(o => o.onRecovery(nodeId, strategy))
  }
}

// ── NodePool Class ──────────────────────────────────────────────────

class NodePool {
  constructor(
    private engine: DAGEngine,
    private context: DAGExecutionContext,
    private runner: NodeRunner,
    private signal?: AbortSignal,
  ) {}

  async runAll(
    nodes: DAGNode[],
    concurrency: number,
  ): Promise<Array<{ nodeId: string; success: boolean }>> {
    const results: Array<{ nodeId: string; success: boolean }> = []
    let index = 0

    const worker = async (): Promise<void> => {
      while (index < nodes.length) {
        const i = index++
        const node = nodes[i]
        if (this.signal?.aborted) break
        const r = await this.engine.executeNode(this.context, node, this.runner, this.signal)
        results[i] = r
      }
    }

    const workers = Array.from({ length: Math.min(concurrency, nodes.length) }, () => worker())
    await Promise.all(workers)

    return results.filter(Boolean)
  }
}

// ── Standalone Helpers ──────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

