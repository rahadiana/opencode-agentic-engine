import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { LLMEngine } from "./llm.js"

export type SupportedLanguage = "typescript" | "python" | "go" | "rust" | "javascript" | "unknown"

export interface VerificationResult {
  passed: boolean
  stepId: string
  checks: CheckResult[]
  errors: string[]
}

export interface CheckResult {
  name: string
  passed: boolean
  output: string
}

export interface LanguageConfig {
  compileCmd: (projectDir: string) => { bin: string; args: string[]; timeout: number }
  testCmd: (projectDir: string, testPattern?: string) => { bin: string; args: string[]; timeout: number }
  fileExts: string[]
  testFileExts: string[]
}

const LANGUAGE_CONFIGS: Record<SupportedLanguage, LanguageConfig> = {
  typescript: {
    compileCmd: (dir) => ({ bin: "npx", args: ["tsc", "--noEmit", "--pretty", "false"], timeout: 30000 }),
    testCmd: (dir, pattern) => {
      const args = ["vitest", "run", "--reporter", "verbose"]
      if (pattern) args.push("--", pattern)
      return { bin: "npx", args, timeout: 60000 }
    },
    fileExts: [".ts", ".tsx"],
    testFileExts: [".test.ts", ".spec.ts", ".test.tsx", ".spec.tsx"],
  },
  javascript: {
    compileCmd: (dir) => ({ bin: "node", args: ["-e", "process.exit(0)"], timeout: 5000 }),
    testCmd: (dir, pattern) => {
      const args = ["vitest", "run", "--reporter", "verbose"]
      if (pattern) args.push("--", pattern)
      return { bin: "npx", args, timeout: 60000 }
    },
    fileExts: [".js", ".jsx", ".mjs"],
    testFileExts: [".test.js", ".spec.js", ".test.jsx", ".spec.jsx"],
  },
  python: {
    compileCmd: (dir) => ({ bin: "python", args: ["-m", "py_compile", "-q", "."], timeout: 30000 }),
    testCmd: (dir, pattern) => {
      const args = ["-m", "pytest", "-q"]
      if (pattern) args.push(pattern)
      return { bin: "python", args, timeout: 60000 }
    },
    fileExts: [".py"],
    testFileExts: ["test_", "_test.py"],
  },
  go: {
    compileCmd: (dir) => ({ bin: "go", args: ["vet", "./..."], timeout: 30000 }),
    testCmd: (dir, pattern) => {
      const args = ["test", "./...", "-count=1"]
      if (pattern) args.push("-run", pattern)
      return { bin: "go", args, timeout: 120000 }
    },
    fileExts: [".go"],
    testFileExts: ["_test.go"],
  },
  rust: {
    compileCmd: (dir) => ({ bin: "cargo", args: ["check", "--quiet"], timeout: 120000 }),
    testCmd: (dir, pattern) => {
      const args = ["test"]
      if (pattern) args.push(pattern)
      return { bin: "cargo", args, timeout: 120000 }
    },
    fileExts: [".rs"],
    testFileExts: ["test.rs"],
  },
  unknown: {
    compileCmd: (dir) => ({ bin: "echo", args: ["no compile step"], timeout: 1000 }),
    testCmd: (dir) => ({ bin: "echo", args: ["no test step"], timeout: 1000 }),
    fileExts: [],
    testFileExts: [],
  },
}

export class Verifier {
  private detectedLang: SupportedLanguage = "unknown"
  private llm: LLMEngine | null = null

  setLLM(llm: LLMEngine): void {
    this.llm = llm
  }

  hasLLM(): boolean {
    return this.llm !== null
  }

  async verifySemantic(stepId: string, intent: string, changedFiles: string[], projectDir: string): Promise<CheckResult> {
    if (!this.llm) {
      return { name: "semantic", passed: true, output: "Semantic verification skipped (no LLM configured)" }
    }

    const fileContents: Record<string, string> = {}
    for (const f of changedFiles) {
      const absPath = resolve(projectDir, f)
      try {
        fileContents[f] = readFileSync(absPath, "utf-8")
      } catch { /* skip unreadable files */ }
    }

    if (Object.keys(fileContents).length === 0) {
      return { name: "semantic", passed: true, output: "Semantic verification skipped (no readable changed files)" }
    }

    const filesBlock = Object.entries(fileContents).map(([path, content]) =>
      `### ${path}\n\`\`\`\n${content.slice(0, 2000)}\n\`\`\``
    ).join("\n\n")

    const resp = await this.llm.call({
      systemPrompt: "You are a semantic verification assistant. Given an intent/goal and the code changes made, determine if the changes correctly implement the intent. Consider: edge cases, completeness, correctness. Respond as JSON with keys: passed (boolean), reasoning (string), issuesFound (array of strings). If the code correctly implements the intent, passed must be true.",
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
      return { name: "semantic", passed: true, output: `Semantic verification: ${resp.content.slice(0, 500)}` }
    }
  }

  async verifyAllDeep(stepId: string, projectDir: string, intent?: string, changedFiles?: string[], requireSemanticCheck = false): Promise<VerificationResult> {
    const checks: CheckResult[] = [
      this.verifyCompile(projectDir),
    ]
    if (this.detectedLang !== "unknown") {
      checks.push(this.verifyLint(projectDir))
    }
    checks.push(this.verifyTests(projectDir))

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

    const errors = checks.filter(c => !c.passed).map(c => c.output)
    return { passed: errors.length === 0, stepId, checks, errors }
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
    const { bin, args, timeout } = config.testCmd(projectDir, testPattern)

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

  verifyAll(stepId: string, projectDir: string): VerificationResult {
    if (this.detectedLang === "unknown") this.detectLanguage(projectDir)

    const checks = [
      this.verifyCompile(projectDir),
    ]
    if (this.detectedLang !== "unknown") {
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
