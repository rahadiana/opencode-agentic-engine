export interface ErrorAnalysis {
  category: "compile" | "type" | "test" | "import" | "runtime" | "unknown"
  summary: string
  likelyRootCause: string
  suggestedFix: string
  affectedFiles: string[]
  severity: "low" | "medium" | "high" | "critical"
}

export class ErrorAnalyzer {
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
}
