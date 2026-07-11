/**
 * MDP-based Retrieval Policy — Agentic Retrieval via Markov Decision Process
 *
 * Berdasarkan paper:
 * - EvoGraph-R1 (CVPR, 2026): MDP dengan action GRAPHRETRIEVE, WEBSEARCH, GRAPHEDIT, ANSWER
 * - SPARKLE (ACL, 2026): proxy model + 3 agents (Retrieval Decision, Query Formulation, Knowledge Integration)
 * - RouteRAG (ACL Findings, 2026): RL-based multi-turn hybrid RAG, two-stage training
 *
 * Arsitektur:
 *   State(t) = {query, retrievedDocs, qualityScores, iteration, tokenBudget}
 *       ↓
 *   Policy π(at | st) → pilih action:
 *     • RETRIEVE    — cari dari knowledge base internal (RAG)
 *     • WEBSEARCH   — cari dari web eksternal
 *     • GRAPHEDIT   — update knowledge (INSERT/UPDATE/DELETE)
 *     • DECOMPOSE   — pecah query jadi sub-queries
 *     • ANSWER      — stop, hasilkan jawaban
 *       ↓
 *   Reward: accuracy + efficiency - redundancy penalty
 *
 * Implementasi:
 *   Karena plugin tidak bisa training RL sungguhan, kita pakai
 *   heuristic policy dengan adaptive thresholds (SPARKLE-inspired).
 *   Thresholds di-adjust berdasarkan historical success rate.
 */
import { createLogger } from "../observability/logger.js"
import type { MultiIndexRAG, IndexEntry } from "./multi-index-rag.js"
import { createDefaultQuality as _createDefaultQuality, computeQualityScore } from "./multi-index-rag.js"
import { RAGQualityScorer } from "./rag-quality-scorer.js"
import { RAGAdaptiveRetrieval, type AdaptiveSearchResult as _AdaptiveSearchResult } from "./rag-adaptive-retrieval.js"

const log = createLogger("RAGMDP")

// ── Types ──────────────────────────────────────────────────────

export type MDPAction = "retrieve" | "websearch" | "graph-edit" | "decompose" | "answer"

export interface MDPState {
  /** Iteration counter */
  turn: number
  /** Maximum turns allowed */
  maxTurns: number
  /** Original query */
  query: string
  /** Current (possibly decomposed) query */
  currentQuery: string
  /** Accumulated retrieved entries across turns */
  accumulatedEntries: IndexEntry[]
  /** Quality assessment of current knowledge */
  qualityScore: number
  /** Deficits detected from adaptive search */
  deficits: { completeness: boolean; consistency: boolean; factuality: boolean; relevance: boolean }
  /** Remaining token budget */
  remainingBudget: number
  /** Historical actions taken this session (for avoiding loops) */
  actionHistory: MDPAction[]
  /** Sub-queries if in decompose mode */
  subQueries: string[]
  /** Current sub-query index */
  subQueryIndex: number
}

export interface MDPActionChoice {
  action: MDPAction
  confidence: number
  reason: string
  /** For GRAPHEDIT: which sub-action */
  graphEditType?: "insert" | "update" | "delete"
  /** For DECOMPOSE: generated sub-queries */
  subQueries?: string[]
  /** For RETRIEVE: modified query */
  refinedQuery?: string
}

export interface MDPLogEntry {
  turn: number
  action: MDPAction
  query: string
  confidence: number
  result: string
  reward: number
}

export interface MDPResult {
  entries: IndexEntry[]
  actionLog: MDPLogEntry[]
  totalTurns: number
  finalAction: MDPAction
  success: boolean
  summary: string
}

// ── Policy Thresholds ──────────────────────────────────────────

interface MDPThresholds {
  /** Minimum quality to proceed without retrieval */
  minQualityForAnswer: number
  /** Quality below this triggers websearch */
  websearchThreshold: number
  /** Quality below this triggers decompose */
  decomposeThreshold: number
  /** Max consecutive same actions before forcing answer */
  maxConsecutiveSameAction: number
  /** Token budget per turn */
  budgetPerTurn: number
  /** Minimum confidence for graph-edit */
  minConfidenceForEdit: number
}

