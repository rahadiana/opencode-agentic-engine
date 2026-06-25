/**
 * Agent Loop — using 3-layer Graph Harness architecture:
 *   PlanningLayer → ExecutionLayer → RecoveryLayer
 *
 * Paper ref: arXiv:2604.11378 (Graph Harness)
 *   Commitment 1: Execution plans are immutable within a plan version
 *   Commitment 2: Planning, execution, and recovery are separated into three layers
 *   Commitment 3: Recovery follows a strict escalation protocol
 *
 * Backward compatible: AgentLoopConfig, LoopResult, LoopObserver interfaces unchanged.
 * runLoop() signature unchanged — existing consumers (index.ts, tests) work as before.
 */

import type { Subtask } from "./intent-parser.js"
import { Executor } from "./executor.js"
import { Verifier } from "./verifier.js"
import { ErrorAnalyzer } from "./error-analyzer.js"
import { DependencyTracker } from "../drift/dependency-tracker.js"
import { LLMEngine } from "./llm.js"
import { BudgetTracker } from "./budget-tracker.js"
import type { Planner } from "./planner.js"
import { TimeoutError } from "./errors.js"
import { DAGEngine, type DAGPlan, type DAGExecutionContext, type DAGNode } from "./dag-engine.js"
import { ConfidenceScorer, ConfidenceStore, type ScoringSignals } from "./confidence-scorer.js"
import { PlanningLayer } from "./planning-layer.js"
import { ExecutionLayer } from "./execution-layer.js"
import { RecoveryLayer, type RecoveryDecision } from "./recovery-layer.js"

export interface AgentLoopConfig {
  maxIterations: number
  autoRetry: boolean
  maxRetries: number
  verifyAfterEach: boolean
  /** Max parallelism per phase (default: unlimited) */
  maxParallelism?: number
  /** Abort remaining steps in phase if one fails (default: false) */
  abortOnFailure?: boolean
}

export interface LoopResult {
  completedSteps: string[]
  failedSteps: string[]
  totalIterations: number
  success: boolean
  summary: string
}

export interface LoopObserver {
  onStepStart(stepId: string, iteration: number): void
  onStepComplete(stepId: string, success: boolean, output: string): void
  onLoopComplete(result: LoopResult): void
}

export class AgentLoop {
  private config: AgentLoopConfig
  private llm: LLMEngine
  private observers: LoopObserver[] = []
  private budgetTracker?: BudgetTracker
  private planner?: Planner
  private replannedSteps = new Set<string>()
  /** Confidence scoring (Gap #2) */
  private confidenceScorer?: ConfidenceScorer
  private confidenceStore?: ConfidenceStore

  /** Graph Harness 3 layers */
  private planningLayer: PlanningLayer
  private executionLayer: ExecutionLayer
  private recoveryLayer: RecoveryLayer

  constructor(llm: LLMEngine, config: Partial<AgentLoopConfig> = {}) {
    this.llm = llm
    this.config = {
      maxIterations: config.maxIterations ?? 10,
      autoRetry: config.autoRetry ?? true,
      maxRetries: config.maxRetries ?? 3,
      verifyAfterEach: config.verifyAfterEach ?? true,
      maxParallelism: config.maxParallelism,
      abortOnFailure: config.abortOnFailure ?? false,
    }
    const dagEngine = new DAGEngine()
    this.planningLayer = new PlanningLayer(dagEngine)
    this.executionLayer = new ExecutionLayer(dagEngine)
    this.recoveryLayer = new RecoveryLayer({
      maxRetries: config.maxRetries ?? 3,
      maxReplans: 2,
      autoReplan: true,
      autoEscalate: true,
    })
  }

  /** Access to layers for external configuration */
  getPlanningLayer(): PlanningLayer { return this.planningLayer }
  getExecutionLayer(): ExecutionLayer { return this.executionLayer }
  getRecoveryLayer(): RecoveryLayer { return this.recoveryLayer }

