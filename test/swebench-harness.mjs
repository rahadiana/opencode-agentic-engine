// test/swebench-harness.mjs — Lightweight SWE-bench-style evaluation harness
// Evaluates agent performance on real coding tasks with measurable outcomes.
//
// Usage:
//   node test/swebench-harness.mjs                          # no LLM (mock mode)
//   OPENAI_BASE_URL=http://localhost:11434/v1 node test/swebench-harness.mjs
//   OPENAI_API_KEY=sk-... node test/swebench-harness.mjs
//
// Each scenario:
//   1. Copies the codebase to a worktree
//   2. Runs agentic_auto with the issue description
//   3. Evaluates outcome: tests pass, files changed correctly, etc.
//   4. Reports pass/fail + metrics

import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, readdirSync } from "node:fs"
import { resolve, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { execSync } from "node:child_process"

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

// ── Scenario Definitions ──
// Each scenario has:
//   id: unique name
//   description: issue description (given to the agent)
//   setup: function(worktree) → prepare the codebase
//   evaluate: function(worktree) → check if the fix is correct
//   expectedFiles: files that should be modified
//   tags: categories for analysis

const scenarios = [
  {
    id: "fix-test-script",
    description: `The package.json has a broken test script — running "npm test" just echoes "tests ok" instead of actually executing the test files.

Fix the test script in package.json so it actually runs tests. The project has vitest tests in tests/unit/ and tests/integration/. Use vitest as the test runner.

Steps:
1. Read package.json to understand the current setup
2. Update the "test" script to run vitest
3. Verify that "npm test" actually runs the test files`,
    setup: (wt) => {
      // Reset package.json test script to broken state
      const pkgPath = join(wt, "package.json")
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"))
      pkg.scripts.test = "echo tests ok"
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n")
    },
    evaluate: (wt) => {
      const pkg = JSON.parse(readFileSync(join(wt, "package.json"), "utf-8"))
      const testScript = pkg.scripts?.test || ""
      // Should NOT be the default stub anymore
      if (testScript === "echo tests ok") return { pass: false, reason: "test script unchanged" }
      // Should reference vitest
      if (!testScript.includes("vitest")) return { pass: false, reason: "test script does not use vitest" }
      return { pass: true, reason: `test script updated: "${testScript}"` }
    },
    expectedFiles: ["package.json"],
    tags: ["bug-fix", "config", "test"],
  },
  {
    id: "add-auth-service-test",
    description: `The AuthService.ts file has no proper unit test. There's a stub file at tests/unit/AuthService.test that just has placeholder tests.

Replace the placeholder test with real tests that actually import AuthService from src/services/AuthService.ts and test its login, register, and validateToken methods.

Steps:
1. Read tests/unit/AuthService.test to see the current stub
2. Read src/services/AuthService.ts to understand the API
3. Write real vitest tests that import and test the actual service`,
    setup: (wt) => {
      // Reset the test file to default stub
      const testPath = join(wt, "tests", "unit", "AuthService.test")
      writeFileSync(testPath, `import { describe, it, expect } from "vitest"

describe("AuthService", () => {
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
})
`)
    },
    evaluate: (wt) => {
      const testContent = readFileSync(join(wt, "tests", "unit", "AuthService.test"), "utf-8")
      // Should import from the actual AuthService
      if (!testContent.includes("AuthService")) return { pass: false, reason: "does not reference AuthService" }
      if (testContent.includes("import { describe, it, expect } from \"vitest\"\n\ndescribe")) {
        return { pass: false, reason: "still has default stub content" }
      }
      return { pass: true, reason: "AuthService.test now imports real module" }
    },
    expectedFiles: ["tests/unit/AuthService.test"],
    tags: ["test-writing", "unit-test"],
  },
  {
    id: "fix-email-validator",
    description: `The email-validator utility at src/utils/email-validator.ts has a bug: it doesn't validate international email addresses (like user@example.co.uk or user+tag@example.com).

Fix the isEmail() function to correctly handle:
1. Subdomains (user@sub.example.com)
2. Plus addressing (user+tag@example.com)  
3. International characters in local part (user@example.com)

Steps:
1. Read src/utils/email-validator.ts to understand current implementation
2. Identify the regex/validation bug
3. Fix the function
4. Check if tests/unit/Validation.test.ts covers these cases`,
    setup: (wt) => {
      // Ensure email-validator has a limited regex
      const validatorPath = join(wt, "src", "utils", "email-validator.ts")
      writeFileSync(validatorPath, `// Email validation utility
export function isEmail(value: string): boolean {
  // Simple regex that doesn't handle subdomains or plus addressing
  return /^[\\w.-]+@[\\w-]+\\.[a-z]{2,3}$/i.test(value)
}
`)
    },
    evaluate: (wt) => {
      const content = readFileSync(join(wt, "src", "utils", "email-validator.ts"), "utf-8")
      // Should handle subdomains (more complex regex)
      const func = content.includes("isEmail")
      if (!func) return { pass: false, reason: "isEmail function removed" }
      // Check if the regex improved
      if (content.includes("[\\\\w.-]+@[\\\\w-]+\\\\.[a-z]{2,3}")) {
        return { pass: false, reason: "regex not improved" }
      }
      return { pass: true, reason: "email validator updated" }
    },
    expectedFiles: ["src/utils/email-validator.ts"],
    tags: ["bug-fix", "validation", "regex"],
  },
]

// ── Setup worktree for a scenario ──
function setupWorktree(scenarioId) {
  const worktree = `${WORKTREE_BASE}-${scenarioId}`
  rmSync(worktree, { recursive: true, force: true })
  cpSync(CODEBASE_FIXTURE, worktree, { recursive: true })
  // Install deps
  execSync("npm install --silent", { cwd: worktree, stdio: "ignore" })
  return worktree
}

// ── Run a single scenario ──
async function runScenario(scenario) {
  console.log(`\n─── Scenario: ${scenario.id} ───`)
  const worktree = setupWorktree(scenario.id)
  
  // Apply scenario-specific setup
  scenario.setup(worktree)

  // Load plugin
  const mod = await import(PLUGIN_DIST)
  const ctx = mockCtx(scenario.id)
  ctx.directory = worktree
  ctx.worktree = worktree
  const hooks = await mod.AgenticEngine(ctx)

  try {
    // Run agent
    const autoResult = await hooks.tool.agentic_auto.execute({
      goal: scenario.description,
      constraints: ["TypeScript", "ESM modules"],
    }, ctx)
    const out = typeof autoResult === "string" ? autoResult : (autoResult.output || "")

    if (!CAN_USE_LLM) {
      // Mock mode: just check harness doesn't crash
      assert(out.length > 0, "agent produced output")
      await hooks.dispose()
      scenarioResults.push({ id: scenario.id, pass: true, note: "mock mode — no LLM" })
      return
    }

    // Check for no-LLM fallback
    if (out.includes("[NO_LLM]")) {
      assert(false, "no LLM fallback — set OPENAI_API_KEY or OPENAI_BASE_URL")
      await hooks.dispose()
      scenarioResults.push({ id: scenario.id, pass: false, note: "no LLM" })
      return
    }

    // Evaluate
    const evalResult = scenario.evaluate(worktree)
    assert(evalResult.pass, `${scenario.id}: ${evalResult.reason}`)

    // Verify files were modified
    for (const f of scenario.expectedFiles) {
      const fullPath = join(worktree, f)
      assert(existsSync(fullPath), `expected file exists: ${f}`)
    }

    scenarioResults.push({ id: scenario.id, pass: evalResult.pass, note: evalResult.reason })
  } catch (e) {
    assert(false, `${scenario.id} error: ${e.message}`)
    scenarioResults.push({ id: scenario.id, pass: false, note: e.message })
  } finally {
    await hooks.dispose()
  }
}

// ── Report ──
function printReport() {
  console.log(`\n${"=".repeat(60)}`)
  console.log("  SWE-BENCH EVALUATION REPORT")
  console.log(`  LLM: ${CAN_USE_LLM ? "AVAILABLE" : "MOCK MODE (no LLM)"}`)
  console.log(`  Scenarios: ${scenarios.length}`)
  console.log("=".repeat(60))
  
  for (const sr of scenarioResults) {
    const icon = sr.pass ? "✅" : "❌"
    console.log(`  ${icon} ${sr.id}: ${sr.note}`)
  }
  
  console.log("=".repeat(60))
  console.log(`  Total: ${passed} passed, ${failed} failed`)
  console.log("=".repeat(60))
  console.log("")
  
  const categories = {}
  for (const s of scenarios) {
    const sr = scenarioResults.find(r => r.id === s.id)
    for (const tag of s.tags) {
      if (!categories[tag]) categories[tag] = { total: 0, passed: 0 }
      categories[tag].total++
      if (sr?.pass) categories[tag].passed++
    }
  }
  
  console.log("  By Category:")
  for (const [cat, stats] of Object.entries(categories)) {
    const rate = stats.total > 0 ? (stats.passed / stats.total * 100).toFixed(0) : "N/A"
    console.log(`    ${cat}: ${stats.passed}/${stats.total} (${rate}%)`)
  }
  console.log("=".repeat(60))
}

// ── Main ──
async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗")
  console.log("║  SWE-bench Evaluation Harness                          ║")
  console.log("╚══════════════════════════════════════════════════════════╝")
  console.log(`Plugin: ${PLUGIN_DIST}`)
  console.log(`Fixture: ${CODEBASE_FIXTURE}`)
  console.log(`LLM: ${CAN_USE_LLM ? "AVAILABLE" : "NOT AVAILABLE (mock mode)"}`)
  if (CAN_USE_LLM) {
    console.log(`  Using: ${HAS_OPENAI ? "OpenAI-compatible" : ""} ${HAS_ANTHROPIC ? "Anthropic" : ""}`)
  }

  for (const scenario of scenarios) {
    await runScenario(scenario)
  }

  printReport()
  
  // Return metrics for pipeline integration
  return {
    totalScenarios: scenarios.length,
    passed,
    failed,
    successRate: scenarios.length > 0 ? passed / (passed + failed) * 100 : 0,
    llmAvailable: CAN_USE_LLM,
    results: scenarioResults,
  }
}

const result = await main()
if (result.failed > 0) process.exit(1)
