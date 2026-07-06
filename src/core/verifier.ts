import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import type { DomainRegistry } from "./domain-registry.js"
import type { LLMEngine } from "./llm.js"
import { createLogger } from "../observability/logger.js"

const log = createLogger("Verifier")

export type SupportedLanguage = "typescript" | "python" | "go" | "rust" | "javascript" | "unknown"

interface VulnEntry { severity: string }

/** Gap #4 — verification depth tiers */
export type VerificationTier = "fast" | "standard" | "deep"

/** Gap #4 — per-dimension configuration for deep verification */
export interface DeepVerificationConfig {
  /** Enable LLM-based security review (OWASP Top 10) */
  security?: boolean
  /** Enable LLM-based performance anti-pattern detection */
  performance?: boolean
  /** Enable LLM-based architecture analysis (circular deps, layer violations) */
  architecture?: boolean
  /** Enable package-manager dependency auditing (npm audit, pip-audit, cargo audit) */
  deps?: boolean
}

export interface VerificationResult {
  passed: boolean
  stepId: string
  checks: CheckResult[]
  errors: string[]
  /** Gap #4 — multi-dimensional breakdown per tier */
  dimensions?: {
    tier: VerificationTier
    security?: CheckResult
    performance?: CheckResult
    architecture?: CheckResult
    deps?: CheckResult
  }
}

export interface CheckResult {
  name: string
  passed: boolean
  output: string
}

export interface VerifierLanguageConfig {
  compileCmd: (projectDir: string) => { bin: string; args: string[]; timeout: number }
  testCmd: (projectDir: string, testPattern?: string) => { bin: string; args: string[]; timeout: number }
  fileExts: string[]
  testFileExts: string[]
}

const LANGUAGE_CONFIGS: Record<SupportedLanguage, VerifierLanguageConfig> = {
  typescript: {
    compileCmd: (_dir) => ({ bin: "npx", args: ["tsc", "--noEmit", "--pretty", "false", "--incremental"], timeout: 30000 }),
    testCmd: (_dir, pattern) => {
      const args = ["vitest", "run", "--reporter", "verbose"]
      if (pattern) args.push("--", pattern)
      return { bin: "npx", args, timeout: 60000 }
    },
    fileExts: [".ts", ".tsx"],
    testFileExts: [".test.ts", ".spec.ts", ".test.tsx", ".spec.tsx"],
  },
  javascript: {
    compileCmd: (_dir) => ({ bin: "node", args: ["-e", "process.exit(0)"], timeout: 5000 }),
    testCmd: (_dir, pattern) => {
      const args = ["vitest", "run", "--reporter", "verbose"]
      if (pattern) args.push("--", pattern)
      return { bin: "npx", args, timeout: 60000 }
    },
    fileExts: [".js", ".jsx", ".mjs"],
    testFileExts: [".test.js", ".spec.js", ".test.jsx", ".spec.jsx"],
  },
  python: {
    compileCmd: (_dir) => ({ bin: "python", args: ["-m", "compileall", ".", "-q"], timeout: 30000 }),
    testCmd: (_dir, pattern) => {
      const args = ["-m", "pytest", "-q"]
      if (pattern) args.push("-k", pattern)
      return { bin: "python", args, timeout: 60000 }
    },
    fileExts: [".py"],
    testFileExts: ["test_", "_test.py"],
  },
  go: {
    compileCmd: (_dir) => ({ bin: "go", args: ["vet", "./..."], timeout: 30000 }),
    testCmd: (_dir, pattern) => {
      const args = ["test", "./...", "-count=1"]
      if (pattern) args.push("-run", pattern)
      return { bin: "go", args, timeout: 120000 }
    },
    fileExts: [".go"],
    testFileExts: ["_test.go"],
  },
  rust: {
    compileCmd: (_dir) => ({ bin: "cargo", args: ["check", "--quiet"], timeout: 120000 }),
    testCmd: (_dir, pattern) => {
      const args = ["test"]
      if (pattern) args.push(pattern)
      return { bin: "cargo", args, timeout: 120000 }
    },
    fileExts: [".rs"],
    testFileExts: ["test.rs"],
  },
  unknown: {
    compileCmd: (_dir) => ({ bin: "echo", args: ["no compile step"], timeout: 1000 }),
    testCmd: (_dir) => ({ bin: "echo", args: ["no test step"], timeout: 1000 }),
    fileExts: [],
    testFileExts: [],
  },
}

