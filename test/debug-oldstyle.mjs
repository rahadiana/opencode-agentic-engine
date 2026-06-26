// Test with client: {} (old style) to compare trace behavior
import { existsSync, readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const PLUGIN_DIST = resolve(__dirname, "..", "dist", "index.js")
const WORKSPACE = "/tmp/samedir-oldstyle"

const mod = await import(PLUGIN_DIST)
const hooks = await mod.AgenticEngine({
  client: {},
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
await hooks.tool.agentic_plan.execute({ goal: "Test", subtasks: [{ id: "e1", description: "Step 1", dependsOn: [] }, { id: "e2", description: "Step 2", dependsOn: ["e1"] }, { id: "e3", description: "Step 3", dependsOn: ["e2"] }] }, ctx(sid))
await hooks.tool.agentic_execute.execute({ stepId: "e1", success: true, output: "OK", filesModified: ["a.ts"] }, ctx(sid))
await hooks.tool.agentic_execute.execute({ stepId: "e2", success: true, output: "OK", filesModified: ["b.ts"] }, ctx(sid))
await hooks.tool.agentic_execute.execute({ stepId: "e3", success: true, output: "OK", filesModified: ["c.ts"] }, ctx(sid))

const sid2 = "fail"
await hooks.tool.agentic_plan.execute({ goal: "Fail", subtasks: [{ id: "f1", description: "Fail", dependsOn: [] }] }, ctx(sid2))
await hooks.tool.agentic_execute.execute({ stepId: "f1", success: false, output: "Cannot find module", error: "Not found" }, ctx(sid2))
await hooks.tool.agentic_reflect.execute({ stepId: "f1" }, ctx(sid2))
await hooks.tool.agentic_execute.execute({ stepId: "f1", success: true, output: "Fixed", filesModified: ["x.ts"] }, ctx(sid2))

await hooks.dispose()

const tracePath = WORKSPACE + "/.agentic/trace.jsonl"
console.log("trace exists:", existsSync(tracePath))
if (existsSync(tracePath)) {
  const content = readFileSync(tracePath, "utf-8")
  const lines = content.trim().split("\n").filter(Boolean)
  console.log("trace lines:", lines.length)
}
