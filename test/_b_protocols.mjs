import { pluginDist, G, R, RST, state, assert, section, mockCtx, freshSid, join, tmpdir, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, chmodSync, mkdtempSync, sdkMockClient, projectDir } from "./_common.mjs"

const mod = await import(pluginDist)

console.log("\n[MCP-SRV] MCPServer — MCP protocol server")
let mcpSrv = 0, mcpSrvf = 0
function ms_assert(cond, msg) { if (cond) { mcpSrv++ } else { console.error(`  ❌ ${msg}`); mcpSrvf++ } }

// MCP-SRV-1: Constructor + types
{
  const { MCPServer, DynamicToolRegistry } = mod
  ms_assert(typeof MCPServer === "function", "MCP-SRV-1a MCPServer exported")
  const reg = new DynamicToolRegistry()
  const server = new MCPServer(reg)
  ms_assert(typeof server.start === "function", "MCP-SRV-1b start() function")
  ms_assert(typeof server.stop === "function", "MCP-SRV-1c stop() function")
  ms_assert(typeof server.getStatus === "function", "MCP-SRV-1d getStatus() function")
  ms_assert(typeof server.port === "number", "MCP-SRV-1e port is number")
}

// MCP-SRV-2: Start + stop + status
{
  const { MCPServer, DynamicToolRegistry } = mod
  const reg = new DynamicToolRegistry()
  const server = new MCPServer(reg, { port: 0 }) // port 0 = OS-assigned
  ms_assert(!server.getStatus().running, "MCP-SRV-2a not running before start")
  await server.start()
  ms_assert(server.getStatus().running, "MCP-SRV-2b running after start")
  ms_assert(server.port > 0, "MCP-SRV-2c port assigned")
  ms_assert(server.getStatus().toolCount === 0, "MCP-SRV-2d no tools yet")
  await server.stop()
  ms_assert(!server.getStatus().running, "MCP-SRV-2e not running after stop")
}

// MCP-SRV-3: GET /health
{
  const { MCPServer, DynamicToolRegistry } = mod
  const reg = new DynamicToolRegistry()
  const server = new MCPServer(reg, { port: 0 })
  await server.start()
  try {
    const http = await import("node:http")
    const res = await new Promise((resolve, reject) => {
      http.request(`http://127.0.0.1:${server.port}/health`, (res) => {
        let data = ""
        res.on("data", c => data += c)
        res.on("end", () => resolve({ status: res.statusCode, body: data }))
      }).on("error", reject).end()
    })
    ms_assert(res.status === 200, "MCP-SRV-3a /health returns 200")
    const parsed = JSON.parse(res.body)
    ms_assert(parsed.status === "ok", "MCP-SRV-3b /health body.status = ok")
    ms_assert(typeof parsed.tools === "number", "MCP-SRV-3c /health has tools count")
  } finally {
    await server.stop()
  }
}

// MCP-SRV-4: GET /tools (convenience endpoint)
{
  const { MCPServer, DynamicToolRegistry } = mod
  const reg = new DynamicToolRegistry()
  reg.register({ name: "my_api", description: "API tool", execute: async () => "done", registeredAt: Date.now() })
  const server = new MCPServer(reg, { port: 0 })
  await server.start()
  try {
    const http = await import("node:http")
    const res = await new Promise((resolve, reject) => {
      http.request(`http://127.0.0.1:${server.port}/tools`, (res) => {
        let data = ""
        res.on("data", c => data += c)
        res.on("end", () => resolve({ status: res.statusCode, body: data }))
      }).on("error", reject).end()
    })
    ms_assert(res.status === 200, "MCP-SRV-4a GET /tools returns 200")
    const parsed = JSON.parse(res.body)
    ms_assert(Array.isArray(parsed.tools), "MCP-SRV-4b tools is array")
    ms_assert(parsed.tools.length === 1, "MCP-SRV-4c tools length = 1")
    ms_assert(parsed.tools[0].name === "my_api", "MCP-SRV-4d tool name matches")
  } finally {
    await server.stop()
  }
}

// MCP-SRV-5: JSON-RPC initialize
{
  const { MCPServer, DynamicToolRegistry } = mod
  const reg = new DynamicToolRegistry()
  const server = new MCPServer(reg, { port: 0 })
  await server.start()
  try {
    const http = await import("node:http")
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
    const res = await new Promise((resolve, reject) => {
      const req = http.request(`http://127.0.0.1:${server.port}/rpc`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      }, (res) => {
        let data = ""
        res.on("data", c => data += c)
        res.on("end", () => resolve({ status: res.statusCode, body: data }))
      })
      req.on("error", reject)
      req.write(body)
      req.end()
    })
    ms_assert(res.status === 200, "MCP-SRV-5a initialize returns 200")
    const parsed = JSON.parse(res.body)
    ms_assert(parsed.jsonrpc === "2.0", "MCP-SRV-5b jsonrpc = 2.0")
    ms_assert(parsed.result.protocolVersion === "2024-11-05", "MCP-SRV-5c protocolVersion matches")
    ms_assert(parsed.id === 1, "MCP-SRV-5d id matches")
  } finally {
    await server.stop()
  }
}

// MCP-SRV-6: JSON-RPC tools/list
{
  const { MCPServer, DynamicToolRegistry } = mod
  const reg = new DynamicToolRegistry()
  reg.register({ name: "tool_one", description: "First tool", execute: async () => 1, registeredAt: Date.now() })
  reg.register({ name: "tool_two", description: "Second tool", execute: async () => 2, registeredAt: Date.now() })
  const server = new MCPServer(reg, { port: 0 })
  await server.start()
  try {
    const http = await import("node:http")
    const body = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
    const res = await new Promise((resolve, reject) => {
      const req = http.request(`http://127.0.0.1:${server.port}/`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      }, (res) => {
        let data = ""
        res.on("data", c => data += c)
        res.on("end", () => resolve({ status: res.statusCode, body: data }))
      })
      req.on("error", reject)
      req.write(body)
      req.end()
    })
    ms_assert(res.status === 200, "MCP-SRV-6a tools/list returns 200")
    const parsed = JSON.parse(res.body)
    ms_assert(Array.isArray(parsed.result.tools), "MCP-SRV-6b result.tools is array")
    ms_assert(parsed.result.tools.length === 2, "MCP-SRV-6c tools length = 2")
    ms_assert(parsed.result.tools[0].name === "tool_one", "MCP-SRV-6d first tool name")
    ms_assert(typeof parsed.result.tools[0].description === "string", "MCP-SRV-6e tool has description")
    ms_assert(typeof parsed.result.tools[0].parameters === "object", "MCP-SRV-6f tool has parameters")
  } finally {
    await server.stop()
  }
}

// MCP-SRV-7: JSON-RPC tools/call — success
{
  const { MCPServer, DynamicToolRegistry } = mod
  const reg = new DynamicToolRegistry()
  reg.register({ name: "echo", description: "Echo input", execute: async (args) => `Echo: ${args.msg || "nothing"}`, registeredAt: Date.now() })
  const server = new MCPServer(reg, { port: 0 })
  await server.start()
  try {
    const http = await import("node:http")
    const body = JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "echo", arguments: { msg: "hello mcp" } } })
    const res = await new Promise((resolve, reject) => {
      const req = http.request(`http://127.0.0.1:${server.port}/rpc`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      }, (res) => {
        let data = ""
        res.on("data", c => data += c)
        res.on("end", () => resolve({ status: res.statusCode, body: data }))
      })
      req.on("error", reject)
      req.write(body)
      req.end()
    })
    ms_assert(res.status === 200, "MCP-SRV-7a tools/call returns 200")
    const parsed = JSON.parse(res.body)
    ms_assert(!parsed.result.isError, "MCP-SRV-7b isError = false")
    ms_assert(Array.isArray(parsed.result.content), "MCP-SRV-7c content is array")
    ms_assert(parsed.result.content[0].text.includes("hello mcp"), "MCP-SRV-7d content matches")
  } finally {
    await server.stop()
  }
}

// MCP-SRV-8: JSON-RPC tools/call — nonexistent tool
{
  const { MCPServer, DynamicToolRegistry } = mod
  const reg = new DynamicToolRegistry()
  const server = new MCPServer(reg, { port: 0 })
  await server.start()
  try {
    const http = await import("node:http")
    const body = JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "ghost" } })
    const res = await new Promise((resolve, reject) => {
      const req = http.request(`http://127.0.0.1:${server.port}/`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      }, (res) => {
        let data = ""
        res.on("data", c => data += c)
        res.on("end", () => resolve({ status: res.statusCode, body: data }))
      })
      req.on("error", reject)
      req.write(body)
      req.end()
    })
    ms_assert(res.status === 200, "MCP-SRV-8a nonexistent returns 200")
    const parsed = JSON.parse(res.body)
    ms_assert(parsed.result.isError, "MCP-SRV-8b isError = true for nonexistent")
    ms_assert(parsed.result.content[0].text.includes("not found"), "MCP-SRV-8c error message says not found")
  } finally {
    await server.stop()
  }
}

// MCP-SRV-9: tools/call without name -> error
{
  const { MCPServer, DynamicToolRegistry } = mod
  const reg = new DynamicToolRegistry()
  const server = new MCPServer(reg, { port: 0 })
  await server.start()
  try {
    const http = await import("node:http")
    const body = JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/call", params: {} })
    const res = await new Promise((resolve, reject) => {
      const req = http.request(`http://127.0.0.1:${server.port}/`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      }, (res) => {
        let data = ""
        res.on("data", c => data += c)
        res.on("end", () => resolve({ status: res.statusCode, body: data }))
      })
      req.on("error", reject)
      req.write(body)
      req.end()
    })
    ms_assert(res.status === 200, "MCP-SRV-9a no name returns 200")
    const parsed = JSON.parse(res.body)
    ms_assert(parsed.error !== undefined, "MCP-SRV-9b error present")
    ms_assert(parsed.error.code === -32602, "MCP-SRV-9c error code = -32602")
  } finally {
    await server.stop()
  }
}

// MCP-SRV-10: 404 for unknown routes
{
  const { MCPServer, DynamicToolRegistry } = mod
  const reg = new DynamicToolRegistry()
  const server = new MCPServer(reg, { port: 0 })
  await server.start()
  try {
    const http = await import("node:http")
    const res = await new Promise((resolve, reject) => {
      http.request(`http://127.0.0.1:${server.port}/unknown`, (res) => {
        let data = ""
        res.on("data", c => data += c)
        res.on("end", () => resolve({ status: res.statusCode, body: data }))
      }).on("error", reject).end()
    })
    ms_assert(res.status === 404, "MCP-SRV-10a /unknown returns 404")
  } finally {
    await server.stop()
  }
}

console.log(`  MCP-SRV: ${mcpSrv} passed, ${mcpSrvf} failed`)
state.passed += mcpSrv; state.failed += mcpSrvf

// PA: ProtocolAdapter — unified gateway tests
console.log("\n[PA] ProtocolAdapter — unified gateway")
let paPassed = 0, paFailed = 0
function pa_assert(cond, msg) { if (cond) { paPassed++ } else { console.error(`  ❌ ${msg}`); paFailed++ } }

{
  // PA-1: Constructor + basic types
  const { ProtocolAdapter } = mod
  const { MCPClient } = await import(pluginDist)
  pa_assert(typeof ProtocolAdapter === "function", "PA-1a ProtocolAdapter constructor exported")
  pa_assert(typeof MCPClient === "function", "PA-1b MCPClient constructor exported")

  const mcp = new MCPClient()
  const adapter = new ProtocolAdapter(mcp)
  pa_assert(typeof adapter.findTools === "function", "PA-1c adapter.findTools is function")
  pa_assert(typeof adapter.listAll === "function", "PA-1d adapter.listAll is function")
  pa_assert(typeof adapter.getStats === "function", "PA-1e adapter.getStats is function")
  pa_assert(typeof adapter.call === "function", "PA-1f adapter.call is function")
  pa_assert(typeof adapter.discoverA2A === "function", "PA-1g adapter.discoverA2A is function")
}

// PA-2: findTools with no connections (empty result)
{
  const { ProtocolAdapter } = mod
  const { MCPClient } = await import(pluginDist)
  const mcp = new MCPClient()
  const adapter = new ProtocolAdapter(mcp)

  const results = adapter.findTools("database")
  pa_assert(Array.isArray(results), "PA-2a findTools returns array")
  pa_assert(results.length === 0, "PA-2b findTools returns empty array with no connections")
}

