import { existsSync, readFileSync, realpathSync } from "node:fs"
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
    let resolved: string
    if (isAbsolute(normalized)) {
      if (!normalized.startsWith(this.worktree)) return null
      resolved = normalized
    } else {
      resolved = resolve(this.worktree, normalized)
    }
    if (!resolved.startsWith(this.worktree)) return null
    try {
      return realpathSync(resolved)
    } catch {
      return resolved
    }
  }

  private findInFile(pattern: RegExp, absolutePath: string): boolean {
    try {
      const content = readFileSync(absolutePath, "utf-8")
      return pattern.test(content)
    } catch {
      return false
    }
  }

  private extractFileClaims(output: string): string[] {
    const patterns = [
      /(?:created|wrote|generated|saved)\s+['"]?([\w/.-]+\.(?:ts|js|tsx|jsx|json|py|go|rs|md|yaml|yml|toml))['"]?/gi,
      /(?:in|at|to)\s+['"]?([\w/.-]+\.(?:ts|js|tsx|jsx|py|go|rs|md))['"]?/gi,
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
    const pattern = /(?:added|implemented|created|modified)\s+(\w+)\s+(?:in|to|at)\s+['"]?([\w/.-]+)['"]?/gi

    for (const match of output.matchAll(pattern)) {
      const funcName = match[1]
      if (/^(?:file|the|a|an|this|that|some|new|our|their|my|your)$/i.test(funcName)) continue
      results.push({ function: funcName, file: match[2] })
    }

    return results
  }

  private extractImportClaims(output: string): string[] {
    const files = new Set<string>()
    const lines = output.split("\n")

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("/*") || trimmed.startsWith("*")) continue

      const pattern = /(?:import|require)\s+.*?['"](.+?)['"]/g
      for (const match of trimmed.matchAll(pattern)) {
        const imp = match[1]
        if (imp && imp.length > 1) files.add(imp)
      }
    }

    return [...files]
  }

  private extractApiSignatureClaims(output: string, _modifiedFiles: string[]): Array<{ method: string; file: string }> {
    const results: Array<{ method: string; file: string }> = []

    const patterns = [
      /(?:calls|invokes|uses|references)\s+(\w+)\s+(?:from|in)\s+['"]?([\w/.-]+\.(?:ts|js|py|go|rs))['"]?/gi,
      /(?:API|endpoint|method|function)\s+(\w+)\s+(?:in|at)\s+['"]?([\w/.-]+\.(?:ts|js|py|go|rs))['"]?/gi,
      /(?:returns|exports)\s+(\w+)\s+(?:from)\s+['"]?([\w/.-]+\.(?:ts|js|py|go|rs))['"]?/gi,
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
      const escaped = methodName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

      const isPython = relativePath.endsWith(".py")
      const isGo = relativePath.endsWith(".go")
      const isRust = relativePath.endsWith(".rs")

      if (isPython) {
        const defPattern = new RegExp(`def\\s+${escaped}\\s*\\(`)
        const classPattern = new RegExp(`class\\s+${escaped}\\s*[(:]`)
        return this.findInFile(defPattern, absolutePath) || this.findInFile(classPattern, absolutePath)
      }

      if (isGo) {
        const funcPattern = new RegExp(`func\\s+(?:\\(\\w+\\s+\\*?\\w+\\)\\s+)?${escaped}\\s*\\(`)
        return this.findInFile(funcPattern, absolutePath)
      }

      if (isRust) {
        const fnPattern = new RegExp(`(?:pub\\s+)?fn\\s+${escaped}\\s*[<(]`)
        const implPattern = new RegExp(`impl\\s+.*\\{[^}]*fn\\s+${escaped}\\s*[<(]`)
        return this.findInFile(fnPattern, absolutePath) || this.findInFile(implPattern, absolutePath)
      }

      const patterns = [
        new RegExp(`(?:^|\\n)\\s*(?:export\\s+(?:default\\s+)?)?(?:async\\s+)?function\\s+${escaped}\\b`),
        new RegExp(`(?:^|\\n)\\s*(?:export\\s+(?:default\\s+)?)?(?:const|let|var)\\s+${escaped}\\s*[:=]\\s*(?:\\(|function|async)`),
        new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?(?:async\\s+)?${escaped}\\s*\\(`),
      ]
      return patterns.some(p => this.findInFile(p, absolutePath))
    } catch {
      return false
    }
  }

  private functionExists(funcName: string, file: string, _knownFiles: string[]): boolean {
    try {
      const escaped = funcName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      const patterns = [
        new RegExp(`(?:^|\\n)\\s*(?:export\\s+(?:default\\s+)?)?(?:async\\s+)?function\\s+${escaped}\\b`),
        new RegExp(`(?:^|\\n)\\s*(?:export\\s+(?:default\\s+)?)?(?:const|let|var)\\s+${escaped}\\s*[:=]\\s*(?:\\(|function|async)`),
        new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?(?:async\\s+)?${escaped}\\s*\\(`),
      ]
      return patterns.some(p => this.findInFile(p, file))
    } catch {
      return false
    }
  }
}
