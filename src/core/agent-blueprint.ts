/**
 * agent-blueprint.ts — Cognitive Blueprint system.
 *
 * Prinsip #3 (Model Agnostic) dari Plan #26:
 *   Cognitive Blueprint ≠ Runtime Engine
 *   Declarative agent spec (JSON/YAML) dipisah dari runtime.
 *
 * ── 3 komponen utama ──
 * 1. AgentBlueprint  — interface spec
 * 2. BlueprintParser — YAML/JSON → AgentBlueprint
 * 3. BlueprintResolver — model tiers → actual model dari models.json + ModelRegistry
 */

import type { ModelRegistry } from "./model-registry.js"
import { ValidationError } from "./errors.js"

// ── Model Spec dari ~/.cache/opencode/models.json ──

export interface ModelSpec {
  family?: string
  reasoning?: boolean
  tool_call?: boolean
  temperature?: boolean
  attachment?: boolean
  open_weights?: boolean
  knowledge?: string
  modalities?: { input?: string[]; output?: string[] }
  limit?: { context?: number; output?: number }
  cost?: { input?: number; output?: number; cache_read?: number; cache_write?: number }
}

export type ModelSpecMap = Map<string, ModelSpec>  // key = "providerID/modelID"

// ── Agent Blueprint ──

export interface AgentBlueprint {
  /** Schema version — buat migrasi nanti */
  spec_version: "v1"

  metadata: {
    name: string
    description?: string
    labels?: Record<string, string>
  }

  agent: {
    /** System prompt / identity */
    identity: string

    /** High-level capabilities (optional, buat tool routing selection) */
    capabilities?: string[]

    /**
     * Model tiers — abstract capability level, BUKAN model ID hardcode.
     * Key: tier name (e.g. "default", "quick", "reasoning")
     * Value: capability alias (e.g. "fast", "capable", "reasoning")
     *
     * Contoh:
     *   { default: "capable", quick: "fast", design: "capable" }
     */
    model_tiers: Record<string, string>

    /** Tools yang tersedia (optional — default: semua agentic tools) */
    tools?: string[]

    /** Safety limits */
    safety?: {
      max_steps?: number
      loop_detection?: boolean
      circuit_breaker?: boolean
      hallucination_threshold?: number
    }
  }
}

// ── Tier classification config (family-based + cost-based) ──

export interface TierClassification {
  fast: string[]      // model names with provider prefix
  capable: string[]
  reasoning: string[]
  code: string[]
}

// ── BlueprintParser ──

export class BlueprintParser {
  /**
   * Parse YAML or JSON string → AgentBlueprint.
   * Karena kita gak punya YAML dep, pake regex-based parser sederhana
   * yang handle nested object + array.
   */
  parse(input: string): AgentBlueprint {
    const trimmed = input.trim()

    // 1. Coba JSON dulu
    if (trimmed.startsWith("{")) {
      return this.validate(JSON.parse(trimmed))
    }

    // 2. Coba YAML-like
    return this.validate(this.yamlToJson(trimmed))
  }

  /**
   * Validasi required fields + cross-field rules.
   * Returns parsed blueprint kalo valid, throw kalo gak.
   */
  validate(data: Record<string, unknown>): AgentBlueprint {
    // spec_version
    if (!data.spec_version) data.spec_version = "v1"
    if (data.spec_version !== "v1") {
      throw new ValidationError(`Unsupported spec_version: ${data.spec_version}. Only "v1" is supported.`)
    }

    // metadata
    const meta = data.metadata as Record<string, unknown> | undefined
    if (!meta || typeof meta.name !== "string" || !meta.name) {
      throw new ValidationError("Blueprint requires metadata.name (string)")
    }

    // agent
    const agent = data.agent as Record<string, unknown> | undefined
    if (!agent || typeof agent.identity !== "string" || !agent.identity) {
      throw new ValidationError("Blueprint requires agent.identity (string)")
    }

    // model_tiers
    const tiers = agent.model_tiers as Record<string, string> | undefined
    if (!tiers || Object.keys(tiers).length === 0) {
      throw new ValidationError("Blueprint requires agent.model_tiers with at least one tier (e.g. { default: \"capable\" })")
    }

    return {
      spec_version: "v1",
      metadata: {
        name: meta.name,
        description: typeof meta.description === "string" ? meta.description : undefined,
        labels: typeof meta.labels === "object" && meta.labels ? (meta.labels as Record<string, string>) : undefined,
      },
      agent: {
        identity: agent.identity as string,
        capabilities: Array.isArray(agent.capabilities) ? (agent.capabilities as string[]) : undefined,
        model_tiers: tiers,
        tools: Array.isArray(agent.tools) ? (agent.tools as string[]) : undefined,
        safety: typeof agent.safety === "object" && agent.safety ? {
          max_steps: (agent.safety as Record<string, unknown>).max_steps as number | undefined,
          loop_detection: (agent.safety as Record<string, unknown>).loop_detection as boolean | undefined,
          circuit_breaker: (agent.safety as Record<string, unknown>).circuit_breaker as boolean | undefined,
          hallucination_threshold: (agent.safety as Record<string, unknown>).hallucination_threshold as number | undefined,
        } : undefined,
      },
    }
  }

