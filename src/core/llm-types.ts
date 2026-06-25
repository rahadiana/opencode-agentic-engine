/**
 * LLMConfig — token, temperature, dan fallback settings.
 *
 * 🔴 CRITICAL: Model TIDAK bisa di-set dari sini.
 * Semua LLM calls lewat OpenCode SDK — SDK yang menentukan model.
 * Plugin gak pernah ngatur model secara langsung.
 * Model override hanya via agentic_model (per-tool/per-category).
 *
 * Multi-provider auto fallback:
 *   Saat model utama gagal, engine mencoba model lain dari fallbackChain.
 *   Urutan: explicit model → fallbackChain[0] → fallbackChain[1] → ... → session default.
 *   Max attempts: 3 (termasuk primary).
 */
export interface LLMConfig {
  /** Maximum tokens for completion */
  maxTokens?: number
  /** Temperature (0.0-1.0) */
  temperature?: number
  /**
   * Ordered list of fallback models when the primary model fails.
   * Each entry is "providerID/modelID" format.
   * Engine tries these in order before falling back to session default.
   * Example: ["deepseek/deepseek-chat", "openai/gpt-4o", "anthropic/claude-sonnet-4-6"]
   */
  fallbackModels?: string[]
  /**
   * Maximum number of model attempts (including the primary).
   * Prevents infinite fallback loops. Default: 3.
   */
  maxFallbackAttempts?: number
  /**
   * Cost-aware auto-switch configuration.
   * When enabled, cheap models are automatically selected for quick/simple tasks,
   * saving cost while maintaining minimum reliability thresholds.
   */
  costAutoSwitch?: CostAutoSwitchConfig
}

/**
 * Cost-aware auto-switch configuration.
 * Controls when the engine automatically switches to cheaper models.
 * User satisfaction feedback (from agentic_execute feedback) is also considered —
 * models with low user satisfaction are deprioritized even if they meet cost/reliability.
 */
export interface CostAutoSwitchConfig {
  /** Enable cost-aware auto-switch (default: true) */
  enabled: boolean
  /**
   * Minimum absolute reliability threshold (0.0-1.0).
   * Auto-switch will only select models with reliability >= this value.
   * Default: 0.5
   */
  minReliability: number
  /**
   * Minimum user satisfaction threshold (0.0-1.0).
   * Models with satisfaction below this threshold are deprioritized
   * even if they meet cost/reliability criteria.
   * Default: 0.3
   */
  minUserSatisfaction: number
  /**
   * Maximum cost per call in USD before forced switch.
   * If the primary model's avgCostPerCall exceeds this, switch to cheaper.
   * Default: 0.01 ($0.01)
   */
  maxCostPerCall: number
  /**
   * Multiplier applied to minReliability when budget utilization > 80%.
   * Lower = more aggressive switching when budget is tight.
   * Default: 0.5 (relax threshold by 50%)
   */
  budgetTightMultiplier: number
  /**
   * Tool categories eligible for cost switching.
   * Default: ["quick", "unspecified-low"]
   */
  categories?: string[]
}

/** Event emitted when a cost-aware switch occurs. */
export interface CostSwitchEvent {
  fromModel: string
  toModel: string
  reason: string
  category: string
  estimatedSavingsUsd: number
  timestamp: number
}

export interface LLMRequest {
  systemPrompt: string
  userPrompt: string
  maxTokens?: number
  temperature?: number
  jsonMode?: boolean
  /** Bypass the response cache (for debate loop where each round is unique despite similar prompt prefix) */
  bypassCache?: boolean
  /** Source context untuk event llm.response — terisi jika dari agentic_execute step */
  sourceStepId?: string
  /** Source context untuk event llm.response — terisi jika dari pipeline stage */
  sourceTaskId?: string
  /** Source context untuk event llm.response — terisi jika dari pipeline multi-stage */
  sourcePipelineRunId?: string
  /** Per-call model override. If set, overrides engine's default model for this request. */
  model?: {
    providerID: string
    modelID: string
  }
  /** Tool name for auto model resolution (tool→category→default). */
  toolName?: string
  /** Reasoning effort for supported models (OpenAI o-series, GPT-5).
   *  'low' — fast, minimal reasoning
   *  'medium' — balanced (default)
   *  'high' — thorough reasoning
   *  Ignored by providers/models that don't support it. */
  reasoningEffort?: 'low' | 'medium' | 'high'
}

export interface LLMResponse {
  content: string
  usage?: {
    promptTokens: number
    completionTokens: number
    reasoningTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
  }
  finishReason?: string
}

/**
 * Map tool → complexity category for auto-model-resolution.
 * Tools call LLM; which model depends on:
 *   1. Per-tool override (agentic_model set tool=X model="Y")
 *   2. Category by complexity tier (agentic_model set category=Z model="Y")
 *   3. Engine default model
 */
export const TOOL_COMPLEXITY: Record<string, string> = {
  // Quick — ringan, gak perlu reasoning berat
  agentic_nav: 'quick',
  agentic_clean: 'quick',
  agentic_pr: 'quick',
  agentic_router: 'quick',
  // Unspecified-low — agak berat tapi gak kritis
  agentic_context: 'unspecified-low',
  agentic_execute: 'unspecified-low',
  agentic_reflect: 'unspecified-low',
  // Unspecified-high — butuh model cukup kuat
  agentic_debate: 'unspecified-high',
  agentic_plan: 'unspecified-high',
  // Debate sub-roles — bisa di-override peran via agentic_model set tool=debate-{executor,critic,cleaner}
  'debate-executor': 'unspecified-high',
  'debate-critic': 'deep',
  'debate-cleaner': 'quick',
  // Deep — paling berat, butuh reasoning maksimal
  agentic_verify: 'deep',
  agentic_finetune: 'deep',
}
