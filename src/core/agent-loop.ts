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
import { Verifier, type VerificationTier } from "./verifier.js"
import { ErrorAnalyzer } from "./error-analyzer.js"
import { DependencyTracker } from "../drift/dependency-tracker.js"
import { LLMEngine } from "./llm.js"
import { BudgetTracker } from "./budget-tracker.js"
import type { Planner } from "./planner.js"
import { TimeoutError } from "./errors.js"
import type { EventBus } from "./event-bus.js"
import { DAGEngine, type DAGPlan, type DAGExecutionContext, type DAGNode, type NodeRunner } from "./dag-engine.js"
import { ConfidenceScorer, ConfidenceStore, type ScoringSignals } from "./confidence-scorer.js"
import { PlanningLayer } from "./planning-layer.js"
import { ExecutionLayer } from "./execution-layer.js"
import { RecoveryLayer, type RecoveryDecision } from "./recovery-layer.js"
import { ToolGuardrailController, DEFAULT_GUARDRAIL_CONFIG, type ToolGuardrailConfig } from "./tool-guardrails.js"
import { createLogger } from "../observability/logger.js"

const log = createLogger("AgentLoop")

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

interface ExecutorWithState {
  states?: Map<string, { plan: { intent: { goal: string; subtasks: Subtask[] } } }>
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

  /** Event bus for Second Brain integration */
  private eventBus?: EventBus

  /** Tool Guardrails — loop detection for execution steps */
  private guardrails: ToolGuardrailController

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
    this.guardrails = new ToolGuardrailController(DEFAULT_GUARDRAIL_CONFIG)
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

  setEventBus(eventBus: EventBus): void {
    this.eventBus = eventBus
  }

  /** Configure guardrail thresholds at runtime */
  setGuardrailConfig(config: Partial<ToolGuardrailConfig>): void {
    this.guardrails.updateConfig(config)
  }

  /** Access guardrails for external inspection (tests, dashboard) */
  getGuardrails(): ToolGuardrailController {
    return this.guardrails
  }

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

    // Reset guardrails for this turn
    this.guardrails.resetForTurn()

    // ── Setup ────────────────────────────────────────────────────────

