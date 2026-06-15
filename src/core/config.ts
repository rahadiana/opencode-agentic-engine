import { readFileSync, writeFileSync, mkdirSync, existsSync, watch } from "node:fs"
import { join } from "node:path"

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
  search: {
    keywordWeight: number
    vectorWeight: number
  }
}

export interface AgentConfig {
  maxDelegationDepth: number
  autoSkillExtract: boolean
  defaultRole: string
}

export interface StorageConfig {
  traceRetentionDays: number
  skillMaxCount: number
}

export interface AgenticConfigSchema {
  $schema: string
  /** Embedding — null = lightweight mode */
  embedding: EmbeddingConfig | null
  memory: MemoryConfig
  agent: AgentConfig
  storage: StorageConfig
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
    search: {
      keywordWeight: 0.3,
      vectorWeight: 0.7,
    },
  },
  agent: {
    maxDelegationDepth: 3,
    autoSkillExtract: true,
    defaultRole: "developer",
  },
  storage: {
    traceRetentionDays: 7,
    skillMaxCount: 200,
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
  private listeners: Array<(config: AgenticConfigSchema) => void> = []

  constructor(worktree: string) {
    this.worktree = worktree
    this.configPath = join(worktree, ".agentic", "config.json")
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

      // Merge with defaults (so new fields always have values)
      this.config = this.mergeDeep({ ...DEFAULT_CONFIG }, parsed)
      return this.config
    } catch {
      // Parse error — fallback ke default
      this.config = { ...DEFAULT_CONFIG }
      return this.config
    }
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

  /** Watch config file for changes */
  startWatch(): void {
    if (this.watcher) return
    try {
      this.watcher = watch(this.configPath, (eventType) => {
        if (eventType === "change") {
          this.load()
          for (const listener of this.listeners) {
            listener(this.config)
          }
        }
      })
    } catch {
      // File not exist yet or permission denied — skip watching
    }
  }

  /** Stop watching */
  stopWatch(): void {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
  }

  /** Listen for config changes */
  onChange(listener: (config: AgenticConfigSchema) => void): void {
    this.listeners.push(listener)
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

  /** Deep merge helper (simple version, no array merge) */
  private mergeDeep<T extends Record<string, any>>(target: T, source: Partial<T>): T {
    const result = { ...target }
    for (const key of Object.keys(source) as Array<keyof T>) {
      const val = source[key]
      if (val !== undefined && val !== null && typeof val === "object" && !Array.isArray(val)) {
        result[key] = this.mergeDeep(result[key] as Record<string, any>, val as Record<string, any>) as T[keyof T]
      } else if (val !== undefined) {
        result[key] = val as T[keyof T]
      }
    }
    return result
  }
}
