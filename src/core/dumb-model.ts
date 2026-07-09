/**
 * Dumb-model harness resolver — "LLM boleh bodoh, harness harus pintar".
 *
 * Resolves whether strict harness (WorkflowPolicy strict, block on hallucination,
 * lower confidence gates) should be active for the current model.
 *
 * Modes:
 * - true      → always strict
 * - false     → never (honor workflowPolicyMode / blockOnHallucination as configured)
 * - "auto"    → detect weak models by name heuristics + live ModelRegistry stats
 *
 * Default in config: "auto" so free/small/degraded models get protection without manual toggle.
 */
import type { ModelRegistry } from "./model-registry.js"

export type DumbModelModeSetting = boolean | "auto"

export interface DumbHarnessResult {
  /** Strict harness should be active */
  active: boolean
  /** Human-readable reason (for logs / status / prompt) */
  reason: string
  /** How the decision was made */
  source: "forced-on" | "forced-off" | "auto-name" | "auto-stats" | "auto-off"
}

export interface ResolveDumbHarnessOptions {
  /** Config value: true | false | "auto" (default treated as "auto" by callers) */
  dumbModelMode?: DumbModelModeSetting
  /** Current model id, e.g. "opencode/gpt-4o-mini" or "deepseek/deepseek-chat" */
  model?: string | null
  /** Live reliability stats */
  modelRegistry?: ModelRegistry | null
  /** Thresholds for stats-based auto (from agent config) */
  softBlockReliability?: number
  minSampleSize?: number
}

/**
 * Strong / capable model signals — if matched, auto mode stays OFF
 * even when name also contains a "weak-looking" token (e.g. rare collisions).
 */
const STRONG_NAME_PATTERNS: RegExp[] = [
  /\b(opus|sonnet|o1|o3|o4|gpt-4(?!o-mini)|gpt-4\.1|gpt-5|claude-4|claude-3\.5|claude-3-7)\b/i,
  /\b(deepseek-r1|deepseek-v3|deepseek-v4|strongreason|qwen2\.5-72|qwen2\.5-32|70b|72b|405b|r1)\b/i,
  /\b(gemini-2\.5-pro|gemini-1\.5-pro|claude-3-opus)\b/i,
]

/**
 * Weak / small / free model signals — auto mode ON when matched
 * (and not overridden by strong patterns).
 */
const WEAK_NAME_PATTERNS: RegExp[] = [
  /\b(free|mini|nano|tiny|lite|flash|small|haiku|3\.5|gpt-3)\b/i,
  /\b(0\.5b|1b|1\.5b|1\.7b|1\.8b|2b|3b|4b|7b|8b)\b/i,
  /:\s*(0\.5b|1b|1\.5b|3b|7b)\b/i, // ollama-style tags
  /\b(flashcombo|fast)\b/i,
  /\bqwen2\.5:0\./i,
  /\bmimo-v2\.5-free\b/i,
  /\bgpt-4o-mini\b/i,
  /\bgemini-.*flash\b/i,
]

/** Normalize model string for matching */
export function normalizeModelId(model?: string | null): string {
  if (!model || typeof model !== "string") return ""
  return model.trim().toLowerCase()
}

/**
 * Name-only heuristic: is this model id "weak" by convention?
 * Pure function — no I/O. Safe for unit tests.
 */
export function isWeakModelName(model?: string | null): boolean {
  const id = normalizeModelId(model)
  if (!id || id === "unknown" || id === "opencode/default" || id === "opencode/unknown") {
    return false
  }
  // Strong override first
  for (const re of STRONG_NAME_PATTERNS) {
    if (re.test(id)) return false
  }
  for (const re of WEAK_NAME_PATTERNS) {
    if (re.test(id)) return true
  }
  return false
}

/**
 * Stats-based: model already proven unreliable in this project/session history.
 */
export function isWeakByStats(
  model: string | null | undefined,
  modelRegistry: ModelRegistry | null | undefined,
  softBlockReliability = 0.4,
  minSampleSize = 5,
): { weak: boolean; reason: string } {
  if (!model || !modelRegistry) return { weak: false, reason: "" }
  const score = modelRegistry.getScore(model)
  if (!score || score.totalCalls < minSampleSize) {
    return { weak: false, reason: "" }
  }
  if (score.status === "unstable") {
    return {
      weak: true,
      reason: `model stats unstable (reliability ${(score.reliability * 100).toFixed(0)}%, hallucinations ${(score.hallucinationRate * 100).toFixed(0)}%, n=${score.totalCalls})`,
    }
  }
  if (score.status === "degraded") {
    return {
      weak: true,
      reason: `model stats degraded (reliability ${(score.reliability * 100).toFixed(0)}%, n=${score.totalCalls})`,
    }
  }
  if (score.reliability < softBlockReliability) {
    return {
      weak: true,
      reason: `model reliability ${(score.reliability * 100).toFixed(0)}% < soft threshold ${(softBlockReliability * 100).toFixed(0)}% (n=${score.totalCalls})`,
    }
  }
  if (score.hallucinationRate > 0.3) {
    return {
      weak: true,
      reason: `model hallucination rate ${(score.hallucinationRate * 100).toFixed(0)}% > 30% (n=${score.totalCalls})`,
    }
  }
  return { weak: false, reason: "" }
}

/**
 * Resolve whether dumb-model harness should be active.
 */
export function resolveDumbHarness(opts: ResolveDumbHarnessOptions = {}): DumbHarnessResult {
  const mode = opts.dumbModelMode

  if (mode === true) {
    return { active: true, reason: "dumbModelMode=true (forced)", source: "forced-on" }
  }
  if (mode === false) {
    return { active: false, reason: "dumbModelMode=false (forced off)", source: "forced-off" }
  }

  // "auto" or undefined → auto detect
  const model = opts.model ?? null

  if (isWeakModelName(model)) {
    return {
      active: true,
      reason: `auto: weak model name "${model}"`,
      source: "auto-name",
    }
  }

  const stats = isWeakByStats(
    model,
    opts.modelRegistry,
    opts.softBlockReliability ?? 0.4,
    opts.minSampleSize ?? 5,
  )
  if (stats.weak) {
    return {
      active: true,
      reason: `auto: ${stats.reason}`,
      source: "auto-stats",
    }
  }

  return {
    active: false,
    reason: model
      ? `auto: model "${model}" treated as capable`
      : "auto: no model id yet — harness not forced",
    source: "auto-off",
  }
}

/**
 * Map harness decision → workflow policy mode for gates.
 */
export function workflowModeForDumb(
  dumb: DumbHarnessResult,
  configuredMode?: "advisory" | "strict",
): "advisory" | "strict" {
  if (dumb.active) return "strict"
  return configuredMode ?? "advisory"
}

/**
 * Short prompt injection when dumb harness is active.
 */
export function formatDumbHarnessNotice(dumb: DumbHarnessResult): string {
  if (!dumb.active) return ""
  return [
    ``,
    `---`,
    `🛡️ **Dumb-Model Harness ACTIVE** (${dumb.source})`,
    `${dumb.reason}`,
    ``,
    `Rules enforced by runtime (not optional):`,
    `1. Research → Plan → Implement → Verify — do not skip`,
    `2. Prefer tools over memory: agentic_nav, agentic_rag, agentic_fetch, agentic_plan, agentic_execute, agentic_verify`,
    `3. Small steps; verify after each change; call agentic_reflect on failure`,
    `4. Do not claim files/functions exist without checking`,
    `---`,
  ].join("\n")
}