    // Dapatkan plan dari executor state
    const state = (executor as unknown as ExecutorWithState).states?.get(sessionId)
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
      log.warn(`[AgentLoop] Plan validation warnings: ${validation.warnings.join(", ")}`)
    }

    // Emit plan.created for Second Brain tracking
    this.eventBus?.emit({
      type: "plan.created",
      payload: {
        sessionID: sessionId,
        planId: subtasks[0]?.id ?? "plan-1",
        goal: plan.intent.goal,
        subtaskCount: subtasks.length,
        domain: "code",
      },
    })

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

      // Tool guardrails: before-call check — detect infinite retry loops
      const lastError = dagCtx.nodeStates.get(node.id)?.error
      const beforeDecision = this.guardrails.beforeCall(node.id, lastError)
      if (beforeDecision.action === "block" || beforeDecision.action === "halt") {
        log.warn(`[Guardrails] ${beforeDecision.action} on step "${node.id}": ${beforeDecision.message}`)
        return {
          success: false,
          output: beforeDecision.message,
          filesModified: [],
          error: `Guardrail ${beforeDecision.action}: ${beforeDecision.signal}`,
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

      // Tool guardrails: after-call — update counters
      this.guardrails.afterCall(
        node.id,
        result.success,
        result.output,
        result.filesModified ?? [],
      )

      // Tool guardrails: check idempotent-no-progress (read-only step with same result)
      if (result.success) {
        const idempotentDecision = this.guardrails.checkIdempotent(node.id)
        if (idempotentDecision.action === "block" || idempotentDecision.action === "halt") {
          log.warn(`[Guardrails] ${idempotentDecision.action} on step "${node.id}": ${idempotentDecision.message}`)
          result.success = false
          result.output = idempotentDecision.message
          result.error = `Guardrail ${idempotentDecision.action}: ${idempotentDecision.signal}`
        }
      }

      // Graph Harness §5.3: Verify intermediate steps NON-BLOCKING
      // Verification failure on intermediate steps should NOT set result.success = false.
      // Only the FINAL step uses verification as a blocking gate.
      // This prevents cascade failure where a typo in 1 file blocks all downstream steps.
      if (result.success && this.config.verifyAfterEach) {
        const isFinalStep = this.isAllCompleted(dagPlan, dagCtx)
        const { verified, output: verifyOutput } = await this.verifyStep(
          verifier, projectDir, node.id, subtask.description, isFinalStep, result.filesModified,
        )

        if (!verified) {
          // Final step: blocking verify — step must pass to be considered successful
          result.success = false
          result.output = verifyOutput

          // Attempt repair via LLM
          const analysis = await errorAnalyzer.analyzeDeep(result.output, result.filesModified)
          if (this.config.autoRetry) {
            const repaired = await this.attemptRepair(subtask, result.output, analysis, fixExecutor)
            if (repaired) {
              // Return failure to trigger DAG retry
              return { success: false, output: result.output, filesModified: result.filesModified, error: verifyOutput }
            }
          }
        } else if (verifyOutput && !verifyOutput.startsWith("✅")) {
          // Intermediate step: NON-BLOCKING — warn only, keep success=true
          // Per Graph Harness §5.3, this prevents cascading failure from minor issues
          result.output = `${verifyOutput}\n\n${result.output}`
          log.warn(`[AgentLoop] Intermediate verify warning for step ${node.id}`)
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
          log.warn(`[AgentLoop] ${warnMsg} for step ${node.id}`)
        }
        // Blocking FAIL for very low confidence (< 0.2)
        if (cs.overall < 0.2) {
          const isFinalStep = this.isAllCompleted(dagPlan, dagCtx)
          if (isFinalStep) {
            const failMsg = `[Confidence Block] Score ${cs.overall.toFixed(2)} < 0.2 — final step blocked`
            result.success = false
            result.output = `${failMsg}\n\n${result.output}`
            log.warn(`[AgentLoop] ${failMsg} for step ${node.id}`)
          } else {
            const warnMsg = `[Confidence Block Warning] Score ${cs.overall.toFixed(2)} < 0.2 — intermediate step at risk`
            result.output = `${warnMsg}\n\n${result.output}`
            log.warn(`[AgentLoop] ${warnMsg} for step ${node.id}`)
          }
        }
      }

      // Emit step event for Second Brain tracking
      if (result.success) {
        this.eventBus?.emit({
          type: "step.completed",
          payload: {
            sessionID: sessionId,
            stepId: node.id,
            output: result.output,
            filesModified: result.filesModified,
            success: true,
            durationMs: 0,
          },
        })
      } else {
        this.eventBus?.emit({
          type: "step.failed",
          payload: {
            sessionID: sessionId,
            stepId: node.id,
            output: result.output,
            filesModified: result.filesModified,
            error: result.error ?? "Unknown error",
            errorCategory: "unknown",
            durationMs: 0,
          },
        })
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
      await this.recoverNode(
        dagCtx, dagPlan, dagRunner, dagResult, subtasks,
        sessionId, executor, originallyFailed, pendingNodes, escalatedNodes,
      )
    }

    // Notify observers about escalated nodes
    if (escalatedNodes.length > 0) {
      log.warn(`[AgentLoop] Escalated ${escalatedNodes.length} node(s):`)
      for (const en of escalatedNodes) {
        log.warn(`  ${en.nodeId}: ${en.reason}`)
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
      log.warn(`[AgentLoop] Recovery depth limit (${MAX_RECOVERY_DEPTH}) reached — forcing all pending to escalated`)
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

    // ponytail: no wall-clock tracking in DAG runner; consumers don't depend on precise time
    this.eventBus?.emit({
      type: "plan.completed",
      payload: {
        sessionID: sessionId,
        planId: subtasks[0]?.id ?? "plan-1",
        goal: plan.intent.goal,
        allStepIds: [...completedSteps, ...failedSteps],
        allFilesModified: [],
        totalDurationMs: 0,
        allPassed: result.success,
      },
    })

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

  /**
   * Shared verification logic for both DAG and legacy paths.
   * Extracted to eliminate duplication between runLoop's dagRunner
   * and executeStepWithRetry.
   */
  private async verifyStep(
    verifier: Verifier,
    projectDir: string,
    stepId: string,
    stepDescription: string | undefined,
    isFinalStep: boolean,
    filesModified: string[],
  ): Promise<{ verified: boolean; tier: string; output: string }> {
    const tier: VerificationTier = isFinalStep ? "deep" : "standard"
    let output = ""

    try {
      const result = filesModified.length > 0
        ? await verifier.verifyAllDeep(stepId, projectDir, stepDescription, filesModified, false, tier)
        : await verifier.verifyAllDeep(stepId, projectDir, undefined, [], false, tier)
      const failedChecks = result.checks.filter(c => !c.passed)

      if (failedChecks.length > 0) {
        output = `⚠️ Verification (${tier}) found ${failedChecks.length} issue(s):\n` +
          failedChecks.map(c => `  - ${c.name}: ${c.output}`).join("\n")

        if (isFinalStep) {
          return { verified: false, tier, output }
        }

        // Intermediate steps: warn but don't block
        return { verified: true, tier, output }
      }

      output = `✅ Verification (${tier}) passed`
      return { verified: true, tier, output }
    } catch (err) {
      const msg = `Verification error: ${err instanceof Error ? err.message : String(err)}`
      log.warn(msg)
      output = msg
      return { verified: isFinalStep ? false : true, tier, output }
    }
  }

  /**
   * Graph Harness §3.3: Recovery node — strict escalation chain.
   * Extracted from runLoop's inline while loop.
   * Auto-chaining: retry → replan → escalate per node.
   */
  private async recoverNode(
    dagCtx: DAGExecutionContext,
    dagPlan: DAGPlan,
    dagRunner: NodeRunner,
    dagResult: { failedNodes: string[]; completedNodes: string[]; summary: string; success: boolean; escalationRequired?: boolean },
    subtasks: Subtask[],
    sessionId: string,
    executor: Executor,
    _originallyFailed: Set<string>,
    pendingNodes: Set<string>,
    escalatedNodes: Array<{ nodeId: string; reason: string }>,
  ): Promise<void> {
    const nodeId = [...pendingNodes][0]!
    pendingNodes.delete(nodeId)

    const node = dagCtx.nodes.get(nodeId)
    if (this.replannedSteps.has(nodeId)) return
    if (dagResult.completedNodes.includes(nodeId)) return
    if (!node) return

    const errorText = dagCtx.nodeStates.get(nodeId)?.error ?? "Unknown error"

    const decision: RecoveryDecision = this.recoveryLayer.decide(node, dagCtx, errorText)

    if (decision.action === "retry") {
      this.executionLayer.resetNode(dagCtx, nodeId)
      const retryResult = await this.executionLayer.executeNode(dagCtx, node, dagRunner)
      if (retryResult.success) {
        dagResult.failedNodes = dagResult.failedNodes.filter(id => id !== nodeId)
        if (!dagResult.completedNodes.includes(nodeId)) {
          dagResult.completedNodes.push(nodeId)
        }
        dagResult.summary += ` | Retried: ${nodeId} (success after ${decision.level})`
      } else {
        pendingNodes.add(nodeId)
      }
    } else if (decision.action === "replan" && this.planner) {
      const nodeSubtasks = subtasks.map(s => ({ ...s }))
      const failingSubtask = nodeSubtasks.find(s => s.id === nodeId)
      if (!failingSubtask) return

      const replanResult = this.recoveryLayer.generateReplan(failingSubtask, errorText, 
        (_desc, err) => this.tryReplan(failingSubtask, err))
      if (replanResult.newSubtasks.length > 0) {
        this.replannedSteps.add(nodeId)

        const planVersionResult = this.planningLayer.createPlanVersion(
          dagPlan.goal,
          nodeSubtasks,
          nodeId,
          replanResult.newSubtasks,
          dagPlan.metadata,
        )

        const newSubtasks = planVersionResult.plan.nodes.map((n: DAGNode) => ({
          id: n.id,
          description: n.description,
          dependsOn: n.deps,
          verificationCriteria: n.verificationCriteria ?? [],
        }))
        executor.replanStep(sessionId, nodeId, newSubtasks)

        const { context: newDagCtx, version: newVersion } = planVersionResult
        const retryResult = await this.executionLayer.execute(newDagCtx, dagRunner)

        for (const cn of retryResult.completedNodes) {
          if (!dagResult.completedNodes.includes(cn)) {
            dagResult.completedNodes.push(cn)
          }
        }

        if (retryResult.failedNodes.length === 0) {
          dagResult.failedNodes = dagResult.failedNodes.filter(id => id !== nodeId)
          dagResult.summary += ` | Replanned: ${nodeId} → v${newVersion.version} (${replanResult.summary})`
        } else {
          escalatedNodes.push({ nodeId, reason: `Replan v${newVersion.version} had ${retryResult.failedNodes.length} failure(s)` })
          for (const fn of retryResult.failedNodes) {
            if (!dagResult.failedNodes.includes(fn)) {
              dagResult.failedNodes.push(fn)
            }
          }
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
      escalatedNodes.push({ nodeId, reason: decision.reason })
    }
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
          const { verified, output: verifyOutput } = await this.verifyStep(
            verifier, projectDir, step.id, step.description, isFinalStep, result.filesModified,
          )

          if (!verified) {
            // Final step: blocking verify
            stepSuccess = false
            stepOutput = verifyOutput
            const analysis = await errorAnalyzer.analyzeDeep(stepOutput, result.filesModified)
            this.observers.forEach(o => o.onStepComplete(step.id, false, analysis.suggestedFix))

            if (!this.config.autoRetry) { retryCount++; break }

            const repairResult = await this.attemptRepair(step, stepOutput, analysis, fixExecutor)
            if (!repairResult) { retryCount++; break }
            continue
          } else if (verifyOutput && !verifyOutput.startsWith("✅")) {
            // Intermediate step: NON-BLOCKING (Graph Harness §5.3)
            // Keep stepSuccess=true, just append warning to output
            stepOutput = `${verifyOutput}\n\n${stepOutput}`
            log.warn(`[AgentLoop] Intermediate verify warning for step ${step.id}`)
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
            log.warn(`[AgentLoop] fixExecutor failed for step ${_step.id}:`, err)
            return false
          })
          if (fixed) return true
        }
        return true
      }
    } catch (e) {
      log.warn(`[AgentLoop] LLM repair failed for step ${_step.id}: ${String(e)}`)
    }

    if (analysis && analysis.category !== "unknown") {
      return true
    }
    return false
  }
}


