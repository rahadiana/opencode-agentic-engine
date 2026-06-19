/**
 * BudgetTracker — Sirkuit pemutus berbasis resource untuk loop otonom.
 *
 * PDP layer: tools (agentic_budget) untuk define/list/check limits.
 * PEP layer: middleware di wiring (index.ts) yang panggil `check()` sebelum eksekusi.
 *
 * Empat sumbu tracking:
 *   - Token (input + output + reasoning + cache, diakumulasi per model)
 *   - Step (subtask-level, via Executor)
 *   - Time (wall-clock, exclude waiting-for-approval)
 *   - Cost (diturunkan dari token × modelPrices)
 *
 * Semua keputusan struktural per AGENTS.md#budget-decisions:
 *   - lifetime scope: DROP dari v1 (session + task only)
 *   - set merge: field-per-field, bukan replace total
 *   - onExceeded.request-approval tanpa listener → fallback hard-stop
 *   - maxSteps = subtask-level (selaras dengan agentic_auto.maxSteps)
 *   - PEP check synchronous: accumulator update selesai BEFORE check
 */

// ── Public types ──

export type BudgetScope = "session" | "task"

export type OnExceededBehavior = "hard-stop" | "request-approval" | "warn"

export interface BudgetLimits {
  /** Maksimum total token (input+output+reasoning+cache) */
  maxTokens?: number
  /** Maksimum subtask steps */
  maxSteps?: number
  /** Maksimum wall-clock time dalam milidetik */
  maxTimeMs?: number
  /** Maksimum biaya dalam USD */
  maxCostUsd?: number
}

export interface PerModelUsage {
  modelId: string
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cost: number
}

export interface BudgetState {
  scope: BudgetScope
  limits: Required<BudgetLimits>
  usage: {
    totalTokens: number
    totalSteps: number
    elapsedMs: number
    totalCostUsd: number
    waitingForApprovalMs: number
    /** Per-model breakdown */
    byModel: PerModelUsage[]
  }
  exceeded: BudgetExceededEvent | null
  pendingFrom?: number // timestamp when budget was set/reset
}

export interface BudgetExceededEvent {
  scope: BudgetScope
  metric: "tokens" | "steps" | "time" | "cost"
  current: number
  limit: number
  behavior: OnExceededBehavior
  modelId?: string // filled jika per-model
  timestamp: number
}

export interface ModelPriceEntry {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

/**
 * Default model prices (bundled, digunakan jika ~/.cache/opencode/models.json tidak tersedia).
 * Harga per 1K token dalam USD.
 */
const DEFAULT_MODEL_PRICES: Record<string, ModelPriceEntry> = {
  "openai/gpt-4o":               { input: 2.50,  output: 10.00,  cacheRead: 0.625, cacheWrite: 0 },
  "openai/gpt-4o-mini":          { input: 0.15,  output: 0.60,   cacheRead: 0.0375, cacheWrite: 0 },
  "anthropic/claude-sonnet-4":   { input: 3.00,  output: 15.00,  cacheRead: 0.30,   cacheWrite: 3.75 },
  "anthropic/claude-haiku-3.5":  { input: 0.80,  output: 4.00,   cacheRead: 0.08,   cacheWrite: 1.00 },
  "google/gemini-2.5-pro":       { input: 1.25,  output: 10.00,  cacheRead: 0.31,   cacheWrite: 2.38 },
  "opencode/deepseek-v4-flash-free": { input: 0, output: 0,      cacheRead: 0,       cacheWrite: 0 },
  "opencode/big-pickle":         { input: 0,     output: 0,      cacheRead: 0,       cacheWrite: 0 },
} as const

/** Default limit values (digunakan saat limit tidak di-set) */
const NO_LIMIT: Required<BudgetLimits> = {
  maxTokens: Infinity,
  maxSteps: Infinity,
  maxTimeMs: Infinity,
  maxCostUsd: Infinity,
}

// ── BudgetTracker class ──

export class BudgetTracker {
  /** Per-model usage ledger granular */
  private ledger: Map<string, PerModelUsage> = new Map()
  /** Step counter (subtask-level) */
  private stepCount = 0
  /** Wall-clock start timestamp */
  private startTime = Date.now()
  /** Accumulated pause time saat menunggu approval */
  private approvalPauseMs = 0
  /** Timestamp kapan pause dimulai (null = tidak sedang pause) */
  private pauseStart: number | null = null
  /** Model prices (dari config atau default bawaan) */
  private modelPrices: Record<string, ModelPriceEntry>
  /** Limits per scope */
  private limits: Map<BudgetScope, Required<BudgetLimits>> = new Map()
  /** Behavior per scope */
  private behaviors: Map<BudgetScope, OnExceededBehavior> = new Map()
  /** Status exceeded terakhir (null = tidak exceeded) */
  private _exceeded: BudgetExceededEvent | null = null

