import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import type { DomainPack, VerifierStrategy, ErrorMatcher } from "../domain-registry.js"
import { createCodeContract } from "../formal-model.js"

const codeKeywords = [
  "code", "app", "api", "function", "bug", "feature", "refactor",
  "typescript", "javascript", "python", "rust", "go", "java",
  "npm", "yarn", "pip", "cargo", "module", "import", "export",
  "test", "compile", "lint", "deploy", "server", "database",
  "frontend", "backend", "fullstack", "web", "software",
  "bikin", "buat", "implementasi", "coding", "program",
]

const codeDetect = (input: string): number => {
  const lower = input.toLowerCase()
  let score = 0
  for (const kw of codeKeywords) {
    if (lower.includes(kw)) score += 0.05
  }
  const projectDir = process.cwd()
  const projectFiles = ["package.json", "Cargo.toml", "go.mod", "pyproject.toml", "setup.py", "tsconfig.json"]
  for (const f of projectFiles) {
    try { if (existsSync(resolve(projectDir, f))) score += 0.2 } catch { console.warn("catch: skip") }
  }
  return Math.min(score, 1.0)
}

const detectLanguage = (projectDir: string): string => {
  const checks: Array<{ lang: string; file: string }> = [
    { lang: "typescript", file: "tsconfig.json" },
    { lang: "rust", file: "Cargo.toml" },
    { lang: "go", file: "go.mod" },
    { lang: "python", file: "pyproject.toml" },
    { lang: "python", file: "setup.py" },
    { lang: "python", file: "requirements.txt" },
    { lang: "javascript", file: "package.json" },
  ]
  for (const { lang, file } of checks) {
    if (existsSync(resolve(projectDir, file))) return lang
  }
  return "unknown"
}

const codeVerifiers: VerifierStrategy[] = [
  {
    name: "compile",
    async verify(context) {
      const lang = detectLanguage(context.projectDir)
      const compileCmds: Record<string, { bin: string; args: string[] }> = {
        typescript: { bin: "npx", args: ["tsc", "--noEmit", "--pretty", "false"] },
        javascript: { bin: "node", args: ["-e", "process.exit(0)"] },
        python: { bin: "python", args: ["-m", "py_compile", "-q", "."] },
        go: { bin: "go", args: ["vet", "./..."] },
        rust: { bin: "cargo", args: ["check", "--quiet"] },
      }
      const cmd = compileCmds[lang]
      if (!cmd) return { passed: true, output: `No compiler configured for ${lang}` }
      try {
        const output = execFileSync(cmd.bin, cmd.args, { cwd: context.projectDir, timeout: 30000, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] })
        return { passed: true, output: output || "Compilation successful" }
      } catch (e: unknown) {
        const err = e as { stdout?: string; stderr?: string; message?: string }
        return { passed: false, output: err.stderr || err.stdout || err.message || "Compilation failed" }
      }
    },
  },
  {
    name: "lint",
    async verify(context) {
      const lang = detectLanguage(context.projectDir)
      const lintCmds: Record<string, { bin: string; args: string[] }> = {
        typescript: { bin: "npx", args: ["eslint", ".", "--quiet"] },
        javascript: { bin: "npx", args: ["eslint", ".", "--quiet"] },
        python: { bin: "python", args: ["-m", "ruff", "check", "."] },
        go: { bin: "golangci-lint", args: ["run", "./..."] },
      }
      const cmd = lintCmds[lang]
      if (!cmd) return { passed: true, output: `No linter configured for ${lang}` }
      try {
        const output = execFileSync(cmd.bin, cmd.args, { cwd: context.projectDir, timeout: 60000, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] })
        return { passed: true, output: output || "Lint passed" }
      } catch (e: unknown) {
        const err = e as { stdout?: string; stderr?: string; message?: string }
        return { passed: false, output: err.stdout || err.stderr || err.message || "Lint failed" }
      }
    },
  },
  {
    name: "test",
    async verify(context) {
      const lang = detectLanguage(context.projectDir)
      const testCmds: Record<string, { bin: string; args: string[] }> = {
        typescript: { bin: "npx", args: ["vitest", "run", "--reporter", "verbose"] },
        javascript: { bin: "npx", args: ["vitest", "run", "--reporter", "verbose"] },
        python: { bin: "python", args: ["-m", "pytest", "-q"] },
        go: { bin: "go", args: ["test", "./...", "-count=1"] },
        rust: { bin: "cargo", args: ["test"] },
      }
      const cmd = testCmds[lang]
      if (!cmd) return { passed: true, output: `No test runner configured for ${lang}` }
      try {
        const output = execFileSync(cmd.bin, cmd.args, { cwd: context.projectDir, timeout: 60000, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] })
        return { passed: true, output: output || "Tests passed" }
      } catch (e: unknown) {
        const err = e as { stdout?: string; stderr?: string; message?: string }
        return { passed: false, output: err.stdout || err.stderr || err.message || "Tests failed" }
      }
    },
  },
]

