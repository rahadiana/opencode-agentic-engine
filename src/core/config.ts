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

  // Field shape definition for validateObject
  interface FieldDef {
    type: string
    required?: boolean
    min?: number
    max?: number
    values?: string[]
    /** If true, number must be an integer */
    integer?: boolean
    /** "url" checks for http/https prefix */
    format?: "url"
    /** For array type, validates element type */
    itemType?: string
  }

  // Helper: validate a nested object
  function validateObject(path: string, obj: unknown, shape: Record<string, FieldDef>): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    const knownKeys = new Set(Object.keys(shape))

    if (!obj || typeof obj !== "object") {
      for (const [key, def] of Object.entries(shape)) {
        if (def.required) {
          issues.push({ path: `${path}.${key}`, message: `Required field missing`, severity: "error", expected: def.type })
        }
      }
      return result
    }
    const o = obj as Record<string, unknown>

    // Track unknown keys
    for (const key of Object.keys(o)) {
      if (!knownKeys.has(key)) {
        issues.push({ path: `${path}.${key}`, message: `Unknown key "${key}"`, severity: "warning" })
      }
    }

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

      // Only skip adding to result on TYPE mismatch (wrong type entirely).
      // Range, enum, integer, URL, array-content violations still pass through
      // (warned but merged). Since the merge section always uses raw cfg.[section],
      // out-of-range values can't actually be excluded here — the warning is the
      // important signal.
      const isTypeError = actualType !== def.type

      if (def.type === "number") {
        const num = val as number
        if (def.min !== undefined && num < def.min) {
          issues.push({ path: `${path}.${key}`, message: `Value ${num} is below minimum ${def.min}`, severity: "warning", expected: `>= ${def.min}`, actual: String(num) })
        }
        if (def.max !== undefined && num > def.max) {
          issues.push({ path: `${path}.${key}`, message: `Value ${num} exceeds maximum ${def.max}`, severity: "warning", expected: `<= ${def.max}`, actual: String(num) })
        }
        if (def.integer && !Number.isInteger(num)) {
          issues.push({ path: `${path}.${key}`, message: `Expected integer, got ${num}`, severity: "warning", expected: "integer", actual: String(num) })
        }
      }

      if (def.type === "string" && def.values && !def.values.includes(val as string)) {
        issues.push({ path: `${path}.${key}`, message: `Value "${val}" not in allowed values: ${def.values.join(", ")}`, severity: "warning", expected: def.values.join("|"), actual: String(val) })
      }

      // URL format validation
      if (def.type === "string" && def.format === "url" && val !== "") {
        const s = val as string
        if (!s.startsWith("http://") && !s.startsWith("https://")) {
          issues.push({ path: `${path}.${key}`, message: `Invalid URL: "${s}"`, severity: "warning", expected: "http/https URL", actual: s })
        }
      }

      // Array content validation
      if (def.type === "array" && def.itemType && Array.isArray(val)) {
        const items = val as unknown[]
        const invalidItems = items.filter(v => typeof v !== def.itemType)
        if (invalidItems.length > 0) {
          issues.push({ path: `${path}.${key}`, message: `Expected array of ${def.itemType}, found ${invalidItems.length} non-${def.itemType} element(s)`, severity: "warning", expected: `${def.itemType}[]`, actual: `array with ${invalidItems.length} invalid` })
        }
      }

      // Only skip adding to result if it's a TYPE ERROR (wrong basic type).
      // Range, enum, integer, URL, and array-content violations still propagate
      // because the merge section uses raw cfg.[section] directly.
      if (!isTypeError) {
        result[key] = val
      }
    }
    return result
  }

  // Validate embedding (nullable) — accept string (model name) or object
  const embeddingRaw = cfg.embedding
  if (embeddingRaw !== null && embeddingRaw !== undefined) {
    if (typeof embeddingRaw === "string") {
      // Simple model name (e.g. "text-embedding-3-small")
      issues.push({ path: "embedding", message: `Embedding model: "${embeddingRaw}"`, severity: "warning" })
    } else if (typeof embeddingRaw === "object") {
      validateObject("embedding", embeddingRaw, {
        model: { type: "string", required: true },
        endpoint: { type: "string", format: "url" },
        apiKey: { type: "string" },
      })
    } else {
      issues.push({ path: "embedding", message: `Expected string, object, or null, got ${typeof embeddingRaw}`, severity: "warning", expected: "string|object|null", actual: typeof embeddingRaw })
    }
  }

  // Validate memory
  if (cfg.memory) {
    const memShape = {
      enabled: { type: "boolean" },
      mode: { type: "string", values: ["lightweight", "balanced", "full"] },
      maxEntries: { type: "number", min: 1, max: 100000, integer: true },
      compressThreshold: { type: "number", min: 1, integer: true },
      forgetAfterDays: { type: "number", min: 1, max: 3650, integer: true },
      stopWordsLanguages: { type: "array", itemType: "string" },
      search: { type: "object" },
      ragDeepEscalate: { type: "boolean" },
      ragDeepEscalateThreshold: { type: "number", min: 0, max: 1 },
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
      maxDelegationDepth: { type: "number", min: 1, max: 10, integer: true },
      autoSkillExtract: { type: "boolean" },
      defaultRole: { type: "string" },
      requireSemanticCheck: { type: "boolean" },
      autoHallucinationCheck: { type: "boolean" },
      blockOnHallucination: { type: "boolean" },
      hallucinationThreshold: { type: "number", min: 0, max: 1 },
      hardBlockReliability: { type: "number", min: 0, max: 1 },
      softBlockReliability: { type: "number", min: 0, max: 1 },
      minSampleSize: { type: "number", min: 1, integer: true },
      workflowPolicyMode: { type: "string", values: ["advisory", "strict", "enforced"] },
      dumbModelMode: { type: "string" },
      deepVerification: { type: "object" },
      toolGuardrails: { type: "object" },
    })
    // dumbModelMode: boolean | "auto" (custom — shape helper is single-type only)
    const dmm = (cfg.agent as Record<string, unknown>).dumbModelMode
    if (dmm !== undefined && dmm !== null) {
      const ok =
        typeof dmm === "boolean" ||
        dmm === "auto" ||
        dmm === "true" ||
        dmm === "false"
      if (!ok) {
        issues.push({
          path: "agent.dumbModelMode",
          message: `Expected boolean or "auto", got ${typeof dmm}`,
          severity: "warning",
          expected: "boolean|auto",
          actual: String(dmm),
        })
      }
    }
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
      traceRetentionDays: { type: "number", min: 1, max: 365, integer: true },
      skillMaxCount: { type: "number", min: 1, max: 10000, integer: true },
    })
  }

  // Validate fine-tuning (optional)
  if (cfg.fineTuning && typeof cfg.fineTuning === "object") {
    validateObject("fineTuning", cfg.fineTuning, {
      apiKey: { type: "string" },
      baseURL: { type: "string", format: "url" },
      model: { type: "string" },
      trainingEpochs: { type: "number", min: 1, max: 100, integer: true },
      batchSize: { type: "number", min: 1, max: 256, integer: true },
      learningRateMultiplier: { type: "number", min: 0.01, max: 10 },
      suffix: { type: "string" },
    })
  }

  // Validate RAG config (optional)
  if (cfg.rag && typeof cfg.rag === "object") {
    validateObject("rag", cfg.rag, {
      remoteUrl: { type: "string", format: "url" },
      remoteApiKey: { type: "string" },
      remoteBatchIntervalMs: { type: "number", min: 0, max: 60000, integer: true },
      remoteSyncMode: { type: "string", values: ["full", "changes"] },
    })
  }

  // Validate curator config (optional)
  if (cfg.curator && typeof cfg.curator === "object") {
    validateObject("curator", cfg.curator, {
      enabled: { type: "boolean" },
      staleAfterDays: { type: "number", min: 1, max: 365, integer: true },
      archiveAfterDays: { type: "number", min: 1, max: 3650, integer: true },
      maxSkillsInPrompt: { type: "number", min: 1, max: 50, integer: true },
      injectThreshold: { type: "number", min: 0, max: 1 },
      consolidationEnabled: { type: "boolean" },
    })
  }

  // Merge valid parts with defaults
  const merged = { ...defaults }
  if (embeddingRaw && typeof embeddingRaw === "string") {
    merged.embedding = embeddingRaw
  } else if (embeddingRaw && typeof embeddingRaw === "object") {
    const defaultEmb = defaults.embedding
    const baseEmb = (defaultEmb && typeof defaultEmb === "object" ? defaultEmb : {}) as EmbeddingConfig
    merged.embedding = { ...baseEmb, ...embeddingRaw } as EmbeddingConfig
  }
  if (cfg.memory && typeof cfg.memory === "object") {
    merged.memory = { ...defaults.memory, ...cfg.memory as MemoryConfig }
    const searchRaw = (cfg.memory as Record<string, unknown>).search
    if (searchRaw && typeof searchRaw === "object") {
      merged.memory.search = { ...defaults.memory.search, ...searchRaw as MemoryConfig["search"] }
    }
  }
  if (cfg.agent && typeof cfg.agent === "object") {
    const agentIn = { ...(cfg.agent as Record<string, unknown>) }
    // Normalize string "true"/"false" → boolean for dumbModelMode
    if (agentIn.dumbModelMode === "true") agentIn.dumbModelMode = true
    if (agentIn.dumbModelMode === "false") agentIn.dumbModelMode = false
    merged.agent = { ...defaults.agent, ...agentIn } as AgentConfig
  }
  if (cfg.storage && typeof cfg.storage === "object") {
    merged.storage = { ...defaults.storage, ...cfg.storage as StorageConfig }
  }
  if (cfg.rag && typeof cfg.rag === "object") {
    merged.rag = { ...defaults.rag, ...cfg.rag as RAGSyncConfig }
  }
  if (cfg.curator && typeof cfg.curator === "object") {
    merged.curator = { ...defaults.curator, ...cfg.curator as CuratorConfigSchema }
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
  /** "lightweight" (TF-IDF, no deps) | "balanced" | "full" (vector embedding) */
  mode: "lightweight" | "balanced" | "full"
  maxEntries: number
  compressThreshold: number
  forgetAfterDays: number
  /** ISO 639-3 language codes for stop word filtering */
  stopWordsLanguages: string[]
  search: {
    keywordWeight: number
    vectorWeight: number
  }
  /**
   * Auto-escalate Self-Improve RAG from standard → deep (MDP) when
   * adaptive confidence is below this threshold (0–1).
   * Default 0.35. Set to 0 to disable auto deep escalate.
   */
  ragDeepEscalateThreshold?: number
  /**
   * When true (default), allow auto deep/MDP escalate under low confidence.
   * When false, only explicit mode:"deep" uses MDP.
   */
  ragDeepEscalate?: boolean
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
  /** Tool guardrails: loop detection for agent execution steps */
  toolGuardrails?: ToolGuardrailAgentConfig
  /** Runtime workflow enforcement: advisory warns, strict blocks unsafe completion */
  workflowPolicyMode?: "advisory" | "strict"
  /**
   * Dumb-model harness:
   * - true  → always strict (WorkflowPolicy + block hallucination)
   * - false → never force; use workflowPolicyMode / blockOnHallucination as set
   * - "auto"→ detect weak models by name + ModelRegistry stats (default)
   *
   * Boolean still accepted for backward compat.
   */
  dumbModelMode?: boolean | "auto"
}

