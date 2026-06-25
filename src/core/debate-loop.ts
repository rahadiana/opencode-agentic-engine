import type { LLMEngine } from "./llm.js"
import { TimeoutError } from "./errors.js"

export interface DebateConfig {
  /** The task to analyze/debate */
  task: string
  /** Additional context (data, files, previous work) */
  context?: string
  /** Maximum debate rounds (default: 3) */
  maxRounds?: number
  /** Output format: "markdown" or "json" (default: "json") */
  format?: "markdown" | "json"
  /** Model override untuk Executor (default: resolved via tool context) */
  executorModel?: { providerID: string; modelID: string }
  /** Model override untuk Critic (default: resolved via tool context) */
  criticModel?: { providerID: string; modelID: string }
  /** Model override untuk Cleaner (default: resolved via tool context) */
  cleanerModel?: { providerID: string; modelID: string }
  /** AbortSignal to cancel a long-running debate */
  signal?: AbortSignal
  /**
   * Total timeout for entire debate loop (default: 120000ms = 120s).
   * Per Graph Harness §6.2 & Omnigent: every bounded process needs a total circuit breaker.
   * Prevents 660s worst-case (3 rounds × (60s executor + 120s critic) + 120s cleaner).
   */
  totalTimeoutMs?: number
}

export interface DebateRound {
  round: number
  draft: string
  review: string
  approved: boolean
  issues: string[]
}

export interface DebateResult {
  task: string
  totalRounds: number
  approved: boolean
  rounds: DebateRound[]
  /** Clean final output — no debate history, just the result */
  finalOutput: string
  /** Summary of what changed between rounds */
  revisionSummary: string
  /** Whether the debate was cancelled via AbortSignal */
  aborted?: boolean
}

const EXECUTOR_PROMPT = `You are an **executor agent**. Your job is to produce a thorough, well-structured analysis or implementation based on the given task and context.

CRITICAL RULE: You MUST produce the actual analysis/implementation directly. Do NOT write meta-commentary like "I will now analyze..." or "Here is my analysis:" — just write the analysis itself. Do NOT describe what you're going to do — DO it.

Rules:
1. Be thorough and specific — include numbers, facts, and concrete details
2. Structure your output clearly (headings, lists, tables as needed)
3. If data is provided, reference it directly — do NOT make up numbers
4. After receiving critic feedback, address EVERY issue raised
5. Start your response with the actual content, NOT meta-commentary

Output your analysis below — start NOW with the actual content:`

const CRITIC_PROMPT = `You are a **critic agent** (QA/quality control). Your job is to rigorously review the executor's output and find ANY issues.

Check for:
1. **Meta-commentary** — output that says "I will now analyze..." instead of actually analyzing. This is an automatic REJECT.
2. **Factual errors** — numbers that don't add up, contradictory statements
3. **Logic holes** — missing steps, non-sequiturs, incomplete reasoning
4. **Vagueness** — statements that are too generic or lack specifics
5. **Structure problems** — poor organization, missing sections
6. **Assumptions** — unstated assumptions that should be made explicit

For each issue found:
- State WHAT the issue is
- Explain WHY it's a problem
- Suggest HOW to fix it

If the output is COMPLETELY SATISFACTORY (no issues or only trivial ones), respond with EXACTLY:
APPROVED: (your brief sign-off message)

Otherwise, list all issues clearly.`

const CLEANER_PROMPT = `You are a **data cleaner**. Your job is to take the final approved analysis and reformat it into a clean, structured output.

Rules:
1. Remove ALL debate/debugging artifacts — no "I agree", "Good point", "Let me fix", etc.
2. Keep ONLY the substantive content — facts, analysis, conclusions
3. If format is "json", output a well-structured JSON object
4. If format is "markdown", output clean markdown with proper headings
5. Preserve ALL factual content — do not add or remove information

Output the cleaned version only.`

function logParseError(context: string, error: unknown): void {
  if (process.env.DEBUG_AGENTIC) {
    console.error(`[DebateLoop] ${context}:`, error)
  }
}

export class DebateLoop {
  constructor(private llmEngine: LLMEngine) {}

