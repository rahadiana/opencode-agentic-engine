import { sdkMockClient } from "./mock-sdk-client.mjs"
import { existsSync, readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const PLUGIN_DIST = resolve(__dirname, "..", "dist", "index.js")
const WORKSPACE = "/tmp/samedir-debug"

const mod = await import(PLUGIN_DIST)
const hooks = await mod.AgenticEngine({
  client: sdkMockClient(),
  project: { name: "test", path: WORKSPACE },
  directory: WORKSPACE,
  worktree: WORKSPACE,
  experimental_workspace: { register: () => {} },
  serverUrl: new URL("http://localhost:3000"),
  $: new Proxy({}, { get() { return async () => ({ exitCode: 0, text: () => "", stdout: Buffer.from(""), stderr: Buffer.from("") }) } }),
})

const sid = "debug"
await hooks.tool.agentic_plan.execute({
  goal: "Debug",
  subtasks: [{ id: "d1", description: "Debug", dependsOn: [] }],
}, { sessionID: sid, messageID: "m1", agent: "test", directory: WORKSPACE, worktree: WORKSPACE, abort: new AbortController().signal, metadata: () => {}, ask: async () => {} })

const exec1 = await hooks.tool.agentic_execute.execute({
  stepId: "d1", success: true, output: "Debug exec", filesModified: ["test.ts"],
}, { sessionID: sid, messageID: "m2", agent: "test", directory: WORKSPACE, worktree: WORKSPACE, abort: new AbortController().signal, metadata: () => {}, ask: async () => {} })

console.log("exec1 output:", exec1.output.slice(0, 200))

await hooks.dispose()

const tracePath = WORKSPACE + "/.agentic/trace.jsonl"
console.log("trace exists:", existsSync(tracePath))
if (existsSync(tracePath)) {
  const content = readFileSync(tracePath, "utf-8")
  const lines = content.trim().split("\n").filter(Boolean)
  console.log("trace lines:", lines.length)
  if (lines.length > 0) {
    console.log("first entry:", lines[0].slice(0, 200))
  } else {
    console.log("FILE EXISTS BUT EMPTY")
  }
} else {
  console.log("NO TRACE FILE")
}

// Also check without sdkMockClient
const WORKSPACE2 = "/tmp/samedir-debug2"
const hooks2 = await mod.AgenticEngine({
  client: {},
  project: { name: "test", path: WORKSPACE2 },
  directory: WORKSPACE2,
  worktree: WORKSPACE2,
  experimental_workspace: { register: () => {} },
  serverUrl: new URL("http://localhost:3000"),
  $: new Proxy({}, { get() { return async () => ({ exitCode: 0, text: () => "", stdout: Buffer.from(""), stderr: Buffer.from("") }) } }),
})

await hooks2.tool.agentic_plan.execute({
  goal: "Debug",
  subtasks: [{ id: "d2", description: "Debug", dependsOn: [] }],
}, { sessionID: "debug2", messageID: "m1", agent: "test", directory: WORKSPACE2, worktree: WORKSPACE2, abort: new AbortController().signal, metadata: () => {}, ask: async () => {} })

await hooks2.tool.agentic_execute.execute({
  stepId: "d2", success: true, output: "Debug exec", filesModified: ["test.ts"],
}, { sessionID: "debug2", messageID: "m2", agent: "test", directory: WORKSPACE2, worktree: WORKSPACE2, abort: new AbortController().signal, metadata: () => {}, ask: async () => {} })

await hooks2.dispose()
const tracePath2 = WORKSPACE2 + "/.agentic/trace.jsonl"
console.log("trace2 exists:", existsSync(tracePath2))
if (existsSync(tracePath2)) {
  const content2 = readFileSync(tracePath2, "utf-8")
  const lines2 = content2.trim().split("\n").filter(Boolean)
  console.log("trace2 lines:", lines2.length)
} else {
  console.log("NO TRACE2 FILE")
}
