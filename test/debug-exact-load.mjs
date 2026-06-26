// Exact copy of load-samedir logic but in a new file
import { existsSync, readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { sdkMockClient } from "./mock-sdk-client.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const PLUGIN_DIST = resolve(__dirname, "..", "dist", "index.js")
const WORKSPACE = "/tmp/samedir-exact-copy"

console.log(`Plugin dist: ${PLUGIN_DIST}`)
console.log(`Workspace:   ${WORKSPACE}`)

let passed = 0, failed = 0
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

assert(existsSync(PLUGIN_DIST), "plugin dist found")

let mod
try {
  mod = await import(PLUGIN_DIST)
  assert(true, "module loaded")
} catch (e) {
  assert(false, `module import: ${e.message}`)
}

assert(typeof mod.AgenticEngine === "function", "AgenticEngine exported")

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

// Full E2E like load-samedir
const sid = "e2e"
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

const exec1 = await hooks.tool.agentic_execute.execute({
  stepId: "e1", success: true, output: "Created types in sanitizer.ts", filesModified: ["sanitizer.ts"],
}, ctx(sid))
assert(exec1.output.includes("SUCCESS"), "e1 success")

const exec2 = await hooks.tool.agentic_execute.execute({
  stepId: "e2", success: true, output: "Implemented sanitize()", filesModified: ["sanitizer.ts"],
}, ctx(sid))
assert(exec2.output.includes("SUCCESS"), "e2 success")

const exec3 = await hooks.tool.agentic_execute.execute({
  stepId: "e3", success: true, output: "Added tests", filesModified: ["sanitizer.test.ts"],
}, ctx(sid))
assert(exec3.output.includes("SUCCESS"), "e3 success")

const vfy = await hooks.tool.agentic_verify.execute({ stepId: "e2e-final" }, ctx(sid))
assert(vfy.output.length > 0, "final verify returns output")

// Check trace BEFORE dispose
const tracePath = WORKSPACE + "/.agentic/trace.jsonl"
console.log("INTERIM check — trace exists:", existsSync(tracePath))
if (existsSync(tracePath)) {
  const content = readFileSync(tracePath, "utf-8")
  const lines = content.trim().split("\n").filter(Boolean)
  console.log("INTERIM — trace lines:", lines.length)
  if (content.length === 0) console.log("INTERIM — file EMPTY")
}

await hooks.dispose()

console.log("FINAL check — trace exists:", existsSync(tracePath))
if (existsSync(tracePath)) {
  const content = readFileSync(tracePath, "utf-8")
  const lines = content.trim().split("\n").filter(Boolean)
  console.log("FINAL — trace lines:", lines.length)
  if (lines.length > 0) {
    console.log("first entry:", lines[0].slice(0, 150))
  } else {
    console.log("FINAL — file EMPTY (0 bytes)")
    console.log("file size:", readFileSync(tracePath).length)
  }
} else {
  console.log("FINAL — no trace file")
}

console.log(`\nResults: ${passed} passed, ${failed} failed`)
