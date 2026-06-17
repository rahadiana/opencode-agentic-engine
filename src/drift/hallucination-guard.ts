import { existsSync, readFileSync } from "node:fs"
import { resolve, isAbsolute } from "node:path"

export interface HallucinationCheck {
  passed: boolean
  claims: ClaimResult[]
  summary: string
}

export interface ClaimResult {
  claim: string
  type: "file_exists" | "function_exists" | "import_valid" | "api_signature"
  verified: boolean
  actual?: string
  expected?: string
}

export class HallucinationGuard {
  private worktree: string

  constructor(worktree: string) {
    this.worktree = worktree
  }

  check(executionOutput: string, modifiedFiles: string[]): HallucinationCheck {
    const claims: ClaimResult[] = []

    const fileClaims = this.extractFileClaims(executionOutput)
    for (const claim of fileClaims) {
      const resolved = this.resolveSafe(claim)
      const exists = resolved ? existsSync(resolved) : false
      claims.push({
        claim,
        type: "file_exists",
        verified: exists,
        actual: exists ? "exists" : "does not exist",
        expected: "exists",
      })
    }

    const funcClaims = this.extractFunctionClaims(executionOutput)
    for (const claim of funcClaims) {
      const resolved = this.resolveSafe(claim.file)
      const found = resolved ? this.functionExists(claim.function, resolved, modifiedFiles) : false
      claims.push({
        claim: `${claim.function} in ${claim.file}`,
        type: "function_exists",
        verified: found,
        actual: found ? "found" : "not found",
        expected: "found",
      })
    }

    const importClaims = this.extractImportClaims(executionOutput)
    for (const claim of importClaims) {
      const resolved = this.resolveSafe(claim)
      const exists = resolved ? existsSync(resolved) : false
      claims.push({
        claim,
        type: "import_valid",
        verified: exists,
        actual: exists ? "exists" : "missing",
        expected: "exists",
      })
    }

    const sigClaims = this.extractApiSignatureClaims(executionOutput, modifiedFiles)
    for (const claim of sigClaims) {
      const resolved = this.resolveSafe(claim.file)
      const sigValid = resolved ? this.verifyApiSignature(claim.method, claim.file, resolved) : false
      claims.push({
        claim: `${claim.method} in ${claim.file}`,
        type: "api_signature",
        verified: sigValid,
        actual: sigValid ? "signature matches" : "signature mismatch or not found",
        expected: "signature exists",
      })
    }

    const passed = claims.every(c => c.verified)
    const failedCount = claims.filter(c => !c.verified).length

    return {
      passed,
      claims,
      summary: passed
        ? "All claims verified."
        : `${failedCount} unverified claim(s) found. These statements may be hallucinations.`,
    }
  }

  private resolveSafe(claim: string): string | null {
    const normalized = claim.replace(/['"]/g, "")
    if (isAbsolute(normalized)) {
      if (!normalized.startsWith(this.worktree)) return null
      return normalized
    }
    const resolved = resolve(this.worktree, normalized)
    if (!resolved.startsWith(this.worktree)) return null
    return resolved
  }

  private extractFileClaims(output: string): string[] {
    const patterns = [
      /(?:created|wrote|generated|saved)\s+['"]?([\w/.\-]+\.(?:ts|js|tsx|jsx|json|py|go|rs|md|yaml|yml|toml))['"]?/gi,
      /(?:in|at|to)\s+['"]?([\w/.\-]+\.(?:ts|js|tsx|jsx|py|go|rs|md))['"]?/gi,
    ]

    const files = new Set<string>()
    for (const pattern of patterns) {
      for (const match of output.matchAll(pattern)) {
        const file = match[1]
        if (file && file.length > 2) files.add(file)
      }
    }

    return [...files]
  }

  private extractFunctionClaims(output: string): Array<{ function: string; file: string }> {
    const results: Array<{ function: string; file: string }> = []
    const pattern = /(?:added|implemented|created|modified)\s+(\w+)\s+(?:in|to|at)\s+['"]?([\w/.\-]+)['"]?/gi

    for (const match of output.matchAll(pattern)) {
      results.push({ function: match[1], file: match[2] })
    }

    return results
  }

  private extractImportClaims(output: string): string[] {
    const files = new Set<string>()
    const pattern = /(?:import|require)\s+.*?['"](.+?)['"]/g

    for (const match of output.matchAll(pattern)) {
      const imp = match[1]
      if (imp && imp.length > 1) files.add(imp)
    }

    return [...files]
  }

  private extractApiSignatureClaims(output: string, _modifiedFiles: string[]): Array<{ method: string; file: string }> {
    const results: Array<{ method: string; file: string }> = []

    const patterns = [
      /(?:calls|invokes|uses|references)\s+(\w+)\s+(?:from|in)\s+['"]?([\w/.\-]+\.(?:ts|js|py|go|rs))['"]?/gi,
      /(?:API|endpoint|method|function)\s+(\w+)\s+(?:in|at)\s+['"]?([\w/.\-]+\.(?:ts|js|py|go|rs))['"]?/gi,
      /(?:returns|exports)\s+(\w+)\s+(?:from)\s+['"]?([\w/.\-]+\.(?:ts|js|py|go|rs))['"]?/gi,
    ]

    for (const pattern of patterns) {
      for (const match of output.matchAll(pattern)) {
        results.push({ method: match[1], file: match[2] })
      }
    }

    return results
  }

  private verifyApiSignature(methodName: string, relativePath: string, absolutePath: string): boolean {
    try {
      const content = readFileSync(absolutePath, "utf-8")
      // Escape regex special characters to prevent crash on method names like "foo(bar)"
      const escaped = methodName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

      const isPython = relativePath.endsWith(".py")
      const isGo = relativePath.endsWith(".go")
      const isRust = relativePath.endsWith(".rs")

      if (isPython) {
        const defPattern = new RegExp(`def\\s+${escaped}\\s*\\(`)
        const classPattern = new RegExp(`class\\s+${escaped}\\s*[(:]`)
        return defPattern.test(content) || classPattern.test(content)
      }

      if (isGo) {
        const funcPattern = new RegExp(`func\\s+(?:\\(\\w+\\s+\\*?\\w+\\)\\s+)?${escaped}\\s*\\(`)
        return funcPattern.test(content)
      }

      if (isRust) {
        const fnPattern = new RegExp(`(?:pub\\s+)?fn\\s+${escaped}\\s*[<(]`)
        const implPattern = new RegExp(`impl\\s+.*\\{[^}]*fn\\s+${escaped}\\s*[<(]`)
        return fnPattern.test(content) || implPattern.test(content)
      }

      const patterns = [
        new RegExp(`(?:function|const|let|var|export\\s+(?:const|function|class|default|async\\s+function))\\s+${escaped}\\b`),
        new RegExp(`${escaped}\\s*[=(:]`),
        new RegExp(`(?:async\\s+)?${escaped}\\s*\\(`),
      ]
      return patterns.some(p => p.test(content))
    } catch {
      return false
    }
  }

  private functionExists(funcName: string, file: string, _knownFiles: string[]): boolean {
    try {
      const content = readFileSync(file, "utf-8")
      const patterns = [
        new RegExp(`(?:function|const|let|var|export\\s+(?:const|function|class|default|async\\s+function))\\s+${funcName}\\b`),
        new RegExp(`${funcName}\\s*[=(:]`),
        new RegExp(`(?:async\\s+)?${funcName}\\s*\\(`),
      ]
      return patterns.some(p => p.test(content))
    } catch {
      return false
    }
  }
}