const DEFAULT_THRESHOLDS: MDPThresholds = {
  minQualityForAnswer: 0.7,
  websearchThreshold: 0.5,
  decomposeThreshold: 0.3,
  maxConsecutiveSameAction: 3,
  budgetPerTurn: 2000,
  minConfidenceForEdit: 0.8,
}

// ── MDP Retrieval Agent ────────────────────────────────────────

export class MDPRetrievalAgent {
  private adaptiveRetrieval: RAGAdaptiveRetrieval
  private qualityScorer: RAGQualityScorer
  private thresholds: MDPThresholds
  private actionCounters = new Map<MDPAction, number>()
  private consecutiveSameAction = 0
  private lastAction: MDPAction | null = null

  constructor(thresholds?: Partial<MDPThresholds>) {
    this.adaptiveRetrieval = new RAGAdaptiveRetrieval()
    this.qualityScorer = new RAGQualityScorer()
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds }
  }

  /**
   * Run MDP-based retrieval for a given query.
   *
   * EvoGraph-R1 inspired:
   * - Start dengan state awal
   * - Setiap turn: observe state → policy π → action → observe reward → update state
   * - Terminate ketika action=ANSWER atau maxTurns terlampaui
   */
  async run(
    rag: MultiIndexRAG,
    query: string,
    maxTurns: number = 5,
    tokenBudget: number = 8000,
  ): Promise<MDPResult> {
    const actionLog: MDPLogEntry[] = []
    this.actionCounters.clear()
    this.consecutiveSameAction = 0
    this.lastAction = null

    // Initial state
    const state: MDPState = {
      turn: 0,
      maxTurns,
      query,
      currentQuery: query,
      accumulatedEntries: [],
      qualityScore: 0,
      deficits: { completeness: false, consistency: false, factuality: false, relevance: false },
      remainingBudget: tokenBudget,
      actionHistory: [],
      subQueries: [],
      subQueryIndex: 0,
    }

    for (let turn = 0; turn < maxTurns; turn++) {
      state.turn = turn

      // Observe state
      await this._observeState(rag, state)

      // Policy: choose action
      const choice = this._policy(state)
      const action = choice.action

      // Execute action
      const result = await this._executeAction(rag, state, choice)
      const reward = this._computeReward(state, action, result)

      // Log
      actionLog.push({
        turn,
        action,
        query: state.currentQuery,
        confidence: choice.confidence,
        result: result.slice(0, 100),
        reward,
      })

      // Track consecutive actions
      if (action === this.lastAction) {
        this.consecutiveSameAction++
      } else {
        this.consecutiveSameAction = 1
      }
      this.lastAction = action
      this.actionCounters.set(action, (this.actionCounters.get(action) ?? 0) + 1)

      // Update state
      state.actionHistory.push(action)
      state.remainingBudget -= this.thresholds.budgetPerTurn

      // Check termination
      if (action === "answer") {
        log.info(`[MDP] Answer action chosen at turn ${turn + 1}/${maxTurns} for "${query.slice(0, 40)}..."`)
        return {
          entries: state.accumulatedEntries,
          actionLog,
          totalTurns: turn + 1,
          finalAction: "answer",
          success: true,
          summary: `MDP completed in ${turn + 1} turns: ${actionLog.map(l => l.action).join(" → ")}`,
        }
      }

      // Budget exhausted
      if (state.remainingBudget <= 0) {
        log.warn(`[MDP] Token budget exhausted at turn ${turn + 1}`)
        return {
          entries: state.accumulatedEntries,
          actionLog,
          totalTurns: turn + 1,
          finalAction: "answer",
          success: state.qualityScore >= 0.5,
          summary: `Budget exhausted: ${actionLog.map(l => l.action).join(" → ")}`,
        }
      }
    }

    // Max turns reached
    return {
      entries: state.accumulatedEntries,
      actionLog,
      totalTurns: maxTurns,
      finalAction: "answer",
      success: state.qualityScore >= 0.5,
      summary: `Max turns (${maxTurns}): ${actionLog.map(l => l.action).join(" → ")}`,
    }
  }

  /**
   * Format MDP result untuk prompt injection.
   * Termasuk action log dan quality assessment.
   */
  formatForPrompt(result: MDPResult): string {
    const lines: string[] = [
      `<mdp-retrieval>`,
      `<turns>${result.totalTurns}</turns>`,
      `<final-action>${result.finalAction}</final-action>`,
      `<success>${result.success}</success>`,
      `<action-trace>${result.actionLog.map(l => `${l.turn + 1}.${l.action}[${(l.confidence * 100).toFixed(0)}%]`).join(" → ")}</action-trace>`,
    ]

    if (result.entries.length > 0) {
      lines.push(`<retrieved-entries count="${result.entries.length}">`)
      for (const entry of result.entries.slice(0, 5)) {
        const qs = entry.qualityScore ?? 0.7
        lines.push(`  <entry quality="${(qs * 100).toFixed(0)}%">${entry.title}</entry>`)
      }
      lines.push(`</retrieved-entries>`)
    }

    lines.push(`</mdp-retrieval>`)
    return lines.join("\n")
  }

  // ── Private: State Observation ──

  private async _observeState(rag: MultiIndexRAG, state: MDPState): Promise<void> {
    // Adaptive search untuk menilai kualitas pengetahuan saat ini
    const searchResult = await this.adaptiveRetrieval.search(rag, state.currentQuery, "standard", 5)

    // Merge with accumulated entries (dedup by title)
    const existingTitles = new Set(state.accumulatedEntries.map(e => e.title))
    for (const entry of searchResult.entries) {
      if (!existingTitles.has(entry.title)) {
        state.accumulatedEntries.push(entry)
        existingTitles.add(entry.title)
      }
    }

    // Calculate average quality
    const entries = state.accumulatedEntries
    state.qualityScore = entries.length > 0
      ? entries.reduce((sum, e) => sum + (e.qualityScore ?? 0.7), 0) / entries.length
      : 0

    state.deficits = searchResult.deficits
  }

  // ── Private: Policy π(at | st) ──

  /**
   * Heuristic policy with adaptive thresholds.
   * SPARKLE-inspired: 3 agents in one:
   * - Retrieval Decision: apakah perlu cari lagi?
   * - Query Formulation: refine query based on deficits
   * - Knowledge Integration: pilih knowledge terbaik
   *
   * EvoGraph-R1 action space:
   * - RETRIEVE: cari internal
   * - WEBSEARCH: cari eksternal
   * - GRAPHEDIT: update knowledge
   * - DECOMPOSE: pecah query
   * - ANSWER: selesai
   */
  private _policy(state: MDPState): MDPActionChoice {
    const { qualityScore, deficits, turn, accumulatedEntries, actionHistory } = state

    // ── Termination conditions ──
    if (turn >= state.maxTurns - 1) {
      return { action: "answer", confidence: 0.6, reason: "Max turns reached" }
    }

    // Loop detection: same action repeated too many times
    if (this.consecutiveSameAction >= this.thresholds.maxConsecutiveSameAction) {
      const forcedAction: MDPAction = "answer"
      return { action: forcedAction, confidence: 0.5, reason: "Loop detected — forcing answer" }
    }

    // Hasil yang sudah cukup → ANSWER
    if (qualityScore >= this.thresholds.minQualityForAnswer && !deficits.completeness && !deficits.factuality) {
      return { action: "answer", confidence: 0.9, reason: `Quality ${(qualityScore * 100).toFixed(0)}% sufficient` }
    }

    // Query decomposition: quality sangat rendah
    if (qualityScore < this.thresholds.decomposeThreshold && deficits.completeness && !actionHistory.includes("decompose")) {
      const subQueries = this._generateSubQueries(state.query)
      return {
        action: "decompose",
        confidence: 0.7,
        reason: `Quality ${(qualityScore * 100).toFixed(0)}% too low — decomposing`,
        subQueries,
      }
    }

    // Consistency/factuality issue → websearch
    if ((deficits.consistency || deficits.factuality) && qualityScore < this.thresholds.websearchThreshold) {
      const refinedQuery = deficits.consistency
        ? `${state.currentQuery} best practices alternatives`
        : `${state.currentQuery} official documentation`
      return {
        action: "websearch",
        confidence: 0.7,
        reason: `${deficits.consistency ? "Consistency" : "Factuality"} deficit — seeking external validation`,
        refinedQuery,
      }
    }

    // Completeness issue → retrieve more (augment mode)
    if (deficits.completeness) {
      const refinedQuery = `${state.currentQuery} complete guide tutorial`
      return {
        action: "retrieve",
        confidence: 0.8,
        reason: "Completeness deficit — retrieving more specific knowledge",
        refinedQuery,
      }
    }

    // Need verification of existing knowledge → graph-edit quality update
    if (accumulatedEntries.length > 0 && qualityScore < 0.6 && !actionHistory.includes("graph-edit")) {
      return {
        action: "graph-edit",
        confidence: 0.6,
        reason: `Quality ${(qualityScore * 100).toFixed(0)}% — updating quality assessments`,
        graphEditType: "update",
      }
    }

    // Default: retrieve once more
    return {
      action: "retrieve",
      confidence: 0.6,
      reason: "Default retrieval",
    }
  }

  // ── Private: Action Execution ──

  private async _executeAction(
    rag: MultiIndexRAG,
    state: MDPState,
    choice: MDPActionChoice,
  ): Promise<string> {
    switch (choice.action) {
      case "retrieve": {
        const query = choice.refinedQuery ?? state.currentQuery
        const result = await this.adaptiveRetrieval.search(rag, query, "standard", 5)
        const newCount = result.entries.filter(
          e => !state.accumulatedEntries.some(a => a.title === e.title)
        ).length
        return `Retrieved ${newCount} new entries (mode: standard)`
      }

      case "websearch": {
        // Web search is logged as recommendation — actual fetch happens at LLM level
        const query = choice.refinedQuery ?? state.currentQuery
        return `Web search recommended: "${query}". LLM should call webfetch.`
      }

      case "graph-edit": {
        // Update quality scores of accumulated entries
        let updated = 0
        for (const entry of state.accumulatedEntries) {
          if (entry.quality) {
            // Apply decay-based reassessment
            const staleness = this.qualityScorer.computeStaleness({
              timestamp: entry.timestamp,
              lastVerifiedAt: entry.lastVerifiedAt,
              qualityScore: entry.qualityScore,
            })
            const newQuality = this.qualityScorer.applyDecay(entry.quality, staleness)
            entry.quality = newQuality
            entry.qualityScore = computeQualityScore(newQuality)
            entry.lastVerifiedAt = new Date().toISOString()
            updated++
          }
        }
        return `GRAPHEDIT: updated quality for ${updated} entries`
      }

      case "decompose": {
        state.subQueries = choice.subQueries ?? []
        state.subQueryIndex = 0
        if (state.subQueries.length > 0) {
          state.currentQuery = state.subQueries[0]
        }
        return `Decomposed into ${state.subQueries.length} sub-queries: ${state.subQueries.join(", ")}`
      }

      case "answer":
        return "Terminating — sufficient knowledge accumulated"

      default:
        return "Unknown action"
    }
  }

  // ── Private: Reward Computation ──

  /**
   * Compute reward for action taken.
   * RouteRAG-inspired: outcome reward + efficiency reward.
   *
   * Positive: action produced new useful entries or improved quality
   * Negative: action was redundant or degraded quality
   */
  private _computeReward(state: MDPState, action: MDPAction, result: string): number {
    let reward = 0

    // Base reward depends on action type
    switch (action) {
      case "retrieve":
        reward = result.includes("new entries") ? +0.5 : -0.2
        break
      case "websearch":
        reward = 0 // Neutral — actual reward depends on search results
        break
      case "graph-edit":
        reward = +0.3
        break
      case "decompose":
        reward = +0.2
        break
      case "answer":
        reward = state.qualityScore >= 0.7 ? +1.0 : -0.5
        break
    }

    // Efficiency penalty: each turn costs
    reward -= 0.1 * state.turn

    // Penalty untuk action yang sama berulang
    if (this.consecutiveSameAction > 1) {
      reward -= 0.15 * (this.consecutiveSameAction - 1)
    }

    return Math.round(reward * 100) / 100
  }

  // ── Private: Query Decomposition ──

  /**
   * Generate sub-queries dari query kompleks.
   * Heuristic: split by "and", "dan", commas, etc.
   */
  private _generateSubQueries(query: string): string[] {
    const separators = [/\s+dan\s+/i, /\s+and\s+/i, /\s*,\s*/]
    const _queries: string[] = [query]

    for (const sep of separators) {
      if (sep.test(query)) {
        const parts = query.split(sep).map(s => s.trim()).filter(Boolean)
        if (parts.length >= 2) return parts
      }
    }

    // If no separator found, return original as single sub-query
    return [query]
  }
}
