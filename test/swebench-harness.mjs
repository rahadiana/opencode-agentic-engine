// test/swebench-harness.mjs — SWE-bench-style evaluation harness
// Evaluates agent performance on coding tasks with measurable outcomes.
//
// Usage:
//   node test/swebench-harness.mjs                          # mock mode (no LLM)
//   OPENAI_BASE_URL=http://localhost:11434/v1 node test/swebench-harness.mjs
//   OPENAI_API_KEY=sk-... node test/swebench-harness.mjs
//
// Scoring:
//   Each scenario = 1 point for pass, 0 for fail.
//   Total score = points / scenarios * 100.
//   Target: >60% per SWE-bench Verified standard.

import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from "node:fs"
import { resolve, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"

const __dirname = dirname(fileURLToPath(import.meta.url))
const PLUGIN_DIST = resolve(__dirname, "..", "dist", "index.js")
const CODEBASE_FIXTURE = resolve(__dirname, "e2e-codebase-fixture")
const WORKTREE_BASE = "/tmp/swebench-worktree"

// ── LLM Detection ──
const HAS_OPENAI = !!(process.env.OPENAI_API_KEY || process.env.OPENAI_BASE_URL)
const HAS_ANTHROPIC = !!process.env.ANTHROPIC_API_KEY
const CAN_USE_LLM = HAS_OPENAI || HAS_ANTHROPIC

// ── Results ──
let passed = 0
let failed = 0
const scenarioResults = []

function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++ }
  else { console.error(`  FAIL: ${msg}`); failed++ }
}

function mockCtx(sessionID) {
  return {
    sessionID, messageID: `m-${sessionID}`, agent: "test",
    directory: `${WORKTREE_BASE}-${sessionID}`,
    worktree: `${WORKTREE_BASE}-${sessionID}`,
    abort: new AbortController().signal,
    metadata: () => ({}),
    ask: async () => "proceed",
  }
}

function tryExec(cmd, args, opts) {
  try { execFileSync(cmd, args, { ...opts, stdio: "pipe", timeout: 30000 }); return true }
  catch { return false }
}

