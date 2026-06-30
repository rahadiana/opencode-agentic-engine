import type { LLMEngine } from "./llm.js"
import type { DebateRound } from "./debate-loop.js"
import { TimeoutError } from "./errors.js"
import { SchemaValidator, type SchemaField } from "./skill-schema.js"

export interface CleanConfig {
  /** Raw text to clean */
  text: string
  /** Output format */
  format: "markdown" | "json" | "text"
  /** Optional JSON schema description (e.g., "array of {name, age}") */
  schema?: string
  /** Whether to strip debate artifacts (default: true) */
  stripDebateArtifacts?: boolean
  /** Max output length (default: 8000 chars) */
  maxOutput?: number
}

export interface CleanResult {
  /** Cleaned text */
  cleaned: string
  /** Whether the output is valid JSON (if format=json) */
  validJson: boolean
  /** Parsed JSON object if valid */
  parsedJson?: unknown
  /** Stats about what was removed */
  stats: {
    originalLength: number
    cleanedLength: number
    removedLines: number
  }
}

export interface DataValidationPayload {
  valid: boolean
  issues: string[]
}

const dataValidationSchema: Record<string, SchemaField> = {
  valid: { type: "boolean", required: true },
  issues: { type: "array", required: true, items: { type: "string", required: true } },
}

const dataValidationSchemaValidator = new SchemaValidator()

export function parseDataValidationPayload(raw: string): DataValidationPayload | null {
  const cleaned = raw.trim()
  const jsonText = cleaned.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)?.[1]
    ?? cleaned.match(/\{[\s\S]*\}/)?.[0]
    ?? cleaned

  try {
    const data = JSON.parse(jsonText)
    if (!data || typeof data !== "object" || Array.isArray(data)) return null
    const result = dataValidationSchemaValidator.validate(dataValidationSchema, data as Record<string, unknown>, { allowExtraFields: false })
    if (!result.valid) return null
    return {
      valid: result.data.valid as boolean,
      issues: result.data.issues as string[],
    }
  } catch {
    return null
  }
}

const CLEANER_SYSTEM_PROMPT = `You are a **data cleaner**. Your job is to take raw text and reformat it into clean, structured output.

Rules:
1. Remove ALL meta-commentary, debate artifacts, and conversational filler:
   - "I agree", "Good point", "Let me fix that", "You're right", etc.
   - Numbered issue lists that were part of a review process
   - Any text that looks like it's part of a back-and-forth discussion
2. Keep ONLY substantive content: facts, data, analysis, conclusions, code
3. If format is "json", output valid JSON only (no markdown fences)
4. If format is "markdown", use clean markdown with proper headings
5. If format is "text", output plain text paragraphs
6. Preserve ALL factual content — do not add or remove information
7. If a schema is provided, ensure the output matches that structure
8. Be concise — remove redundant statements

Output the cleaned version only. No explanation, no preamble.`

export class DataCleaner {
  constructor(private llmEngine?: LLMEngine) {}

  setLLM(llm: LLMEngine): void {
    this.llmEngine = llm
  }

  async clean(config: CleanConfig): Promise<CleanResult> {
    const { text, format, schema, stripDebateArtifacts = true, maxOutput = 8000 } = config
    const originalLength = text.length

    // Step 1: Basic regex cleaning (fast, no LLM needed)
    let cleaned = text

    if (stripDebateArtifacts) {
      cleaned = this.stripDebateMarkers(cleaned)
    }

    // Step 2: LLM-powered cleaning if available
    if (this.llmEngine) {
      try {
        let systemPrompt = CLEANER_SYSTEM_PROMPT
        if (schema) {
          systemPrompt += `\n\nExpected output schema: ${schema}`
        }

        // 30s timeout untuk LLM call (STEM Agent §timeout)
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 30_000)
        const resp = await Promise.race([
          this.llmEngine.call({
            systemPrompt,
            userPrompt: `Format: ${format}\n\nRaw text:\n\n${cleaned.slice(0, maxOutput * 2)}\n\nClean this into ${format} format.${schema ? ` Follow this schema: ${schema}` : ""}`,
            temperature: 0.1,
            maxTokens: maxOutput,
          }),
          new Promise<never>((_, reject) => {
            controller.signal.addEventListener("abort", () => {
              reject(new TimeoutError("Cleaner LLM", 30000))
            })
          }),
        ])
        clearTimeout(timeoutId)

        cleaned = resp.content.trim()
      } catch {
        // Fall through to basic cleaning if LLM fails
      }
    }