  /**
   * Convert AgentBlueprint → YAML frontmatter string.
   * Buat export ke .opencode/agent/<name>.md
   */
  toFrontmatter(blueprint: AgentBlueprint): string {
    const lines: string[] = ["---"]
    lines.push(`spec_version: ${blueprint.spec_version}`)
    lines.push("metadata:")
    lines.push(`  name: ${blueprint.metadata.name}`)
    if (blueprint.metadata.description) {
      lines.push(`  description: "${blueprint.metadata.description}"`)
    }
    lines.push("agent:")
    lines.push(`  identity: "${blueprint.agent.identity.replace(/"/g, '\\"')}"`)

    if (blueprint.agent.capabilities && blueprint.agent.capabilities.length > 0) {
      lines.push("  capabilities:")
      for (const cap of blueprint.agent.capabilities) {
        lines.push(`    - ${cap}`)
      }
    }

    lines.push("  model_tiers:")
    for (const [key, val] of Object.entries(blueprint.agent.model_tiers)) {
      lines.push(`    ${key}: ${val}`)
    }

    if (blueprint.agent.tools && blueprint.agent.tools.length > 0) {
      lines.push("  tools:")
      for (const t of blueprint.agent.tools) {
        lines.push(`    - ${t}`)
      }
    }

    if (blueprint.agent.safety) {
      lines.push("  safety:")
      if (blueprint.agent.safety.max_steps !== undefined) lines.push(`    max_steps: ${blueprint.agent.safety.max_steps}`)
      if (blueprint.agent.safety.loop_detection !== undefined) lines.push(`    loop_detection: ${blueprint.agent.safety.loop_detection}`)
    }

    lines.push("---")
    return lines.join("\n")
  }

  /**
   * Minimal YAML → JSON converter.
   * Handle nested object (2 levels), arrays, key: value, string/number/boolean.
   */
  private yamlToJson(yaml: string): Record<string, unknown> {
    const lines = yaml.split("\n")
    const root: Record<string, unknown> = {}
    const stack: Array<{ obj: Record<string, unknown>; indent: number }> = [{ obj: root, indent: -1 }]

    for (const raw of lines) {
      const trimmed = raw.trimEnd()
      if (trimmed.trim() === "" || trimmed.trim().startsWith("#")) continue

      const indent = trimmed.length - trimmed.trimStart().length
      const line = trimmed.trim()

      // Pop stack sampai dapet parent yang sesuai
      while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
        stack.pop()
      }

      const parent = stack[stack.length - 1].obj

      if (line.startsWith("- ")) {
        // Array item
        const value = this.parseValue(line.slice(2))
        // Cari array terdekat di parent
        const lastKey = Object.keys(parent).pop()
        if (lastKey && Array.isArray(parent[lastKey])) {
          ;(parent[lastKey] as unknown[]).push(value)
        }
      } else if (line.includes(":")) {
        const colonIdx = line.indexOf(":")
        const key = line.slice(0, colonIdx).trim()
        const rest = line.slice(colonIdx + 1).trim()

        if (rest === "") {
          // Nested object
          const newObj: Record<string, unknown> = {}
          parent[key] = newObj
          stack.push({ obj: newObj, indent })
        } else {
          parent[key] = this.parseValue(rest)
        }
      }
    }

    return root
  }

  private parseValue(str: string): unknown {
    if (str === "true") return true
    if (str === "false") return false
    if (str === "null") return null
    if (/^\d+$/.test(str)) return parseInt(str, 10)
    if (/^\d+\.\d+$/.test(str)) return parseFloat(str)
    // String dengan quote
    if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
      return str.slice(1, -1)
    }
    return str
  }
}

// ── BlueprintResolver ──

export class BlueprintResolver {
  private modelRegistry: ModelRegistry
  private modelsDb: ModelSpecMap
  private classification: TierClassification | null = null

  constructor(modelRegistry: ModelRegistry, modelsDb: ModelSpecMap = new Map()) {
    this.modelRegistry = modelRegistry
    this.modelsDb = modelsDb
  }

  /** Set/update model DB (dari ~/.cache/opencode/models.json) */
  setModelsDb(db: ModelSpecMap): void {
    this.modelsDb = db
    this.classification = null  // invalidate cache
  }

