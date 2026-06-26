import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync, renameSync } from "node:fs"
import { resolve } from "node:path"
import { homedir } from "node:os"
import { createLogger } from "../observability/logger.js"

const log = createLogger("Persistence")

export interface PersistentState<T> {
  key: string
  data: T
  updatedAt: string
}

/**
 * PersistenceLayer — hybrid global + local storage with project scoping.
 *
 * Storage layout:
 *   Global: ~/.config/opencode/agentic-store/{namespace}/@{scope}/{key}.json
 *   Local:  <project>/.agentic/store/{namespace}/@{scope}/{key}.json
 *
 * Scoped mode (scope provided):
 *   - Data isolated per project: episodes, evolution, evaluation
 *   - Prevents cross-project noise in pattern discovery
 *
 * Unscoped mode (scope omitted):
 *   - Shared across ALL projects: skills, models, prompts
 *   - Backward compatible with existing callers
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

  /** Build scoped path: "episodes" + "@project-myapp" → "episodes/@project-myapp" */
  private scoped(ns: string, scope?: string): string {
    return scope ? `${ns}/@${scope}` : ns
  }

  save<T>(namespace: string, key: string, data: T, scope?: string): void {
    const ns = this.scoped(namespace, scope)
    this.writeTo(this.globalDir, ns, key, data)
    this.writeTo(this.localDir, ns, key, data)
  }

  load<T>(namespace: string, key: string, scope?: string): T | null {
    const ns = this.scoped(namespace, scope)
    // Local override first
    const local = this.readFrom<T>(this.localDir, ns, key)
    if (local !== null) return local
    return this.readFrom<T>(this.globalDir, ns, key)
  }

  loadAll<T>(namespace: string, scope?: string): PersistentState<T>[] {
    const ns = this.scoped(namespace, scope)
    const seen = new Set<string>()
    const result: PersistentState<T>[] = []

    // Global first (base), then local overrides
    const globalItems = this.readAllFrom<T>(this.globalDir, ns)
    for (const item of globalItems) {
      seen.add(item.key)
      result.push(item)
    }

    const localItems = this.readAllFrom<T>(this.localDir, ns)
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

  delete(namespace: string, key: string, scope?: string): boolean {
    const ns = this.scoped(namespace, scope)
    let found = false
    const globalPath = resolve(this.globalDir, ns, `${key}.json`)
    if (existsSync(globalPath)) { try { unlinkSync(globalPath); found = true } catch { /* non-fatal */ } }
    const localPath = resolve(this.localDir, ns, `${key}.json`)
    if (existsSync(localPath)) { try { unlinkSync(localPath); found = true } catch { /* non-fatal */ } }
    return found
  }

  listKeys(namespace: string, scope?: string): string[] {
    const ns = this.scoped(namespace, scope)
    const seen = new Set<string>()
    for (const dir of [this.globalDir, this.localDir]) {
      const full = resolve(dir, ns)
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

  /** List all scope prefixes under a namespace (e.g., "@project-myapp") */
  listScopes(namespace: string): string[] {
    const seen = new Set<string>()
    for (const dir of [this.globalDir, this.localDir]) {
      const full = resolve(dir, namespace)
      if (existsSync(full)) {
        for (const entry of readdirSync(full, { withFileTypes: true })) {
          if (entry.isDirectory() && entry.name.startsWith("@")) {
            seen.add(entry.name.slice(1)) // remove @ prefix
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
      const filePath = resolve(dir, `${key}.json`)
      const tmpPath = filePath + ".tmp." + Date.now()
      writeFileSync(tmpPath, JSON.stringify(state, null, 2), "utf-8")
      renameSync(tmpPath, filePath)
    } catch (e) {
      log.error(`writeTo failed (${base}/${namespace}/${key})`, { error: e })
    }
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