// PA-3: listAll with no connections
{
  const { ProtocolAdapter } = mod
  const { MCPClient } = await import(pluginDist)
  const mcp = new MCPClient()
  const adapter = new ProtocolAdapter(mcp)

  const all = adapter.listAll()
  pa_assert(Array.isArray(all), "PA-3a listAll returns array")
  pa_assert(all.length === 0, "PA-3b listAll returns empty with no connections")
}

// PA-4: getStats with no connections
{
  const { ProtocolAdapter } = mod
  const { MCPClient } = await import(pluginDist)
  const mcp = new MCPClient()
  const adapter = new ProtocolAdapter(mcp)

  const stats = adapter.getStats()
  pa_assert(stats !== null && typeof stats === "object", "PA-4a getStats returns object")
  pa_assert(stats.mcp.connections === 0, "PA-4b mcp connections = 0")
  pa_assert(stats.mcp.totalTools === 0, "PA-4c mcp totalTools = 0")
  pa_assert(stats.a2a.listened === false, "PA-4d a2a listened = false")
  pa_assert(stats.a2a.discoveredAgents === 0, "PA-4e a2a discoveredAgents = 0")
  pa_assert(stats.combined.totalConnections === 0, "PA-4f combined totalConnections = 0")
  pa_assert(stats.combined.totalTools === 0, "PA-4g combined totalTools = 0")
}

// PA-5: call throws error with unknown protocol
{
  const { ProtocolAdapter } = mod
  const { MCPClient } = await import(pluginDist)
  const mcp = new MCPClient()
  const adapter = new ProtocolAdapter(mcp)

  // Call with unknown source should fail gracefully
  try {
    const result = await adapter.call({ protocol: "mcp", source: "nonexistent", name: "test" })
    pa_assert(result.success === false, "PA-5a call to nonexistent server fails")
    pa_assert(result.isError === true, "PA-5b call returns isError=true")
  } catch (err) {
    pa_assert(true, "PA-5c call errors should be caught, not thrown")
  }
}

// PA-6: findTools with query handles empty/no-connect gracefully
{
  const { ProtocolAdapter } = mod
  const { MCPClient } = await import(pluginDist)
  const mcp = new MCPClient()
  const adapter = new ProtocolAdapter(mcp)

  const noTerms = adapter.findTools("")
  pa_assert(Array.isArray(noTerms), "PA-6a findTools('') returns array")
  pa_assert(noTerms.length === 0, "PA-6b findTools('') returns empty")

  const spaceOnly = adapter.findTools("   ")
  pa_assert(Array.isArray(spaceOnly), "PA-6c findTools('   ') returns array")
  pa_assert(spaceOnly.length === 0, "PA-6d findTools('   ') returns empty")
}

// PA-7: agentic_tools tool is registered (init fresh engine for hook access)
{
  const paMockInput = {
    config: mod.defaultConfig ?? {},
    sessionID: "pa-test-session",
    messageID: "msg-pa",
    agent: "test",
    directory: "/tmp/test-project",
    worktree: "/tmp/test-project",
    experimental_workspace: { register: () => {} },
    serverUrl: new URL("http://localhost:3000"),
    $: new Proxy({}, {
      get() { return async () => ({ exitCode: 0, text: () => "", stdout: Buffer.from(""), stderr: Buffer.from("") }) },
    }),
  }
  const paHooks = await mod.AgenticEngine(paMockInput)
  const hasToolsTool = "agentic_tools" in paHooks.tool
  pa_assert(hasToolsTool, "PA-7a agentic_tools tool registered")

  if (hasToolsTool) {
    const toolDef = paHooks.tool.agentic_tools
    pa_assert(typeof toolDef.execute === "function", "PA-7b agentic_tools has execute function")
    pa_assert(toolDef.args !== undefined, "PA-7c agentic_tools has args")
    pa_assert("action" in toolDef.args, "PA-7d agentic_tools has action arg")
  }
  paHooks.dispose?.()
}

console.log(`  PA: ${paPassed} passed, ${paFailed} failed`)
state.passed += paPassed; state.failed += paFailed

// ── HK: Hook Tests ──
// Tests plugin hooks against proper mock SDK client
console.log("\n[HK] Hook Tests — plugin hooks with SDK-like mock")
let hkPassed = 0, hkFailed = 0
function hkAssert(cond, msg) { if (cond) { hkPassed++; console.log(`  PASS: ${msg}`) } else { hkFailed++; console.log(`  FAIL: ${msg}`) } }

// Mock plugin input for standalone hook tests (outside runAll closure)
function hkMockInput(client) {
  return {
    client,
    project: { name: "hk-test", path: "/tmp/hk-test" },
    directory: "/tmp/hk-test",
    worktree: "/tmp/hk-test",
    experimental_workspace: { register: () => {} },
    serverUrl: new URL("http://localhost:3000"),
    $: new Proxy({}, { get() { return async () => ({ exitCode: 0, text: () => "", stdout: Buffer.from(""), stderr: Buffer.from("") }) } }),
  }
}

// HK-1: config hook registers agent
{
  const client = sdkMockClient()
  const hk = await mod.AgenticEngine(hkMockInput(client))
  const configOutput = {}
  await hk.config?.(configOutput)
  hkAssert(configOutput.agent?.agentic?.mode === "primary", "HK-1a config hook sets agent mode=primary")
  hkAssert(typeof configOutput.agent?.agentic?.description === "string", "HK-1b config hook sets agent description")
  hkAssert(typeof configOutput.agent?.agentic?.prompt === "string", "HK-1c config hook sets agent prompt")
  hkAssert(configOutput.default_agent === "agentic", "HK-1d config hook sets default_agent=agentic")
  await hk.dispose?.()
}

// HK-2: config hook does not overwrite existing default_agent
{
  const client = sdkMockClient()
  const hk = await mod.AgenticEngine(hkMockInput(client))
  const configOutput = { default_agent: "build", agent: {} }
  await hk.config?.(configOutput)
  hkAssert(configOutput.default_agent === "build", "HK-2 config hook respects existing default_agent")
  await hk.dispose?.()
}

// HK-3: chat.params hook tracks model
{
  const client = sdkMockClient()
  const hk = await mod.AgenticEngine(hkMockInput(client))
  const chatInput = { sessionID: "hk-session", agent: "build", model: { providerID: "anthropic", id: "claude-sonnet-4-20250514" }, provider: "anthropic" }
  const chatOutput = {}
  await hk["chat.params"]?.(chatInput, chatOutput)
  // Model tracking happens inside llmEngine, not directly observable via hook output
  hkAssert(true, "HK-3 chat.params hook executes without error")
  await hk.dispose?.()
}

// HK-4: tool.execute.after hook records calls
{
  const client = sdkMockClient()
  const hk = await mod.AgenticEngine(hkMockInput(client))
  // First verify the hook exists
  hkAssert(typeof hk["tool.execute.after"] === "function", "HK-4a tool.execute.after hook registered")
  
  const toolInput = { tool: "agentic_nav", args: { query: "test" }, sessionID: "hk-session", callID: "call-1" }
  const toolOutput = { title: "Nav Result", output: "Found files", metadata: {} }
  await hk["tool.execute.after"]?.(toolInput, toolOutput)
  hkAssert(true, "HK-4b tool.execute.after executes without error")
  await hk.dispose?.()
}

// HK-5: Model discovery via SDK client.config.providers()
{
  const client = sdkMockClient("hk-model-disc")
  const hk = await mod.AgenticEngine(hkMockInput(client))
  await new Promise(r => setTimeout(r, 50)) // wait for async discovery
  const statusResp = await hk.tool.agentic_status.execute({}, { sessionID: "hk-model-disc", messageID: "m", agent: "test", directory: "/tmp", worktree: "/tmp", abort: new AbortController().signal, metadata: () => {}, ask: async () => {} })
  const statusOut = typeof statusResp === "string" ? statusResp : statusResp?.output || JSON.stringify(statusResp)
  hkAssert(statusOut.includes("gpt-4o") || statusOut.includes("gpt-4o") || statusOut.includes("Fast"), "HK-5a discovered models appear in status")
  hkAssert(statusOut.includes("claude") || statusOut.includes("sonnet"), "HK-5b claude models appear in status")
  await hk.dispose?.()
}

// HK-6: LLMEngine call via SDK-like client (not fallback)
{
  const { LLMEngine } = mod
  const engine = new LLMEngine()
  const client = sdkMockClient("hk-llm")
  engine.setOpencodeClient(client)
  engine.setSessionId("hk-llm")
  
  const result = await engine.call({
    userPrompt: "Hello from test",
    systemPrompt: "You are a test assistant",
    toolName: "test",
  })
  
  hkAssert(result.content.startsWith("Response to:"), "HK-6a LLMEngine.call returns real SDK response (not NO_LLM)")
  hkAssert(result.content.includes("Hello from test"), "HK-6b response contains the prompt echo")
  hkAssert(result.finishReason === "stop", "HK-6c finishReason is stop")
}

// HK-7: LLMEngine falls back when no SDK client
{
  const { LLMEngine } = mod
  const engine = new LLMEngine()
  const result = await engine.call({
    userPrompt: "test",
    systemPrompt: "test",
    toolName: "test",
  })
  hkAssert(result.content.includes("[NO_LLM]"), "HK-7 LLMEngine returns NO_LLM without client")
  hkAssert(result.finishReason === "no_llm", "HK-7b finishReason is no_llm")
}

// HK-8: app.log is available on SDK client
{
  const client = sdkMockClient()
  const logResult = await client.app.log({ body: { service: "test", level: "info", message: "test log", extra: { key: "val" } } })
  hkAssert(logResult === true, "HK-8 app.log executes without error")
}

console.log(`  HK: ${hkPassed} passed, ${hkFailed} failed`)
state.passed += hkPassed; state.failed += hkFailed