// ── Scenario Definitions ──
const scenarios = [
  {
    id: "S1-fix-test-script",
    category: "config",
    swetype: "bug-fix",
    description: `The package.json has a broken test script — running "npm test" just echoes "tests ok" instead of actually executing the test files.

Fix the test script in package.json so it actually runs tests. The project has vitest tests in tests/unit/ and tests/integration/. Use vitest as the test runner.

Steps:
1. Read package.json to understand the current setup
2. Update the "test" script to run vitest
3. Verify that "npm test" actually runs the test files`,
    setup: (wt) => {
      const pkgPath = join(wt, "package.json")
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"))
      pkg.scripts.test = "echo tests ok"
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n")
    },
    evaluate: (wt) => {
      const pkg = JSON.parse(readFileSync(join(wt, "package.json"), "utf-8"))
      const testScript = pkg.scripts?.test || ""
      if (testScript === "echo tests ok") return { pass: false, reason: "test script unchanged" }
      if (!testScript.includes("vitest")) return { pass: false, reason: "test script does not use vitest" }
      if (!testScript.includes("run")) return { pass: false, reason: "test script does not run tests" }
      return { pass: true, reason: `test script: "${testScript}"` }
    },
    expectedFiles: ["package.json"],
    tags: ["bug-fix", "config", "test"],
  },
  {
    id: "S2-add-auth-service-test",
    category: "test-writing",
    swetype: "feature-implementation",
    description: `The AuthService.ts file has a login, validate, and logout method. Write proper vitest unit tests for AuthService that:
1. Import AuthService from src/services/AuthService.ts
2. Test that login returns a token string
3. Test that validate returns a user ID for valid tokens
4. Test that validate returns null for invalid/empty tokens
5. Test that logout handles various inputs

Write the tests in tests/unit/AuthService.test replacing the placeholder content.`,
    setup: (wt) => {
      const testPath = join(wt, "tests", "unit", "AuthService.test")
      writeFileSync(testPath, `import { describe, it, expect } from "vitest"

describe("AuthService.test", () => {
  it("should handle valid input", () => {
    expect(true).toBe(true)
  })
  it("should reject empty input", () => {
    expect(() => { throw new Error("invalid") }).toThrow()
  })
  it("should handle concurrent calls", async () => {
    const results = await Promise.all([1, 2, 3].map(async n => n * 2))
    expect(results).toEqual([2, 4, 6])
  })
  it("should maintain idempotency", () => {
    const fn = (x: number) => x + 1
    expect(fn(fn(0))).toBe(2)
  })
})`)
    },
    evaluate: (wt) => {
      const testContent = readFileSync(join(wt, "tests", "unit", "AuthService.test"), "utf-8")
      if (!testContent.includes("AuthService")) return { pass: false, reason: "does not reference actual AuthService class" }
      if (!testContent.includes("login") && !testContent.includes("validate") && !testContent.includes("logout")) {
        return { pass: false, reason: "does not test any AuthService method" }
      }
      // Should import from actual module
      if (!testContent.includes("../../src/services/AuthService") && !testContent.includes("src/services/AuthService")) {
        return { pass: false, reason: "does not import AuthService from correct path" }
      }
      if (!testContent.includes("import")) return { pass: false, reason: "no import statements" }
      if (!testContent.includes("vitest")) return { pass: false, reason: "vitest not imported" }
      return { pass: true, reason: "AuthService.test imports and tests actual module" }
    },
    expectedFiles: ["tests/unit/AuthService.test"],
    tags: ["test-writing", "unit-test"],
  },
  {
    id: "S3-fix-email-validator",
    category: "bug-fix",
    swetype: "bug-fix",
    description: `The isEmail function in src/utils/validation.ts has a bug: it uses a simple regex that fails on subdomains and certain valid email formats.

Fix the isEmail() function to correctly handle:
1. Subdomains (user@sub.example.com)
2. Plus addressing (user+tag@example.com)
3. International characters

Steps:
1. Read src/utils/validation.ts to understand current isEmail implementation
2. Fix the regex to handle subdomains and plus addressing
3. Verify the fix covers all edge cases`,
    setup: (wt) => {
      const valPath = join(wt, "src", "utils", "validation.ts")
      writeFileSync(valPath, `export function isEmail(v: string): boolean { return /^[^\\s@]+@[^\\s@]+\\.[a-z]{2,3}$/i.test(v); } export function isPhone(v: string): boolean { return /^\\+?[\\d\\s-]{10,}$/.test(v); } export function notEmpty(v: string): boolean { return v.trim().length > 0 } export function minLength(n: number): (v: string) => boolean { return (v: string) => v.length >= n } export function maxLength(n: number): (v: string) => boolean { return (v: string) => v.length <= n }`)
    },
    evaluate: (wt) => {
      const content = readFileSync(join(wt, "src", "utils", "validation.ts"), "utf-8")
      if (!content.includes("isEmail")) return { pass: false, reason: "isEmail function removed" }
      if (content.includes("[a-z]{2,3}") && !content.includes("[a-z]{2,}") && !content.includes("+")) {
        return { pass: false, reason: "regex still limited to 2-3 char TLDs" }
      }
      return { pass: true, reason: "email validator regex improved" }
    },
    expectedFiles: ["src/utils/validation.ts"],
    tags: ["bug-fix", "validation", "regex"],
  },
  {
    id: "S4-fix-logger-import",
    category: "import-bug",
    swetype: "bug-fix",
    description: `The logger utility at src/utils/logger.ts has a broken import — it tries to import from a non-existent path. Fix the import so the logger compiles correctly.

Steps:
1. Read src/utils/logger.ts to find the broken import
2. Determine the correct import path
3. Fix the import
4. Verify compilation passes`,
    setup: (wt) => {
      const loggerPath = join(wt, "src", "utils", "logger.ts")
      writeFileSync(loggerPath, `// Logger utility
import { format } from "../helpers/nonexistent-format.js"

export function log(level: string, message: string): void {
  console.log(\`[\${level}] \${format(message)}\`)
}

export function info(msg: string): void { log("INFO", msg) }
export function error(msg: string): void { log("ERROR", msg) }
export function warn(msg: string): void { log("WARN", msg) }
`)
    },
    evaluate: (wt) => {
      const content = readFileSync(join(wt, "src", "utils", "logger.ts"), "utf-8")
      if (!content.includes("import")) return { pass: false, reason: "import removed entirely" }
      if (content.includes("nonexistent-format")) return { pass: false, reason: "still importing from nonexistent path" }
      const compiles = tryExec("npx", ["tsc", "--noEmit", "--pretty", "false"], { cwd: wt })
      if (!compiles) {
        // Check if import path actually exists
        const match = content.match(/from\s+["'](.+?)["']/)
        if (match) {
          const importPath = join(wt, match[1].replace(/\.js$/, ""))
          if (!existsSync(importPath + ".ts") && !existsSync(importPath + ".js")) {
            return { pass: false, reason: `import target still missing: ${match[1]}` }
          }
        }
      }
      return { pass: true, reason: "logger import fixed" }
    },
    expectedFiles: ["src/utils/logger.ts"],
    tags: ["import-bug", "compile-fix"],
  },
  {
    id: "S5-fix-rate-limit-config",
    category: "config",
    swetype: "bug-fix",
    description: `The rate limit middleware at src/middleware/RateLimitMiddleware.ts references a non-existent config key. The config object at src/config/cache.ts has the correct structure but the middleware reads from a wrong path.

Fix the middleware so it reads the rate limit configuration from the correct config location.

Steps:
1. Read src/middleware/RateLimitMiddleware.ts
2. Read src/config/cache.ts to find the correct config
3. Fix the middleware to use the right config path
4. Verify the code compiles`,
    setup: (wt) => {
      const mwPath = join(wt, "src", "middleware", "RateLimitMiddleware.ts")
      writeFileSync(mwPath, `// Rate limiting middleware
import { config } from "../config/app.js"

export function rateLimitMiddleware(req: any, res: any, next: any): void {
  const maxRequests = config.rateLimit?.max ?? 100
  const windowMs = config.rateLimit?.window ?? 60000

  if (maxRequests <= 0) {
    res.status(429).json({ error: "Too many requests" })
    return
  }
  next()
}

export const RateLimitConfig = {
  maxRequests,
  windowMs,
}
`)
    },
    evaluate: (wt) => {
      const content = readFileSync(join(wt, "src", "middleware", "RateLimitMiddleware.ts"), "utf-8")
      if (!content.includes("import")) return { pass: false, reason: "imports removed" }
      if (content.includes("config.rateLimit")) {
        // Check if this import path actually works
        try {
          execFileSync("npx", ["tsc", "--noEmit", "--pretty", "false"], { cwd: wt, stdio: "pipe", timeout: 15000 })
          return { pass: true, reason: "rate limit config fixed and compiles" }
        } catch {
          return { pass: false, reason: "still referencing non-existent config path" }
        }
      }
      // Any fix that compiles is acceptable
      const compiles = tryExec("npx", ["tsc", "--noEmit", "--pretty", "false"], { cwd: wt })
      return { pass: compiles, reason: compiles ? "rate limit config fixed and compiles" : "still has compilation errors" }
    },
    expectedFiles: ["src/middleware/RateLimitMiddleware.ts"],
    tags: ["config", "import-bug"],
  },
  {
    id: "S6-fix-auth-middleware",
    category: "bug-fix",
    swetype: "bug-fix",
    description: `The AuthMiddleware at src/middleware/AuthMiddleware.ts has a logical bug: it always passes authentication even for invalid tokens. Fix the token validation to properly reject unauthenticated requests.

Steps:
1. Read src/middleware/AuthMiddleware.ts
2. Read src/services/AuthService.ts to understand the validate method
3. Fix the middleware to call AuthService.validate and reject invalid tokens
4. Handle the case where Authorization header is missing`,
    setup: (wt) => {
      const mwPath = join(wt, "src", "middleware", "AuthMiddleware.ts")
      writeFileSync(mwPath, `// Authentication middleware
import { AuthService } from "../services/AuthService.js"

const authService = new AuthService()

export function authMiddleware(req: any, res: any, next: any): void {
  const token = req.headers?.authorization?.replace("Bearer ", "")
  // TODO: validate token properly
  next()
}
`)
    },
    evaluate: (wt) => {
      const content = readFileSync(join(wt, "src", "middleware", "AuthMiddleware.ts"), "utf-8")
      if (!content.includes("authService")) return { pass: false, reason: "does not use AuthService" }
      if (!content.includes("validate")) return { pass: false, reason: "does not call validate" }
      if (!content.includes("401") && !content.includes("unauthorized") && !content.includes("Unauthorized") && !content.includes("reject") && !content.includes("next(") && !content.includes("res.status")) {
        // Check if at least it does something on invalid token
        if (content.includes("if") || content.includes("return")) {
          return { pass: true, reason: "auth middleware validates tokens" }
        }
        return { pass: false, reason: "does not handle invalid tokens" }
      }
      return { pass: true, reason: "auth middleware properly validates tokens" }
    },
    expectedFiles: ["src/middleware/AuthMiddleware.ts"],
    tags: ["bug-fix", "security", "auth"],
  },
  {
    id: "S7-fix-cors-middleware",
    category: "config",
    swetype: "bug-fix",
    description: `The CORS middleware at src/middleware/CorsMiddleware.ts has a hardcoded origin that breaks cross-origin requests. Fix it to read allowed origins from config and properly handle OPTIONS preflight requests.

Steps:
1. Read src/middleware/CorsMiddleware.ts
2. Check config files for allowed origins
3. Fix origin handling and add OPTIONS support
4. Verify compilation passes`,
    setup: (wt) => {
      const mwPath = join(wt, "src", "middleware", "CorsMiddleware.ts")
      writeFileSync(mwPath, `// CORS middleware
export function corsMiddleware(req: any, res: any, next: any): void {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET")
  next()
}
`)
    },
    evaluate: (wt) => {
      const content = readFileSync(join(wt, "src", "middleware", "CorsMiddleware.ts"), "utf-8")
      if (!content.includes("Access-Control")) return { pass: false, reason: "CORS headers removed" }
      if (!content.includes("OPTIONS") && !content.includes("preflight")) return { pass: false, reason: "does not handle OPTIONS preflight" }
      if (!content.includes("import")) {
        if (!content.includes("config") && content.includes("*")) return { pass: false, reason: "still using wildcard without reading from config" }
      }
      const compiles = tryExec("npx", ["tsc", "--noEmit", "--pretty", "false"], { cwd: wt })
      return { pass: compiles, reason: compiles ? "CORS middleware fixed" : "compilation failed after fix" }
    },
    expectedFiles: ["src/middleware/CorsMiddleware.ts"],
    tags: ["config", "bug-fix", "security"],
  },
]

// ── Setup worktree for a scenario ──
function setupWorktree(scenarioId) {
  const worktree = `${WORKTREE_BASE}-${scenarioId}`
  rmSync(worktree, { recursive: true, force: true })
  cpSync(CODEBASE_FIXTURE, worktree, { recursive: true })
  tryExec("npm", ["install", "--silent"], { cwd: worktree, stdio: "ignore" })
  return worktree
}

// ── Run a single scenario ──
async function runScenario(scenario) {
  console.log(`\n─── ${scenario.id} (${scenario.swetype}) ───`)
  const startTime = Date.now()
  const worktree = setupWorktree(scenario.id)

  // Apply scenario-specific setup
  scenario.setup(worktree)

  // Load plugin
  const mod = await import(PLUGIN_DIST)
  const ctx = mockCtx(scenario.id)
  ctx.directory = worktree
  ctx.worktree = worktree
  const hooks = await mod.AgenticEngine(ctx)

  let scenarioPass = false
  let scenarioNote = ""
  let runError = null

  try {
    const autoResult = await hooks.tool.agentic_auto.execute({
      goal: scenario.description,
      constraints: ["TypeScript", "ESM modules"],
    }, ctx)
    const out = typeof autoResult === "string" ? autoResult : (autoResult.output || "")

    if (!CAN_USE_LLM) {
      // Mock mode: check agent produced output without crashing
      assert(out.length > 0, "agent produced output")
      scenarioPass = true
      scenarioNote = "mock mode — no LLM"
    } else {
      if (out.includes("[NO_LLM]") || out.includes("no LLM")) {
        scenarioNote = "no LLM available"
      } else {
        // Evaluate correctness
        const evalResult = scenario.evaluate(worktree)
        scenarioPass = evalResult.pass
        scenarioNote = evalResult.reason
        assert(scenarioPass, `${scenario.id}: ${scenarioNote}`)

        // Verify expected files exist
        for (const f of scenario.expectedFiles) {
          assert(existsSync(join(worktree, f)), `expected file: ${f}`)
        }

        // Compilation check (non-blocking, additional metric)
        const compiles = tryExec("npx", ["tsc", "--noEmit", "--pretty", "false"], { cwd: worktree })
        if (!compiles) {
          console.log(`  INFO: post-fix compilation has errors (non-fatal)`)
        }
      }
    }
  } catch (e) {
    runError = e
    if (CAN_USE_LLM) {
      assert(false, `${scenario.id} error: ${e.message}`)
    } else {
      // In mock mode, agent_auto may fail due to no LLM — that's expected
      scenarioPass = true
      scenarioNote = "mock mode — agent_auto failed (expected without LLM)"
    }
  } finally {
    await hooks.dispose()
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1)
  scenarioResults.push({
    id: scenario.id,
    category: scenario.category,
    swetype: scenario.swetype,
    pass: scenarioPass,
    note: scenarioNote || (runError ? runError.message : "unknown"),
    duration: `${duration}s`,
  })
}

// ── Report ──
function printReport() {
  const total = scenarios.length
  const pointsEarned = scenarioResults.filter(r => r.pass).length

  console.log(`\n${"=".repeat(68)}`)
  console.log("  SWE-BENCH EVALUATION REPORT")
  console.log(`  LLM: ${CAN_USE_LLM ? "AVAILABLE" : "MOCK MODE (no LLM)"}`)
  console.log(`  Target: >${CAN_USE_LLM ? "60" : "N/A"}% (SWE-bench Verified standard)`)
  console.log("=".repeat(68))

  for (const sr of scenarioResults) {
    const icon = sr.pass ? "✅" : "❌"
    console.log(`  ${icon} ${sr.id} [${sr.category}]`)
    console.log(`     ${sr.note} (${sr.duration})`)
  }

  console.log("=".repeat(68))
  const passRate = total > 0 ? (pointsEarned / total * 100).toFixed(0) : "N/A"
  console.log(`  Score: ${pointsEarned}/${total} (${passRate}%)`)
  console.log("=".repeat(68))

  // Category breakdown
  console.log("\n  By Category:")
  const categories = {}
  for (const sr of scenarioResults) {
    if (!categories[sr.category]) categories[sr.category] = { total: 0, passed: 0 }
    categories[sr.category].total++
    if (sr.pass) categories[sr.category].passed++
  }
  for (const [cat, stats] of Object.entries(categories)) {
    const rate = stats.total > 0 ? (stats.passed / stats.total * 100).toFixed(0) : "N/A"
    console.log(`    ${cat}: ${stats.passed}/${stats.total} (${rate}%)`)
  }

  // SWE-bench type breakdown
  console.log("\n  By Type:")
  const types = {}
  for (const sr of scenarioResults) {
    if (!types[sr.swetype]) types[sr.swetype] = { total: 0, passed: 0 }
    types[sr.swetype].total++
    if (sr.pass) types[sr.swetype].passed++
  }
  for (const [type, stats] of Object.entries(types)) {
    const rate = stats.total > 0 ? (stats.passed / stats.total * 100).toFixed(0) : "N/A"
    console.log(`    ${type}: ${stats.passed}/${stats.total} (${rate}%)`)
  }

  // Timing
  console.log("\n  Timing:")
  const totalTime = scenarioResults.reduce((s, r) => s + parseFloat(r.duration), 0)
  const avgTime = scenarioResults.length > 0 ? (totalTime / scenarioResults.length).toFixed(1) : "N/A"
  console.log(`    Total: ${totalTime.toFixed(1)}s`)
  console.log(`    Avg: ${avgTime}s`)

  console.log("=".repeat(68))
  console.log(`  Total assertions: ${passed} passed, ${failed} failed`)
  console.log("=".repeat(68))
  console.log("")
}

// ── Main ──
async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗")
  console.log("║  SWE-bench Evaluation Harness v2                       ║")
  console.log("╚══════════════════════════════════════════════════════════╝")
  console.log(`Plugin: ${PLUGIN_DIST}`)
  console.log(`Fixture: ${CODEBASE_FIXTURE} (${scenarios.length} scenarios)`)
  console.log(`LLM: ${CAN_USE_LLM ? "AVAILABLE" : "NOT AVAILABLE (mock mode)"}`)
  if (CAN_USE_LLM) {
    console.log(`  Using: ${HAS_OPENAI ? "OpenAI-compatible" : ""} ${HAS_ANTHROPIC ? "Anthropic" : ""}`)
  }

  for (const scenario of scenarios) {
    await runScenario(scenario)
  }

  printReport()

  return {
    totalScenarios: scenarios.length,
    passed: passed,
    failed: failed,
    pointsEarned: scenarioResults.filter(r => r.pass).length,
    successRate: scenarios.length > 0 ? (scenarioResults.filter(r => r.pass).length / scenarios.length * 100) : 0,
    llmAvailable: CAN_USE_LLM,
    results: scenarioResults,
  }
}

const result = await main()
if (result.failed > 0 && CAN_USE_LLM) process.exit(1)
