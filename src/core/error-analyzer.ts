import type { DomainRegistry } from "./domain-registry.js"

/** Minimal LLM interface — avoids importing the full LLMEngine */
export interface ErrorAnalyzerLLM {
  call(req: { systemPrompt: string; userPrompt: string; temperature?: number }): Promise<{ content: string }>
}

export interface ErrorAnalysis {
  category: string
  summary: string
  likelyRootCause: string
  suggestedFix: string
  affectedFiles: string[]
  severity: "low" | "medium" | "high" | "critical"
}

/**
 * Hermes-style actionable error — tells the agent (1) what's wrong,
 * (2) why it happened, and (3) exactly how to fix it. Unlike raw
 * ErrorAnalysis, this is formatted for direct consumption by the LLM
 * or user, with concrete file paths, line numbers, and actionable
 * fix instructions.
 */
export interface ActionableError {
  /** Emoji + category label, e.g. "❌ Import Error" */
  badge: string
  /** One-line summary of the failure */
  summary: string
  /** Specific file(s) + line(s) involved */
  location: string
  /** Why it happened — plain language root cause */
  why: string
  /** Step-by-step or specific instruction to resolve */
  fix: string
  /** Severity level */
  severity: "low" | "medium" | "high" | "critical"
  /** Source trace — the original error message (truncated) */
  trace: string
}

// ── Categories with emoji badges — for user-facing error display ──

const CATEGORY_BADGES: Record<string, string> = {
  import: "🔗 Import Error",
  type: "📐 Type Error",
  compile: "⚙️ Compilation Error",
  test: "🧪 Test Failure",
  runtime: "💥 Runtime Error",
  security: "🔒 Security Issue",
  performance: "🐌 Performance Issue",
  architecture: "🏗️ Architecture Issue",
  deps: "📦 Dependency Issue",
  unknown: "❓ Unclassified Error",
}

// ── Domain-specific fix templates — richer than generic messages ──

interface FixTemplate {
  /** Match rule: regex or keyword pattern */
  patterns: RegExp[]
  /** Category override */
  category: string
  /** Root cause explanation (template with $1, $2 from regex groups) */
  reason: string
  /** Specific fix instruction */
  fix: string
  /** Is this a common newbie mistake? (changes tone) */
  commonMistake?: boolean
}

