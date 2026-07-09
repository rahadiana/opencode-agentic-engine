/**
 * RAG Self-Improve Pipeline — unified critical-path facade.
 *
 * Closes the gap between paper modules (library) and runtime default path:
 *   Query → Adaptive Retrieval → Knowledge Boundary (KbPO)
 *     → Context Optimizer (MMKP) → Knowledge entries for injection
 *   Step result → Feedback Loop → quality/staleness update
 *
 * Modules composed (not reimplemented):
 * - RAGAdaptiveRetrieval (SCIM / SeaKR)
 * - KnowledgeBoundaryCalibrator (KbPO)
 * - RAGContextOptimizer (Self-Correcting RAG / MMKP)
 * - MDPRetrievalAgent (EvoGraph-R1) — deep mode only
 * - RAGFeedbackLoop (Closed-Loop RAG / PatchRAG)
 * - MultiIndexRAG (base store)
 *
 * Design: keep default path cheap (adaptive + boundary + optimizer).
 * Deep/MDP is opt-in for thorough research turns.
 */
import { createLogger } from "../observability/logger.js"
import type { MultiIndexRAG, IndexEntry } from "./multi-index-rag.js"
import { RAGAdaptiveRetrieval, type AdaptiveSearchResult } from "./rag-adaptive-retrieval.js"
import { KnowledgeBoundaryCalibrator, type KnowledgeState } from "./rag-knowledge-boundary.js"
import { RAGContextOptimizer, type OptimizedContext } from "./rag-context-optimizer.js"
import { MDPRetrievalAgent, type MDPResult } from "./rag-mdp-retrieval.js"
import { RAGFeedbackLoop, type StepFeedback, type FeedbackReport } from "./rag-feedback-loop.js"

const log = createLogger("RAGSelfImprove")

/** Knowledge entry shape shared with prompt injection / MemoryOrchestrator */
export interface SelfImproveKnowledgeEntry {
  source: string
  confidence: number
  content: string
  category: string
}

export type SelfImproveMode = "standard" | "deep"

export interface SelfImproveSearchOptions {
  /** standard = adaptive+boundary+optimizer (default). deep = MDP multi-turn first. */
  mode?: SelfImproveMode
  /** Max entries after optimization */
  limit?: number
  /** Token budget for context optimizer */
  tokenBudget?: number
  /**
   * Internal (parametric) confidence estimate 0–1.
   * Default 0.35 = "LLM knowledge is suspect" (knowledge-first).
   */
  internalConfidence?: number
  /** Optional category filter */
  category?: string
  /**
   * Auto-escalate standard → deep (MDP) when adaptive confidence is low.
   * Default true. Set false to keep MDP fully opt-in.
   * Config: memory.ragDeepEscalate
   */
  deepEscalate?: boolean
  /**
   * Confidence threshold (0–1) below which deep escalate fires.
   * Default 0.35. Config: memory.ragDeepEscalateThreshold
   */
  deepEscalateThreshold?: number
}

export interface SelfImproveSearchResult {
  knowledge: SelfImproveKnowledgeEntry[]
  /** Titles used for feedback tracking */
  usedTitles: string[]
  hasHighConfidence: boolean
  averageConfidence: number
  topConfidence: number
  knowledgeState: KnowledgeState
  adaptive: AdaptiveSearchResult | null
  optimized: OptimizedContext | null
  mdp: MDPResult | null
  /** Human-readable meta for prompt / status */
  meta: {
    mode: SelfImproveMode
    retrievalMode: string
    quadrant: number
    action: string
    sufficient: boolean
    recommendation: string
    /** True when standard path auto-escalated to MDP deep */
    deepEscalated?: boolean
  }
}

const DEFAULT_INTERNAL_CONFIDENCE = 0.35
const DEFAULT_LIMIT = 5
const DEFAULT_TOKEN_BUDGET = 4000
const HIGH_CONFIDENCE_THRESHOLD = 0.6

export class RAGSelfImprovePipeline {
  private adaptive: RAGAdaptiveRetrieval
  private boundary: KnowledgeBoundaryCalibrator
  private optimizer: RAGContextOptimizer
  private mdp: MDPRetrievalAgent
  private feedback: RAGFeedbackLoop
  private rag: MultiIndexRAG | null = null

  constructor() {
    this.adaptive = new RAGAdaptiveRetrieval()
    this.boundary = new KnowledgeBoundaryCalibrator()
    this.optimizer = new RAGContextOptimizer()
    this.mdp = new MDPRetrievalAgent()
    this.feedback = new RAGFeedbackLoop()
  }

  /** Bind to the live MultiIndexRAG instance (composition root). */
  setRagStore(rag: MultiIndexRAG): void {
    this.rag = rag
  }

  getRagStore(): MultiIndexRAG | null {
    return this.rag
  }

