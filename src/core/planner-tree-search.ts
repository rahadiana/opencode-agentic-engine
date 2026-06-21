/**
 * Tree Search Planner — Beam search-based plan exploration (Comparison 12).
 *
 * Design:
 * - Beam search: BEAM_WIDTH=3, MAX_DEPTH=4
 * - State-based: { goal, steps[], score, depth }
 * - Expansion: generate multiple candidate next steps via templates
 * - Scoring: short plan bias + diversity bonus
 * - Early stop: if score > 0.9
 * - BFS fallback: beam search prevents combinatorial explosion
 * - No LLM dependency: purely algorithmic using existing templates
 *
 * Integration:
 * - Standalone module — does NOT modify existing planner.ts
 * - Optional: Planner can optionally use TreeSearchPlanner
 * - Fallback: returns empty result if no valid plans found
 */

import type { Subtask } from "./intent-parser.js"
import crypto from "node:crypto"

// ── Constants ──────────────────────────────────────────────────────

/** Default beam width — number of top candidates to keep at each level */
export const DEFAULT_BEAM_WIDTH = 3

/** Default maximum search depth */
export const DEFAULT_MAX_DEPTH = 4

/** Score threshold for early termination */
export const EARLY_STOP_THRESHOLD = 0.9

/** Diversity bonus weight (0-1) — higher = more diverse plans */
export const DIVERSITY_WEIGHT = 0.15

// ── Interfaces ─────────────────────────────────────────────────────

/**
 * A search state in the beam search tree.
 * Represents a partial plan with accumulated score.
 */
export interface PlanState {
  /** Unique state ID */
  id: string
  /** Completed steps so far */
  steps: Subtask[]
  /** Accumulated score (higher = better) */
  score: number
  /** Current depth in the search tree */
  depth: number
  /** Parent state ID (for tree reconstruction) */
  parentId: string | null
  /** Plan label/name for this branch */
  label: string
}

/**
 * Result of the tree search.
 */
export interface TreeSearchResult {
  /** Best plan found (flattened subtasks) */
  bestPlan: Subtask[]
  /** All candidate plans considered */
  candidates: Subtask[][]
  /** Best score achieved */
  bestScore: number
  /** Number of states explored */
  statesExplored: number
  /** Whether early stop was triggered */
  earlyStopped: boolean
  /** Beam width used */
  beamWidth: number
  /** Max depth used */
  maxDepth: number
}

/**
 * Template-based expansion function.
 * Given the current goal and existing steps, produces candidate next steps.
 */
export type ExpansionFn = (
  goal: string,
  currentSteps: Subtask[],
  depth: number,
) => Array<{ label: string; nextSteps: Subtask[] }>

// ── Default Expansion Templates ────────────────────────────────────

/**
 * Default expansion templates used when no custom expansion function is provided.
 * These mirror the decomposition patterns from planner.ts but produce
 * multiple candidate continuations for beam search exploration.
 */
