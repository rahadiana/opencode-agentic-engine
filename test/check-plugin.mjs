#!/usr/bin/env node
/**
 * check-plugin.mjs — Diagnostic Tool untuk Plugin Agentic Engine
 *
 * Cek apakah plugin ter-install, tools ter-register, dan system prompt
 * injection berfungsi di project folder mana pun.
 *
 * Usage:
 *   node test/check-plugin.mjs              # cek di project ini
 *   node test/check-plugin.mjs /path/to/project   # cek di folder lain
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { sdkMockClient } from "./mock-sdk-client.mjs"

const __dirname = fileURLToPath(new URL(".", import.meta.url))
const pluginDist = resolve(__dirname, "..", "dist", "index.js")
const targetDir = process.argv[2] ? resolve(process.argv[2]) : process.cwd()

let passed = 0
let failed = 0
let warnings = 0

function ok(msg) { console.log(`  ✅ ${msg}`); passed++ }
function fail(msg) { console.log(`  ❌ ${msg}`); failed++ }
function warn(msg) { console.log(`  ⚠️  ${msg}`); warnings++ }

async function main() {
  console.log("=".repeat(60))
  console.log("  AGENTIC ENGINE — PLUGIN DIAGNOSTIC")
  console.log("=".repeat(60))
  console.log()
  console.log(`  Target project : ${targetDir}`)
  console.log(`  Plugin dist    : ${pluginDist}`)
  console.log()

  // ── 1. Cek plugin build ──
  console.log("[1] Plugin Build")
  if (existsSync(pluginDist)) {
    const size = (readFileSync(pluginDist).length / 1024).toFixed(0)
    ok(`dist/index.js exists (${size} KB)`)
  } else {
    fail("dist/index.js not found — run 'npm run build' first")
    console.log("\n❌ Cannot continue without plugin build.")
    process.exit(1)
  }

  // ── 2. Cek plugin installation di target project ──
  console.log("\n[2] Plugin Installation")
  const pluginDir = join(targetDir, ".opencode", "plugins", "agentic-engine")
  const pluginIndex = join(pluginDir, "index.js")
  if (existsSync(pluginIndex)) {
    ok(`Plugin installed at ${pluginIndex}`)
  } else {
    warn(`Plugin NOT installed at ${pluginIndex}`)
    warn("Install: mkdir -p .opencode/plugins/agentic-engine && cp dist/index.js .opencode/plugins/agentic-engine/")
  }

  // ── 3. Cek .agentic/config.json ──
  console.log("\n[3] Plugin Config")
  const configPath = join(targetDir, ".agentic", "config.json")
  if (existsSync(configPath)) {
    try {
      const cfg = JSON.parse(readFileSync(configPath, "utf-8"))
      ok(`Config exists at .agentic/config.json`)
      if (cfg.$schema) ok(`  Schema: ${cfg.$schema}`)
      if (cfg.memory) ok(`  Memory: ${cfg.memory.enabled ? "enabled" : "disabled"} (${cfg.memory.mode})`)
      if (cfg.agent) ok(`  Agent: maxDepth=${cfg.agent.maxDelegationDepth}, hallucinationCheck=${cfg.agent.autoHallucinationCheck}`)
    } catch {
      fail("Config file invalid JSON")
    }
  } else {
    warn("No .agentic/config.json — will be auto-created on first plugin load")
  }

  // ── 4. Cek models.json ──
  const modelsPath = join(targetDir, ".agentic", "models.json")
  if (existsSync(modelsPath)) {
    try {
      const models = JSON.parse(readFileSync(modelsPath, "utf-8"))
      ok(`Models config exists at .agentic/models.json`)
      const roles = Object.keys(models).filter(k => !["tools", "categories", "$schema", "description"].includes(k))
      if (roles.length > 0) ok(`  ${roles.length} role model preferences configured`)
    } catch {
      warn("Models file exists but invalid JSON")
    }
  } else {
    warn("No .agentic/models.json — using default model preferences")
  }

  // ── 5. Load plugin & test tools ──
  console.log("\n[4] Plugin Load & Tool Registration")
  try {
    const mod = await import(pluginDist + "?t=" + Date.now())
    if (typeof mod.AgenticEngine === "function") {
      ok("AgenticEngine exported as function")
    } else {
      fail("AgenticEngine not exported")
      process.exit(1)
    }

    const hooks = await mod.AgenticEngine({
      client: sdkMockClient(),
      project: { name: "diagnostic", path: targetDir },
      directory: targetDir,
      worktree: targetDir,
      experimental_workspace: { register: () => {} },
      serverUrl: new URL("http://localhost:3000"),
      $: new Proxy({}, {
        get() { return async () => ({ exitCode: 0, text: () => "", stdout: Buffer.from(""), stderr: Buffer.from("") }) },
      }),
    })

    const toolNames = Object.keys(hooks.tool || {})
    const agenticTools = toolNames.filter(t => t.startsWith("agentic_"))
    ok(`Plugin initialized (${agenticTools.length} agentic tools registered)`)

    // Check all 29 tools
    const expectedTools = [
      "agentic_plan", "agentic_execute", "agentic_reflect", "agentic_verify",
      "agentic_status", "agentic_nav", "agentic_context", "agentic_snapshot",
      "agentic_pr", "agentic_score", "agentic_model", "agentic_model_reset",
      "agentic_budget", "agentic_delegate", "agentic_pipeline", "agentic_message",
      "agentic_parallel", "agentic_skill", "agentic_episodes", "agentic_dashboard",
      "agentic_guard", "agentic_evolve", "agentic_auto", "agentic_debate",
      "agentic_router", "agentic_clean", "agentic_rag", "agentic_mcp",
      "agentic_finetune",
    ]
    const missing = expectedTools.filter(t => !toolNames.includes(t))
    if (missing.length === 0) {
      ok("All 29 tools registered correctly")
    } else {
      fail(`Missing tools: ${missing.join(", ")}`)
    }

    // ── 6. Test system prompt injection ──
    console.log("\n[5] System Prompt Injection")
    const out = { system: ["You are an AI assistant."] }
    await hooks["experimental.chat.system.transform"](
      { sessionID: "diagnostic-test", model: "gpt-4o" },
      out
    )
    const promptText = out.system.join("\n")

    // Check tool visibility
    const availableMatch = promptText.match(/### Available Tools \((\d+)\)/)
    if (availableMatch) {
      const count = parseInt(availableMatch[1])
      ok(`Available Tools section present (${count} tools)`)
      if (count >= 29) ok("  All 29+ tools listed")
      else warn(`  Only ${count} tools listed (expected >= 29)`)
    } else {
      fail("Available Tools section MISSING from system prompt")
    }

    // Check key sections
    const checks = [
      ["identity", "reasoning engine"],
      ["workflow", "Research → Plan → Implement → Verify"],
      ["guardrails", "Research FIRST"],
      ["tool mentions", "agentic_plan"],
    ]
    let allSectionsFound = true
    for (const [label, keyword] of checks) {
      if (promptText.includes(keyword)) ok(`  Section: ${label}`)
      else { warn(`  Section MISSING: ${label}`); allSectionsFound = false }
    }

    // Selected tools section
    if (promptText.includes("Selected Tools for This Task")) {
      ok("Selected Tools (routed subset) section present")
    } else {
      warn("No Selected Tools section — all 29 tools shown without routing")
    }

    // ── 7. Test tool execution ──
    console.log("\n[6] Tool Execution (Quick Test)")
    const testCtx = {
      sessionID: "diag-exec", messageID: "m-1", agent: "test",
      directory: targetDir, worktree: targetDir,
      abort: new AbortController().signal, metadata: () => {}, ask: async () => {},
    }

    // Test plan
    try {
      const planR = await hooks.tool.agentic_plan.execute({
        goal: "Diagnostic test task",
        subtasks: [{ id: "d1", description: "Check plugin works", dependsOn: [] }],
      }, testCtx)
      if (planR.output && planR.output.length > 20) ok("agentic_plan — creates plan")
      else fail("agentic_plan — no output")
    } catch (e) {
      fail(`agentic_plan — error: ${e.message}`)
    }

    // Test nav
    try {
      const navR = await hooks.tool.agentic_nav.execute({ query: "plugin diagnostic" }, testCtx)
      if (navR.output && navR.output.length > 0) ok("agentic_nav — scans files")
      else fail("agentic_nav — no output")
    } catch (e) {
      fail(`agentic_nav — error: ${e.message}`)
    }

    // Test status
    try {
      const statR = await hooks.tool.agentic_status.execute({}, testCtx)
      if (statR.output && statR.output.length > 20) ok("agentic_status — dashboard works")
      else fail("agentic_status — no output")
    } catch (e) {
      fail(`agentic_status — error: ${e.message}`)
    }

    // Test model
    try {
      const modelR = await hooks.tool.agentic_model.execute({ action: "list" }, testCtx)
      if (modelR.output) ok("agentic_model — lists preferences")
      else fail("agentic_model — no output")
    } catch (e) {
      fail(`agentic_model — error: ${e.message}`)
    }

    await hooks.dispose()
  } catch (e) {
    fail(`Plugin load/test error: ${e.message}`)
    console.error(e.stack)
  }

  // ── Summary ──
  console.log()
  console.log("=".repeat(60))
  console.log("  DIAGNOSTIC RESULTS")
  console.log("=".repeat(60))
  console.log(`  ✅ Passed  : ${passed}`)
  console.log(`  ⚠️  Warnings: ${warnings}`)
  console.log(`  ❌ Failed  : ${failed}`)
  console.log()

  if (failed > 0) {
    console.log("  ❌ Beberapa cek gagal. Perbaiki issue di atas.")
    console.log()
    console.log("  Troubleshooting:")
    console.log("  1. Plugin tidak ter-install:")
    console.log("     mkdir -p .opencode/plugins/agentic-engine")
    console.log("     cp node_modules/opencode-agentic-engine/dist/index.js .opencode/plugins/agentic-engine/")
    console.log("  2. Plugin build tidak ada:")
    console.log("     npm run build")
    console.log("  3. Tools tidak muncul di chat:")
    console.log("     Cek console log (jalankan OpenCode dari terminal)")
    console.log("     Cari error '[Agentic]' di output")
    process.exit(1)
  }

  if (warnings > 0) {
    console.log("  ⚠️  Ada warning — plugin tetap berfungsi, tapi setup belum optimal.")
    process.exit(0)
  }

  console.log("  ✅ Semua cek lolos — plugin berfungsi penuh!")
  process.exit(0)
}

main().catch(e => {
  console.error("FATAL:", e.message)
  process.exit(1)
})