  constructor(modelPrices?: Record<string, ModelPriceEntry>) {
    this.modelPrices = { ...DEFAULT_MODEL_PRICES, ...(modelPrices ?? {}) }
  }

  // ── Limit management ──

  /**
   * Set budget limits untuk scope tertentu.
   * Merge field-per-field — hanya field yang dikirim berubah.
   * Jika scope belum pernah di-set, default: {maxTokens,maxSteps,maxTimeMs,maxCostUsd} = Infinity
   */
  setLimits(scope: BudgetScope, limits: Partial<Required<BudgetLimits>>, behavior: OnExceededBehavior = "hard-stop"): void {
    const current = this.limits.get(scope) ?? { ...NO_LIMIT }
    this.limits.set(scope, { ...current, ...limits })
    this.behaviors.set(scope, behavior)
  }

  /** Hapus limits untuk scope */
  clearLimits(scope: BudgetScope): void {
    this.limits.delete(scope)
    this.behaviors.delete(scope)
  }

  /** Dapatkan limits untuk scope (atau default Infinity) plus behavior */
  getLimits(scope: BudgetScope): Required<BudgetLimits> {
    return this.limits.get(scope) ?? { ...NO_LIMIT }
  }

  /** Dapatkan behavior untuk scope */
  getBehavior(scope: BudgetScope): OnExceededBehavior {
    return this.behaviors.get(scope) ?? "hard-stop"
  }

  // ── Accumulators ──

  /**
   * Catat pemakaian token dari satu LLM call.
   * inputTokens: token prompt
   * outputTokens: token completion
   * reasoningTokens: token reasoning/thinking (Claude, o1, dll)
   * cacheReadTokens: token yang dibaca dari cache
   * cacheWriteTokens: token yang ditulis ke cache
   */
  recordTokens(
    modelId: string,
    inputTokens = 0,
    outputTokens = 0,
    reasoningTokens = 0,
    cacheReadTokens = 0,
    cacheWriteTokens = 0,
  ): void {
    const entry = this.getOrCreateModelEntry(modelId)
    entry.inputTokens += inputTokens
    entry.outputTokens += outputTokens
    entry.reasoningTokens += reasoningTokens
    entry.cacheReadTokens += cacheReadTokens
    entry.cacheWriteTokens += cacheWriteTokens

    const price = this.lookupPrice(modelId)
    const costInMicroCents = Math.round(this.calculateCost(inputTokens, outputTokens, reasoningTokens, cacheReadTokens, cacheWriteTokens, price) * 1_000_000)
    entry.cost = (entry.cost * 1_000_000 + costInMicroCents) / 1_000_000
  }

  /** Catat completion satu subtask step */
  recordStep(): void {
    this.stepCount++
  }

  /** Tandai bahwa kita mulai menunggu approval (pause timer) */
  pauseApproval(): void {
    if (this.pauseStart === null) {
      this.pauseStart = Date.now()
    }
  }

  /** Tandai bahwa approval selesai (resume timer) */
  resumeApproval(): void {
    if (this.pauseStart !== null) {
      this.approvalPauseMs += Date.now() - this.pauseStart
      this.pauseStart = null
    }
  }

  /** Reset semua counter untuk scope tertentu (task baru dalam sesi yg sama) */
  reset(scope: BudgetScope): void {
    if (scope === "task") {
      // Task reset: reset counter tapi pertahankan limits & modelPrices
      this.ledger.clear()
      this.stepCount = 0
      this.startTime = Date.now()
      this.approvalPauseMs = 0
      this.pauseStart = null
      this._exceeded = null
    }
    // session reset: sama + clear limits (biar di-set ulang)
    if (scope === "session") {
      this.ledger.clear()
      this.stepCount = 0
      this.startTime = Date.now()
      this.approvalPauseMs = 0
      this.pauseStart = null
      this._exceeded = null
      this.limits.clear()
      this.behaviors.clear()
    }
  }

  // ── PEP check ──