const FIX_TEMPLATES: FixTemplate[] = [
  // TypeScript import errors
  {
    patterns: [/Cannot find module ['"]([^'"]+)['"]/, /Module '([^']+)' could not be found/, /Could not resolve ['"]([^'"]+)['"]/],
    category: "import",
    reason: "The module `$1` could not be found — either the file doesn't exist, the path is wrong, or the package is not installed.",
    fix: "1. Check if the file `$1` exists at the imported path\n" +
         "2. For local imports, verify the relative path (`./` or `../`) is correct\n" +
         "3. For npm packages, run `npm install $1` or check `node_modules/`\n" +
         "4. Common gotcha: TypeScript needs `.js` extensions in ESM imports",
    commonMistake: true,
  },
  // TypeScript type errors
  {
    patterns: [/Type ['"]([^'"]+)['"] is not assignable to type ['"]([^'"]+)['"]/, /Argument of type ['"]([^'"]+)['"] is not assignable/],
    category: "type",
    reason: "A value of type `$1` was used where type `$2` was expected — likely a type mismatch or missing property.",
    fix: "1. Check the type definition of the target variable/parameter\n" +
         "2. Look for recently added required properties that you're not passing\n" +
         "3. Use `as` cast only as a last resort — prefer fixing the source\n" +
         "4. Common gotcha: optional properties (`prop?`) vs required",
    commonMistake: true,
  },
  // TypeScript property errors
  {
    patterns: [/Property ['"]([^'"]+)['"] does not exist on type/, /has no property ['"]([^'"]+)['"]/],
    category: "type",
    reason: "You're accessing `$1` on a type that doesn't have that property — this is a type-level error, not a runtime check.",
    fix: "1. Check if the property name is spelled correctly\n" +
         "2. Verify the type definition includes `$1`\n" +
         "3. If using a union type, you may need a type guard first\n" +
         "4. Consider `'$1' in obj` check before access",
  },
  // Compile errors
  {
    patterns: [/error TS(\d+)/, /compilation failed/, /unexpected token/i, /SyntaxError: /],
    category: "compile",
    reason: "The TypeScript/JavaScript source contains syntax errors — the compiler cannot parse the file.",
    fix: "1. Find the exact line with the error — check the TS error code (TS$1)\n" +
         "2. Common causes: missing closing brace, unmatched parenthesis, trailing commas in older TS\n" +
         "3. If the error is in a recently modified file, review the diff\n" +
         "4. Run `tsc --noEmit` for a full check without building",
  },
  // Test failures
  {
    patterns: [/(\d+) failing/, /assertion failed/i, /expected (.*) but got/i],
    category: "test",
    reason: "One or more test assertions failed — the code change broke expected behavior.",
    fix: "1. Check which test(s) failed — look at the test name and file\n" +
         "2. If expected behavior changed intentionally, update the test\n" +
         "3. If broken unintentionally, review the function signature/return value change\n" +
         "4. Run a single failing test: `npx jest <test-file> -t '<test-name>'`",
  },
  // Runtime errors (null/undefined)
  {
    patterns: [/Cannot read propert(?:y|ies) ['"]([^'"]+)['"] of (null|undefined)/, /is not a function/, /TypeError: [^i]/],
    category: "runtime",
    reason: "An operation was attempted on null or undefined — a code path reached unexpected state.",
    fix: "1. Find the line where the error occurs (check stack trace)\n" +
         "2. Add a null check before accessing the value: `if (value) { ... }`\n" +
         "3. Consider using optional chaining: `value?.$1`\n" +
         "4. If this is API data, check for missing fields in the response",
  },
  // Permission errors
  {
    patterns: [/EACCES/, /permission denied/i, /EISDIR/i, /ENOTDIR/i],
    category: "runtime",
    reason: "The process lacks permissions to access the file or directory.",
    fix: "1. Check permissions: `ls -la <file/dir>`\n" +
         "2. Ensure the file exists and is readable/writable by the current user\n" +
         "3. For directories, verify the path is a file not a directory (or vice versa)\n" +
         "4. In Docker/CI, ensure the volume is mounted with correct permissions",
  },
]

// ── ErrorAnalyzer (refactored with actionable output) ────────────

export class ErrorAnalyzer {
  private llm: ErrorAnalyzerLLM | null = null
  private domainRegistry: DomainRegistry | null = null

  setLLM(llm: ErrorAnalyzerLLM): void {
    this.llm = llm
  }

  hasLLM(): boolean {
    return this.llm !== null
  }

  setDomainRegistry(registry: DomainRegistry): void {
    this.domainRegistry = registry
  }

  /**
   * Analyze error with domain matchers first, then built-in templates.
   * Returns the structured ErrorAnalysis (backward compatible).
   */
  analyze(errorMessage: string, modifiedFiles: string[]): ErrorAnalysis {
    const matchers = this.domainRegistry?.getErrorMatchers() ?? []
    for (const matcher of matchers) {
      const result = matcher.match(errorMessage)
      if (result?.matched) {
        return {
          category: result.category,
          summary: result.summary,
          likelyRootCause: result.likelyRootCause,
          suggestedFix: result.suggestedFix,
          affectedFiles: modifiedFiles,
          severity: result.severity,
        }
      }
    }

    return this.fallbackAnalyze(errorMessage, modifiedFiles)
  }

  /**
   * Convert an ErrorAnalysis into a Hermes-style actionable error message.
   * This is the user-/LLM-facing format that includes (1) what, (2) why, (3) fix.
   */
  formatActionable(analysis: ErrorAnalysis, errorMessage: string): ActionableError {
    const badge = CATEGORY_BADGES[analysis.category] ?? CATEGORY_BADGES.unknown
    const location = this.extractLocation(errorMessage, analysis.affectedFiles)

    return {
      badge,
      summary: `${badge}: ${analysis.summary}`,
      location,
      why: analysis.likelyRootCause,
      fix: analysis.suggestedFix,
      severity: analysis.severity,
      trace: errorMessage.slice(0, 300),
    }
  }

