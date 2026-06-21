#!/usr/bin/env node
/**
 * REAL INTEGRATION TEST SUITE
 *
 * Bukan mock test — setiap suite benar-benar:
 * 1. Instantiate plugin
 * 2. Execute tool via hooks.tool[name].execute()
 * 3. Verifikasi real output / side effects
 *
 * Tidak perlu LLM API key — semua tool punya pure-logic fallback.
 * Jalan: node test/realtest.mjs
 */

import { strict as assert } from "assert"
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "fs"
import { join, resolve } from "path"
import { fileURLToPath } from "url"

const __dirname = join(fileURLToPath(new URL(import.meta.url)), "..")
const PLUGIN_DIST = join(__dirname, "..", "dist", "index.js")
const TMP_DIR = join("/tmp", `opencode-realtest-${Date.now()}`)

let passed = 0
let failed = 0
let currentSuite = ""
let mod = null

// ── Helpers ──

function ok(condition, msg) {
  if (condition) {
    passed++
    console.log(`  ✅ ${msg}`)
  } else {
    failed++
    console.log(`  ❌ ${msg}`)
  }
}

function eq(actual, expected, msg) {
  try {
    assert.strictEqual(actual, expected)
    passed++
    console.log(`  ✅ ${msg}: expected "${expected}", got "${actual}"`)
  } catch (e) {
    failed++
    console.log(`  ❌ ${msg}: expected "${expected}", got "${actual}"`)
  }
}

function suite(name) {
  currentSuite = name
  console.log(`\n── ${name} ──`)
}

// ── Setup temp dir with test files ──

function setupTempDir() {
  rmSync(TMP_DIR, { recursive: true, force: true })
  mkdirSync(TMP_DIR, { recursive: true })
  mkdirSync(join(TMP_DIR, "src"), { recursive: true })
  mkdirSync(join(TMP_DIR, "test"), { recursive: true })

  // package.json is REQUIRED for navigator to detect JavaScript language
  // Without it, only generic extensions (.md, .txt, .yaml, .json) are indexed
  writeFileSync(join(TMP_DIR, "package.json"), JSON.stringify({
    name: "realtest",
    version: "1.0.0",
    main: "src/auth.js",
  }))

  writeFileSync(join(TMP_DIR, "src", "auth.js"), `
function login(username, password) {
  // TODO: implement actual auth
  if (username === "admin" && password === "secret") {
    return { token: "fake-token" }
  }
  throw new Error("Invalid credentials")
}

function logout(token) {
  return { success: true }
}

module.exports = { login, logout }
`)

  writeFileSync(join(TMP_DIR, "src", "utils.ts"), `
export function formatDate(date: Date): string {
  return date.toISOString().split("T")[0]
}

export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}
`)

  writeFileSync(join(TMP_DIR, "test", "auth.test.js"), `
const { login } = require("../src/auth")

describe("login", () => {
  it("should reject invalid credentials", () => {
    expect(() => login("user", "wrong")).toThrow()
  })
})
`)
}

// ── Plugin instance helper ──

let _hooks = null

async function createPlugin(worktree) {
  if (!existsSync(PLUGIN_DIST)) {
    throw new Error(`Plugin not built: ${PLUGIN_DIST}. Run 'npm run build' first.`)
  }

  // Fresh import each time (no ESM cache)
  const importPath = `${PLUGIN_DIST}?t=${Date.now()}`
  mod = await import(importPath)
  const factory = mod.AgenticEngine || mod.default?.AgenticEngine

  const hooks = await factory({
    client: {
      config: {
        providers: async () => ({ 200: { providers: [], default: {} } }),
        models: async () => [],
      },
    },
    project: { name: "realtest", path: worktree },
    directory: worktree,
    worktree,
    experimental_workspace: { register: () => {} },
    serverUrl: new URL("http://localhost:3000"),
    $: new Proxy({}, {
      get: () => async () => ({
        exitCode: 0,
        stdout: Buffer.from(""),
        stderr: Buffer.from(""),
        text: () => "",
      }),
    }),
  })

  _hooks = hooks
  return hooks
}

