/**
 * Execution Helpers — shared primitives for BOTH agentic_execute and executePipeline.
 *
 * Prinsip: satu jalur file-write + completion-record, bukan dua jalur paralel.
 * Kedua fungsi ini blocking → cocok untuk enforcement yang harus menahan (budget, guard).
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { join, dirname } from "node:path"
import type { EventBus } from "./event-bus.js"
import type { BudgetTracker } from "./budget-tracker.js"
import type { HallucinationGuard } from "../drift/hallucination-guard.js"
import type { SkillStore } from "../memory/skill-store.js"
import type { ConfigLoader } from "./config.js"

// ── File writing ──

export interface FileWriteEntry {
  path: string
  content: string
}

/**
 * Write files to disk + emit file.written events.
 * Single chokepoint — semua jalur (agentic_execute, executePipeline) panggil ini.
 * Returns absolute paths of files written.
 */
export function writeFiles(
  files: FileWriteEntry[],
  projectDir: string,
  sessionID: string,
  eventBus?: EventBus,
  source?: { stepId?: string; taskId?: string; pipelineRunId?: string },
): string[] {
  const written: string[] = []
  for (const f of files) {
    const absPath = join(projectDir, f.path)
    try {
      mkdirSync(dirname(absPath), { recursive: true })
      writeFileSync(absPath, f.content, "utf-8")
      written.push(f.path)

      if (eventBus) {
        eventBus.emit({
          type: "file.written",
          payload: {
            sessionID,
            filePath: f.path,
            bytesWritten: Buffer.byteLength(f.content, "utf-8"),
            sourceStepId: source?.stepId,
            sourceTaskId: source?.taskId,
          },
        } as any)
      }
    } catch {
      // non-fatal: skip files that can't be written
    }
  }
  return written
}

/**
 * Parse JSON output from LLM developer stage, extracting {path, content} entries.
 * Falls back to FILE: regex pattern if JSON parsing fails.
 */
export function parseFileEntries(raw: string): FileWriteEntry[] {
  const files: FileWriteEntry[] = []

  // Try JSON first
  try {
    const parsed = JSON.parse(raw)
    if (parsed.files && Array.isArray(parsed.files)) {
      for (const f of parsed.files) {
        if (f.path && f.content) {
          files.push({ path: f.path, content: f.content })
        }
      }
    }
    if (files.length > 0) return files
  } catch {
    // fall through to regex
  }

  // Try FILE: ``` blocks
  const fbRegex = /FILE:\s*(\S+)\n```(?:\w+)?\n([\s\S]*?)```/g
  let m: RegExpExecArray | null
  while ((m = fbRegex.exec(raw)) !== null) {
    files.push({ path: m[1].replace(/^\/+/, ""), content: m[2] })
  }

  // Try generic code blocks as last resort
  if (files.length === 0 && !raw.includes("NO_CHANGES") && !raw.includes('"noChanges"')) {
    const cbMatch = raw.match(/```(?:\w+)?\n([\s\S]*?)```/)
    if (cbMatch) {
      files.push({ path: "src/generated.ts", content: cbMatch[1] })
    }
  }

  return files
}

// ── Completion recording (blocking) ──

export interface CompletionDeps {
  budgetTracker: BudgetTracker
  hallucinationGuard: HallucinationGuard
  skillStore: SkillStore
  configLoader?: ConfigLoader
  eventBus?: EventBus
}

export interface CompletionRecord {
  sessionID: string
  stepId?: string
  taskId?: string
  pipelineRunId?: string
  output: string
  filesModified: string[]
  durationMs: number
  /** Role label — used to gate skill extraction to developer stage */
  role?: string
  /** If true, skip skill extraction even for developer (e.g., empty output) */
  skipSkillExtract?: boolean
}

export interface CompletionResult {
  /** Guard passed (no unverified claims, or guard disabled) */
  guardPassed: boolean
  /** Whether a skill was actually extracted */
  skillExtracted: boolean
}

/**
 * Blocking completion record — runs guard check + skill extraction + step record.
 * Dipanggil OLEH KEDUA jalur (agentic_execute, executePipeline) sehingga
 * guard/skill/budget tidak bisa bypass.
 *
 * Prinsip desain (konfirmasi reviewer):
 * - Guard check: selalu jalan (no-op kalau filesModified kosong)
 * - Skill extraction: hanya jalan untuk role "developer" dengan filesModified non-kosong
 * - Step recording: selalu jalan (untuk budget step count)
 */
export async function recordCompletion(
  record: CompletionRecord,
  deps: CompletionDeps,
): Promise<CompletionResult> {
  let guardPassed = true
  let skillExtracted = false

  // 1. Budget step count
  deps.budgetTracker.recordStep()

  // 2. Hallucination guard (blocking, auto-check)
  if (record.filesModified.length > 0) {
    const guardResult = deps.hallucinationGuard.check(record.output, record.filesModified)
    guardPassed = guardResult.passed

    if (deps.eventBus) {
      deps.eventBus.emit({
        type: "guard.check.completed",
        payload: {
          sessionID: record.sessionID,
          stepId: record.stepId ?? record.taskId ?? "",
          totalClaims: guardResult.claims.length,
          unverifiedClaims: guardResult.claims.filter((c: any) => !c.verified).length,
          hallucinationRate: guardResult.claims.length > 0
            ? guardResult.claims.filter((c: any) => !c.verified).length / guardResult.claims.length
            : 0,
          passed: guardPassed,
          claims: guardResult.claims.slice(0, 20),
        },
      } as any)
    }
  }

  // 3. Skill extraction — ONLY for developer stage with files
  const autoExtract = deps.configLoader?.get().agent.autoSkillExtract ?? false
  if (autoExtract && !record.skipSkillExtract &&
      record.role === "developer" && record.filesModified.length > 0) {
    try {
      const skill = await deps.skillStore.extract(
        { role: "developer", content: record.output },
        [record.stepId ?? record.taskId ?? "", ...record.filesModified],
      )
      if (skill) {
        skillExtracted = true
        if (deps.eventBus) {
          deps.eventBus.emit({
            type: "memory.skill.extracted",
            payload: {
              sessionID: record.sessionID,
              skillId: skill.definition.meta.id,
              name: skill.definition.meta.name,
              sourceStepId: record.stepId,
              successRate: skill.successRate,
            },
          } as any)
        }
      }
    } catch {
      // non-fatal
    }
  }

  return { guardPassed, skillExtracted }
}
