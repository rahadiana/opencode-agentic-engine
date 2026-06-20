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
import type { FileWrittenEvent } from "./event-taxonomy.js"
import type { ConfidenceScorer, ConfidenceStore, ScoringSignals } from "./confidence-scorer.js"
import type { SchemaValidator, SchemaValidationError } from "./skill-schema.js"

type AgenticFilePayload = FileWrittenEvent["payload"]

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
  const failed: string[] = []
  for (const f of files) {
    const absPath = join(projectDir, f.path)
    try {
      mkdirSync(dirname(absPath), { recursive: true })
      writeFileSync(absPath, f.content, "utf-8")
      written.push(f.path)

      if (eventBus) {
        const payload: AgenticFilePayload = {
          sessionID,
          filePath: f.path,
          bytesWritten: Buffer.byteLength(f.content, "utf-8"),
          sourceStepId: source?.stepId,
          sourceTaskId: source?.taskId,
        }
        eventBus.emit({ type: "file.written", payload })
      }
    } catch (e) {
      console.error(`[writeFiles] Failed to write ${f.path}:`, e)
      failed.push(f.path)
    }
  }
  if (failed.length > 0) {
    console.warn(`[writeFiles] ${failed.length}/${files.length} files failed to write:`, failed)
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

  // Fallback: only if raw has clear FILE: patterns or JSON structure suggesting code
  if (files.length === 0 && !raw.includes("NO_CHANGES") && !raw.includes('"noChanges"') &&
      (raw.includes("```") || raw.includes("\"files\""))) {
    const cbMatch = raw.match(/```(?:\w+)?\n([\s\S]*?)```/)
    if (cbMatch && raw.length > 100) {
      files.push({ path: "src/generated.ts", content: cbMatch[1] })
    }
  }

  return files
}

// ── Completion recording (blocking) ──

export interface CompletionDeps {
  /** BudgetTracker — step count selalu dicatat jika ada */
  budgetTracker?: BudgetTracker
  /** HallucinationGuard — auto-check jika ada dan filesModified non-kosong */
  hallucinationGuard?: HallucinationGuard
  /** ConfidenceScorer — confidence scoring per output (Gap #2) */
  confidenceScorer?: ConfidenceScorer
  /** ConfidenceStore — per-step confidence record store */
  confidenceStore?: ConfidenceStore
  /** SkillStore — auto-extract jika ada, role=developer, dan filesModified non-kosong */
  skillStore?: SkillStore
  /** SchemaValidator — validasi output schema jika skill yang diekstrak punya output_schema */
  schemaValidator?: SchemaValidator
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
  /** Confidence score for this step's output (Gap #2) */
  confidenceScore?: import("./confidence-scorer.js").ConfidenceScore
  /** Schema validation result — non-blocking warning */
  schemaValidation?: {
    outputErrors: SchemaValidationError[]
  }
}

/**
 * Blocking completion record — runs guard check + skill extraction + step record.
 * Setiap concern independen: guard gak butuh skill, skill gak butuh budget.
 * Dipanggil OLEH KEDUA jalur (agentic_execute, executePipeline) sehingga
 * guard/skill/budget tidak bisa bypass.
 *
 * Prinsip desain (konfirmasi reviewer):
 * - Budget step count: dicatat jika budgetTracker tersedia
 * - Guard check: jalan jika hallucinationGuard tersedia dan filesModified non-kosong
 * - Skill extraction: hanya jalan untuk role "developer" dengan filesModified
 */
export async function recordCompletion(
  record: CompletionRecord,
  deps: CompletionDeps,
): Promise<CompletionResult> {
  let guardPassed = true
  let skillExtracted = false
  let guardResult: { passed: boolean; claims: Array<{ verified: boolean }> } | undefined
  let confidenceScore_: import("./confidence-scorer.js").ConfidenceScore | undefined

  // 1. Budget step count — independent
  deps.budgetTracker?.recordStep()

  // 2. Hallucination guard — independent
  if (deps.hallucinationGuard && record.filesModified.length > 0) {
    guardResult = deps.hallucinationGuard.check(record.output, record.filesModified)
    guardPassed = guardResult.passed

    if (deps.eventBus) {
      const claims = guardResult.claims.slice(0, 20) as unknown as Array<{ claim: string; type: "file" | "function" | "import"; verified: boolean; expected: string; actual: string | null }>
      const unverifiedCount = claims.filter(c => !c.verified).length
      deps.eventBus.emit({
        type: "guard.check.completed",
        payload: {
          sessionID: record.sessionID,
          stepId: record.stepId ?? record.taskId ?? "",
          totalClaims: claims.length,
          unverifiedClaims: unverifiedCount,
          hallucinationRate: claims.length > 0 ? unverifiedCount / claims.length : 0,
          passed: guardPassed,
          claims,
        },
      })
    }
  }

  // 2b. Confidence scoring (Gap #2) — uses guard result + other available signals
  if (deps.confidenceScorer && deps.confidenceStore) {
    const signals: ScoringSignals = {
      stepId: record.stepId ?? record.taskId ?? "unknown",
      guardResult,
    }
    confidenceScore_ = deps.confidenceScorer.score(signals)
    deps.confidenceStore.set(record.stepId ?? record.taskId ?? "unknown", confidenceScore_)
  }

  // 3. Skill extraction — independent, ONLY for developer stage with files
  const autoExtract = deps.configLoader?.get().agent.autoSkillExtract ?? false
  if (autoExtract && deps.skillStore && !record.skipSkillExtract &&
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
          })
        }

        // 3b. Schema validation — jika skill punya output_schema
        if (deps.schemaValidator && skill.definition.output_schema) {
          try {
            const parsedOutput = tryParseJSON(record.output)
            if (parsedOutput) {
              const svResult = deps.schemaValidator.validate(
                skill.definition.output_schema,
                parsedOutput,
              )
              if (!svResult.valid) {
                const resultSchemaValidation = { outputErrors: svResult.errors }
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
                  })
                }
                // Return schema validation result
                return { guardPassed, skillExtracted, confidenceScore: confidenceScore_, schemaValidation: resultSchemaValidation }
              }
            }
          } catch {
            // non-fatal — schema validation is advisory
          }
        }
      }
    } catch {
      // non-fatal
    }
  }

  return { guardPassed, skillExtracted, confidenceScore: confidenceScore_ }
}

/**
 * Try to parse a string as JSON. Returns the parsed object or null.
 */
function tryParseJSON(text: string): Record<string, unknown> | null {
  // Try direct JSON parse first
  try {
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed
  } catch {
    // fall through
  }
  // Try to find a JSON object in the text
  const match = text.match(/\{[\s\S]*\}/)
  if (match) {
    try {
      const parsed = JSON.parse(match[0])
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed
    } catch {
      return null
    }
  }
  return null
}
