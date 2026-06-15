/** Minimal LLM interface — avoids importing the full LLMEngine */
export interface ErrorAnalyzerLLM {
  call(req: { systemPrompt: string; userPrompt: string; temperature?: number }): Promise<{ content: string }>
}

export interface ErrorAnalysis {
  category: "compile" | "type" | "test" | "import" | "runtime" | "unknown"
  summary: string
  likelyRootCause: string
  suggestedFix: string
  affectedFiles: string[]
  severity: "low" | "medium" | "high" | "critical"
}

export class ErrorAnalyzer {
  private llm: ErrorAnalyzerLLM | null = null

  /** Inject an LLM engine for asynchronous fallback analysis. */
  setLLM(llm: ErrorAnalyzerLLM): void {
    this.llm = llm
  }

  /** Check whether an LLM is configured for fallback. */
  hasLLM(): boolean {
    return this.llm !== null
  }

  /**
   * Synchronous rule-based analysis. Fast and dependency-free.
   * For ambiguous errors, returns category:"unknown".
   */
  analyze(errorMessage: string, modifiedFiles: string[]): ErrorAnalysis {
    const msg = errorMessage.toLowerCase()

    if (msg.includes("cannot find module") || msg.includes("module not found") || msg.includes("could not resolve")) {
      const match = errorMessage.match(/['"]([@\w\-/.]+)['"]/)
      return {
        category: "import",
        summary: "Missing module or broken import",
        likelyRootCause: `The module ${match?.[1] ?? "imported"} could not be resolved. Check the import path or install the dependency.`,
        suggestedFix: `Verify the import statement is correct. If it's an npm package, run: npm install ${match?.[1] ?? ""}`,
        affectedFiles: modifiedFiles,
        severity: "critical",
      }
    }

    if (msg.includes("type") && (msg.includes("is not assignable") || msg.includes("has no") || msg.includes("does not exist on type"))) {
      return {
        category: "type",
        summary: "TypeScript type error",
        likelyRootCause: "A type mismatch or missing property was introduced by recent changes.",
        suggestedFix: "Check the type annotations on recently modified code. Ensure function signatures, interfaces, and type imports match.",
        affectedFiles: modifiedFiles,
        severity: "high",
      }
    }

    if (msg.includes("error ts") || msg.includes("compilation failed") || msg.includes("syntax error")) {
      return {
        category: "compile",
        summary: "Code fails to compile",
        likelyRootCause: "Syntax errors, missing imports, or broken references in recently modified files.",
        suggestedFix: "Run the compiler to see exact line numbers. Check the most recently modified files first.",
        affectedFiles: modifiedFiles,
        severity: "high",
      }
    }

    if (msg.includes("test") && (msg.includes("failed") || msg.includes("assert") || msg.includes("expect"))) {
      return {
        category: "test",
        summary: "Test assertion failure",
        likelyRootCause: "A code change broke existing behavior or the test expectations are outdated.",
        suggestedFix: "Review the failing test assertions. Either the code change introduced a bug, or the test needs to be updated to match new behavior.",
        affectedFiles: modifiedFiles,
        severity: "medium",
      }
    }

    if (msg.includes("error") && (msg.includes("throw") || msg.includes("cannot") || msg.includes("undefined") || msg.includes("null"))) {
      return {
        category: "runtime",
        summary: "Runtime error detected",
        likelyRootCause: "A code path is hitting an unexpected state — possibly null/undefined access, missing guard, or unhandled edge case.",
        suggestedFix: "Add defensive checks (null guards, try/catch) at the point of failure. Consider adding input validation.",
        affectedFiles: modifiedFiles,
        severity: "high",
      }
    }

    return {
      category: "unknown",
      summary: "Unclassified error",
      likelyRootCause: "The error message does not match known patterns. Manual investigation needed.",
      suggestedFix: "Read the full error output carefully. Compare against the last successful state of the codebase.",
      affectedFiles: modifiedFiles,
      severity: "medium",
    }
  }

  /**
   * Asynchronous LLM-enhanced analysis.
   * Tries rule-based first; if unknown AND LLM is available, asks the LLM
   * to classify the error and suggest a fix.
   */
  async analyzeDeep(errorMessage: string, modifiedFiles: string[]): Promise<ErrorAnalysis> {
    // Try rule-based first
    const ruleResult = this.analyze(errorMessage, modifiedFiles)
    if (ruleResult.category !== "unknown" || !this.llm) {
      return ruleResult
    }

    // LLM fallback for unknown errors
    try {
      const resp = await this.llm.call({
        systemPrompt: `You are an expert error analyzer for software engineering.
Given an error message, classify it into one category: compile, type, test, import, runtime, or unknown.
Then provide:
1. A short summary of the error
2. The likely root cause (1-2 sentences)
3. A specific, actionable suggested fix
4. Severity: low, medium, high, or critical

Return your answer as JSON with fields: category, summary, likelyRootCause, suggestedFix, severity.
Only return valid JSON, no other text.`,
        userPrompt: `Error message:
\`\`\`
${errorMessage.slice(0, 2000)}
\`\`\`

Modified files:
${modifiedFiles.map(f => `- ${f}`).join("\n")}`,
        temperature: 0.1,
      })

      const cleaned = resp.content.trim()
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        const validCategories = ["compile", "type", "test", "import", "runtime", "unknown"]
        return {
          category: validCategories.includes(parsed.category) ? parsed.category : "unknown",
          summary: parsed.summary ?? "LLM-analyzed error",
          likelyRootCause: parsed.likelyRootCause ?? parsed.rootCause ?? "Could not determine root cause",
          suggestedFix: parsed.suggestedFix ?? parsed.fix ?? "Could not determine fix",
          affectedFiles: modifiedFiles,
          severity: ["low", "medium", "high", "critical"].includes(parsed.severity) ? parsed.severity : "medium",
        }
      }
    } catch {
      // LLM fallback failed — return original unknown result
    }

    return ruleResult
  }
}