const DEFAULT_EXPANSIONS: Array<{
  pattern: RegExp
  label: string
  generate: (goal: string, depth: number) => Subtask[]
}> = [
  // ── Create/Feature patterns ──
  {
    pattern: /add|create|build|implement|develop/i,
    label: "feature",
    generate: (goal: string, depth: number) => [
      { id: `ts-type-${depth}`, description: `Define TypeScript interfaces and types: ${goal.slice(0, 60)}`, dependsOn: [], verificationCriteria: ["No type errors"] },
      { id: `ts-impl-${depth}`, description: `Implement core logic: ${goal.slice(0, 60)}`, dependsOn: [`ts-type-${depth}`], verificationCriteria: ["Core feature works"] },
      { id: `ts-test-${depth}`, description: `Write unit tests for: ${goal.slice(0, 60)}`, dependsOn: [`ts-impl-${depth}`], verificationCriteria: ["All tests pass"] },
      { id: `ts-edge-${depth}`, description: "Add error handling and edge cases", dependsOn: [`ts-test-${depth}`], verificationCriteria: ["Edge cases covered"] },
    ],
  },
  {
    pattern: /add|create|build|implement|develop/i,
    label: "feature-minimal",
    generate: (goal: string, depth: number) => [
      { id: `fm-impl-${depth}`, description: `Implement: ${goal.slice(0, 60)}`, dependsOn: [], verificationCriteria: ["Feature works"] },
      { id: `fm-test-${depth}`, description: "Test basic functionality", dependsOn: [`fm-impl-${depth}`], verificationCriteria: ["Tests pass"] },
    ],
  },
  {
    pattern: /add|create|build|implement|develop/i,
    label: "feature-tdd",
    generate: (goal: string, depth: number) => [
      { id: `td-test-${depth}`, description: `Write failing tests for: ${goal.slice(0, 60)}`, dependsOn: [], verificationCriteria: ["Tests fail as expected"] },
      { id: `td-impl-${depth}`, description: `Implement to make tests pass: ${goal.slice(0, 60)}`, dependsOn: [`td-test-${depth}`], verificationCriteria: ["All tests pass"] },
      { id: `td-refactor-${depth}`, description: "Refactor and clean up implementation", dependsOn: [`td-impl-${depth}`], verificationCriteria: ["Code clean, tests still pass"] },
    ],
  },

  // ── Fix/Bug patterns ──
  {
    pattern: /fix|bug|repair|resolve|patch/i,
    label: "bug-standard",
    generate: (goal: string, depth: number) => [
      { id: `br-repro-${depth}`, description: `Reproduce the bug: ${goal.slice(0, 60)}`, dependsOn: [], verificationCriteria: ["Bug reproducible"] },
      { id: `br-fix-${depth}`, description: `Apply fix: ${goal.slice(0, 60)}`, dependsOn: [`br-repro-${depth}`], verificationCriteria: ["Fix works"] },
      { id: `br-verify-${depth}`, description: "Verify fix and check regressions", dependsOn: [`br-fix-${depth}`], verificationCriteria: ["All tests pass"] },
    ],
  },
  {
    pattern: /fix|bug|repair|resolve|patch/i,
    label: "bug-quick",
    generate: (goal: string, depth: number) => [
      { id: `bq-diagnose-${depth}`, description: `Diagnose root cause: ${goal.slice(0, 60)}`, dependsOn: [], verificationCriteria: ["Root cause identified"] },
      { id: `bq-apply-${depth}`, description: `Apply targeted fix`, dependsOn: [`bq-diagnose-${depth}`], verificationCriteria: ["Bug fixed"] },
    ],
  },
  {
    pattern: /fix|bug|repair|resolve|patch/i,
    label: "bug-defensive",
    generate: (goal: string, depth: number) => [
      { id: `bd-test-${depth}`, description: `Add regression test for: ${goal.slice(0, 60)}`, dependsOn: [], verificationCriteria: ["Regression test added"] },
      { id: `bd-fix-${depth}`, description: `Fix the bug`, dependsOn: [`bd-test-${depth}`], verificationCriteria: ["Regression test passes"] },
      { id: `bd-audit-${depth}`, description: "Audit similar code for same bug pattern", dependsOn: [`bd-fix-${depth}`], verificationCriteria: ["Similar patterns checked"] },
    ],
  },

  // ── Refactor patterns ──
  {
    pattern: /refactor|clean|restructure|extract/i,
    label: "refactor-standard",
    generate: (goal: string, depth: number) => [
      { id: `ra-audit-${depth}`, description: `Audit current code: ${goal.slice(0, 60)}`, dependsOn: [], verificationCriteria: ["Audit complete"] },
      { id: `ra-apply-${depth}`, description: `Apply refactoring changes`, dependsOn: [`ra-audit-${depth}`], verificationCriteria: ["Refactoring applied"] },
      { id: `ra-verify-${depth}`, description: "Verify no regressions", dependsOn: [`ra-apply-${depth}`], verificationCriteria: ["All tests pass"] },
    ],
  },
  {
    pattern: /refactor|clean|restructure|extract/i,
    label: "refactor-incremental",
    generate: (goal: string, depth: number) => [
      { id: `ri-plan-${depth}`, description: `Plan refactoring steps: ${goal.slice(0, 60)}`, dependsOn: [], verificationCriteria: ["Plan documented"] },
      { id: `ri-execute-${depth}`, description: `Execute refactoring incrementally`, dependsOn: [`ri-plan-${depth}`], verificationCriteria: ["Each step verified"] },
      { id: `ri-cleanup-${depth}`, description: "Remove old code and update references", dependsOn: [`ri-execute-${depth}`], verificationCriteria: ["No dead code"] },
    ],
  },

  // ── Generic expansion (always available as fallback) ──
  {
    pattern: /.*/,
    label: "generic",
    generate: (goal: string, depth: number) => [
      { id: `g-research-${depth}`, description: `Research and gather context: ${goal.slice(0, 60)}`, dependsOn: [], verificationCriteria: ["Context gathered"] },
      { id: `g-execute-${depth}`, description: `Execute: ${goal.slice(0, 60)}`, dependsOn: [`g-research-${depth}`], verificationCriteria: ["Done"] },
      { id: `g-verify-${depth}`, description: "Verify results", dependsOn: [`g-execute-${depth}`], verificationCriteria: ["Verified"] },
    ],
  },
  {
    pattern: /.*/,
    label: "generic-simple",
    generate: (goal: string, depth: number) => [
      { id: `gs-do-${depth}`, description: goal.slice(0, 80), dependsOn: [], verificationCriteria: [] },
    ],
  },
]