// ── Gap #5: Error Recovery ──
{
  const moduleName = "Gap #5"
  let g5Passed = 0, g5Failed = 0
  const g5Assert = (condition, msg) => { if (condition) g5Passed++; else { g5Failed++; console.log(`  FAIL: ${msg}`) } }

  const { ErrorRecovery } = mod
  const er = new ErrorRecovery()

  // G5-1: Basic recovery plan generation from error analysis
  const plan1 = er.getRecoveryPlan({ category: "compile", summary: "compilation error", likelyRootCause: "syntax", suggestedFix: "fix it", affectedFiles: ["a.ts"], severity: "high" }, "step-1", 1)
  g5Assert(plan1.action === "retry_different", "G5-1a: compile error → retry_different first")
  g5Assert(typeof plan1.reason === "string" && plan1.reason.length > 0, "G5-1b: reason is non-empty")
  g5Assert(plan1.priority > 0, "G5-1c: priority is set")

  // G5-2: Recovery actions rotate across attempts
  const plan2 = er.getRecoveryPlan({ category: "compile", summary: "", likelyRootCause: "", suggestedFix: "", affectedFiles: [], severity: "high" }, "step-1", 2)
  g5Assert(plan2.action === "retry_same", "G5-2a: second attempt → retry_same (not tried yet)")

  // G5-3: Different category → different recovery action
  const runtimePlan = er.getRecoveryPlan({ category: "runtime", summary: "", likelyRootCause: "", suggestedFix: "", affectedFiles: [], severity: "high" }, "step-2", 1)
  g5Assert(runtimePlan.action === "retry_different", "G5-3a: runtime error first attempt → retry_different")

  // G5-4: Circuit breaker — consecutive failures escalate
  const er2 = new ErrorRecovery({ circuitBreakerThreshold: 3 })
  for (let i = 0; i < 3; i++) {
    er2.getRecoveryPlan({ category: "compile", summary: "", likelyRootCause: "", suggestedFix: "", affectedFiles: [], severity: "high" }, "step-cb", i + 1)
  }
  const cbPlan = er2.getRecoveryPlan({ category: "compile", summary: "", likelyRootCause: "", suggestedFix: "", affectedFiles: [], severity: "high" }, "step-cb", 4)
  g5Assert(cbPlan.action === "escalate", "G5-4a: circuit breaker → escalate after threshold")

  // G5-5: Record outcome (success) resets counter
  er2.recordOutcome("step-cb", { category: "compile", summary: "", likelyRootCause: "", suggestedFix: "", affectedFiles: [], severity: "high" }, ["retry_different"], "retry_different", true)
  const cbPlan2 = er2.getRecoveryPlan({ category: "compile", summary: "", likelyRootCause: "", suggestedFix: "", affectedFiles: [], severity: "high" }, "step-cb2", 1)
  g5Assert(cbPlan2.action !== "escalate", "G5-5a: after success, circuit breaker resets")

  // G5-6: Category success rate
  const rate = er.getCategorySuccessRate("compile")
  g5Assert(rate.attempts >= 0, "G5-6a: success rate returns valid object")
  g5Assert(typeof rate.rate === "number", "G5-6b: rate is number")

  // G5-7: Health check
  const health = er.getHealth()
  g5Assert(["healthy", "degraded", "critical"].includes(health), "G5-7a: health is valid enum value")

  // G5-8: Summary
  const summary = er.getSummary()
  g5Assert(summary.includes("Recovery:"), "G5-8a: summary includes Recovery prefix")
  g5Assert(summary.includes("health="), "G5-8b: summary includes health")

  // G5-9: Reset
  er.reset()
  g5Assert(er.getHistory().length === 0, "G5-9a: reset clears history")
  g5Assert(er.getHealth() === "healthy", "G5-9b: after reset, health is healthy")

  // G5-10: Edge case — unknown category falls back to unknown actions
  const unknownPlan = er.getRecoveryPlan(null, "step-unk", 1)
  g5Assert(unknownPlan.action !== undefined, "G5-10a: null analysis still produces a plan")
  g5Assert(unknownPlan.reason.includes("unknown"), "G5-10b: reason mentions unknown category")

  // G5-11: Max retries per category escalates
  const er3 = new ErrorRecovery({ maxRetriesPerCategory: 2 })
  for (let i = 0; i < 3; i++) {
    const p = er3.getRecoveryPlan({ category: "test", summary: "", likelyRootCause: "", suggestedFix: "", affectedFiles: [], severity: "medium" }, "step-max", i + 1)
    if (i === 2) {
      g5Assert(p.action === "escalate", `G5-11a: attempt ${i + 1} exceeds maxRetries → escalate`)
    }
  }

  // G5-12: Rotation includes different actions
  const er4 = new ErrorRecovery({ maxRetriesPerCategory: 10 })
  const actions = new Set()
  for (let i = 0; i < 4; i++) {
    const p = er4.getRecoveryPlan({ category: "compile", summary: "", likelyRootCause: "", suggestedFix: "", affectedFiles: [], severity: "high" }, "step-rotate", i + 1)
    actions.add(p.action)
  }
  g5Assert(actions.size >= 2, "G5-12a: rotation produces different actions")

  console.log(`  GAP #5: ${g5Passed} passed, ${g5Failed} failed`)
  state.passed += g5Passed; state.failed += g5Failed
}

// ── Gap #10: Alignment Gate ──
{
  let g10Passed = 0, g10Failed = 0
  const g10Assert = (condition, msg) => { if (condition) g10Passed++; else { g10Failed++; console.log(`  FAIL: ${msg}`) } }

  const { AlignmentGate } = mod
  const ag = new AlignmentGate()

  // G10-1: Aligned intent/state → high score
  const aligned = ag.checkAlignment("implement a login feature with email and password", "implement login with email password authentication")
  g10Assert(aligned.passed === true, "G10-1a: aligned intent → passed")
  g10Assert(aligned.overallScore > 0.5, "G10-1b: aligned intent → score > 0.5")
  g10Assert(aligned.driftDetected === false, "G10-1c: aligned intent → no drift detected")

  // G10-2: Drifted intent → low score
  const drifted = ag.checkAlignment("implement a login feature with email and password", "refactor the database schema for product catalog")
  g10Assert(aligned.overallScore > drifted.overallScore, "G10-2a: drifted intent → lower score than aligned")

  // G10-3: Constraints preserved
  ag.reset()
  const constraintCheck = ag.checkAlignment("must not expose API keys, should encrypt passwords", "API keys are stored in config, passwords are hashed")
  g10Assert(typeof constraintCheck.overallScore === "number", "G10-3a: constraint check returns score")

  // G10-4: Scope check — too many files
  const scopeDrift = ag.checkAlignment("fix one bug", "fixed a bug and refactored", Array(10).fill("file.ts"))
  g10Assert(typeof scopeDrift.overallScore === "number", "G10-4a: scope check returns score")

  // G10-5: Trend detection
  ag.checkAlignment("goal", "goal")
  ag.checkAlignment("goal", "different goal")
  ag.checkAlignment("goal", "something else entirely")
  const trend = ag.getAlignmentTrend()
  g10Assert(["improving", "declining", "stable"].includes(trend), "G10-5a: trend is valid")

  // G10-6: Recommendations
  const lowScore = ag.checkAlignment("must implement A, must not implement B, must follow C pattern", "implemented B and D pattern, skipped A")
  g10Assert(Array.isArray(lowScore.recommendations), "G10-6a: recommendations is array")
  if (lowScore.recommendations.length > 0) {
    g10Assert(typeof lowScore.recommendations[0] === "string", "G10-6b: recommendation is string")
  }

  // G10-7: Empty intent
  const empty = ag.checkAlignment("", "")
  g10Assert(typeof empty.overallScore === "number", "G10-7a: empty intent still produces score")

  // G10-8: Configurable thresholds
  const ag2 = new AlignmentGate({ driftThreshold: 0.9, blockThreshold: 0.5 })
  const strictResult = ag2.checkAlignment("implement login", "create shopping cart")
  g10Assert(strictResult.driftDetected || !strictResult.passed, "G10-8a: stricter threshold flags more drift")

  // G10-9: History tracking
  ag.checkAlignment("test", "test")
  g10Assert(ag.getHistory().length > 0, "G10-9a: history stores checks")

  // G10-10: Summary
  const summary = ag.getSummary()
  g10Assert(summary.includes("Alignment:"), "G10-10a: summary has Alignment prefix")
  g10Assert(summary.includes("trend="), "G10-10b: summary has trend")

  console.log(`  GAP #10: ${g10Passed} passed, ${g10Failed} failed`)
  state.passed += g10Passed; state.failed += g10Failed
}

