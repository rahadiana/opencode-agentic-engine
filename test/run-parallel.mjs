// test/run-parallel.mjs — Parallel test runner (true multi-process parallelism)
//
// Runs each test file in a separate Node.js child process for REAL parallelism.
// 23 workers total: 14 Part A + 9 Part B, all concurrent.
//
// Each worker gets its own temp directory (TEST_PROJECT_DIR env var) so
// there are no filesystem conflicts between parallel processes.
//
// Usage: node test/run-parallel.mjs

import { execFile } from "child_process"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const __dirname = dirname(fileURLToPath(import.meta.url))

const GREEN = "\x1b[32m"
const RED = "\x1b[31m"
const YELLOW = "\x1b[33m"
const BLUE = "\x1b[34m"
const DIM = "\x1b[2m"
const RESET = "\x1b[0m"

// All test files to run in parallel
const FILES = [
  // Part A (14 sub-files)
  "_runall-core.mjs",
  "_runall-verify.mjs",
  "_runall-adv.mjs",
  "_runall-adv-verifier.mjs",
  "_runall-adv-branch.mjs",
  "_runall-evo.mjs",
  "_runall-edge-tools.mjs",
  "_runall-edge-training.mjs",
  "_runall-edge-verify.mjs",
  "_runall-edge-gap4.mjs",
  "_runall-edge-deep.mjs",
  "_runall-edge-config.mjs",
  "_runall-gaps.mjs",
  "_runall-rag-selfimprove.mjs",
  "_runall-dumb-model.mjs",
  "_runall-auto-h4.mjs",
  // Part B (9 files)
  "_b_sandbox.mjs",
  "_b_planners.mjs",
  "_b_dag.mjs",
  "_b_dag-async.mjs",
  "_b_dagworld.mjs",
  "_b_memory.mjs",
  "_b_agents.mjs",
  "_b_branch.mjs",
  "_b_protocols.mjs",
]

async function main() {
  const runStart = Date.now()

  // ── Phase 1: Load plugin once (shared module cache seed) ──
  const { pluginDist } = await import("./_common.mjs")
  const mod = await import(pluginDist)
  console.log(`Plugin loaded (${Object.keys(mod).length} exports)\n`)

  // ── Phased parallel execution ──
  // Phase 0: All Part A + Part B files together.
  // Each worker gets a UNIQUE temp directory via TEST_PROJECT_DIR env var.
  console.log(`${BLUE}┌─ Running ${FILES.length} workers in parallel ─┐${RESET}`)
  const results = await Promise.all(FILES.map((file, i) => runFile(file, i)))

  // ── Phase 3: Aggregate results ──
  let totalPassed = 0
  let totalFailed = 0
  const failedFiles = []
  const timedOutFiles = []

  for (const r of results) {
    totalPassed += r.passed
    totalFailed += r.failed
    if (r.failed > 0) failedFiles.push(r.file)
    if (r.timedOut) timedOutFiles.push(r.file)
  }

  const totalMs = Date.now() - runStart
  const totalSec = (totalMs / 1000).toFixed(1)

  // Sort results by elapsed time for nice display
  const sorted = [...results].sort((a, b) => a.elapsed - b.elapsed)

  console.log(`\n${BLUE}└─ All workers finished ─┘${RESET}`)
  console.log(`\n${DIM}Sorted by duration:${RESET}`)
  for (const r of sorted) {
    const icon = r.timedOut ? "⏰" : r.failed === 0 ? "✅" : "❌"
    const status = r.failed === 0 ? GREEN : RED
    const short = r.file.replace(/^_runall-|^_b[-_]?/, "").replace(/\.mjs$/, "")
    const pct = r.passed + r.failed > 0 ? ` (${((r.passed / (r.passed + r.failed)) * 100).toFixed(0)}%)` : ""
    console.log(`  ${icon} ${status}${short.padEnd(16)}${RESET} ${r.passed}/${r.passed + r.failed}${pct} ${DIM}${r.elapsed}ms${RESET}`)
  }

  console.log(`\n${"=".repeat(60)}`)
  if (timedOutFiles.length > 0) {
    console.log(`${YELLOW}TIMEOUT: ${timedOutFiles.join(", ")}${RESET}`)
  }
  if (failedFiles.length > 0) {
    console.log(`${RED}FAILED: ${failedFiles.join(", ")}${RESET}`)
  }
  console.log(`Results: ${GREEN}${totalPassed} passed${RESET}, ${totalFailed > 0 ? RED : GREEN}${totalFailed} failed${RESET} in ${totalSec}s (${FILES.length} parallel workers)`)

  // Print slowest files for optimization reference
  const slowest = [...results].sort((a, b) => b.elapsed - a.elapsed).slice(0, 3)
  console.log(`\n${DIM}Slowest workers (optimization targets):${RESET}`)
  for (const r of slowest) {
    const fileLabel = r.file.padEnd(28)
    console.log(`  ${DIM}${fileLabel} ${r.elapsed}ms (${r.passed}/${r.passed + r.failed})${RESET}`)
  }

  console.log(`${totalFailed === 0 ? GREEN : RED}${totalFailed === 0 ? "ALL TESTS PASSED" : "SOME TESTS FAILED"}${RESET}`)
  process.exit(totalFailed > 0 ? 1 : 0)
}

function runFile(file, index) {
  return new Promise((resolve) => {
    const start = Date.now()
    const filePath = join(__dirname, file)
    const uniqueDir = `/tmp/test-project-${index}`

    const child = execFile(process.execPath, [filePath], {
      timeout: 300000,
      maxBuffer: 50 * 1024 * 1024,
      encoding: "utf8",
      env: {
        ...process.env,
        TEST_PROJECT_DIR: uniqueDir,
      },
    }, (error, stdout, stderr) => {
      const ms = Date.now() - start
      const timedOut = error?.killed || error?.signal === "SIGTERM"

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
      const status = timedOut ? YELLOW : (failed === 0 ? GREEN : RED)
      const short = file.replace(/^_runall-|^_b[-_]?/, "").replace(/\.mjs$/, "")
      const icon = timedOut ? "⏰" : (failed === 0 ? " " : "✗")
      console.log(`  ${icon} ${status}${short.padEnd(12)}${RESET} ${passed}/${passed + failed} in ${ms}ms${timedOut ? " TIMEOUT" : ""}`)

      if (timedOut) {
        resolve({ file, passed: 0, failed: 1, elapsed: ms, timedOut: true })
      } else if (error && !stdout?.includes("__RESULT__:")) {
        const errLines = (stderr || "").split("\n").filter(Boolean).slice(-3)
        for (const l of errLines) console.log(`    ${RED}${l}${RESET}`)
        resolve({ file, passed: 0, failed: 1, elapsed: ms, timedOut: false })
      } else {
        resolve({ file, passed, failed, elapsed: ms, timedOut: false })
      }
    })
  })
}

main().catch(e => {
  console.error("FATAL:", e.message)
  process.exit(1)
})
