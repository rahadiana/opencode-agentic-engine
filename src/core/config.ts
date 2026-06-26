import { readFileSync, writeFileSync, mkdirSync, existsSync, watch, statSync } from "node:fs"
import { join } from "node:path"
import { createLogger } from "../observability/logger.js"

const log = createLogger("Config")

// ──────────────────────────────────────────────
// JSON Schema Validation
// ──────────────────────────────────────────────

export interface ValidationIssue {
  path: string
  message: string
  severity: "warning" | "error"
  expected?: string
  actual?: string
}

/**
 * JSON Schema-like validator untuk AgenticConfigSchema.
 * Memvalidasi tipe, range, dan field yang required.
 */
export function validateConfig(raw: unknown): { valid: boolean; config: AgenticConfigSchema; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = []
  const defaults = { ...DEFAULT_CONFIG }

  if (!raw || typeof raw !== "object") {
    return { valid: false, config: { ...defaults }, issues: [{ path: "$", message: "Config is not an object", severity: "error" }] }
  }

  const cfg = raw as Record<string, unknown>

  // Helper: validate a nested object
  function validateObject(path: string, obj: unknown, shape: Record<string, { type: string; required?: boolean; min?: number; max?: number; values?: string[] }>): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    if (!obj || typeof obj !== "object") {
      for (const [key, def] of Object.entries(shape)) {
        if (def.required) {
          issues.push({ path: `${path}.${key}`, message: `Required field missing`, severity: "error", expected: def.type })
        }
      }
      return result
    }
    const o = obj as Record<string, unknown>
    for (const [key, def] of Object.entries(shape)) {
      const val = o[key]
      if (val === undefined || val === null) {
        if (def.required) {
          issues.push({ path: `${path}.${key}`, message: `Required field missing`, severity: "error", expected: def.type })
        }
        continue
      }
      const actualType = Array.isArray(val) ? "array" : typeof val
      if (actualType !== def.type) {
        issues.push({ path: `${path}.${key}`, message: `Expected type ${def.type}, got ${actualType}`, severity: "warning", expected: def.type, actual: actualType })
        continue
      }
      if (def.type === "number") {
        const num = val as number
        if (def.min !== undefined && num < def.min) {
          issues.push({ path: `${path}.${key}`, message: `Value ${num} is below minimum ${def.min}`, severity: "warning", expected: `>= ${def.min}`, actual: String(num) })
        }
        if (def.max !== undefined && num > def.max) {
          issues.push({ path: `${path}.${key}`, message: `Value ${num} exceeds maximum ${def.max}`, severity: "warning", expected: `<= ${def.max}`, actual: String(num) })
        }
      }
      if (def.type === "string" && def.values && !def.values.includes(val as string)) {
        issues.push({ path: `${path}.${key}`, message: `Value "${val}" not in allowed values: ${def.values.join(", ")}`, severity: "warning", expected: def.values.join("|"), actual: String(val) })
      }
      result[key] = val
    }
    return result
  }

  // Validate embedding (nullable)
  const embeddingRaw = cfg.embedding
  if (embeddingRaw !== null && embeddingRaw !== undefined) {
    if (typeof embeddingRaw !== "object") {
      issues.push({ path: "embedding", message: "Expected object or null", severity: "error", expected: "object|null", actual: typeof embeddingRaw })
    } else {
      validateObject("embedding", embeddingRaw, {
        model: { type: "string", required: true },
        endpoint: { type: "string" },
        apiKey: { type: "string" },
      })
    }
  }

  // Validate memory
  if (cfg.memory) {
    const memShape = {
      enabled: { type: "boolean" },
      mode: { type: "string", values: ["lightweight", "full"] },
      maxEntries: { type: "number", min: 1, max: 100000 },
      compressThreshold: { type: "number", min: 1 },
      forgetAfterDays: { type: "number", min: 1, max: 3650 },
      stopWordsLanguages: { type: "array" },
    }
    validateObject("memory", cfg.memory, memShape)
    // Validate nested search
    const searchRaw = (cfg.memory as Record<string, unknown>).search
    if (searchRaw) {
      validateObject("memory.search", searchRaw, {
        keywordWeight: { type: "number", min: 0, max: 1 },
        vectorWeight: { type: "number", min: 0, max: 1 },
      })
      const sw = searchRaw as Record<string, unknown>
      if (typeof sw.keywordWeight === "number" && typeof sw.vectorWeight === "number") {
        const total = sw.keywordWeight + sw.vectorWeight
        if (Math.abs(total - 1) > 0.01) {
          issues.push({ path: "memory.search", message: `keywordWeight + vectorWeight = ${total}, expected ~1.0`, severity: "warning", expected: "1.0", actual: String(total) })
        }
      }
    }
  }

  // Validate agent
  if (cfg.agent) {
    validateObject("agent", cfg.agent, {
      maxDelegationDepth: { type: "number", min: 1, max: 10 },
      autoSkillExtract: { type: "boolean" },
      defaultRole: { type: "string" },
      requireSemanticCheck: { type: "boolean" },
      autoHallucinationCheck: { type: "boolean" },
      blockOnHallucination: { type: "boolean" },
      hallucinationThreshold: { type: "number", min: 0, max: 1 },
      hardBlockReliability: { type: "number", min: 0, max: 1 },
      softBlockReliability: { type: "number", min: 0, max: 1 },
      minSampleSize: { type: "number", min: 1 },
    })
    // Validate nested deepVerification
    const dv = (cfg.agent as Record<string, unknown>).deepVerification
    if (dv && typeof dv === "object") {
      validateObject("agent.deepVerification", dv, {
        security: { type: "boolean" },
        performance: { type: "boolean" },
        architecture: { type: "boolean" },
        deps: { type: "boolean" },
      })
    }
  }

  // Validate storage
  if (cfg.storage) {
    validateObject("storage", cfg.storage, {
      traceRetentionDays: { type: "number", min: 1, max: 365 },
      skillMaxCount: { type: "number", min: 1, max: 10000 },
    })
  }

  // Validate fine-tuning (optional)
  if (cfg.fineTuning && typeof cfg.fineTuning === "object") {
    validateObject("fineTuning", cfg.fineTuning, {
      apiKey: { type: "string" },
      baseURL: { type: "string" },
      model: { type: "string" },
      trainingEpochs: { type: "number", min: 1, max: 100 },
      batchSize: { type: "number", min: 1, max: 256 },
      learningRateMultiplier: { type: "number", min: 0.01, max: 10 },
      suffix: { type: "string" },
    })
  }

  // Merge valid parts with defaults
  const merged = { ...defaults }
  if (embeddingRaw && typeof embeddingRaw === "object") {
    merged.embedding = { ...(defaults.embedding ?? {}), ...embeddingRaw } as EmbeddingConfig
  }
  if (cfg.memory && typeof cfg.memory === "object") {
    merged.memory = { ...defaults.memory, ...cfg.memory as MemoryConfig }
    const searchRaw = (cfg.memory as Record<string, unknown>).search
    if (searchRaw && typeof searchRaw === "object") {
      merged.memory.search = { ...defaults.memory.search, ...searchRaw as MemoryConfig["search"] }
    }
  }
  if (cfg.agent && typeof cfg.agent === "object") {
    merged.agent = { ...defaults.agent, ...cfg.agent as AgentConfig }
  }
  if (cfg.storage && typeof cfg.storage === "object") {
    merged.storage = { ...defaults.storage, ...cfg.storage as StorageConfig }
  }

  const hasErrors = issues.some(i => i.severity === "error")

  return { valid: !hasErrors, config: merged, issues }
}

