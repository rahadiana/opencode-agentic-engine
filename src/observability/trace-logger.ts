import { mkdir, writeFile, appendFile, readFile } from "node:fs/promises"
import { createReadStream, createWriteStream } from "node:fs"
import { createInterface } from "node:readline"
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
    const tmpPath = this.logPath + ".tmp"
    let total = 0
    let kept = 0

    try {
      const rl = createInterface({ input: createReadStream(this.logPath, "utf-8"), crlfDelay: Infinity })
      const ws = createWriteStream(tmpPath, "utf-8")

      for await (const line of rl) {
        if (!line.trim()) continue
        total++
        try {
          const entry = JSON.parse(line)
          if (entry.timestamp >= cutoffStr) {
            ws.write(line + "\n")
            kept++
          }
        } catch {
          ws.write(line + "\n") // keep unparseable lines
          kept++
        }
      }

      await new Promise<void>((resolve, reject) => {
        ws.end()
        ws.on("finish", resolve)
        ws.on("error", reject)
      })
      rl.close()

      // Only replace if we actually removed something
      if (kept < total) {
        await writeFile(this.logPath, await readFile(tmpPath))
      }
      return total - kept
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
      this.flush().catch(() => {})
    }

    if (!this.flushInterval) {
      this.flushInterval = setInterval(() => { this.flush().catch(() => {}) }, 5000)
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return

    const snapshot = this.buffer
    const lines = snapshot.map(e => JSON.stringify(e)).join("\n") + "\n"

    try {
      await appendFile(this.logPath, lines)
      this.buffer = []
    } catch {
      try {
        await writeFile(this.logPath, lines)
        this.buffer = []
      } catch {
        // Write failed — buffer preserved for next flush attempt
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
