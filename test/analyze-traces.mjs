/**
 * TRACE ANALYZER — Reads trace.jsonl files and produces efficiency recommendations.
 *
 * Analyzes:
 *   - Tool usage frequency (hot paths)
 *   - Latency distribution per tool
 *   - Error patterns and repeat failures
 *   - Cache efficiency opportunities
 *   - Parallel execution opportunities
 *   - Redundant call patterns
 *
 * Run: node test/analyze-traces.mjs [path/to/trace.jsonl]
 */

import { existsSync, readFileSync } from "fs"

const tracePath = process.argv[2] || "./.agentic/trace.jsonl"

if (!existsSync(tracePath)) {
  console.error(`Trace file not found: ${tracePath}`)
  process.exit(1)
}

const raw = readFileSync(tracePath, "utf-8").trim().split("\n")
const entries = raw.map(line => {
  try { return JSON.parse(line) }
  catch { return null }
}).filter(Boolean)

console.log(`\n\x1b[34m════════════════════════════════════════════════════════\x1b[0m`)
console.log(`\x1b[34m  TRACE ANALYSIS REPORT\x1b[0m`)
console.log(`\x1b[34m  File: ${tracePath}\x1b[0m`)
console.log(`\x1b[34m  Entries: ${entries.length}\x1b[0m`)
console.log(`\x1b[34m════════════════════════════════════════════════════════\x1b[0m\n`)

// ── 1. Tool Usage Frequency ──
const toolCounts = {}
const toolLatencies = {}
const toolErrors = {}
const toolSteps = {}

for (const e of entries) {
  const tool = e.toolUsed || "unknown"
  const step = e.step || "unknown"
  if (!toolCounts[tool]) {
    toolCounts[tool] = 0
    toolLatencies[tool] = []
    toolErrors[tool] = 0
    toolSteps[tool] = {}
  }
  toolCounts[tool]++
  toolSteps[tool][step] = (toolSteps[tool][step] || 0) + 1
  if (e.durationMs > 0) toolLatencies[tool].push(e.durationMs)
  if (!e.success) toolErrors[tool]++
}

const sortedTools = Object.entries(toolCounts).sort((a, b) => b[1] - a[1])

console.log(`\x1b[1m1. Tool Usage Frequency (top 15)\x1b[0m`)
console.log(`\x1b[2m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m`)
console.log(`  ${"Tool".padEnd(22)} ${"Calls".padEnd(8)} ${"Errors".padEnd(8)} ${"Avg Lat".padEnd(10)} ${"P95 Lat".padEnd(10)} ${"Hit Rate"}`)
console.log(`  ${"────".padEnd(22)} ${"─────".padEnd(8)} ${"──────".padEnd(8)} ${"───────".padEnd(10)} ${"───────".padEnd(10)} ${"────────"}`)

for (const [tool, count] of sortedTools.slice(0, 15)) {
  const latencies = toolLatencies[tool]
  const errors = toolErrors[tool]
  const avgLat = latencies.length > 0 ? Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length) : 0
  const sorted = [...latencies].sort((a, b) => a - b)
  const p95 = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.95)] || sorted[sorted.length - 1] : 0
  const hitRate = count > 0 ? ((count - errors) / count * 100).toFixed(1) + "%" : "N/A"
  const icon = hitRate.startsWith("100") ? "\x1b[32m✓\x1b[0m" : errors > 0 ? "\x1b[31m✗\x1b[0m" : "\x1b[33m△\x1b[0m"
  console.log(`  ${icon} ${tool.padEnd(20)} ${String(count).padEnd(8)} ${String(errors).padEnd(8)} ${String(avgLat).padEnd(10)} ${String(p95).padEnd(10)} ${hitRate}`)
}

// ── 2. Slow Operations (>30s) ──
console.log(`\n\x1b[1m2. Slow Operations (>10s)\x1b[0m`)
console.log(`\x1b[2m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m`)
const slowOps = entries.filter(e => e.durationMs > 10000)
if (slowOps.length === 0) {
  console.log(`  \x1b[32m✓\x1b[0m No operations >10s detected`)
} else {
  for (const op of slowOps) {
    console.log(`  \x1b[33m△\x1b[0m ${String(op.durationMs).padStart(6)}ms  ${op.toolUsed}  ${op.step}`)
  }
}

// ── 3. Repeat Failure Patterns ──
console.log(`\n\x1b[1m3. Repeat Failure Patterns\x1b[0m`)
console.log(`\x1b[2m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m`)
const stepFailures = {}
for (const e of entries) {
  if (!e.success) {
    const key = `${e.toolUsed}|${e.step}`
    if (!stepFailures[key]) stepFailures[key] = { tool: e.toolUsed, step: e.step, count: 0, entries: [] }
    stepFailures[key].count++
    stepFailures[key].entries.push(e)
  }
}
const repeatFailures = Object.values(stepFailures).filter(f => f.count >= 2)
if (repeatFailures.length === 0) {
  console.log(`  \x1b[32m✓\x1b[0m No repeat failure patterns detected`)
} else {
  for (const f of repeatFailures.sort((a, b) => b.count - a.count).slice(0, 10)) {
    console.log(`  \x1b[31m✗\x1b[0m ${f.tool} / ${f.step} — ${f.count} failures`)
  }
}