  /**
   * Critical-path search: adaptive → KbPO calibrate → MMKP optimize → knowledge entries.
   * Falls back gracefully if RAG is empty or any stage fails.
   */
  async search(query: string, options: SelfImproveSearchOptions = {}): Promise<SelfImproveSearchResult> {
    let mode: SelfImproveMode = options.mode ?? "standard"
    const limit = options.limit ?? DEFAULT_LIMIT
    const tokenBudget = options.tokenBudget ?? DEFAULT_TOKEN_BUDGET
    const internalConfidence = options.internalConfidence ?? DEFAULT_INTERNAL_CONFIDENCE
    const deepEscalate = options.deepEscalate ?? true
    const deepEscalateThreshold = options.deepEscalateThreshold ?? DEFAULT_INTERNAL_CONFIDENCE

    const empty = this._emptyResult(mode)

    if (!this.rag || !query?.trim()) {
      return empty
    }

    try {
      let entries: IndexEntry[] = []
      let adaptive: AdaptiveSearchResult | null = null
      let mdpResult: MDPResult | null = null
      let escalatedFromStandard = false

      if (mode === "deep") {
        mdpResult = await this.mdp.run(this.rag, query, 4, tokenBudget)
        entries = mdpResult.entries
        // Still run adaptive on final set for deficit/recommendation metadata
        adaptive = await this.adaptive.search(this.rag, query, "standard", limit)
        if (entries.length === 0) {
          entries = adaptive.entries
        }
      } else {
        adaptive = await this.adaptive.searchWithAutoEscalate(this.rag, query, 3, Math.max(limit * 2, 6))
        entries = adaptive.entries

        // M1: Auto-escalate to MDP deep when adaptive confidence is low
        // and escalate is enabled (config memory.ragDeepEscalate)
        if (deepEscalate && this._shouldDeepEscalate(adaptive, entries, deepEscalateThreshold)) {
          log.info(
            `[RAGSelfImprove] deep-escalate: avgScore=${(adaptive.avgScore ?? 0).toFixed(2)} ` +
            `threshold=${deepEscalateThreshold} → MDP`,
          )
          mdpResult = await this.mdp.run(this.rag, query, 4, tokenBudget)
          if (mdpResult.entries.length > 0) {
            entries = mdpResult.entries
          }
          mode = "deep"
          escalatedFromStandard = true
        }
      }

      // Optional category filter (soft)
      if (options.category && entries.length > 0) {
        const cat = options.category.toLowerCase()
        const filtered = entries.filter(e => (e.category ?? "").toLowerCase().includes(cat))
        if (filtered.length > 0) entries = filtered
      }

      // KbPO boundary calibration
      const knowledgeState = this.boundary.analyze(internalConfidence, entries)
      const calibrated = this.boundary.calibrateEntries(entries, knowledgeState)
      const usable = calibrated
        .filter(c => c.shouldUse)
        .map(c => {
          // Stamp calibrated confidence onto entry for downstream scoring
          c.entry.confidence = c.calibratedConfidence
          return c.entry
        })

      // Q4 refuse / empty → no knowledge injection
      if (knowledgeState.action === "refuse" || usable.length === 0) {
        return {
          ...empty,
          knowledgeState,
          adaptive,
          mdp: mdpResult,
          meta: {
            mode,
            retrievalMode: adaptive?.mode ?? (mdpResult ? "mdp" : "standard"),
            quadrant: knowledgeState.quadrant,
            action: knowledgeState.action,
            sufficient: false,
            recommendation: knowledgeState.action === "refuse" || knowledgeState.action === "research"
              ? "manual-research"
              : (adaptive?.recommendation ?? "manual-research"),
            deepEscalated: escalatedFromStandard,
          },
        }
      }

      // MMKP context optimizer under token budget
      const optimized = this.optimizer.optimize(usable, tokenBudget, query)
      const finalEntries = optimized.entries.slice(0, limit)

      const knowledge = this._toKnowledge(finalEntries)
      const confidences = knowledge.map(k => k.confidence)
      const topConfidence = confidences.length ? Math.max(...confidences) : 0
      const averageConfidence = confidences.length
        ? confidences.reduce((s, c) => s + c, 0) / confidences.length
        : 0
      const hasHighConfidence = confidences.some(c => c >= HIGH_CONFIDENCE_THRESHOLD)

      // Usable entries already filtered refuse/Q4; still mark research if action says so
      const sufficient = (adaptive?.sufficient ?? hasHighConfidence)
        && knowledgeState.action !== "research"

      log.info(
        `[RAGSelfImprove] query="${query.slice(0, 40)}..." mode=${mode} entries=${knowledge.length} ` +
        `Q${knowledgeState.quadrant}/${knowledgeState.action} high=${hasHighConfidence}`,
      )

      return {
        knowledge,
        usedTitles: finalEntries.map(e => e.title).filter(Boolean),
        hasHighConfidence,
        averageConfidence: Math.round(averageConfidence * 100) / 100,
        topConfidence: Math.round(topConfidence * 100) / 100,
        knowledgeState,
        adaptive,
        optimized,
        mdp: mdpResult,
        meta: {
          mode,
          retrievalMode: adaptive?.mode ?? (mdpResult ? "mdp" : "standard"),
          quadrant: knowledgeState.quadrant,
          action: knowledgeState.action,
          sufficient,
          recommendation: sufficient
            ? "proceed"
            : (adaptive?.recommendation ?? "manual-research"),
          deepEscalated: escalatedFromStandard,
        },
      }
    } catch (err) {
      log.warn(`[RAGSelfImprove] search failed, empty result: ${err instanceof Error ? err.message : String(err)}`)
      return empty
    }
  }