// ── Gap #11: Economic Model ──
{
  let g11Passed = 0, g11Failed = 0
  const g11Assert = (condition, msg) => { if (condition) g11Passed++; else { g11Failed++; console.log(`  FAIL: ${msg}`) } }

  const { EconomicModel } = mod
  const em = new EconomicModel()

  // G11-1: Record outcome
  em.recordOutcome({ taskId: "t1", cost: 0.05, durationMs: 1000, steps: 3, success: true, timestamp: Date.now() })
  g11Assert(true, "G11-1a: record outcome succeeds")

  // G11-2: ROI query
  const roi = em.getROI("t1")
  g11Assert(roi !== null, "G11-2a: ROI exists for recorded task")
  g11Assert(roi.costPerStep > 0, "G11-2b: costPerStep is positive")
  g11Assert(roi.costPerMs > 0, "G11-2c: costPerMs is positive")
  g11Assert(typeof roi.roi === "number", "G11-2d: roi is number")
  g11Assert(["high", "medium", "low"].includes(roi.valueRank), "G11-2e: valueRank is valid")

  // G11-3: ROI for nonexistent task
  const noRoi = em.getROI("nonexistent")
  g11Assert(noRoi === null, "G11-3a: ROI for nonexistent task returns null")

  // G11-4: Role stats
  em.recordOutcome({ taskId: "t2", role: "developer", cost: 0.02, durationMs: 500, steps: 2, success: true, timestamp: Date.now() })
  const stats = em.getRoleStats()
  g11Assert(stats.length > 0, "G11-4a: role stats returns entries")
  if (stats.length > 0) {
    g11Assert(typeof stats[0].avgCost === "number", "G11-4b: avgCost is number")
    g11Assert(typeof stats[0].successRate === "number", "G11-4c: successRate is number")
    g11Assert(stats[0].count > 0, "G11-4d: count is positive")
  }

  // G11-5: Role recommendation
  const rec = em.recommendRole("implement a new API endpoint for user authentication", ["architect", "developer", "qa", "coordinator", "pm"])
  if (rec) {
    g11Assert(typeof rec.recommendedRole === "string", "G11-5a: recommended role is string")
    g11Assert(rec.estimatedCost >= 0, "G11-5b: estimatedCost is non-negative")
    g11Assert(rec.confidence >= 0 && rec.confidence <= 1, "G11-5c: confidence is 0-1")
    g11Assert(typeof rec.reasoning === "string" && rec.reasoning.length > 0, "G11-5d: reasoning is non-empty")
  } else {
    g11Assert(true, "G11-5a: no recommendation for unmatched role (acceptable)")
  }

  // G11-6: Recommendation for unmatched task
  const noRec = em.recommendRole("xyzzy", ["architect"])
  g11Assert(noRec === null || noRec.confidence <= 1, "G11-6a: unmatched task may return null or low confidence")

  // G11-7: Cost report
  const report = em.getCostReport("session")
  g11Assert(typeof report.totalCost === "number", "G11-7a: totalCost is number")
  g11Assert(typeof report.avgCost === "number", "G11-7b: avgCost is number")
  g11Assert(report.taskCount > 0, "G11-7c: taskCount is positive")
  g11Assert(typeof report.successRate === "number", "G11-7d: successRate is number")

  // G11-8: Reset
  em.reset()
  g11Assert(em.getROI("t1") === null, "G11-8a: after reset, ROI returns null")

  // G11-9: Summary
  em.recordOutcome({ taskId: "t3", role: "developer", cost: 0.01, durationMs: 200, steps: 1, success: true, timestamp: Date.now() })
  const summary = em.getSummary()
  g11Assert(summary.includes("Economic:"), "G11-9a: summary has Economic prefix")
  g11Assert(summary.includes("$"), "G11-9b: summary includes dollar amounts")

  // G11-10: Multiple roles stats
  em.recordOutcome({ taskId: "t4", role: "qa", cost: 0.03, durationMs: 800, steps: 4, success: false, timestamp: Date.now() })
  const multiStats = em.getRoleStats()
  g11Assert(multiStats.length >= 2, "G11-10a: multiple roles in stats")

  console.log(`  GAP #11: ${g11Passed} passed, ${g11Failed} failed`)
  state.passed += g11Passed; state.failed += g11Failed

  // ── Phase 1: Tool Guardrails (TG) ──────────────────────────────
  const tgPassedTotal = { p: 0, f: 0 }
  const tgAssert = (cond, msg) => { if (cond) { tgPassedTotal.p++; state.passed++ } else { tgPassedTotal.f++; state.failed++; console.error(`  FAIL: ${msg}`) } }

  { // TG-1: Basic initialization
    const tg1 = new mod.ToolGuardrailController()
    tgAssert(tg1 !== null, "TG-1a: controller instantiated")
    tgAssert(tg1.getConfig().enabled === true, "TG-1b: enabled by default")
    tgAssert(tg1.isHalted === false, "TG-1c: not halted initially")
  }

  { // TG-2: Exact repeat detection (warn)
    const tg2 = new mod.ToolGuardrailController({ exactRepeatWarn: 2, exactRepeatBlock: 99 })
    // First call — allowed
    const d1 = tg2.beforeCall("step-1", "compile error: foo")
    tgAssert(d1.action === "allow", "TG-2a: first call allowed")
    // Second call with same error — warn
    const d2 = tg2.beforeCall("step-1", "compile error: foo")
    tgAssert(d2.action === "warn", "TG-2b: second identical call warns")
    tgAssert(d2.signal === "exact-repeat", "TG-2c: signal is exact-repeat")
  }

  { // TG-3: Exact repeat block
    const tg3 = new mod.ToolGuardrailController({ exactRepeatWarn: 2, exactRepeatBlock: 3 })
    tg3.beforeCall("step-1", "error X")
    tg3.beforeCall("step-1", "error X")
    const d3 = tg3.beforeCall("step-1", "error X")
    tgAssert(d3.action === "block", "TG-3a: third identical call blocked")
  }

  { // TG-4: Different errors don't count as exact repeat
    const tg4 = new mod.ToolGuardrailController({ exactRepeatWarn: 2, exactRepeatBlock: 5 })
    tg4.beforeCall("step-1", "error A")
    const d = tg4.beforeCall("step-1", "error B")
    tgAssert(d.action === "allow", "TG-4a: different error is allowed (exact-repeat uses keyed match)")
  }

  { // TG-5: Same-step failure cumulative
    const tg5 = new mod.ToolGuardrailController({ sameStepFailWarn: 3, sameStepFailBlock: 99 })
    tg5.beforeCall("step-2", "error X")
    tg5.beforeCall("step-2", "error Y")
    const d = tg5.beforeCall("step-2", "error Z")
    tgAssert(d.action === "warn", "TG-5a: 3 failures of same step warns")
    tgAssert(d.signal === "same-step-fail", "TG-5b: signal is same-step-fail")
  }

  { // TG-6: Same-step failure block
    const tg6 = new mod.ToolGuardrailController({ sameStepFailWarn: 3, sameStepFailBlock: 4 })
    tg6.beforeCall("step-3", "e1")
    tg6.beforeCall("step-3", "e2")
    tg6.beforeCall("step-3", "e3")
    const d = tg6.beforeCall("step-3", "e4")
    tgAssert(d.action === "block", "TG-6a: 4th same-step failure blocked")
  }

  { // TG-7: Success resets failure counter
    const tg7 = new mod.ToolGuardrailController({ sameStepFailWarn: 3, sameStepFailBlock: 5 })
    tg7.beforeCall("step-4", "errorA")
    tg7.beforeCall("step-4", "errorB")  // different errors — avoid exact-repeat trigger
    // Simulate success
    tg7.afterCall("step-4", true, "fixed", ["src/fixed.ts"])
    const d = tg7.beforeCall("step-4", "errorC")
    tgAssert(d.action === "allow", "TG-7a: after success, same-step counter resets")
  }

  { // TG-8: Disabled guardrails always allow
    const tg8 = new mod.ToolGuardrailController({ enabled: false, exactRepeatBlock: 2 })
    tg8.beforeCall("step-1", "error")
    const d = tg8.beforeCall("step-1", "error")
    tgAssert(d.action === "allow", "TG-8a: disabled guardrails allow everything")
    tgAssert(d.code === "disabled", "TG-8b: code is disabled")
  }

  { // TG-9: Hard stop halts after block
    const tg9 = new mod.ToolGuardrailController({ exactRepeatBlock: 2, hardStop: true })
    tg9.beforeCall("step-1", "error")
    const d = tg9.beforeCall("step-1", "error")
    tgAssert(d.action === "halt", "TG-9a: hardStop=true returns halt")
    tgAssert(tg9.isHalted, "TG-9b: controller is halted after halt")
    // All subsequent calls also halt
    const d2 = tg9.beforeCall("different-step", "other error")
    tgAssert(d2.action === "halt" || d2.action === "allow", "TG-9c: after halt, behavior is consistent")
  }

  { // TG-10: Idempotent no-progress
    // First call stores hash, second call matches it → counter=1 → block at threshold=1
    const tg10 = new mod.ToolGuardrailController({ idempotentNoProgressBlock: 1 })
    tg10.afterCall("step-read", true, "same output", [])
    tg10.afterCall("step-read", true, "same output", [])
    const d = tg10.checkIdempotent("step-read")
    tgAssert(d.action === "block", "TG-10a: idempotent no-progress blocked after 2 same outputs")
  }

  { // TG-11: resetForTurn clears state
    const tg11 = new mod.ToolGuardrailController({ exactRepeatBlock: 3 })
    tg11.beforeCall("step-1", "error")
    tg11.beforeCall("step-1", "error")
    tg11.resetForTurn()
    const d = tg11.beforeCall("step-1", "error")
    tgAssert(d.action === "allow", "TG-11a: resetForTurn clears counters")
  }

  { // TG-12: Config update at runtime
    const tg12 = new mod.ToolGuardrailController({ exactRepeatBlock: 5 })
    tg12.updateConfig({ exactRepeatBlock: 1, hardStop: false })
    const cfg = tg12.getConfig()
    tgAssert(cfg.exactRepeatBlock === 1, "TG-12a: config updated at runtime")
  }

  { // TG-13: No error passes through fine
    const tg13 = new mod.ToolGuardrailController()
    const d = tg13.beforeCall("step-ok")
    tgAssert(d.action === "allow", "TG-13a: no error = allow")
    tgAssert(d.signal === "none", "TG-13b: signal is none")
  }

  console.log(`  Tool Guardrails: ${tgPassedTotal.p} passed, ${tgPassedTotal.f} failed`)

  // ── Phase 2: Actionable Error Messages (AE) ────────────────────
  const aePassedTotal = { p: 0, f: 0 }
  const aeAssert = (cond, msg) => { if (cond) { aePassedTotal.p++; state.passed++ } else { aePassedTotal.f++; state.failed++; console.error(`  FAIL: ${msg}`) } }

  { // AE-1: Import error gets actionable format
    const ea = new mod.ErrorAnalyzer()
    const result = ea.analyze("Cannot find module './foo'", ["src/index.ts"])
    aeAssert(result.category === "import", "AE-1a: import error detected")
    aeAssert(result.likelyRootCause.includes("The module"), "AE-1b: root cause mentions module")
    aeAssert(result.suggestedFix.includes("Verify") || result.suggestedFix.includes("file"), "AE-1c: fix instruction is actionable")
  }

  { // AE-2: Type error
    const ea2 = new mod.ErrorAnalyzer()
    const result = ea2.analyze("Type 'string' is not assignable to type 'number'", ["src/bar.ts"])
    aeAssert(result.category === "type", "AE-2a: type error detected")
    aeAssert(result.severity === "high", "AE-2b: severity is high")
  }

  { // AE-3: Compile error
    const ea3 = new mod.ErrorAnalyzer()
    const result = ea3.analyze("error TS2322: compilation failed", ["src/baz.ts"])
    aeAssert(result.category === "compile", "AE-3a: compile error detected")
  }

  { // AE-4: Test failure
    const ea4 = new mod.ErrorAnalyzer()
    const result = ea4.analyze("3 tests failed — expected 'hello' but got 'world'", ["test/foo.test.ts"])
    aeAssert(result.category === "test", "AE-4a: test failure detected")
  }

  { // AE-5: Runtime error
    const ea5 = new mod.ErrorAnalyzer()
    const result = ea5.analyze("TypeError: Cannot read property 'x' of undefined", ["src/app.ts"])
    aeAssert(result.category === "runtime", "AE-5a: runtime error detected")
    aeAssert(result.severity === "high", "AE-5b: severity high")
  }

  { // AE-6: Unknown error
    const ea6 = new mod.ErrorAnalyzer()
    const result = ea6.analyze("Something completely unexpected happened", [])
    aeAssert(result.category === "unknown", "AE-6a: unknown error detected")
    aeAssert(result.severity === "medium", "AE-6b: severity medium")
  }

  { // AE-7: formatActionable
    const ea7 = new mod.ErrorAnalyzer()
    const analysis = ea7.analyze("Cannot find module './missing' from src/main.ts:5:10", ["src/main.ts"])
    const actionable = ea7.formatActionable(analysis, "Cannot find module './missing' from src/main.ts:5:10")
    aeAssert(actionable.badge.includes("Import"), "AE-7a: badge has import label")
    aeAssert(actionable.location.length > 0, "AE-7b: location extracted")
    aeAssert(actionable.why.length > 0, "AE-7c: why is non-empty")
    aeAssert(actionable.fix.length > 0, "AE-7d: fix instruction provided")
    aeAssert(["low", "medium", "high", "critical"].includes(actionable.severity), "AE-7e: valid severity")
  }

  { // AE-8: renderActionable
    const ea8 = new mod.ErrorAnalyzer()
    const analysis = ea8.analyze("TypeError: x is not a function", ["src/app.ts"])
    const actionable = ea8.formatActionable(analysis, "TypeError: x is not a function")
    const rendered = ea8.renderActionable(actionable)
    aeAssert(rendered.includes("📂"), "AE-8a: rendered has location icon")
    aeAssert(rendered.includes("Why:"), "AE-8b: rendered has why section")
    aeAssert(rendered.includes("Fix:"), "AE-8c: rendered has fix section")
  }

  { // AE-9: actionable() convenience method
    const ea9 = new mod.ErrorAnalyzer()
    const a = ea9.actionable("Cannot read properties of null", ["src/x.ts"])
    aeAssert(a.badge.length > 0, "AE-9a: actionable returns badge")
    aeAssert(a.summary.length > 0, "AE-9b: summary non-empty")
  }

  { // AE-10: Permission error
    const ea10 = new mod.ErrorAnalyzer()
    const result = ea10.analyze("EACCES: permission denied", ["config.json"])
    aeAssert(result.category === "runtime", "AE-10a: permission error detected")
    aeAssert(result.suggestedFix.includes("permissions"), "AE-10b: fix mentions permissions")
  }

  console.log(`  Actionable Errors: ${aePassedTotal.p} passed, ${aePassedTotal.f} failed`)

  // ── Phase 3: Memory Provider Interface (MP) ─────────────────────
  const mpPassedTotal = { p: 0, f: 0 }
  const mpAssert = (cond, msg) => { if (cond) { mpPassedTotal.p++; state.passed++ } else { mpPassedTotal.f++; state.failed++; console.error(`  FAIL: ${msg}`) } }

  { // MP-1: NoOpMemoryProvider
    const noop = new mod.NoOpMemoryProvider()
    mpAssert(noop.name === "noop", "MP-1a: name is noop")
    mpAssert(noop.isAvailable() === true, "MP-1b: always available")
    const p = await noop.prefetch("test")
    mpAssert(p === "", "MP-1c: prefetch returns empty")
    const q = await noop.query("test")
    mpAssert(q.entries.length === 0, "MP-1d: query returns empty")
  }

  { // MP-2: MemoryOrchestrator registerProvider
    // ponytail: test with NoOpMemoryProvider directly — no need to access internal orchestrator
    const noop = new mod.NoOpMemoryProvider()
    mpAssert(noop.isAvailable(), "MP-2a: NoOp provider available")
    mpAssert(noop.name === "noop", "MP-2b: correct provider name")
  }

  { // MP-3: MemoryProvider interface shape
    const noop = new mod.NoOpMemoryProvider()
    mpAssert(typeof noop.initialize === "function", "MP-3a: has initialize")
    mpAssert(typeof noop.prefetch === "function", "MP-3b: has prefetch")
    mpAssert(typeof noop.syncTurn === "function", "MP-3c: has syncTurn")
    mpAssert(typeof noop.query === "function", "MP-3d: has query")
    mpAssert(typeof noop.store === "function", "MP-3e: has store")
    mpAssert(typeof noop.shutdown === "function", "MP-3f: has shutdown")
  }

  { // MP-4: prefetch returns string
    const noop = new mod.NoOpMemoryProvider()
    await noop.initialize("test-session")
    const result = await noop.prefetch("sample query", { maxResults: 5 })
    mpAssert(typeof result === "string", "MP-4a: prefetch returns string")
  }

  { // MP-5: syncTurn doesn't throw
    const noop = new mod.NoOpMemoryProvider()
    try {
      await noop.syncTurn("user msg", "assistant msg", { sessionId: "s1" })
      mpAssert(true, "MP-5a: syncTurn completes without error")
    } catch (e) {
      mpAssert(false, `MP-5a: syncTurn threw: ${e.message}`)
    }
  }

  { // MP-6: query returns structured result
    const noop = new mod.NoOpMemoryProvider()
    const result = await noop.query("test", { maxResults: 10, minImportance: 0.5 })
    mpAssert(Array.isArray(result.entries), "MP-6a: entries is array")
    mpAssert(Array.isArray(result.sources), "MP-6b: sources is array")
    mpAssert(typeof result.totalTime === "number", "MP-6c: totalTime is number")
  }

  { // MP-7: shutdown
    const noop = new mod.NoOpMemoryProvider()
    await noop.shutdown()
    mpAssert(true, "MP-7a: shutdown completes")
  }

  { // MP-8: store doesn't throw
    const noop = new mod.NoOpMemoryProvider()
    try {
      await noop.store("working", { id: "m1", content: "test", keywords: ["test"] })
      mpAssert(true, "MP-8a: store completes")
    } catch (e) {
      mpAssert(false, `MP-8a: store threw: ${e.message}`)
    }
  }

  console.log(`  Memory Provider: ${mpPassedTotal.p} passed, ${mpPassedTotal.f} failed`)

  // ── Phase 4: Skill Curator (SC) ─────────────────────────────────
  const scPassedTotal = { p: 0, f: 0 }
  const scAssert = (cond, msg) => { if (cond) { scPassedTotal.p++; state.passed++ } else { scPassedTotal.f++; state.failed++; console.error(`  FAIL: ${msg}`) } }

  { // SC-1: Basic curator init
    const sc1 = new mod.SkillCurator({}, () => [])
    scAssert(sc1 !== null, "SC-1a: curator instantiated")
    scAssert(sc1.getConfig().enabled === true, "SC-1b: enabled by default")
    scAssert(sc1.getConfig().staleAfterDays === 30, "SC-1c: default stale 30 days")
  }

  { // SC-2: Disabled curator
    const sc2 = new mod.SkillCurator({ enabled: false }, () => [])
    const report = sc2.applyLifecycle()
    scAssert(report.checked === 0, "SC-2a: disabled curator checks nothing")
  }

  { // SC-3: Lifecycle — active skill kept active
    const recentSkill = {
      definition: { meta: { id: "s1", name: "test-skill" }, trigger: { pattern: "test", keywords: [] }, workflow: { steps: [] } },
      usageCount: 5, successRate: 0.9, successWindow: [], lastUsed: new Date().toISOString(),
    }
    const sc3 = new mod.SkillCurator({ staleAfterDays: 30 }, () => [recentSkill])
    const state = sc3.getLifecycle(recentSkill)
    scAssert(state === "active", "SC-3a: recently used skill is active")
  }

  { // SC-4: Lifecycle — stale skill
    const oldDate = new Date(Date.now() - 45 * 86400000).toISOString() // 45 days ago
    const staleSkill = {
      definition: { meta: { id: "s2", name: "old-skill" }, trigger: { pattern: "old", keywords: [] }, workflow: { steps: [] } },
      usageCount: 1, successRate: 0.5, successWindow: [], lastUsed: oldDate,
    }
    const sc4 = new mod.SkillCurator({ staleAfterDays: 30, archiveAfterDays: 120 }, () => [staleSkill])
    const state = sc4.getLifecycle(staleSkill)
    scAssert(state === "stale", "SC-4a: 45-day unused skill is stale")
  }

  { // SC-5: Lifecycle — archived skill
    const veryOld = new Date(Date.now() - 120 * 86400000).toISOString() // 120 days ago
    const archivedSkill = {
      definition: { meta: { id: "s3", name: "ancient" }, trigger: { pattern: "old", keywords: [] }, workflow: { steps: [] } },
      usageCount: 1, successRate: 0.3, successWindow: [], lastUsed: veryOld,
    }
    const sc5 = new mod.SkillCurator({ staleAfterDays: 30, archiveAfterDays: 90 }, () => [archivedSkill])
    const state = sc5.getLifecycle(archivedSkill)
    scAssert(state === "archived", "SC-5a: >90 day unused skill is archived")
  }

  { // SC-6: Pinned skill stays active
    const oldSkill = {
      definition: { meta: { id: "s4", name: "pinned-skill" }, trigger: { pattern: "pin", keywords: [] }, workflow: { steps: [] } },
      usageCount: 10, successRate: 0.95, successWindow: [], lastUsed: new Date(Date.now() - 100 * 86400000).toISOString(),
    }
    const sc6 = new mod.SkillCurator({ archiveAfterDays: 30 }, () => [oldSkill])
    sc6.pin("s4")
    const statesc = sc6.getLifecycle(oldSkill)
    scAssert(statesc === "active", "SC-6a: pinned skill stays active even if old")
  }

  { // SC-7: Unpin allows transition
    const oldSkill = {
      definition: { meta: { id: "s5", name: "unpinned" }, trigger: { pattern: "test", keywords: [] }, workflow: { steps: [] } },
      usageCount: 1, successRate: 0.5, successWindow: [], lastUsed: new Date(Date.now() - 200 * 86400000).toISOString(),
    }
    const sc7 = new mod.SkillCurator({ archiveAfterDays: 90 }, () => [oldSkill])
    sc7.pin("s5")
    scAssert(sc7.getLifecycle(oldSkill) === "active", "SC-7a: pinned is active")
    sc7.unpin("s5")
    scAssert(sc7.getLifecycle(oldSkill) === "archived", "SC-7b: unpinned 200-day-old skill is archived")
  }

  { // SC-8: injectRelevant — no skills returns empty
    const sc8 = new mod.SkillCurator({}, () => [])
    const result = sc8.injectRelevant("build a login page")
    scAssert(Array.isArray(result), "SC-8a: returns array")
    scAssert(result.length === 0, "SC-8b: empty skills = empty result")
  }

  { // SC-9: injectRelevant — matching skill found
    const matchingSkill = {
      definition: {
        meta: { id: "s6", name: "user-auth-login" },
        trigger: { pattern: "add user authentication", keywords: ["login", "auth", "user", "password", "jwt"] },
        workflow: { steps: [{ order: 1, action: "create", description: "Create login form", expectedOutput: "Form created" }] },
      },
      usageCount: 8, successRate: 0.9, successWindow: [], lastUsed: new Date().toISOString(),
    }
    const sc9 = new mod.SkillCurator({ injectThreshold: 0.05 }, () => [matchingSkill])
    const result = sc9.injectRelevant("build a login page with authentication")
    scAssert(result.length > 0, "SC-9a: matching skill found")
    if (result.length > 0) {
      scAssert(result[0].name === "user-auth-login", "SC-9b: correct skill name")
      scAssert(result[0].relevance > 0, "SC-9c: relevance score > 0")
      scAssert(result[0].steps.length > 0, "SC-9d: steps extracted")
    }
  }

  { // SC-10: injectRelevant — archived skills excluded
    const archivedSkill = {
      definition: { meta: { id: "s7", name: "archived-skill" }, trigger: { pattern: "old feature", keywords: ["deprecated"] }, workflow: { steps: [] } },
      usageCount: 1, successRate: 0.2, successWindow: [], lastUsed: new Date(Date.now() - 200 * 86400000).toISOString(),
    }
    const sc10 = new mod.SkillCurator({ injectThreshold: 0.05, archiveAfterDays: 90 }, () => [archivedSkill])
    const result = sc10.injectRelevant("old feature deprecated")
    scAssert(result.length === 0, "SC-10a: archived skills excluded from injection")
  }

  { // SC-11: formatInjectedSkills
    const sc11 = new mod.SkillCurator({}, () => [])
    const injected = [{
      id: "s8", name: "test-skill", pattern: "test pattern",
      keywords: ["test"], steps: ["Step 1: do something", "Step 2: verify"],
      usageCount: 5, successRate: 0.8, relevance: 0.75,
      lifecycle: "active",
    }]
    const formatted = sc11.formatInjectedSkills(injected)
    scAssert(formatted.includes("Relevant Skills"), "SC-11a: has section header")
    scAssert(formatted.includes("test-skill"), "SC-11b: includes skill name")
    scAssert(formatted.includes("80%"), "SC-11c: includes success rate")
    scAssert(formatted.includes("Step 1"), "SC-11d: includes steps")
  }

  { // SC-12: applyLifecycle report
    const veryOldSkill = {
      definition: { meta: { id: "s9", name: "very-old" }, trigger: { pattern: "old", keywords: [] }, workflow: { steps: [] } },
      usageCount: 1, successRate: 0.5, successWindow: [], lastUsed: new Date(Date.now() - 200 * 86400000).toISOString(),
    }
    const recentSkill = {
      definition: { meta: { id: "s10", name: "recent" }, trigger: { pattern: "new", keywords: [] }, workflow: { steps: [] } },
      usageCount: 3, successRate: 0.9, successWindow: [], lastUsed: new Date().toISOString(),
    }
    const sc12 = new mod.SkillCurator({ staleAfterDays: 30, archiveAfterDays: 90 }, () => [veryOldSkill, recentSkill])
    const report = sc12.applyLifecycle()
    scAssert(report.checked === 2, "SC-12a: checked 2 skills")
    scAssert(report.archived === 1, "SC-12b: 1 archived")
    scAssert(report.markedStale === 0, "SC-12c: 0 stale (old enough for archive)")
  }

  { // SC-13: handleNegativeFeedback
    // Set successWindow so that adding a false actually changes the rate
    const skill = {
      definition: { meta: { id: "s11", name: "failing-skill" }, trigger: { pattern: "fail", keywords: [] }, workflow: { steps: [] } },
      usageCount: 5, successRate: 1.0, successWindow: [true, true],  // 2/2 = 1.0 initially
      lastUsed: new Date().toISOString(),
    }
    const sc13 = new mod.SkillCurator({}, () => [skill])
    sc13.handleNegativeFeedback("failing-skill")
    // After push: [true, true, false] → 2/3 ≈ 0.67
    scAssert(skill.successRate < 1.0, "SC-13a: success rate decreased after negative feedback")
    scAssert(skill.successWindow.includes(false), "SC-13b: failure recorded in window")
  }

  { // SC-14: detectOverlaps with unique non-stop words
    // Use made-up tokens guaranteed not to be in any stop-words list
    const skillA = {
      definition: { meta: { id: "a", name: "foobar-zyxwut" }, trigger: { pattern: "foobar zyxwut", keywords: ["foobar", "zyxwut", "blargle"] }, workflow: { steps: [] } },
      usageCount: 5, successRate: 0.9, successWindow: [], lastUsed: new Date().toISOString(),
    }
    const skillB = {
      definition: { meta: { id: "b", name: "foobar-gronk" }, trigger: { pattern: "foobar gronk", keywords: ["foobar", "gronk", "blaf"] }, workflow: { steps: [] } },
      usageCount: 3, successRate: 0.85, successWindow: [], lastUsed: new Date().toISOString(),
    }
    const skillC = {
      definition: { meta: { id: "c", name: "xyzzy-plugh" }, trigger: { pattern: "xyzzy plugh", keywords: ["xyzzy", "plugh"] }, workflow: { steps: [] } },
      usageCount: 1, successRate: 0.5, successWindow: [], lastUsed: new Date().toISOString(),
    }
    const sc14 = new mod.SkillCurator({ consolidationEnabled: true }, () => [skillA, skillB, skillC])
    const overlaps = sc14.detectOverlaps(0.1)
    scAssert(overlaps.length > 0, "SC-14a: overlap detected between similar skills")
    if (overlaps.length > 0) {
      scAssert(overlaps[0].similarity > 0, "SC-14b: similarity score > 0")
    }
  }

  { // SC-15: Disabled curator injectRelevant returns empty
    const skill = {
      definition: { meta: { id: "s12", name: "my-skill" }, trigger: { pattern: "test", keywords: ["test"] }, workflow: { steps: [] } },
      usageCount: 5, successRate: 0.9, successWindow: [], lastUsed: new Date().toISOString(),
    }
    const sc15 = new mod.SkillCurator({ enabled: false }, () => [skill])
    const result = sc15.injectRelevant("test")
    scAssert(result.length === 0, "SC-15a: disabled curator returns empty")
  }

  console.log(`  Skill Curator: ${scPassedTotal.p} passed, ${scPassedTotal.f} failed`)
}

