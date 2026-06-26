// Full E2E matching load-samedir exactly
import { existsSync, readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { sdkMockClient } from "./mock-sdk-client.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const PLUGIN_DIST = resolve(__dirname, "..", "dist", "index.js")
const WORKSPACE = "/tmp/samedir-full-e2e"

console.log(`Plugin dist: ${PLUGIN_DIST}`)
console.log(`Workspace:   ${WORKSPACE}`)

const mod = await import(PLUGIN_DIST)
const hooks = await mod.AgenticEngine({
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

function ctx(sid) {
  return {
    sessionID: sid, messageID: `m-${sid}`, agent: "test",
    directory: WORKSPACE, worktree: WORKSPACE,
    abort: new AbortController().signal, metadata: () => {}, ask: async () => {},
  }
}

// 1. Initial E2E
const sid = "e2e"
await hooks.tool.agentic_plan.execute({
  goal: "Docker E2E",
  subtasks: [{ id: "e1", description: "Step 1", dependsOn: [] }, { id: "e2", description: "Step 2", dependsOn: ["e1"] }, { id: "e3", description: "Step 3", dependsOn: ["e2"] }],
}, ctx(sid))
await hooks.tool.agentic_execute.execute({ stepId: "e1", success: true, output: "OK", filesModified: ["a.ts"] }, ctx(sid))
await hooks.tool.agentic_execute.execute({ stepId: "e2", success: true, output: "OK", filesModified: ["b.ts"] }, ctx(sid))
await hooks.tool.agentic_execute.execute({ stepId: "e3", success: true, output: "OK", filesModified: ["c.ts"] }, ctx(sid))
await hooks.tool.agentic_verify.execute({ stepId: "final" }, ctx(sid))
await hooks.tool.agentic_status.execute({}, ctx(sid))

// 2. Failure + reflect + retry
const sid2 = "fail"
await hooks.tool.agentic_plan.execute({ goal: "Retry test", subtasks: [{ id: "f1", description: "Failing step", dependsOn: [] }] }, ctx(sid2))
await hooks.tool.agentic_execute.execute({ stepId: "f1", success: false, output: "Cannot find module './nonexistent'", error: "Module not found" }, ctx(sid2))
await hooks.tool.agentic_reflect.execute({ stepId: "f1" }, ctx(sid2))
await hooks.tool.agentic_execute.execute({ stepId: "f1", success: true, output: "Fixed import path", filesModified: ["index.ts"] }, ctx(sid2))

// 3. Blocked step visibility
const sid3 = "blocked"
await hooks.tool.agentic_plan.execute({ goal: "Blocked test", subtasks: [{ id: "b1", description: "First", dependsOn: [] }, { id: "b2", description: "Second", dependsOn: ["b1"] }, { id: "b3", description: "Third", dependsOn: ["b1", "b2"] }] }, ctx(sid3))
await hooks.tool.agentic_status.execute({}, ctx(sid3))

// 4. Max retries exhausted
const sid4 = "maxretry"
await hooks.tool.agentic_plan.execute({ goal: "Max retry test", subtasks: [{ id: "m1", description: "Will fail", dependsOn: [] }] }, ctx(sid4))
for (let i = 0; i < 3; i++) {
  await hooks.tool.agentic_execute.execute({ stepId: "m1", success: false, output: `Fail ${i + 1}`, error: `error-${i}` }, ctx(sid4))
}
await hooks.tool.agentic_reflect.execute({ stepId: "m1" }, ctx(sid4))

// Check BEFORE dispose
const tracePath = WORKSPACE + "/.agentic/trace.jsonl"
console.log("BEFORE DISPOSE:", existsSync(tracePath))
if (existsSync(tracePath)) {
  const c = readFileSync(tracePath, "utf-8")
  const l = c.trim().split("\n").filter(Boolean)
  console.log("BEFORE DISPOSE LINES:", l.length)
} else {
  console.log("BEFORE DISPOSE: no file")
}

await hooks.dispose()

console.log("AFTER DISPOSE:", existsSync(tracePath))
if (existsSync(tracePath)) {
  const c = readFileSync(tracePath, "utf-8")
  const l = c.trim().split("\n").filter(Boolean)
  console.log("AFTER DISPOSE LINES:", l.length)
} else {
  console.log("AFTER DISPOSE: no file")
}
