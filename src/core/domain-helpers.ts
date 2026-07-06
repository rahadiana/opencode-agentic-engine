/**
 * Domain helpers — shared utility functions for domain files.
 *
 * Extracted from src/core/domains/*.ts to eliminate boilerplate.
 * Each helper is a small, focused function that replaces a common pattern.
 */

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

// ── File-check pattern ──────────────────────────────────────

/**
 * Check if a project config file exists.
 * Wraps existsSync + resolve + try-catch (pattern repeated across 5 domain files).
 *
 * @example
 *   // Before:
 *   try { if (existsSync(resolve(projectDir, "package.json"))) score += 0.2 } catch (e) { console.warn("catch: skip", { error: String(e) }) }
 *   // After:
 *   if (checkProjectFile(projectDir, "package.json")) score += 0.2
 */
export function checkProjectFile(projectDir: string, ...files: string[]): boolean {
  for (const f of files) {
    try {
      if (existsSync(resolve(projectDir, f))) return true
    } catch {
      // non-fatal: file may not exist or path might be invalid
    }
  }
  return false
}

/**
 * Check multiple project files and accumulate score per match.
 *
 * @example
 *   // Before:
 *   const projectFiles = ["package.json", "tsconfig.json"]
 *   for (const f of projectFiles) { try { if (existsSync(resolve(projectDir, f))) score += 0.2 } catch (e) { console.warn("catch: skip", { error: String(e) }) } }
 *   // After:
 *   score += scoreProjectFiles(projectDir, 0.2, "package.json", "tsconfig.json")
 */
export function scoreProjectFiles(projectDir: string, bonusPerMatch: number, ...files: string[]): number {
  let score = 0
  for (const f of files) {
    try {
      if (existsSync(resolve(projectDir, f))) score += bonusPerMatch
    } catch {
      // non-fatal
    }
  }
  return score
}

// ── Safe file read ──────────────────────────────────────────

/**
 * Read a file safely, returning null on error.
 */
export function tryReadFile(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf-8")
  } catch {
    return null
  }
}

// ── execFileSync with error handling ────────────────────────

/**
 * Result of a safe execFileSync call.
 */
export interface ExecResult {
  passed: boolean
  output: string
}

/**
 * Run execFileSync with safe error handling.
 * Replaces the try-catch-cast pattern repeated in code.ts, devops.ts, security.ts.
 *
 * @example
 *   // Before:
 *   try {
 *     const output = execFileSync("npm", ["run", "build"], { cwd, timeout: 30000, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] })
 *     return { passed: true, output: output || "Build succeeded" }
 *   } catch (e: unknown) {
 *     const err = e as { stdout?: string; stderr?: string; message?: string }
 *     return { passed: false, output: err.stderr || err.stdout || err.message || "Build failed" }
 *   }
 *   // After:
 *   return safeExec("npm", ["run", "build"], { cwd, timeout: 30000 }, "Build succeeded")
 */
export function safeExec(
  bin: string,
  args: string[],
  opts: { cwd: string; timeout?: number; encoding?: BufferEncoding; stdio?: Array<"ignore" | "pipe"> },
  successMessage?: string,
): ExecResult {
  try {
    const output = execFileSync(bin, args, {
      cwd: opts.cwd,
      timeout: opts.timeout ?? 30000,
      encoding: opts.encoding ?? "utf-8",
      stdio: opts.stdio ?? ["ignore", "pipe", "pipe"],
    })
    return { passed: true, output: output || successMessage || "Command succeeded" }
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string }
    return { passed: false, output: err.stderr || err.stdout || err.message || "Command failed" }
  }
}

// ── Verifier return pattern ─────────────────────────────────

/**
 * Build verifier output from a list of issues.
 * Replaces the if-issues pattern in data-science, devops, mobile, security verifiers.
 */
export function issuesResult(issues: string[], successMessage: string): ExecResult {
  if (issues.length > 0) {
    return { passed: false, output: `${successMessage}:\n${issues.join("\n")}` }
  }
  return { passed: true, output: successMessage }
}

// ── Catch-only pattern ──────────────────────────────────────

/**
 * Safe file access — wraps a function in try-catch.
 * @deprecated Use checkProjectFile or scoreProjectFiles instead.
 */
export function safeAccess<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch {
    return fallback
  }
}
