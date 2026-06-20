/**
 * ConfidenceScorer — Gap #2: Confidence Scoring per Output
 *
 * Paper: Roychoudhury '25 — "Agentic AI Software Engineers: Programming with Trust"
 * arXiv:2502.13767 | CACM 2026
 *
 * Masalah:
 *   HallucinationGuard hanya binary pass/fail.
 *   Tidak ada confidence score per output → developer hesitation (trust barrier).
 *
 * Solusi:
 *   Composite weighted score dari 7 dimensi:
 *   - compileCheck    (0.25) — koreksi sintaks & tipe
 *   - hallucinationCheck (0.20) — truthfulness klaim
 *   - semanticMatch   (0.15) — kesesuaian dengan intent
 *   - testPassRate    (0.15) — regression test pass rate
 *   - lintCheck       (0.10) — code quality / compliance
 *   - techDebtImpact  (0.10) — maintainability (inverse debt)
 *   - modelReliability (0.05) — historical model trust
 *
 * Total weight = 1.0
 *
 * Integrasi:
 *   - Dipanggil dari agentic_execute handler (index.ts) setelah verify + guard
 *   - Dipanggil dari recordCompletion() (execution-helpers.ts) untuk pipeline path
 *   - Hasil ditampilkan di agentic_status dashboard per-step
 */

// ── Types ──

export interface ConfidenceDimensions {
  /** Compile check 0.0-1.0 */
  compileCheck: number
  /** Hallucination guard claim verification rate 0.0-1.0 */
  hallucinationCheck: number
  /** Semantic match with intent 0.0-1.0 */
  semanticMatch: number
  /** Test pass rate 0.0-1.0 */
  testPassRate: number
  /** Lint check 0.0-1.0 */
  lintCheck: number
  /** Tech debt impact 0.0-1.0 (inverse: low debt = high score) */
  techDebtImpact: number
  /** Model reliability score 0.0-1.0 */
  modelReliability: number
}

export interface ProvenanceEntry {
  /** Source of this signal */
  source: string
  /** Value 0.0-1.0 */
  value: number
  /** Human-readable detail */
  detail: string
  /** Timestamp */
  timestamp: number
}

export interface ConfidenceScore {
  /** Overall weighted score 0.0-1.0 */
  overall: number
  /** Per-dimension breakdown */
  dimensions: ConfidenceDimensions
  /** Whether overall >= threshold (default 0.7) */
  passed: boolean
  /** Human-readable summary */
  summary: string
  /** Provenance trail */
  provenance: ProvenanceEntry[]
  /** Confidence threshold used */
  threshold: number
}

/** Input signals for scoring */
export interface ScoringSignals {
  stepId: string
  /** LLM model name used */
  modelName?: string

  /** Compile check result */
  compileResult?: { passed: boolean; output?: string }
  /** Hallucination guard result */
  guardResult?: {
    passed: boolean
    claims: Array<{ verified: boolean; type?: string; claim?: string }>
  }
  /** Test result */
  testResult?: {
    passed: boolean
    total?: number
    passedCount?: number
    output?: string
  }
  /** Lint result */
  lintResult?: { passed: boolean; output?: string }
  /** Semantic verification result */
  semanticResult?: { passed: boolean; issues?: string[]; output?: string }
  /** Tech debt score (from TechDebtScorer) */
  techDebtScore?: { overall: "low" | "medium" | "high" | "critical" }
  /** Model reliability score (from ModelRegistry) */
  modelReliability?: number
}

export interface ConfidenceWeights {
  compileCheck: number
  hallucinationCheck: number
  semanticMatch: number
  testPassRate: number
  lintCheck: number
  techDebtImpact: number
  modelReliability: number
}

/** Default weights — sum = 1.0 */
const DEFAULT_WEIGHTS: ConfidenceWeights = {
  compileCheck: 0.25,
  hallucinationCheck: 0.20,
  semanticMatch: 0.15,
  testPassRate: 0.15,
  lintCheck: 0.10,
  techDebtImpact: 0.10,
  modelReliability: 0.05,
}

const DEFAULT_THRESHOLD = 0.7

// ── ConfidenceScorer ──

export class ConfidenceScorer {
  private weights: ConfidenceWeights
  private threshold: number