  async execute(config: DebateConfig): Promise<DebateResult> {
    const maxRounds = config.maxRounds ?? 2
    const format = config.format ?? "json"
    const totalTimeoutMs = config.totalTimeoutMs ?? 120_000 // 120s total (Graph Harness §6.2)
    const rounds: DebateRound[] = []
    let currentDraft = ""
    let approved = false
    let approvalMessage = ""

    // ── Total timeout wrapper (Graph Harness §6.2, Omnigent) ──
    // Prevents 660s worst-case by bounding the entire debate at totalTimeoutMs.
    // Uses AbortController + clearTimeout pattern (P0 compliant).
    const totalController = new AbortController()
    const totalTimeoutId = setTimeout(() => totalController.abort(), totalTimeoutMs)
    const effectiveSignal = config.signal
      ? combinedAbort(config.signal, totalController.signal)
      : totalController.signal

    try {
      for (let round = 1; round <= maxRounds; round++) {
        // Check for cancellation between rounds
        if (effectiveSignal.aborted) {
          return {
            task: config.task, totalRounds: round - 1, approved: false,
            rounds, finalOutput: "", revisionSummary: `Debate cancelled (${config.signal?.aborted ? "external signal" : `total timeout ${totalTimeoutMs}ms exceeded`})`, aborted: true,
          }
        }

      // ── Step 1: Executor produces draft (or revises based on feedback) ──
      let executorInput: string
      if (round === 1) {
        executorInput = `Task: ${config.task}\n\nContext:\n${config.context || "(no additional context)"}\n\nProduce a thorough analysis.`
      } else {
        const prevRound = rounds[rounds.length - 1]
        executorInput = `Task: ${config.task}\n\nContext:\n${config.context || "(no additional context)"}\n\nYour previous draft had the following issues that MUST be fixed:\n${prevRound.issues.map((i, idx) => `${idx + 1}. ${i}`).join("\n")}\n\nCritic feedback:\n${prevRound.review}\n\nRevise your analysis addressing ALL issues above.`
      }

      let draft = ""
      let issues: string[] = []
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 60_000)
        const draftResp = await Promise.race([
          this.llmEngine.call({
            systemPrompt: EXECUTOR_PROMPT,
            userPrompt: executorInput,
            temperature: 0.2,
            maxTokens: 4096,
            bypassCache: round > 1,
            model: config.executorModel,
            toolName: 'debate-executor',
          }),
          new Promise<never>((_, reject) => {
            controller.signal.addEventListener("abort", () => {
              reject(new TimeoutError("LLM call", 60000))
            })
          }),
        ])
        clearTimeout(timeoutId)
        draft = draftResp.content
      } catch (error) {
        logParseError("executor call", error)
        // Short-circuit: don't continue debate with an error string as draft
        issues = [`Executor failed: ${error}`]
        break
      }

      if (round > 1) {
        const prevDraft = rounds[rounds.length - 1].draft
        const similarity = (draft.length > 0 && prevDraft.length > 0)
          ? 1 - (levenshteinDistance(draft, prevDraft) / Math.max(draft.length, prevDraft.length))
          : 0
        if (similarity > 0.95) {
          rounds.push({
            round,
            draft,
            review: "AUTO-BREAK: Executor produced nearly identical output as previous round. Loop detected.",
            approved: false,
            issues: ["Output >95% similar to previous round -- loop detected, debate terminated"],
          })
          break
        }
      }

      // ── Step 2: Critic reviews ──
      let review = ""
      try {
        const criticController = new AbortController()
        const criticTimeoutId = setTimeout(() => criticController.abort(), 45_000) // 45s timeout (STEM Agent §timeout)
        const criticResp = await Promise.race([
          this.llmEngine.call({
            systemPrompt: CRITIC_PROMPT,
            userPrompt: `Executor's output for task "${config.task}":\n\n${draft}\n\nReview this output. If APPROVED, respond with "APPROVED: (message)". Otherwise list all issues.`,
            temperature: 0.2,
            maxTokens: 2048,
            bypassCache: round > 1, // Skip cache for revision rounds
            model: config.criticModel,
            toolName: 'debate-critic',
          }),
          new Promise<never>((_, reject) => {
            criticController.signal.addEventListener("abort", () => {
              reject(new TimeoutError("Critic LLM call", 45000))
            })
          }),
        ])
        clearTimeout(criticTimeoutId)
        review = criticResp.content

        // Check if approved
        const approveMatch = review.match(/^APPROVED:\s*(.+)/im)
        if (approveMatch) {
          approved = true
          approvalMessage = approveMatch[1].trim()
        } else {
          const issueLines = review
            .split("\n")
            .filter(l => /^\d+[.)]/.test(l.trim()) || /^(?:-|\*)\s+(?:Issue|Problem|Error|Missing|Fix)/i.test(l.trim()))
            .map(l => l.trim().replace(/^[-\*\d.)\s]+/, ""))
            .filter(l => l.length > 10)
          issues = issueLines.length > 0 ? issueLines : (review.length > 50 ? [review.slice(0, 500)] : [])
        }
      } catch (error) {
        logParseError("critic call", error)
        review = `[Error generating critique: ${error}]`
        issues = ["Critique generation failed — manual review needed"]
      }

      rounds.push({
        round,
        draft,
        review,
        approved,
        issues: approved ? [] : issues,
      })

      currentDraft = draft
      if (approved) break
    }

    // ── Step 3: Clean the final output ──
    let finalOutput = currentDraft
    try {
      const cleanController = new AbortController()
      const cleanTimeoutId = setTimeout(() => cleanController.abort(), 30_000) // 30s timeout (STEM Agent §timeout)
      const cleanResp = await Promise.race([
        this.llmEngine.call({
          systemPrompt: CLEANER_PROMPT,
          userPrompt: `Format: ${format}\n\nTask: ${config.task}\n\nFinal analysis to clean:\n\n${currentDraft}\n\nOutput the cleaned version in ${format} format.`,
          temperature: 0.1,
          maxTokens: 4096,
          model: config.cleanerModel,
          toolName: 'debate-cleaner',
        }),
        new Promise<never>((_, reject) => {
          cleanController.signal.addEventListener("abort", () => {
            reject(new TimeoutError("Cleaner LLM call", 30000))
          })
        }),
      ])
      clearTimeout(cleanTimeoutId)
      finalOutput = cleanResp.content
    } catch (error) {
      logParseError("cleaner call", error)
      // Use draft as-is if cleaning fails
    }

    // ── Build revision summary ──
    let revisionSummary = ""
    if (rounds.length <= 1) {
      revisionSummary = approved ? "Approved in first round — no revisions needed" : "Single round (max rounds reached)"
    } else {
      const totalIssues = rounds.slice(0, -1).reduce((sum, r) => sum + r.issues.length, 0)
      const finalStatus = approved ? "approved" : "max rounds reached"
      revisionSummary = `${rounds.length} rounds, ${totalIssues} issues raised, ${finalStatus}${approvalMessage ? `: ${approvalMessage}` : ""}`
    }

    return {
      task: config.task,
      totalRounds: rounds.length,
      approved,
      rounds,
      finalOutput,
      revisionSummary,
    }
      } catch (error) {
        // Total timeout or unexpected error — return partial results
        logParseError("debate execute", error)
        clearTimeout(totalTimeoutId)
        return {
          task: config.task,
          totalRounds: rounds.length,
          approved: false,
          rounds,
          finalOutput: currentDraft,
          revisionSummary: `Debate terminated: ${error instanceof Error ? error.message : String(error)}`,
          aborted: true,
        }
      } finally {
        clearTimeout(totalTimeoutId)
      }
  }
}