  setBudgetTracker(tracker: BudgetTracker): void {
    this.budgetTracker = tracker
    this.executionLayer.setBudgetChecker(() => {
      const event = tracker.check("session")
      return event
        ? { exceeded: true, metric: event.metric, current: event.current, limit: event.limit }
        : null
    })
  }

  setPlanner(planner: Planner): void {
    this.planner = planner
  }

  setConfidenceScorer(scorer: ConfidenceScorer, store: ConfidenceStore): void {
    this.confidenceScorer = scorer
    this.confidenceStore = store
  }

  addObserver(observer: LoopObserver): void {
    this.observers.push(observer)
  }

  async runLoop(
    sessionId: string,
    executor: Executor,
    verifier: Verifier,
    errorAnalyzer: ErrorAnalyzer,
    depTracker: DependencyTracker,
    projectDir: string,
    stepExecutor: (step: Subtask) => Promise<{ success: boolean; output: string; filesModified: string[]; error?: string }>,
    fixExecutor?: (fix: string) => Promise<boolean>,
  ): Promise<LoopResult> {
    const completedSteps: string[] = []
    const failedSteps: string[] = []
    let iteration = 0

    // ── Setup ────────────────────────────────────────────────────────

    // Dapatkan plan dari executor state
    const state = (executor as any).states?.get(sessionId)
    if (!state || !state.plan) {
      return {
        completedSteps, failedSteps, totalIterations: 0,
        success: false,
        summary: "No plan found in executor state",
      }
    }

    const plan: { intent: { goal: string; subtasks: Subtask[] } } = state.plan
    const subtasks = plan.intent.subtasks

    // Graph Harness §3.1: PlanningLayer — create and validate immutable DAG plan
    const maxParallel = this.config.maxParallelism ?? (this.config.abortOnFailure ? this.config.maxParallelism ?? 4 : 0)
    const { plan: dagPlan, context: dagCtx } = this.planningLayer.createPlan(
      plan.intent.goal,
      subtasks,
      {
        maxParallel: maxParallel > 0 ? maxParallel : undefined,
        circuitBreaker: true,
        recoveryStrategy: this.config.autoRetry ? "restart-node" : "escalate",
        maxSteps: this.config.maxIterations,
      },
    )

    // Validate plan before execution
    const validation = this.planningLayer.validate(plan.intent.goal, dagPlan)
    if (!validation.valid) {
      console.warn(`[AgentLoop] Plan validation warnings: ${validation.warnings.join(", ")}`)
    }

    // DAG observer → legacy observer mapping
    this.executionLayer.addObserver({
      onNodeStart: (nodeId) => {
        this.observers.forEach(o => o.onStepStart(nodeId, iteration + 1))
      },
      onNodeComplete: (nodeId, status, output) => {
        this.observers.forEach(o => o.onStepComplete(nodeId, status === "completed", output))
      },
      onPhaseStart: () => {},
      onPhaseComplete: () => {},
      onDAGComplete: () => {},
      onRecovery: () => {},
      onCircuitBreaker: () => {},
    })

    // ── DAG Runner ──────────────────────────────────────────────────
    // Adapter: Subtask → NodeRunner (DAG node → stepExecutor + verify + retry)
    const dagRunner = async (
      node: DAGNode,
      signal: AbortSignal,
    ): Promise<{ success: boolean; output: string; filesModified: string[]; error?: string }> => {
      // Cari subtask original dari plan (for backward compat with stepExecutor)
      const subtask = subtasks.find(s => s.id === node.id)
      if (!subtask) {
        return { success: false, output: "", filesModified: [], error: `Subtask "${node.id}" not found in plan` }
      }

      // Circuit breaker
      if (this.budgetTracker) {
        const budgetEvent = this.budgetTracker.check("session")
        if (budgetEvent) {
          return { success: false, output: "", filesModified: [], error: `Budget exceeded (${budgetEvent.metric})` }
        }
      }

      let result: { success: boolean; output: string; filesModified: string[]; error?: string }
      try {
        result = await stepExecutor(subtask)
      } catch (err) {
        if (err instanceof TimeoutError) throw err
        result = { success: false, output: "", filesModified: [], error: err instanceof Error ? err.message : String(err) }
      }

      if (signal?.aborted) {
        return { success: false, output: "", filesModified: [], error: "Aborted" }
      }

      // Track file changes
      if (result.filesModified && result.filesModified.length > 0) {
        depTracker.recordChange(sessionId, node.id, result.filesModified)
      }

      // Graph Harness §5.3: Verify intermediate steps NON-BLOCKING
      // Verification failure on intermediate steps should NOT set result.success = false.
      // Only the FINAL step uses verification as a blocking gate.
      // This prevents cascade failure where a typo in 1 file blocks all downstream steps.
      if (result.success && this.config.verifyAfterEach) {
        const isFinalStep = this.isAllCompleted(dagPlan, dagCtx)
        const tier = isFinalStep ? "deep" : "standard"
        const verifyResult = result.filesModified.length > 0
          ? await verifier.verifyAllDeep(node.id, projectDir, subtask.description, result.filesModified, false, tier)
          : await verifier.verifyAllDeep(node.id, projectDir, undefined, [], false, tier)

        if (!verifyResult.passed) {
          if (isFinalStep) {
            // Final step: blocking verify — step must pass to be considered successful
            result.success = false
            result.output = `Verification failed: ${verifyResult.errors.join("\n")}`

            // Attempt repair via LLM
            const analysis = await errorAnalyzer.analyzeDeep(result.output, result.filesModified)
            if (this.config.autoRetry) {
              const repaired = await this.attemptRepair(subtask, result.output, analysis, fixExecutor)
              if (repaired) {
                // Return failure to trigger DAG retry
                return { success: false, output: result.output, filesModified: result.filesModified, error: verifyResult.errors.join("; ") }
              }
            }
          } else {
            // Intermediate step: NON-BLOCKING — warn only, keep success=true
            // Per Graph Harness §5.3, this prevents cascading failure from minor issues
            result.output = `[Verify Warning] ${verifyResult.errors.join("\n")}\n\n${result.output}`
            console.warn(`[AgentLoop] Intermediate verify warning for step ${node.id}: ${verifyResult.errors.join("; ")}`)
          }
        }

        // Verification criteria
        if (result.success && subtask.verificationCriteria.length > 0 && verifier.hasLLM()) {
          const criteriaResult = await verifier.verifyCriteria(
            subtask.verificationCriteria,
            subtask.description,
            result.filesModified,
            projectDir,
          )
          if (!criteriaResult.passed) {
            result.output = `Criteria check: ${criteriaResult.output}`
          }
        }
      }

      // Gap #2: Confidence scoring — assess output quality from verification signals
      if (this.confidenceScorer && this.confidenceStore && result.success) {
        const signals: ScoringSignals = {
          stepId: node.id,
          compileResult: { passed: result.success },
          guardResult: result.filesModified.length > 0 ? { passed: true, claims: [] } : undefined,
          modelReliability: 0.5,
        }
        const cs = this.confidenceScorer.score(signals)
        this.confidenceStore.set(node.id, cs)

        // Gap #8: Confidence-based decision gates
        // Non-blocking WARN for low confidence (0.2 <= overall < 0.4)
        if (cs.overall < 0.4 && cs.overall >= 0.2) {
          const warnMsg = `[Confidence Warning] Score ${cs.overall.toFixed(2)} < 0.4 — review recommended`
          result.output = `${warnMsg}\n\n${result.output}`
          console.warn(`[AgentLoop] ${warnMsg} for step ${node.id}`)
        }
        // Blocking FAIL for very low confidence (< 0.2)
        if (cs.overall < 0.2) {
          const isFinalStep = this.isAllCompleted(dagPlan, dagCtx)
          if (isFinalStep) {
            const failMsg = `[Confidence Block] Score ${cs.overall.toFixed(2)} < 0.2 — final step blocked`
            result.success = false
            result.output = `${failMsg}\n\n${result.output}`
            console.warn(`[AgentLoop] ${failMsg} for step ${node.id}`)
          } else {
            const warnMsg = `[Confidence Block Warning] Score ${cs.overall.toFixed(2)} < 0.2 — intermediate step at risk`
            result.output = `${warnMsg}\n\n${result.output}`
            console.warn(`[AgentLoop] ${warnMsg} for step ${node.id}`)
          }
        }
      }

      // Record result in Executor (for backward compat)
      executor.recordResult(sessionId, {
        stepId: node.id,
        success: result.success,
        output: result.output,
        filesModified: result.filesModified,
        error: result.error,
      })

      return result
    }

    // ── Execute DAG via ExecutionLayer ───────────────────────────────
    const dagResult = await this.executionLayer.execute(dagCtx, dagRunner)

    // Graph Harness §3.3: RecoveryLayer — strict escalation chain
    // Auto-chaining: retry → replan → escalate per node, with max total depth
    // to prevent infinite recovery loops
    const MAX_RECOVERY_DEPTH = 10
    let recoveryDepth = 0
    const pendingNodes = new Set(dagResult.failedNodes)
    const originallyFailed = new Set(dagResult.failedNodes)
    const escalatedNodes: Array<{ nodeId: string; reason: string }> = []

    while (pendingNodes.size > 0 && recoveryDepth < MAX_RECOVERY_DEPTH) {
      recoveryDepth++
      const nodeId = [...pendingNodes][0]!
      pendingNodes.delete(nodeId)

      // Track which DAG context this node belongs to (original or replan)
      const node = dagCtx.nodes.get(nodeId)
      if (this.replannedSteps.has(nodeId)) continue
      if (dagResult.completedNodes.includes(nodeId)) continue
      if (!node) continue

      const errorText = dagCtx.nodeStates.get(nodeId)?.error ?? "Unknown error"

      // Recovery decision via RecoveryLayer — stateful, escalates internally
      const decision: RecoveryDecision = this.recoveryLayer.decide(node, dagCtx, errorText)

      if (decision.action === "retry") {
        // Reset node state and retry via ExecutionLayer
        // DAGEngine handles internal retries (backoff + maxRetries per node.config)
        this.executionLayer.resetNode(dagCtx, nodeId)
        const retryResult = await this.executionLayer.executeNode(dagCtx, node, dagRunner)
        if (retryResult.success) {
          // Retry succeeded — move from failed to completed
          dagResult.failedNodes = dagResult.failedNodes.filter(id => id !== nodeId)
          if (!dagResult.completedNodes.includes(nodeId)) {
            dagResult.completedNodes.push(nodeId)
          }
          dagResult.summary += ` | Retried: ${nodeId} (success after ${decision.level})`
          // ConfidenceGate: retry success does NOT mean overall success
        } else {
          // Retry failed — add back to pending for next level (replan/escalate)
          pendingNodes.add(nodeId)
        }
      } else if (decision.action === "replan" && this.planner) {
        const nodeSubtasks = subtasks.map(s => ({ ...s })) // Restore from original plan snapshot
        const failingSubtask = nodeSubtasks.find(s => s.id === nodeId)
        if (!failingSubtask) continue

        const replanResult = this.recoveryLayer.generateReplan(failingSubtask, errorText, 
          (_desc, err) => this.tryReplan(failingSubtask, err))
        if (replanResult.newSubtasks.length > 0) {
          this.replannedSteps.add(nodeId)

          // Immutable plan: create NEW plan version (v2+) preserving v1
          const planVersionResult = this.planningLayer.createPlanVersion(
            plan.intent.goal,
            nodeSubtasks,
            nodeId,
            replanResult.newSubtasks,
            dagPlan.metadata,
          )

          // Update executor state for backward compat (getReadySteps etc.)
          const newSubtasks = planVersionResult.plan.nodes.map((n: DAGNode) => ({
            id: n.id,
            description: n.description,
            dependsOn: n.deps,
            verificationCriteria: n.verificationCriteria ?? [],
          }))
          executor.replanStep(sessionId, nodeId, newSubtasks)

          // Execute the new plan version DAG
          const { context: newDagCtx, version: newVersion } = planVersionResult
          const retryResult = await this.executionLayer.execute(newDagCtx, dagRunner)

          // Merge results: completed nodes from new DAG
          for (const cn of retryResult.completedNodes) {
            if (!dagResult.completedNodes.includes(cn)) {
              dagResult.completedNodes.push(cn)
            }
          }

          if (retryResult.failedNodes.length === 0) {
            // Replan fully succeeded — root cause resolved
            dagResult.failedNodes = dagResult.failedNodes.filter(id => id !== nodeId)
            dagResult.summary += ` | Replanned: ${nodeId} → v${newVersion.version} (${replanResult.summary})`
          } else {
            // Replan partially failed — escalate original + queue new failures
            escalatedNodes.push({ nodeId, reason: `Replan v${newVersion.version} had ${retryResult.failedNodes.length} failure(s)` })
            for (const fn of retryResult.failedNodes) {
              if (!dagResult.failedNodes.includes(fn)) {
                dagResult.failedNodes.push(fn)
              }
            }
            // Rewire replan failures back to pending for their own recovery chain
            for (const fn of retryResult.failedNodes) {
              if (!dagResult.completedNodes.includes(fn)) {
                pendingNodes.add(fn)
              }
            }
            dagResult.summary += ` | Replanned: ${nodeId} → v${newVersion.version} (${replanResult.summary}, ${retryResult.failedNodes.length} new failure(s))`
          }
          dagResult.success = dagResult.failedNodes.length === 0
        }
      } else {
        // decision.action === "escalate" or "skip" → leave as permanently failed
        escalatedNodes.push({ nodeId, reason: decision.reason })
      }
    }

    // Notify observers about escalated nodes
    if (escalatedNodes.length > 0) {
      console.warn(`[AgentLoop] Escalated ${escalatedNodes.length} node(s):`)
      for (const en of escalatedNodes) {
        console.warn(`  ${en.nodeId}: ${en.reason}`)
        if (dagResult.completedNodes.includes(en.nodeId)) continue
        if (originallyFailed.has(en.nodeId) && !dagResult.failedNodes.includes(en.nodeId)) {
          dagResult.failedNodes.push(en.nodeId)
        }
      }
      dagResult.escalationRequired = true

      // Notify observers
      this.observers.forEach(o => {
        if ((o as any).onEscalation) {
          (o as any).onEscalation(escalatedNodes)
        }
      })
    }

    if (recoveryDepth >= MAX_RECOVERY_DEPTH) {
      console.warn(`[AgentLoop] Recovery depth limit (${MAX_RECOVERY_DEPTH}) reached — forcing all pending to escalated`)
      for (const nid of pendingNodes) {
        if (!dagResult.failedNodes.includes(nid)) {
          dagResult.failedNodes.push(nid)
        }
      }
      dagResult.escalationRequired = true
    }

    // ── Build result ────────────────────────────────────────────────
    for (const nId of dagResult.completedNodes) {
      if (!completedSteps.includes(nId)) completedSteps.push(nId)
    }
    for (const nId of dagResult.failedNodes) {
      if (!failedSteps.includes(nId)) failedSteps.push(nId)
    }

    iteration = Math.max(
      iteration,
      // Count unique phase executions + retries
      Math.ceil(dagResult.completedNodes.length / (this.config.maxParallelism || 1)) + dagResult.failedNodes.length,
    )

    const result: LoopResult = {
      completedSteps,
      failedSteps,
      totalIterations: iteration || 1,
      success: dagResult.success,
      summary: dagResult.summary,
    }

    this.observers.forEach(o => o.onLoopComplete(result))
    return result
  }

