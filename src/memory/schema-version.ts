export const MEMORY_SCHEMA_VERSION = 1

export interface SchemaMigration {
  from: number
  to: number
  description: string
  apply: (data: unknown) => unknown
}

export class MemorySchemaVersion {
  private migrations: SchemaMigration[] = []

  registerMigration(migration: SchemaMigration): void {
    this.migrations.push(migration)
  }

  upgrade<T>(data: T, currentVersion: number): T {
    let result = data
    for (const m of this.migrations) {
      if (m.from >= currentVersion && m.to > currentVersion) {
        result = m.apply(result) as T
      }
    }
    return result
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
  if (!e || typeof e.schema_version !== "number" || typeof e.type !== "string" || !e.data) return null
  return {
    version: e.schema_version,
    type: e.type,
    data: e.data as T,
    createdAt: (typeof e.created_at === "string" ? e.created_at : new Date().toISOString()),
  }
}
