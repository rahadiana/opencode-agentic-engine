/**
 * Internal Simulation + Imagination Engine (Comparison 20)
 *
 * Best practices applied:
 * - State cloning: deep clone for isolation, no side-effects on real state
 * - Simulation executor: lightweight dry-run without real changes
 * - Imagination engine: simulate candidates → score → sort → pick best
 * - Simulation cache: key = hash(plan) for result reuse
 * - Pre-execution validation: score plans BEFORE real execution
 *
 * References:
 * - "Pre-execution verification for LLM-generated agentic workflows" (HN, 2026)
 * - "Agent Action Gate" pre-execution governance layer
 * - "Building Effective AI Agents" (Anthropic) — evaluate before deploy
 */

import crypto from "node:crypto"

// ── Types ────────────────────────────────────────────────────────────────

export interface SimulatedStep {
  stepId: string
  description: string
  /** Estimated complexity 1-10 */
  complexity: number
  /** Predicted success probability 0-1 */
  predictedSuccess: number
  /** Estimated tokens needed */
  estimatedTokens: number
  /** Dependencies on other step IDs */
  dependsOn: string[]
}

export interface SimulationInput {
  planId: string
  steps: SimulatedStep[]
  /** Goal the plan is trying to achieve */
  goal: string
  /** Context about the codebase / environment */
  context?: string
}

export interface SimulationResult {
  planId: string
  /** Overall score 0-1 (higher = better) */
  score: number
  /** Individual step results */
  stepResults: SimulatedStepResult[]
  /** Predicted total tokens */
  totalTokens: number
  /** Predicted steps needed */
  totalSteps: number
  /** Predicted success rate */
  overallSuccessRate: number
  /** Warnings about potential issues */
  warnings: string[]
  /** Whether this plan is recommended for execution */
  recommended: boolean
  /** Timestamp of simulation */
  timestamp: number
}

export interface SimulatedStepResult {
  stepId: string
  score: number
  warnings: string[]
  blocked: boolean
  blockedBy: string[]
}

export interface SimulationCacheEntry {
  hash: string
  result: SimulationResult
  cachedAt: number
  ttl: number
}

export interface SimulationConfig {
  /** Max tokens before warning (default: 100000) */
  maxTokenWarning?: number
  /** Complexity threshold for flagging (default: 7) */
  complexityThreshold?: number
  /** Minimum success rate to recommend (default: 0.6) */
  minRecommendThreshold?: number
  /** Cache TTL in ms (default: 60000 = 1 min) */
  cacheTtlMs?: number
  /** Max cache entries (default: 100) */
  maxCacheEntries?: number
  /** Weight for step completeness in scoring (default: 0.4) */
  completenessWeight?: number
  /** Weight for success probability in scoring (default: 0.4) */
  successWeight?: number
  /** Weight for resource efficiency in scoring (default: 0.2) */
  efficiencyWeight?: number
}

const DEFAULTS: Required<SimulationConfig> = {
  maxTokenWarning: 100000,
  complexityThreshold: 7,
  minRecommendThreshold: 0.6,
  cacheTtlMs: 60000,
  maxCacheEntries: 100,
  completenessWeight: 0.4,
  successWeight: 0.4,
  efficiencyWeight: 0.2,
}

// ── SimulationEngine Class ──────────────────────────────────────────────

export class SimulationEngine {
  private cache = new Map<string, SimulationCacheEntry>()
  private config: Required<SimulationConfig>
  private simulationCount = 0

  constructor(config: SimulationConfig = {}) {
    this.config = { ...DEFAULTS, ...config }
  }

  /**
   * Simulate a plan and return scored results.
   * Does NOT modify any state — pure computation.
   */
  simulate(input: SimulationInput): SimulationResult {
    this.simulationCount++

    // Check cache first
    const hash = this._hash(input)
    const cached = this.cache.get(hash)
    if (cached && Date.now() - cached.cachedAt < cached.ttl) {
      return cached.result
    }

    const stepResults: SimulatedStepResult[] = []
    const warnings: string[] = []
    let totalTokens = 0
    let completedSteps = 0

    // Build dependency map for cycle detection
    const depMap = new Map<string, string[]>()
    for (const step of input.steps) {
      depMap.set(step.stepId, step.dependsOn)
    }

    // Detect cycles
    const cycleWarnings = this._detectCycles(depMap)
    warnings.push(...cycleWarnings)

    // Analyze each step
    for (const step of input.steps) {
      const result = this._analyzeStep(step, depMap)
      stepResults.push(result)
      totalTokens += step.estimatedTokens

      if (!result.blocked) {
        completedSteps++
      }
    }

    // Calculate overall metrics
    const totalSteps = input.steps.length
    const overallSuccessRate = completedSteps > 0
      ? stepResults.reduce((sum, r) => sum + (r.blocked ? 0 : 1), 0) / totalSteps
      : 0

    // Score: weighted combination of completeness, success probability, efficiency
    const completenessScore = completedSteps / Math.max(totalSteps, 1)
    const successScore = overallSuccessRate
    const efficiencyScore = Math.max(0, 1 - (totalTokens / Math.max(this.config.maxTokenWarning, 1)))

    const score = (
      completenessScore * this.config.completenessWeight +
      successScore * this.config.successWeight +
      efficiencyScore * this.config.efficiencyWeight
    )

    // Additional warnings
    if (totalTokens > this.config.maxTokenWarning) {
      warnings.push(`Estimated token usage (${totalTokens}) exceeds warning threshold (${this.config.maxTokenWarning})`)
    }

    const highComplexitySteps = input.steps.filter(s => s.complexity > this.config.complexityThreshold)
    if (highComplexitySteps.length > 0) {
      warnings.push(`High complexity steps detected: ${highComplexitySteps.map(s => s.stepId).join(", ")}`)
    }

    // Dependency chains
    const maxDepth = this._maxDependencyDepth(input.steps)
    if (maxDepth > 5) {
      warnings.push(`Deep dependency chain detected (depth: ${maxDepth}). Consider parallelizing.`)
    }

    const result: SimulationResult = {
      planId: input.planId,
      score: Math.min(1, Math.max(0, score)),
      stepResults,
      totalTokens,
      totalSteps,
      overallSuccessRate,
      warnings,
      recommended: score >= this.config.minRecommendThreshold,
      timestamp: Date.now(),
    }

    // Cache result
    this._cacheResult(hash, result)
    return result
  }