  constructor(weights?: Partial<ConfidenceWeights>, threshold?: number) {
    this.weights = { ...DEFAULT_WEIGHTS, ...weights }
    this.threshold = threshold ?? DEFAULT_THRESHOLD
  }

  /**
   * Set custom weights (partial — unspecified keep defaults).
   */
  setWeights(weights: Partial<ConfidenceWeights>): void {
    this.weights = { ...this.weights, ...weights }
  }

  /**
   * Set confidence threshold.
   */
  setThreshold(threshold: number): void {
    this.threshold = threshold
  }

  /**
   * Get current weights.
   */
  getWeights(): ConfidenceWeights {
    return { ...this.weights }
  }

  /**
   * Get current threshold.
   */
  getThreshold(): number {
    return this.threshold
  }

  /**
   * Compute confidence score from available signals.
   * Missing signals → score 0 for that dimension (conservative).
   * This incentivizes gathering more signals (better verification).
   */
  score(signals: ScoringSignals): ConfidenceScore {
    const ts = Date.now()
    const provenance: ProvenanceEntry[] = []

    // ── 1. Compile check ──
    const compileScore = this.scoreFromPassFail(
      signals.compileResult, "compile", provenance, ts,
    )

    // ── 2. Hallucination check ──
    const guardScore = this.scoreHallucination(signals.guardResult, provenance, ts)

    // ── 3. Semantic match ──
    const semanticScore = this.scoreFromPassFail(
      signals.semanticResult, "semantic", provenance, ts,
    )

    // ── 4. Test pass rate ──
    const testScore = this.scoreTests(signals.testResult, provenance, ts)

    // ── 5. Lint check ──
    const lintScore = this.scoreFromPassFail(
      signals.lintResult, "lint", provenance, ts,
    )

    // ── 6. Tech debt impact ──
    const debtScore = this.scoreTechDebt(signals.techDebtScore, provenance, ts)

    // ── 7. Model reliability ──
    const modelScore = this.scoreModelReliability(signals.modelReliability, provenance, ts)

    const dimensions: ConfidenceDimensions = {
      compileCheck: compileScore,
      hallucinationCheck: guardScore,
      semanticMatch: semanticScore,
      testPassRate: testScore,
      lintCheck: lintScore,
      techDebtImpact: debtScore,
      modelReliability: modelScore,
    }

    // ── Weighted overall ──
    const overall = (
      compileScore * this.weights.compileCheck +
      guardScore * this.weights.hallucinationCheck +
      semanticScore * this.weights.semanticMatch +
      testScore * this.weights.testPassRate +
      lintScore * this.weights.lintCheck +
      debtScore * this.weights.techDebtImpact +
      modelScore * this.weights.modelReliability
    )

    const passed = overall >= this.threshold

    // ── Summary ──
    const pct = (overall * 100).toFixed(1)
    const statusEmoji = passed ? "✅" : "⚠️"
    const lowDims = this.getLowDimensions(dimensions)
    const summary = lowDims.length > 0
      ? `${statusEmoji} Confidence: ${pct}% — Attention needed: ${lowDims.join(", ")}`
      : `${statusEmoji} Confidence: ${pct}% — All dimensions healthy`

    return {
      overall: parseFloat(overall.toFixed(4)),
      dimensions,
      passed,
      summary,
      provenance,
      threshold: this.threshold,
    }
  }

  /**
   * Convert a pass/fail signal to 0.0/1.0.
   * Missing → 0 (conservative / signal not available).
   */
  private scoreFromPassFail(
    signal: { passed: boolean } | undefined,
    source: string,
    provenance: ProvenanceEntry[],
    ts: number,
  ): number {
    if (!signal) {
      provenance.push({ source, value: 0, detail: "Signal not available — scored 0 (conservative)", timestamp: ts })
      return 0
    }
    const value = signal.passed ? 1 : 0
    provenance.push({ source, value, detail: signal.passed ? "Passed" : "Failed", timestamp: ts })
    return value
  }

