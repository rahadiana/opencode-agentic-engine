import type { ErrorAnalysis } from "./error-analyzer.js"

// ─── Types ────────────────────────────────────────────────────────────

export type RetryStrategy = "direct_fix" | "conservative" | "type_first" | "split_changes"

export interface RetryAttempt {
  attempt: number
  strategy: RetryStrategy
  error: string
  analysis: ErrorAnalysis | null
  rolledBackFiles: string[]
  timestamp: number
}

export interface AutoRetryConfig {
  maxRetries: number
  baseDelayMs: number
  maxDelayMs: number
  enableSelectiveRollback: boolean
}

const STRATEGY_ORDER: RetryStrategy[] = ["direct_fix", "conservative", "type_first", "split_changes"]

// ─── AutoRetryManager ─────────────────────────────────────────────────

/**
 * Mengelola retry loop untuk agentic_auto:
 * - Strategy rotation (setiap attempt pakai pendekatan berbeda)
 * - Exponential backoff dengan jitter
 * - Selective rollback (hanya file yang bermasalah)
 * - Failure context injection ke retry prompt
 */
export class AutoRetryManager {
  private attempts: RetryAttempt[] = []
  private config: AutoRetryConfig

  constructor(config?: Partial<AutoRetryConfig>) {
    this.config = {
      maxRetries: config?.maxRetries ?? 3,
      baseDelayMs: config?.baseDelayMs ?? 500,
      maxDelayMs: config?.maxDelayMs ?? 5000,
      enableSelectiveRollback: config?.enableSelectiveRollback ?? true,
    }
  }

  /** Apakah masih bisa retry */
  canRetry(): boolean {
    return this.attempts.length < this.config.maxRetries
  }

  /** Nomor attempt saat ini (0-indexed) */
  getCurrentAttempt(): number {
    return this.attempts.length
  }

  /** Semua attempt yang sudah dilakukan */
  getAttempts(): RetryAttempt[] {
    return [...this.attempts]
  }

  /** Attempt terakhir */
  getLastAttempt(): RetryAttempt | null {
    return this.attempts.length > 0 ? this.attempts[this.attempts.length - 1] : null
  }

  /** Config saat ini */
  getConfig(): AutoRetryConfig {
    return { ...this.config }
  }

  /** Strategy untuk attempt tertentu — rotation based */
  getStrategyForAttempt(attempt: number): RetryStrategy {
    return STRATEGY_ORDER[attempt % STRATEGY_ORDER.length]
  }

  /** Exponential backoff dengan full jitter */
  getBackoffDelay(attempt: number): number {
    if (attempt <= 0) return 0
    const exponent = Math.min(attempt - 1, 10)
    const baseDelay = this.config.baseDelayMs * Math.pow(2, exponent)
    const maxDelay = Math.min(baseDelay, this.config.maxDelayMs)
    return Math.max(this.config.baseDelayMs, Math.random() * maxDelay)
  }

  private static readonly MAX_ATTEMPTS = 50

  /** Catat attempt yang gagal */
  recordAttempt(error: string, analysis: ErrorAnalysis | null, rolledBackFiles: string[]): void {
    if (this.attempts.length >= AutoRetryManager.MAX_ATTEMPTS) {
      this.attempts.shift()
    }
    const attempt = this.attempts.length
    this.attempts.push({
      attempt,
      strategy: this.getStrategyForAttempt(attempt),
      error,
      analysis,
      rolledBackFiles,
      timestamp: Date.now(),
    })
  }

