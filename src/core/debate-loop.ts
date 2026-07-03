import type { LLMEngine } from "./llm.js"
import type { AgentRuntime, AgentContext } from "../agents/agent-runtime.js"
import { TimeoutError } from "./errors.js"
import { createLogger } from "../observability/logger.js"
import { combinedAbort } from "./dag-helpers.js"

const log = createLogger("DebateLoop")

export interface DebateConfig {
  /** The task to analyze/debate */
  task: string
  /** Additional context (data, files, previous work) */
  context?: string
  /** Maximum debate rounds (default: 3) */
  maxRounds?: number
  /** Output format: "markdown" or "json" (default: "json") */
  format?: "markdown" | "json"
  /** Session ID — required when using AgentRuntime sub-agent mode */
  sessionId?: string
  /** Model override untuk Executor (default: resolved via tool context) */
  executorModel?: { providerID: string; modelID: string }
  /** Model override untuk Critic (default: resolved via tool context) */
  criticModel?: { providerID: string; modelID: string }
  /** Model override untuk Cleaner (default: resolved via tool context) */
  cleanerModel?: { providerID: string; modelID: string }
  /** Reasoning effort untuk executor (o-series, GPT-5) */
  executorReasoning?: 'low' | 'medium' | 'high'
  /** Reasoning effort untuk critic */
  criticReasoning?: 'low' | 'medium' | 'high'
  /**
   * Verbose mode — tampilkan setiap round secara real-time via console.log
   * dan include full debate transcript dalam output.
   * Default: false (hanya final output).
   */
  verbose?: boolean
  /** AbortSignal to cancel a long-running debate */
  signal?: AbortSignal
  /**
   * Total timeout for entire debate loop (default: 120000ms = 120s).
   * Prevents unbounded execution.
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
  /** Error message if LLM unavailable */
  error?: string
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

const NO_LLM_RESPONSE = "⚠️ **LLM tidak tersedia.** Debate membutuhkan akses LLM untuk sub-agent executor dan critic. Jalankan perintah ini di dalam OpenCode yang memiliki akses LLM, atau gunakan `agentic_plan` + `agentic_execute` untuk workflow manual."
const NO_LLM_PREFIX = "[NO_LLM]"

/** Check if an LLM response indicates LLM unavailability */
function isNoLlm(output: string): boolean {
  return output.startsWith(NO_LLM_PREFIX) || output.startsWith("LLM error") || output.startsWith("LLM call failed")
}

function logParseError(context: string, error: unknown): void {
  if (process.env.DEBUG_AGENTIC) {
    log.error(`[DebateLoop] ${context}: ${String(error)}`)
  }
}

export class DebateLoop {
  constructor(
    private llmEngine: LLMEngine,
    private agentRuntime?: AgentRuntime,
  ) {}