// ── Default Expansion Function ─────────────────────────────────────

/**
 * Default expansion function that generates candidate next steps
 * using template matching against the goal.
 */
export function defaultExpansion(
  goal: string,
  _currentSteps: Subtask[],
  depth: number,
): Array<{ label: string; nextSteps: Subtask[] }> {
  const candidates: Array<{ label: string; nextSteps: Subtask[] }> = []

  for (const tmpl of DEFAULT_EXPANSIONS) {
    if (tmpl.pattern.test(goal)) {
      const steps = tmpl.generate(goal, depth)
      // Skip if exceeds max steps
      if (steps.length <= DEFAULT_MAX_DEPTH) {
        candidates.push({ label: tmpl.label, nextSteps: steps })
      }
    }
  }

  // Deduplicate by JSON key to avoid identical candidates
  const seen = new Set<string>()
  const unique: Array<{ label: string; nextSteps: Subtask[] }> = []
  for (const c of candidates) {
    const key = c.nextSteps.map(s => s.id + s.description).join("|")
    if (!seen.has(key)) {
      seen.add(key)
      unique.push(c)
    }
  }

  return unique
}

// ── Scoring ────────────────────────────────────────────────────────

/**
 * Score a plan state.
 * Higher score = better plan.
 *
 * Formula:
 * - Base: 1 / (steps.length + 1) — shorter plans with more steps score higher
 * - Completeness: more steps toward the goal is better (up to a point)
 * - No negative scoring for longer plans (up to MAX_DEPTH)
 */
export function scoreState(state: PlanState, _goal: string): number {
  const stepCount = state.steps.length
  if (stepCount === 0) return 0

  // Base score: more complete (more steps) is better, but diminishing returns
  // 1 step = 0.5, 2 steps = 0.67, 3 steps = 0.75, 4 steps = 0.8
  const completenessScore = stepCount / (stepCount + 1)

  return completenessScore
}

/**
 * Calculate diversity bonus between two plans.
 * Returns a value between 0 and 1 indicating how different they are.
 * 1 = completely different, 0 = identical.
 */