// ──────────────────────────────────────────────
// Schema
// ──────────────────────────────────────────────

export interface EmbeddingConfig {
  /** Model name, e.g. "text-embedding-3-small", "nomic-embed-text" */
  model: string
  /** Embedding endpoint — null berarti pakai base URL dari provider utama */
  endpoint: string | null
  /** API key — null berarti pakai key dari provider utama */
  apiKey: string | null
}

export interface MemoryConfig {
  enabled: boolean
  /** "lightweight" (TF-IDF, no deps) | "full" (vector embedding) */
  mode: "lightweight" | "full"
  maxEntries: number
  compressThreshold: number
  forgetAfterDays: number
  /** ISO 639-3 language codes for stop word filtering */
  stopWordsLanguages: string[]
  search: {
    keywordWeight: number
    vectorWeight: number
  }
}

export interface DeepVerificationAgentConfig {
  /** Enable LLM-based security review on deep verification (default: true) */
  security?: boolean
  /** Enable LLM-based performance anti-pattern detection (default: true) */
  performance?: boolean
  /** Enable LLM-based architecture analysis (default: true) */
  architecture?: boolean
  /** Enable package-manager dependency auditing (default: true) */
  deps?: boolean
}

export interface AgentConfig {
  maxDelegationDepth: number
  autoSkillExtract: boolean
  defaultRole: string
  requireSemanticCheck: boolean
  autoHallucinationCheck: boolean
  blockOnHallucination: boolean
  hallucinationThreshold: number
  hardBlockReliability: number
  softBlockReliability: number
  minSampleSize: number
  /** Gap #4 — per-dimension toggle for deep verification (all enabled by default) */
  deepVerification?: DeepVerificationAgentConfig
}