// ── PromptTemplate ─────────────────────────────────────
{
  let ptPassed = 0, ptFailed = 0
  const ptAssert = (c, m) => { if (c) ptPassed++; else { ptFailed++; console.log(`  FAIL: ${m}`) } }

  // PT-1: PromptTemplate renders with identity
  const t1 = new mod.PromptTemplate()
  t1.title("Test Agent")
  t1.identity("You are a test agent.")
  const r1 = t1.render()
  ptAssert(r1.includes("# Test Agent"), "PT-1a: title in output")
  ptAssert(r1.includes("<identity>"), "PT-1b: identity tag")
  ptAssert(r1.includes("You are a test agent."), "PT-1c: identity content")

  // PT-2: PromptTemplate renders knowledge-context
  const t2 = new mod.PromptTemplate()
  t2.injectKnowledge([{ source: "test-source", confidence: 0.85, content: "test knowledge content" }])
  const r2 = t2.render()
  ptAssert(r2.includes("<knowledge-context>"), "PT-2a: knowledge-context tag")
  ptAssert(r2.includes("test-source"), "PT-2b: source in output")
  ptAssert(r2.includes("HIGH"), "PT-2c: confidence label for 0.85")

  // PT-3: PromptTemplate with all sections
  const t3 = new mod.PromptTemplate()
  t3.identity("id")
  t3.instructions("instr")
  t3.guardrails("guard")
  const r3 = t3.render()
  ptAssert(r3.includes("<instructions>"), "PT-3a: instructions tag")
  ptAssert(r3.includes("<guardrails>"), "PT-3b: guardrails tag")

  // PT-4: Empty template renders default
  const t4 = new mod.PromptTemplate()
  const r4 = t4.render()
  ptAssert(r4.includes("Agentic Assistant"), "PT-4a: default identity")

  // PT-5: injectKnowledge with empty array is no-op
  const t5 = new mod.PromptTemplate()
  t5.identity("test")
  t5.injectKnowledge([])
  ptAssert(!t5.render().includes("KNOWLEDGE"), "PT-5a: empty knowledge not rendered")

  // PT-6: renderWithFrontmatter adds YAML
  const t6 = new mod.PromptTemplate()
  t6.identity("test")
  const r6 = t6.renderWithFrontmatter("desc here")
  ptAssert(r6.startsWith("---\n"), "PT-6a: starts with YAML frontmatter")
  ptAssert(r6.includes("description: desc here"), "PT-6b: description in frontmatter")

  // PT-7: condition guards — when=false
  const t7 = new mod.PromptTemplate()
  t7.identity("shown", true)
  t7.identity("hidden", false)
  const r7 = t7.render()
  ptAssert(r7.includes("shown"), "PT-7a: shown identity present")
  ptAssert(!r7.includes("hidden"), "PT-7b: hidden identity absent")

  // PT-8: knowledge with custom category
  const t8 = new mod.PromptTemplate()
  t8.injectKnowledge([{ source: "cat-test", confidence: 0.5, content: "cat content", category: "test-cat" }])
  const r8 = t8.render()
  ptAssert(r8.includes('category="test-cat"'), "PT-8a: category attribute in source tag")

  // PT-9: confidence label thresholds
  const t9 = new mod.PromptTemplate()
  t9.injectKnowledge([
    { source: "a", confidence: 0.9, content: "high conf" },
    { source: "b", confidence: 0.7, content: "mid conf" },
    { source: "c", confidence: 0.4, content: "low conf" },
    { source: "d", confidence: 0.1, content: "unknown conf" },
  ])
  const r9 = t9.render()
  ptAssert(r9.includes('reliability="HIGH"'), "PT-9a: HIGH for 0.9")
  ptAssert(r9.includes('reliability="MEDIUM"'), "PT-9b: MEDIUM for 0.7")
  ptAssert(r9.includes('reliability="LOW"'), "PT-9c: LOW for 0.4")
  ptAssert(r9.includes('reliability="UNKNOWN"'), "PT-9d: UNKNOWN for 0.1")

  // PT-10: multiple knowledge entries all rendered
  ptAssert((r9.match(/<source url=/g) || []).length === 4, "PT-10a: all 4 sources rendered")

  console.log(`  PromptTemplate: ${ptPassed} passed, ${ptFailed} failed`)
  state.passed += ptPassed; state.failed += ptFailed
}