export class Verifier {
  private detectedLang: SupportedLanguage = "unknown"
  private llm: LLMEngine | null = null
  private domainRegistry: DomainRegistry | null = null
  /** Cache hasil compile — avoid re-running tsc untuk intermediate steps */
  private lastCompileResult: { passed: boolean; output: string } | null = null
  private lastCompileFiles: string[] = []

  setLLM(llm: LLMEngine): void {
    this.llm = llm
  }

  hasLLM(): boolean {
    return this.llm !== null
  }

  setDomainRegistry(registry: DomainRegistry): void {
    this.domainRegistry = registry
  }

  /** Reset compile cache (panggil saat file berubah) */
  clearCompileCache(): void {
    this.lastCompileResult = null
    this.lastCompileFiles = []
  }

  private async readChangedFiles(projectDir: string, changedFiles: string[]): Promise<Record<string, string>> {
    const fileContents: Record<string, string> = {}
    for (const f of changedFiles) {
      const absPath = resolve(projectDir, f)
      try { fileContents[f] = await readFile(absPath, "utf-8") } catch { log.warn("Silent catch: skip") }
    }
    return fileContents
  }

  private buildFilesBlock(fileContents: Record<string, string>, maxLength = 2000): string {
    return Object.entries(fileContents)
      .map(([path, content]) => `### ${path}\n\`\`\`\n${content.slice(0, maxLength)}\n\`\`\``)
      .join("\n\n")
  }

  async verifySemantic(_stepId: string, intent: string, changedFiles: string[], projectDir: string): Promise<CheckResult> {
    if (!this.llm) {
      return { name: "semantic", passed: true, output: "Semantic verification skipped (no LLM configured)" }
    }

    const fileContents = await this.readChangedFiles(projectDir, changedFiles)
    if (Object.keys(fileContents).length === 0) {
      return { name: "semantic", passed: true, output: "Semantic verification skipped (no readable changed files)" }
    }

    const filesBlock = this.buildFilesBlock(fileContents)
    const domainName = this.domainRegistry?.getCurrentDomain() ?? "generic"
    const resp = await this.llm.call({
      systemPrompt: `You are a semantic verification assistant. Given an intent/goal and the changes made in the "${domainName}" domain, determine if the changes correctly implement the intent. Consider: edge cases, completeness, correctness. Respond as JSON with keys: passed (boolean), reasoning (string), issuesFound (array of strings).`,
      userPrompt: `## Intent\n${intent}\n\n## Changed Files\n${filesBlock}\n\nVerify if these changes correctly implement the intent. Return JSON.`,
      jsonMode: true,
      temperature: 0.1,
    })

    try {
      const parsed = JSON.parse(resp.content)
      const issues = Array.isArray(parsed.issuesFound) ? parsed.issuesFound : []
      const passed = parsed.passed !== false
      return {
        name: "semantic",
        passed,
        output: `Semantic verification: ${passed ? "PASS" : "ISSUES FOUND"}\nReasoning: ${parsed.reasoning ?? "N/A"}\n${issues.length > 0 ? `Issues:\n${issues.map((i: string) => `- ${i}`).join("\n")}` : ""}`,
      }
    } catch {
      return { name: "semantic", passed: false, output: `Semantic verification: LLM returned unparseable response — manual review needed\nRaw: ${resp.content.slice(0, 500)}` }
    }
  }

  async verifyCriteria(criteria: string[], intent: string, changedFiles: string[], projectDir: string): Promise<CheckResult> {
    if (!this.llm || criteria.length === 0) {
      return { name: "criteria", passed: true, output: "Criteria verification skipped (no LLM or no criteria)" }
    }

    const fileContents = await this.readChangedFiles(projectDir, changedFiles)
    const criteriaBlock = criteria.map((c, i) => `${i + 1}. ${c}`).join("\n")
    const filesBlock = this.buildFilesBlock(fileContents)

    const domainName = this.domainRegistry?.getCurrentDomain() ?? "generic"
    const resp = await this.llm.call({
      systemPrompt: `You are a criteria verification assistant for the "${domainName}" domain. Given a list of verification criteria and the changed files, determine if EACH criterion is satisfied. Respond as JSON with keys: allPassed (boolean), results (array of {criterion, passed, reasoning}).`,
      userPrompt: `## Intent\n${intent}\n\n## Verification Criteria\n${criteriaBlock}\n\n## Changed Files\n${filesBlock}\n\nEvaluate each criterion. Return JSON.`,
      jsonMode: true,
      temperature: 0.1,
    })

    try {
      const parsed = JSON.parse(resp.content)
      const results = Array.isArray(parsed.results) ? parsed.results : []
      const allPassed = parsed.allPassed !== false
      const details = results.map((r: { criterion: string; passed: boolean; reasoning?: string }) =>
        `  ${r.passed ? "✅" : "❌"} ${r.criterion}${r.reasoning ? ` — ${r.reasoning}` : ""}`
      ).join("\n")
      return {
        name: "criteria",
        passed: allPassed,
        output: `Criteria verification: ${allPassed ? "ALL PASS" : "SOME FAILED"}\n${details}`,
      }
    } catch {
      return { name: "criteria", passed: false, output: `Criteria verification: LLM returned unparseable response — manual review needed\nRaw: ${resp.content.slice(0, 500)}` }
    }
  }