export function diversityBonus(planA: Subtask[], planB: Subtask[]): number {
  if (planA.length === 0 && planB.length === 0) return 0
  if (planA.length === 0 || planB.length === 0) return 0.5

  // Compare step descriptions for diversity
  const descsA = planA.map(s => s.description.toLowerCase().trim())
  const descsB = planB.map(s => s.description.toLowerCase().trim())

  // Jaccard-like similarity on word level
  const wordsA = new Set(descsA.flatMap(d => d.split(/\s+/)))
  const wordsB = new Set(descsB.flatMap(d => d.split(/\s+/)))

  if (wordsA.size === 0 && wordsB.size === 0) return 0

  let intersection = 0
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++
  }

  const union = wordsA.size + wordsB.size - intersection
  const similarity = union > 0 ? intersection / union : 0

  // Diversity = 1 - similarity
  return 1 - similarity
}

/**
 * Score a plan with diversity bonus relative to existing candidates.
 */
export function scoreWithDiversity(
  plan: Subtask[],
  _goal: string,
  existingCandidates: Subtask[][],
): number {
  const baseScore = plan.length > 0 ? plan.length / (plan.length + 1) : 0

  if (existingCandidates.length === 0) return baseScore

  // Average diversity against all existing candidates
  let totalDiversity = 0
  for (const existing of existingCandidates) {
    totalDiversity += diversityBonus(plan, existing)
  }
  const avgDiversity = totalDiversity / existingCandidates.length

  // Weighted combination
  return baseScore * (1 - DIVERSITY_WEIGHT) + avgDiversity * DIVERSITY_WEIGHT
}

// ── Beam Search Algorithm ──────────────────────────────────────────

/**
 * Tree Search Planner using beam search.
 *
 * Explores multiple plan candidates in parallel, keeping the top-K
 * most promising at each depth level.
 */
export class TreeSearchPlanner {
  private beamWidth: number
  private maxDepth: number
  private expansionFn: ExpansionFn

  constructor(
    beamWidth: number = DEFAULT_BEAM_WIDTH,
    maxDepth: number = DEFAULT_MAX_DEPTH,
    expansionFn?: ExpansionFn,
  ) {
    this.beamWidth = beamWidth
    this.maxDepth = maxDepth
    this.expansionFn = expansionFn ?? defaultExpansion
  }

  /**
   * Configure beam search parameters.
   */
  configure(params: { beamWidth?: number; maxDepth?: number }): void {
    if (params.beamWidth !== undefined) this.beamWidth = params.beamWidth
    if (params.maxDepth !== undefined) this.maxDepth = params.maxDepth
  }

  /**
   * Get current configuration.
   */
  getConfig(): { beamWidth: number; maxDepth: number } {
    return { beamWidth: this.beamWidth, maxDepth: this.maxDepth }
  }

