import { mkdir, writeFile, appendFile, readFile, rename } from "node:fs/promises"
import { createReadStream, createWriteStream } from "node:fs"
import { createInterface } from "node:readline"
import { join, dirname } from "node:path"
import { existsSync } from "node:fs"
import { createGzip } from "node:zlib"
import { pipeline } from "node:stream/promises"
import { statSync } from "node:fs"
import { createLogger } from "./logger.js"

const log = createLogger("TraceLogger")

export type LogLevel = "info" | "warn" | "error"

export interface TraceEntry {
  timestamp: string
  step: string
  input: string
  output: string
  toolUsed: string
  success: boolean
  durationMs: number
  level?: LogLevel
  metadata?: Record<string, unknown>
}

export class TraceLogger {
  private logPath: string
  private buffer: TraceEntry[] = []
  private flushInterval: ReturnType<typeof setInterval> | null = null
  /** Retention days for trace entries (0 = never prune). Config-hot-reloadable. */
  private retentionDays = 7
  private maxBufferSize: number
  private batchSize: number
  private maxFileSizeBytes: number
  private useCompression: boolean
  private minLevel: LogLevel
  private flushLock = false
  /** In-flight flush promise — dispose awaits this before its own flush. */
  private pendingFlush: Promise<void> | null = null

  constructor(
    worktree: string,
    opts?: {
      batchSize?: number
      maxBufferSize?: number
      maxFileSizeBytes?: number
      useCompression?: boolean
      minLevel?: LogLevel
    },
  ) {
    this.logPath = join(worktree || process.cwd(), ".agentic", "trace.jsonl")
    this.batchSize = opts?.batchSize ?? 10
    this.maxBufferSize = opts?.maxBufferSize ?? 10000
    this.maxFileSizeBytes = opts?.maxFileSizeBytes ?? 100 * 1024 * 1024
    this.useCompression = opts?.useCompression ?? false
    this.minLevel = opts?.minLevel ?? "info"
  }

  private levelValue(level?: LogLevel): number {
    return level === "error" ? 3 : level === "warn" ? 2 : 1
  }

  /** Set retention days for pruning old traces — called on config hot-reload. */
  setRetentionDays(days: number): void {
    this.retentionDays = Math.max(0, days)
  }

  private async rotateIfNeeded(): Promise<void> {
    if (!existsSync(this.logPath)) return
    try {
      const size = statSync(this.logPath).size
      if (size < this.maxFileSizeBytes) return
      const ts = new Date().toISOString().replace(/[:.]/g, "-")
      const rotatedPath = this.logPath.replace(".jsonl", `-${ts}.jsonl`)
      await rename(this.logPath, rotatedPath)
      if (this.useCompression) {
        const gzPath = rotatedPath + ".gz"
        const ws = createWriteStream(gzPath)
        const gzip = createGzip()
        const rs = createReadStream(rotatedPath)
        await pipeline(rs, gzip, ws)
      }
    } catch {
      // non-fatal rotation failure
    }
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

      if (kept < total) {
        await writeFile(this.logPath, await readFile(tmpPath))
      }
      return total - kept
    } catch (err) {
      log.error("pruneOldTraces error", { error: err })
      return 0
    }
  }

  async init(): Promise<void> {
    const dir = dirname(this.logPath)
    try {
      await mkdir(dir, { recursive: true })
    } catch (err) {
      throw new Error(`TraceLogger.init: failed to create directory ${dir}: ${err}`)
    }
  }

  private lastLoggedEntry: string | null = null

  log(entry: Omit<TraceEntry, "timestamp" | "level"> & { level?: LogLevel }): void {
    const level = entry.level ?? "info"
    if (this.levelValue(level) < this.levelValue(this.minLevel)) return

    const dedupKey = `${entry.step}|${entry.toolUsed}|${entry.input}`
    if (dedupKey === this.lastLoggedEntry) {
      return
    }
    this.lastLoggedEntry = dedupKey

    // Backpressure: bounded buffer
    if (this.buffer.length >= this.maxBufferSize) {
      this.buffer.shift()
    }

    this.buffer.push({
      ...entry,
      level,
      timestamp: new Date().toISOString(),
    })

    if (this.buffer.length >= this.batchSize && !this.flushLock) {
      this.pendingFlush = this.flush().catch(() => {})
    }

    if (!this.flushInterval) {
      this.flushInterval = setInterval(() => { this.flush().catch(() => {}) }, 5000)
    }
  }

  async flush(): Promise<void> {
    if (this.flushLock) return
    this.flushLock = true
    try {
      if (this.buffer.length === 0) return

      const snapshot = this.buffer
      let data: Buffer | string
      const lines = snapshot.map(e => JSON.stringify(e)).join("\n") + "\n"

      await this.rotateIfNeeded()

      if (this.useCompression) {
        data = await new Promise<Buffer>((resolve, reject) => {
          const gzip = createGzip()
          const chunks: Buffer[] = []
          gzip.on("data", (c: Buffer) => chunks.push(c))
          gzip.on("end", () => resolve(Buffer.concat(chunks)))
          gzip.on("error", reject)
          gzip.end(lines)
        })
        await appendFile(this.logPath + ".gz", data)
      } else {
        data = lines
        try {
          await appendFile(this.logPath, data)
        } catch {
          try {
            await writeFile(this.logPath, data)
          } catch {
            return // buffer preserved
          }
        }
      }
      this.buffer = []
    } finally {
      this.flushLock = false
    }
  }

  async dispose(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval)
      this.flushInterval = null
    }
    // Await any in-flight auto-flush before flushing remaining buffer
    if (this.pendingFlush) {
      await this.pendingFlush
      this.pendingFlush = null
    }
    await this.flush()
  }
}