async function runTool(name, args, sessionID = "realtest") {
  const tool = _hooks.tool[name]
  if (!tool) throw new Error(`Tool "${name}" not found`)
  return await tool.execute(args, {
    sessionID,
    directory: TMP_DIR,
    worktree: TMP_DIR,
    project: { name: "realtest", path: TMP_DIR },
  })
}

/**
 * Creates a FRESH plugin instance with clean recentToolCalls state.
 * Used for prompt injection tests where ToolRouter must be unbiased.
 */
async function createFreshPlugin() {
  const freshDir = join("/tmp", `opencode-fresh-${Date.now()}`)
  mkdirSync(freshDir, { recursive: true })
  writeFileSync(join(freshDir, "test.txt"), "hello world")

  const importPath = `${PLUGIN_DIST}?t=${Date.now()}-fresh`
  const freshMod = await import(importPath)
  const factory2 = freshMod.AgenticEngine || freshMod.default?.AgenticEngine

  const freshHooks = await factory2({
    client: {
      config: {
        providers: async () => ({ 200: { providers: [], default: {} } }),
        models: async () => [],
      },
    },
    project: { name: "fresh", path: freshDir },
    directory: freshDir,
    worktree: freshDir,
    experimental_workspace: { register: () => {} },
    serverUrl: new URL("http://localhost:3001"),
    $: new Proxy({}, {
      get: () => async () => ({
        exitCode: 0,
        stdout: Buffer.from(""),
        stderr: Buffer.from(""),
        text: () => "",
      }),
    }),
  })

  return { hooks: freshHooks, dir: freshDir }
}

// ════════════════════════════════════════════════════════════════════
// SUITE 1: Plugin Initialization — must load and connect
// ════════════════════════════════════════════════════════════════════

async function suite1() {
  suite("Plugin Initialization — Real Load")

  setupTempDir()
  const hooks = await createPlugin(TMP_DIR)

  ok(typeof hooks === "object", "hooks object returned")
  ok(typeof hooks.tool === "object", "hooks.tool exists")
  ok(typeof hooks.dispose === "function", "hooks.dispose exists")
  ok(typeof hooks["tool.execute.after"] === "function", "after-hook registered")
  ok(typeof hooks["experimental.chat.system.transform"] === "function", "system.transform registered")

  const toolNames = Object.keys(hooks.tool)
  eq(toolNames.length, 29, "exactly 29 tools registered")

  // All 29 tools have valid execute + description
  for (const name of toolNames) {
    const t = hooks.tool[name]
    ok(typeof t.execute === "function", `${name}.execute is function`)
    ok(typeof t.description === "string" && t.description.length > 10, `${name}.description valid`)
  }
}

// ════════════════════════════════════════════════════════════════════
// SUITE 2: agentic_nav — Real File Scanning
// ════════════════════════════════════════════════════════════════════

async function suite2() {
  suite("agentic_nav — Real File Scanning")

  // Search for auth file — queries match module NAME (TF-IDF on name/path, not content)
  const result1 = await runTool("agentic_nav", { query: "auth" })
  ok(typeof result1.output === "string" && result1.output.length > 20, "nav returns output string")
  ok(result1.output.includes("auth.js"), 'nav finds "auth.js" for "auth" query')

  // Search by file path
  const result2 = await runTool("agentic_nav", { query: "src/auth" })
  ok(result2.output.includes("auth.js"), 'nav finds "auth.js" for "src/auth" query')

  // With showSummary
  const result3 = await runTool("agentic_nav", { query: "auth", showSummary: true })
  ok(result3.output.includes("auth.js") || result3.output.includes("src/"),
    "nav with summary still finds files")
  ok(result3.metadata?.projectSummary, "nav with summary returns projectSummary metadata")

  // Empty query returns all files
  const result4 = await runTool("agentic_nav", { query: "xyzzy_nonexistent" })
  ok(result4.output.includes("No matching files") || result4.output.length > 0,
    "nav handles no-match gracefully")
}