  /**
   * Score hallucination check: (% verified claims).
   * If no claims detected → 1.0 (clean).
   * If guard not available → 0 (conservative).
   */
  private scoreHallucination(
    signal: { passed: boolean; claims: Array<{ verified: boolean }> } | undefined,
    provenance: ProvenanceEntry[],
    ts: number,
  ): number {
    if (!signal) {
      provenance.push({ source: "guard", value: 0, detail: "Hallucination guard not available", timestamp: ts })
      return 0
    }
    if (signal.claims.length === 0) {
      provenance.push({ source: "guard", value: 1, detail: "No claims detected — clean output", timestamp: ts })
      return 1
    }
    const verified = signal.claims.filter(c => c.verified).length
    const rate = verified / signal.claims.length
    const detail = `${verified}/${signal.claims.length} claims verified (${(rate * 100).toFixed(0)}%)`
    provenance.push({ source: "guard", value: rate, detail, timestamp: ts })
    return rate
  }

  /**
   * Score test results: passed/total.
   * If total=0 → use binary pass/fail from .passed.
   */
  private scoreTests(
    signal: { passed: boolean; total?: number; passedCount?: number; output?: string } | undefined,
    provenance: ProvenanceEntry[],
    ts: number,
  ): number {
    if (!signal) {
      provenance.push({ source: "test", value: 0, detail: "Test results not available", timestamp: ts })
      return 0
    }
    if (signal.total && signal.total > 0 && signal.passedCount !== undefined) {
      const rate = signal.passedCount / signal.total
      const detail = `${signal.passedCount}/${signal.total} tests passed (${(rate * 100).toFixed(0)}%)`
      provenance.push({ source: "test", value: rate, detail, timestamp: ts })
      return rate
    }
    // Fallback: binary
    const value = signal.passed ? 1 : 0
    provenance.push({ source: "test", value, detail: signal.passed ? "All tests passed" : "Tests failed", timestamp: ts })
    return value
  }

  /**
   * Score tech debt impact: inverse of debt level.
   * low=1.0, medium=0.7, high=0.3, critical=0.0
   */
  private scoreTechDebt(
    signal: { overall: "low" | "medium" | "high" | "critical" } | undefined,
    provenance: ProvenanceEntry[],
    ts: number,
  ): number {
    if (!signal) {
      provenance.push({ source: "tech-debt", value: 0, detail: "Tech debt analysis not available", timestamp: ts })
      return 0
    }
    const debtMap: Record<string, number> = {
      low: 1.0,
      medium: 0.7,
      high: 0.3,
      critical: 0.0,
    }
    const value = debtMap[signal.overall] ?? 0.5
    provenance.push({ source: "tech-debt", value, detail: `Debt level: ${signal.overall}`, timestamp: ts })
    return value
  }

  /**
   * Score model reliability: use the score directly (0-1).
   * Default to 0.5 if not available (medium trust).
   */
  private scoreModelReliability(
    reliability: number | undefined,
    provenance: ProvenanceEntry[],
    ts: number,
  ): number {
    if (reliability === undefined) {
      provenance.push({ source: "model", value: 0.5, detail: "Model reliability not available — default 0.5 (moderate)", timestamp: ts })
      return 0.5
    }
    const value = Math.max(0, Math.min(1, reliability))
    provenance.push({ source: "model", value, detail: `Model reliability: ${(value * 100).toFixed(0)}%`, timestamp: ts })
    return value
  }

  /**
   * Get dimensions with score < 0.7 (low confidence).
   */
  private getLowDimensions(dims: ConfidenceDimensions): string[] {
    const low: string[] = []
    const entries: Array<[string, number]> = [
      ["compile", dims.compileCheck],
      ["hallucination", dims.hallucinationCheck],
      ["semantic", dims.semanticMatch],
      ["test", dims.testPassRate],
      ["lint", dims.lintCheck],
      ["tech-debt", dims.techDebtImpact],
      ["model", dims.modelReliability],
    ]
    for (const [name, score] of entries) {
      if (score < 0.7) low.push(`${name} (${(score * 100).toFixed(0)}%)`)
    }
    return low
  }

