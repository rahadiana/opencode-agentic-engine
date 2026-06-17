import type { LLMEngine } from "./llm.js"

export interface DebateConfig {
  /** The task to analyze/debate */
  task: string
  /** Additional context (data, files, previous work) */
  context?: string
  /** Maximum debate rounds (default: 3) */
  maxRounds?: number
  /** Output format: "markdown" or "json" (default: "json") */
  format?: "markdown" | "json"
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
}

const EXECUTOR_PROMPT = `You are an **executor agent**. Your job is to produce a thorough, well-structured analysis or implementation based on the given task and context.

Rules:
1. Be thorough and specific — include numbers, facts, and concrete details
2. Structure your output clearly (headings, lists, tables as needed)
3. If data is provided, reference it directly — do NOT make up numbers
4. After receiving critic feedback, address EVERY issue raised

Output your analysis below.`

const CRITIC_PROMPT = `You are a **critic agent** (QA/quality control). Your job is to rigorously review the executor's output and find ANY issues.

Check for:
1. **Factual errors** — numbers that don't add up, contradictory statements
2. **Logic holes** — missing steps, non-sequiturs, incomplete reasoning
3. **Vagueness** — statements that are too generic or lack specifics
4. **Structure problems** — poor organization, missing sections
5. **Assumptions** — unstated assumptions that should be made explicit

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
    const rounds: DebateRound[] = []
    let currentDraft = ""
    let approved = false
    let approvalMessage = ""

    for (let round = 1; round <= maxRounds; round++) {
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
        const draftResp = await this.llmEngine.call({
          systemPrompt: EXECUTOR_PROMPT,
          userPrompt: executorInput,
          temperature: 0.3,
          maxTokens: 4096,
        })
        draft = draftResp.content
      } catch (error) {
        logParseError("executor call", error)
        // Short-circuit: don't continue debate with an error string as draft
        issues = [`Executor failed: ${error}`]
        break
      }

      // ── Step 2: Critic reviews ──
      let review = ""
      try {
        const criticResp = await this.llmEngine.call({
          systemPrompt: CRITIC_PROMPT,
          userPrompt: `Executor's output for task "${config.task}":\n\n${draft}\n\nReview this output. If APPROVED, respond with "APPROVED: (message)". Otherwise list all issues.`,
          temperature: 0.2,
          maxTokens: 2048,
        })
        review = criticResp.content

        // Check if approved
        const approveMatch = review.match(/^APPROVED:\s*(.+)/im)
        if (approveMatch) {
          approved = true
          approvalMessage = approveMatch[1].trim()
        } else {
          // Extract issues from review
          const issueLines = review
            .split("\n")
            .filter(l => /^\d+[\.\)]/.test(l.trim()) || l.trim().startsWith("-") || l.toLowerCase().includes("issue") || l.toLowerCase().includes("problem") || l.toLowerCase().includes("error") || l.toLowerCase().includes("missing"))
            .map(l => l.trim())
            .filter(l => l.length > 10)
          issues = issueLines.length > 0 ? issueLines : [review.slice(0, 500)]
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
      const cleanResp = await this.llmEngine.call({
        systemPrompt: CLEANER_PROMPT,
        userPrompt: `Format: ${format}\n\nTask: ${config.task}\n\nFinal analysis to clean:\n\n${currentDraft}\n\nOutput the cleaned version in ${format} format.`,
        temperature: 0.1,
        maxTokens: 4096,
      })
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
  }
}

export function formatDebateResult(result: DebateResult): string {
  const status = result.approved ? "✅ Approved" : "❌ Not approved"
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
      lines.push(`**✅ Approved**`)
      const approveMatch = round.review.match(/^APPROVED:\s*(.+)/im)
      if (approveMatch) lines.push(`> ${approveMatch[1].trim()}`)
    }
  }

  return lines.join("\n")
}
