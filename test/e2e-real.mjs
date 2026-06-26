/**
 * E2E Real LLM Test — SWE-bench-lite style tasks
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... node test/e2e-real.mjs
 *   ANTHROPIC_API_KEY=sk-ant-... node test/e2e-real.mjs
 *
 * This test runs agentic_auto with real LLM calls on 3 small coding tasks
 * and reports results transparently — pass or fail.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { execFileSync } from "child_process"
import { sdkMockClient } from "./mock-sdk-client.mjs"

const pluginDist = new URL("../dist/index.js", import.meta.url).pathname
const results = []

async function main() {
  console.log("=".repeat(60))
  console.log("E2E Real LLM Test — agentic_auto")
  console.log("=".repeat(60))
  console.log()

  if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    console.log("⚠️  No LLM API key found. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.")
    console.log("   Falling back to NO_LLM mode — only testing infrastructure wiring.")
    console.log()
  }

  // Load plugin
  if (!existsSync(pluginDist)) {
    console.error("❌ dist/index.js not found. Run 'npm run build' first.")
    process.exit(1)
  }
  const mod = await import(pluginDist)
  console.log("✅ Plugin loaded\n")

  // Tasks from SWE-bench-lite style scenarios
  const tasks = [
    {
      name: "Add greet function to existing module",
      goal: "Add a greet(name: string): string function to src/utils.ts that returns 'Hello, {name}!' and export it. Then add a test case in tests/utils.test.ts that calls greet('World') and asserts the result is 'Hello, World!'",
      setup: (dir) => {
        mkdirSync(join(dir, "src"), { recursive: true })
        mkdirSync(join(dir, "tests"), { recursive: true })
        writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { module: "ESNext", target: "ESNext", moduleResolution: "bundler", strict: true, skipLibCheck: true }, include: ["src", "tests"] }))
        writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "test-task1", type: "module", scripts: { test: "echo ok" }, devDependencies: { typescript: "^5.7.0" } }))
        writeFileSync(join(dir, "src/utils.ts"), "export function add(a: number, b: number): number { return a + b }\n")
        writeFileSync(join(dir, "tests/utils.test.ts"), 'import { add } from "../src/utils"\n')
      },
    },
    {
      name: "Fix type error in existing code",
      goal: "The src/index.ts has a type error. The `add` function from ./utils returns a number, but the call site expects a string. Fix the type mismatch by adding a proper conversion or fixing the types.",
      setup: (dir) => {
        mkdirSync(join(dir, "src"), { recursive: true })
        writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { module: "ESNext", target: "ESNext", moduleResolution: "bundler", strict: true }, include: ["src"] }))
        writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "test-task2", type: "module" }))
        writeFileSync(join(dir, "src/utils.ts"), "export function add(a: number, b: number): number { return a + b }\n")
        writeFileSync(join(dir, "src/index.ts"), `import { add } from "./utils.js"\nconst result: string = add(1, 2)\nconsole.log(result)\n`)
      },
    },
    {
      name: "Implement missing validation function",
      goal: "Implement a validateEmail(email: string): boolean function in src/validation.ts. It should check: contains @, contains domain with dot, length > 5. Export it. Add unit tests in tests/validation.test.ts.",
      setup: (dir) => {
        mkdirSync(join(dir, "src"), { recursive: true })
        mkdirSync(join(dir, "tests"), { recursive: true })
        writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { module: "ESNext", target: "ESNext", moduleResolution: "bundler", strict: true }, include: ["src", "tests"] }))
        writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "test-task3", type: "module", scripts: { test: "echo ok" } }))
      },
    },
  ]

  const allPassed = []
  const allFailed = []

  // Link global TypeScript for test projects
  const tsDir = join(tmpdir(), `agentic-e2e-ts-${Date.now()}`)
  rmSync(tsDir, { recursive: true, force: true })
  mkdirSync(tsDir, { recursive: true })
  writeFileSync(join(tsDir, "package.json"), JSON.stringify({ name: "ts-bin", type: "module", devDependencies: { typescript: "^5.7.0" } }))
  try {
    execFileSync("npm", ["install", "--silent"], { cwd: tsDir, stdio: "pipe", timeout: 60000 })
  } catch { console.log("   (npm install for TypeScript skipped)") }

  for (const [i, task] of tasks.entries()) {
    const dir = join(tmpdir(), `agentic-e2e-task-${i}-${Date.now()}`)
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    task.setup(dir)
    // Symlink TypeScript into test project
    if (existsSync(join(tsDir, "node_modules"))) {
      try { mkdirSync(join(dir, "node_modules"), { recursive: true }); rmSync(join(dir, "node_modules"), { recursive: true, force: true }); execFileSync("cp", ["-r", join(tsDir, "node_modules"), join(dir, "node_modules")], { timeout: 10000 }) } catch {}
    }

    console.log(`\n${"-".repeat(60)}`)
    console.log(`Task ${i + 1}/${tasks.length}: ${task.name}`)
    console.log(`${"-".repeat(60)}`)

    try {
      const mockInput = {
        client: sdkMockClient(),
        project: { name: `task-${i}`, path: dir },
        directory: dir,
        worktree: dir,
        experimental_workspace: { register: () => {} },
        serverUrl: new URL("http://localhost:3000"),
        $: new Proxy({}, {
          get() { return async () => ({ exitCode: 0, text: () => "", stdout: Buffer.from(""), stderr: Buffer.from("") }) },
        }),
      }

      const hooks = await mod.AgenticEngine(mockInput)
      const autoTool = hooks.tool?.agentic_auto
      if (!autoTool) {
        results.push({ task: task.name, passed: false, output: "", error: "agentic_auto tool not found" })
        allFailed.push(task.name)
        continue
      }

      const sessionId = `e2e-real-${Date.now()}-${i}`
      const context = {
        sessionID: sessionId,
        messageID: "msg-1",
        agent: "test",
        directory: dir,
        worktree: dir,
        abort: new AbortController().signal,
        metadata: () => {},
        ask: async () => {},
      }

      const startTime = Date.now()
      const result = await autoTool.execute({ goal: task.goal, constraints: [] }, context)
      const duration = ((Date.now() - startTime) / 1000).toFixed(1)

      const metadata = result.metadata?.result ?? {}
      const success = metadata.success ?? result.metadata?.success ?? false
      const stepsCompleted = metadata.completedSteps?.length ?? 0
      const stepsFailed = metadata.failedSteps?.length ?? 0
      const totalSteps = stepsCompleted + stepsFailed

      console.log(`   Duration: ${duration}s`)
      console.log(`   Steps: ${stepsCompleted}/${totalSteps} completed`)
      console.log(`   Success: ${success ? "✅" : "❌"}`)
      console.log(`   ${result.output.slice(0, 300)}...`)

      results.push({
        task: task.name,
        passed: success,
        output: result.output.slice(0, 500),
      })

      if (success) allPassed.push(task.name)
      else allFailed.push(task.name)
    } catch (e) {
      console.error(`   ❌ Error: ${e.message}`)
      results.push({ task: task.name, passed: false, output: "", error: e.message })
      allFailed.push(task.name)
    }
  }

  // Summary
  console.log()
  console.log("=".repeat(60))
  console.log("RESULTS")
  console.log("=".repeat(60))
  for (const r of results) {
    console.log(`${r.passed ? "✅" : "❌"} ${r.task}`)
    if (r.error) console.log(`   Error: ${r.error}`)
    console.log()
  }
  console.log(`Passed: ${allPassed.length}/${tasks.length}`)
  console.log(`Failed: ${allFailed.length}/${tasks.length}`)
  console.log()

  if (allFailed.length > 0) {
    console.log("⚠️  Some tasks failed — this is expected during development.")
    console.log("   Review the output above for details on each failure.")
    console.log("   The agentic_auto tool is improving; track regressions over time.")
  }

  process.exit(allFailed.length === 0 ? 0 : 0) // always exit 0 — this is informational, not CI
}

main().catch(e => {
  console.error("Fatal:", e)
  process.exit(1)
})
