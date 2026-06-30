import { ValidationError } from "../core/errors.js"

export const MEMORY_SCHEMA_VERSION = 1

export interface SchemaMigration {
  from: number
  to: number
  description: string
  apply: (data: unknown) => unknown
}

export class MemorySchemaVersion {
  private migrations: SchemaMigration[] = []

  constructor() {
    this.registerBuiltIn()
  }

  private registerBuiltIn(): void {
    this.registerMigration({
      from: 0,
      to: 1,
      description: "Initial schema: add schema_version and timestamp fields to all memory objects",
      apply: (data: unknown) => {
        const d = data as Record<string, unknown>
        return {
          schema_version: 1,
          ...d,
          migrated_at: new Date().toISOString(),
          _migration: "v0→v1: added schema envelope",
        }
      },
    })
  }

  registerMigration(migration: SchemaMigration): void {
    const existingFromSame = this.migrations.filter(m => m.from === migration.from)
    if (existingFromSame.length > 0 && existingFromSame.some(m => m.to !== migration.to)) {
      throw new ValidationError(`SchemaMigrator: branching migration detected from v${migration.from} — existing: v${migration.from}->v${existingFromSame[0].to}, attempted: v${migration.from}->v${migration.to}`)
    }
    const exists = this.migrations.some(m => m.from === migration.from && m.to === migration.to)
    if (!exists) {
      this.migrations.push(migration)
      this.migrations.sort((a, b) => a.from - b.from)
    }
  }

  upgrade<T>(data: T, currentVersion: number): T {
    let result = data
    const visited = new Set<number>()
    while (true) {
      if (visited.has(currentVersion)) {
        throw new ValidationError(`SchemaMigrator: circular migration detected at v${currentVersion}`)
      }
      visited.add(currentVersion)
      const m = this.migrations.find(m => m.from === currentVersion)
      if (!m) break
      result = m.apply(result) as T
      currentVersion = m.to
    }
    return result
  }

  upgradeWithRollback<T>(data: T, currentVersion: number): { result: T; rollback: () => T } {
    const snapshot = JSON.parse(JSON.stringify(data))
    return {
      result: this.upgrade(data, currentVersion),
      rollback: () => JSON.parse(JSON.stringify(snapshot)),
    }
  }

  getMigrations(): SchemaMigration[] {
    return [...this.migrations]
  }

  static currentVersion(): number {
    return MEMORY_SCHEMA_VERSION
  }
}

export function createMemoryEnvelope<T>(data: T, type: string): { schema_version: number; type: string; data: T; created_at: string } {
  return {
    schema_version: MEMORY_SCHEMA_VERSION,
    type,
    data,
    created_at: new Date().toISOString(),
  }
}

export function parseMemoryEnvelope<T>(envelope: unknown): { version: number; type: string; data: T; createdAt: string } | null {
  const e = envelope as Record<string, unknown> | undefined
  if (!e || typeof e.schema_version !== "number" || !Number.isInteger(e.schema_version) || e.schema_version < 0) return null
  if (e.schema_version > MEMORY_SCHEMA_VERSION + 10) return null
  if (typeof e.type !== "string" || !e.data) return null
  return {
    version: e.schema_version,
    type: e.type,
    data: e.data as T,
    createdAt: (typeof e.created_at === "string" ? e.created_at : new Date().toISOString()),
  }
}