  /**
   * Render confidence score as a formatted block.
   */
  format(score: ConfidenceScore): string {
    const pct = (score.overall * 100).toFixed(1)
    const emoji = score.passed ? "✅" : "⚠️"

    let out = `\n### 📊 Confidence Score: ${pct}% ${emoji}\n\n`
    out += `| Dimension | Score | Weight |\n`
    out += `|-----------|-------|--------|\n`

    const dims: Array<[string, number, number]> = [
      ["Compile", score.dimensions.compileCheck, this.weights.compileCheck],
      ["Hallucination", score.dimensions.hallucinationCheck, this.weights.hallucinationCheck],
      ["Semantic", score.dimensions.semanticMatch, this.weights.semanticMatch],
      ["Test", score.dimensions.testPassRate, this.weights.testPassRate],
      ["Lint", score.dimensions.lintCheck, this.weights.lintCheck],
      ["Tech Debt", score.dimensions.techDebtImpact, this.weights.techDebtImpact],
      ["Model", score.dimensions.modelReliability, this.weights.modelReliability],
    ]

    for (const [label, value, weight] of dims) {
      const bar = "█".repeat(Math.round(value * 10))
      const empty = "░".repeat(10 - Math.round(value * 10))
      out += `| ${label} | ${bar}${empty} ${(value * 100).toFixed(0)}% | ${(weight * 100).toFixed(0)}% |\n`
    }

    out += `\n**Threshold:** ${(score.threshold * 100).toFixed(0)}% | **Overall:** ${(score.overall * 100).toFixed(1)}%\n`
    if (!score.passed) {
      out += `\n⚠️ **Below threshold.** Consider reviewing before proceeding.\n`
    }

    // Provenance summary
    const availableSignals = score.provenance.filter(p => p.value > 0 || p.detail.includes("available"))
    out += `\n**Signals used:** ${availableSignals.length}/${score.provenance.length}\n`

    return out
  }

  /**
   * Format as a compact single-line summary for the status dashboard.
   */
  formatCompact(score: ConfidenceScore): string {
    const pct = (score.overall * 100).toFixed(0)
    const emoji = score.passed ? "✅" : "⚠️"
    const dimStr = [
      `C:${(score.dimensions.compileCheck * 100).toFixed(0)}%`,
      `G:${(score.dimensions.hallucinationCheck * 100).toFixed(0)}%`,
      `S:${(score.dimensions.semanticMatch * 100).toFixed(0)}%`,
      `T:${(score.dimensions.testPassRate * 100).toFixed(0)}%`,
      `L:${(score.dimensions.lintCheck * 100).toFixed(0)}%`,
      `D:${(score.dimensions.techDebtImpact * 100).toFixed(0)}%`,
      `M:${(score.dimensions.modelReliability * 100).toFixed(0)}%`,
    ].join(" ")
    return `${emoji} ${pct}% [${dimStr}]`
  }
}

// ── Confidence Store (for per-step tracking) ──

export interface StepConfidenceRecord {
  stepId: string
  score: number
  passed: boolean
  dimensions: ConfidenceDimensions
  timestamp: number
  modelName?: string
}

/**
 * Per-step confidence store — di-populate oleh agentic_execute dan
 * di-query oleh agentic_status.
 */
export class ConfidenceStore {
  private records = new Map<string, StepConfidenceRecord>()

  /** Store a step's confidence score. */
  set(stepId: string, score: ConfidenceScore, modelName?: string): void {
    this.records.set(stepId, {
      stepId,
      score: score.overall,
      passed: score.passed,
      dimensions: score.dimensions,
      timestamp: Date.now(),
      modelName,
    })
  }

  /** Get confidence for a specific step. */
  get(stepId: string): StepConfidenceRecord | undefined {
    return this.records.get(stepId)
  }

  /** Get all records for a session. */
  getAll(): StepConfidenceRecord[] {
    return [...this.records.values()]
  }

  /** Get records sorted by descending score (highest confidence first). */
  getSorted(): StepConfidenceRecord[] {
    return [...this.records.values()].sort((a, b) => b.score - a.score)
  }

  /** Get steps below threshold. */
  getLowConfidence(threshold = 0.7): StepConfidenceRecord[] {
    return [...this.records.values()].filter(r => r.score < threshold)
  }

  /** Average confidence across all steps. */
  getAverage(): number {
    const all = this.getAll()
    if (all.length === 0) return 0
    return all.reduce((sum, r) => sum + r.score, 0) / all.length
  }

  /** Clear store */
  clear(): void {
    this.records.clear()
  }

  /** Count */
  get size(): number {
    return this.records.size
  }
}
