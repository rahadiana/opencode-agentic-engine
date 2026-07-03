// test/run-parallel.mjs — Parallel test runner (true multi-process parallelism)
//
// Runs each test file in a separate Node.js child process for REAL parallelism.
// 16 workers total: 9 Part A + 7 Part B, all concurrent.
//
// Usage: node test/run-parallel.mjs
//
// NOTE: Intermittent failures (~1 per run) may occur due to shared /tmp/test-project
// directory being accessed concurrently by multiple child processes. For stable
// results use: node test/run.mjs

import { execFile } from "child_process"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const __dirname = dirname(fileURLToPath(import.meta.url))

const GREEN = "\x1b[32m"
const RED = "\x1b[31m"
const RESET = "\x1b[0m"

// All test files to run in parallel
const FILES = [
  // Part A (8 sub-files)
  "_runall-core.mjs",
  "_runall-verify.mjs",
  "_runall-adv.mjs",
  "_runall-evo.mjs",
  "_runall-edge-tools.mjs",
  "_runall-edge-training.mjs",
  "_runall-edge-verify.mjs",
  "_runall-gaps.mjs",
  // Part B (8 files)
  "_b_sandbox.mjs",
  "_b_planners.mjs",
  "_b_dag.mjs",
  "_b_dagworld.mjs",
  "_b_memory.mjs",
  "_b_agents.mjs",
  "_b_branch.mjs",
  "_b_protocols.mjs",
]

async function main() {
  const runStart = Date.now()

  // ── Phase 1: Load plugin once (shared module cache seed) ──
  // We import pluginDist here to warm up the module cache,
  // then each child process gets a fresh copy via its own import
  const { pluginDist } = await import("./_common.mjs")
  const mod = await import(pluginDist)
  console.log(`Plugin loaded (${Object.keys(mod).length} exports)\n`)

  // ── Phase 2: Run ALL 13 files in parallel as child processes ──
  const results = await Promise.all(FILES.map(runFile))

  // ── Phase 3: Aggregate results ──
  let totalPassed = 0
  let totalFailed = 0
  const failedFiles = []

  for (const r of results) {
    totalPassed += r.passed
    totalFailed += r.failed
    if (r.failed > 0) failedFiles.push(r.file)
  }

  const totalMs = Date.now() - runStart
  const totalSec = (totalMs / 1000).toFixed(1)

  console.log(`\n${"=".repeat(60)}`)
  if (failedFiles.length > 0) {
    console.log(`${RED}FAILED: ${failedFiles.join(", ")}${RESET}`)
  }
  console.log(`Results: ${GREEN}${totalPassed} passed${RESET}, ${totalFailed > 0 ? RED : GREEN}${totalFailed} failed${RESET} in ${totalSec}s (${FILES.length} workers)`)
  console.log(`${totalFailed === 0 ? GREEN : RED}${totalFailed === 0 ? "ALL TESTS PASSED" : "SOME TESTS FAILED"}${RESET}`)
  process.exit(totalFailed > 0 ? 1 : 0)
}

function runFile(file) {
  return new Promise((resolve) => {
    const start = Date.now()
    const filePath = join(__dirname, file)
    const child = execFile(process.execPath, [filePath], {
      timeout: 300000,
      maxBuffer: 50 * 1024 * 1024,
      encoding: "utf8",
    }, (error, stdout, stderr) => {
      const ms = Date.now() - start

      // Parse __RESULT__ line from stdout
      const resultLine = (stdout || "").split("\n").find(l => l.startsWith("__RESULT__:"))
      let passed = 0, failed = 0
      if (resultLine) {
        try {
          const r = JSON.parse(resultLine.replace("__RESULT__:", ""))
          passed = r.passed || 0
          failed = r.failed || 0
        } catch {}
      }


      // Show summary line for this file
      const status = failed === 0 ? GREEN : RED
      const short = file.replace(/^_runall-|^_b[-_]?/, "").replace(/\.mjs$/, "")
      console.log(`  ${status}${short.padEnd(12)}${RESET} ${passed}/${passed + failed} in ${ms}ms`)

      if (error && !stdout?.includes("__RESULT__:")) {
        const errLines = (stderr || "").split("\n").filter(Boolean).slice(-3)
        for (const l of errLines) console.log(`    ${RED}${l}${RESET}`)
        resolve({ file, passed: 0, failed: 1 })
      } else {
        resolve({ file, passed, failed })
      }
    })
  })
}

main().catch(e => {
  console.error("FATAL:", e.message)
  process.exit(1)
})