  /**
   * Render ActionableError as a plain-text message suitable for
   * system prompts, agentic_execute output, and terminal display.
   */
  renderActionable(error: ActionableError): string {
    const lines: string[] = [
      `${error.summary}`,
      `   📂 ${error.location}`,
      `   🔍 Why: ${error.why}`,
      `   🔧 Fix: ${error.fix}`,
    ]
    if (error.trace) {
      lines.push(`   📋 Details: ${error.trace}`)
    }
    return lines.join("\n")
  }

  /**
   * Analyze then directly return an actionable error.
   * Convenience method — combines analyze() + formatActionable().
   */
  actionable(errorMessage: string, modifiedFiles: string[]): ActionableError {
    const analysis = this.analyze(errorMessage, modifiedFiles)
    return this.formatActionable(analysis, errorMessage)
  }

  // ── Private helpers ─────────────────────────────────────────────

  /** Built-in fallback with improved domain templates */
  private fallbackAnalyze(errorMessage: string, modifiedFiles: string[]): ErrorAnalysis {
    const msg = errorMessage.toLowerCase()

    // Try fix templates first
    for (const template of FIX_TEMPLATES) {
      for (const pattern of template.patterns) {
        const match = errorMessage.match(pattern)
        if (match) {
          const reason = template.reason.replace(/\$(\d+)/g, (_, n) => match[parseInt(n)] ?? `$${n}`)
          const fix = template.fix.replace(/\$(\d+)/g, (_, n) => match[parseInt(n)] ?? `$${n}`)
          return {
            category: template.category,
            summary: errorMessage.slice(0, 120),
            likelyRootCause: reason,
            suggestedFix: fix,
            affectedFiles: modifiedFiles,
            severity: "high",
          }
        }
      }
    }

    // Fall through to old heuristics
    if (/cannot find module|module not found|could not resolve/i.test(msg)) {
      const match = errorMessage.match(/['"]([^'"]+)['"]/)
      return { category: "import", summary: "Missing module or broken import", likelyRootCause: `The module ${match?.[1] ?? "imported"} could not be resolved`, suggestedFix: `1. Verify the import path is correct\n2. Run \`npm install\` if it's an npm package\n3. Check \`tsconfig.json\` path aliases`, affectedFiles: modifiedFiles, severity: "critical" }
    }
    if (msg.includes("type") && (msg.includes("not assignable") || msg.includes("has no") || /does not exist on type/i.test(msg))) {
      return { category: "type", summary: "Type mismatch", likelyRootCause: "A type mismatch or missing property was introduced", suggestedFix: "Check type annotations on recently modified code. Look for mismatched interface signatures or missing required properties.", affectedFiles: modifiedFiles, severity: "high" }
    }
    if (msg.includes("error ts") || msg.includes("compilation failed") || /syntax error|unexpected token/i.test(msg)) {
      return { category: "compile", summary: "Compilation error", likelyRootCause: "Syntax errors or broken references", suggestedFix: "1. Check the exact line number from the error output\n2. Review recently modified files for syntax issues\n3. Run `tsc --noEmit` for the full error list", affectedFiles: modifiedFiles, severity: "high" }
    }
    if (msg.includes("test") && (msg.includes("failed") || msg.includes("assert") || msg.includes("expect"))) {
      return { category: "test", summary: "Test failure", likelyRootCause: "Code change broke existing behavior", suggestedFix: "1. Review the specific test failure message\n2. Check if the function signature or return type changed\n3. Run a single test: `npx jest <file> -t '<name>'`", affectedFiles: modifiedFiles, severity: "medium" }
    }
    if (/(?:cannot read property|cannot read properties|of undefined|null|is not a function|is not defined|TypeError|ReferenceError)/.test(msg)) {
      return { category: "runtime", summary: "Runtime error", likelyRootCause: "A code path reached unexpected state — likely null/undefined", suggestedFix: "1. Find the line from the stack trace\n2. Add null checks before access\n3. Use optional chaining (`?.`) if available", affectedFiles: modifiedFiles, severity: "high" }
    }
    return { category: "unknown", summary: "Unclassified error", likelyRootCause: "Error does not match known patterns — manual review needed", suggestedFix: "1. Read the full error message carefully\n2. Check recently modified files\n3. Try reproducing with minimal steps", affectedFiles: modifiedFiles, severity: "medium" }
  }