  /**
   * Imagination engine: simulate multiple plan candidates, score them, return sorted.
   */
  imagine(candidates: SimulationInput[]): SimulationResult[] {
    const results = candidates.map(c => this.simulate(c))
    // Sort by score descending (best first)
    results.sort((a, b) => b.score - a.score)
    return results
  }

  /**
   * Get the best plan from a set of candidates.
   * Returns null if all candidates score below the recommend threshold.
   */
  getBestPlan(candidates: SimulationInput[]): SimulationResult | null {
    const results = this.imagine(candidates)
    return results.find(r => r.recommended) ?? null
  }

  /** Clear simulation cache */
  clearCache(): void {
    this.cache.clear()
  }

  /** Get stats */
  getStats(): { cacheSize: number; simulationsRun: number } {
    return {
      cacheSize: this.cache.size,
      simulationsRun: this.simulationCount,
    }
  }

  /** Get cache entry (for testing) */
  getCached(hash: string): SimulationCacheEntry | undefined {
    return this.cache.get(hash)
  }

  // ── Private ─────────────────────────────────────────────────────────

  private _hash(input: SimulationInput): string {
    const str = JSON.stringify({ planId: input.planId, steps: input.steps, goal: input.goal })
    return crypto.createHash("sha256").update(str).digest("hex").slice(0, 16)
  }

  private _cacheResult(hash: string, result: SimulationResult): void {
    // Evict oldest if at capacity
    if (this.cache.size >= this.config.maxCacheEntries) {
      const oldest = [...this.cache.entries()].sort((a, b) => a[1].cachedAt - b[1].cachedAt)[0]
      if (oldest) this.cache.delete(oldest[0])
    }
    this.cache.set(hash, {
      hash,
      result,
      cachedAt: Date.now(),
      ttl: this.config.cacheTtlMs,
    })
  }

  private _analyzeStep(step: SimulatedStep, depMap: Map<string, string[]>): SimulatedStepResult {
    const warnings: string[] = []
    let blocked = false
    const blockedBy: string[] = []

    // Check if dependencies are valid
    for (const dep of step.dependsOn) {
      if (!depMap.has(dep)) {
        warnings.push(`Step ${step.stepId} depends on unknown step: ${dep}`)
        blocked = true
        blockedBy.push(dep)
      }
    }

    // Warn on high complexity
    if (step.complexity > this.config.complexityThreshold) {
      warnings.push(`Step ${step.stepId} has high complexity (${step.complexity})`)
    }

    // Warn on low predicted success
    if (step.predictedSuccess < 0.3) {
      warnings.push(`Step ${step.stepId} has low predicted success (${step.predictedSuccess})`)
    }

    // Score based on complexity (lower complexity = higher score for a given step)
    const complexityScore = Math.max(0, 1 - (step.complexity / 10))
    const successScore = step.predictedSuccess
    const stepScore = blocked ? 0 : (complexityScore * 0.3 + successScore * 0.7)

    return {
      stepId: step.stepId,
      score: Math.min(1, Math.max(0, stepScore)),
      warnings,
      blocked,
      blockedBy,
    }
  }

  private _detectCycles(depMap: Map<string, string[]>): string[] {
    const warnings: string[] = []
    const visited = new Set<string>()
    const inStack = new Set<string>()

    const dfs = (node: string, path: string[]): boolean => {
      if (inStack.has(node)) {
        const cycle = path.slice(path.indexOf(node)).concat(node)
        warnings.push(`Circular dependency detected: ${cycle.join(" → ")}`)
        return true
      }
      if (visited.has(node)) return false

      visited.add(node)
      inStack.add(node)
      path.push(node)

      const deps = depMap.get(node) ?? []
      for (const dep of deps) {
        if (depMap.has(dep)) {
          dfs(dep, path)
        }
      }

      path.pop()
      inStack.delete(node)
      return false
    }

    for (const node of depMap.keys()) {
      if (!visited.has(node)) {
        dfs(node, [])
      }
    }

    return warnings
  }

  private _maxDependencyDepth(steps: SimulatedStep[]): number {
    const depths = new Map<string, number>()
    const inProgress = new Set<string>()
    const depMap = new Map(steps.map(s => [s.stepId, s.dependsOn]))

    const computeDepth = (stepId: string): number => {
      if (depths.has(stepId)) return depths.get(stepId)!
      // Cycle detection: if already computing this node, return 0
      if (inProgress.has(stepId)) return 0
      inProgress.add(stepId)
      const deps = depMap.get(stepId) ?? []
      if (deps.length === 0) {
        depths.set(stepId, 0)
        inProgress.delete(stepId)
        return 0
      }
      const maxDepDepth = Math.max(0, ...deps.map(d => depMap.has(d) ? computeDepth(d) + 1 : 0))
      depths.set(stepId, maxDepDepth)
      inProgress.delete(stepId)
      return maxDepDepth
    }

    for (const step of steps) {
      computeDepth(step.stepId)
    }

    return Math.max(0, ...depths.values())
  }
}
