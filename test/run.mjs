// test/run.mjs — Orchestrator that runs ALL tests in order
//
// This file was split from the monolithic test/run.mjs (14,844 lines)
// into smaller focused files for better maintainability and parallel execution.
//
// Part A: _runall.mjs — Core plugin tests (inside runAll())
// Part B: _b_*.mjs — Individual test sections with own assertion helpers
//
// All modules share state via _state.mjs and helpers via _common.mjs

import "./_common.mjs"
import { runAll } from "./_runall.mjs"

// ── Part A: Core plugin tests (from original runAll function) ──
await runAll()

// ── Part B: Individual test sections ──
// Load sequentially to maintain test order for deterministic results
await import("./_b_sandbox.mjs")
await import("./_b_planners.mjs")
await import("./_b_dagworld.mjs")
await import("./_b_memory.mjs")
await import("./_b_agents.mjs")
await import("./_b_branch.mjs")
await import("./_b_protocols.mjs")

// ── Final Results Summary ──
import { state, runStart } from "./_state.mjs"
import { G, R, RST } from "./_common.mjs"

const totalMs = Date.now() - runStart
const totalSec = (totalMs / 1000).toFixed(1)
console.log(`\nResults: ${G}${state.passed} passed${RST}, ${state.failed > 0 ? R : G}${state.failed} failed${RST} in ${totalSec}s`)
if (state.failed === 0) {
  console.log(`${G}ALL TESTS PASSED${RST}`)
} else {
  console.log(`\n${R}── Failed Tests ──${RST}`)
  for (const f of state.failedTests) {
    console.log(`  ${R}✗${RST} ${f.section ? f.section + " → " : ""}${f.msg}`)
  }
}
process.exit(state.failed > 0 ? 1 : 0)