  /**
   * Extract file location + line number from error message.
   * Parses common TypeScript/Node.js error formats.
   */
  private extractLocation(errorMessage: string, modifiedFiles: string[]): string {
    // TypeScript format: src/foo.ts(14,5)
    const tsMatch = errorMessage.match(/([^\s()]+\.\w+)\s*[(:]\s*(\d+)/)
    if (tsMatch) {
      return `${tsMatch[1]}:${tsMatch[2]}`
    }
    // Node.js format: at file.js:14:5
    const nodeMatch = errorMessage.match(/at\s+(?:[^(]+\s+)?\(?([^:)]+):(\d+):(\d+)/)
    if (nodeMatch) {
      return `${nodeMatch[1]}:${nodeMatch[2]}`
    }
    // Fallback: first modified file
    if (modifiedFiles.length > 0) {
      return modifiedFiles[0]
    }
    return "unknown location"
  }

  // ── Deep analysis (LLM-based, unchanged from original) ──────────

  async analyzeDeep(errorMessage: string, modifiedFiles: string[]): Promise<ErrorAnalysis> {
    const ruleResult = this.analyze(errorMessage, modifiedFiles)
    if (ruleResult.category !== "unknown" || !this.llm) {
      return ruleResult
    }

    const domainName = this.domainRegistry?.getCurrentDomain() ?? "unknown"
    try {
      const resp = await this.llm.call({
        systemPrompt: `You are an error analyzer for the "${domainName}" domain.
Given an error message, classify it and suggest a fix.
Return JSON with keys: category (string), summary (string), likelyRootCause (string), suggestedFix (string), severity (low|medium|high|critical).
Only return valid JSON, no other text.`,
        userPrompt: `Error message:
\`\`\`
${errorMessage.slice(0, 2000)}
\`\`\`

Affected files:
${modifiedFiles.map(f => `- ${f}`).join("\n")}`,
        temperature: 0.1,
      })

      try {
        const parsed = JSON.parse(resp.content.trim())
        return {
          category: parsed.category ?? "unknown",
          summary: parsed.summary ?? "LLM-analyzed error",
          likelyRootCause: parsed.likelyRootCause ?? parsed.rootCause ?? "Could not determine root cause",
          suggestedFix: parsed.suggestedFix ?? parsed.fix ?? "Could not determine fix",
          affectedFiles: modifiedFiles,
          severity: ["low", "medium", "high", "critical"].includes(parsed.severity) ? parsed.severity : "medium",
        }
      } catch {
        const jsonMatch = resp.content.trim().match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0])
            return {
              category: parsed.category ?? "unknown",
              summary: parsed.summary ?? "LLM-analyzed error",
              likelyRootCause: parsed.likelyRootCause ?? parsed.rootCause ?? "Could not determine root cause",
              suggestedFix: parsed.suggestedFix ?? parsed.fix ?? "Could not determine fix",
              affectedFiles: modifiedFiles,
              severity: ["low", "medium", "high", "critical"].includes(parsed.severity) ? parsed.severity : "medium",
            }
          } catch { /* ignore */ }
        }
      }
    } catch {
      // LLM fallback failed
    }

    return ruleResult
  }

  /**
   * Deep analyze then format actionable — convenience method.
   */
  async actionableDeep(errorMessage: string, modifiedFiles: string[]): Promise<ActionableError> {
    const analysis = await this.analyzeDeep(errorMessage, modifiedFiles)
    return this.formatActionable(analysis, errorMessage)
  }
}