  async execute(config: DebateConfig): Promise<DebateResult> {
    const maxRounds = config.maxRounds ?? 2
    const format = config.format ?? "json"
    const totalTimeoutMs = config.totalTimeoutMs ?? 240_000 // 4m — enough for executor (45s) + critic (90s) + retries + round 2
    const rounds: DebateRound[] = []
    let currentDraft = ""
    let approved = false
    let approvalMessage = ""

    // ── Total timeout wrapper ──
    const totalController = new AbortController()
    const totalTimeoutId = setTimeout(() => totalController.abort(), totalTimeoutMs)
    const effectiveSignal = config.signal
      ? combinedAbort(config.signal, totalController.signal)
      : totalController.signal

    try {
      if (config.verbose) {
        log.debug(`\n━━━ Debate: "${config.task}" ━━━`)
        log.debug(`Max rounds: ${maxRounds} | Format: ${format} | Timeout: ${totalTimeoutMs}ms`)
        log.debug(`Sub-agent mode: ${this.agentRuntime ? "✅ AgentRuntime" : "❌ direct llm (fallback)"}`)
      }

      for (let round = 1; round <= maxRounds; round++) {
        // Check for cancellation between rounds
        if (effectiveSignal.aborted) {
          if (config.verbose) log.debug(`\n⚠️ Debate cancelled at round ${round}`)
          return {
            task: config.task, totalRounds: round - 1, approved: false,
            rounds, finalOutput: "", revisionSummary: `Debate cancelled (${config.signal?.aborted ? "external signal" : `total timeout ${totalTimeoutMs}ms exceeded`})`, aborted: true,
          }
        }

        if (config.verbose) log.debug(`\n── Round ${round}/${maxRounds} ──`)

        // ── Step 1: Executor produces draft (or revises based on feedback) ──
        let executorInput: string
        if (round === 1) {
          executorInput = `Task: ${config.task}\n\nContext:\n${config.context || "(no additional context)"}\n\nProduce a thorough analysis.`
        } else {
          const prevRound = rounds[rounds.length - 1]
          executorInput = `Task: ${config.task}\n\nContext:\n${config.context || "(no additional context)"}\n\nYour previous draft had the following issues that MUST be fixed:\n${prevRound.issues.map((i, idx) => `${idx + 1}. ${i}`).join("\n")}\n\nCritic feedback:\n${prevRound.review}\n\nRevise your analysis addressing ALL issues above.`
        }

        const executorResult = await this.callExecutor(config, executorInput, round, effectiveSignal)
        if (executorResult.error) {
          return {
            task: config.task, totalRounds: round - 1, approved: false,
            rounds, finalOutput: "", revisionSummary: "Executor LLM unavailable",
            error: executorResult.error,
          }
        }
        const draft = executorResult.output
        if (config.verbose) {
          log.debug(`\n┃ [Executor] Draft produced (${draft.length} chars):`)
          log.debug(`┃ ${draft.slice(0, 300)}${draft.length > 300 ? "..." : ""}`)
          if (draft.length > 300) log.debug(`┃ ... (${draft.length - 300} more chars)`)
        }

        // Auto-detect loop: identical output as previous round
        if (round > 1) {
          const prevDraft = rounds[rounds.length - 1].draft
          const similarity = (draft.length > 0 && prevDraft.length > 0)
            ? 1 - (levenshteinDistance(draft, prevDraft) / Math.max(draft.length, prevDraft.length))
            : 0
          if (similarity > 0.95) {
            if (config.verbose) log.debug(`\n┃ ⚠️ [Auto-Break] Draft ${(similarity * 100).toFixed(0)}% similar to previous round — loop detected`)
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
        const criticResult = await this.callCritic(config, draft, round, effectiveSignal)
        if (criticResult.error) {
          return {
            task: config.task, totalRounds: round - 1, approved: false,
            rounds, finalOutput: draft, revisionSummary: "Critic LLM unavailable",
            error: criticResult.error,
          }
        }
        const review = criticResult.output
        let issues: string[] = []
        if (config.verbose) {
          log.debug(`\n┃ [Critic] Review produced (${review.length} chars):`)
          log.debug(`┃ ${review.slice(0, 300)}${review.length > 300 ? "..." : ""}`)
          if (review.length > 300) log.debug(`┃ ... (${review.length - 300} more chars)`)
        }

        // Check if approved
        const approveMatch = review.match(/^APPROVED:\s*(.+)/im)
        if (approveMatch) {
          approved = true
          approvalMessage = approveMatch[1].trim()
        } else {
          const issueLines = review
            .split("\n")
            .filter(l => /^\d+[.)]/.test(l.trim()) || /^(?:-|\*)\s+(?:Issue|Problem|Error|Missing|Fix)/i.test(l.trim()))
            .map(l => l.trim().replace(/^[-*\d.)\s]+/, ""))
            .filter(l => l.length > 10)
          issues = issueLines.length > 0 ? issueLines : (review.length > 50 ? [review.slice(0, 500)] : [])
        }

        rounds.push({
          round,
          draft,
          review,
          approved,
          issues: approved ? [] : issues,
        })

        if (config.verbose) {
          const status = approved ? "✅ Approved" : `⚠️ ${issues.length} issue(s)`
          log.debug(`\n┃ [Round ${round}] ${status}`)
          if (!approved && issues.length > 0) {
            log.debug(`┃ Issues:`)
            for (const issue of issues.slice(0, 5)) {
              log.debug(`┃   • ${issue.slice(0, 200)}`)
            }
            if (issues.length > 5) log.debug(`┃   ... and ${issues.length - 5} more`)
          }
        }

        currentDraft = draft
        if (approved) break
      }

      // ── Step 3: Clean the final output ──
      let finalOutput = currentDraft
      if (config.verbose) log.debug(`\n── Cleaner ──`)
      try {
        const cleanController = new AbortController()
        const cleanTimeoutId = setTimeout(() => cleanController.abort(), 30_000)
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

      if (config.verbose) {
        log.debug(`\n━━━ Debate Complete ━━━`)
        log.debug(`Status: ${approved ? "✅ Approved" : "⚠️ Not fully resolved"}`)
        log.debug(`Rounds: ${rounds.length}`)
        log.debug(`Revision: ${revisionSummary}`)
        if (config.signal?.aborted) log.debug(`Cancelled: external signal`)
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

  /**
   * Call the executor role — uses AgentRuntime sub-agent when available,
   * falls back to direct llmEngine.call() for backward compat.
   */
  private async callExecutor(
    config: DebateConfig,
    input: string,
    round: number,
    signal: AbortSignal,
  ): Promise<{ output: string; error?: string }> {
    const MAX_RETRIES = 1 // max 2 attempts per call
    const PER_CALL_TIMEOUT = 45_000
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      // Primary path: direct llmEngine.call() — uses parent engine's real session.
      // AgentRuntime sub-engine path (below) uses synthetic session IDs that may
      // not correspond to valid OpenCode sessions, causing [NO_LLM] fallback.
      if (!this.agentRuntime || !config.sessionId) {
        // No agentRuntime available — use direct call only
        const directResult = await this._directExecutorCall(config, input, round, signal, PER_CALL_TIMEOUT)
        if (!directResult.error) return directResult
        if (attempt < MAX_RETRIES) {
          await sleep(Math.min(1000 * Math.pow(2, attempt), 4000))
          continue
        }
        return directResult
      }

      // Try direct llmEngine.call() first (parent engine has a valid session)
      const directResult = await this._directExecutorCall(config, input, round, signal, PER_CALL_TIMEOUT)
      if (!directResult.error) return directResult

      // Fallback: AgentRuntime sub-engine (isolated context, but needs temp session support)
      const ctx: AgentContext = {
        systemPrompt: EXECUTOR_PROMPT,
        sessionId: config.sessionId,
        role: 'debate-executor',
        taskDescription: input,
        modelPreference: config.executorModel
          ? `${config.executorModel.providerID}/${config.executorModel.modelID}`
          : undefined,
        reasoningEffort: config.executorReasoning,
        timeoutMs: PER_CALL_TIMEOUT,
      }
      const result = await this.agentRuntime.execute(ctx)
      if (!result.success || isNoLlm(result.output)) {
        if (attempt < MAX_RETRIES) {
          await sleep(Math.min(1000 * Math.pow(2, attempt), 4000))
          continue
        }
        return { output: '', error: result.error || directResult.error || NO_LLM_RESPONSE }
      }
      return { output: result.output }
    }
    /* istanbul ignore next — unreachable, type checker comfort */
    return { output: '', error: 'Executor: max retries exceeded' }
  }

  /** Direct LLM call via parent engine (has real OpenCode session). */
  private async _directExecutorCall(
    config: DebateConfig,
    input: string,
    round: number,
    signal: AbortSignal,
    perCallTimeout: number,
  ): Promise<{ output: string; error?: string }> {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), perCallTimeout)
      const resp = await Promise.race([
        this.llmEngine.call({
          systemPrompt: EXECUTOR_PROMPT,
          userPrompt: input,
          temperature: 0.2,
          maxTokens: 4096,
          bypassCache: round > 1,
          model: config.executorModel,
          toolName: 'debate-executor',
          signal,
          timeoutMs: perCallTimeout,
        }),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener("abort", () => {
            reject(new TimeoutError("LLM call", perCallTimeout))
          })
        }),
      ])
      clearTimeout(timeoutId)
      if (isNoLlm(resp.content)) {
        return { output: '', error: NO_LLM_RESPONSE }
      }
      return { output: resp.content }
    } catch (error) {
      logParseError("executor direct call", error)
      return { output: '', error: `Executor call failed: ${error}` }
    }
  }

  /**
   * Call the critic role — tries direct llmEngine.call() first (parent engine
   * has a valid session), falls back to AgentRuntime sub-agent for isolation.
   */
  private async callCritic(
    config: DebateConfig,
    draft: string,
    round: number,
    signal: AbortSignal,
  ): Promise<{ output: string; error?: string }> {
    // Truncate long drafts so critic doesn't timeout — 8000 chars is enough to evaluate
    const MAX_DRAFT_CHARS = 8000
    const truncatedDraft = draft.length > MAX_DRAFT_CHARS
      ? draft.slice(0, MAX_DRAFT_CHARS) + `\n\n[...truncated from ${draft.length} chars — reviewing first ${MAX_DRAFT_CHARS} chars]`
      : draft
    const criticInput = `Executor's output for task "${config.task}":\n\n${truncatedDraft}\n\nReview this output. If APPROVED, respond with "APPROVED: (message)". Otherwise list all issues.`

    const MAX_RETRIES = 1
    const PER_CALL_TIMEOUT = 90_000
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      // Primary path: direct llmEngine.call() — parent engine has real session
      if (!this.agentRuntime || !config.sessionId) {
        const directResult = await this._directCriticCall(config, criticInput, round, signal, PER_CALL_TIMEOUT)
        if (!directResult.error) return directResult
        if (attempt < MAX_RETRIES) {
          await sleep(Math.min(1000 * Math.pow(2, attempt), 4000))
          continue
        }
        return directResult
      }

      // Try direct call first (has valid session)
      const directResult = await this._directCriticCall(config, criticInput, round, signal, PER_CALL_TIMEOUT)
      if (!directResult.error) return directResult

      // Fallback: AgentRuntime sub-engine (isolated context)
      const ctx: AgentContext = {
        systemPrompt: CRITIC_PROMPT,
        sessionId: config.sessionId,
        role: 'debate-critic',
        taskDescription: criticInput,
        modelPreference: config.criticModel
          ? `${config.criticModel.providerID}/${config.criticModel.modelID}`
          : undefined,
        reasoningEffort: config.criticReasoning,
        timeoutMs: PER_CALL_TIMEOUT,
      }
      const result = await this.agentRuntime.execute(ctx)
      if (!result.success || isNoLlm(result.output)) {
        if (attempt < MAX_RETRIES) {
          await sleep(Math.min(1000 * Math.pow(2, attempt), 4000))
          continue
        }
        return { output: '', error: result.error || directResult.error || NO_LLM_RESPONSE }
      }
      return { output: result.output }
    }
    /* istanbul ignore next — unreachable, type checker comfort */
    return { output: '', error: 'Critic: max retries exceeded' }
  }

  /** Direct critic LLM call via parent engine (has real OpenCode session). */
  private async _directCriticCall(
    config: DebateConfig,
    criticInput: string,
    round: number,
    signal: AbortSignal,
    perCallTimeout: number,
  ): Promise<{ output: string; error?: string }> {
    try {
      const criticController = new AbortController()
      const criticTimeoutId = setTimeout(() => criticController.abort(), perCallTimeout)
      const resp = await Promise.race([
        this.llmEngine.call({
          systemPrompt: CRITIC_PROMPT,
          userPrompt: criticInput,
          temperature: 0.2,
          maxTokens: 2048,
          bypassCache: round > 1,
          model: config.criticModel,
          toolName: 'debate-critic',
          signal,
          timeoutMs: perCallTimeout,
        }),
        new Promise<never>((_, reject) => {
          criticController.signal.addEventListener("abort", () => {
            reject(new TimeoutError("Critic LLM call", perCallTimeout))
          })
        }),
      ])
      clearTimeout(criticTimeoutId)
      if (isNoLlm(resp.content)) {
        return { output: '', error: NO_LLM_RESPONSE }
      }
      return { output: resp.content }
    } catch (error) {
      logParseError("critic direct call", error)
      return { output: '', error: `Critic call failed: ${error}` }
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

/** Minimal sleep for retry backoff */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
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
