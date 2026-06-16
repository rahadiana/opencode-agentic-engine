import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "node:fs"
import { resolve } from "node:path"

export interface PersistentState<T> {
  key: string
  data: T
  updatedAt: string
}

export class PersistenceLayer {
  private baseDir: string
  private storeDir: string

  constructor(worktree: string) {
    this.baseDir = worktree || process.cwd()
    this.storeDir = resolve(this.baseDir, ".agentic", "store")
    this.ensureDir()
  }

  save<T>(namespace: string, key: string, data: T): void {
    const dir = resolve(this.storeDir, namespace)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

    const state: PersistentState<T> = {
      key,
      data,
      updatedAt: new Date().toISOString(),
    }
    writeFileSync(resolve(dir, `${key}.json`), JSON.stringify(state, null, 2), "utf-8")
  }

  load<T>(namespace: string, key: string): T | null {
    const filePath = resolve(this.storeDir, namespace, `${key}.json`)
    if (!existsSync(filePath)) return null
    try {
      const state = JSON.parse(readFileSync(filePath, "utf-8")) as PersistentState<T>
      return state.data
    } catch {
      return null
    }
  }

  loadAll<T>(namespace: string): PersistentState<T>[] {
    const dir = resolve(this.storeDir, namespace)
    if (!existsSync(dir)) return []
    const results: PersistentState<T>[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".json")) {
        try {
          const state = JSON.parse(readFileSync(resolve(dir, entry.name), "utf-8")) as PersistentState<T>
          results.push(state)
        } catch {
          // skip corrupted files
        }
      }
    }
    return results
  }

  delete(namespace: string, key: string): boolean {
    const filePath = resolve(this.storeDir, namespace, `${key}.json`)
    if (!existsSync(filePath)) return false
    try {
      unlinkSync(filePath)
      return true
    } catch {
      return false
    }
  }

  listKeys(namespace: string): string[] {
    const dir = resolve(this.storeDir, namespace)
    if (!existsSync(dir)) return []
    return readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isFile() && e.name.endsWith(".json"))
      .map(e => e.name.replace(".json", ""))
  }

  private ensureDir(): void {
    if (!existsSync(this.storeDir)) {
      mkdirSync(this.storeDir, { recursive: true })
    }
  }
}
