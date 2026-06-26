import { sdkMockClient } from "./mock-sdk-client.mjs"
import { existsSync, readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const PLUGIN_DIST = resolve(__dirname, "..", "dist", "index.js")
const WORKSPACE = "/tmp/samedir-trace-debug4"

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
    sessionID: sid, messageID: "m-" + sid, agent: "test",
    directory: WORKSPACE, worktree: WORKSPACE,
    abort: new AbortController().signal,
    metadata: () => {}, ask: async () => {},
  }
}

const sid = "e2e"
await hooks.tool.agentic_plan.execute({
  goal: "Test",
  subtasks: [
    { id: "e1", description: "Step 1", dependsOn: [] },
    { id: "e2", description: "Step 2", dependsOn: ["e1"] },
    { id: "e3", description: "Step 3", dependsOn: ["e2"] },
  ],
}, ctx(sid))
await hooks.tool.agentic_execute.execute({ stepId: "e1", success: true, output: "OK", filesModified: ["a.ts"] }, ctx(sid))
await hooks.tool.agentic_execute.execute({ stepId: "e2", success: true, output: "OK", filesModified: ["b.ts"] }, ctx(sid))
await hooks.tool.agentic_execute.execute({ stepId: "e3", success: true, output: "OK", filesModified: ["c.ts"] }, ctx(sid))

const sid2 = "fail"
await hooks.tool.agentic_plan.execute({ goal: "Fail", subtasks: [{ id: "f1", description: "Fail", dependsOn: [] }] }, ctx(sid2))
await hooks.tool.agentic_execute.execute({ stepId: "f1", success: false, output: "Cannot find module", error: "Module not found" }, ctx(sid2))
await hooks.tool.agentic_reflect.execute({ stepId: "f1" }, ctx(sid2))
await hooks.tool.agentic_execute.execute({ stepId: "f1", success: true, output: "Fixed", filesModified: ["x.ts"] }, ctx(sid2))

const tracePath = WORKSPACE + "/.agentic/trace.jsonl"
console.log("BEFORE dispose - exists:", existsSync(tracePath))
if (existsSync(tracePath)) {
  const c = readFileSync(tracePath, "utf-8")
  console.log("BEFORE dispose - lines:", c.trim().split("\n").filter(Boolean).length)
  if (c.length > 0) {
    console.log("content preview:", c.slice(0, 200))
  } else {
    console.log("FILE EMPTY")
  }
} else {
  console.log("NO FILE - will check after dispose")
}

await hooks.dispose()
console.log("AFTER dispose - exists:", existsSync(tracePath))
if (existsSync(tracePath)) {
  const c = readFileSync(tracePath, "utf-8")
  const lines = c.trim().split("\n").filter(Boolean)
  console.log("AFTER dispose - lines:", lines.length)
  if (lines.length > 0) {
    console.log("first entry:", lines[0].slice(0, 200))
  } else {
    console.log("STILL EMPTY")
  }
} else {
  console.log("NO FILE AFTER DISPOSE")
}