  /**
   * Cek apakah budget terlampaui untuk scope tertentu.
   * Panggil synchronous SETELAH accumulator di-update.
   * Returns BudgetExceededEvent jika exceeded, null jika aman.
   */
  check(scope: BudgetScope): BudgetExceededEvent | null {
    const limits = this.limits.get(scope)
    if (!limits) return null // tidak ada limit → aman

    const elapsed = this.elapsedMs
    const totalTokens = this.totalTokens
    const totalCost = this.totalCostUsd
    const totalSteps = this.stepCount
    const behavior = this.behaviors.get(scope) ?? "hard-stop"

    // Urutan check: termurah dulu (fail-fast)
    // Steps → murah (integer compare)
    if (totalSteps >= limits.maxSteps) {
      return this.emitExceeded(scope, "steps", totalSteps, limits.maxSteps, behavior)
    }
    // Time → murah (number compare)
    if (elapsed >= limits.maxTimeMs) {
      return this.emitExceeded(scope, "time", elapsed, limits.maxTimeMs, behavior)
    }
    // Tokens → sedikit lebih mahal (iterasi ledger)
    if (totalTokens >= limits.maxTokens) {
      return this.emitExceeded(scope, "tokens", totalTokens, limits.maxTokens, behavior)
    }
    // Cost → paling mahal (iterasi ledger + lookup price) — check paling akhir
    if (totalCost >= limits.maxCostUsd) {
      return this.emitExceeded(scope, "cost", totalCost, limits.maxCostUsd, behavior)
    }

    return null
  }

  // ── Status queries ──

  /** Dapatkan state lengkap untuk action `status` */
  getState(scopes: BudgetScope[]): BudgetState[] {
    return scopes.map((scope) => ({
      scope,
      limits: this.getLimits(scope),
      usage: {
        totalTokens: this.totalTokens,
        totalSteps: this.stepCount,
        elapsedMs: this.elapsedMs,
        totalCostUsd: this.totalCostUsd,
        waitingForApprovalMs: this.approvalPauseMs,
        byModel: Array.from(this.ledger.values()),
      },
      exceeded: this._exceeded,
      pendingFrom: this.startTime,
    }))
  }

  /** Total token lintas semua model */
  get totalTokens(): number {
    let total = 0
    for (const entry of this.ledger.values()) {
      total += entry.inputTokens + entry.outputTokens + entry.reasoningTokens
        + entry.cacheReadTokens + entry.cacheWriteTokens
    }
    return total
  }

  /** Total cost dalam USD lintas semua model */
  get totalCostUsd(): number {
    let total = 0
    for (const entry of this.ledger.values()) {
      total += entry.cost
    }
    return total
  }

  /** Wall-clock elapsed dalam ms, minus waktu menunggu approval */
  get elapsedMs(): number {
    return Date.now() - this.startTime - this.approvalPauseMs
  }

  /** Step counter */
  get steps(): number {
    return this.stepCount
  }

  /** Apakah ada exceeded event aktif */
  get isExceeded(): boolean {
    return this._exceeded !== null
  }

  /** Exceeded event terakhir */
  get exceeded(): BudgetExceededEvent | null {
    return this._exceeded
  }

  /** Override model prices runtime (merge dengan default) */
  setModelPrices(prices: Record<string, ModelPriceEntry>): void {
    this.modelPrices = { ...this.modelPrices, ...prices }
  }

  // ── Private helpers ──

  private getOrCreateModelEntry(modelId: string): PerModelUsage {
    let entry = this.ledger.get(modelId)
    if (!entry) {
      entry = {
        modelId,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cost: 0,
      }
      this.ledger.set(modelId, entry)
    }
    return entry
  }

  private lookupPrice(modelId: string): ModelPriceEntry {
    const price = this.modelPrices[modelId]
    if (!price) {
      const fallback = this.modelPrices["openai/gpt-4o"] ?? { input: 2.5, output: 10, cacheRead: 0.3, cacheWrite: 0 }
      console.warn(`[BudgetTracker] No price configured for model "${modelId}", using gpt-4o fallback`)
      return fallback
    }
    return price
  }

  private calculateCost(
    inputTokens: number,
    outputTokens: number,
    reasoningTokens: number,
    cacheReadTokens: number,
    cacheWriteTokens: number,
    price: ModelPriceEntry,
  ): number {
    const totalOutput = outputTokens + reasoningTokens
    return (
      (inputTokens / 1000) * price.input +
      (totalOutput / 1000) * price.output +
      (cacheReadTokens / 1000) * price.cacheRead +
      (cacheWriteTokens / 1000) * price.cacheWrite
    )
  }

  private emitExceeded(
    scope: BudgetScope,
    metric: BudgetExceededEvent["metric"],
    current: number,
    limit: number,
    behavior: OnExceededBehavior,
  ): BudgetExceededEvent {
    const event: BudgetExceededEvent = {
      scope,
      metric,
      current: Math.round(current),
      limit,
      behavior,
      timestamp: Date.now(),
    }
    this._exceeded = event
    return event
  }
}