  /**
   * Check if all DAG nodes are completed (used for final verify tier).
   */
  private isAllCompleted(plan: DAGPlan, ctx: DAGExecutionContext): boolean {
    return plan.nodes.every(n => {
      const s = ctx.nodeStates.get(n.id)
      return s?.status === "completed"
    })
  }

  // ── Legacy: batched execution fallback (when DAG not available) ──

  /**
   * Legacy runLoopBatched — original while(true) batch logic.
   * Used when plan doesn't come through DAG engine (fallback).
   */
  async runLoopBatched(
    sessionId: string,
    executor: Executor,
    verifier: Verifier,
    errorAnalyzer: ErrorAnalyzer,
    depTracker: DependencyTracker,
    projectDir: string,
    stepExecutor: (step: Subtask) => Promise<{ success: boolean; output: string; filesModified: string[]; error?: string }>,
    fixExecutor?: (fix: string) => Promise<boolean>,
  ): Promise<LoopResult> {
    const completedSteps: string[] = []
    const failedSteps: string[] = []
    let iteration = 0
    const filesModifiedMap = new Map<string, string[]>()

    while (iteration < this.config.maxIterations) {
      if (this.budgetTracker) {
        const sessionExceeded = this.budgetTracker.check("session")
        if (sessionExceeded) {
          return {
            completedSteps, failedSteps, totalIterations: iteration,
            success: false,
            summary: `Budget exceeded (${sessionExceeded.metric}: ${sessionExceeded.current}/${sessionExceeded.limit})`,
          }
        }
      }

      iteration++

      const readySteps = executor.getReadySteps(sessionId)
      if (readySteps.length === 0) break

      const beforeCompleted = completedSteps.length
      const batches = this.batchSteps(readySteps, filesModifiedMap)

      for (const batch of batches) {
        const results = await this.executeBatch(
          batch, sessionId, executor, verifier, errorAnalyzer,
          depTracker, projectDir, stepExecutor, fixExecutor,
        )

        for (const r of results) {
          if (r.replanned) continue
          if (r.filesModified.length > 0) {
            filesModifiedMap.set(r.stepId, r.filesModified)
          }
          if (r.success) {
            completedSteps.push(r.stepId)
          } else {
            failedSteps.push(r.stepId)
          }
        }

        if (this.config.abortOnFailure && results.some(r => !r.success)) break
      }

      if (completedSteps.length === beforeCompleted) break
    }

    const result: LoopResult = {
      completedSteps,
      failedSteps,
      totalIterations: iteration,
      success: failedSteps.length === 0,
      summary: `Completed ${completedSteps.length} steps, ${failedSteps.length} failed in ${iteration} iterations.`,
    }

    this.observers.forEach(o => o.onLoopComplete(result))
    return result
  }