  /**
   * Classify all available models into tiers based on their specs.
   * Dipanggil otomatis — hasil di-cache.
   */
  classify(availableModels: string[]): TierClassification {
    if (this.classification) return this.classification

    const fast: string[] = []
    const capable: string[] = []
    const reasoning: string[] = []
    const code: string[] = []

    for (const modelKey of availableModels) {
      const spec = this.modelsDb.get(modelKey) ?? this.findModelSpec(modelKey)

      const family = (spec?.family || "").toLowerCase()

      // Fast: keluarga flash/mini/small/haiku/nano/light atau murah
      if (/flash|mini|small|haiku|nano|light|fast/.test(family) ||
          (spec?.cost?.input !== undefined && spec.cost.input < 0.2)) {
        fast.push(modelKey)
      }

      // Capable: keluarga pro/opus/sonnet/reason atau reasoning=true
      if (/pro|opus|sonnet|reason/.test(family) || spec?.reasoning) {
        capable.push(modelKey)
      }

      // Reasoning-specific
      if (spec?.reasoning && spec?.tool_call !== false) {
        reasoning.push(modelKey)
      }

      // Code-specific
      if (/codex|coder|code/.test(family) || /coder|code/.test(modelKey.toLowerCase())) {
        code.push(modelKey)
      }
    }

    // Fallback: kalo capable kosong, pake model termahal
    if (capable.length === 0 && availableModels.length > 0) {
      const sorted = [...availableModels].sort((a, b) => {
        const costA = this.modelsDb.get(a)?.cost?.input ?? 0
        const costB = this.modelsDb.get(b)?.cost?.input ?? 0
        return costB - costA
      })
      capable.push(sorted[0])
    }

    // Fallback: kalo fast kosong, pake model termurah
    if (fast.length === 0 && availableModels.length > 0) {
      const sorted = [...availableModels].sort((a, b) => {
        const costA = this.modelsDb.get(a)?.cost?.input ?? 0
        const costB = this.modelsDb.get(b)?.cost?.input ?? 0
        return costA - costB
      })
      fast.push(sorted[0])
    }

    this.classification = { fast, capable, reasoning, code }
    return this.classification
  }

  /**
   * Resolve a tier name → best actual model.
   * Mempertimbangkan: classification + reliability dari ModelRegistry + user feedback.
   */
  resolveTier(
    tier: string,
    availableModels: string[],
    taskType?: string,
  ): string {
    const classification = this.classify(availableModels)

    // Map tier name → model list
    let candidates: string[] = []
    const t = tier.toLowerCase()

    if (t === "fast") candidates = classification.fast
    else if (t === "capable") candidates = classification.capable
    else if (t === "reasoning") candidates = classification.reasoning
    else if (t === "code") candidates = classification.code
    else {
      // Custom tier — cek apakah ini alias atau model langsung
      const resolved = this.modelRegistry.resolveAlias(tier)
      if (resolved.length > 0) candidates = resolved
      else candidates = [tier]  // treat as direct model name
    }

    // Filter: cuma model yang available
    candidates = candidates.filter(m => availableModels.includes(m))

    if (candidates.length === 0) {
      // Fallback: pake model available pertama
      return availableModels[0] || "default"
    }

    if (candidates.length === 1) return candidates[0]

    // Score & sort: user satisfaction dulu, baru reliability
    const scored = candidates.map(m => {
      const score = taskType
        ? this.modelRegistry.getScoreByTaskType(m, taskType)
        : this.modelRegistry.getScore(m)
      const userSat = taskType
        ? this.modelRegistry.getUserSatisfaction(m, taskType)
        : 0.5
      return {
        model: m,
        reliability: score?.reliability ?? 0.5,
        userSatisfaction: userSat,
        totalScore: userSat * 0.6 + (score?.reliability ?? 0.5) * 0.4,
      }
    })

    scored.sort((a, b) => b.totalScore - a.totalScore)
    return scored[0].model
  }

  /**
   * Resolve ALL model_tiers in a blueprint → actual model map.
   */
  resolveBlueprint(
    blueprint: AgentBlueprint,
    availableModels: string[],
    taskType?: string,
  ): Record<string, string> {
    const result: Record<string, string> = {}
    for (const [tierName, tierAlias] of Object.entries(blueprint.agent.model_tiers)) {
      result[tierName] = this.resolveTier(tierAlias, availableModels, taskType)
    }
    return result
  }

  /**
   * Cari model spec berdasarkan model name (tanpa provider prefix).
   */
  private findModelSpec(modelName: string): ModelSpec | undefined {
    for (const [, spec] of this.modelsDb) {
      if (spec.family?.toLowerCase().includes(modelName.toLowerCase())) {
        return spec
      }
    }
    // Fallback: cari partial match di model ID
    for (const [modelId, spec] of this.modelsDb) {
      if (modelId.toLowerCase().includes(modelName.toLowerCase())) return spec
    }
    return undefined
  }
}