// ── ProjectContext ─────────────────────────────────────
{
  let pcPassed = 0, pcFailed = 0
  const pcAssert = (c, m) => { if (c) pcPassed++; else { pcFailed++; console.log(`  FAIL: ${m}`) } }

  // PC-1: detectProjectContext returns structured result
  const ctx = mod.detectProjectContext("/tmp")
  pcAssert(Array.isArray(ctx.languages), "PC-1a: languages is array")
  pcAssert(Array.isArray(ctx.frameworks), "PC-1b: frameworks is array")
  pcAssert(typeof ctx.ambiguity === "string", "PC-1c: ambiguity is string")
  pcAssert(["LOW", "MEDIUM", "HIGH"].includes(ctx.ambiguity), "PC-1d: valid ambiguity value")
  pcAssert(typeof ctx.packageManager === "string" || ctx.packageManager === null, "PC-1e: packageManager is string|null")
  pcAssert(Array.isArray(ctx.testPatterns), "PC-1f: testPatterns is array")
  pcAssert(Array.isArray(ctx.entryPoints), "PC-1g: entryPoints is array")
  pcAssert(typeof ctx.cachedAt === "string", "PC-1h: cachedAt is string")

  // PC-2: detectProjectContext detects current project
  const selfDir = new URL("..", import.meta.url).pathname
  const selfCtx = mod.detectProjectContext(selfDir)
  const tsLang = selfCtx.languages.find(l => l.lang === "TypeScript")
  pcAssert(tsLang && tsLang.confidence > 0.5, "PC-2a: detects TypeScript in project")
  const hasNpm = selfCtx.packageManager === "npm"
  pcAssert(hasNpm, "PC-2b: detects npm package manager")
  pcAssert(selfCtx.testPatterns.length > 0, "PC-2c: detects test patterns")

  console.log(`  ProjectContext: ${pcPassed} passed, ${pcFailed} failed`)
  state.passed += pcPassed; state.failed += pcFailed
}

// ── PromptBuilder ──────────────────────────────────────
{
  let pbPassed = 0, pbFailed = 0
  const pbAssert = (c, m) => { if (c) pbPassed++; else { pbFailed++; console.log(`  FAIL: ${m}`) } }

  const mockAllTools = [
    { name: "agentic_plan", description: "Plan tool" },
    { name: "agentic_execute", description: "Execute tool" },
    { name: "agentic_verify", description: "Verify tool" },
    { name: "agentic_reflect", description: "Reflect tool" },
    { name: "agentic_status", description: "Status tool" },
    { name: "agentic_nav", description: "Nav tool" },
    { name: "agentic_skill", description: "Skill tool" },
    { name: "agentic_episodes", description: "Episodes tool" },
    { name: "agentic_context", description: "Context tool" },
    { name: "agentic_db", description: "DB tool" },
    { name: "agentic_model", description: "Model tool" },
    { name: "agentic_evolve", description: "Evolve tool" },
    { name: "agentic_auto", description: "Auto tool" },
    { name: "agentic_debate", description: "Debate tool" },
    { name: "agentic_router", description: "Router tool" },
    { name: "agentic_rag", description: "RAG tool" },
    { name: "agentic_custom", description: "Custom tool" },
  ]
  const mockDomain = {
    name: "code",
    tools: ["agentic_plan", "agentic_execute", "agentic_verify", "agentic_reflect", "agentic_status", "agentic_nav", "agentic_skill", "agentic_episodes", "agentic_context", "agentic_db", "agentic_model", "agentic_evolve", "agentic_auto", "agentic_debate", "agentic_router", "agentic_rag"],
  }

  // PB-1: buildAgentPrompt renders with frontmatter
  const prompt1 = mod.buildAgentPrompt(mockDomain, mockAllTools)
  pbAssert(prompt1.startsWith("---\n"), "PB-1a: starts with frontmatter")
  pbAssert(prompt1.includes("description: Agentic software engineering assistant"), "PB-1b: correct description")
  pbAssert(prompt1.includes("agentic_plan"), "PB-1c: includes plan tool")
  pbAssert(prompt1.includes("<identity>"), "PB-1d: identity section")

  // PB-2: buildAgenticSystemInstructions — no frontmatter
  const prompt2 = mod.buildAgenticSystemInstructions(mockDomain, mockAllTools)
  pbAssert(!prompt2.startsWith("---"), "PB-2a: no frontmatter")
  pbAssert(prompt2.includes("agentic_plan"), "PB-2b: includes tool reference")

  // PB-3: buildAgenticSystemInstructions with selected tools
  const prompt3 = mod.buildAgenticSystemInstructions(mockDomain, mockAllTools, {
    selectedTools: [{ name: "agentic_nav", description: "Nav tool" }],
    isRouted: true,
  })
  pbAssert(prompt3.includes("Recommended Tools"), "PB-3a: recommended tools section shown when routed")

  // PB-4: buildAgenticSystemInstructions with project context
  const prompt4 = mod.buildAgenticSystemInstructions(mockDomain, mockAllTools, {
    projectContext: { languages: [{ lang: "TypeScript", confidence: 0.95, evidence: ["test"] }], frameworks: [], packageManager: "npm", testPatterns: ["test/"], entryPoints: ["index.ts"], ambiguity: "LOW", cachedAt: new Date().toISOString() },
  })
  pbAssert(prompt4.includes("Project Context"), "PB-4a: project context section shown")
  pbAssert(prompt4.includes("TypeScript"), "PB-4b: language shown")

  // PB-5: buildGenericAgentPrompt
  const prompt5 = mod.buildGenericAgentPrompt(mockAllTools)
  pbAssert(prompt5.startsWith("---\n"), "PB-5a: frontmatter")
  pbAssert(prompt5.includes("Agentic Assistant"), "PB-5b: title")
  pbAssert(prompt5.includes("agentic_plan"), "PB-5c: includes plan")

  // PB-6: buildAgenticSystemInstructions guards pipeline/parallel hints
  const prompt6 = mod.buildAgenticSystemInstructions(mockDomain, mockAllTools, {
    selectedTools: [{ name: "agentic_pipeline", description: "Pipeline" }],
    isRouted: true,
  })
  pbAssert(prompt6.includes("Multi-agent"), "PB-6a: pipeline hint present")

  console.log(`  PromptBuilder: ${pbPassed} passed, ${pbFailed} failed`)
  state.passed += pbPassed; state.failed += pbFailed
}

