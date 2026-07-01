/**
 * SQLitePersistence — backend SQLite untuk persistence layer.
 *
 * Support dual driver:
 *  - better-sqlite3 (Node.js via native addon)
 *  - bun:sqlite (Bun built-in)
 *
 * Dipilih otomatis: better-sqlite3 priority #1, bun:sqlite fallback.
 * Jika keduanya unavailable, constructor throw — caller wajib catch.
 *
 * Schema:
 * ```sql
 * CREATE TABLE store (
 *   namespace  TEXT NOT NULL,
 *   scope      TEXT DEFAULT '',
 *   key        TEXT NOT NULL,
 *   data       TEXT NOT NULL,
 *   updated_at TEXT NOT NULL,
 *   created_at TEXT NOT NULL,
 *   PRIMARY KEY (namespace, scope, key)
 * );
 * ```
 */

import type { PersistentState } from "./persistence.js"
import { resolve } from "node:path"
import { homedir } from "node:os"
import { existsSync, mkdirSync, statSync } from "node:fs"
import { AgenticError } from "../core/errors.js"

export interface SQLiteConfig {
  /** Path ke file database (default: ~/.config/opencode/agentic-store/agentic.db) */
  dbPath?: string
  /** WAL mode (default: true, faster concurrent reads) */
  wal?: boolean
  /** Cache size in KB (default: 64000 = 64MB) */
  cacheSize?: number
  /** Auto-migrate schema (default: true) */
  autoMigrate?: boolean
}

const DEFAULT_CONFIG: SQLiteConfig = {
  wal: true,
  cacheSize: 64000,
  autoMigrate: true,
}

/** Statement interface for both sqlite drivers */
interface DbStatement {
  run(...params: unknown[]): { changes: number }
  all(...params: unknown[]): Record<string, unknown>[]
  get(...params: unknown[]): unknown
  source?: string // bun:sqlite specific (for db.run(stmt.source, ...))
}

/** Connection interface for both sqlite drivers */
interface DbConnection {
  prepare(sql: string): DbStatement
  query(sql: string): DbStatement
  exec(sql: string): void
  run(sql: string, ...params: unknown[]): { changes: number }
  pragma(sql: string): unknown // better-sqlite3 specific
  close(): void
}

type DriverType = "better-sqlite3" | "bun:sqlite"

export class SQLitePersistence {
  private _driver: DriverType | null = null
  private db: DbConnection | null = null
  private dbPath: string

  constructor(config?: SQLiteConfig) {
    const cfg = { ...DEFAULT_CONFIG, ...config }
    this.dbPath = cfg.dbPath ?? resolve(homedir(), ".config", "opencode", "agentic-store", "agentic.db")

    // Pastikan direktori ada
    const dir = resolve(this.dbPath, "..")
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    // Init database — sync, throws if no driver available
    this._initDbSync(cfg)
  }

  // ── driver initialization ──

  private _initDbSync(cfg: SQLiteConfig): void {
    // Try better-sqlite3 (Node.js)
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require("better-sqlite3")
      const Database = mod.default || mod
      this.db = new Database(this.dbPath)
      this._driver = "better-sqlite3"

      if (cfg.wal) {
        this.db!.pragma("journal_mode = WAL")
      }
      this.db!.pragma(`cache_size = -${cfg.cacheSize}`)
      this.db!.pragma("wal_autocheckpoint = 1000")

      if (cfg.autoMigrate) this._migrate()
      return
    } catch {
      // better-sqlite3 not available, try bun:sqlite
    }

    // Try bun:sqlite (Bun)
    try {
      // bun:sqlite is a built-in module, no need to install
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Database } = require("bun:sqlite")
      this.db = new Database(this.dbPath)
      this._driver = "bun:sqlite"

      if (cfg.wal) {
        this.db!.run("PRAGMA journal_mode = WAL")
      }
      this.db!.run(`PRAGMA cache_size = -${cfg.cacheSize}`)
      this.db!.run("PRAGMA wal_autocheckpoint = 1000")

