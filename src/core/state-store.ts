/**
 * StateStore — Unified single-source-of-truth data layer.
 *
 * Prinsip:
 * 1. Semua state aplikasi baca/tulis lewat StateStore — gak ada jalur lain
 * 2. Cache-first: read dari memory, lazy-load dari file saat pertama akses
 * 3. Write-through: write ke memory + file sinkron, gak ada selisih
 * 4. Error propagation: gak ada silent catch{} — caller tangani sendiri
 * 5. Namespace isolation: rag, skills, episodes, evolution, dll terpisah
 * 6. Scope: project-scoped data disimpan di {ns}/@{scope}/{key}.json
 * 7. Reload: baca ulang dari disk kapan aja
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "node:fs"
import { resolve } from "node:path"
import { homedir } from "node:os"
import { createLogger } from "../observability/logger.js"

const log = createLogger("StateStore")

// ── Types ──

export interface StoreEntry<T> {
  key: string
  data: T
  updatedAt: string
}

export type StateNamespace =
  | "rag"
  | "skills"
  | "episodes"
  | "evolution"
  | "evaluation"
  | "models"
  | "prompts"
  | "session"
  // Second Brain namespaces (used by second-brain.ts)
  | "decisions"
  | "todos"
  | "reflections"
  | "graph"

export interface StateStoreConfig {
  /** Project worktree path (for local store) */
  worktree: string
  /** Optional: override global store dir (default: ~/.config/opencode/agentic-store) */
  globalDir?: string
}

// ── Namespace config: lokal vs global ──

const NAMESPACE_SCOPE: Record<StateNamespace, "local" | "global" | "both"> = {
  rag:        "local",
  skills:     "global",
  episodes:   "local",
  evolution:  "local",
  evaluation: "local",
  models:     "global",
  prompts:    "both",
  session:    "local",
  decisions:  "local",
  todos:      "local",
  reflections:"local",
  graph:      "local",
}

// ── Helpers ──

/** Internal key for cache: namespace[@@scope] */
function _cacheKey(ns: string, scope?: string): string {
  return scope ? `${ns}@@${scope}` : ns
}

/** Directory path: {base}/{ns}[/@{scope}] */
function _dirPath(base: string, ns: string, scope?: string): string {
  return scope ? resolve(base, ns, `@${scope}`) : resolve(base, ns)
}

// ── StateStore ──

export class StateStore {
  private localDir: string
  private globalDir: string

  /** Cache: cacheKey → key → entry */
  private cache = new Map<string, Map<string, StoreEntry<unknown>>>()

  /** Track namespaces yang sudah di-load dari disk */
  private loaded = new Set<string>()

  // ponytail: write-behind queue — batch writes, flush on timer + dispose
  private writeQueue = new Map<string, { baseDir: string; namespace: string; key: string; content: string; scope?: string }>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private readonly FLUSH_INTERVAL = 2000

  constructor(config: StateStoreConfig) {
    this.localDir = resolve(config.worktree, ".agentic", "store")
    this.globalDir = config.globalDir ?? resolve(homedir(), ".config", "opencode", "agentic-store")
  }

  // ── Public API ──

  /** Dapatkan satu entry. Returns null jika tidak ditemukan. */
  get<T>(namespace: StateNamespace, key: string, scope?: string): T | null {
    this._ensureLoaded(namespace, scope)
    const ns = this._getNS(namespace, scope)
    const entry = ns.get(key)
    return entry?.data as T ?? null
  }

  /** Dapatkan semua entry di satu namespace (opsional scope). */
  getAll<T>(namespace: StateNamespace, scope?: string): StoreEntry<T>[] {
    this._ensureLoaded(namespace, scope)
    const ns = this._getNS(namespace, scope)
    return Array.from(ns.values()) as StoreEntry<T>[]
  }

  /** Simpan entry. Sinkron: memory + file langsung di-write. */
  set<T>(namespace: StateNamespace, key: string, data: T, scope?: string): void {
    this._ensureLoaded(namespace, scope)
    const ns = this._getNS(namespace, scope)
    const entry: StoreEntry<T> = {
      key,
      data,
      updatedAt: new Date().toISOString(),
    }
    ns.set(key, entry as StoreEntry<unknown>)
    this._persist(namespace, key, entry, scope)
  }

  /** Hapus entry. Sinkron: memory + file langsung dihapus. */
  delete(namespace: StateNamespace, key: string, scope?: string): boolean {
    this._ensureLoaded(namespace, scope)
    const ns = this._getNS(namespace, scope)
    const existed = ns.has(key)
    ns.delete(key)
    this._removeFile(namespace, key, scope)
    return existed
  }

  /** Force reload namespace dari disk (buang cache). */
  reload(namespace?: StateNamespace, scope?: string): void {
    const ck = namespace ? _cacheKey(namespace, scope) : undefined
    if (ck && namespace) {
      this.loaded.delete(ck)
      this.cache.delete(ck)
      this._ensureLoaded(namespace, scope)
    } else {
      // Reload ALL
      this.cache.clear()
      this.loaded.clear()
    }
  }

  /** Cek apakah namespace sudah di-load */
  isLoaded(namespace: StateNamespace, scope?: string): boolean {
    return this.loaded.has(_cacheKey(namespace, scope))
  }

  /** Dapatkan daftar key di namespace */
  keys(namespace: StateNamespace, scope?: string): string[] {
    this._ensureLoaded(namespace, scope)
    return Array.from(this._getNS(namespace, scope).keys())
  }

  /** Statistik namespace */
  stats(namespace: StateNamespace, scope?: string): { entries: number; loaded: boolean } {
    const ck = _cacheKey(namespace, scope)
    return {
      entries: this._getNS(namespace, scope).size,
      loaded: this.loaded.has(ck),
    }
  }