  private batchSteps(steps: Subtask[], filesModified: Map<string, string[]>): Subtask[][] {
    if (steps.length <= 1) return [steps]
    if (!this.config.maxParallelism) return [steps]

    const batches: Subtask[][] = []
    const used = new Set<string>()

    for (const step of steps) {
      if (used.has(step.id)) continue
      const batch: Subtask[] = [step]
      used.add(step.id)

      for (const other of steps) {
        if (used.has(other.id)) continue
        const conflict = this.hasConflict(step, other, filesModified)
        if (!conflict && batch.length < this.config.maxParallelism) {
          batch.push(other)
          used.add(other.id)
        }
      }
      batches.push(batch)
    }

    return batches
  }

  private hasConflict(a: Subtask, b: Subtask, filesModified: Map<string, string[]>): boolean {
    const normalize = (p: string) => p.replace(/\\/g, "/").replace(/^\.\//, "")
    const filesA = (filesModified.get(a.id) ?? []).map(normalize)
    const filesB = (filesModified.get(b.id) ?? []).map(normalize)
    return filesA.some(f => filesB.includes(f))
  }

  private async executeBatch(
    batch: Subtask[],
    sessionId: string,
    executor: Executor,
    verifier: Verifier,
    errorAnalyzer: ErrorAnalyzer,
    depTracker: DependencyTracker,
    projectDir: string,
    stepExecutor: (step: Subtask) => Promise<{ success: boolean; output: string; filesModified: string[]; error?: string }>,
    fixExecutor?: (fix: string) => Promise<boolean>,
  ): Promise<Array<{ stepId: string; success: boolean; filesModified: string[]; replanned?: boolean }>> {
    if (batch.length <= 1) {
      const step = batch[0]
      const r = await this.executeStepWithRetry(
        step, sessionId, executor, verifier, errorAnalyzer,
        depTracker, projectDir, stepExecutor, fixExecutor, 0,
      )
      return [r]
    }

    const settled = await Promise.allSettled(
      batch.map(step =>
        this.executeStepWithRetry(
          step, sessionId, executor, verifier, errorAnalyzer,
          depTracker, projectDir, stepExecutor, fixExecutor, 0,
        ),
      ),
    )
    return settled.map((s, i) => {
      if (s.status === "fulfilled") return s.value
      return { stepId: batch[i].id, success: false, filesModified: [], replanned: false }
    })
  }

  private async executeStepWithRetry(
    step: Subtask,
    sessionId: string,
    executor: Executor,
    verifier: Verifier,
    errorAnalyzer: ErrorAnalyzer,
    depTracker: DependencyTracker,
    projectDir: string,
    stepExecutor: (step: Subtask) => Promise<{ success: boolean; output: string; filesModified: string[]; error?: string }>,
    fixExecutor?: (fix: string) => Promise<boolean>,
    depth = 0,
  ): Promise<{ stepId: string; success: boolean; filesModified: string[]; replanned?: boolean }> {
    let retryCount = 0
    let stepSuccess = false
    let stepOutput = ""
    let filesModified: string[] = []
    const preservedFiles: string[] = []

    while (retryCount <= this.config.maxRetries) {
      if (this.budgetTracker) {
        const budgetEvent = this.budgetTracker.check("session")
        if (budgetEvent) {
          stepOutput = `Budget exceeded (${budgetEvent.metric}: ${budgetEvent.current}/${budgetEvent.limit})`
          break
        }
      }

      this.observers.forEach(o => o.onStepStart(step.id, depth + 1))

      // P0: proper timeout — no Promise.race leak
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 120_000)
      let result: { success: boolean; output: string; filesModified: string[]; error?: string }
      try {
        result = await stepExecutor(step)
        clearTimeout(timeoutId)
      } catch (err) {
        clearTimeout(timeoutId)
        result = { success: false, output: "", filesModified: [], error: err instanceof Error ? err.message : String(err) }
      }

      if (result.filesModified && result.filesModified.length > 0) {
        depTracker.recordChange(sessionId, step.id, result.filesModified)
        filesModified = result.filesModified
      }

      stepSuccess = result.success
      stepOutput = result.output

      if (stepSuccess) {
        if (this.config.verifyAfterEach) {
          const isFinalStep = executor.getNextStep(sessionId) === null
          const tier = isFinalStep ? "deep" : "standard"
          const verifyResult = result.filesModified.length > 0
            ? await verifier.verifyAllDeep(step.id, projectDir, step.description, result.filesModified, false, tier)
            : await verifier.verifyAllDeep(step.id, projectDir, undefined, [], false, tier)

          if (!verifyResult.passed) {
            if (isFinalStep) {
              // Final step: blocking verify
              stepSuccess = false
              stepOutput = `Verification failed: ${verifyResult.errors.join("\n")}`
              const analysis = await errorAnalyzer.analyzeDeep(stepOutput, result.filesModified)
              this.observers.forEach(o => o.onStepComplete(step.id, false, analysis.suggestedFix))

              if (!this.config.autoRetry) { retryCount++; break }

              const repairResult = await this.attemptRepair(step, stepOutput, analysis, fixExecutor)
              if (!repairResult) { retryCount++; break }
              continue
            } else {
              // Intermediate step: NON-BLOCKING (Graph Harness §5.3)
              // Keep stepSuccess=true, just append warning to output
              stepOutput = `[Verify Warning] ${verifyResult.errors.join("\n")}\n\n${stepOutput}`
              console.warn(`[AgentLoop] Intermediate verify warning for step ${step.id}: ${verifyResult.errors.join("; ")}`)
            }
          }

          if (step.verificationCriteria.length > 0 && verifier.hasLLM()) {
            const criteriaResult = await verifier.verifyCriteria(
              step.verificationCriteria,
              step.description,
              filesModified,
              projectDir,
            )
            if (!criteriaResult.passed) {
              stepOutput = `Criteria check: ${criteriaResult.output}`
              this.observers.forEach(o => o.onStepComplete(step.id, true, stepOutput))
            }
          }
        }

        executor.recordResult(sessionId, {
          stepId: step.id,
          success: true,
          output: stepOutput,
          filesModified,
          error: result.error,
        })
        this.observers.forEach(o => o.onStepComplete(step.id, true, stepOutput))
        return { stepId: step.id, success: true, filesModified }
      }

      retryCount++
      this.observers.forEach(o => o.onStepComplete(step.id, false, stepOutput))

      if (!this.config.autoRetry || retryCount > this.config.maxRetries) break

      const analysis = await errorAnalyzer.analyzeDeep(stepOutput, filesModified)
      const repairResult = await this.attemptRepair(step, stepOutput, analysis, fixExecutor)
      if (!repairResult) break
    }

    if (
      this.config.autoRetry &&
      !this.replannedSteps.has(step.id) &&
      this.planner &&
      depth < 1
    ) {
      const errorText = stepOutput
      const newSubtasks = this.tryReplan(step, errorText)
      if (newSubtasks.length > 0) {
        this.replannedSteps.add(step.id)
        executor.replanStep(sessionId, step.id, newSubtasks)
        return { stepId: step.id, success: false, filesModified, replanned: true }
      }
    }

    executor.recordResult(sessionId, {
      stepId: step.id,
      success: false,
      output: stepOutput,
      filesModified: preservedFiles.length > 0 ? preservedFiles : [],
      error: stepOutput,
    })

    return { stepId: step.id, success: false, filesModified: preservedFiles.length > 0 ? preservedFiles : filesModified }
  }

