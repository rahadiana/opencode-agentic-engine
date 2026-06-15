import { existsSync, statSync } from "fs"

const pluginPath = "/tmp/dropin-project/.opencode/plugins/agentic-engine/index.js"

if (!existsSync(pluginPath)) {
  console.error("FAIL: plugin file missing at", pluginPath)
  process.exit(1)
}
console.log("OK plugin file exists:", statSync(pluginPath).size, "bytes")

const mod = await import(pluginPath)
if (typeof mod.AgenticEngine !== "function") {
  console.error("FAIL: AgenticEngine export missing, got:", typeof mod.AgenticEngine)
  process.exit(1)
}
console.log("OK AgenticEngine exported as function")

const hooks = await mod.AgenticEngine({
  client: {},
  project: { name: "test", path: "/tmp/dropin-project" },
  directory: "/tmp/dropin-project",
  worktree: "/tmp/dropin-project",
  experimental_workspace: { register: () => {} },
  serverUrl: new URL("http://localhost:3000"),
  $: new Proxy({}, { get: () => async () => ({exitCode:0,text:()=>"",stdout:Buffer.from(""),stderr:Buffer.from("")}) }),
})

const toolNames = Object.keys(hooks.tool || {})
console.log("OK AgenticEngine initialized, tools:", toolNames.join(", "))
if (toolNames.length < 21) {
  console.error("FAIL: expected 21+ tools, got", toolNames.length)
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