const codeErrorMatchers: ErrorMatcher[] = [
  {
    name: "import",
    match(msg) {
      const lower = msg.toLowerCase()
      if (lower.includes("cannot find module") || lower.includes("module not found") || lower.includes("could not resolve")) {
        const match = msg.match(/['"]([@\w\-/.]+)['"]/)
        return {
          matched: true, category: "import",
          summary: "Missing module or broken import",
          likelyRootCause: `The module ${match?.[1] ?? "imported"} could not be resolved`,
          suggestedFix: `Verify the import path. If npm package: npm install ${match?.[1] ?? ""}`,
          severity: "critical",
        }
      }
      return null
    },
  },
  {
    name: "type",
    match(msg) {
      const lower = msg.toLowerCase()
      if (lower.includes("type") && (lower.includes("not assignable") || lower.includes("has no") || lower.includes("does not exist on type"))) {
        return {
          matched: true, category: "type",
          summary: "TypeScript type error",
          likelyRootCause: "A type mismatch or missing property was introduced",
          suggestedFix: "Check type annotations on recently modified code",
          severity: "high",
        }
      }
      return null
    },
  },
  {
    name: "compile",
    match(msg) {
      const lower = msg.toLowerCase()
      if (lower.includes("error ts") || lower.includes("compilation failed") || lower.includes("syntax error") || lower.includes("unexpected token")) {
        return {
          matched: true, category: "compile",
          summary: "Code fails to compile",
          likelyRootCause: "Syntax errors or broken references in recently modified files",
          suggestedFix: "Run the compiler to see exact line numbers",
          severity: "high",
        }
      }
      return null
    },
  },
  {
    name: "test",
    match(msg) {
      const lower = msg.toLowerCase()
      if (lower.includes("test") && (lower.includes("failed") || lower.includes("assert") || lower.includes("expect"))) {
        return {
          matched: true, category: "test",
          summary: "Test assertion failure",
          likelyRootCause: "A code change broke existing behavior",
          suggestedFix: "Review failing test assertions",
          severity: "medium",
        }
      }
      return null
    },
  },
  {
    name: "runtime",
    match(msg) {
      const lower = msg.toLowerCase()
      if (lower.includes("error") && (lower.includes("throw") || lower.includes("cannot") || lower.includes("undefined") || lower.includes("null"))) {
        return {
          matched: true, category: "runtime",
          summary: "Runtime error detected",
          likelyRootCause: "A code path hitting unexpected state",
          suggestedFix: "Add defensive checks at the point of failure",
          severity: "high",
        }
      }
      return null
    },
  },
]

export const codeDomain: DomainPack = {
  name: "code",
  description: "Software engineering domain — compile, lint, test, and code-specific error analysis",
  detect: codeDetect,
  verifiers: codeVerifiers,
  errorMatchers: codeErrorMatchers,
  roles: [],
  skills: [],
  tools: ["read", "edit", "write", "bash", "glob", "grep", "agentic_nav", "agentic_verify", "agentic_score", "agentic_pr", "agentic_delegate", "agentic_pipeline", "agentic_message", "agentic_parallel", "agentic_skill", "agentic_plan", "agentic_execute"],
  fileExtensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts", ".py", ".go", ".rs", ".java"],
  formalContract: createCodeContract(),
}
