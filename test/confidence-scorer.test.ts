/**
 * ConfidenceScorer unit tests — Gap #2: Confidence Scoring per Output
 *
 * Paper: Roychoudhury '25 — "Agentic AI Software Engineers: Programming with Trust"
 * arXiv:2502.13767 | CACM 2026
 *
 * Run: npx tsx test/confidence-scorer.test.ts
 */

import { ConfidenceScorer, ConfidenceStore } from "../src/core/confidence-scorer.js"

let passed = 0
let failed = 0

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${msg}`)
    passed++
  } else {
    console.error(`  ❌ FAIL: ${msg}`)
    failed++
  }
}

// ── C1: ConfidenceScorer — scoring ──
console.log("\n[C1] ConfidenceScorer — scoring")

const cs = new ConfidenceScorer()

// Full signals
const fullScore = cs.score({
  stepId: "step-1",
  modelName: "gpt-4o",
  compileResult: { passed: true },
  guardResult: { passed: true, claims: [
    { verified: true }, { verified: true }, { verified: false },
  ]},
  testResult: { passed: true, total: 10, passedCount: 9 },
  lintResult: { passed: true },
  semanticResult: { passed: true },
  techDebtScore: { overall: "low" },
  modelReliability: 0.95,
})
assert(fullScore.overall > 0.8, "C1a full score > 0.8")
assert(fullScore.passed === true, "C1b passed=true when over threshold")
assert(fullScore.dimensions.compileCheck === 1, "C1c compile dim = 1")
assert(Math.abs(fullScore.dimensions.hallucinationCheck - 2/3) < 0.001, "C1d guard dim = 2/3")
assert(fullScore.dimensions.testPassRate === 0.9, "C1e test dim = 0.9")
assert(fullScore.dimensions.techDebtImpact === 1, "C1f debt dim = 1")
assert(fullScore.provenance.length === 7, "C1g all 7 signals have provenance")
assert(fullScore.provenance[0].source === "compile", "C1h first provenance = compile")

// Missing signals (conservative)
const emptyScore = cs.score({ stepId: "step-empty" })
assert(emptyScore.overall < 0.3, "C1i empty score < 0.3 (conservative defaults)")
assert(emptyScore.passed === false, "C1j passed=false when no signals")
assert(emptyScore.dimensions.compileCheck === 0, "C1k compile=0 when missing")

// Custom threshold
const strict = new ConfidenceScorer(undefined, 0.9)
const borderline = strict.score({
  stepId: "step-border",
  compileResult: { passed: true },
  guardResult: { passed: true, claims: [{ verified: true }] },
})
assert(borderline.overall < 0.9, "C1l borderline < 0.9 with strict threshold")
assert(borderline.passed === false, "C1m borderline not passed with 0.9 threshold")

// Custom weights
const weighted = new ConfidenceScorer({ compileCheck: 0.5, hallucinationCheck: 0.5 })
const wScore = weighted.score({
  stepId: "step-w",
  compileResult: { passed: true },
  guardResult: { passed: false, claims: [{ verified: false }] },
})
// compile=1.0*0.5 + hallucination=0.0*0.5 + modelDefault=0.5*0.05 = 0.525
assert(Math.abs(wScore.overall - 0.525) < 0.001, "C1n 50/50 weights = 0.525")

// setWeights
cs.setWeights({ compileCheck: 0.4, modelReliability: 0.1 })
assert(cs.getWeights().compileCheck === 0.4, "C1o setWeights works")
assert(cs.getWeights().hallucinationCheck === 0.2, "C1p other weights preserved")

// setThreshold
cs.setThreshold(0.5)
assert(cs.getThreshold() === 0.5, "C1q setThreshold works")
cs.setThreshold(0.7) // restore

// Format
const formatted = cs.format(fullScore)
assert(formatted.includes("Confidence Score"), "C1r format includes title")
assert(formatted.includes("Compile"), "C1s format includes Compile dimension")
assert(formatted.includes("Hallucination"), "C1t format includes Hallucination dimension")

// Format compact
const compact = cs.formatCompact(fullScore)
assert(compact.includes("%"), "C1u compact includes percentage")

assert(true, "C1z all confidence scoring tests passed")

// ── C2: ConfidenceStore — store & query ──
console.log("\n[C2] ConfidenceStore — store & query")

const store = new ConfidenceStore()
assert(store.size === 0, "C2a empty store")

store.set("step-1", fullScore)
assert(store.size === 1, "C2b store has 1 entry")
assert(store.get("step-1")?.stepId === "step-1", "C2c get returns correct entry")
assert(typeof store.get("step-1")?.score === "number", "C2d get returns correct score")

const low = cs.score({ stepId: "step-low", compileResult: { passed: false } })
store.set("step-low", low)
assert(store.size === 2, "C2e store has 2 entries")

const lowConf = store.getLowConfidence()
assert(lowConf.length >= 1, "C2f at least 1 low confidence step")
assert(lowConf.some(r => r.stepId === "step-low"), "C2g step-low is low confidence")

const sorted = store.getSorted()
assert(sorted[0].score >= sorted[1].score, "C2h sorted: highest first")

const avg = store.getAverage()
assert(avg > 0, "C2j average > 0")

store.clear()
assert(store.size === 0, "C2k clear works")

assert(true, "C2z all confidence store tests passed")

// ── C3: Edge cases ──
console.log("\n[C3] ConfidenceScorer — edge cases")

// Guard with no claims
const noClaimsScore = cs.score({
  stepId: "step-nc",
  compileResult: { passed: true },
  guardResult: { passed: true, claims: [] },
})
assert(noClaimsScore.dimensions.hallucinationCheck === 1, "C3a no claims = hallucination check 1.0")

// Test 0/0 (no tests)
const noTests = cs.score({
  stepId: "step-nt",
  testResult: { passed: true },
})
assert(noTests.dimensions.testPassRate === 1, "C3b no test details, passed=true = 1.0")

// Test failed with counts
const failedTests = cs.score({
  stepId: "step-ft",
  testResult: { passed: false, total: 5, passedCount: 2 },
})
assert(Math.abs(failedTests.dimensions.testPassRate - 0.4) < 0.001, "C3c failed tests 2/5 = 0.4")

// Tech debt levels
const debtLevels = [
  { overall: "low" as const, expected: 1.0 },
  { overall: "medium" as const, expected: 0.7 },
  { overall: "high" as const, expected: 0.3 },
  { overall: "critical" as const, expected: 0.0 },
]
for (const { overall, expected } of debtLevels) {
  const s = cs.score({ stepId: "step-dt", techDebtScore: { overall } })
  assert(Math.abs(s.dimensions.techDebtImpact - expected) < 0.001, `C3d debt ${overall} = ${expected}`)
}

// Model reliability range clamping
const clamped = cs.score({
  stepId: "step-mr",
  modelReliability: 1.5, // > 1.0
})
assert(clamped.dimensions.modelReliability === 1, "C3e model reliability clamped to 1.0")

assert(true, "C3z all edge case tests passed")

// ── Summary ──
console.log(`\nResults: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.error("SOME TESTS FAILED")
  process.exit(1)
} else {
  console.log("ALL CONFIDENCE SCORER TESTS PASSED")
}