// ── 4. Sequential vs Parallel Opportunities ──
console.log(`\n\x1b[1m4. Parallel Execution Opportunities\x1b[0m`)
console.log(`\x1b[2m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m`)
// Look for sequences of the same tool called back-to-back (could be batched)
const seqPatterns = {}
for (let i = 0; i < entries.length - 1; i++) {
  if (entries[i].toolUsed === entries[i+1].toolUsed && entries[i+1].timestamp === entries[i+1].timestamp) {
    // Same tool, consecutive timestamps — could indicate batching opportunity
    const key = entries[i].toolUsed
    seqPatterns[key] = (seqPatterns[key] || 0) + 1
  }
}
const batchable = Object.entries(seqPatterns).filter(([_, c]) => c >= 3).sort((a, b) => b[1] - a[1])
if (batchable.length > 0) {
  for (const [tool, count] of batchable.slice(0, 5)) {
    console.log(`  \x1b[33m△\x1b[0m ${tool}: ${count} consecutive calls — consider batching`)
  }
} else {
  console.log(`  \x1b[32m✓\x1b[0m No obvious batching opportunities`)
}

// ── 5. Cache Recommendations ──
console.log(`\n\x1b[1m5. Cache Optimization Recommendations\x1b[0m`)
console.log(`\x1b[2m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m`)
// Look for identical inputs being processed
const inputHashes = {}
for (const e of entries) {
  const hash = `${e.toolUsed}|${e.input}`
  if (!inputHashes[hash]) inputHashes[hash] = { tool: e.toolUsed, count: 0, input: e.input }
  inputHashes[hash].count++
}
const duplicates = Object.values(inputHashes).filter(d => d.count >= 3).sort((a, b) => b.count - a.count)
if (duplicates.length > 0) {
  for (const d of duplicates.slice(0, 5)) {
    console.log(`  \x1b[33m△\x1b[0m ${d.tool}: ${d.count}× identical input — cache would save ${(d.count - 1) * 100}% calls`)
  }
} else {
  console.log(`  \x1b[32m✓\x1b[0m No significant duplicate input detected`)
}

// ── 6. Error Rate Summary ──
console.log(`\n\x1b[1m6. Error Rate Summary\x1b[0m`)
console.log(`\x1b[2m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m`)
const totalErrors = entries.filter(e => !e.success).length
const totalSuccess = entries.filter(e => e.success).length
const totalWithOutcome = totalErrors + totalSuccess
const overallErrorRate = totalWithOutcome > 0 ? (totalErrors / totalWithOutcome * 100).toFixed(1) : "N/A"
console.log(`  Total sessions: ${entries.length}`)
console.log(`  Successful: ${totalSuccess}`)
console.log(`  Failed: ${totalErrors}`)
console.log(`  Error rate: ${overallErrorRate}%`)

// Tools with highest error rates
console.log(`\n  Tools with errors:`)
const toolsWithErrors = Object.entries(toolErrors)
  .filter(([_, count]) => count > 0)
  .sort((a, b) => b[1] - a[1])
if (toolsWithErrors.length === 0) {
  console.log(`    \x1b[32m✓\x1b[0m All tools error-free`)
} else {
  for (const [tool, count] of toolsWithErrors) {
    const total = toolCounts[tool]
    const rate = (count / total * 100).toFixed(1)
    console.log(`    \x1b[31m✗\x1b[0m ${tool.padEnd(22)} ${count} errors  (${rate}%)`)
  }
}

// ── 7. Optimization Score ──
console.log(`\n\x1b[1m7. Efficiency Score\x1b[0m`)
console.log(`\x1b[2m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m`)
let score = 100

// Deductions
if (totalErrors > 0) score -= Math.min(totalErrors * 2, 20)
if (slowOps.length > 0) score -= Math.min(slowOps.length * 5, 15)
if (repeatFailures.length > 0) score -= Math.min(repeatFailures.length * 5, 15)
if (duplicates.length > 0) score -= Math.min(duplicates.length * 3, 10)

const grade = score >= 90 ? "\x1b[32mA" : score >= 80 ? "\x1b[33mB" : score >= 70 ? "\x1b[33mC" : "\x1b[31mD"
console.log(`  Overall: ${grade} (${score}/100)\x1b[0m`)

// Recommendations
console.log(`\n\x1b[1m8. Concrete Recommendations\x1b[0m`)
console.log(`\x1b[2m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m`)
const recs = []

if (totalErrors > 10) recs.push(`High error rate (${totalErrors}). Investigate top error sources.`)
if (slowOps.length > 0) recs.push(`${slowOps.length} slow operations. Consider: (a) timeouts, (b) streaming, (c) LLM model downgrade for quick ops.`)
if (duplicates.length > 0) recs.push(`Duplicate inputs: add SemanticCache for these ${duplicates.length} query patterns.`)
if (batchable.length > 0) recs.push(`Consecutive ${batchable[0][0]} calls: batch into single operation.`)

// Latency recommendation
const avgLatAll = entries.filter(e => e.durationMs > 0).reduce((s, e) => s + e.durationMs, 0) / Math.max(entries.filter(e => e.durationMs > 0).length, 1)
if (avgLatAll > 500) recs.push(`Average latency ${Math.round(avgLatAll)}ms: enable parallel execution for independent operations.`)

if (recs.length === 0) recs.push(`\x1b[32mSystem healthy. No immediate optimizations needed.\x1b[0m`)
for (let i = 0; i < recs.length; i++) {
  console.log(`  ${i + 1}. ${recs[i]}`)
}

console.log(`\n\x1b[34m════════════════════════════════════════════════════════\x1b[0m\n`)