    // Step 3: Extract JSON if format is json
    let validJson = false
    let parsedJson: unknown | undefined

    if (format === "json") {
      const parsed = this.tryParseJSON(cleaned)
      if (parsed !== null) {
        validJson = true
        parsedJson = parsed
        cleaned = JSON.stringify(parsed, null, 2)
      }
    }

    // Step 4: Calculate stats
    const cleanedLines = cleaned.split("\n").filter(l => l.trim()).length
    const originalLines = text.split("\n").filter(l => l.trim()).length

    return {
      cleaned,
      validJson,
      parsedJson,
      stats: {
        originalLength,
        cleanedLength: cleaned.length,
        removedLines: Math.max(0, originalLines - cleanedLines),
      },
    }
  }

  /**
   * Compress debate history into a clean summary.
   */
  compressDebate(rounds: DebateRound[], finalOutput: string): string {
    const summary = rounds.map((r, _i) => {
      const issues = r.issues.length > 0
        ? `\n   Issues: ${r.issues.slice(0, 3).map(j => j.slice(0, 100)).join("; ")}${r.issues.length > 3 ? ` (+${r.issues.length - 3} more)` : ""}`
        : ""
      return `Round ${r.round}: ${r.approved ? "✅ Approved" : "⚠️ Revised"}${issues}`
    }).join("\n")

    const lines = [
      `## Debate Summary`,
      `**Rounds:** ${rounds.length}`,
      `**Final Status:** ${rounds[rounds.length - 1]?.approved ? "✅ Approved" : "⚠️ Max rounds reached"}`,
      ``,
      `### History`,
      summary,
      ``,
      `### Final Output`,
      finalOutput.slice(0, 2000),
    ]

    return lines.join("\n")
  }

  /**
   * Validate text matches a given structure description using LLM.
   */
  async validate(text: string, expectedStructure: string): Promise<{
    valid: boolean
    issues: string[]
  }> {
    if (!this.llmEngine) {
      return { valid: false, issues: ["LLM unavailable for validation"] }
    }

    try {
      const resp = await this.llmEngine.call({
        systemPrompt: `You are a data validator. Given text and an expected structure description, check if the text conforms. Return JSON: { "valid": boolean, "issues": string[] }.`,
        userPrompt: `Expected structure: ${expectedStructure}\n\nText:\n${text.slice(0, 3000)}\n\nValidate and return JSON.`,
        temperature: 0.1,
        maxTokens: 512,
        jsonMode: true,
      })

      const parsed = parseDataValidationPayload(resp.content)
      if (parsed) {
        return parsed
      }
    } catch {
      // Fallback
    }

    return { valid: false, issues: ["LLM validation failed or returned invalid schema"] }
  }

  private static readonly MAX_INPUT_LENGTH = 100_000

  private stripDebateMarkers(text: string): string {
    if (text.length > DataCleaner.MAX_INPUT_LENGTH) {
      text = text.slice(0, DataCleaner.MAX_INPUT_LENGTH)
    }

    const combined = /^(?:I\s+(?:agree|see|understand|noticed|think)|(?:Good|Great|Excellent|Perfect|Nice)\s+(?:point|catch|job|work)|You'?re\s+(?:right|correct|wrong|missing)|Let\s+me\s+(?:fix|revise|update|clarify|explain|add)|(?:Fixed|Updated|Revised|Added|Changed|Modified)\s+as\s+(?:requested|suggested)|I'?ve\s+(?:fixed|updated|revised|added|changed)|Here['']s\s+(?:my|the)\s+(?:revised|updated|fixed)|APPROVED:.*|\d+[.)]\s+(?:In)?valid\s+(?:point|observation|critique)|Thank\s+(?:you|sir|ma'am)|You\s+make\s+a\s+good\s+point).*$/gim

    text = text.replace(combined, "")
    text = text.replace(/\n{3,}/g, "\n\n")

    return text.trim()
  }

  private tryParseJSON(content: string): unknown | null {
    try {
      return JSON.parse(content)
    } catch {
      const match = content.match(/```(?:json)?\s*\n?([\s\S]*?)\s*\n?```/)
      if (match) {
        try {
          return JSON.parse(match[1])
        } catch {
          return null
        }
      }
      return null
    }
  }
}