  /**
   * Run beam search to find the best plan for a goal.
   *
   * Algorithm:
   * 1. Start with root state (empty plan)
   * 2. At each depth, expand each current state into candidate next steps
   * 3. Score all candidates
   * 4. Keep top-K (beam width) candidates
   * 5. Repeat until max depth or early stop threshold
   * 6. Return best plan found
   */
  search(goal: string): TreeSearchResult {
    const startId = crypto.randomUUID().slice(0, 8)

    // Root state
    let beam: PlanState[] = [{
      id: startId,
      steps: [],
      score: 0,
      depth: 0,
      parentId: null,
      label: "root",
    }]

    let statesExplored = 1
    let earlyStopped = false
    let bestScore = 0
    let bestPlan: Subtask[] = []

    // Collect all unique leaf plans
    const allCandidates: Subtask[][] = []

    for (let depth = 0; depth < this.maxDepth; depth++) {
      // Don't expand if we already have max depth
      if (depth >= this.maxDepth - 1) {
        // Record all current beam states as final candidates
        for (const state of beam) {
          if (state.steps.length > 0) {
            const planDesc = JSON.stringify(state.steps.map(s => s.id + s.description))
            const alreadyExists = allCandidates.some(c =>
              JSON.stringify(c.map(s => s.id + s.description)) === planDesc,
            )
            if (!alreadyExists) {
              allCandidates.push([...state.steps])
            }
          }
        }
        break
      }

      // Expand each state in the beam
      const allExpansions: PlanState[] = []

      for (const state of beam) {
        // For root state (empty steps), use the full expansion
        // For non-root, generate next incremental steps
        let candidates: Array<{ label: string; nextSteps: Subtask[] }>

        if (state.steps.length === 0) {
          // Full expansion from templates
          candidates = this.expansionFn(goal, state.steps, depth)
        } else {
          // For deeper levels, generate a single "continue" step
          // to avoid creating too many branches
          candidates = [{
            label: `continue-${depth}`,
            nextSteps: [{
              id: `step-${depth + 1}`,
              description: state.steps.length === 1
                ? `Complete remaining work for: ${goal.slice(0, 60)}`
                : `Continue implementation: ${goal.slice(0, 60)}`,
              dependsOn: [state.steps[state.steps.length - 1].id],
              verificationCriteria: [],
            }],
          }]
        }

        for (const candidate of candidates) {
          // Merge current steps with candidate's next steps
          const mergedSteps = [...state.steps, ...candidate.nextSteps]
          const newState: PlanState = {
            id: crypto.randomUUID().slice(0, 8),
            steps: mergedSteps,
            score: 0, // will be computed
            depth: depth + 1,
            parentId: state.id,
            label: candidate.label,
          }
          allExpansions.push(newState)
          statesExplored++
        }
      }

      if (allExpansions.length === 0) break

      // Score each expansion
      for (const state of allExpansions) {
        const existingPlans = allCandidates.length > 0
          ? allCandidates
          : beam.filter(b => b.steps.length > 0).map(b => b.steps)

        state.score = scoreWithDiversity(state.steps, goal, existingPlans)
      }

      // Sort by score descending and keep top-K (beam width)
      allExpansions.sort((a, b) => b.score - a.score)
      beam = allExpansions.slice(0, this.beamWidth)

      // Record all expanded plans as candidates
      for (const state of allExpansions) {
        if (state.steps.length > 0) {
          const planDesc = JSON.stringify(state.steps.map(s => s.id + s.description))
          const alreadyExists = allCandidates.some(c =>
            JSON.stringify(c.map(s => s.id + s.description)) === planDesc,
          )
          if (!alreadyExists) {
            allCandidates.push([...state.steps])
          }
        }
      }

      // Track best overall
      if (beam.length > 0 && beam[0].score > bestScore) {
        bestScore = beam[0].score
        bestPlan = [...beam[0].steps]
      }

      // Early stop check
      if (bestScore >= EARLY_STOP_THRESHOLD) {
        earlyStopped = true
        break
      }
    }

    // If no plan found via search, create a minimal fallback
    if (bestPlan.length === 0) {
      bestPlan = [{
        id: "fallback-1",
        description: goal,
        dependsOn: [],
        verificationCriteria: [],
      }]
      bestScore = 0.5
    }

    return {
      bestPlan,
      candidates: allCandidates,
      bestScore,
      statesExplored,
      earlyStopped,
      beamWidth: this.beamWidth,
      maxDepth: this.maxDepth,
    }
  }

  /**
   * Run beam search and return only the best plan as Subtask[].
   * Convenience method for integration with Planner.
   */
  async searchBest(goal: string): Promise<Subtask[]> {
    const result = this.search(goal)
    return result.bestPlan
  }
}

// ── Integration with Planner ───────────────────────────────────────

/**
 * Tree search configuration for Planner integration.
 */
export interface TreeSearchConfig {
  enabled: boolean
  beamWidth?: number
  maxDepth?: number
  /** Minimum score to accept tree search result (otherwise fallback) */
  minAcceptScore?: number
}