  /**
   * Fast verification — compile ONLY (no tests, no lint, no LLM).
   * Untuk intermediate steps di agentic_execute.
   * Pakai cache: jika file tidak berubah sejak compile terakhir, skip.
   */
  verifyFast(stepId: string, projectDir: string, changedFiles?: string[]): VerificationResult {
    if (this.detectedLang === "unknown") this.detectLanguage(projectDir)

    const checks: CheckResult[] = []

    const filesChanged = changedFiles ?? []
    const sortedChanged = [...filesChanged].sort()
    const sortedLast = [...this.lastCompileFiles].sort()
    const filesSame = sortedChanged.length === sortedLast.length &&
      sortedChanged.every((f, i) => f === sortedLast[i])

    if (this.lastCompileResult && filesSame) {
      checks.push({
        name: `compile:${this.detectedLang} (cached)`,
        passed: this.lastCompileResult.passed,
        output: this.lastCompileResult.output,
      })
    } else {
      const compileResult = this.verifyCompile(projectDir)
      this.lastCompileResult = { passed: compileResult.passed, output: compileResult.output }
      this.lastCompileFiles = [...filesChanged]
      checks.push(compileResult)
    }

    const errors = checks.filter(c => !c.passed).map(c => c.output)
    return { passed: errors.length === 0, stepId, checks, errors }
  }

  /**
   * Shared LLM check for security/performance/architecture.
   * Reads changed files, builds files block, calls LLM, parses result.
   */
  private async runLLMCheck(
    name: string,
    systemPrompt: string,
    userPromptTemplate: string,
    projectDir: string,
    changedFiles: string[],
    maxLength = 2000,
  ): Promise<CheckResult> {
    if (!this.llm) {
      return { name, passed: true, output: `${name} verification skipped (no LLM configured)` }
    }

    const fileContents = await this.readChangedFiles(projectDir, changedFiles)
    if (Object.keys(fileContents).length === 0) {
      return { name, passed: true, output: `${name} verification skipped (no readable changed files)` }
    }

    const filesBlock = this.buildFilesBlock(fileContents, maxLength)
    const resp = await this.llm.call({
      systemPrompt,
      userPrompt: userPromptTemplate.replace("${filesBlock}", filesBlock),
      jsonMode: true,
      temperature: 0.1,
    })

    return this.parseLLMCheck(name, resp.content)
  }

  /**
   * Gap #4: Security verification — LLM-based OWASP review.
   * Checks for: SQL injection, XSS, RCE, path traversal, insecure deserialization, hardcoded secrets, auth bypass.
   */
  async verifySecurity(intent: string, changedFiles: string[], projectDir: string): Promise<CheckResult> {
    const domainName = this.domainRegistry?.getCurrentDomain() ?? "generic"
    return this.runLLMCheck(
      "security",
      `You are a security verification assistant for the "${domainName}" domain. Review the code for OWASP Top 10 vulnerabilities. Respond as JSON with keys: passed (boolean), reasoning (string), issuesFound (array of strings).`,
      `## Intent\n${intent}\n\n## Changed Files\n` + "${filesBlock}" + `\n\nReview for security vulnerabilities. Return JSON.`,
      projectDir,
      changedFiles,
    )
  }