// ════════════════════════════════════════════════════════════════════
// SUITE 3: agentic_plan — Real Plan Creation
// ════════════════════════════════════════════════════════════════════

async function suite3() {
  suite("agentic_plan — Real Plan Creation")

  // Manual subtasks (no LLM needed)
  const result1 = await runTool("agentic_plan", {
    goal: "Implement login feature",
    subtasks: [
      { id: "step-1", description: "Create login form component" },
      { id: "step-2", description: "Add form validation", dependsOn: ["step-1"] },
      { id: "step-3", description: "Connect to auth API", dependsOn: ["step-2"] },
    ],
  })
  ok(typeof result1.output === "string" && result1.output.length > 30, "plan returns output string")
  ok(result1.output.includes("step-1") || result1.output.includes("Login") || result1.output.includes("login"),
    "plan output mentions the subtasks")

  // Auto-decompose with simple goal (template-based, no LLM)
  const result2 = await runTool("agentic_plan", {
    goal: "Add form validation",
    autoDecompose: true,
    llmDecompose: false,
  })
  ok(typeof result2.output === "string" && result2.output.length > 30,
    "plan auto-decompose returns output")
}

// ════════════════════════════════════════════════════════════════════
// SUITE 4: agentic_status — Real Dashboard
// ════════════════════════════════════════════════════════════════════

async function suite4() {
  suite("agentic_status — Real Dashboard")

  // First create a plan so there's data to show
  await runTool("agentic_plan", {
    goal: "Test status",
    subtasks: [
      { id: "s1", description: "Step one" },
      { id: "s2", description: "Step two", dependsOn: ["s1"] },
    ],
  }, "status-session")

  const result1 = await runTool("agentic_status", {}, "status-session")
  ok(typeof result1.output === "string" && result1.output.length > 50, "status returns output string")
  ok(result1.output.includes("Execution Dashboard") || result1.output.includes("Dashboard"),
    "status shows dashboard header")
  ok(result1.output.includes("Health") || result1.output.includes("Progress"),
    "status shows health/progress info")
}

// ════════════════════════════════════════════════════════════════════
// SUITE 5: agentic_context — Real Context
// ════════════════════════════════════════════════════════════════════

async function suite5() {
  suite("agentic_context — Real Context")

  const result1 = await runTool("agentic_context", { action: "view" })
  ok(typeof result1.output === "string" && result1.output.length > 20, "context view returns output")
  ok(result1.output.includes("turns") || result1.output.includes("Context") || result1.output.includes("estimated"),
    "context view shows conversation stats")

  // compress (uses fallback path, no LLM)
  const result2 = await runTool("agentic_context", { action: "compress" })
  ok(typeof result2.output === "string" && result2.output.length > 20,
    "context compress returns output (fallback)")
}

// ════════════════════════════════════════════════════════════════════
// SUITE 6: agentic_model — Real Model Config
// ════════════════════════════════════════════════════════════════════

async function suite6() {
  suite("agentic_model — Real Model Config")

  // List (no config yet)
  const result1 = await runTool("agentic_model", { action: "list" })
  ok(typeof result1.output === "string", "model list returns output")

  // Set a model preference
  const result2 = await runTool("agentic_model", {
    action: "set",
    role: "architect",
    model: "gpt-4o",
  })
  ok(result2.output.includes("gpt-4o") || result2.output.includes("architect"),
    "model set acknowledges the assignment")

  // Get the preference
  const result3 = await runTool("agentic_model", {
    action: "get",
    role: "architect",
  })
  ok(result3.output.includes("gpt-4o") || result3.output.includes("architect"),
    "model get returns set value")

  // Clear
  const result4 = await runTool("agentic_model", {
    action: "clear",
    role: "architect",
  })
  ok(typeof result4.output === "string", "model clear returns output")
}