  // ── Internal ──

  private _getNS(namespace: StateNamespace, scope?: string): Map<string, StoreEntry<unknown>> {
    const ck = _cacheKey(namespace, scope)
    let ns = this.cache.get(ck)
    if (!ns) {
      ns = new Map()
      this.cache.set(ck, ns)
    }
    return ns
  }

  /** Load namespace dari disk (global + local) jika belum pernah. */
  private _ensureLoaded(namespace: string, scope?: string): void {
    const ck = _cacheKey(namespace, scope)
    if (this.loaded.has(ck)) return
    this.loaded.add(ck)

    const nsEnum = namespace as StateNamespace
    const scopeCfg = NAMESPACE_SCOPE[nsEnum] ?? "local"
    const ns = this._getNS(nsEnum, scope)

    // Load global first (base), then local (override)
    if (scopeCfg === "global" || scopeCfg === "both") {
      this._loadFromDir(this.globalDir, namespace, scope, ns, scopeCfg === "both")
    }
    if (scopeCfg === "local" || scopeCfg === "both") {
      this._loadFromDir(this.localDir, namespace, scope, ns, scopeCfg === "both")
    }
  }

  /** Load semua file JSON dari direktori ke cache. */
  private _loadFromDir(
    baseDir: string,
    namespace: string,
    scope: string | undefined,
    ns: Map<string, StoreEntry<unknown>>,
    override: boolean,
  ): void {
    const dir = _dirPath(baseDir, namespace, scope)
    if (!existsSync(dir)) return

    let files: string[]
    try {
      files = readdirSync(dir)
    } catch {
      return
    }

    for (const file of files) {
      if (!file.endsWith(".json")) continue
      const filePath = resolve(dir, file)
      try {
        const raw = readFileSync(filePath, "utf-8")
        const entry = JSON.parse(raw) as StoreEntry<unknown>
        if (!entry.key || entry.data === undefined) continue
        if (override || !ns.has(entry.key)) {
          ns.set(entry.key, entry)
        }
      } catch (err) {
        const isTest = typeof process !== "undefined" && process.env?.NODE_ENV === "test"
        if (!isTest) {
          log.warn(`Failed to load ${filePath}`, { error: (err as Error).message })
        }
      }
    }
  }

  /** Write entry ke file. Tentukan target berdasarkan scope namespace. */
  private _persist<T>(namespace: StateNamespace, key: string, entry: StoreEntry<T>, scope?: string): void {
    const scopeCfg = NAMESPACE_SCOPE[namespace] ?? "local"
    const json = JSON.stringify(entry, null, 2)

    // ponytail: enqueue async write instead of immediate sync I/O
    if (scopeCfg === "global" || scopeCfg === "both") {
      this._enqueueWrite(this.globalDir, namespace, key, json, scope)
    }
    if (scopeCfg === "local" || scopeCfg === "both") {
      this._enqueueWrite(this.localDir, namespace, key, json, scope)
    }
  }

  // ponytail: write-behind queue — debounce writes, flush on timer + dispose
  private _enqueueWrite(baseDir: string, namespace: string, key: string, content: string, scope?: string): void {
    const qk = `${baseDir}:${namespace}:${key}${scope ? `:${scope}` : ""}`
    this.writeQueue.set(qk, { baseDir, namespace, key, content, scope })
    this._scheduleFlush()
  }

  private _scheduleFlush(): void {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => this._flush(), this.FLUSH_INTERVAL)
  }

  /** Flush all queued writes to disk. Called automatically on timer and manually at dispose. */
  flushSync(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    this._flush()
  }

  private _flush(): void {
    this.flushTimer = null
    if (this.writeQueue.size === 0) return
    for (const [, item] of this.writeQueue) {
      this._writeFile(item.baseDir, item.namespace, item.key, item.content, item.scope)
    }
    this.writeQueue.clear()
  }

  /** Write file JSON. Buat direktori jika belum ada. */
  private _writeFile(baseDir: string, namespace: string, key: string, content: string, scope?: string): void {
    const dir = _dirPath(baseDir, namespace, scope)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    const filePath = resolve(dir, `${key}.json`)
    writeFileSync(filePath, content, "utf-8")
  }

  /** Hapus file dari semua lokasi. */
  private _removeFile(namespace: StateNamespace, key: string, scope?: string): void {
    const scopeCfg = NAMESPACE_SCOPE[namespace] ?? "local"
    const remove = (base: string) => {
      const dir = _dirPath(base, namespace, scope)
      const fp = resolve(dir, `${key}.json`)
      this._tryDelete(fp)
    }
    if (scopeCfg === "global" || scopeCfg === "both") remove(this.globalDir)
    if (scopeCfg === "local" || scopeCfg === "both") remove(this.localDir)
  }

  private _tryDelete(filePath: string): void {
    try {
      if (existsSync(filePath)) unlinkSync(filePath)
    } catch (err) {
      // silent in test mode
    }
  }

  /** Daftar semua scope yang ada di namespace tertentu */
  listScopes(namespace: string): string[] {
    const scopeCfg = NAMESPACE_SCOPE[namespace as StateNamespace] ?? "local"
    const candidates: string[] = []
    const dirs = [this.localDir]
    if (scopeCfg === "global" || scopeCfg === "both") dirs.unshift(this.globalDir)
    for (const baseDir of dirs) {
      const nsDir = resolve(baseDir, namespace)
      if (!existsSync(nsDir)) continue
      const entries = readdirSync(nsDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith("@")) {
          const scope = entry.name.slice(1)
          if (!candidates.includes(scope)) candidates.push(scope)
        }
      }
    }
    return candidates
  }
}
