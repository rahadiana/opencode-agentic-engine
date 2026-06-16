#!/usr/bin/env node
/**
 * Demo Script: Self-Evolution Feature Testing
 * 
 * Script ini mendemonstrasikan cara kerja self-evolution secara praktis.
 * Jalankan dengan: node demo-self-evolution.mjs
 */

import { readFileSync, existsSync, mkdirSync } from "fs"

console.log("🔮 Self-Evolution Demo\n")
console.log("=" .repeat(60))

// Load plugin
const pluginPath = "./dist/index.js"
if (!existsSync(pluginPath)) {
  console.error("❌ Plugin not built. Run: npm run build")
  process.exit(1)
}

console.log("✅ Loading plugin from", pluginPath)
const mod = await import(pluginPath)

// Mock OpenCode context
const mockContext = {
  client: {
    config: {
      providers: async () => ({
        200: {
          providers: [
            {
              id: "openai",
              name: "OpenAI",
              models: {
                "gpt-4o": {},
                "gpt-4o-mini": {}
              }
            }
          ],
          default: { openai: "openai/gpt-4o" }
        }
      })
    }
  },
  project: { name: "demo", path: "/tmp/demo-self-evolution" },
  directory: "/tmp/demo-self-evolution",
  worktree: "/tmp/demo-self-evolution",
  experimental_workspace: { register: () => {} },
  serverUrl: new URL("http://localhost:3000"),
  $: new Proxy({}, { 
    get: () => async () => ({
      exitCode: 0,
      text: () => "",
      stdout: Buffer.from(""),
      stderr: Buffer.from("")
    })
  }),
}

// Ensure demo directory exists
mkdirSync(mockContext.worktree, { recursive: true })

console.log("✅ Initializing plugin...")
const hooks = await mod.default.server(mockContext)

const toolCtx = {
  sessionID: "demo-session-001",
  messageID: "m1",
  agent: "demo",
  directory: mockContext.directory,
  worktree: mockContext.worktree,
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
}

console.log("\n" + "=".repeat(60))
console.log("📋 DEMO 1: Inspect System State")
console.log("=".repeat(60))

const inspectResult = await hooks.tool.agentic_evolve.execute({
  action: "inspect"
}, toolCtx)

console.log(inspectResult.output)

console.log("\n" + "=".repeat(60))
console.log("📋 DEMO 2: Create Sample Tasks")
console.log("=".repeat(60))

// Create a plan
console.log("→ Creating plan with 3 steps...")
await hooks.tool.agentic_plan.execute({
  goal: "Demo self-evolution with sample tasks",
  subtasks: [
    { id: "demo-1", description: "Initialize project structure", dependsOn: [] },
    { id: "demo-2", description: "Implement core logic", dependsOn: ["demo-1"] },
    { id: "demo-3", description: "Add tests", dependsOn: ["demo-2"] }
  ]
}, toolCtx)

console.log("✅ Plan created")

// Execute steps (mix of success and failures for evolution data)
console.log("\n→ Executing step 1 (success)...")
await hooks.tool.agentic_execute.execute({
  stepId: "demo-1",
  success: true,
  output: "Created project structure: src/, test/, config/",
  filesModified: ["src/index.ts", "src/utils.ts"]
}, toolCtx)
console.log("✅ Step 1 completed")

console.log("\n→ Executing step 2 (success)...")
await hooks.tool.agentic_execute.execute({
  stepId: "demo-2",
  success: true,
  output: "Implemented core business logic with proper error handling",
  filesModified: ["src/core.ts", "src/handlers.ts"]
}, toolCtx)
console.log("✅ Step 2 completed")

console.log("\n→ Executing step 3 (simulated failure)...")
await hooks.tool.agentic_execute.execute({
  stepId: "demo-3",
  success: false,
  output: "Failed to create tests",
  error: "ImportError: test framework not installed"
}, toolCtx)
console.log("⚠️  Step 3 failed (for demo purposes)")

console.log("\n" + "=".repeat(60))
console.log("📋 DEMO 3: Extract Skill from Successful Step")
console.log("=".repeat(60))

console.log("→ Extracting skill from demo-2...")
const skillExtractResult = await hooks.tool.agentic_skill.execute({
  action: "extract",
  query: "demo-2"
}, toolCtx)

console.log(skillExtractResult.output)

console.log("\n" + "=".repeat(60))
console.log("📋 DEMO 4: List All Skills")
console.log("=".repeat(60))

const skillListResult = await hooks.tool.agentic_skill.execute({
  action: "list"
}, toolCtx)

console.log(skillListResult.output)

console.log("\n" + "=".repeat(60))
console.log("📋 DEMO 5: Run Self-Evolution Analysis")
console.log("=".repeat(60))

console.log("→ Running evolution analysis...")
const evolveResult = await hooks.tool.agentic_evolve.execute({
  action: "evolve"
}, toolCtx)

console.log(evolveResult.output)

console.log("\n" + "=".repeat(60))
console.log("📋 DEMO 6: Check Status & Metrics")
console.log("=".repeat(60))

const statusResult = await hooks.tool.agentic_status.execute({}, toolCtx)
console.log(statusResult.output)

console.log("\n" + "=".repeat(60))
console.log("📋 DEMO 7: Export Skills to Training Data")
console.log("=".repeat(60))

console.log("→ Exporting skills to OpenAI JSONL format...")
const exportResult = await hooks.tool.agentic_evolve.execute({
  action: "export-training-data",
  format: "openai",
  minSuccessRate: 0.5
}, toolCtx)

console.log(exportResult.output)

console.log("\n" + "=".repeat(60))
console.log("📋 DEMO 8: Memory Schema Info")
console.log("=".repeat(60))

const schemaResult = await hooks.tool.agentic_evolve.execute({
  action: "memory-schema"
}, toolCtx)

console.log(schemaResult.output)

console.log("\n" + "=".repeat(60))
console.log("✅ DEMO COMPLETED")
console.log("=".repeat(60))

console.log("\n📝 Summary:")
console.log("1. ✅ System inspection - checked registered components")
console.log("2. ✅ Task execution - simulated 3 steps (2 success, 1 failure)")
console.log("3. ✅ Skill extraction - extracted from successful step")
console.log("4. ✅ Skill listing - showed all available skills")
console.log("5. ✅ Evolution analysis - computed metrics and suggestions")
console.log("6. ✅ Status dashboard - displayed current state")
console.log("7. ✅ Training export - generated fine-tuning data")
console.log("8. ✅ Schema info - showed memory schema version")

console.log("\n💡 Next Steps:")
console.log("- Check .agentic/ directory for persisted data")
console.log("- Run 'npm test' to see full test suite")
console.log("- Use @agentic_evolve in OpenCode for live testing")

// Cleanup
await hooks.dispose()
console.log("\n🧹 Cleanup complete")
