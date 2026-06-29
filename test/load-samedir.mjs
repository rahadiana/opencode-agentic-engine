// test/load-samedir.mjs — Simulates loading the plugin from the same directory
// as the project workspace (the scenario that causes crashes during dev).

import { existsSync, readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { sdkMockClient } from "./mock-sdk-client.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const PLUGIN_DIST = process.env.PLUGIN_DIST || resolve(__dirname, "..", "dist", "index.js")
const WORKSPACE = process.env.WORKSPACE || "/tmp/samedir-test"

console.log(`Plugin dist: ${PLUGIN_DIST}`)
console.log(`Workspace:   ${WORKSPACE}`)

let passed = 0
let failed = 0
function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++ }
  else { console.error(`  FAIL: ${msg}`); failed++; process.exitCode = 1 }
}

function ctx(id) {
  return {
    sessionID: id, messageID: `m-${id}`, agent: "test",
    directory: WORKSPACE, worktree: WORKSPACE,
    abort: new AbortController().signal, metadata: () => {}, ask: async () => {},
  }
}

// 1. Plugin exists
assert(existsSync(PLUGIN_DIST), "plugin dist found")

// 2. Import
let mod
try {
  mod = await import(PLUGIN_DIST)
  assert(true, "module loaded")
} catch (e) {
  assert(false, `module import: ${e.message}`)
}

assert(typeof mod.AgenticEngine === "function", "AgenticEngine exported")

// 3. Initialize
let hooks
try {
  hooks = await mod.AgenticEngine({
    client: sdkMockClient(),
    project: { name: "test", path: WORKSPACE },
    directory: WORKSPACE,
    worktree: WORKSPACE,
    experimental_workspace: { register: () => {} },
    serverUrl: new URL("http://localhost:3000"),
    $: new Proxy({}, {
      get() { return async () => ({ exitCode: 0, text: () => "", stdout: Buffer.from(""), stderr: Buffer.from("") }) },
    }),
  })
  assert(true, "AgenticEngine initialized")
} catch (e) {
  assert(false, `init threw: ${e.message}\n${e.stack}`)
}

// 4. All core tools registered
const expected = [
  "agentic_plan", "agentic_nav", "agentic_execute", "agentic_reflect",
  "agentic_verify", "agentic_status", "agentic_context", "agentic_snapshot",
  "agentic_pr", "agentic_score", "agentic_delegate", "agentic_pipeline",
  "agentic_message", "agentic_parallel",
  "agentic_skill", "agentic_model", "agentic_budget", "agentic_episodes", "agentic_guard",
  "agentic_evolve",
  "agentic_auto",
  "agentic_debate", "agentic_router",
  "agentic_clean", "agentic_rag", "agentic_mcp", "agentic_finetune",
]
const actual = Object.keys(hooks.tool || {})
for (const name of expected) {
  assert(actual.includes(name) && typeof hooks.tool[name].execute === "function", `tool "${name}" registered`)
}

// 5. Full E2E workflow: plan → execute → fail → reflect → retry → complete → verify
const sid = "e2e-docker"
const planR = await hooks.tool.agentic_plan.execute({
  goal: "Docker E2E: implement input sanitizer",
  constraints: ["TypeScript", "No external deps"],
  subtasks: [
    { id: "e1", description: "Create sanitizer types", dependsOn: [], verificationCriteria: ["Types compile"] },
    { id: "e2", description: "Implement sanitize() function", dependsOn: ["e1"], verificationCriteria: ["Tests pass"] },
    { id: "e3", description: "Add unit tests", dependsOn: ["e2"], verificationCriteria: ["All tests pass"] },
  ],
}, ctx(sid))
assert(typeof planR === "object" && planR.output.includes("Plan Created"), "plan created")

// Execute e1 successfully
const exec1 = await hooks.tool.agentic_execute.execute({
  stepId: "e1", success: true, output: "Created types in sanitizer.ts", filesModified: ["sanitizer.ts"],
}, ctx(sid))
assert(exec1.output.includes("SUCCESS"), "e1 success")