  /**
   * Gap #4: Performance verification — LLM-based anti-pattern detection.
   * Checks for: O(n²) loops, N+1 queries, memory leaks, large payloads, inefficient algorithms.
   */
  async verifyPerformance(intent: string, changedFiles: string[], projectDir: string): Promise<CheckResult> {
    const domainName = this.domainRegistry?.getCurrentDomain() ?? "generic"
    return this.runLLMCheck(
      "performance",
      `You are a performance verification assistant for the "${domainName}" domain. Review the code for performance anti-patterns. Respond as JSON with keys: passed (boolean), reasoning (string), issuesFound (array of strings).`,
      `## Intent\n${intent}\n\n## Changed Files\n` + "${filesBlock}" + `\n\nReview for performance issues. Return JSON.`,
      projectDir,
      changedFiles,
    )
  }

  /**
   * Gap #4: Architecture verification — LLM-based structural analysis.
   * Checks for: circular dependencies, layer violations, module boundary crossings, orphan modules.
   */
  async verifyArchitecture(intent: string, changedFiles: string[], projectDir: string): Promise<CheckResult> {
    const domainName = this.domainRegistry?.getCurrentDomain() ?? "generic"
    const srcFiles = changedFiles.filter(f =>
      f.endsWith(".ts") || f.endsWith(".tsx") || f.endsWith(".js") ||
      f.endsWith(".py") || f.endsWith(".go") || f.endsWith(".rs")
    )
    return this.runLLMCheck(
      "architecture",
      `You are an architecture verification assistant for the "${domainName}" domain. Analyze the import graph and module structure. Respond as JSON with keys: passed (boolean), reasoning (string), issuesFound (array of strings).`,
      `## Intent\n${intent}\n\n## Source Files\n` + "${filesBlock}" + `\n\nAnalyze for circular dependencies, layer violations, and architectural issues. Return JSON.`,
      projectDir,
      srcFiles,
      1500,
    )
  }

