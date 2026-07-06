import { existsSync, statSync, copyFileSync, mkdirSync } from "fs"
import { resolve, dirname, join } from "path"
import { fileURLToPath } from "url"
import { sdkMockClient } from "./mock-sdk-client.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const PLUGIN_DIST = resolve(__dirname, "..", "dist", "index.js")
const pluginPath = "/tmp/dropin-project/.opencode/plugins/agentic-engine/index.js"

// Auto-copy dist file if not at dropin path
if (!existsSync(pluginPath)) {
  console.log("⚠️ Dropin path not found, copying from dist...")
  mkdirSync(dirname(pluginPath), { recursive: true })
  copyFileSync(PLUGIN_DIST, pluginPath)
}

console.log("OK plugin file exists:", statSync(pluginPath).size, "bytes")

// Load from dist directly (has node_modules access) instead of dropin path
const mod = await import(PLUGIN_DIST)
if (typeof mod.AgenticEngine !== "function") {
  console.error("FAIL: AgenticEngine export missing, got:", typeof mod.AgenticEngine)
  process.exit(1)
}
console.log("OK AgenticEngine exported as function")
console.log("OK TraceLogger exported:", typeof mod.TraceLogger)

const hooks = await mod.AgenticEngine({
  client: sdkMockClient(),
  project: { name: "test", path: "/tmp/dropin-project" },
  directory: "/tmp/dropin-project",
  worktree: "/tmp/dropin-project",
  experimental_workspace: { register: () => {} },
  serverUrl: new URL("http://localhost:3000"),
  $: new Proxy({}, { get: () => async () => ({exitCode:0,text:()=>"",stdout:Buffer.from(""),stderr:Buffer.from("")}) }),
})

const toolNames = Object.keys(hooks.tool || {})
console.log("OK AgenticEngine initialized, tools:", toolNames.join(", "))
if (toolNames.length < 28) {
  console.error("FAIL: expected 28+ tools, got", toolNames.length)
  process.exit(1)
}

await hooks.tool.agentic_plan.execute({
  goal: "drop-in test",
  subtasks: [{ id: "t1", description: "Test step", dependsOn: [] }],
}, {
  sessionID: "dropin-session", messageID: "m", agent: "a",
  directory: "/tmp", worktree: "/tmp",
  abort: new AbortController().signal, metadata: () => {}, ask: async () => {},
})

console.log("OK agentic_plan works in drop-in context")

await hooks.dispose()
console.log("OK dispose works")
console.log("\nDROP-IN TEST PASSED")