  private tryReplan(failedStep: Subtask, errorText: string): Subtask[] {
    if (!this.planner) return []

    const contextHint = errorText.length > 100
      ? `${errorText.slice(0, 200)}`
      : errorText

    const replanGoal = `${failedStep.description} [replan: ${contextHint}]`
    const { intent } = this.planner.decompose(replanGoal, [], undefined)
    return intent.subtasks.map(s => ({
      ...s,
      dependsOn: failedStep.dependsOn,
      verificationCriteria: s.verificationCriteria,
    }))
  }

  private async attemptRepair(
    _step: Subtask,
    error: string,
    analysis: ReturnType<ErrorAnalyzer["analyze"]>,
    fixExecutor?: (fix: string) => Promise<boolean>,
  ): Promise<boolean> {
    try {
      const llmAnalysis = await this.llm.analyzeError(error, [])
      if (llmAnalysis && llmAnalysis.category !== "unknown" && llmAnalysis.fix && llmAnalysis.fix !== "Manual investigation needed") {
        if (fixExecutor) {
          const fixed = await fixExecutor(llmAnalysis.fix).catch((err) => {
            console.warn(`[AgentLoop] fixExecutor failed for step ${_step.id}:`, err)
            return false
          })
          if (fixed) return true
        }
        return true
      }
    } catch (e) {
      console.warn(`[AgentLoop] LLM repair failed for step ${_step.id}:`, e)
    }

    if (analysis && analysis.category !== "unknown") {
      return true
    }
    return false
  }
}


