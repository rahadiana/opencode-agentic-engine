import { mkdir, writeFile, appendFile } from "node:fs/promises"
import { join, dirname } from "node:path"

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

  constructor(worktree: string) {
    this.logPath = join(worktree, ".agentic", "trace.jsonl")
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

    const snapshot = [...this.buffer]
    const lines = snapshot.map(e => JSON.stringify(e)).join("\n") + "\n"

    try {
      await appendFile(this.logPath, lines)
      this.buffer = this.buffer.slice(snapshot.length)
    } catch {
      try {
        await writeFile(this.logPath, lines)
        this.buffer = this.buffer.slice(snapshot.length)
      } catch {
        // Silently fail — data retained in buffer for next flush
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