export interface StorageConfig {
  traceRetentionDays: number
  skillMaxCount: number
}

export interface FineTuningConfigSchema {
  /** OpenAI API key (falls back to OPENAI_API_KEY env) */
  apiKey?: string
  /** Base URL for OpenAI-compatible API */
  baseURL?: string
  /** Base model to fine-tune, e.g. "gpt-4o-mini-2024-07-18" */
  model?: string
  /** Default number of training epochs */
  trainingEpochs?: number
  /** Batch size for training */
  batchSize?: number
  /** Learning rate multiplier */
  learningRateMultiplier?: number
  /** Custom suffix for the fine-tuned model name */
  suffix?: string
}

export interface AgenticConfigSchema {
  $schema: string
  /** Embedding — null = lightweight mode */
  embedding: EmbeddingConfig | null
  memory: MemoryConfig
  agent: AgentConfig
  storage: StorageConfig
  /** Optional fine-tuning configuration */
  fineTuning?: FineTuningConfigSchema
}

// ──────────────────────────────────────────────
// Defaults
// ──────────────────────────────────────────────

export const DEFAULT_CONFIG: AgenticConfigSchema = {
  $schema: "v1",
  embedding: null,
  memory: {
    enabled: true,
    mode: "lightweight",
    maxEntries: 1000,
    compressThreshold: 500,
    forgetAfterDays: 30,
    stopWordsLanguages: ["ind", "eng"],
    search: {
      keywordWeight: 0.3,
      vectorWeight: 0.7,
    },
  },
  agent: {
    maxDelegationDepth: 3,
    autoSkillExtract: true,
    defaultRole: "developer",
    requireSemanticCheck: false,
    autoHallucinationCheck: true,
    blockOnHallucination: false,
    hallucinationThreshold: 0.3,
    hardBlockReliability: 0.2,
    softBlockReliability: 0.4,
    minSampleSize: 5,
    deepVerification: {
      security: true,
      performance: true,
      architecture: true,
      deps: true,
    },
  },
  storage: {
    traceRetentionDays: 7,
    skillMaxCount: 200,
  },
  fineTuning: undefined,
}

// ──────────────────────────────────────────────
// Loader
// ──────────────────────────────────────────────

export class ConfigLoader {
  private config: AgenticConfigSchema
  private readonly configPath: string
  private readonly worktree: string
  private watcher: ReturnType<typeof watch> | null = null
  private watchInterval: ReturnType<typeof setInterval> | null = null
  private lastModified = 0
  private listeners: Array<(config: AgenticConfigSchema) => void> = []

  constructor(worktree: string) {
    this.worktree = worktree || process.cwd()
    this.configPath = join(this.worktree, ".agentic", "config.json")
    this.config = { ...DEFAULT_CONFIG }
  }