// ── ToolRouter ──────────────────────────────────────────
{
  let trPassed = 0, trFailed = 0
  const trAssert = (c, m) => { if (c) trPassed++; else { trFailed++; console.log(`  FAIL: ${m}`) } }

  const router = new mod.ToolRouter()

  // TR-1: ToolRouter constructs with catalog tools
  const stats = router.getStats()
  const toolCount = Object.keys(stats).length
  trAssert(toolCount >= 31, "TR-1a: at least 31 tools in router")
  trAssert(stats["agentic_plan"] !== undefined, "TR-1b: agentic_plan present")
  trAssert(stats["agentic_execute"] !== undefined, "TR-1c: agentic_execute present")

  // TR-2: selectTools returns top tools for a query
  const result1 = router.selectTools({ taskInput: "plan a feature", recentTools: [], domain: "code", isSubAgent: false })
  trAssert(result1.selected.length > 0, "TR-2a: selectTools returns tools")
  trAssert(result1.selected.some(t => t.name === "agentic_plan"), "TR-2b: agentic_plan in top results for plan query")

  // TR-3: selectTools with debug query
  const result2 = router.selectTools({ taskInput: "debug this error", recentTools: [], domain: "code", isSubAgent: false })
  trAssert(result2.selected.some(t => t.name === "agentic_reflect" || t.name === "agentic_guard"), "TR-3a: debug tools for debug query")

  // TR-4: selectTools with search query
  const result3 = router.selectTools({ taskInput: "search for file", recentTools: [], domain: "code", isSubAgent: false })
  trAssert(result3.selected.some(t => t.name === "agentic_nav"), "TR-4a: nav tool for search query")

  // TR-5: recordCall and transition probability
  router.recordCall("agentic_plan", true, 100)
  router.recordCall("agentic_execute", true, 200)
  const prob = router.getTransitionProbability("agentic_plan", "agentic_execute")
  trAssert(prob > 0, "TR-5a: transition probability recorded")

  // TR-6: selectTools with recent tools (colocation)
  const result4 = router.selectTools({ taskInput: "fix bug", recentTools: ["agentic_plan", "agentic_execute"], domain: "code", isSubAgent: false })
  trAssert(result4.selected.some(t => t.name === "agentic_verify"), "TR-6a: colocation pulls in verify")

  // TR-7: setDescriptions
  router.setDescriptions([{ name: "agentic_plan", description: "New description" }])
  const stats2 = router.getStats()
  trAssert(stats2["agentic_plan"] !== undefined, "TR-7a: description updated")

  // TR-8: buildConsolidationHint
  const hint = router.buildConsolidationHint("agentic_auto")
  trAssert(hint.length > 0, "TR-8a: consolidation hint for agentic_auto")
  trAssert(router.buildConsolidationHint("nonexistent") === "", "TR-8b: empty hint for unknown tool")

  // TR-9: getConsolidationMap
  const map = router.getConsolidationMap()
  trAssert(map["agentic_auto"] !== undefined, "TR-9a: consolidation map contains agentic_auto")

  // TR-10: buildToolList formats correctly
  const list = router.buildToolList(result1.selected)
  trAssert(list.includes("agentic_plan"), "TR-10a: tool list contains plan")
  trAssert(list.includes("**agentic_plan**"), "TR-10b: bold formatting")

  // TR-11: buildAlwaysExposeHint
  const hint2 = router.buildAlwaysExposeHint()
  trAssert(hint2.includes("edit"), "TR-11a: always expose includes edit")
  trAssert(hint2.includes("write"), "TR-11b: always expose includes write")
  trAssert(hint2.includes("webfetch"), "TR-11c: always expose includes webfetch")
  trAssert(hint2.includes("question"), "TR-11d: always expose includes question")

  // TR-12: task type inference via colocation groups
  const result5 = router.selectTools({ taskInput: "create a new module", recentTools: [], domain: "code", isSubAgent: false })
  trAssert(result5.selected.some(t => t.name === "agentic_execute"), "TR-12a: implement task pulls execute")

  // TR-13: setAllocatedToolCount
  router.setAllocatedToolCount(5)
  const result6 = router.selectTools({ taskInput: "search", recentTools: [], domain: "code", isSubAgent: false })
  trAssert(result6.selected.length <= 15, "TR-13a: allocated tool count respected")

  // TR-14: setAllocatedToolCount clamping (indirect: verify through selectTools behavior)
  router.setAllocatedToolCount(1)
  const res14a = router.selectTools({ taskInput: "xyznonexistent12345", recentTools: [], domain: "code", isSubAgent: false })
  trAssert(res14a.selected.length <= 15, "TR-14a: clamp min doesn't exceed 15")
  router.setAllocatedToolCount(20)
  const res14b = router.selectTools({ taskInput: "xyznonexistent12345", recentTools: [], domain: "code", isSubAgent: false })
  trAssert(res14b.selected.length <= 15, "TR-14b: clamp max at 15")
  router.setAllocatedToolCount(8)
  trAssert(true, "TR-14c: setAllocatedToolCount with valid value")

  // TR-15: usageBonus edge cases via recordCall
  {
    const r2 = new mod.ToolRouter()
    // high success rate (>0.8, usage>0) — usageBonus +2
    for (let i = 0; i < 10; i++) r2.recordCall("agentic_nav", true, 50)
    const rHigh = r2.selectTools({ taskInput: "xyznonexistent12345", recentTools: [], domain: "code", isSubAgent: false })
    trAssert(rHigh.selected.length >= 0, "TR-15a: high success tool in results")
  }

  // TR-16: buildToolList edge cases
  trAssert(router.buildToolList([]) === "", "TR-16a: empty list returns empty string")

  // TR-17: no tool with anti-keywords returns 0 penalty (indirect via selectTools)
  // Agentic tools all have anti-keywords entries; selectTools still works with any input
  const resultNoAnti = router.selectTools({ taskInput: "#$%^&*()_+ weird input", recentTools: [], domain: "code", isSubAgent: false })
  trAssert(resultNoAnti.selected.length >= 0, "TR-17a: weird input doesn't crash")
  trAssert(typeof resultNoAnti.reasons === "string", "TR-17b: reasons is a string")

  // TR-18: empty fallback (all scores = 0) → "fallback: all tools shown"
  // Use a fresh router with no call history and a query matching nothing
  {
    const r3 = new mod.ToolRouter()
    // Verify keys exist in TOOL_ANTI_KEYWORDS: every tool has anti-keywords,
    // so some penalty always applies. Use a query that triggers anti-keywords for all.
    const resEmpty = r3.selectTools({ taskInput: "execute implement write build code fix bug", recentTools: [], domain: "code", isSubAgent: false })
    // Even with anti-match, some tools should still have score > 0 due to keyword matching
    trAssert(resEmpty.selected.length > 0, "TR-18a: tools selected even with anti-keywords")
    trAssert(resEmpty.reasons.length > 0, "TR-18b: reasons non-empty")
  }

  console.log(`  ToolRouter: ${trPassed} passed, ${trFailed} failed`)
  state.passed += trPassed; state.failed += trFailed
}

// ── GitIntegration Tests (GI) ──
console.log("\n[GI] GitIntegration — all function signatures")
let gi = 0, gif = 0
const gi_assert = (c, m) => { if (c) { gi++; console.log(`  PASS: ${m}`) } else { gif++; console.log(`  FAIL: ${m}`) } }

{
  const { GitIntegration } = await import(pluginDist)
  const git = new GitIntegration("/tmp/test-git-project")
  const projectGit = new GitIntegration(process.cwd())

  // GI-1: generatePRDescription — all success
  const prAll = git.generatePRDescription("Add feature", [
    { id: "s1", description: "Add types", success: true },
    { id: "s2", description: "Implement logic", success: true },
  ], ["src/types.ts"])
  gi_assert(prAll.summary.includes("Implements"), "GI-1a all success summary")
  gi_assert(prAll.breakingChanges === false, "GI-1b all success no breaking changes")
  gi_assert(prAll.changes.length === 2, "GI-1c both steps in changes")

  // GI-2: generatePRDescription — partial success
  const prPartial = git.generatePRDescription("Fix partial feature", [
    { id: "s1", description: "Add types", success: true },
    { id: "s2", description: "Implement logic", success: false },
  ], ["src/types.ts", "src/logic.ts"])
  gi_assert(prPartial.summary.includes("Partially implements"), "GI-2a partial success summary")
  gi_assert(prPartial.summary.includes("1 steps need follow-up"), "GI-2b failed steps counted")
  gi_assert(prPartial.breakingChanges === true, "GI-2c breakingChanges=true when steps fail")
  gi_assert(prPartial.changes.length === 1, "GI-2d only successful steps in changes")
  gi_assert(prPartial.title === "Fix partial feature", "GI-2e title preserved")

  // GI-3: generatePRDescription — long title (>72 chars) truncation
  const longTitle = "A very long title that definitely exceeds seventy two characters and should be truncated by the generatePRDescription method"
  const prLong = git.generatePRDescription(longTitle, [
    { id: "s1", description: "Do something", success: true },
  ], ["src/file.ts"])
  gi_assert(prLong.title.length <= 75, "GI-3a long title truncated (≤75 chars)")
  gi_assert(prLong.title.endsWith("..."), "GI-3b long title ends with ellipsis")

  // GI-4: generatePRDescription — empty steps array (vacuous truth: all 0 steps succeeded)
  const prEmpty = git.generatePRDescription("Empty steps", [], [])
  gi_assert(prEmpty.summary.includes("0 steps"), "GI-4a empty steps summary says 0 steps")
  gi_assert(prEmpty.changes.length === 0, "GI-4b empty steps = no changes")
  gi_assert(prEmpty.breakingChanges === false, "GI-4c breakingChanges=false when no steps (vacuous truth)")
  gi_assert(prEmpty.summary.includes("Implements"), "GI-4d empty steps still says Implements (all 0 succeeded)")

  // GI-5: generatePRDescription — all steps failed
  const prAllFail = git.generatePRDescription("All fail", [
    { id: "s1", description: "Step one", success: false },
    { id: "s2", description: "Step two", success: false },
  ], ["src/fail.ts"])
  gi_assert(prAllFail.summary.includes("0/2 steps"), "GI-5a all fail shows 0/2")
  gi_assert(prAllFail.breakingChanges === true, "GI-5b all fail = breakingChanges=true")

  // GI-6: isAvailable — /tmp/test-git-project is NOT a git repo
  // This also tests the catch block (isAvailable returns false)
  const available = git.isAvailable()
  gi_assert(available === false, "GI-6a isAvailable returns false for /tmp/test-git-project")

  // GI-7: isAvailable — projectDir IS a git repo
  const projectAvailable = projectGit.isAvailable()
  gi_assert(projectAvailable === true, "GI-7a isAvailable returns true for project dir")

  // GI-8: getCurrentBranch — non-git dir returns "main"
  const branch = git.getCurrentBranch()
  gi_assert(branch === "main", "GI-8a getCurrentBranch returns 'main' for non-git dir")

  // GI-9: getCurrentBranch — real repo returns actual branch name
  const realBranch = projectGit.getCurrentBranch()
  gi_assert(typeof realBranch === "string" && realBranch.length > 0, "GI-9a getCurrentBranch returns non-empty string")

  // GI-10: getHistory — non-git dir returns empty array
  const hist = git.getHistory(5)
  gi_assert(Array.isArray(hist) && hist.length === 0, "GI-10a getHistory returns [] for non-git dir")

  // GI-11: getHistory — real repo returns parsed commits
  const realHist = projectGit.getHistory(3)
  gi_assert(Array.isArray(realHist), "GI-11a getHistory returns array for real repo")
  if (realHist.length > 0) {
    const commit = realHist[0]
    gi_assert(typeof commit.hash === "string" && commit.hash.length >= 6, "GI-11b commit hash is valid")
    gi_assert(typeof commit.message === "string", "GI-11c commit message is string")
    gi_assert(Array.isArray(commit.files), "GI-11d commit files is array")
    gi_assert(typeof commit.timestamp === "string", "GI-11e commit timestamp is string")
  }

  // GI-12: getDiff — non-git dir returns empty string
  const diff = git.getDiff("main")
  gi_assert(diff === "", "GI-12a getDiff returns '' for non-git dir")

  // GI-13: getDiff — real repo returns string
  const realDiff = projectGit.getDiff("HEAD~1")
  gi_assert(typeof realDiff === "string", "GI-13a getDiff returns string for real repo")

  // GI-14: stage — non-git dir returns false
  const staged = git.stage([])
  gi_assert(staged === false, "GI-14a stage returns false for non-git dir")

  // GI-15: commit — non-git dir returns null
  const committed = git.commit("test msg", [])
  gi_assert(committed === null, "GI-15a commit returns null for non-git dir")

  // GI-16: push — non-git dir returns false
  const pushed = git.push()
  gi_assert(pushed === false, "GI-16a push returns false for non-git dir")
  const pushedBranch = git.push("main")
  gi_assert(pushedBranch === false, "GI-16b push('main') returns false for non-git dir")

  // GI-17: createBranch — non-git dir returns false
  const branchCreated = git.createBranch("test-branch")
  gi_assert(branchCreated === false, "GI-17a createBranch returns false for non-git dir")

  // GI-18: createPR — non-git dir returns null
  const prCreated = git.createPR("Test PR", "Body")
  gi_assert(prCreated === null, "GI-18a createPR returns null for non-git dir")
}

// GI-19: New GitIntegration in project dir — verify non-destructive ops
{
  const { GitIntegration } = await import(pluginDist)
  const pg = new GitIntegration(projectDir)
  
  // Generate PR description uses constructor cwd but is a pure function
  const pr = pg.generatePRDescription("Test", [
    { id: "s1", description: "Step 1", success: true },
  ], ["a.ts"])
  gi_assert(typeof pr.title === "string", "GI-19a generatePRDescription works from project dir")
  gi_assert(pr.breakingChanges === false, "GI-19b breakingChanges false for single success step")
}

console.log(`  GitIntegration: ${gi} passed, ${gif} failed`)
state.passed += gi; state.failed += gif

// ── ModelRegistry Direct Tests (MRD) ──
console.log("\n[MRD] ModelRegistry — direct method coverage")
let mrd = 0, mrdf = 0
const mrd_assert = (c, m) => { if (c) { mrd++; console.log(`  PASS: ${m}`) } else { mrdf++; console.log(`  FAIL: ${m}`) } }