  /**
   * Selective rollback: dari compile error, extract file paths yang bermasalah.
   * Hanya rollback file-file itu; sisanya tetap.
   */
  getFilesToRollback(
    analysis: ErrorAnalysis | null,
    allModified: string[],
    compileError: string,
  ): string[] {
    if (!this.config.enableSelectiveRollback) return [...allModified]

    const problematicFiles = new Set<string>()

    // 1. Dari error analysis — affectedFiles
    if (analysis?.affectedFiles && analysis.affectedFiles.length > 0) {
      for (const f of analysis.affectedFiles) {
        // Match dengan modified files (partial match)
        const matched = allModified.filter(mf => mf.includes(f) || f.includes(mf))
        for (const m of matched) problematicFiles.add(m)
      }
    }

    // 2. Parse compile error untuk file paths — relatif ke project root
    const filePathRegex = /(?:src\/|lib\/|test\/|app\/|cmd\/|pkg\/|internal\/)[\w./-]+\.(?:ts|js|tsx|jsx|py|go|rs|java|swift|kt)/g
    const errorFiles = compileError.match(filePathRegex)
    if (errorFiles) {
      for (const ef of errorFiles) {
        const matched = allModified.filter(mf => ef.includes(mf) || mf.includes(ef))
        for (const m of matched) problematicFiles.add(m)
      }
    }

    // 3. Dari pola "file 'X'" dalam error
    const fileQuoteRegex = /file\s+['"]([\w./-]+)['"]/gi
    let fqMatch: RegExpExecArray | null
    while ((fqMatch = fileQuoteRegex.exec(compileError)) !== null) {
      const quotedFile = fqMatch[1]
      const matched = allModified.filter(mf => quotedFile.includes(mf) || mf.includes(quotedFile))
      for (const m of matched) problematicFiles.add(m)
    }

    // 4. Dari pola "in X" di TypeScript errors
    const inFileRegex = /in\s+['"]([\w./-]+)['"]/gi
    let infMatch: RegExpExecArray | null
    while ((infMatch = inFileRegex.exec(compileError)) !== null) {
      const inFile = infMatch[1]
      const matched = allModified.filter(mf => inFile.includes(mf) || mf.includes(inFile))
      for (const m of matched) problematicFiles.add(m)
    }

    if (problematicFiles.size === 0) return [...allModified]

    return [...problematicFiles]
  }

  getPreservedFiles(analysis: ErrorAnalysis | null, allModified: string[], compileError: string): string[] {
    const rollback = this.getFilesToRollback(analysis, allModified, compileError)
    return allModified.filter(f => !rollback.includes(f))
  }

  /**
   * Bangun retry prompt dengan failure context injection.
   * Prompt baru menyertakan error analysis untuk informed retry.
   */
  buildRetryPrompt(
    originalGoal: string,
    lastError: string,
    analysis: ErrorAnalysis | null,
    strategy: RetryStrategy,
    successfullyWrittenFiles: string[],
  ): string {
    const attempt = this.attempts.length + 1
    const strategyName = this.getStrategyName(strategy)
    const successfullyWritten = successfullyWrittenFiles.length > 0
      ? `\nFiles that compiled correctly (keep these):\n${successfullyWrittenFiles.map(f => `- ${f}`).join("\n")}`
      : ""

    // Error analysis section
    const analysisBlock = analysis
      ? `
## Error Analysis
- **Category:** ${analysis.category}
- **Summary:** ${analysis.summary}
- **Root Cause:** ${analysis.likelyRootCause}
- **Suggested Fix:** ${analysis.suggestedFix}
- **Severity:** ${analysis.severity}`
      : ""

    // Strategy-specific instructions
    const strategyInstructions = this.getStrategyInstructions(strategy)

    return `## Retry #${attempt}: ${strategyName}

### Original Goal
${originalGoal}

### Previous Error
\`\`\`
${lastError.slice(0, 1500)}
\`\`\`
${analysisBlock}
${successfullyWritten}

### Strategy: ${strategyName}
${strategyInstructions}

IMPORTANT: Only output the files that need to be changed. Do NOT re-output files that already compile correctly.`
  }

  /** Narasi nama strategy */
  private getStrategyName(strategy: RetryStrategy): string {
    switch (strategy) {
      case "direct_fix": return "Direct Fix — perbaiki error langsung"
      case "conservative": return "Conservative — minimal changes, add types"
      case "type_first": return "Type-First — tambah type annotations sebelum logic"
      case "split_changes": return "Split Changes — satu file per perubahan"
    }
  }

  /** Instructions per strategy */
  private getStrategyInstructions(strategy: RetryStrategy): string {
    switch (strategy) {
      case "direct_fix":
        return "Fix the specific errors listed above. Keep all other code as-is."
      case "conservative":
        return "Take a conservative approach:\n1. Add explicit type annotations to ALL declarations\n2. Avoid complex generics or advanced patterns\n3. Keep changes minimal — only what's needed\n4. Verify imports are correct (.js extension for ESM)"
      case "type_first":
        return "Type-first approach:\n1. Define interfaces/types before implementation\n2. Add JSDoc comments for complex functions\n3. Use simple, explicit types\n4. Avoid 'any' — use proper type annotations"
      case "split_changes":
        return "Split into smaller changes:\n1. Change ONE file at a time\n2. Focus on the specific error location\n3. Keep helper functions simple and well-typed\n4. Ensure each file compiles independently"
    }
  }

  /** Reset state untuk session baru */
  reset(): void {
    this.attempts = []
  }

  /** Buat summary untuk output */
  getRetrySummary(): string {
    if (this.attempts.length === 0) return ""
    const total = this.attempts.length
    const lastAnalysis = this.getLastAttempt()?.analysis
    const strategies = this.attempts.map(a => a.strategy).join(" → ")
    return `🔄 Retry: ${total} attempt(s) [${strategies}]${lastAnalysis ? ` — Last error: ${lastAnalysis.category}(${lastAnalysis.severity})` : ""}`
  }
}