export function formatDebateResult(result: DebateResult): string {
  const status = result.approved ? "[Approved]" : "[Not approved]"
  const lines = [
    `## Debate Result: ${result.task}`,
    `**Status:** ${status}`,
    `**Rounds:** ${result.totalRounds}`,
    `**Revision Summary:** ${result.revisionSummary}`,
    ``,
    `### Final Output`,
    result.finalOutput,
    ``,
    `### Debate History (${result.totalRounds} rounds)`,
  ]

  for (const round of result.rounds) {
    lines.push(``)
    lines.push(`#### Round ${round.round}`)
    if (round.issues.length > 0) {
      lines.push(`**Issues raised:**`)
      for (const issue of round.issues) {
        lines.push(`- ${issue}`)
      }
    }
    if (round.approved) {
      lines.push(`**[Approved]**`)
      const approveMatch = round.review.match(/^APPROVED:\s*(.+)/im)
      if (approveMatch) lines.push(`> ${approveMatch[1].trim()}`)
    }
  }

  return lines.join("\n")
}

/** Combine two AbortSignals into one (or-relationship) */
function combinedAbort(sig1: AbortSignal, sig2: AbortSignal): AbortSignal {
  if (sig1.aborted || sig2.aborted) return AbortSignal.abort()
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  sig1.addEventListener("abort", onAbort, { once: true })
  sig2.addEventListener("abort", onAbort, { once: true })
  return controller.signal
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}