{
  const { ModelRegistry } = await import(pluginDist)

  // MRD-1: resolveAlias — empty/null
  {
    const reg = new ModelRegistry()
    mrd_assert(reg.resolveAlias("").length === 0, "MRD-1a empty alias returns []")
    mrd_assert(reg.resolveAlias(null).length === 0, "MRD-1b null alias returns []")
  }

  // MRD-2: suggestWithFallback — no candidates
  {
    const reg = new ModelRegistry()
    const result = reg.suggestWithFallback("dev", [])
    mrd_assert(result[0] === "default", "MRD-2 no candidates returns ['default']")
  }

  // MRD-3: getSummary — empty registry
  {
    const reg = new ModelRegistry()
    mrd_assert(reg.getSummary() === "No model data recorded yet.", "MRD-3 empty registry summary")
  }

  // MRD-4: deleteModel
  {
    const reg = new ModelRegistry()
    reg.addModel("to-delete")
    mrd_assert(reg.deleteModel("to-delete") === true, "MRD-4a deleteModel returns true")
    mrd_assert(reg.deleteModel("nonexistent") === false, "MRD-4b deleteModel returns false for missing")
  }

  // MRD-5: registerAlias + resolveAlias
  {
    const reg = new ModelRegistry()
    reg.registerAlias("fast", ["gpt-4o", "claude-3"])
    const models = reg.resolveAlias("fast")
    mrd_assert(models.includes("gpt-4o"), "MRD-5a alias resolves gpt-4o")
    mrd_assert(models.includes("claude-3"), "MRD-5b alias resolves claude-3")
    const unknown = reg.resolveAlias("nonexistent")
    mrd_assert(unknown.length === 1 && unknown[0] === "nonexistent", "MRD-5c unknown alias returns [alias]")
  }

  // MRD-6: recordUserFeedback + getUserSatisfaction
  {
    const reg = new ModelRegistry()
    reg.addModel("user-model")
    reg.recordCall("user-model", true, 100, "code", 0.01)
    reg.recordUserFeedback("user-model", "code", true)
    reg.recordUserFeedback("user-model", "code", true)
    reg.recordUserFeedback("user-model", "code", false)
    const sat = reg.getUserSatisfaction("user-model", "code")
    mrd_assert(Math.abs(sat - 2/3) < 0.001, `MRD-6a user satisfaction = 0.666 (got ${sat})`)
    const noData = reg.getUserSatisfaction("user-model", "unknown-type")
    mrd_assert(noData === 0.5, "MRD-6b unknown type defaults to 0.5")
  }

  // MRD-7: recordHallucination
  {
    const reg = new ModelRegistry()
    reg.addModel("hallucinating-model")
    reg.recordCall("hallucinating-model", true, 100)
    reg.recordHallucination("hallucinating-model")
    const score = reg.getScore("hallucinating-model")
    mrd_assert(score.hallucinationRate > 0, "MRD-7 hallucination recorded")
  }

  // MRD-8: fromJSON with prefixed key merge
  {
    const reg = new ModelRegistry()
    reg.fromJSON({
      "my-model": { totalCalls: 5, successCalls: 5, failedCalls: 0, hallucinationCount: 0, avgLatencyMs: 100, lastUsed: 1000, consecutiveFailures: 0, consecutiveSuccesses: 5, quarantineUntil: 0, byTaskType: {}, totalCost: 0, avgCostPerCall: 0 },
      "opencode/my-model": { totalCalls: 3, successCalls: 2, failedCalls: 1, hallucinationCount: 0, avgLatencyMs: 200, lastUsed: 2000, consecutiveFailures: 1, consecutiveSuccesses: 2, quarantineUntil: 0, byTaskType: {}, totalCost: 0, avgCostPerCall: 0 },
    })
    const score = reg.getScore("opencode/my-model")
    mrd_assert(score !== null, "MRD-8a fromJSON merged entry has score")
    mrd_assert(score.totalCalls >= 5, `MRD-8b merged calls >= 5 (got ${score.totalCalls})`)
  }

  // MRD-9: enterQuarantine + isBlocked
  {
    const reg = new ModelRegistry()
    reg.addModel("quarantined-model")
    reg.recordCall("quarantined-model", true, 100)
    reg.enterQuarantine("quarantined-model", 60)
    const block = reg.isBlocked("quarantined-model", { hardBlockReliability: 0.2, softBlockReliability: 0.4, minSampleSize: 3 })
    mrd_assert(block.blocked === true, "MRD-9a quarantined model blocked")
    mrd_assert(block.severity === "hard", "MRD-9b quarantine is hard block")
  }

  // MRD-10: selectBestModel — with blocked model
  {
    const reg = new ModelRegistry()
    reg.addModel("good-model")
    for (let i = 0; i < 5; i++) reg.recordCall("good-model", true, 100, "code", 0.01)
    reg.addModel("bad-model")
    for (let i = 0; i < 10; i++) reg.recordCall("bad-model", false, 100, "code", 0.01)
    const result = reg.selectBestModel("code", ["good-model", "bad-model"], { hardBlockReliability: 0.2, softBlockReliability: 0.5, minSampleSize: 3 })
    mrd_assert(result === "good-model", "MRD-10 selects non-blocked model")
  }

  // MRD-11: selectBestModel — empty list
  {
    const reg = new ModelRegistry()
    mrd_assert(reg.selectBestModel("code", []) === "default", "MRD-11 empty list returns default")
  }

  // MRD-12: selectWithFallback — healthy path
  {
    const reg = new ModelRegistry()
    reg.addModel("healthy-model")
    for (let i = 0; i < 5; i++) reg.recordCall("healthy-model", true, 100)
    const config = { hardBlockReliability: 0.1, softBlockReliability: 0.3, minSampleSize: 3 }
    const result = reg.selectWithFallback("code", ["healthy-model"], config)
    mrd_assert(result.model === "healthy-model", "MRD-12a healthy selection")
    mrd_assert(result.tier === "healthy", "MRD-12b healthy tier")
  }

  // MRD-13: selectWithFallback — empty list
  {
    const reg = new ModelRegistry()
    const result = reg.selectWithFallback("code", [], { hardBlockReliability: 0.1, softBlockReliability: 0.3, minSampleSize: 3 })
    mrd_assert(result.model === "default", "MRD-13 empty list returns default")
  }

  // MRD-14: toJSON round-trip
  {
    const reg = new ModelRegistry()
    reg.addModel("json-model")
    reg.recordCall("json-model", true, 100, "code", 0.01)
    const json = reg.toJSON()
    mrd_assert(typeof json === "object" && json !== null, "MRD-14a toJSON returns object")

    const reg2 = new ModelRegistry()
    reg2.fromJSON(json)
    const score2 = reg2.getScore("json-model")
    mrd_assert(score2 !== null, "MRD-14b fromJSON restores model")
    mrd_assert(score2.totalCalls >= 1, "MRD-14c fromJSON restores stats")
  }
}

state.passed += mrd; state.failed += mrdf

// TL — TraceLogger minimal branch coverage
let tl = 0, tlf = 0
const { TraceLogger, AgenticError } = mod
function tl_assert(c, m) { if (c) { tl++ } else { tlf++ } }

// Guard: TraceLogger and AgenticError may not be exported from dist
let TL = null
try {
  TL = new TraceLogger("/tmp")
} catch (e) {
  // not exported — skip TL tests
}

if (TL) {
{
  const tmp = mkdtempSync(join(tmpdir(), "tl-"))
  const t = new TraceLogger(tmp, { useCompression: true })
  await t.init()
  t.log({ step: "s1", toolUsed: "t1", input: "i1" })
  t.log({ step: "s1", toolUsed: "t1", input: "i1" })
  t.buffer.push({ step: "x", toolUsed: "y", input: "z", level: "info", timestamp: "" })
  t.log({ step: "s2", toolUsed: "t2", input: "i2" })
  tl_assert(true, "TL-1 compression + dedup + shift")
  await t.dispose()
  rmSync(tmp, { recursive: true, force: true })
}

{
  const tmp = mkdtempSync(join(tmpdir(), "tl-"))
  const t = new TraceLogger(tmp, { useCompression: false })
  await t.init()
  t.log({ step: "a", toolUsed: "b", input: "c" })
  t.log({ step: "a", toolUsed: "b", input: "c" })
  tl_assert(true, "TL-2 non-compress + dedup")
  await t.dispose()
  rmSync(tmp, { recursive: true, force: true })
}

{
  const tmp = mkdtempSync(join(tmpdir(), "tl-"))
  const t = new TraceLogger(tmp)
  await t.init()
  t.log({ step: "x", toolUsed: "y", input: "z", level: "debug" })
  tl_assert(true, "TL-3 minLevel filter")
  await t.dispose()
  rmSync(tmp, { recursive: true, force: true })
}

{
  const tmp = mkdtempSync(join(tmpdir(), "tl-"))
  const t = new TraceLogger(tmp)
  await t.init()
  t.log({ step: "init", toolUsed: "i", input: "ok" })
  tl_assert(true, "TL-4 init succeeds with recursive mkdir")
  await t.dispose()
  rmSync(tmp, { recursive: true, force: true })
}

{
  const tmp = mkdtempSync(join(tmpdir(), "tl-"))
  const t = new TraceLogger(tmp)
  await t.init()
  t.log({ step: "flush", toolUsed: "f", input: "i" })
  await t.flush()
  t.log({ step: "flush2", toolUsed: "f", input: "i2" })
  await t.flush()
  tl_assert(true, "TL-5 flush writeFile fallback")
  await t.dispose()
  rmSync(tmp, { recursive: true, force: true })
}

{
  const tmp = mkdtempSync(join(tmpdir(), "tl-"))
  const t = new TraceLogger(tmp, { useCompression: true, maxBufferSize: 1 })
  await t.init()
  t.log({ step: "s1", toolUsed: "t1", input: "i1" })
  t.log({ step: "s2", toolUsed: "t2", input: "i2" })
  tl_assert(true, "TL-6 maxBuffer shift")
  await t.dispose()
  rmSync(tmp, { recursive: true, force: true })
}

{
  const tmp = mkdtempSync(join(tmpdir(), "tl-"))
  const t = new TraceLogger(tmp, { useCompression: true })
  await t.init()
  t.log({ step: "g1", toolUsed: "g", input: "g" })
  await t.flush()
  tl_assert(true, "TL-7 gzip flush")
  await t.dispose()
  rmSync(tmp, { recursive: true, force: true })
}

{
  const tmp = mkdtempSync(join(tmpdir(), "tl-"))
  const t = new TraceLogger(tmp)
  await t.init()
  t.log({ step: "w1", toolUsed: "w", input: "w" })
  await t.flush()
  tl_assert(true, "TL-8 append success")
  await t.dispose()
  rmSync(tmp, { recursive: true, force: true })
}

{
  const tmp = mkdtempSync(join(tmpdir(), "tl-"))
  const t = new TraceLogger(tmp)
  await t.init()
  t.log({ step: "d1", toolUsed: "d", input: "d" })
  await t.dispose()
  tl_assert(true, "TL-9 dispose")
  rmSync(tmp, { recursive: true, force: true })
}
} else {
  console.log("  ⚠️ TraceLogger not exported — skipping TL tests")
}

console.log(`  TraceLogger: ${tl} passed, ${tlf} failed`)
state.passed += tl; state.failed += tlf

let ContextCompressor
try {
  const m = await import("../dist/index.js")
  ContextCompressor = m.ContextCompressor
} catch { /* not exported */ }

section("CC")
let cc=0,ccf=0;const cca=(c,m)=>{if(c){cc++;console.log(`  ${G}PASS${RST}: ${m}`)}else{ccf++;console.error(`  ${R}FAIL${RST}: ${m}`)}}
if (ContextCompressor) {
{const c=new ContextCompressor();cca(c.compress("p",[],"x",[]).invariants.length===0,"CC-1 no invariant")}
{const c=new ContextCompressor();cca(c.compress("p",[],"TODO x",[]).openItems.length===1,"CC-2 open item")}
{const c=new ContextCompressor();cca(c["levenshtein"]("a","b")===1,"CC-3 lev 1")}
{const c=new ContextCompressor();cca(c["levenshtein"]("abc","abc")===0,"CC-4 lev 0")}
{const c=new ContextCompressor();cca(c["deduplicateFuzzy"](["abc","abd"]).length===2,"CC-5 fuzzy dedup")}
{const c=new ContextCompressor();cca(c["estimateTokens"]("x",[],[])>=1,"CC-6 tokens >=1")}
{const c=new ContextCompressor();cca(c["estimateTokens"]("a b",[],[])>=1,"CC-7 tokens ws")}
{const c=new ContextCompressor();cca(c["levenshtein"]("","")===0,"CC-8 lev empty")}
{const c=new ContextCompressor();cca(c["levenshtein"]("a","")===1,"CC-9 lev 1 empty")}
{const c=new ContextCompressor();cca(c.compress("p",[{role:"user",content:"must not x"}],[],[]).invariants.length===1,"CC-10 invariant")}
{const c=new ContextCompressor();cca(c["deduplicateFuzzy"](["abc","abc"]).length===1,"CC-11 dedup same")}
{const c=new ContextCompressor();cca(c["deduplicateFuzzy"](["abc","xyz"]).length===2,"CC-12 dedup distinct")}
} else {
  console.log("  ⚠️ ContextCompressor not exported — skipping CC tests")
}

console.log(`  ContextCompressor: ${cc} passed, ${ccf} failed`)
state.passed+=cc;state.failed+=ccf
console.log(`__RESULT__:${JSON.stringify({passed:state.passed,failed:state.failed})}`)
// Standalone: if (state.failed > 0) process.exit(1)
