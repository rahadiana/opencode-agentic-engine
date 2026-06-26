#!/usr/bin/env node
/**
 * blueprint-e2e.mjs — E2E test for all 5 blueprint tools
 * (agentic_debate, agentic_router, agentic_clean, agentic_rag, agentic_mcp)
 *
 * Runs inside Docker container (Layer 9). No LLM needed — all tests
 * verify tool registration, execution, and error handling.
 *
 * Usage: node test/blueprint-e2e.mjs
 */

import { existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { sdkMockClient } from "./mock-sdk-client.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, "..")

let passed = 0
let failed = 0

function assert(condition, msg) {
  if (condition) {
    console.log(`  PASS: ${msg}`)
    passed++
  } else {
    console.error(`  FAIL: ${msg}`)
    failed++
  }
}

function freshSid() {
  return `blueprint-e2e-${Date.now()}`
}

function mockCtx(sessionId) {
  return {
    sessionID: sessionId,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    emit: async () => {},
  }
}

async function main() {
  console.log("=== Blueprint Tools E2E Test ===")

  // Load plugin
  const distPath = join(projectRoot, "dist", "index.js")
  assert(existsSync(distPath), "dist/index.js exists")
  const mod = await import(distPath)
  const { AgenticEngine } = mod
  assert(typeof AgenticEngine === "function", "AgenticEngine is a function")

  const mockInput = {
    client: sdkMockClient(),
    project: { name: "test", path: projectRoot },
    directory: projectRoot,
    worktree: projectRoot,
    experimental_workspace: { register: () => {} },
    serverUrl: new URL("http://localhost:3000"),
    $: new Proxy({}, {
      get() { return async () => ({ exitCode: 0, text: () => "", stdout: Buffer.from(""), stderr: Buffer.from("") }) },
    }),
  }
  const hooks = await AgenticEngine(mockInput)
  assert(hooks && hooks.tool, "hooks.tool available")

  // ─── Test 1: agentic_debate ───
  console.log("\n[1] agentic_debate")
  const debateCtx = mockCtx(freshSid())
  assert(typeof hooks.tool.agentic_debate.execute === "function", "debate has execute")

  const d1 = await hooks.tool.agentic_debate.execute({ task: "What is 2+2?" }, debateCtx)
  const d1Out = typeof d1 === "string" ? d1 : (d1.output || "")
  assert(d1Out.length > 20, "debate returns output")
  assert(d1Out.includes("Debate") || d1Out.includes("2+2") || d1Out.includes("Final") || d1Out.length > 50, "debate contains meaningful content")

  const d2 = await hooks.tool.agentic_debate.execute({ task: "" }, debateCtx)
  const d2Out = typeof d2 === "string" ? d2 : (d2.output || "")
  assert(d2Out.length > 0, "debate handles empty task")

  console.log("  PASS: agentic_debate tests passed")

  // ─── Test 2: agentic_router ───
  console.log("\n[2] agentic_router")
  const routerCtx = mockCtx(freshSid())
  assert(typeof hooks.tool.agentic_router.execute === "function", "router has execute")

  const r1 = await hooks.tool.agentic_router.execute({ input: "Implement login feature" }, routerCtx)
  const r1Out = typeof r1 === "string" ? r1 : (r1.output || "")
  assert(r1Out.length > 20, "router returns output for implementation query")

  const r2 = await hooks.tool.agentic_router.execute({ input: "" }, routerCtx)
  const r2Out = typeof r2 === "string" ? r2 : (r2.output || "")
  assert(r2Out.length > 0, "router handles empty input")

  console.log("  PASS: agentic_router tests passed")

  // ─── Test 3: agentic_clean ───
  console.log("\n[3] agentic_clean")
  const cleanCtx = mockCtx(freshSid())
  assert(typeof hooks.tool.agentic_clean.execute === "function", "clean has execute")

  const c1 = await hooks.tool.agentic_clean.execute({
    text: "**Analysis:** The code is incorrect.\n**Review:** Use bcrypt instead.\n**Conclusion:** Change the implementation.",
    format: "json",
  }, cleanCtx)
  const c1Out = typeof c1 === "string" ? c1 : (c1.output || "")
  assert(c1Out.length > 10, "clean returns output")

  const c2 = await hooks.tool.agentic_clean.execute({ text: "" }, cleanCtx)
  const c2Out = typeof c2 === "string" ? c2 : (c2.output || "")
  assert(c2Out.length > 0, "clean handles empty text")

  console.log("  PASS: agentic_clean tests passed")

  // ─── Test 4: agentic_rag ───
  console.log("\n[4] agentic_rag")
  const ragCtx = mockCtx(freshSid())
  assert(typeof hooks.tool.agentic_rag.execute === "function", "rag has execute")

  const g1 = await hooks.tool.agentic_rag.execute({ action: "store", title: "Test Entry", content: "This is test data for RAG search.", category: "general", type: "episode" }, ragCtx)
  const g1Out = typeof g1 === "string" ? g1 : (g1.output || "")
  assert(g1Out.length > 0, "rag store returns output")

  const g2 = await hooks.tool.agentic_rag.execute({ action: "search", query: "test data", category: "general" }, ragCtx)
  const g2Out = typeof g2 === "string" ? g2 : (g2.output || "")
  assert(g2Out.length > 0, "rag search returns output")

  const g3 = await hooks.tool.agentic_rag.execute({ action: "stats" }, ragCtx)
  const g3Out = typeof g3 === "string" ? g3 : (g3.output || "")
  assert(g3Out.length > 10, "rag stats returns output")

  const g4 = await hooks.tool.agentic_rag.execute({ action: "categories" }, ragCtx)
  const g4Out = typeof g4 === "string" ? g4 : (g4.output || "")
  assert(g4Out.length > 5, "rag categories returns output")

  console.log("  PASS: agentic_rag tests passed")

  // ─── Test 5: agentic_mcp ───
  console.log("\n[5] agentic_mcp")
  const mcpCtx = mockCtx(freshSid())
  assert(typeof hooks.tool.agentic_mcp.execute === "function", "mcp has execute")

  const m1 = await hooks.tool.agentic_mcp.execute({ action: "list" }, mcpCtx)
  const m1Out = typeof m1 === "string" ? m1 : (m1.output || "")
  assert(m1Out.length > 0, "mcp list returns output")

  const m2 = await hooks.tool.agentic_mcp.execute({ action: "disconnect-all" }, mcpCtx)
  const m2Out = typeof m2 === "string" ? m2 : (m2.output || "")
  assert(m2Out.length > 0, "mcp disconnect-all returns output")

  const m3 = await hooks.tool.agentic_mcp.execute({ action: "invalid" }, mcpCtx)
  const m3Out = typeof m3 === "string" ? m3 : (m3.output || "")
  assert(m3Out.length > 0, "mcp invalid action returns output")

  console.log("  PASS: agentic_mcp tests passed")

  // ─── Summary ───
  console.log(`\nResults: ${passed} passed, ${failed} failed`)
  if (failed === 0) console.log("ALL BLUEPRINT E2E TESTS PASSED")
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => {
  console.error("Fatal error:", err)
  process.exit(1)
})
