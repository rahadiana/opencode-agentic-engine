/**
 * SQLitePersistence — backend SQLite untuk persistence layer.
 *
 * Menggantikan file JSON dengan better-sqlite3.
 * Satu database untuk semua namespace (rag, episodes, skills, models, dll).
 *
 * Keunggulan:
 *  - Query terstruktur (WHERE, JOIN, ORDER BY)
 *  - Update in-place (gak perlu baca-tulis ulang seluruh file)
 *  - Atomic transaction via better-sqlite3
 *  - Index untuk lookup cepet
 *  - WAL mode untuk concurrent read
 *
 * Schema:
 * ```sql
 * CREATE TABLE store (
 *   namespace  TEXT NOT NULL,     -- 'rag', 'episodes', 'skills', 'models', ...
 *   scope      TEXT DEFAULT '',   -- projectId atau '' untuk global
 *   key        TEXT NOT NULL,     -- unique key dalam namespace
 *   data       TEXT NOT NULL,     -- JSON string
 *   updated_at TEXT NOT NULL,
 *   created_at TEXT NOT NULL,
 *   PRIMARY KEY (namespace, scope, key)
 * );
 * ```
 */

import Database from "better-sqlite3"
import type { PersistentState } from "./persistence.js"
import { resolve } from "node:path"
import { homedir } from "node:os"
import { existsSync, mkdirSync } from "node:fs"

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

export class SQLitePersistence {
  private db: Database.Database
  private dbPath: string

  constructor(config?: SQLiteConfig) {
    const cfg = { ...DEFAULT_CONFIG, ...config }
    this.dbPath = cfg.dbPath ?? resolve(homedir(), ".config", "opencode", "agentic-store", "agentic.db")

    // Pastikan direktori ada
    const dir = resolve(this.dbPath, "..")
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    this.db = new Database(this.dbPath)

    // WAL mode: faster reads, concurrent readers
    if (cfg.wal) {
      this.db.pragma("journal_mode = WAL")
    }

    // Cache size
    this.db.pragma(`cache_size = -${cfg.cacheSize}`)

    // Enable WAL auto-checkpoint
    this.db.pragma("wal_autocheckpoint = 1000")

    if (cfg.autoMigrate) {
      this.migrate()
    }
  }

  /**
   * Auto-create table jika belum ada.
   */
  private migrate(): void {
    this.db.exec(`
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
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO store (namespace, scope, key, data, updated_at, created_at)
      VALUES (?, ?, ?, ?, ?,
        COALESCE((SELECT created_at FROM store WHERE namespace = ? AND scope = ? AND key = ?), ?)
      )
    `)
    const sc = scope ?? ""
    stmt.run(
      namespace, sc, key,
      JSON.stringify(data),
      now,
      namespace, sc, key,
      now,
    )
  }

  /**
   * Load data by key. Sama kayak PersistenceLayer.load().
   */
  load<T>(namespace: string, key: string, scope?: string): T | null {
    const sc = scope ?? ""
    const row = this.db.prepare(
      "SELECT data FROM store WHERE namespace = ? AND scope = ? AND key = ?"
    ).get(namespace, sc, key) as { data: string } | undefined

    if (!row) return null
    try {
      return JSON.parse(row.data) as T
    } catch {
      return null
    }
  }

  /**
   * Load ALL entries dalam suatu namespace/scope.
   * Sama kayak PersistenceLayer.loadAll().
   * Scope = undefined → ambil global (scope='') + semua scoped
   */
  loadAll<T>(namespace: string, scope?: string): PersistentState<T>[] {
    let rows: Array<{ key: string; data: string; updated_at: string }>

    if (scope !== undefined) {
      // Scoped: ambil spesifik scope
      rows = this.db.prepare(
        "SELECT key, data, updated_at FROM store WHERE namespace = ? AND scope = ? ORDER BY key"
      ).all(namespace, scope) as Array<{ key: string; data: string; updated_at: string }>
    } else {
      // Unscoped: ambil global (scope='') — mirip file-based look在不 scope
      rows = this.db.prepare(
        "SELECT key, data, updated_at FROM store WHERE namespace = ? AND scope = '' ORDER BY key"
      ).all(namespace) as Array<{ key: string; data: string; updated_at: string }>
    }

    return rows.map(row => ({
      key: row.key,
      data: this.safeParse(row.data),
      updatedAt: row.updated_at,
    }))
  }

  /**
   * Hapus entry.
   */
  delete(namespace: string, key: string, scope?: string): boolean {
    const sc = scope ?? ""
    const result = this.db.prepare(
      "DELETE FROM store WHERE namespace = ? AND scope = ? AND key = ?"
    ).run(namespace, sc, key)
    return result.changes > 0
  }

  /**
   * List semua key dalam namespace/scope.
   */
  listKeys(namespace: string, scope?: string): string[] {
    const sc = scope ?? ""
    const rows = this.db.prepare(
      "SELECT key FROM store WHERE namespace = ? AND scope = ? ORDER BY key"
    ).all(namespace, sc) as Array<{ key: string }>
    return rows.map(r => r.key)
  }

  /**
   * List semua scope prefixes yang ada dalam suatu namespace.
   * Contoh: untuk namespace 'episodes', return ['project-myapp', 'project-other']
   */
  listScopes(namespace: string): string[] {
    const rows = this.db.prepare(
      "SELECT DISTINCT scope FROM store WHERE namespace = ? AND scope != '' ORDER BY scope"
    ).all(namespace) as Array<{ scope: string }>
    return rows.map(r => r.scope)
  }

  /**
   * Hapus semua data dalam namespace (hati-hati!).
   */
  clearNamespace(namespace: string, scope?: string): number {
    if (scope !== undefined) {
      const result = this.db.prepare(
        "DELETE FROM store WHERE namespace = ? AND scope = ?"
      ).run(namespace, scope)
      return result.changes
    }
    const result = this.db.prepare(
      "DELETE FROM store WHERE namespace = ?"
    ).run(namespace)
    return result.changes
  }

  /**
   * Query mentah — untuk structured queries yang gak bisa pake API standar.
   *
   * Contoh:
   *   // Cari semua episode dengan outcome 'success'
   *   sqlite.query("SELECT * FROM store WHERE namespace = 'episodes' AND data LIKE '%success%'")
   *
   *   // Hitung per namespace
   *   sqlite.query("SELECT namespace, COUNT(*) as cnt FROM store GROUP BY namespace")
   */
  query<T = any>(sql: string, params?: any[]): T[] {
    if (params) {
      return this.db.prepare(sql).all(...params) as T[]
    }
    return this.db.prepare(sql).all() as T[]
  }

  /**
   * Dapatkan statistik database.
   */
  stats(): { namespaces: Array<{ namespace: string; scopes: number; keys: number }>; fileSize: number; dbPath: string } {
    const rows = this.db.prepare(
      "SELECT namespace, COUNT(DISTINCT scope) as scopes, COUNT(*) as keys FROM store GROUP BY namespace ORDER BY namespace"
    ).all() as Array<{ namespace: string; scopes: number; keys: number }>

    let fileSize = 0
    try {
      const fs = require("node:fs")
      fileSize = fs.statSync(this.dbPath).size
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
    this.db.close()
  }

  private safeParse(data: string): any {
    try {
      return JSON.parse(data)
    } catch {
      return data
    }
  }
}
