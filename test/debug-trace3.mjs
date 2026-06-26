// Minimal trace debug - just do 1 plan + 1 execute
import { existsSync, readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { sdkMockClient } from "./mock-sdk-client.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const PLUGIN_DIST = resolve(__dirname, "..", "dist", "index.js")
const WORKSPACE = "/tmp/samedir-mini"

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

// Plan + Execute
await hooks.tool.agentic_plan.execute({
  goal: "Mini test",
  subtasks: [{ id: "s1", description: "Step 1", dependsOn: [] }],
}, ctx("mini"))

await hooks.tool.agentic_execute.execute({
  stepId: "s1", success: true, output: "Done", filesModified: ["x.ts"],
}, ctx("mini"))

// Read BEFORE dispose
const tracePath = WORKSPACE + "/.agentic/trace.jsonl"
console.log("BEFORE DISPOSE")
console.log("  exists:", existsSync(tracePath))
if (existsSync(tracePath)) {
  const content = readFileSync(tracePath, "utf-8")
  console.log("  size:", content.length)
  console.log("  first 80 chars:", JSON.stringify(content.slice(0, 80)))
  const lines = content.trim().split("\n").filter(Boolean)
  console.log("  lines:", lines.length)
} else {
  // Check if dir exists
  console.log("  dir exists:", existsSync(WORKSPACE + "/.agentic"))
  // List files
  try {
    const fs = await import("node:fs")
    const files = fs.readdirSync(WORKSPACE + "/.agentic")
    console.log("  files:", files)
  } catch {}
}

await hooks.dispose()

console.log("AFTER DISPOSE")
const content2 = readFileSync(tracePath, "utf-8")
console.log("  size:", content2.length)
const lines2 = content2.trim().split("\n").filter(Boolean)
console.log("  lines:", lines2.length)
