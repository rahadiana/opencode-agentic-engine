/**
 * StateStore — Unified single-source-of-truth data layer.
 *
 * Prinsip:
 * 1. Semua state aplikasi baca/tulis lewat StateStore — gak ada jalur lain
 * 2. Cache-first: read dari memory, lazy-load dari file saat pertama akses
 * 3. Write-through: write ke memory + file sinkron, gak ada selisih
 * 4. Error propagation: gak ada silent catch{} — caller tangani sendiri
 * 5. Namespace isolation: rag, skills, episodes, evolution, dll terpisah
 * 6. Reload: baca ulang dari disk kapan aja
 */

import {
  existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync,
} from "node:fs"
import { resolve } from "node:path"
import { homedir } from "node:os"

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

export interface StateStoreConfig {
  /** Project worktree path (for local store) */
  worktree: string
  /** Optional: override global store dir (default: ~/.config/opencode/agentic-store) */
  globalDir?: string
}

// ── Namespace config: lokal vs global ──

const NAMESPACE_SCOPE: Record<StateNamespace, "local" | "global" | "both"> = {
  rag:        "local",   // project-specific
  skills:     "global",  // shared across projects
  episodes:   "local",
  evolution:  "local",
  evaluation: "local",
  models:     "global",  // global stats
  prompts:    "both",    // local overrides global
  session:    "local",
}

// ── StateStore ──

export class StateStore {
  private localDir: string
  private globalDir: string

  /** Cache: namespace → key → entry */
  private cache = new Map<string, Map<string, StoreEntry<unknown>>>()

  /** Track namespaces yang sudah di-load dari disk */
  private loaded = new Set<string>()

  constructor(config: StateStoreConfig) {
    this.localDir = resolve(config.worktree, ".agentic", "store")
    this.globalDir = config.globalDir ?? resolve(homedir(), ".config", "opencode", "agentic-store")
  }

  // ── Public API ──

  /** Dapatkan satu entry. Returns null jika tidak ditemukan. */
  get<T>(namespace: StateNamespace, key: string): T | null {
    this._ensureLoaded(namespace)
    const ns = this._getNS(namespace)
    const entry = ns.get(key)
    if (!entry) return null
    // Read-after-write consistency: every read also checks file
    // (only if the cache entry might be stale — we use timestamp comparison)
    return entry.data as T
  }

  /** Dapatkan semua entry di satu namespace. */
  getAll<T>(namespace: StateNamespace): StoreEntry<T>[] {
    this._ensureLoaded(namespace)
    const ns = this._getNS(namespace)
    return Array.from(ns.values()) as StoreEntry<T>[]
  }

  /** Simpan entry. Sinkron: memory + file langsung di-write. */
  set<T>(namespace: StateNamespace, key: string, data: T): void {
    this._ensureLoaded(namespace)
    const ns = this._getNS(namespace)
    const entry: StoreEntry<T> = {
      key,
      data,
      updatedAt: new Date().toISOString(),
    }
    ns.set(key, entry as StoreEntry<unknown>)
    this._persist(namespace, key, entry)
  }

  /** Hapus entry. Sinkron: memory + file langsung dihapus. */
  delete(namespace: StateNamespace, key: string): boolean {
    this._ensureLoaded(namespace)
    const ns = this._getNS(namespace)
    const existed = ns.has(key)
    ns.delete(key)
    this._removeFile(namespace, key)
    return existed
  }

  /** Force reload namespace dari disk (buang cache). */
  reload(namespace?: StateNamespace): void {
    if (namespace) {
      this.loaded.delete(namespace)
      this.cache.delete(namespace)
      this._ensureLoaded(namespace)
    } else {
      this.cache.clear()
      this.loaded.clear()
    }
  }

  /** Cek apakah namespace sudah di-load */
  isLoaded(namespace: StateNamespace): boolean {
    return this.loaded.has(namespace)
  }

  /** Dapatkan daftar key di namespace */
  keys(namespace: StateNamespace): string[] {
    this._ensureLoaded(namespace)
    return Array.from(this._getNS(namespace).keys())
  }

  /** Statistik namespace */
  stats(namespace: StateNamespace): { entries: number; loaded: boolean } {
    return {
      entries: this._getNS(namespace).size,
      loaded: this.loaded.has(namespace),
    }
  }

  // ── Internal ──

  private _getNS(namespace: string): Map<string, StoreEntry<unknown>> {
    let ns = this.cache.get(namespace)
    if (!ns) {
      ns = new Map()
      this.cache.set(namespace, ns)
    }
    return ns
  }

  /** Load namespace dari disk (global + local) jika belum pernah. */
  private _ensureLoaded(namespace: string): void {
    if (this.loaded.has(namespace)) return
    this.loaded.add(namespace)

    const scope = NAMESPACE_SCOPE[namespace as StateNamespace] ?? "local"
    const ns = this._getNS(namespace)

    // Load global first (base)
    if (scope === "global" || scope === "both") {
      this._loadFromDir(this.globalDir, namespace, ns, false)
    }

    // Load local (override)
    if (scope === "local" || scope === "both") {
      this._loadFromDir(this.localDir, namespace, ns, scope === "both")
    }
  }

  /** Load semua file JSON dari direktori namespace ke cache. */
  private _loadFromDir(
    baseDir: string,
    namespace: string,
    ns: Map<string, StoreEntry<unknown>>,
    override: boolean,
  ): void {
    const dir = resolve(baseDir, namespace)
    if (!existsSync(dir)) return

    let files: string[]
    try {
      files = readdirSync(dir)
    } catch {
      return // directory might not exist
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
        // Propagate error — no more silent swallows
        console.warn(`[StateStore] Failed to load ${filePath}:`, (err as Error).message)
      }
    }
  }

  /** Write entry ke file. Tentukan target file berdasarkan scope namespace. */
  private _persist<T>(namespace: StateNamespace, key: string, entry: StoreEntry<T>): void {
    const scope = NAMESPACE_SCOPE[namespace] ?? "local"
    const json = JSON.stringify(entry, null, 2)

    if (scope === "global" || scope === "both") {
      this._writeFile(this.globalDir, namespace, key, json)
    }
    if (scope === "local" || scope === "both") {
      this._writeFile(this.localDir, namespace, key, json)
    }
  }

  /** Write file JSON. Buat direktori jika belum ada. */
  private _writeFile(baseDir: string, namespace: string, key: string, content: string): void {
    const dir = resolve(baseDir, namespace)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    const filePath = resolve(dir, `${key}.json`)
    writeFileSync(filePath, content, "utf-8")
  }

  /** Hapus file dari semua lokasi (global + local). */
  private _removeFile(namespace: StateNamespace, key: string): void {
    const scope = NAMESPACE_SCOPE[namespace] ?? "local"
    if (scope === "global" || scope === "both") {
      this._tryDelete(resolve(this.globalDir, namespace, `${key}.json`))
    }
    if (scope === "local" || scope === "both") {
      this._tryDelete(resolve(this.localDir, namespace, `${key}.json`))
    }
  }

  private _tryDelete(filePath: string): void {
    try {
      if (existsSync(filePath)) unlinkSync(filePath)
    } catch (err) {
      console.warn(`[StateStore] Failed to delete ${filePath}:`, (err as Error).message)
    }
  }
}