  /**
   * Closed-loop feedback: step outcome → RAG quality update.
   * Safe no-op when RAG unbound or no titles.
   */
  async feedStepResult(feedback: StepFeedback): Promise<FeedbackReport | null> {
    if (!this.rag) return null
    if (!feedback.usedEntryTitles?.length) {
      // Soft fallback: still allow empty report for observability
      return {
        entriesUpdated: 0,
        entryDetails: [],
        flaggedForReview: [],
        failurePatterns: [],
      }
    }
    try {
      const report = await this.feedback.feedStepResult(this.rag, feedback)
      if (report.entriesUpdated > 0) {
        log.info(
          `[RAGSelfImprove] feedback source=${feedback.sourceId} success=${feedback.success} ` +
          `updated=${report.entriesUpdated} flagged=${report.flaggedForReview.length}`,
        )
      }
      return report
    } catch (err) {
      log.warn(`[RAGSelfImprove] feedStepResult failed: ${err instanceof Error ? err.message : String(err)}`)
      return null
    }
  }

  /** Format pipeline meta for prompt injection (compact). */
  formatMetaForPrompt(result: SelfImproveSearchResult): string {
    const m = result.meta
    const lines = [
      `<self-improve-rag>`,
      `<mode>${m.mode}</mode>`,
      `<retrieval>${m.retrievalMode}</retrieval>`,
      `<kbpo quadrant="${m.quadrant}" action="${m.action}"/>`,
      `<sufficient>${m.sufficient}</sufficient>`,
      `<recommendation>${m.recommendation}</recommendation>`,
      `<confidence avg="${result.averageConfidence}" top="${result.topConfidence}" high="${result.hasHighConfidence}"/>`,
      `</self-improve-rag>`,
    ]
    return lines.join("\n")
  }

  // ── helpers ──

  /**
   * Decide whether standard adaptive results are too weak → escalate to MDP deep.
   * Triggers when: empty results, avgScore below threshold, or not sufficient + low scores.
   */
  private _shouldDeepEscalate(
    adaptive: AdaptiveSearchResult | null,
    entries: IndexEntry[],
    threshold: number,
  ): boolean {
    if (threshold <= 0) return false
    if (!adaptive) return entries.length === 0
    if (entries.length === 0) return true
    if (adaptive.avgScore < threshold) return true
    if (!adaptive.sufficient && adaptive.avgScore < threshold + 0.1) return true
    // Recommendation already says manual-research / decompose → try MDP once
    if (
      (adaptive.recommendation === "manual-research" || adaptive.recommendation === "decompose")
      && adaptive.avgScore < Math.max(threshold, 0.5)
    ) {
      return true
    }
    return false
  }

  private _toKnowledge(entries: IndexEntry[]): SelfImproveKnowledgeEntry[] {
    return entries
      .map(entry => {
        const content =
          entry.episode?.summary
          ?? entry.skill?.definition?.trigger?.pattern
          ?? entry.title
          ?? ""
        return {
          source: entry.title,
          confidence: entry.confidence ?? entry.qualityScore ?? entry.hybridScore ?? 0,
          content,
          category: entry.category ?? "knowledge",
        }
      })
      .filter(e => e.content.length > 0)
  }

  private _emptyResult(mode: SelfImproveMode): SelfImproveSearchResult {
    const knowledgeState: KnowledgeState = {
      internalConfidence: DEFAULT_INTERNAL_CONFIDENCE,
      externalConfidence: 0,
      quadrant: 4,
      action: "research",
      reasoning: "No RAG store or empty query",
      isNoisy: false,
      isInternalSufficient: false,
    }
    return {
      knowledge: [],
      usedTitles: [],
      hasHighConfidence: false,
      averageConfidence: 0,
      topConfidence: 0,
      knowledgeState,
      adaptive: null,
      optimized: null,
      mdp: null,
      meta: {
        mode,
        retrievalMode: "standard",
        quadrant: 4,
        action: "research",
        sufficient: false,
        recommendation: "manual-research",
      },
    }
  }
}

/** Singleton accessor for composition root + tools (avoids ToolContext bloat). */
let _pipeline: RAGSelfImprovePipeline | null = null

export function getRAGSelfImprovePipeline(): RAGSelfImprovePipeline {
  if (!_pipeline) _pipeline = new RAGSelfImprovePipeline()
  return _pipeline
}

export function setRAGSelfImprovePipeline(pipeline: RAGSelfImprovePipeline): void {
  _pipeline = pipeline
}

/** Test helper: reset singleton */
export function resetRAGSelfImprovePipeline(): void {
  _pipeline = null
}