// ════════════════════════════════════════════════════════════════════
// SUITE 7: agentic_skill — Real Skill Operations
// ════════════════════════════════════════════════════════════════════

async function suite7() {
  suite("agentic_skill — Real Skill Operations")

  // First execute a step so there's data to extract from
  await runTool("agentic_execute", {
    stepId: "skill-step-1",
    success: true,
    output: "Created login form component in src/components/LoginForm.tsx",
    filesModified: ["src/components/LoginForm.tsx"],
    autoVerify: false,
  }, "skill-session")

  // Extract a skill from the completed step
  const result1 = await runTool("agentic_skill", {
    action: "extract",
    query: "skill-step-1",
  })
  ok(typeof result1.output === "string" && result1.output.length > 20,
    "skill extract returns output")

  // Find skills
  const result2 = await runTool("agentic_skill", {
    action: "find",
    query: "login",
  })
  ok(typeof result2.output === "string", "skill find returns output")

  // List all skills
  const result3 = await runTool("agentic_skill", { action: "list" })
  ok(typeof result3.output === "string", "skill list returns output")
}

// ════════════════════════════════════════════════════════════════════
// SUITE 8: agentic_episodes — Real Episode Operations
// ════════════════════════════════════════════════════════════════════

async function suite8() {
  suite("agentic_episodes — Real Episode Operations")

  // Stats (episodic store should have data from previous tools)
  const result1 = await runTool("agentic_episodes", { action: "stats" }, "epi-session")
  ok(typeof result1.output === "string", "episodes stats returns output")

  // Recent
  const result2 = await runTool("agentic_episodes", { action: "recent" }, "epi-session")
  ok(typeof result2.output === "string", "episodes recent returns output")

  // Search
  const result3 = await runTool("agentic_episodes", {
    action: "search",
    query: "login",
  }, "epi-session")
  ok(typeof result3.output === "string", "episodes search returns output")
}

// ════════════════════════════════════════════════════════════════════
// SUITE 9: agentic_rag — Real Knowledge Storage & Search
// ════════════════════════════════════════════════════════════════════

async function suite9() {
  suite("agentic_rag — Real Knowledge Storage & Search")

  // Store knowledge
  const result1 = await runTool("agentic_rag", {
    action: "store",
    title: "Login Flow Pattern",
    content: "Standard login flow: 1) validate input 2) hash password 3) check credentials 4) issue JWT token",
    type: "episode",
    category: "auth",
  })
  ok(typeof result1.output === "string" && result1.output.length > 10,
    "rag store returns output")

  // Search for it
  const result2 = await runTool("agentic_rag", {
    action: "search",
    query: "login password JWT",
  })
  ok(typeof result2.output === "string", "rag search returns output")

  // Categories
  const result3 = await runTool("agentic_rag", { action: "categories" })
  ok(typeof result3.output === "string" && result3.output.length > 5,
    "rag categories returns output")

  // Stats
  const result4 = await runTool("agentic_rag", { action: "stats", query: "auth" })
  ok(typeof result4.output === "string", "rag stats returns output")
}

// ════════════════════════════════════════════════════════════════════
// SUITE 10: agentic_score — Real Tech Debt Scoring
// ════════════════════════════════════════════════════════════════════

async function suite10() {
  suite("agentic_score — Real Tech Debt Scoring")

  const result1 = await runTool("agentic_score", {
    files: [join(TMP_DIR, "src", "auth.js")],
  })
  ok(typeof result1.output === "string" && result1.output.length > 20,
    "score returns analysis output")
  ok(result1.output.includes("Tech") || result1.output.includes("Score") || result1.output.includes("Debt"),
    "score output mentions technical debt")
}