/** Config for ToolGuardrailController — infinite loop detection */
export interface ToolGuardrailAgentConfig {
  /** Master kill-switch (default: true) */
  enabled: boolean
  /** Warn after N identical step+error retries (default: 2) */
  exactRepeatWarn: number
  /** Block after N identical retries, 0 = never (default: 5) */
  exactRepeatBlock: number
  /** Warn after N consecutive same-step failures (default: 3) */
  sameStepFailWarn: number
  /** Block after N same-step failures, 0 = never (default: 8) */
  sameStepFailBlock: number
  /** Block after N identical idempotent results (default: 3) */
  idempotentNoProgressBlock: number
  /** Hard stop: block means agent loop exits immediately (default: false) */
  hardStop: boolean
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

export interface RAGSyncConfig {
  /** Remote sync endpoint URL (null/undefined = no remote sync) */
  remoteUrl?: string | null
  /** Optional API key for remote sync endpoint */
  remoteApiKey?: string | null
  /** Batch/debounce interval in ms (default: 5000). 0 = sync setiap perubahan */
  remoteBatchIntervalMs?: number
  /** Sync mode: 'full' exports all RAG data, 'changes' exports delta only (default: full) */
  remoteSyncMode?: "full" | "changes"
}

export interface AgenticConfigSchema {
  $schema: string
  /** Embedding — null = lightweight mode */
  embedding: EmbeddingConfig | string | null
  memory: MemoryConfig
  rag?: RAGSyncConfig
  agent: AgentConfig
  storage: StorageConfig
  /** Optional fine-tuning configuration (null = disabled) */
  fineTuning?: FineTuningConfigSchema | null
  /** Optional skill curator configuration */
  curator?: CuratorConfigSchema
}

/** Curator config — skill lifecycle + auto-injection */
export interface CuratorConfigSchema {
  /** Master switch (default: true) */
  enabled: boolean
  /** Days of inactivity before marking a skill "stale" (default: 30) */
  staleAfterDays: number
  /** Days of inactivity before archiving a skill (default: 90) */
  archiveAfterDays: number
  /** Max skills to auto-inject into the system prompt (default: 3) */
  maxSkillsInPrompt: number
  /** Minimum TF-IDF similarity for a skill to be injected (default: 0.15) */
  injectThreshold: number
  /** Enable LLM-powered consolidation pass (default: false) */
  consolidationEnabled: boolean
}

// ──────────────────────────────────────────────
// Defaults
// ──────────────────────────────────────────────

export const DEFAULT_CONFIG: AgenticConfigSchema = {
  $schema: "v1",
  embedding: null,
  rag: {
    remoteUrl: null,
    remoteApiKey: null,
    remoteBatchIntervalMs: 5000,
    remoteSyncMode: "full",
  },
  memory: {
    enabled: true,
    mode: "balanced",
    maxEntries: 1000,
    compressThreshold: 500,
    forgetAfterDays: 30,
    stopWordsLanguages: ["ind", "eng"],
    search: {
      keywordWeight: 0.3,
      vectorWeight: 0.7,
    },
    // Auto-escalate adaptive → MDP deep when avg confidence below threshold
    ragDeepEscalate: true,
    ragDeepEscalateThreshold: 0.35,
  },
  agent: {
    maxDelegationDepth: 3,
    autoSkillExtract: true,
    defaultRole: "developer",
    requireSemanticCheck: true,
    autoHallucinationCheck: true,
    blockOnHallucination: false,
    hallucinationThreshold: 0.3,
    hardBlockReliability: 0.2,
    softBlockReliability: 0.4,
    minSampleSize: 5,
    workflowPolicyMode: "advisory",
    // Auto-detect free/mini/flash/degraded models → strict harness
    dumbModelMode: "auto",
    deepVerification: {
      security: true,
      performance: true,
      architecture: true,
      deps: true,
    },
    toolGuardrails: {
      enabled: true,
      exactRepeatWarn: 2,
      exactRepeatBlock: 5,
      sameStepFailWarn: 3,
      sameStepFailBlock: 8,
      idempotentNoProgressBlock: 3,
      hardStop: false,
    },
  },
  storage: {
    traceRetentionDays: 7,
    skillMaxCount: 200,
  },
  fineTuning: null,
  curator: {
    enabled: true,
    staleAfterDays: 30,
    archiveAfterDays: 90,
    maxSkillsInPrompt: 3,
    injectThreshold: 0.15,
    consolidationEnabled: false,
  },
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
        // Log auto-repair transparency
        const errorIssues = issues.filter(i => i.severity === "error")
        log.warn(`[CONFIG] Auto-repair: ${errorIssues.length} validation error(s) — merging with defaults:`)
        for (const issue of errorIssues) {
          log.warn(`[CONFIG]   🔧 ${issue.path}: ${issue.message}`)
        }
        // Save fixed version back
        try { this.save(merged) } catch (e) { log.warn("Silent catch: non-fatal", { error: String(e) }) }
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

  /** Update specific keys and persist — validates before saving, warns on issues */
  update(partial: Partial<AgenticConfigSchema>): AgenticConfigSchema {
    this.config = this.mergeDeep(this.config, partial)
    const { issues } = validateConfig(this.config)
    if (issues.length > 0) {
      log.warn(`Config update produced ${issues.length} issue(s):\n${issues.map(i => `  - ${i.path}: ${i.message}`).join("\n")}`)
    }
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
            const before = JSON.stringify(this.config)
            this.load()
            const after = JSON.stringify(this.config)
            if (before !== after) {
              log.info(`[CONFIG] Auto-repair: config changed after reload — validation modified some fields`)
              log.info(`[CONFIG] Changes from ${this.configPath} applied. Check warnings above for details.`)
            }
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
      } catch (e) { log.warn("Silent catch: config file may not exist yet", { error: String(e) }) }
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
    if (this.config.embedding == null) return false
    if (typeof this.config.embedding === "string") return true
    const emb = this.config.embedding
    return typeof emb === "object" && emb !== null && !!(emb as EmbeddingConfig).model
  }

  /** Get effective memory mode — auto-switch to "full" if embedding configured */
  effectiveMemoryMode(): "lightweight" | "balanced" | "full" {
    if (this.hasEmbedding()) return "full"
    return this.config.memory.mode as "lightweight" | "balanced" | "full"
  }

  /** Deep merge helper (handles objects and arrays) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mergeDeep<T extends Record<string, any>>(target: T, source: Partial<T>): T {
    const result = { ...target }
    for (const key of Object.keys(source) as Array<keyof T>) {
      const val = source[key]
      if (val === undefined) continue
      if (Array.isArray(val)) {
        result[key] = [...val] as T[keyof T]
      } else if (val !== null && typeof val === "object") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        result[key] = this.mergeDeep(result[key] as Record<string, any>, val as Record<string, any>) as T[keyof T]
      } else {
        result[key] = val as T[keyof T]
      }
    }
    return result
  }
}
