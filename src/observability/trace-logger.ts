import { mkdir, writeFile, appendFile, readFile } from "node:fs/promises"
import { join, dirname } from "node:path"
import { existsSync } from "node:fs"

export interface TraceEntry {
  timestamp: string
  step: string
  input: string
  output: string
  toolUsed: string
  success: boolean
  durationMs: number
  metadata?: Record<string, unknown>
}

export class TraceLogger {
  private logPath: string
  private buffer: TraceEntry[] = []
  private flushInterval: ReturnType<typeof setInterval> | null = null
  /** Retention days for trace entries (0 = never prune). Config-hot-reloadable. */
  private retentionDays = 7

  constructor(worktree: string) {
    this.logPath = join(worktree || process.cwd(), ".agentic", "trace.jsonl")
  }

  /** Set retention days for pruning old traces — called on config hot-reload. */
  setRetentionDays(days: number): void {
    this.retentionDays = Math.max(0, days)
  }

  /** Prune trace entries older than retentionDays, in-place rewriting the file. */
  async pruneOldTraces(): Promise<number> {
    if (this.retentionDays <= 0) return 0
    if (!existsSync(this.logPath)) return 0
    const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000
    const cutoffStr = new Date(cutoff).toISOString()
    try {
      const content = await readFile(this.logPath, "utf-8")
      const lines = content.split("\n").filter(Boolean)
      const kept = lines.filter(line => {
        try {
          const entry = JSON.parse(line)
          return entry.timestamp >= cutoffStr
        } catch { return false }
      })
      // Only rewrite if we actually removed something
      if (kept.length < lines.length) {
        await writeFile(this.logPath, kept.map(e => JSON.stringify(e)).join("\n") + "\n")
      }
      return lines.length - kept.length
    } catch { return 0 }
  }

  async init(): Promise<void> {
    const dir = dirname(this.logPath)
    await mkdir(dir, { recursive: true })
  }

  log(entry: Omit<TraceEntry, "timestamp">): void {
    this.buffer.push({
      ...entry,
      timestamp: new Date().toISOString(),
    })

    if (this.buffer.length >= 10) {
      this.flush()
    }

    if (!this.flushInterval) {
      this.flushInterval = setInterval(() => this.flush(), 5000)
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return

    // Atomically swap buffer to prevent duplicate entries during async write
    const snapshot = this.buffer
    this.buffer = []
    const lines = snapshot.map(e => JSON.stringify(e)).join("\n") + "\n"

    try {
      await appendFile(this.logPath, lines)
    } catch {
      try {
        await writeFile(this.logPath, lines)
      } catch {
        // Write failed — re-add entries to buffer for next flush
        this.buffer = [...snapshot, ...this.buffer]
      }
    }
  }

  async dispose(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval)
      this.flushInterval = null
    }
    await this.flush()
  }
}