  /** Load config from file, auto-create default if missing */
  load(): AgenticConfigSchema {
    try {
      if (!existsSync(this.configPath)) {
        this.save(DEFAULT_CONFIG)
        this.config = { ...DEFAULT_CONFIG }
        return this.config
      }

      const raw = readFileSync(this.configPath, "utf-8")
      const parsed = JSON.parse(raw)

      // Validate against schema — warn on issues but still load
      const { valid, config, issues } = validateConfig(parsed)
      if (issues.length > 0) {
        const warnings = issues.filter(i => i.severity === "warning")
        const errors = issues.filter(i => i.severity === "error")
        if (warnings.length > 0) {
          log.warn(`${warnings.length} config warning(s):\n${warnings.map(i => `  - ${i.path}: ${i.message}`).join("\n")}`)
        }
        if (errors.length > 0) {
          log.warn(`${errors.length} config error(s) — fixing with defaults:\n${errors.map(i => `  - ${i.path}: ${i.message}`).join("\n")}`)
        }
      }

      if (!valid && issues.some(i => i.severity === "error")) {
        // Merge recovered parts with defaults
        const merged = this.mergeDeep({ ...DEFAULT_CONFIG }, config)
        this.config = merged
        // Save fixed version back
        try { this.save(merged) } catch { /* non-fatal */ }
        return this.config
      }

      // Merge with defaults (so new fields always have values)
      this.config = this.mergeDeep({ ...DEFAULT_CONFIG }, config)
      return this.config
    } catch {
      // Parse error — fallback ke default
      log.warn(`Failed to parse config, using defaults`)
      this.config = { ...DEFAULT_CONFIG }
      return this.config
    }
  }

  /** Validate current config and return issues */
  getValidationIssues(): ValidationIssue[] {
    const { issues } = validateConfig(this.config)
    return issues
  }

  /** Save config to file */
  save(config: AgenticConfigSchema): void {
    const dir = join(this.worktree, ".agentic")
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(this.configPath, JSON.stringify(config, null, 2), "utf-8")
    this.config = { ...config }
  }

  /** Get current config */
  get(): AgenticConfigSchema {
    return this.config
  }

  /** Update specific keys and persist */
  update(partial: Partial<AgenticConfigSchema>): AgenticConfigSchema {
    this.config = this.mergeDeep(this.config, partial)
    this.save(this.config)
    return this.config
  }

  /** Watch config file for changes — uses fs.watch with polling fallback for reliability */
  startWatch(): void {
    if (this.watcher) return
    try {
      this.watcher = watch(this.configPath, (eventType) => {
        if (eventType === "change") {
          try {
            this.load()
            for (const listener of this.listeners) {
              listener(this.config)
            }
          } catch (e) {
            this.stopWatch()
            log.error(`Config watcher error, stopped`, { error: e })
          }
        }
      })
      // Polling only as fallback if fs.watch is not available (e.g., some NFS)
      if (this.watcher) return
    } catch {
      // fs.watch failed — use polling fallback instead
    }

    // fs.watch not available, use polling
    this.lastModified = Date.now()
    this.watchInterval = setInterval(() => {
      try {
        const stat = statSync(this.configPath)
        if (stat.mtimeMs > this.lastModified) {
          this.lastModified = stat.mtimeMs
          this.load()
          for (const listener of this.listeners) {
            listener(this.config)
          }
        }
      } catch { /* config file may not exist yet */ }
    }, 5000)
  }

  /** Stop watching and clear all listeners */
  stopWatch(): void {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
    if (this.watchInterval) {
      clearInterval(this.watchInterval)
      this.watchInterval = null
    }
    this.listeners = []
  }

  /** Listen for config changes. Returns an unsubscribe function. */
  onChange(listener: (config: AgenticConfigSchema) => void): () => void {
    this.listeners.push(listener)
    return () => {
      const idx = this.listeners.indexOf(listener)
      if (idx !== -1) this.listeners.splice(idx, 1)
    }
  }

  /** Check if full embedding is configured */
  hasEmbedding(): boolean {
    return this.config.embedding != null && !!this.config.embedding.model
  }

  /** Get effective memory mode — auto-switch to "full" if embedding configured */
  effectiveMemoryMode(): "lightweight" | "full" {
    if (this.hasEmbedding()) return "full"
    return this.config.memory.mode
  }

  /** Deep merge helper (handles objects and arrays) */
  private mergeDeep<T extends Record<string, any>>(target: T, source: Partial<T>): T {
    const result = { ...target }
    for (const key of Object.keys(source) as Array<keyof T>) {
      const val = source[key]
      if (val === undefined) continue
      if (Array.isArray(val)) {
        const existing = result[key]
        result[key] = (Array.isArray(existing) ? [...existing, ...val] : [...val]) as T[keyof T]
      } else if (val !== null && typeof val === "object") {
        result[key] = this.mergeDeep(result[key] as Record<string, any>, val as Record<string, any>) as T[keyof T]
      } else {
        result[key] = val as T[keyof T]
      }
    }
    return result
  }
}
