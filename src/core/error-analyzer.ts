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

  /** Built-in fallback when no domain matchers match — uses old heuristics */
  private fallbackAnalyze(errorMessage: string, modifiedFiles: string[]): ErrorAnalysis {
    const msg = errorMessage.toLowerCase()
    if (msg.includes("cannot find module") || msg.includes("module not found") || msg.includes("could not resolve")) {
      const match = errorMessage.match(/['"]([@\w\-/.]+)['"]/)
      return { category: "import", summary: "Missing module or broken import", likelyRootCause: `The module ${match?.[1] ?? "imported"} could not be resolved`, suggestedFix: `Verify the import path`, affectedFiles: modifiedFiles, severity: "critical" }
    }
    if (msg.includes("type") && (msg.includes("not assignable") || msg.includes("has no") || msg.includes("does not exist on type"))) {
      return { category: "type", summary: "Type mismatch", likelyRootCause: "A type mismatch or missing property was introduced", suggestedFix: "Check type annotations on recently modified code", affectedFiles: modifiedFiles, severity: "high" }
    }
    if (msg.includes("error ts") || msg.includes("compilation failed") || msg.includes("syntax error") || msg.includes("unexpected token")) {
      return { category: "compile", summary: "Compilation error", likelyRootCause: "Syntax errors or broken references", suggestedFix: "Run the compiler to see exact line numbers", affectedFiles: modifiedFiles, severity: "high" }
    }
    if (msg.includes("test") && (msg.includes("failed") || msg.includes("assert") || msg.includes("expect"))) {
      return { category: "test", summary: "Test failure", likelyRootCause: "Code change broke existing behavior", suggestedFix: "Review failing test assertions", affectedFiles: modifiedFiles, severity: "medium" }
    }
    if (msg.includes("error") && (msg.includes("throw") || msg.includes("cannot") || msg.includes("undefined") || msg.includes("null"))) {
      return { category: "runtime", summary: "Runtime error", likelyRootCause: "A code path hitting unexpected state", suggestedFix: "Add defensive checks at the point of failure", affectedFiles: modifiedFiles, severity: "high" }
    }
    return { category: "unknown", summary: "Unclassified error", likelyRootCause: "Error does not match known patterns", suggestedFix: "Review the error manually", affectedFiles: modifiedFiles, severity: "medium" }
  }

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

      const cleaned = resp.content.trim()
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        return {
          category: parsed.category ?? "unknown",
          summary: parsed.summary ?? "LLM-analyzed error",
          likelyRootCause: parsed.likelyRootCause ?? parsed.rootCause ?? "Could not determine root cause",
          suggestedFix: parsed.suggestedFix ?? parsed.fix ?? "Could not determine fix",
          affectedFiles: modifiedFiles,
          severity: ["low", "medium", "high", "critical"].includes(parsed.severity) ? parsed.severity : "medium",
        }
      }
    } catch {
      // LLM fallback failed
    }

    return ruleResult
  }
}
