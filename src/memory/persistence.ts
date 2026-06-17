import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "node:fs"
import { resolve } from "node:path"
import { homedir } from "node:os"

export interface PersistentState<T> {
  key: string
  data: T
  updatedAt: string
}

/**
 * PersistenceLayer — hybrid global + local storage.
 *
 * Global store: ~/.config/opencode/agentic-store/ (shared across ALL projects)
 * Local store:  <project>/.agentic/store/            (project-specific override)
 *
 * save() → writes to BOTH global and local
 * load() → checks local first (override), falls back to global
 * loadAll() → merges global + local (local wins on key conflict)
 */
export class PersistenceLayer {
  private globalDir: string
  private localDir: string

  constructor(worktree: string) {
    // Global: shared across projects
    this.globalDir = process.env.AGENTIC_STORE_DIR || resolve(homedir(), ".config", "opencode", "agentic-store")
    // Local: project-specific override
    this.localDir = resolve(worktree || process.cwd(), ".agentic", "store")
  }

  save<T>(namespace: string, key: string, data: T): void {
    this.writeTo(this.globalDir, namespace, key, data)
    this.writeTo(this.localDir, namespace, key, data)
  }

  load<T>(namespace: string, key: string): T | null {
    // Local override first
    const local = this.readFrom<T>(this.localDir, namespace, key)
    if (local !== null) return local
    return this.readFrom<T>(this.globalDir, namespace, key)
  }

  loadAll<T>(namespace: string): PersistentState<T>[] {
    const seen = new Set<string>()
    const result: PersistentState<T>[] = []

    // Global first (base), then local overrides
    const globalItems = this.readAllFrom<T>(this.globalDir, namespace)
    for (const item of globalItems) {
      seen.add(item.key)
      result.push(item)
    }

    const localItems = this.readAllFrom<T>(this.localDir, namespace)
    for (const item of localItems) {
      if (seen.has(item.key)) {
        // Replace global entry with local override (keep same position)
        const idx = result.findIndex(r => r.key === item.key)
        if (idx >= 0) result[idx] = item
      } else {
        result.push(item)
      }
    }

    return result
  }

  delete(namespace: string, key: string): boolean {
    let found = false
    const globalPath = resolve(this.globalDir, namespace, `${key}.json`)
    if (existsSync(globalPath)) { try { unlinkSync(globalPath); found = true } catch {} }
    const localPath = resolve(this.localDir, namespace, `${key}.json`)
    if (existsSync(localPath)) { try { unlinkSync(localPath); found = true } catch {} }
    return found
  }

  listKeys(namespace: string): string[] {
    const seen = new Set<string>()
    for (const dir of [this.globalDir, this.localDir]) {
      const full = resolve(dir, namespace)
      if (existsSync(full)) {
        for (const entry of readdirSync(full, { withFileTypes: true })) {
          if (entry.isFile() && entry.name.endsWith(".json")) {
            seen.add(entry.name.replace(".json", ""))
          }
        }
      }
    }
    return [...seen]
  }

  private writeTo<T>(base: string, namespace: string, key: string, data: T): void {
    try {
      const dir = resolve(base, namespace)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      const state: PersistentState<T> = { key, data, updatedAt: new Date().toISOString() }
      writeFileSync(resolve(dir, `${key}.json`), JSON.stringify(state, null, 2), "utf-8")
    } catch { /* non-fatal: e.g. read-only fs */ }
  }

  private readFrom<T>(base: string, namespace: string, key: string): T | null {
    const filePath = resolve(base, namespace, `${key}.json`)
    if (!existsSync(filePath)) return null
    try {
      const state = JSON.parse(readFileSync(filePath, "utf-8")) as PersistentState<T>
      return state.data
    } catch { return null }
  }

  private readAllFrom<T>(base: string, namespace: string): PersistentState<T>[] {
    const dir = resolve(base, namespace)
    if (!existsSync(dir)) return []
    const results: PersistentState<T>[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".json")) {
        try {
          const state = JSON.parse(readFileSync(resolve(dir, entry.name), "utf-8")) as PersistentState<T>
          results.push(state)
        } catch { /* skip corrupted */ }
      }
    }
    return results
  }
}