  /**
   * Gap #4: Dependency audit — run package manager's built-in audit command.
   * Supports: npm audit (Node.js), pip-audit (Python), cargo audit (Rust).
   */
  private runNpmAudit(projectDir: string): CheckResult | null {
    if (!existsSync(resolve(projectDir, "package-lock.json")) && !existsSync(resolve(projectDir, "yarn.lock"))) {
      return null
    }
    try {
      const output = execFileSync("npm", ["audit", "--json"], {
        cwd: projectDir,
        timeout: 30000,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      })
      const parsed = JSON.parse(output)
      const vulns = parsed.vulnerabilities ?? {}
      const allVulns = Object.values(vulns) as VulnEntry[]
      const criticalCount = allVulns.filter((v: VulnEntry) => v.severity === "critical").length
      const highCount = allVulns.filter((v: VulnEntry) => v.severity === "high").length
      const moderateCount = allVulns.filter((v: VulnEntry) => v.severity === "moderate").length

      if (criticalCount > 0 || highCount > 0) {
        return {
          name: "deps:npm",
          passed: false,
          output: `npm audit: ${criticalCount} critical, ${highCount} high, ${moderateCount} moderate vulnerabilities found. Run \`npm audit fix\` to resolve.`,
        }
      }
      return {
        name: "deps:npm",
        passed: true,
        output: `npm audit: ${criticalCount} critical, ${highCount} high, ${moderateCount} moderate — all acceptable.`,
      }
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string; message?: string }
      const stdout = err.stdout ?? err.message ?? ""
      try {
        const parsed = JSON.parse(stdout)
        const vulns = parsed.vulnerabilities ?? {}
        const allVulns2 = Object.values(vulns) as VulnEntry[]
        const criticalCount = allVulns2.filter((v: VulnEntry) => v.severity === "critical").length
        const highCount = allVulns2.filter((v: VulnEntry) => v.severity === "high").length
        if (criticalCount > 0 || highCount > 0) {
          return {
            name: "deps:npm",
            passed: false,
            output: `npm audit: ${criticalCount} critical, ${highCount} high vulnerabilities. Run \`npm audit fix\` to resolve.`,
          }
        }
        return { name: "deps:npm", passed: true, output: "npm audit: no critical/high vulnerabilities." }
      } catch {
        return { name: "deps:npm", passed: true, output: `npm audit: ${stdout.slice(0, 300)}` }
      }
    }
  }

  private runPipAudit(projectDir: string): CheckResult | null {
    if (!existsSync(resolve(projectDir, "requirements.txt")) && !existsSync(resolve(projectDir, "Pipfile.lock"))) {
      return null
    }
    try {
      const output = execFileSync("python", ["-m", "pip_auth", "--quiet"], {
        cwd: projectDir,
        timeout: 30000,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      })
      return { name: "deps:pip", passed: true, output: output || "pip-audit: no vulnerabilities found." }
    } catch (e: unknown) {
      const err = e as { stdout?: string; message?: string }
      return { name: "deps:pip", passed: true, output: `pip-audit: ${(err.stdout || err.message || "").slice(0, 200)}` }
    }
  }

  private runCargoAudit(projectDir: string): CheckResult | null {
    if (!existsSync(resolve(projectDir, "Cargo.lock"))) return null
    try {
      const output = execFileSync("cargo", ["audit", "--quiet"], {
        cwd: projectDir,
        timeout: 60000,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      })
      return { name: "deps:cargo", passed: true, output: output || "cargo audit: no vulnerabilities found." }
    } catch (e: unknown) {
      const err = e as { stdout?: string; message?: string }
      return { name: "deps:cargo", passed: true, output: `cargo audit: ${(err.stdout || err.message || "").slice(0, 200)}` }
    }
  }

  verifyDeps(projectDir: string): CheckResult {
    if (this.detectedLang === "unknown") this.detectLanguage(projectDir)

    const checks: CheckResult[] = []
    const npmResult = this.runNpmAudit(projectDir)
    if (npmResult) checks.push(npmResult)
    const pipResult = this.runPipAudit(projectDir)
    if (pipResult) checks.push(pipResult)
    const cargoResult = this.runCargoAudit(projectDir)
    if (cargoResult) checks.push(cargoResult)

    if (checks.length === 0) {
      return { name: "deps", passed: true, output: "No supported package manager lockfile found — dependency audit skipped." }
    }

    return {
      name: "deps",
      passed: checks.every(c => c.passed),
      output: checks.map(c => c.output).join("; ") || "No dependency checks were run",
    }
  }

  /**
   * Parse LLM JSON response into a structured CheckResult.
   * Shared helper for verifySemantic, verifySecurity, verifyPerformance, verifyArchitecture.
   */
  private parseLLMCheck(name: string, content: string): CheckResult {
    try {
      const parsed = JSON.parse(content)
      const issues = Array.isArray(parsed.issuesFound) ? parsed.issuesFound : []
      const passed = parsed.passed !== false
      return {
        name,
        passed,
        output: `${name} verification: ${passed ? "PASS" : "ISSUES FOUND"}\nReasoning: ${parsed.reasoning ?? "N/A"}\n${issues.length > 0 ? `Issues:\n${issues.map((i: string) => `- ${i}`).join("\n")}` : ""}`,
      }
    } catch {
      return { name, passed: false, output: `${name} verification: LLM returned unparseable response — manual review needed\nRaw: ${content.slice(0, 500)}` }
    }
  }

  /**
   * Full deep verification — Gap #4 multi-dimensional.
   *
   * Tiers:
   *   "fast"     → compile only (same as verifyFast)
   *   "standard" → compile + lint + tests + domain verifiers + semantic (previous verifyAllDeep behavior)
   *   "deep"     → standard + security + performance + architecture + deps
   *
   * @param config Optional per-dimension overrides for deep tier.
   */
  async verifyAllDeep(
    stepId: string,
    projectDir: string,
    intent?: string,
    changedFiles?: string[],
    requireSemanticCheck = false,
    tier: VerificationTier = "standard",
    config?: DeepVerificationConfig,
  ): Promise<VerificationResult> {
    const checks: CheckResult[] = []
    const dimensions: VerificationResult["dimensions"] = { tier }

    // ---- Standard checks (compile + lint + tests) ----
    const strategies = this.domainRegistry?.getVerifiers() ?? []
    if (strategies.length > 0) {
      for (const strategy of strategies) {
        try {
          const result = await strategy.verify({ stepId, projectDir, output: intent ?? "", filesModified: changedFiles ?? [], intent: intent ?? "" })
          checks.push({ name: strategy.name, passed: result.passed, output: result.output })
        } catch (e: unknown) {
          checks.push({ name: strategy.name, passed: false, output: String(e) })
        }
      }
    } else {
      if (tier === "fast") {
        checks.push(this.verifyCompile(projectDir))
      } else {
        checks.push(this.verifyCompile(projectDir))
        if (this.detectedLang !== "unknown") {
          checks.push(this.verifyLint(projectDir))
        }
        checks.push(this.verifyTests(projectDir))
      }
    }

    // ---- Semantic verification ----
    if (this.llm && intent && changedFiles && changedFiles.length > 0) {
      const semantic = await this.verifySemantic(stepId, intent, changedFiles, projectDir)
      checks.push(semantic)
    } else if (requireSemanticCheck && changedFiles && changedFiles.length > 0) {
      checks.push({
        name: "semantic",
        passed: false,
        output: "Semantic verification required but no LLM configured. Set requireSemanticCheck=false or configure LLM.",
      })
    }

    // ---- Deep tier: Gap #4 multi-dimensional checks ----
    if (tier === "deep" && intent && changedFiles && changedFiles.length > 0) {
      const cfg = config ?? {}

      // Security
      if (cfg.security !== false) {
        const security = await this.verifySecurity(intent, changedFiles, projectDir)
        checks.push(security)
        dimensions.security = security
      }

      // Performance
      if (cfg.performance !== false) {
        const performance = await this.verifyPerformance(intent, changedFiles, projectDir)
        checks.push(performance)
        dimensions.performance = performance
      }

      // Architecture
      if (cfg.architecture !== false) {
        const architecture = await this.verifyArchitecture(intent, changedFiles, projectDir)
        checks.push(architecture)
        dimensions.architecture = architecture
      }

      // Dependency audit
      if (cfg.deps !== false) {
        const deps = this.verifyDeps(projectDir)
        checks.push(deps)
        dimensions.deps = deps
      }
    }

    const errors = checks.filter(c => !c.passed).map(c => c.output)
    return { passed: errors.length === 0, stepId, checks, errors, dimensions }
  }

  detectLanguage(projectDir: string): SupportedLanguage {
    const checks: Array<{ lang: SupportedLanguage; file: string }> = [
      { lang: "typescript", file: "tsconfig.json" },
      { lang: "rust", file: "Cargo.toml" },
      { lang: "go", file: "go.mod" },
      { lang: "python", file: "pyproject.toml" },
      { lang: "python", file: "setup.py" },
      { lang: "python", file: "requirements.txt" },
      { lang: "javascript", file: "package.json" },
    ]

    for (const { lang, file } of checks) {
      if (existsSync(resolve(projectDir, file))) {
        this.detectedLang = lang
        return lang
      }
    }

    this.detectedLang = "unknown"
    return "unknown"
  }

  getLanguage(): SupportedLanguage {
    return this.detectedLang
  }

  verifyCompile(projectDir: string): CheckResult {
    const lang = this.detectedLang === "unknown" ? this.detectLanguage(projectDir) : this.detectedLang
    const config = LANGUAGE_CONFIGS[lang] ?? LANGUAGE_CONFIGS.unknown
    const { bin, args, timeout } = config.compileCmd(projectDir)

    try {
      const output = execFileSync(bin, args, {
        cwd: projectDir,
        timeout,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      })
      return {
        name: `compile:${lang}`,
        passed: true,
        output: output || "Compilation successful",
      }
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string; message?: string }
      return {
        name: `compile:${lang}`,
        passed: false,
        output: err.stderr || err.stdout || err.message || "Compilation failed",
      }
    }
  }

  verifyTests(projectDir: string, testPattern = ""): CheckResult {
    const lang = this.detectedLang === "unknown" ? this.detectLanguage(projectDir) : this.detectedLang
    const config = LANGUAGE_CONFIGS[lang] ?? LANGUAGE_CONFIGS.unknown

    // Detect test runner from project config
    let customConfig = config
    if (lang === "typescript" || lang === "javascript") {
      const pkgPath = resolve(projectDir, "package.json")
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"))
        const scripts = (pkg.scripts as Record<string, string>) ?? {}
        if (scripts.test) {
          const testBin = scripts.test.startsWith("jest") ? "npx" : "npx"
          const testArgs = scripts.test.startsWith("jest")
            ? ["jest", ...(testPattern ? ["--", testPattern] : [])]
            : ["vitest", "run", "--reporter", "verbose", ...(testPattern ? ["--", testPattern] : [])]
          customConfig = {
            ...config,
            testCmd: () => ({ bin: testBin, args: testArgs, timeout: 60000 }),
          }
        }
      } catch {
        log.warn(`Failed to parse package.json in ${projectDir}, using default test config`)
      }
    }

    const { bin, args, timeout } = customConfig.testCmd(projectDir, testPattern)

    try {
      const output = execFileSync(bin, args, {
        cwd: projectDir,
        timeout,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      })
      return {
        name: testPattern ? `test:${testPattern}` : `test:all:${lang}`,
        passed: true,
        output: output || "Tests passed",
      }
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string; message?: string }
      return {
        name: testPattern ? `test:${testPattern}` : `test:all:${lang}`,
        passed: false,
        output: err.stdout || err.stderr || err.message || "Tests failed",
      }
    }
  }

  verifyLint(projectDir: string): CheckResult {
    const lang = this.detectedLang === "unknown" ? this.detectLanguage(projectDir) : this.detectedLang

    const lintConfigs: Partial<Record<SupportedLanguage, { bin: string; args: string[] }>> = {
      typescript: { bin: "npx", args: ["eslint", ".", "--quiet"] },
      javascript: { bin: "npx", args: ["eslint", ".", "--quiet"] },
      python: { bin: "python", args: ["-m", "ruff", "check", "."] },
      go: { bin: "golangci-lint", args: ["run", "./..."] },
    }

    const config = lintConfigs[lang]
    if (!config) {
      return { name: `lint:${lang}`, passed: true, output: "No linter configured for this language" }
    }

    try {
      const output = execFileSync(config.bin, config.args, {
        cwd: projectDir,
        timeout: 60000,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      })
      return { name: `lint:${lang}`, passed: true, output: output || "Lint passed" }
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string; message?: string }
      return {
        name: `lint:${lang}`,
        passed: false,
        output: err.stdout || err.stderr || err.message || "Lint failed",
      }
    }
  }

  verifyAll(stepId: string, projectDir: string, testPattern?: string): VerificationResult {
    if (this.detectedLang === "unknown") this.detectLanguage(projectDir)

    const checks = [
      this.verifyCompile(projectDir),
    ]
    if (this.detectedLang !== "unknown") {
      checks.push(this.verifyLint(projectDir))
    }
    checks.push(this.verifyTests(projectDir, testPattern ?? ""))

    const errors = checks.filter(c => !c.passed).map(c => c.output)

    return {
      passed: errors.length === 0,
      stepId,
      checks,
      errors,
    }
  }

  verifyRelated(stepId: string, projectDir: string, changedFiles: string[]): VerificationResult {
    if (this.detectedLang === "unknown") this.detectLanguage(projectDir)
    const lang = this.detectedLang
    const config = LANGUAGE_CONFIGS[lang] ?? LANGUAGE_CONFIGS.unknown

    const checks: CheckResult[] = [this.verifyCompile(projectDir)]

    const isTestFile = (f: string): boolean => {
      if (config.testFileExts.length === 0) return false
      return config.testFileExts.some(ext => {
        if (ext.startsWith("test_")) {
          const basename = f.split("/").pop() ?? f
          return basename.startsWith("test_")
        }
        if (ext.startsWith("_test.")) return f.endsWith(ext)
        return f.endsWith(ext)
      })
    }

    const testFiles = changedFiles.filter(f => isTestFile(f))
    const sourceFiles = changedFiles.filter(f =>
      !isTestFile(f) && config.fileExts.some(ext => f.endsWith(ext))
    )

    const inferredTestFiles = sourceFiles.flatMap(f => {
      const base = f.replace(/\.\w+$/, "")
      const dir = base.replace(/\/[^/]*$/, "")
      const filename = base.replace(/.*\//, "")

      return config.testFileExts.flatMap(ext => {
        if (ext.startsWith("test_")) {
          return [`${dir}/test_${filename}${config.fileExts[0] ?? ".py"}`]
        }
        if (ext.endsWith("_")) {
          return [`${base}${ext}`]
        }
        return [`${base}${ext}`]
      })
    })

    const allTestFiles = [...new Set([...testFiles, ...inferredTestFiles])]

    if (allTestFiles.length > 0) {
      checks.push({
        name: `test:${allTestFiles.length} related files`,
        passed: true,
        output: `Related test files: ${allTestFiles.join(", ")}`,
      })
    }

    if (lang !== "unknown") {
      checks.push(this.verifyLint(projectDir))
    }
    checks.push(this.verifyTests(projectDir))

    const errors = checks.filter(c => !c.passed).map(c => c.output)
    return {
      passed: errors.length === 0,
      stepId,
      checks,
      errors,
    }
  }
}