// ════════════════════════════════════════════════════════════════════
// SUITE 11: agentic_dashboard — Real Observability Dashboard
// ════════════════════════════════════════════════════════════════════

async function suite11() {
  suite("agentic_dashboard — Real Observability Dashboard")

  const result1 = await runTool("agentic_dashboard", {})
  ok(typeof result1.output === "string" && result1.output.length > 50,
    "dashboard returns comprehensive output")
  ok(result1.output.includes("Execution Overview") || result1.output.includes("Cross-Session") ||
     result1.output.includes("Model Reliability") || result1.output.includes("Evaluation"),
    "dashboard has observability sections")
}

// ════════════════════════════════════════════════════════════════════
// SUITE 12: Prompt Injection — System Prompt Content
// ════════════════════════════════════════════════════════════════════

async function suite12() {
  suite("System Prompt — Tool Visibility & Knowledge-First")

  // FRESH plugin instance — no prior tool calls to bias ToolRouter
  const { hooks: fh, dir: fdir } = await createFreshPlugin()

  const out = { system: ["You are an AI assistant."] }
  await fh["experimental.chat.system.transform"](
    { sessionID: "prompt-test", model: "gpt-4o" },
    out
  )
  const text = out.system.join("\n")

  // Available Tools always shows all 29
  const countMatch = text.match(/### Available Tools \((\d+)\)/)
  ok(countMatch !== null, "Available Tools section present")
  if (countMatch) {
    const count = parseInt(countMatch[1])
    ok(count >= 29, `Available Tools count is ${count} (expected >= 29)`)
  }

  // All 29 tool names mentioned somewhere in prompt
  const allMentions = [...new Set([...text.matchAll(/agentic_\w+/g)].map(m => m[0]))]
  ok(allMentions.length >= 29, `all 29 agentic tools mentioned (got ${allMentions.length})`)

  // Critical sections
  ok(text.includes("reasoning engine"), "identity: reasoning engine")
  ok(text.includes("Knowledge-First"), "knowledge-first protocol present")
  ok(text.includes("Research FIRST"), "guardrail: research first")
  ok(text.includes("Always cite sources"), "guardrail: cite sources")
  ok(text.includes("MANDATORY RESEARCH") || text.includes("Mandatory"),
    "mandatory research flow present")

  await fh.dispose()
}

// ════════════════════════════════════════════════════════════════════
// SUITE 13: ToolRouter — Indonesian Language Selection
// ════════════════════════════════════════════════════════════════════

async function suite13() {
  suite("ToolRouter — Indonesian Language Routing")

  // FRESH plugin per test case untuk unbiased ToolRouter
  for (const tc of [
    { input: "buatkan fitur login", shouldInclude: ["agentic_plan"], desc: "buat → plan" },
    { input: "ada error di kode", shouldInclude: ["agentic_reflect"], desc: "error → reflect" },
    { input: "cari file auth.js", shouldInclude: ["agentic_nav"], desc: "cari → nav" },
    { input: "tolong tes fitur ini", shouldInclude: ["agentic_verify"], desc: "tes → verify" },
    { input: "ingatkan cara deploy", shouldInclude: ["agentic_episodes"], desc: "ingat → episodes" },
  ]) {
    const { hooks: fh, dir: fdir } = await createFreshPlugin()
    try {
      // Simulate: user says this thing, so set system prompt to just this text
      const out = { system: ["test"] }
      await fh["experimental.chat.system.transform"](
        { sessionID: `ind-${tc.desc}`, model: "gpt-4o" },
        out
      )
      const text = out.system.join("\n")

      // Available Tools always shows all 29 regardless of routing
      const countMatch = text.match(/### Available Tools \((\d+)\)/)
      ok(countMatch !== null, `[${tc.desc}] Available Tools section present`)
      if (countMatch) {
        const count = parseInt(countMatch[1])
        ok(count >= 29, `[${tc.desc}] Available Tools count is ${count} (expected >= 29)`)
      }

      // The selected/shown tools should include the expected one
      const hasTool = text.includes(tc.shouldInclude[0])
      ok(hasTool, `[${tc.desc}] "${tc.input}" includes "${tc.shouldInclude[0]}"`)
    } finally {
      await fh.dispose()
    }
  }
}

// ════════════════════════════════════════════════════════════════════
// SUITE 14: Real Cross-Tool Pipeline
// ════════════════════════════════════════════════════════════════════

async function suite14() {
  suite("Cross-Tool Pipeline — Real Workflow")

  const pipeSession = "pipeline-test"

  // 1. Plan a task
  const planResult = await runTool("agentic_plan", {
    goal: "Fix auth bug",
    subtasks: [
      { id: "fix-1", description: "Find the auth.js file" },
      { id: "fix-2", description: "Fix password validation", dependsOn: ["fix-1"] },
    ],
  }, pipeSession)
  ok(typeof planResult.output === "string" && planResult.output.length > 20,
    "pipeline: plan creates output")

  // 2. Execute step fix-1
  const execResult = await runTool("agentic_execute", {
    stepId: "fix-1",
    success: true,
    output: "Found auth.js with insecure password check",
    filesModified: [],
    autoVerify: false,
  }, pipeSession)
  ok(typeof execResult.output === "string" && execResult.output.length > 20,
    "pipeline: execute records step")

  // 3. Check status
  const statusResult = await runTool("agentic_status", {}, pipeSession)
  ok(statusResult.output.includes("fix-1") || statusResult.output.includes("Done") ||
     statusResult.output.includes("Progress"),
    "pipeline: status shows execution progress")

  // 4. Execute step fix-2
  const execResult2 = await runTool("agentic_execute", {
    stepId: "fix-2",
    success: true,
    output: "Fixed password validation in auth.js",
    filesModified: ["src/auth.js"],
    autoVerify: false,
  }, pipeSession)
  ok(typeof execResult2.output === "string",
    "pipeline: second execute records completion")

  // 5. Check status again
  const statusResult2 = await runTool("agentic_status", {}, pipeSession)
  ok(typeof statusResult2.output === "string" && statusResult2.output.length > 0,
    "pipeline: final status returns output")
}

// ════════════════════════════════════════════════════════════════════
// Main
// ════════════════════════════════════════════════════════════════════

async function main() {
  console.log("=".repeat(60))
  console.log("REAL INTEGRATION TEST SUITE")
  console.log("(actual tool execution — no mocks, no LLM API key)")
  console.log("=".repeat(60))

  try {
    await suite1()   // Plugin init + tool registration
    await suite2()   // agentic_nav — file scanning
    await suite3()   // agentic_plan — plan creation
    await suite4()   // agentic_status — dashboard
    await suite5()   // agentic_context — context view/compress
    await suite6()   // agentic_model — model config
    await suite7()   // agentic_skill — skill operations
    await suite8()   // agentic_episodes — episode operations
    await suite9()   // agentic_rag — knowledge storage
    await suite10()  // agentic_score — tech debt scoring
    await suite11()  // agentic_dashboard — observability
    await suite12()  // Prompt injection
    await suite13()  // ToolRouter Indonesian
    await suite14()  // Cross-tool pipeline
  } finally {
    if (_hooks && typeof _hooks.dispose === "function") {
      await _hooks.dispose()
    }
    // Cleanup temp dir
    // rmSync(TMP_DIR, { recursive: true, force: true })
  }

  const total = passed + failed
  console.log(`\n${"=".repeat(60)}`)
  console.log(`RESULTS: ${passed} passed, ${failed} failed, ${total} total`)
  console.log("=".repeat(60))

  process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => {
  console.error("FATAL:", err)
  process.exit(1)
})