// Execute e2 successfully
const exec2 = await hooks.tool.agentic_execute.execute({
  stepId: "e2", success: true, output: "Implemented sanitize()", filesModified: ["sanitizer.ts"],
}, ctx(sid))
assert(exec2.output.includes("SUCCESS"), "e2 success")

// Execute e3 successfully
const exec3 = await hooks.tool.agentic_execute.execute({
  stepId: "e3", success: true, output: "Added tests", filesModified: ["sanitizer.test.ts"],
}, ctx(sid))
assert(exec3.output.includes("SUCCESS"), "e3 success")
assert(exec3.output.includes("All steps complete"), "all steps complete after e3")

// Final verify
const vfy = await hooks.tool.agentic_verify.execute({ stepId: "e2e-final" }, ctx(sid))
assert(vfy.output.length > 0, "final verify returns output")

// Status dashboard
const status = await hooks.tool.agentic_status.execute({}, ctx(sid))
assert(status.output.includes("Complete"), "status shows complete")

// 6. Test failure + reflect + retry cycle
const sid2 = "e2e-fail-retry"
await hooks.tool.agentic_plan.execute({
  goal: "Retry test",
  subtasks: [{ id: "f1", description: "Failing step", dependsOn: [] }],
}, ctx(sid2))

// Fail
const fail1 = await hooks.tool.agentic_execute.execute({
  stepId: "f1", success: false, output: "Cannot find module './nonexistent'", error: "Module not found",
}, ctx(sid2))
assert(fail1.output.includes("FAILED") && fail1.output.includes("Error Analysis"), "failure shows analysis")

// Reflect
const refl = await hooks.tool.agentic_reflect.execute({ stepId: "f1" }, ctx(sid2))
assert(refl.output.includes("import") || refl.output.includes("module"), "reflect identifies import error")

// Retry with success
const retry = await hooks.tool.agentic_execute.execute({
  stepId: "f1", success: true, output: "Fixed import path", filesModified: ["index.ts"],
}, ctx(sid2))
assert(retry.output.includes("SUCCESS"), "retry succeeds")

// 7. Blocked step visibility
const sid3 = "e2e-blocked"
await hooks.tool.agentic_plan.execute({
  goal: "Blocked test",
  subtasks: [
    { id: "b1", description: "First", dependsOn: [] },
    { id: "b2", description: "Second", dependsOn: ["b1"] },
    { id: "b3", description: "Third", dependsOn: ["b1", "b2"] },
  ],
}, ctx(sid3))
const statBlk = await hooks.tool.agentic_status.execute({}, ctx(sid3))
assert(statBlk.output.includes("Blocked"), "status shows blocked steps")

// 8. Max retries exhausted
const sid4 = "e2e-max-retry"
await hooks.tool.agentic_plan.execute({
  goal: "Max retry test",
  subtasks: [{ id: "m1", description: "Will fail", dependsOn: [] }],
}, ctx(sid4))
for (let i = 0; i < 3; i++) {
  await hooks.tool.agentic_execute.execute({
    stepId: "m1", success: false, output: `Fail ${i + 1}`, error: `error-${i}`,
  }, ctx(sid4))
}
const refMax = await hooks.tool.agentic_reflect.execute({ stepId: "m1" }, ctx(sid4))
assert(refMax.output.includes("No retries remaining") || refMax.output.includes("max") || refMax.output.includes("remaining"), "reflect shows retries exhausted")

// 9. Dispose + trace check
await hooks.dispose()
const tracePath = `${WORKSPACE}/.agentic/trace.jsonl`
assert(existsSync(tracePath), "trace file created")

const rawContent = readFileSync(tracePath, "utf-8")
console.error(`  [TRACE DEBUG] file size: ${rawContent.length}, first 100: ${JSON.stringify(rawContent.slice(0, 100))}`)
const lines = rawContent.trim().split("\n").filter(Boolean)
console.error(`  [TRACE DEBUG] lines after filter: ${lines.length}`)
assert(lines.length >= 3, `at least 3 trace entries (got ${lines.length})`)

console.log(`\n=== SAME-DIR LOAD TEST: ${passed} passed, ${failed} failed ===`)
if (failed > 0) process.exit(1)
