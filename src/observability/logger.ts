/**
 * Structured logger for the agentic engine.
 *
 * Wraps console methods with severity levels, source tagging,
 * and optional JSON output for machine consumption.
 *
 * When an OpenCode client is available (via setGlobalLogClient),
 * logs are sent via client.app.log() instead of console.*.
 *
 * Usage:
 *   const log = createLogger("Verifier")
 *   log.warn("File skipped", { file, reason: "EACCES" })
 *   log.error(err, { operation: "readFile" })
 *
 * Global client:
 *   import { setGlobalLogClient } from "./logger.js"
 *   setGlobalLogClient(input.client)
 *   // All subsequent createLogger() calls use client.app.log()
 */

export type LogSeverity = "debug" | "info" | "warn" | "error"

export interface LogEntry {
  timestamp: string
  severity: LogSeverity
  source: string
  message: string
  meta?: Record<string, unknown>
}

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void
  info(msg: string, meta?: Record<string, unknown>): void
  warn(msg: string, meta?: Record<string, unknown>): void
  error(msg: string | Error, meta?: Record<string, unknown>): void
}

// ── Global client for SDK logging ──────────────────────────

type LogClient = { app?: { log?: (opts: { body: { service: string; level: string; message: string; extra?: Record<string, unknown> } }) => Promise<boolean> } }
let _globalClient: LogClient | null = null

/**
 * Set the global OpenCode client for all loggers.
 * Call once at plugin init. All subsequent createLogger() calls
 * will use client.app.log() instead of console.* when available.
 */
export function setGlobalLogClient(client: LogClient): void {
  _globalClient = client
}

// ── Logger factory ─────────────────────────────────────────

function formatEntry(entry: LogEntry, jsonMode: boolean): string {
  if (jsonMode) {
    return JSON.stringify(entry)
  }
  const metaStr = entry.meta && Object.keys(entry.meta).length > 0
    ? " " + JSON.stringify(entry.meta)
    : ""
  return `[${entry.severity.toUpperCase()}] [${entry.source}] ${entry.message}${metaStr}`
}

/**
 * Create a logger with source prefix.
 * Set AGENTIC_LOG_JSON=1 for JSON output.
 * Set AGENTIC_LOG_LEVEL=debug/info/warn/error to filter.
 */
export function createLogger(source: string): Logger {
  const jsonMode = process.env.AGENTIC_LOG_JSON === "1"
  const level = (process.env.AGENTIC_LOG_LEVEL ?? "warn") as LogSeverity
  const levels: LogSeverity[] = ["debug", "info", "warn", "error"]
  const minIndex = levels.indexOf(level)

  function shouldLog(severity: LogSeverity): boolean {
    return levels.indexOf(severity) >= minIndex
  }

  function emit(severity: LogSeverity, message: string, meta?: Record<string, unknown>): void {
    if (!shouldLog(severity)) return
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      severity,
      source,
      message,
      ...(meta ? { meta } : {}),
    }

    // Prefer client.app.log when available (fire-and-forget)
    if (_globalClient?.app?.log) {
      _globalClient.app.log({
        body: {
          service: source,
          level: severity,
          message,
          extra: meta,
        },
      }).catch(() => {
        /* swallow — fallback already in console */
      })
      return
    }

    // Fallback: console.*
    const output = formatEntry(entry, jsonMode)
    switch (severity) {
      case "error": console.error(output); break
      case "warn":  console.warn(output);  break
      case "info":  console.info(output);  break
      default:      console.debug(output); break
    }
  }

  return {
    debug(msg, meta?) { emit("debug", msg, meta) },
    info(msg, meta?)  { emit("info", msg, meta) },
    warn(msg, meta?)  { emit("warn", msg, meta) },
    error(msg, meta?) {
      const errMsg = typeof msg === "string" ? msg : (msg.message || String(msg))
      emit("error", errMsg, meta)
    },
  }
}