      if (cfg.autoMigrate) this._migrate()
      return
    } catch {
      // bun:sqlite not available either
    }

    throw new AgenticError(
      "No SQLite driver available. Install better-sqlite3 (Node) " +
      "or run in Bun (bun:sqlite built-in).",
      "SQLITE_DRIVER_UNAVAILABLE"
    )
  }

  // ── internal helpers ──

  private _exec(sql: string): void {
    if (this._driver === "bun:sqlite") {
      this.db!.exec(sql)
    } else {
      this.db!.exec(sql)
    }
  }

  private _prepare(sql: string): DbStatement {
    if (this._driver === "bun:sqlite") {
      return this.db!.query(sql)
    }
    return this.db!.prepare(sql)
  }

  private _run(stmt: DbStatement, ...params: unknown[]): { changes: number } {
    if (this._driver === "bun:sqlite") {
      return this.db!.run(stmt.source!, ...params) as { changes: number }
    }
    return stmt.run(...params) as { changes: number }
  }

  private _all(stmt: DbStatement, ...params: unknown[]): Record<string, unknown>[] {
    if (params.length > 0) {
      if (this._driver === "bun:sqlite") {
        return stmt.all(...params) as Record<string, unknown>[]
      }
      return stmt.all(...params) as Record<string, unknown>[]
    }
    return stmt.all() as Record<string, unknown>[]
  }

  private _get(stmt: DbStatement, ...params: unknown[]): unknown {
    if (params.length > 0) {
      if (this._driver === "bun:sqlite") {
        return stmt.get(...params)
      }
      return stmt.get(...params)
    }
    return stmt.get()
  }

  // ── public API ──

  /**
   * Auto-create table jika belum ada.
   */
  private _migrate(): void {
    this._exec(`
      CREATE TABLE IF NOT EXISTS store (
        namespace  TEXT NOT NULL,
        scope      TEXT DEFAULT '',
        key        TEXT NOT NULL,
        data       TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (namespace, scope, key)
      );
      CREATE INDEX IF NOT EXISTS idx_store_lookup ON store(namespace, scope);
    `)
  }

  /**
   * Simpan data. Sama kayak PersistenceLayer.save().
   * Scope = '' untuk global (unscoped), projectId untuk scoped.
   */
  save<T>(namespace: string, key: string, data: T, scope?: string): void {
    const now = new Date().toISOString()
    const stmt = this._prepare(`
      INSERT OR REPLACE INTO store (namespace, scope, key, data, updated_at, created_at)
      VALUES (?, ?, ?, ?, ?,
        COALESCE((SELECT created_at FROM store WHERE namespace = ? AND scope = ? AND key = ?), ?)
      )
    `)
    const sc = scope ?? ""
    this._run(
      stmt,
      namespace, sc, key,
      JSON.stringify(data),
      now,
      namespace, sc, key,
      now,
    )
  }

  /**
   * Load data by key.
   */
  load<T>(namespace: string, key: string, scope?: string): T | null {
    const sc = scope ?? ""
    const stmt = this._prepare(
      "SELECT data FROM store WHERE namespace = ? AND scope = ? AND key = ?"
    )
    const row = this._get(stmt, namespace, sc, key) as { data: string } | undefined

    if (!row) return null
    try {
      return JSON.parse(row.data) as T
    } catch {
      return null
    }
  }

  /**
   * Load ALL entries dalam suatu namespace/scope.
   * Scope = undefined → ambil global (scope='')
   */
  loadAll<T>(namespace: string, scope?: string): PersistentState<T>[] {
    if (scope !== undefined) {
      const stmt = this._prepare(
        "SELECT key, data, updated_at FROM store WHERE namespace = ? AND scope = ? ORDER BY key"
      )
      const rows = this._all(stmt, namespace, scope) as Array<{ key: string; data: string; updated_at: string }>
      return rows.map(row => ({
        key: row.key,
        data: this._safeParse(row.data) as T,
        updatedAt: row.updated_at,
      }))
    } else {
      const stmt = this._prepare(
        "SELECT key, data, updated_at FROM store WHERE namespace = ? AND scope = '' ORDER BY key"
      )
      const rows = this._all(stmt, namespace) as Array<{ key: string; data: string; updated_at: string }>
      return rows.map(row => ({
        key: row.key,
        data: this._safeParse(row.data) as T,
        updatedAt: row.updated_at,
      }))
    }
  }

  /**
   * Hapus entry.
   */
  delete(namespace: string, key: string, scope?: string): boolean {
    const sc = scope ?? ""
    const stmt = this._prepare(
      "DELETE FROM store WHERE namespace = ? AND scope = ? AND key = ?"
    )
    const result = this._run(stmt, namespace, sc, key)
    return result.changes > 0
  }

  /**
   * List semua key dalam namespace/scope.
   */
  listKeys(namespace: string, scope?: string): string[] {
    const sc = scope ?? ""
    const stmt = this._prepare(
      "SELECT key FROM store WHERE namespace = ? AND scope = ? ORDER BY key"
    )
    const rows = this._all(stmt, namespace, sc) as Array<{ key: string }>
    return rows.map(r => r.key)
  }

  /**
   * List semua scope prefixes yang ada dalam suatu namespace.
   */
  listScopes(namespace: string): string[] {
    const stmt = this._prepare(
      "SELECT DISTINCT scope FROM store WHERE namespace = ? AND scope != '' ORDER BY scope"
    )
    const rows = this._all(stmt, namespace) as Array<{ scope: string }>
    return rows.map(r => r.scope)
  }

  /**
   * Hapus semua data dalam namespace (hati-hati!).
   */
  clearNamespace(namespace: string, scope?: string): number {
    if (scope !== undefined) {
      const stmt = this._prepare(
        "DELETE FROM store WHERE namespace = ? AND scope = ?"
      )
      const result = this._run(stmt, namespace, scope)
      return result.changes
    }
    const stmt = this._prepare(
      "DELETE FROM store WHERE namespace = ?"
    )
    const result = this._run(stmt, namespace)
    return result.changes
  }

  /**
   * Raw query — untuk structured queries.
   */
  query<T = unknown>(sql: string, params?: unknown[]): T[] {
    const stmt = this._prepare(sql)
    if (params && params.length > 0) {
      return this._all(stmt, ...params) as T[]
    }
    return this._all(stmt) as T[]
  }

  /**
   * Dapatkan statistik database.
   */
  stats(): { namespaces: Array<{ namespace: string; scopes: number; keys: number }>; fileSize: number; dbPath: string } {
    const stmt = this._prepare(
      "SELECT namespace, COUNT(DISTINCT scope) as scopes, COUNT(*) as keys FROM store GROUP BY namespace ORDER BY namespace"
    )
    const rows = this._all(stmt) as Array<{ namespace: string; scopes: number; keys: number }>

    let fileSize = 0
    try {
      fileSize = statSync(this.dbPath).size
    } catch { /* ignore */ }

    return {
      namespaces: rows,
      fileSize,
      dbPath: this.dbPath,
    }
  }

  /**
   * Tutup koneksi database.
   */
  close(): void {
    if (this.db) {
      this.db.close()
    }
  }

  get driver(): DriverType | null {
    return this._driver
  }

  private _safeParse(data: string): unknown {
    try {
      return JSON.parse(data)
    } catch {
      return data
    }
  }
}
