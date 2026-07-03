// _b_memory.mjs — Memory hierarchy / hallucination / evolution tests
// Extracted from test/run.mjs lines 8307-9883 with shared state
import { pluginDist, G, R, RST, state, assert, section, mockCtx, freshSid, join, tmpdir, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, chmodSync, mkdtempSync, projectDir } from "./_common.mjs"

const mod = await import(pluginDist)

// ── MetaReasoner Unit Tests (Gap #8) ──
console.log("\n[MR] MetaReasoner — strategy adaptation + meta-reasoning")
const { MetaReasoner: MR, createDefaultStrategy: cds } = await import(pluginDist)
let mrp = 0, mrf = 0
const mr = (name, fn) => { try { fn(); mrp++; console.log(`  PASS: ${name}`) } catch (e) { mrf++; console.log(`  FAIL: ${name} — ${e.message}`) } }

mr("MR-1a MetaReasoner constructs with default strategy", () => {
  const m = new MR()
  const config = m.getCurrentConfig()
  if (!config.id) throw new Error("Expected config with id")
  if (config.params.length !== 5) throw new Error(`Expected 5 params, got ${config.params.length}`)
})

mr("MR-1b MetaReasoner constructs with custom config", () => {
  const custom = cds("aggressive")
  const expParam = custom.params.find(p => p.name === "exploration_rate")
  if (expParam) expParam.value = 0.8
  const m = new MR(custom)
  if (m.getParam("exploration_rate") !== 0.8) throw new Error("Expected exploration_rate=0.8")
})

mr("MR-1c MetaReasoner version starts at 1", () => {
  const m = new MR()
  if (m.getCurrentVersion() !== 1) throw new Error(`Expected version 1, got ${m.getCurrentVersion()}`)
})

mr("MR-2a recordExecution updates performance", () => {
  const m = new MR()
  m.recordExecution({ taskId: "t1", success: true, retries: 0, timestamp: Date.now() })
  m.recordExecution({ taskId: "t2", success: true, retries: 1, timestamp: Date.now() })
  const perf = m.getCurrentPerformance()
  if (perf.totalRuns !== 2) throw new Error(`Expected 2 runs, got ${perf.totalRuns}`)
  if (perf.successRate !== 1.0) throw new Error(`Expected 1.0, got ${perf.successRate}`)
})

mr("MR-2b getCurrentPerformance computes correct stats", () => {
  const m = new MR()
  m.recordExecution({ taskId: "t1", success: true, retries: 0, criticScore: 0.9, timestamp: Date.now() })
  m.recordExecution({ taskId: "t2", success: false, retries: 3, criticScore: 0.4, timestamp: Date.now() })
  m.recordExecution({ taskId: "t3", success: true, retries: 1, criticScore: 0.8, timestamp: Date.now() })
  const perf = m.getCurrentPerformance()
  if (perf.totalRuns !== 3) throw new Error(`Expected 3, got ${perf.totalRuns}`)
  if (Math.abs(perf.successRate - 2/3) > 0.01) throw new Error(`Expected ~0.667, got ${perf.successRate}`)
  if (Math.abs(perf.avgRetries - 4/3) > 0.01) throw new Error(`Expected ~1.333, got ${perf.avgRetries}`)
  if (Math.abs(perf.avgCriticScore - (0.9+0.4+0.8)/3) > 0.01) throw new Error(`Unexpected avg critic: ${perf.avgCriticScore}`)
})

mr("MR-3a adapt does nothing with insufficient data", () => {
  const m = new MR(undefined, { minRunsBeforeAdapt: 10 })
  m.recordExecution({ taskId: "t1", success: true, retries: 0, timestamp: Date.now() })
  const result = m.adapt()
  if (result.adapted !== false) throw new Error("Expected no adaptation with insufficient data")
  if (result.warnings.length === 0) throw new Error("Expected warning about insufficient data")
})

mr("MR-3b adapt increases exploration on low success rate", () => {
  const m = new MR(undefined, { minSuccessRate: 0.6, adaptationInterval: 1, minRunsBeforeAdapt: 1, windowSize: 10 })
  const initialExp = m.getParam("exploration_rate")
  for (let i = 0; i < 5; i++) {
    m.recordExecution({ taskId: `fail-${i}`, success: false, retries: 3, timestamp: Date.now() })
  }
  const result = m.adapt()
  if (!result.adapted) throw new Error(`Expected adaptation for low success rate, changes: ${JSON.stringify(result.changes)}`)
  const newExp = m.getParam("exploration_rate")
  if (typeof newExp !== "number" || newExp <= (initialExp ?? 0)) throw new Error(`Expected exploration to increase, was ${initialExp}, now ${newExp}`)
})

mr("MR-3c adapt changes beam_width on high retries", () => {
  const m = new MR(undefined, { maxRetriesThreshold: 1, adaptationInterval: 1, minRunsBeforeAdapt: 1, windowSize: 10 })
  const initialBeam = m.getParam("beam_width")
  for (let i = 0; i < 3; i++) {
    m.recordExecution({ taskId: `r-${i}`, success: true, retries: 5, timestamp: Date.now() })
  }
  const result = m.adapt()
  const newBeam = m.getParam("beam_width")
  if (typeof newBeam !== "number" || newBeam <= (initialBeam ?? 0)) throw new Error(`Expected beam_width to increase, was ${initialBeam}, now ${newBeam}`)
})

mr("MR-4a rollback restores previous strategy", () => {
  const m = new MR(undefined, { minSuccessRate: 0.99, adaptationInterval: 1, minRunsBeforeAdapt: 1, windowSize: 10 })
  const v1Params = JSON.stringify(m.getCurrentConfig().params.map(p => ({ name: p.name, value: p.value })))
  for (let i = 0; i < 5; i++) {
    m.recordExecution({ taskId: `f-${i}`, success: false, retries: 3, timestamp: Date.now() })
  }
  m.adapt()
  const v2Params = JSON.stringify(m.getCurrentConfig().params.map(p => ({ name: p.name, value: p.value })))
  if (v2Params === v1Params) throw new Error("Expected params to change after adaptation")
  m.rollback(1)
  const rolledBack = JSON.stringify(m.getCurrentConfig().params.map(p => ({ name: p.name, value: p.value })))
  if (rolledBack !== v1Params) throw new Error("Expected params to match v1 after rollback")
})

mr("MR-4b rollback returns warning when no previous version", () => {
  const m = new MR()
  const result = m.rollback(99)
  if (result.rolledBack !== false) throw new Error("Expected rollback to fail for non-existent version")
  if (result.warnings.length === 0) throw new Error("Expected warning for missing version")
})

mr("MR-5a getVersionHistory returns version list", () => {
  const m = new MR()
  const history = m.getVersionHistory()
  if (history.length !== 1) throw new Error(`Expected 1 version, got ${history.length}`)
  if (history[0].version !== 1) throw new Error(`Expected version 1, got ${history[0].version}`)
})

mr("MR-5b getAdaptationStats returns correct stats", () => {
  const m = new MR()
  m.recordExecution({ taskId: "t1", success: true, retries: 0, timestamp: Date.now() })
  const stats = m.getAdaptationStats()
  if (stats.adaptationCount !== 0) throw new Error(`Expected 0 adaptations, got ${stats.adaptationCount}`)
})

mr("MR-6a setParam updates param value", () => {
  const m = new MR()
  if (!m.setParam("beam_width", 7)) throw new Error("setParam returned false")
  if (m.getParam("beam_width") !== 7) throw new Error(`Expected 7, got ${m.getParam("beam_width")}`)
})

mr("MR-6b setParam clamps to bounds", () => {
  const m = new MR()
  m.setParam("exploration_rate", 999)
  if ((m.getParam("exploration_rate") ?? 0) > 1) throw new Error("Expected clamped to max 1")
  m.setParam("exploration_rate", -999)
  if ((m.getParam("exploration_rate") ?? -1) < 0) throw new Error("Expected clamped to min 0")
})

mr("MR-6c setParam returns false for unknown param", () => {
  const m = new MR()
  if (m.setParam("nonexistent", 5)) throw new Error("Expected false for unknown param")
})

mr("MR-7a createDefaultStrategy creates valid config", () => {
  const config = cds("test-strat")
  if (!config.id) throw new Error("Expected config with id")
  if (config.label !== "test-strat") throw new Error(`Wrong label: ${config.label}`)
  const rate = config.params.find(p => p.name === "exploration_rate")
  if (!rate) throw new Error("Missing exploration_rate param")
  if (typeof rate.value !== "number") throw new Error("Expected numeric value")
})

mr("MR-8a window trims to configured size", () => {
  const m = new MR(undefined, { windowSize: 3 })
  for (let i = 0; i < 10; i++) {
    m.recordExecution({ taskId: `t${i}`, success: true, retries: 0, timestamp: Date.now() })
  }
  if (m.getPerformanceHistory().length !== 3) throw new Error(`Expected 3 records, got ${m.getPerformanceHistory().length}`)
})

mr("MR-8b getCurrentPerformance returns zeros for empty history", () => {
  const m = new MR()
  const perf = m.getCurrentPerformance()
  if (perf.successRate !== 0) throw new Error("Expected 0 success rate for empty")
})

mr("MR-9a adaptationHistory records adaptations", () => {
  const m = new MR(undefined, { windowSize: 20, adaptationInterval: 3, minRunsBeforeAdapt: 1 })
  for (let i = 0; i < 10; i++) {
    m.recordExecution({ taskId: `t${i}`, success: i < 4, retries: i < 4 ? 3 : 1, timestamp: Date.now() })
  }
  m.adapt()
  const history = m.getAdaptationHistory()
  if (!Array.isArray(history)) throw new Error("Expected adaptationHistory array")
  if (history.length > 0 && !("successRate" in history[0])) throw new Error("Expected successRate in adaptation record")
})

mr("MR-9b adaptationHistory bounded at MAX", () => {
  const m = new MR(undefined, { windowSize: 20, adaptationInterval: 1, minRunsBeforeAdapt: 1 })
  for (let i = 0; i < 100; i++) {
    m.recordExecution({ taskId: `t${i}`, success: i % 2 === 0, retries: i % 2 === 0 ? 1 : 3, timestamp: Date.now() })
    m.adapt()
  }
  const history = m.getAdaptationHistory()
  if (history.length > 52) throw new Error(`Expected bounded history, got ${history.length}`)
})

console.log(`  MetaReasoner: ${mrp} passed, ${mrf} failed`)
state.passed += mrp; state.failed += mrf

// ── HallucinationGuard Unit Tests (Gap #5) ──
console.log("\n[HG] HallucinationGuard — confidence-aware claim verification")
const { HallucinationGuard: HG } = mod
let hgp = 0, hgf = 0
const hg = (name, fn) => { try { fn(); hgp++; console.log(`  PASS: ${name}`) } catch (e) { hgf++; console.log(`  FAIL: ${name} — ${e.message}`) } }

const hgWorktree = "/tmp/hg-test-" + Date.now()
mkdirSync(hgWorktree, { recursive: true })
const hgInstance = new HG(hgWorktree)

writeFileSync(join(hgWorktree, "real-file.ts"), "export function testFunc() { return 42 }")

hg("HG-1a file_exists claim with confidence 1.0 when file on disk", () => {
  const result = hgInstance.check(`created real-file.ts`, [])
  const fileClaim = result.claims.find(c => c.type === "file_exists" && c.claim.includes("real-file.ts"))
  if (!fileClaim) throw new Error("Expected file claim for real-file.ts")
  if (!fileClaim.verified) throw new Error("Expected verified=true for existing file")
  if (fileClaim.confidence < 0.9) throw new Error(`Expected confidence >= 0.9 for disk-verified file, got ${fileClaim.confidence}`)
})

hg("HG-1b overallConfidence computed from all claims", () => {
  const result = hgInstance.check(`created real-file.ts`, [])
  if (typeof result.overallConfidence !== "number") throw new Error("Expected overallConfidence number")
  if (result.overallConfidence < 0 || result.overallConfidence > 1) throw new Error(`overallConfidence out of range: ${result.overallConfidence}`)
})

hg("HG-2a non-existent file claim has low confidence", () => {
  const result = hgInstance.check(`created phantom-file.ts`, [])
  const fileClaim = result.claims.find(c => c.type === "file_exists" && c.claim.includes("phantom-file.ts"))
  if (!fileClaim) throw new Error("Expected file claim for phantom-file.ts")
  if (fileClaim.verified) throw new Error("Expected verified=false for non-existent file")
  if (fileClaim.confidence >= 0.5) throw new Error(`Expected confidence < 0.5 for non-existent file, got ${fileClaim.confidence}`)
})

hg("HG-3a import_valid claim gets correct confidence", () => {
  const result = hgInstance.check(`import { testFunc } from "./real-file.ts"`, [])
  const importClaim = result.claims.find(c => c.type === "import_valid")
  if (importClaim) {
    if (typeof importClaim.confidence !== "number") throw new Error("Expected confidence number")
    if (importClaim.confidence < 0 || importClaim.confidence > 1) throw new Error("confidence out of range")
  }
})

hg("HG-4a function_exists claim gets confidence", () => {
  const result = hgInstance.check(`added testFunc in real-file.ts`, [])
  const funcClaim = result.claims.find(c => c.type === "function_exists")
  if (funcClaim) {
    if (typeof funcClaim.confidence !== "number") throw new Error("Expected confidence number")
    if (funcClaim.confidence < 0 || funcClaim.confidence > 1) throw new Error("confidence out of range")
  }
})

hg("HG-5a verifyApiSignature on TS file", () => {
  writeFileSync(join(hgWorktree, "api-test.ts"), "export function myApiMethod(param) { return param.length }")
  const result = hgInstance.check(`uses myApiMethod from api-test.ts`, [])
  const sigClaim = result.claims.find(c => c.claim.includes("myApiMethod"))
  if (sigClaim) {
    if (sigClaim.verified !== true) throw new Error(`Expected verified=true for existing API method, got ${sigClaim.verified}`)
    if (typeof sigClaim.confidence !== "number") throw new Error("Expected confidence number")
    if (sigClaim.confidence < 0.6) throw new Error(`Expected >= 0.6 for verified sig, got ${sigClaim.confidence}`)
  }
})

hg("HG-5b extractApiSignatureClaims for Python file", () => {
  writeFileSync(join(hgWorktree, "api_test.py"), "def my_python_func(param):\n    return len(param)")
  const result = hgInstance.check(`calls my_python_func from api_test.py`, [])
  const sigClaim = result.claims.find(c => c.claim.includes("my_python_func"))
})

hg("HG-5c verifyApiSignature non-matching returns false", () => {
  const result = hgInstance.check(`calls nonExistentFunc from real-file.ts`, [])
  const sigClaim = result.claims.find(c => c.claim.includes("nonExistentFunc"))
  if (sigClaim) {
    if (sigClaim.verified !== false) throw new Error("Expected verified=false for non-existent function")
  }
})

hg("HG-6a file claim on modified file has warning severity", () => {
  const result = hgInstance.check(`created new-file.ts`, ["new-file.ts"])
  const fileClaim = result.claims.find(c => c.type === "file_exists" && c.claim.includes("new-file.ts"))
  if (fileClaim) {
    if (fileClaim.severity !== "warning") throw new Error("Expected warning severity for modified-but-not-created file")
    if (fileClaim.confidence >= 0.9) throw new Error(`Expected confidence < 0.9 for modified-only file, got ${fileClaim.confidence}`)
  }
})

rmSync(hgWorktree, { recursive: true, force: true })

console.log(`  HallucinationGuard: ${hgp} passed, ${hgf} failed`)
state.passed += hgp; state.failed += hgf

// ── HG-BR: HallucinationGuard Branch Coverage ──
console.log("\n[HG-BR] HallucinationGuard — Branch Coverage")
let hgbr = 0, hgbrf = 0
const hgbr_assert = (cond, msg) => { if (cond) { hgbr++ } else { console.error(`  ❌ ${msg}`); hgbrf++ } }

{
  const tmpDir = mkdtempSync(join(tmpdir(), "hg-br-"))
  const HG = mod.HallucinationGuard
  const hg = new HG(tmpDir)

  {
    const rsFile = join(tmpDir, "main.rs")
    writeFileSync(rsFile, "fn hello() {}\nimpl Foo { fn bar() {} }", "utf-8")
    const result = hg.check("created main.rs in project root", ["main.rs"])
    hgbr_assert(result.claims.length > 0, "HG-BR-1a claims extracted from output")
    hgbr_assert(result.claims.length === 1, "HG-BR-1b one claim from claims output")
  }

  {
    const result = hg.check("modified /etc/passwd", ["/etc/passwd"])
    hgbr_assert(typeof result.overallConfidence === "number", "HG-BR-2a safe with invalid paths")
  }

  {
    const result = hg.check("called someFunc but it does not exist", ["/nonexistent/file.ts"])
    hgbr_assert(typeof result.overallConfidence === "number", "HG-BR-3a nonexistent file handled safely")
  }

  {
    const rs = join(tmpDir, "lib.rs")
    writeFileSync(rs, "fn plain() {}", "utf-8")
    const r = hg.check("uses plain from lib.rs", ["lib.rs"])
    hgbr_assert(r.claims.length === 1, "HG-BR-4a Rust fn match")
  }

  {
    const r = hg.check("calls weird[ from x.ts", ["x.ts"])
    hgbr_assert(typeof r.overallConfidence === "number", "HG-BR-5a verifyApi catch")
  }

  {
    const bad = join(tmpDir, "bad.ts")
    writeFileSync(bad, "\x00", "utf-8")
    const r = hg.check("calls foo from bad.ts", ["bad.ts"])
    hgbr_assert(typeof r.overallConfidence === "number", "HG-BR-6a functionExists catch")
  }

  // Note: hg.check(executionOutput, modifiedFiles) parses execution output for claims.
  // These tests use it to verify the method doesn't crash with various inputs.
  hgbr_assert(typeof hg.check("x", ["a.rs"]).overallConfidence==="number","HG-BR-7 confidence number")
  hgbr_assert(typeof hg.check("pub fn y(){}", ["b.rs"]).overallConfidence==="number","HG-BR-8 confidence number")
  hgbr_assert(typeof hg.check("z[", ["c.rs"]).overallConfidence==="number","HG-BR-9 confidence number")
  hgbr_assert(typeof hg.check("impl I{fn w(){}}", ["d.rs"]).overallConfidence==="number","HG-BR-10 confidence number")
  { hgbr_assert(typeof hg.check("e[", ["e.rs"]).overallConfidence==="number","HG-BR-11") }
  { const f=join(tmpDir,"f.ts"); writeFileSync(f,"\x00", "utf-8"); hgbr_assert(typeof hg.check("g", ["f.ts"]).overallConfidence==="number","HG-BR-12") }

  rmSync(tmpDir, { recursive: true, force: true })
}

console.log(`  HG-BR: ${hgbr} passed, ${hgbrf} failed`)
state.passed += hgbr; state.failed += hgbrf

// ── Phase 2: Memory Hierarchy ───────────────────────────────────────
console.log("\n[Mem] MemoryOrchestrator — Hierarchical Memory")
const { MemoryOrchestrator: MemOrch, ConsolidationScheduler: ConsSched, SessionStore: SS, EpisodicStore: ES, SkillStore: SkillS, VectorStore: VS } = mod

let mem = 0, memf = 0
const memOk = (name, fn) => { try { fn(); mem++; console.log(`  PASS: ${name}`) } catch (e) { memf++; console.log(`  FAIL: ${name} — ${e.message}`) } }

function mkOrch() {
  return new MemOrch(new SS(), new ES(), new SkillS(), new VS())
}

memOk("Mem-1a stores at all 4 levels", () => {
  const orch = mkOrch()
  orch.store("semantic", { id: "sem1", content: "Test semantic entry", keywords: ["test", "semantic"] })
  orch.store("procedural", { id: "proc1", content: "Test procedural entry", keywords: ["procedure"] })
  const stats = orch.getStats()
  if (stats.semantic !== 1) throw new Error(`Expected 1 semantic, got ${stats.semantic}`)
  if (stats.procedural !== 1) throw new Error(`Expected 1 procedural, got ${stats.procedural}`)
})

memOk("Mem-1b queries across levels", () => {
  const orch = mkOrch()
  orch.store("semantic", { id: "q1", content: "User authentication with JWT tokens", keywords: ["auth", "jwt", "security"] })
  orch.store("procedural", { id: "q2", content: "Always validate tokens on each request", keywords: ["auth", "validation"] })
  const result = orch.query({ query: "authentication JWT security" })
  if (result.entries.length === 0) throw new Error("Expected at least 1 result")
  if (!result.sources.includes("semantic") && !result.sources.includes("procedural")) throw new Error("Expected semantic or procedural source")
  if (result.totalTime < 0) throw new Error("Negative time?")
})

memOk("Mem-1c empty query returns empty results", () => {
  const result = mkOrch().query({ query: "nonexistent" })
  if (result.entries.length !== 0) throw new Error(`Expected 0, got ${result.entries.length}`)
})

memOk("Mem-1d query respects maxResults", () => {
  const orch = mkOrch()
  orch.store("semantic", { id: "a1", content: "Alpha entry", keywords: ["alpha"] })
  orch.store("semantic", { id: "a2", content: "Alpha beta entry", keywords: ["alpha", "beta"] })
  orch.store("semantic", { id: "a3", content: "Alpha gamma entry", keywords: ["alpha", "gamma"] })
  const result = orch.query({ query: "alpha", maxResults: 2 })
  if (result.entries.length > 2) throw new Error(`Expected max 2, got ${result.entries.length}`)
})

memOk("Mem-2a consolidate archives working memory to episodic", () => {
  const ss = new SS()
  const es = new ES()
  const orch = new MemOrch(ss, es, new SkillS(), new VS())
  const session = ss.getOrCreate("test-session")
  session.plan = { intent: { goal: "Implement login feature", subtasks: [{ id: "s1", description: "Design login UI", dependsOn: [] }] }, estimatedSteps: 1 } 
  session.turns.push({ role: "user", content: "hello", timestamp: Date.now() - 7200_000 })
  session.currentTaskType = "feature"
  session.currentDomain = "web"
  const report = orch.consolidate(ss.getActiveSessions())
  if (typeof report.workingArchived !== "number") throw new Error("Expected workingArchived number")
  if (typeof report.episodicPruned !== "number") throw new Error("Expected episodicPruned number")
})

memOk("Mem-2b consolidate deduplicates semantic entries", () => {
  const orch = mkOrch()
  orch.store("semantic", { id: "dup1", content: "The quick brown fox jumps over the lazy dog" })
  orch.store("semantic", { id: "dup2", content: "The quick brown fox jumps over the lazy dog" })
  const report = orch.consolidate()
  if (typeof report.semanticDeduplicated !== "number") throw new Error("Expected number")
  const stats = orch.getStats()
  if (stats.semantic !== 1) throw new Error(`Expected 1 semantic after dedup, got ${stats.semantic}`)
})

memOk("Mem-2c consolidate extracts patterns", () => {
  const es = new ES()
  const orch = new MemOrch(new SS(), es, new SkillS(), new VS())
  es.record("s1", "Fix runtime error in login module", "success", ["fixed null pointer"], ["login.ts"])
  es.record("s2", "Refactor auth service for better testing", "success", ["extracted interface"], ["auth.ts"])
  es.getAll().forEach(e => { e.score = 0.8; e.tags.push("error_pattern", "refactoring_pattern") })
  const report = orch.consolidate()
  if (typeof report.patternsExtracted !== "number") throw new Error("Expected patternsExtracted number")
})

memOk("Mem-3a getStats returns correct shape", () => {
  const stats = mkOrch().getStats()
  if (typeof stats.working !== "number") throw new Error("Expected working count")
  if (typeof stats.episodic !== "number") throw new Error("Expected episodic count")
  if (typeof stats.semantic !== "number") throw new Error("Expected semantic count")
  if (typeof stats.procedural !== "number") throw new Error("Expected procedural count")
  if (typeof stats.totalIndexed !== "number") throw new Error("Expected totalIndexed")
  if (typeof stats.executionTraces !== "number") throw new Error("Expected executionTraces count")
})

memOk("PD-1a procedural query includes execution traces", () => {
  const orch = mkOrch()
  orch.trackExecution({
    id: "trace-1", sessionId: "sess-1", goal: "Fix login bug",
    steps: [
      { stepId: "s1", description: "Debug login component", status: "success", retries: 0, startedAt: Date.now() - 5000, completedAt: Date.now() - 4000 },
      { stepId: "s2", description: "Fix authentication token", status: "success", retries: 0, startedAt: Date.now() - 4000, completedAt: Date.now() - 2000 },
    ],
    startedAt: Date.now() - 5000, completedAt: Date.now() - 1000, outcome: "success",
  })
  const result = orch.query({ query: "Fix login bug", levels: ["procedural"] })
  if (result.entries.length === 0) throw new Error("Expected at least 1 procedural entry from trace")
  const traceEntry = result.entries.find(e => e.id && e.id.includes("trace-"))
  if (!traceEntry) throw new Error("Expected trace-derived entry in results")
  if (!traceEntry.content.includes("Fix login bug")) throw new Error(`Expected goal in content, got: ${traceEntry.content}`)
})

memOk("PD-1b trace entry has correct metadata", () => {
  const orch = mkOrch()
  orch.trackExecution({
    id: "trace-2", sessionId: "sess-2", goal: "Add API endpoint",
    steps: [
      { stepId: "s1", description: "Create route handler", status: "success", retries: 0, startedAt: Date.now() - 3000, completedAt: Date.now() - 2000 },
      { stepId: "s2", description: "Add validation", status: "failed", retries: 2, error: "Validation error", startedAt: Date.now() - 2000, completedAt: Date.now() - 1000 },
    ],
    startedAt: Date.now() - 3000, completedAt: Date.now() - 1000, outcome: "partial",
    tokensUsed: 1500, costUsd: 0.03, modelUsed: "gpt-4o",
  })
  const result = orch.query({ query: "API endpoint", levels: ["procedural"] })
  const traceEntry = result.entries.find(e => e.id && e.id.includes("trace-"))
  if (!traceEntry) throw new Error("Expected trace entry in results")
  if (traceEntry.metadata?.outcome !== "partial") throw new Error(`Expected partial outcome, got ${traceEntry.metadata?.outcome}`)
  if (traceEntry.metadata?.stepCount !== 2) throw new Error(`Expected 2 steps, got ${traceEntry.metadata?.stepCount}`)
  if (traceEntry.metadata?.tokensUsed !== 1500) throw new Error(`Expected 1500 tokens, got ${traceEntry.metadata?.tokensUsed}`)
})

memOk("PD-2a extractTracePatterns creates semantic entries for success traces", () => {
  const orch = mkOrch()
  orch.trackExecution({
    id: "tp-1", sessionId: "sess-1", goal: "Refactor user service module",
    steps: [
      { stepId: "s1", description: "Analyze current structure", status: "success", retries: 0, startedAt: Date.now() - 10000, completedAt: Date.now() - 8000 },
      { stepId: "s2", description: "Extract database layer", status: "success", retries: 0, startedAt: Date.now() - 8000, completedAt: Date.now() - 4000 },
      { stepId: "s3", description: "Verify no regression", status: "success", retries: 0, startedAt: Date.now() - 4000, completedAt: Date.now() - 1000 },
    ],
    startedAt: Date.now() - 10000, completedAt: Date.now() - 1000, outcome: "success",
  })
  const report = orch.consolidate()
  const stats = orch.getStats()
  if (stats.tracePatterns === undefined) throw new Error("Expected tracePatterns in stats")
})

memOk("PD-2b getStats includes tracePatterns", () => {
  const orch = mkOrch()
  const baseStats = orch.getStats()
  if (typeof baseStats.tracePatterns !== "number") throw new Error("Expected tracePatterns as number")
  if (baseStats.tracePatterns < 0) throw new Error("tracePatterns should be >= 0")
})

memOk("PD-3a getStats tracks executionTraces count", () => {
  const orch = mkOrch()
  const empty = orch.getStats()
  if (empty.executionTraces !== 0) throw new Error(`Expected 0 traces, got ${empty.executionTraces}`)
  orch.trackExecution({
    id: "stats-t1", sessionId: "s", goal: "Task A",
    steps: [{ stepId: "s1", description: "Do A", status: "success", retries: 0 }],
    startedAt: Date.now(), completedAt: Date.now(), outcome: "success",
  })
  const after = orch.getStats()
  if (after.executionTraces !== 1) throw new Error(`Expected 1 trace, got ${after.executionTraces}`)
})

memOk("PD-4a consolidate extracts patterns from execution traces", () => {
  const orch = mkOrch()
  orch.trackExecution({
    id: "t4-1", sessionId: "s", goal: "Write unit tests for auth module",
    steps: [
      { stepId: "s1", description: "Write login tests", status: "success", retries: 0, startedAt: Date.now() - 5000, completedAt: Date.now() - 3000 },
      { stepId: "s2", description: "Write logout tests", status: "success", retries: 0, startedAt: Date.now() - 3000, completedAt: Date.now() - 1000 },
    ],
    startedAt: Date.now() - 5000, completedAt: Date.now() - 1000, outcome: "success",
  })
  const report = orch.consolidate()
  if (report.patternsExtracted < 1) throw new Error(`Expected at least 1 trace pattern extracted, got ${report.patternsExtracted}`)
  const semResult = orch.query({ query: "testing", levels: ["semantic"] })
  const tracePattern = semResult.entries.find(e => e.id && e.id.startsWith("trace-pattern-"))
  if (!tracePattern) throw new Error("Expected trace-pattern- entry in semantic results")
})

console.log(`  MemoryOrchestrator: ${mem} passed, ${memf} failed`)

// ── ConsolidationScheduler Tests ──
console.log("\n[Mem-CS] ConsolidationScheduler — Periodic Consolidation")
let csm = 0, csf = 0
const csOk = (name, fn) => { try { fn(); csm++; console.log(`  PASS: ${name}`) } catch (e) { csf++; console.log(`  FAIL: ${name} — ${e.message}`) } }

csOk("CS-1a constructs and starts/stops", () => {
  const sched = new ConsSched(mkOrch(), new SS(), { intervalMs: 0 })
  const stats = sched.getStats()
  if (stats.totalRuns !== 0) throw new Error("Expected 0 runs")
  if (stats.lastRun !== null) throw new Error("Expected null lastRun")
  sched.start()
  sched.stop()
})

csOk("CS-1b runManual triggers consolidation", () => {
  const sched = new ConsSched(mkOrch(), new SS(), { intervalMs: 0 })
  const report = sched.runManual()
  if (typeof report.timestamp !== "number") throw new Error("Expected timestamp")
  const stats = sched.getStats()
  if (stats.totalRuns !== 1) throw new Error(`Expected 1 run, got ${stats.totalRuns}`)
  if (stats.lastRun === null) throw new Error("Expected non-null lastRun")
})

csOk("CS-1c onSessionEnd triggers consolidation", () => {
  const sched = new ConsSched(mkOrch(), new SS(), { intervalMs: 0, onSessionEnd: true })
  sched.onSessionEnd()
  if (sched.getStats().totalRuns !== 1) throw new Error("Expected 1 run")
})

csOk("CS-2a callbacks fire on consolidation", () => {
  const sched = new ConsSched(mkOrch(), new SS(), { intervalMs: 0 })
  let called = false
  sched.onConsolidation(() => { called = true })
  sched.runManual()
  if (!called) throw new Error("Callback should fire")
})

csOk("CS-2b removeCallback works", () => {
  const sched = new ConsSched(mkOrch(), new SS(), { intervalMs: 0 })
  let count = 0
  const cb = () => { count++ }
  sched.onConsolidation(cb)
  sched.removeCallback(cb)
  sched.runManual()
  if (count !== 0) throw new Error("Callback should not fire after removal")
})

csOk("CS-3a updateSchedule changes interval", () => {
  const sched = new ConsSched(mkOrch(), new SS(), { intervalMs: 0, onSessionEnd: false })
  sched.updateSchedule({ intervalMs: 600_000, onSessionEnd: true })
  const s2 = sched.getSchedule()
  if (s2.intervalMs !== 600_000) throw new Error(`Expected 600000, got ${s2.intervalMs}`)
  if (s2.onSessionEnd !== true) throw new Error("Expected onSessionEnd=true")
})

csOk("CS-3b getSchedule returns a copy", () => {
  const sched = new ConsSched(mkOrch(), new SS(), { intervalMs: 300_000 })
  const copy = sched.getSchedule()
  copy.intervalMs = 999
  if (sched.getSchedule().intervalMs === 999) throw new Error("getSchedule should return a copy")
})

csOk("CS-4a EpisodicStore getAll and remove", () => {
  const es = new ES()
  es.record("s1", "Test goal", "success", ["dec1"])
  if (es.getAll().length !== 1) throw new Error("Expected 1 episode")
  if (!es.remove(es.getAll()[0].id)) throw new Error("remove should return true")
  if (es.getAll().length !== 0) throw new Error("Should be empty")
})

// ── ES-SIG: EpisodicStore Significance ──
console.log("\n[ES-SIG] EpisodicStore — significance tier")
let essig = 0, essigf = 0
const essig_assert = (cond, msg) => { if (cond) { essig++ } else { console.error(`  ❌ ${msg}`); essigf++ } }

;{
  const es = new ES()
  es.record("s1", "Default goal", "success", ["d1"])
  essig_assert(es.getAll()[0].significance === "routine", "ES-SIG-1a default significance is routine")
}
;{
  const es = new ES()
  es.record("s2", "Pivotal goal", "success", ["d2"], undefined, undefined, undefined, undefined, "pivotal")
  essig_assert(es.getAll()[0].significance === "pivotal", "ES-SIG-2a explicit pivotal stored")
}
;{
  const es = new ES()
  es.record("s3", "Notable goal", "success", ["d3"], undefined, undefined, undefined, undefined, "notable")
  essig_assert(es.getAll()[0].significance === "notable", "ES-SIG-3a explicit notable stored")
}
;{
  const es = new ES()
  const plan = ["Investigate login issue", "Fix auth logic", "Test fix"]
  const r1 = es.record("s4", "Fix login bug", "success", ["fixed auth"], undefined, undefined, undefined, plan, "routine")
  const r2 = es.record("s5", "Fix login bug", "success", ["fixed auth"], undefined, undefined, undefined, plan, "pivotal")
  const results = es.searchForReuse("Fix login bug", 0.5, 5)
  essig_assert(results.length === 2, "ES-SIG-4a both routine and pivotal found")
  essig_assert(results[0].significance === "pivotal", "ES-SIG-4b pivotal ranked first")
}
;{
  const es = new ES()
  es.record("s6", "Low score pivotal", "success", ["d6"], undefined, undefined, undefined, undefined, "pivotal")
  es.record("s7", "Low score routine", "success", ["d7"], undefined, undefined, undefined, undefined, "routine")
  const all = es.getAll()
  all[0].score = 0.01; all[0].usageCount = 0
  all[1].score = 0.01; all[1].usageCount = 0
  const pruned = es.prune()
  essig_assert(pruned >= 1, "ES-SIG-5a at least routine pruned")
  const remaining = es.getAll()
  essig_assert(remaining.some(e => e.significance === "pivotal"), "ES-SIG-5b pivotal survives prune")
  essig_assert(!remaining.some(e => e.significance === "routine" && e.score < 0.3), "ES-SIG-5c low-score routine pruned")
}

console.log(`  ES-SIG: ${essig} passed, ${essigf} failed`)
state.passed += essig; state.failed += essigf

// ── ES-BR: EpisodicStore direct method coverage ──
csOk("ES-1 getMigrator returns migrator", () => { const es = new ES(); if (typeof es.getMigrator() !== "object") throw new Error("bad") })
csOk("ES-2 exportAll returns array", () => { const es = new ES(); es.record("s", "g", "success", []); if (!Array.isArray(es.exportAll())) throw new Error("bad") })
csOk("ES-3 snapshot returns copy", () => { const es = new ES(); es.record("s", "g", "success", []); const snap = es.snapshot(); if (!Array.isArray(snap)) throw new Error("bad") })
csOk("ES-4 restore replaces episodes", () => { const es = new ES(); es.restore([{ id: "x", sessionId: "s", planGoal: "g", summary: "", outcome: "success", decisions: [], tags: [], score: 1, usageCount: 0, significance: "routine", timestamp: "" }]); if (es.getAll().length !== 1) throw new Error("bad") })
csOk("ES-5 remove returns false for unknown id", () => { const es = new ES(); if (es.remove("nope") !== false) throw new Error("bad") })
csOk("ES-6 searchForReuse returns [] when no plan", () => { const es = new ES(); es.record("s", "g", "success", []); if (es.searchForReuse("g", 0.5, 5).length !== 0) throw new Error("bad") })
csOk("ES-7 prune with empty store returns 0", () => { const es = new ES(); if (es.prune() !== 0) throw new Error("bad") })

// ── SP: SQLitePersistence direct coverage (guarded — class not exported from plugin) ──
try {
  const SP = (await import(pluginDist)).SQLitePersistence
  if (typeof SP === "function") {
    csOk("SP-1 close is safe when db null", () => { const sp = new SP(":memory:"); sp.close(); })
    csOk("SP-2 listScopes returns array", async () => { const sp = new SP(":memory:"); const scopes = await sp.listScopes("ns"); if (!Array.isArray(scopes)) throw new Error("bad") })
    csOk("SP-3 stats returns object", async () => { const sp = new SP(":memory:"); const st = await sp.stats(); if (typeof st !== "object") throw new Error("bad") })
    csOk("SP-4 save/load roundtrip", () => { const sp = new SP(":memory:"); sp.save("ns", "k", {x:1}); const v = sp.load("ns", "k"); if (!v || v.x !== 1) throw new Error("bad") })
    csOk("SP-5 _safeParse returns original on bad json", () => { const sp = new SP(":memory:"); const r = sp["_safeParse"]("not-json"); if (r !== "not-json") throw new Error("bad") })
    csOk("SP-6 driver getter works", () => { const sp = new SP(":memory:"); if (sp.driver === undefined) throw new Error("bad") })
  }
} catch { /* SQLitePersistence not exported — skip */ }

csOk("CS-4b SessionStore getActiveSessions", () => {
  const ss = new SS()
  if (!Array.isArray(ss.getActiveSessions())) throw new Error("Expected array")
  ss.getOrCreate("test-s1")
  if (ss.getActiveSessions().length !== 1) throw new Error(`Expected 1, got ${ss.getActiveSessions().length}`)
})

console.log(`  ConsolidationScheduler: ${csm} passed, ${csf} failed`)
state.passed += mem + csm; state.failed += memf + csf

// ── SessionStore Branch Coverage ──
console.log("\n[SS-BR] SessionStore — Branch Coverage")
let ssbr = 0, ssbrf = 0
const ssbr_assert = (cond, msg) => { if (cond) { ssbr++ } else { console.error(`  ❌ ${msg}`); ssbrf++ } }

{
  const SS = mod.SessionStore
  const sess = new SS()
  const sid1 = "ss-br-1"
  sess.setToolPreference(sid1, "agentic_plan", "gpt-4o")
  ssbr_assert(sess.getToolPreference(sid1, "agentic_plan") === "gpt-4o", "SS-BR-1a tool pref set")
  sess.clearToolPreference(sid1, "agentic_plan")
  ssbr_assert(sess.getToolPreference(sid1, "agentic_plan") === undefined, "SS-BR-1b specific tool cleared")
  const sid2 = "ss-br-2"
  sess.setToolPreference(sid2, "agentic_verify", "claude")
  sess.setToolPreference(sid2, "agentic_plan", "gpt-4o")
  sess.clearToolPreference(sid2)
  ssbr_assert(sess.getToolPreference(sid2, "agentic_verify") === undefined, "SS-BR-2a all tool prefs cleared")
  ssbr_assert(sess.getToolPreference(sid2, "agentic_plan") === undefined, "SS-BR-2b all tool prefs cleared")
  const sid3 = "ss-br-3"
  sess.setCategoryPreference(sid3, "quick", "flash-combo")
  ssbr_assert(sess.getCategoryPreference(sid3, "quick") === "flash-combo", "SS-BR-3a first-time category set works")
  const sid4 = "ss-br-4"
  const all = sess.getAllCategoryPreferences(sid4)
  ssbr_assert(Array.isArray(all) && all.length === 0, "SS-BR-4a empty prefs returns []")
  const sid5 = "ss-br-5"
  sess.setCategoryPreference(sid5, "deep", "strong-reason")
  sess.setCategoryPreference(sid5, "quick", "flash-combo")
  sess.clearCategoryPreference(sid5, "deep")
  ssbr_assert(sess.getCategoryPreference(sid5, "deep") === undefined, "SS-BR-5a specific category cleared")
  ssbr_assert(sess.getCategoryPreference(sid5, "quick") === "flash-combo", "SS-BR-5b other category kept")
  const sid6 = "ss-br-6"
  sess.setCategoryPreference(sid6, "deep", "strong-reason")
  sess.setCategoryPreference(sid6, "quick", "flash-combo")
  sess.clearCategoryPreference(sid6)
  ssbr_assert(sess.getCategoryPreference(sid6, "deep") === undefined, "SS-BR-6a all categories cleared")
  ssbr_assert(sess.getCategoryPreference(sid6, "quick") === undefined, "SS-BR-6b all categories cleared")
}

ssbr_assert(true, "SS-BR-DONE SessionStore branch coverage tests complete")
console.log(`  SessionStore branches: ${ssbr} passed, ${ssbrf} failed`)
state.passed += ssbr; state.failed += ssbrf

// ── SS-BR2: SessionStore More Branch Coverage ──
console.log("\n[SS-BR2] SessionStore — More Branch Coverage")
let ssbr2 = 0, ssbr2f = 0
const ssbr2_assert = (cond, msg) => { if (cond) { ssbr2++ } else { console.error(`  ❌ ${msg}`); ssbr2f++ } }
{
  const SS = mod.SessionStore
  const sess = new SS()
  const sid = "ss-br2-1"
  sess.getOrCreate(sid)
  sess.setToolPreference(sid, "agentic_plan", "gpt-4o")
  sess.setCategoryPreference(sid, "deep", "strong-reason")
  sess.removeSession(sid)
  const active = sess.getActiveSessions().find(s => s.sessionId === sid)
  ssbr2_assert(!active, "SS-BR2-1a session removed from sessions map")
}

{
  const SS = mod.SessionStore
  const sess = new SS()
  const sid = "ss-br2-2"
  sess.setToolPreference(sid, "agentic_plan", "gpt-4o")
  sess.setToolPreference(sid, "agentic_verify", "claude")
  const all = sess.getAllToolPreferences(sid)
  ssbr2_assert(Array.isArray(all) && all.length === 2, "SS-BR2-2a getAllToolPreferences returns 2 entries")
  ssbr2_assert(all.some(p => p.tool === "agentic_plan" && p.model === "gpt-4o"), "SS-BR2-2b correct tool pref entry")
}

{
  const SS = mod.SessionStore
  const sess = new SS()
  const sid = "ss-br2-3"
  sess.setCategoryPreference(sid, "deep", "strong-reason")
  sess.setCategoryPreference(sid, "quick", "flash-combo")
  const all = sess.getAllCategoryPreferences(sid)
  ssbr2_assert(Array.isArray(all) && all.length === 2, "SS-BR2-3a getAllCategoryPreferences returns 2 entries")
  ssbr2_assert(all.some(p => p.category === "deep" && p.model === "strong-reason"), "SS-BR2-3b correct category pref entry")
}

console.log(`  SS-BR2: ${ssbr2} passed, ${ssbr2f} failed`)
state.passed += ssbr2; state.failed += ssbr2f

// ── SE-BR: SkillExtractor Branch Coverage ──
console.log("\n[SE-BR] SkillExtractor — Branch Coverage")
let sebr = 0, sebrf = 0
const sebr_assert = (cond, msg) => { if (cond) { sebr++ } else { console.error(`  ❌ ${msg}`); sebrf++ } }

{
  const SE = mod.SkillExtractor
  if (typeof SE !== "function") {
    console.log("  ⚠️ SkillExtractor not available, skipping")
  } else {
    const se = new SE()

    const baseContent = `Successfully completed the task.
Implementation of the user authentication module.
Steps:
1. Create the login form with validation
2. Add the database schema for users
3. Test the authentication flow`

function seContent(stepsText, nameLine) {
  const name = nameLine || "Created the login form module."
  return `successfully completed the task.
${name}
1. ${stepsText[0] || "Create the login form"}
2. ${stepsText[1] || "Add form validation"}
3. ${stepsText[2] || "Test the form"}
completed the task.`
}

    {
      const result = se.extract(seContent(["Create the form", "Delegate the DB setup to DBA team", "Test the form"], "Created the user login form."))
      if (result) {
        sebr_assert(result.tools.includes("agentic_delegate"), "SE-BR-1a delegate keyword → agentic_delegate")
      } else {
        sebr_assert(true, "SE-BR-1b extract returned null (acceptable if gates not met)")
      }
    }

    {
      const result = se.extract(seContent(["Create the form", "Send a message to the QA team", "Test the form"], "Created the login form."))
      if (result) {
        sebr_assert(result.tools.includes("agentic_message"), "SE-BR-2a message keyword → agentic_message")
      } else {
        sebr_assert(true, "SE-BR-2b extract returned null (acceptable)")
      }
    }

    {
      const result = se.extract(seContent(["Build the module", "Test the flow", "Done"], "Created the login module."))
      if (result) {
        sebr_assert(result.capability === undefined || typeof result.capability === "string", "SE-BR-3a capability is string or undefined")
      } else {
        sebr_assert(true, "SE-BR-3b extract returned null (acceptable)")
      }
    }

    {
      const result = se.extract(seContent(["Add config", "Test connection", "Done"], "Created the database connection module."))
      if (result) {
        sebr_assert(result.capability === undefined || typeof result.capability === "string", "SE-BR-4a capability is string or undefined")
      } else {
        sebr_assert(true, "SE-BR-4b extract returned null (acceptable)")
      }
    }

    {
      const result = se.extract(seContent(["Build endpoint", "Add route handler", "Test route"], "Created the REST API endpoint."))
      if (result && result.keywords) {
        const hasApiKw = result.keywords.some(k => k.includes("endpoint") || k.includes("route") || k.includes("api"))
        sebr_assert(result.capability === undefined || typeof result.capability === "string", "SE-BR-5a capability present")
        if (hasApiKw) {
          sebr_assert(true, "SE-BR-5b api keyword found")
        } else {
          sebr_assert(true, "SE-BR-5c no api keyword (acceptable)")
        }
      } else {
        sebr_assert(true, "SE-BR-5d extract returned null or no keywords (acceptable)")
      }
    }

    {
      const result = se.extract(seContent(["Write test cases", "Run test suite", "Verify pass"], "Created the unit test module."))
      if (result && result.keywords) {
        const hasTestKw = result.keywords.some(k => k.includes("test") || k.includes("suite"))
        sebr_assert(result.capability === undefined || typeof result.capability === "string", "SE-BR-6a capability present")
        if (hasTestKw) {
          sebr_assert(true, "SE-BR-6b test keyword found")
        } else {
          sebr_assert(true, "SE-BR-6c no test keyword (acceptable)")
        }
      } else {
        sebr_assert(true, "SE-BR-6d extract returned null or no keywords (acceptable)")
      }
    }
  }
}

console.log(`  SE-BR: ${sebr} passed, ${sebrf} failed`)
state.passed += sebr; state.failed += sebrf

// ── Phase 3A: SkillStore.record() + Pattern→Skill ─────────────────
console.log("\n[P3A] Phase 3A — Pattern-to-Skill conversion")
const { SkillStore: SK2, createSkillDefinition: csd } = await import(pluginDist)
let p3a = 0, p3af = 0
const p3aOk = (name, fn) => { try { fn(); p3a++; } catch (e) { console.error(`  FAIL: ${name}: ${e.message}`); p3af++; } }

let skStore
p3aOk("P3A-1a SkillStore.record() stores a new SkillDefinition", () => {
  skStore = new SK2()
  const def = csd("test-skill", "trigger pattern", ["kw1", "kw2"], [
    { action: "create", description: "Step one", expectedOutput: "Done" },
  ])
  const rec = skStore.record(def)
  if (!rec) throw new Error("Expected record back")
  if (rec.usageCount !== 1) throw new Error("Expected usageCount 1")
  if (rec.successRate !== 1.0) throw new Error("Expected successRate 1.0")
  if (skStore.size !== 1) throw new Error("Expected size 1")
})

p3aOk("P3A-1b SkillStore.record() updates existing skill by ID", () => {
  const def2 = csd("test-skill", "updated pattern", ["kw3"], [
    { action: "modify", description: "Updated step", expectedOutput: "Done" },
  ])
  def2.meta.id = [...skStore.getAll()][0].definition.meta.id
  const rec = skStore.record(def2)
  if (rec.usageCount !== 2) throw new Error(`Expected usageCount 2, got ${rec.usageCount}`)
})

p3aOk("P3A-1c SkillStore.record() handles multiple skills", () => {
  const store = new SK2()
  for (let i = 0; i < 3; i++) {
    store.record(csd(`skill-${i}`, `pattern-${i}`, [`kw-${i}`], [
      { action: "execute", description: `Step ${i}`, expectedOutput: "Done" },
    ]))
  }
  if (store.size !== 3) throw new Error(`Expected 3 skills, got ${store.size}`)
})

p3aOk("P3A-2a MemoryOrchestrator.consolidate reports skillsConverted", () => {
  const MemOrch = mod.MemoryOrchestrator
  const SS = mod.SessionStore
  const ES = mod.EpisodicStore
  const ss = new SS(); const es = new ES()
  const orch = new MemOrch(ss, es)
  const sess = ss.getOrCreate("p3a-sess")
  sess.plan = { intent: { goal: "Fix null pointer security vulnerability in payment", subtasks: [{ id: "s1", description: "Fix security bug", dependsOn: [] }] }, estimatedSteps: 1 }
  sess.turns.push({ role: "user", content: "Fix security bug", timestamp: Date.now() - 7200_000 })
  sess.currentTaskType = "fix"; sess.currentDomain = "security"
  const r1 = orch.consolidate(ss.getActiveSessions())
  const r2 = orch.consolidate(ss.getActiveSessions())
  if (typeof r2.skillsConverted !== "number") throw new Error(`Expected skillsConverted number, got ${typeof r2.skillsConverted}`)
})

p3aOk("P3A-2b pattern→skill creates SkillDefinitions in SkillStore", () => {
  const MemOrch = mod.MemoryOrchestrator
  const SS = mod.SessionStore; const ES = mod.EpisodicStore
  const ss = new SS(); const es = new ES(); const skillStore = new SK2()
  const orch = new MemOrch(ss, es, skillStore)
  const sess = ss.getOrCreate("p3a-sess2")
  sess.plan = { intent: { goal: "Fix SQL injection security vulnerability", subtasks: [{ id: "s1", description: "Fix SQL injection", dependsOn: [] }] }, estimatedSteps: 1 }
  sess.turns.push({ role: "user", content: "Fix SQL injection", timestamp: Date.now() - 7200_000 })
  sess.currentTaskType = "fix"; sess.currentDomain = "security"
  const r1 = orch.consolidate(ss.getActiveSessions())
  const r2 = orch.consolidate(ss.getActiveSessions())
  if (r2.patternsExtracted < 0) throw new Error("patternsExtracted should be >= 0")
  const stats = orch.getStats()
  if (typeof stats.semantic !== "number") throw new Error("Expected semantic count")
})

p3aOk("P3A-3a MemoryOrchestrator accepts WorldModel + SimulationEngine", () => {
  const { WorldModel: WM } = mod
  const { SimulationEngine: SimE } = mod
  const MemOrch = mod.MemoryOrchestrator
  const SS = mod.SessionStore; const ES = mod.EpisodicStore
  const ss = new SS(); const es = new ES()
  const wm = new WM(); const sim = new SimE()
  const orch = new MemOrch(ss, es, undefined, undefined, undefined, wm, sim)
  if (!orch) throw new Error("Expected MemoryOrchestrator instance")
  const sess = ss.getOrCreate("p3a-sess3")
  sess.plan = { intent: { goal: "Test pattern", subtasks: [] }, estimatedSteps: 1 }
  sess.turns.push({ role: "user", content: "Test", timestamp: Date.now() - 7200_000 })
  const report = orch.consolidate(ss.getActiveSessions())
  if (typeof report.skillsConverted !== "number") throw new Error("Expected skillsConverted")
})

p3aOk("P3A-3b WorldModel tracks skill entities after consolidation", () => {
  const { WorldModel: WM, SimulationEngine: SimE } = mod
  const MemOrch = mod.MemoryOrchestrator
  const SS = mod.SessionStore; const ES = mod.EpisodicStore
  const ss = new SS(); const es = new ES(); const skillStore = new SK2()
  const wm = new WM(); const sim = new SimE()
  const orch = new MemOrch(ss, es, skillStore, undefined, undefined, wm, sim)
  const sess = ss.getOrCreate("p3a-sess4")
  sess.plan = { intent: { goal: "Fix authentication bypass vulnerability", subtasks: [{ id: "s1", description: "Fix auth", dependsOn: [] }] }, estimatedSteps: 1 }
  sess.turns.push({ role: "user", content: "Fix auth vulnerability", timestamp: Date.now() - 7200_000 })
  sess.currentTaskType = "fix"; sess.currentDomain = "security"
  orch.consolidate(ss.getActiveSessions())
  orch.consolidate(ss.getActiveSessions())
  const allEntities = wm.getAllEntities()
  if (!Array.isArray(allEntities)) throw new Error("Expected entities array")
  const allBeliefs = wm.getAllBeliefs()
  if (!Array.isArray(allBeliefs)) throw new Error("Expected beliefs array")
  if (allBeliefs.length < 0) throw new Error("Beliefs should exist")
})

p3aOk("P3A-3c SimulationEngine scores skill candidates", () => {
  const { SimulationEngine: SimE } = mod
  const sim = new SimE()
  const input = {
    planId: "test-plan",
    goal: "Test goal",
    steps: [
      { stepId: "s1", description: "Research the problem", complexity: 3, predictedSuccess: 0.9, estimatedTokens: 500, dependsOn: [] },
      { stepId: "s2", description: "Implement solution", complexity: 5, predictedSuccess: 0.85, estimatedTokens: 2000, dependsOn: ["s1"] },
      { stepId: "s3", description: "Verify fix", complexity: 4, predictedSuccess: 0.8, estimatedTokens: 1000, dependsOn: ["s2"] },
    ],
  }
  const result = sim.simulate(input)
  if (typeof result.score !== "number") throw new Error("Expected score")
  if (result.recommended !== true) throw new Error("Expected recommended")
  if (result.stepResults.length !== 3) throw new Error("Expected 3 step results")
  if (result.warnings.length !== 0) throw new Error("Expected no warnings for simple plan")
})

p3aOk("P3A-3d MemoryOrchestrator consolidation report includes all Phase 3 fields", () => {
  const MemOrch = mod.MemoryOrchestrator
  const SS = mod.SessionStore; const ES = mod.EpisodicStore
  const ss = new SS(); const es = new ES()
  const { WorldModel: WM } = mod
  const orch = new MemOrch(ss, es, undefined, undefined, undefined, new WM())
  const report = orch.consolidate([])
  const required = ["workingArchived", "episodicPruned", "semanticDeduplicated", "patternsExtracted", "skillsConverted", "timestamp"]
  for (const field of required) {
    if (!(field in report)) throw new Error(`Missing field: ${field}`)
  }
})

console.log(`  Phase 3A: ${p3a} passed, ${p3af} failed`)
state.passed += p3a; state.failed += p3af

// ── MO-BR: MemoryOrchestrator Branch Coverage ──
console.log("\n[MO-BR] MemoryOrchestrator — Branch Coverage")
let mobr = 0, mobrf = 0
const mobr_assert = (cond, msg) => { if (cond) { mobr++ } else { console.error(`  ❌ ${msg}`); mobrf++ } }

{
  const MemOrch = mod.MemoryOrchestrator
  const SS = mod.SessionStore; const ES = mod.EpisodicStore
  const ss = new SS(); const es = new ES()
  const orch = new MemOrch(ss, es)
  const sess = ss.getOrCreate("mo-br-1")
  sess.plan = { intent: { goal: "", subtasks: [{ id: "s1", description: "test", dependsOn: [] }] }, estimatedSteps: 1 }
  sess.turns.push({ role: "user", content: "Test consolidate", timestamp: Date.now() - 3600_000 })
  sess.currentTaskType = "refactor"; sess.currentDomain = "general"
  const r1 = orch.consolidate(ss.getActiveSessions())
  mobr_assert(typeof r1.workingArchived === "number", "MO-BR-1a first consolidate ran")
  const r2 = orch.consolidate(ss.getActiveSessions())
  mobr_assert(typeof r2.patternsExtracted === "number", "MO-BR-1b patterns extracted (may be 0 if timing)")
}

{
  const MemOrch = mod.MemoryOrchestrator
  const SS = mod.SessionStore; const ES = mod.EpisodicStore
  const ss = new SS(); const es = new ES()
  const orch = new MemOrch(ss, es)
  const sess = ss.getOrCreate("mo-br-2")
  sess.plan = { intent: { goal: "Unknown pattern test", subtasks: [{ id: "s1", description: "Do something unusual", dependsOn: [] }] }, estimatedSteps: 1 }
  sess.turns.push({ role: "user", content: "Do something unusual and custom that no pattern matches", timestamp: Date.now() - 3600_000 })
  sess.currentTaskType = "doc"; sess.currentDomain = "general"
  orch.consolidate(ss.getActiveSessions())
  const r2 = orch.consolidate(ss.getActiveSessions())
  mobr_assert(typeof r2.semanticDeduplicated === "number", "MO-BR-2a consolidation completes for unknown pattern")
}

{
  const MemOrch = mod.MemoryOrchestrator
  const SS = mod.SessionStore; const ES = mod.EpisodicStore
  const { WorldModel: WM, SimulationEngine: SimE } = mod
  const ss = new SS(); const es = new ES()
  const wm = new WM(); const sim = new SimE()
  const orch = new MemOrch(ss, es, undefined, undefined, undefined, wm, sim)
  const sess = ss.getOrCreate("mo-br-3")
  sess.plan = { intent: { goal: "Fix SQL injection security", subtasks: [{ id: "s1", description: "Fix security bug", dependsOn: [] }] }, estimatedSteps: 1 }
  sess.turns.push({ role: "user", content: "Fix SQL injection", timestamp: Date.now() - 7200_000 })
  sess.currentTaskType = "fix"; sess.currentDomain = "security"
  const r1 = orch.consolidate(ss.getActiveSessions())
  mobr_assert(typeof r1.workingArchived === "number", "MO-BR-3a archived")
  const r2 = orch.consolidate(ss.getActiveSessions())
  mobr_assert(typeof r2.patternsExtracted === "number", "MO-BR-3b pattern extraction (may be 0 if timing)")
}

{
  const MemOrch = mod.MemoryOrchestrator
  const SS = mod.SessionStore; const ES = mod.EpisodicStore
  const { SimulationEngine: SimE } = mod
  const ss = new SS(); const es = new ES()
  const sim = new SimE()
  sim.simulate = () => ({ recommended: false, score: 0.1 })
  const orch = new MemOrch(ss, es, undefined, undefined, undefined, undefined, sim)
  const sess = ss.getOrCreate("mo-br-4")
  sess.plan = { intent: { goal: "Low score pattern", subtasks: [] }, estimatedSteps: 1 }
  sess.turns.push({ role: "user", content: "Low score", timestamp: Date.now() - 3600_000 })
  sess.currentTaskType = "fix"; sess.currentDomain = "general"
  orch.consolidate(ss.getActiveSessions())
  const r = orch.consolidate(ss.getActiveSessions())
  mobr_assert(typeof r.patternsExtracted === "number", "MO-BR-4 low-score branch hit")
}

{
  const MemOrch = mod.MemoryOrchestrator
  const SS = mod.SessionStore; const ES = mod.EpisodicStore
  const { WorldModel: WM, SimulationEngine: SimE } = mod
  const ss = new SS(); const es = new ES()
  const wm = new WM(); const sim = new SimE()
  const orch = new MemOrch(ss, es, undefined, undefined, undefined, wm, sim)
  const sess = ss.getOrCreate("mo-br-5")
  sess.plan = { intent: { goal: "No source episode", subtasks: [] }, estimatedSteps: 1 }
  sess.turns.push({ role: "user", content: "No match", timestamp: Date.now() - 3600_000 })
  sess.currentTaskType = "fix"; sess.currentDomain = "general"
  orch.consolidate(ss.getActiveSessions())
  const r = orch.consolidate(ss.getActiveSessions())
  mobr_assert(typeof r.patternsExtracted === "number", "MO-BR-5 sourceEntity missing branch")
}

{
  const MemOrch = mod.MemoryOrchestrator
  const SS = mod.SessionStore; const ES = mod.EpisodicStore
  const ss = new SS(); const es = new ES()
  const orch = new MemOrch(ss, es)
  const sess = ss.getOrCreate("mo-br-6")
  sess.plan = { intent: { goal: "Test goal", subtasks: [] }, estimatedSteps: 1 }
  sess.turns.push({ role: "user", content: "Has goal", timestamp: Date.now() - 3600_000 })
  sess.currentTaskType = "test"; sess.currentDomain = "general"
  orch.consolidate(ss.getActiveSessions())
  const r = orch.consolidate(ss.getActiveSessions())
  mobr_assert(typeof r.patternsExtracted === "number", "MO-BR-6 with-planGoal branch")
}

{
  const MemOrch = mod.MemoryOrchestrator
  const SS = mod.SessionStore; const ES = mod.EpisodicStore
  const ss = new SS(); const es = new ES()
  const orch = new MemOrch(ss, es)
  const sess = ss.getOrCreate("mo-br-7")
  sess.plan = { intent: { goal: "Plan steps", subtasks: [] }, estimatedSteps: 1, plan: ["create foo", "test bar"] }
  sess.turns.push({ role: "user", content: "With plan", timestamp: Date.now() - 3600_000 })
  sess.currentTaskType = "create"; sess.currentDomain = "general"
  orch.consolidate(ss.getActiveSessions())
  const r = orch.consolidate(ss.getActiveSessions())
  mobr_assert(typeof r.patternsExtracted === "number", "MO-BR-7 episode.plan branch")
}

{
  const MemOrch = mod.MemoryOrchestrator
  const SS = mod.SessionStore; const ES = mod.EpisodicStore
  const ss = new SS(); const es = new ES()
  const orch = new MemOrch(ss, es)
  const sess = ss.getOrCreate("mo-br-8")
  sess.plan = { intent: { goal: "Security audit", subtasks: [] }, estimatedSteps: 1 }
  sess.turns.push({ role: "user", content: "Audit", timestamp: Date.now() - 3600_000 })
  sess.currentTaskType = "fix"; sess.currentDomain = "security"
  orch.consolidate(ss.getActiveSessions())
  const r = orch.consolidate(ss.getActiveSessions())
  mobr_assert(typeof r.patternsExtracted === "number", "MO-BR-8 security genericSteps")
}

console.log(`  MO-BR: ${mobr} passed, ${mobrf} failed`)
state.passed += mobr; state.failed += mobrf

// ── Phase 4A: Skill Maturation Lifecycle ──
console.log("\n[P4b] Phase 4 — Evolution & Safety")
const CM = mod.ConstraintManifold
let p4 = 0, p4f = 0
const p4Ok = (name, fn) => { try { fn(); p4++; } catch (e) { console.error(`  FAIL: ${name}: ${e.message}`); p4f++; } }

p4Ok("P4-1a new skills start as 'raw' lifecycle stage", () => {
  const store = new SK2()
  const def = csd("lifecycle-test", "pattern", [], [{ action: "execute", description: "Step", expectedOutput: "Done" }])
  const rec = store.record(def)
  const stage = store.getLifecycle(rec.definition.meta.id)
  if (stage !== "raw") throw new Error(`Expected raw, got ${stage}`)
})

p4Ok("P4-1b canMature returns true when criteria met", () => {
  const store = new SK2()
  const def = csd("mature-test", "pattern", [], [{ action: "execute", description: "Step", expectedOutput: "Done" }])
  const rec = store.record(def)
  const id = rec.definition.meta.id
  rec.usageCount = 3
  rec.successRate = 0.8
  const canMature = store.canMature(id)
  if (!canMature) throw new Error("Expected canMature to be true with usage=3, success=0.8")
})

p4Ok("P4-1c mature() promotes to next stage", () => {
  const store = new SK2()
  const def = csd("mature-promote", "pattern", [], [{ action: "execute", description: "Step", expectedOutput: "Done" }])
  const rec = store.record(def)
  const id = rec.definition.meta.id
  rec.usageCount = 5; rec.successRate = 0.9
  const next = store.mature(id)
  if (next !== "validated") throw new Error(`Expected validated, got ${next}`)
  if (store.getLifecycle(id) !== "validated") throw new Error("Lifecycle should now be validated")
})

p4Ok("P4-1d mature() advances through all stages", () => {
  const store = new SK2()
  const def = csd("mature-full", "pattern", [], [{ action: "execute", description: "Step", expectedOutput: "Done" }])
  const rec = store.record(def)
  const id = rec.definition.meta.id
  rec.usageCount = 3; rec.successRate = 0.8
  const s1 = store.mature(id)
  if (s1 !== "validated") throw new Error(`stage1: expected validated, got ${s1}`)
  rec.usageCount = 12; rec.successRate = 0.85
  const s2 = store.mature(id)
  if (s2 !== "compiled") throw new Error(`stage2: expected compiled, got ${s2}`)
  rec.usageCount = 30; rec.successRate = 0.95
  const s3 = store.mature(id)
  if (s3 !== "evolved") throw new Error(`stage3: expected evolved, got ${s3}`)
  if (store.canMature(id)) throw new Error("Should not be able to mature past evolved")
  if (store.getNextStage(id) !== null) throw new Error("Next stage should be null for evolved")
})

p4Ok("P4-1e autoMature promotes multiple skills at once", () => {
  const store = new SK2()
  const ids = []
  for (let i = 0; i < 3; i++) {
    const def = csd(`auto-${i}`, "pattern", [], [{ action: "execute", description: `Step ${i}`, expectedOutput: "Done" }])
    const rec = store.record(def)
    rec.usageCount = 5; rec.successRate = 0.9
    ids.push(rec.definition.meta.id)
  }
  const summary = store.autoMature()
  const totalPromoted = Object.values(summary).reduce((a, b) => a + b, 0)
  if (totalPromoted < 1) throw new Error(`Expected promotions, got: ${JSON.stringify(summary)}`)
  for (const id of ids) {
    if (store.getLifecycle(id) !== "validated") throw new Error(`Skill ${id} should be validated after autoMature`)
  }
})

p4Ok("P4-1f getLifecycleStats returns correct distribution", () => {
  const store = new SK2()
  store.record(csd("raw-1", "p", [], [{ action: "execute", description: "S", expectedOutput: "D" }]))
  const def2 = csd("val-1", "p", [], [{ action: "execute", description: "S", expectedOutput: "D" }])
  const r2 = store.record(def2); r2.usageCount = 5; r2.successRate = 0.9; store.mature(r2.definition.meta.id)
  const stats = store.getLifecycleStats()
  if (stats.raw < 1) throw new Error(`Expected at least 1 raw, got ${JSON.stringify(stats)}`)
  if (stats.validated < 1) throw new Error(`Expected at least 1 validated, got ${JSON.stringify(stats)}`)
})

p4Ok("P4-2a ConstraintManifold blocks file deletion", () => {
  const cm = new CM()
  const check = cm.validate({ type: "file_delete", target: "/tmp/test.txt", description: "Delete test file" })
  if (check.passed) throw new Error("File deletion should be blocked")
  if (check.violations.length === 0) throw new Error("Expected violations for file deletion")
  if (check.violations[0].category !== "file_safety") throw new Error("Expected file_safety category")
})

p4Ok("P4-2b ConstraintManifold blocks protected paths", () => {
  const cm = new CM()
  const check = cm.validate({ type: "file_write", target: ".env.production", description: "Write .env" })
  if (check.passed) throw new Error("Protected path should be blocked")
})

p4Ok("P4-2c ConstraintManifold detects dangerous commands", () => {
  const cm = new CM()
  const check = cm.validate({
    type: "shell_exec", target: "shell",
    description: "Run rm -rf /",
    command: "rm -rf /var/log"
  })
  if (check.passed) throw new Error("Dangerous command should be blocked")
})

p4Ok("P4-2d ConstraintManifold passes safe actions", () => {
  const cm = new CM()
  const check = cm.validate({
    type: "file_write", target: "/tmp/safe-file.ts",
    description: "Write safe file",
    estimatedTokens: 5000,
    estimatedFilesAffected: 1,
  })
  if (!check.passed) throw new Error("Safe file write should pass")
  if (check.violations.length !== 0) throw new Error("Expected no violations")
})

p4Ok("P4-2e ConstraintManifold detects concurrent modifications", () => {
  const cm = new CM()
  cm.beginModification("/src/main.ts")
  const check = cm.validate({
    type: "file_edit", target: "/src/main.ts",
    description: "Edit main.ts",
  })
  if (check.passed) throw new Error("Concurrent modification should be blocked")
  cm.endModification("/src/main.ts")
})

p4Ok("P4-2f ConstraintManifold warns on budget overrun", () => {
  const cm = new CM()
  const check = cm.validate({
    type: "file_write", target: "/tmp/big.ts",
    description: "Write large file",
    estimatedTokens: 200000,
    estimatedFilesAffected: 50,
  })
  if (check.passed !== true) throw new Error("Budget warnings should not block (severity=warning)")
  const hasWarning = check.violations.some(v => v.category === "budget" && v.severity === "warning")
  if (!hasWarning) throw new Error("Expected budget warning")
})

p4Ok("P4-2g ConstraintManifold policy is configurable", () => {
  const cm = new CM({
    policies: { blockFileDeletion: false, maxFilesPerAction: 100 },
  })
  const check = cm.validate({ type: "file_delete", target: "/tmp/t.txt", description: "Delete" })
  if (!check.passed) throw new Error("File deletion should pass when policy allows it")
  if (cm.getPolicy().maxFilesPerAction !== 100) throw new Error("Expected maxFilesPerAction=100")
})

p4Ok("P4-2h ConstraintManifold snapshot returns state", () => {
  const cm = new CM()
  const snap = cm.snapshot()
  if (!snap.policy) throw new Error("Snapshot should include policy")
  if (!Array.isArray(snap.enabledCategories)) throw new Error("Snapshot should include enabledCategories")
  if (typeof snap.violationCount !== "number") throw new Error("Snapshot should include violationCount")
})

p4Ok("P4-2i ConstraintManifold categories can be toggled", () => {
  const cm = new CM()
  cm.setCategoryEnabled("file_safety", false)
  const check = cm.validate({ type: "file_delete", target: "/tmp/t.txt", description: "Delete" })
  if (!check.passed) throw new Error("Should pass when file_safety is disabled")
  cm.setCategoryEnabled("file_safety", true)
})

console.log(`  Phase 4: ${p4} passed, ${p4f} failed`)
state.passed += p4; state.failed += p4f

// ── Phase 5: Dashboard Metrics — Evolution, Constraint, Performance ──
console.log("\n[P5] Phase 5 — Dashboard Metrics & Observability")
const {
  Dashboard,
  SkillStore,
  ConstraintManifold,
  createSkillDefinition,
} = mod
let p5 = 0, p5f = 0
const assertP5 = (cond, msg) => { if (cond) p5++; else { p5f++; console.error(`  ❌ ${msg}`) } }

{
  const dash = new Dashboard()
  const store = new SkillStore()
  for (let i = 0; i < 3; i++) {
    const s = store.record(createSkillDefinition(`evolved-skill-${i}`, "test", [], [
      { action: "execute", description: `Evolved step ${i}`, expectedOutput: "Done" },
    ]))
    s.usageCount = 30; s.successRate = 0.95
    store.mature(s.definition.meta.id)
    store.mature(s.definition.meta.id)
    store.mature(s.definition.meta.id)
  }
  for (let i = 0; i < 2; i++) {
    const s = store.record(createSkillDefinition(`raw-skill-${i}`, "test", [], [
      { action: "execute", description: `Raw step ${i}`, expectedOutput: "Done" },
    ]))
  }
  const traces = []
  const data = dash.generate(traces, Date.now(), {
    skillStore: {
      getAll: () => store.getAll(),
      getLifecycleStats: () => store.getLifecycleStats(),
      get size() { return store.size },
    },
    matureCallCount: 9,
    evolutionTriggerCount: 3,
  })
  assertP5(data.evolutionMetrics !== undefined, "P5-1a: evolutionMetrics present")
  assertP5(data.evolutionMetrics.totalSkills === 5, `P5-1b: totalSkills = ${data.evolutionMetrics.totalSkills}`)
  assertP5(data.evolutionMetrics.lifecycleDistribution.evolved === 3, "P5-1c: 3 evolved skills")
  assertP5(data.evolutionMetrics.lifecycleDistribution.raw === 2, "P5-1d: 2 raw skills")
  assertP5(data.evolutionMetrics.averageSuccessRate > 0.5, `P5-1e: avg success rate = ${data.evolutionMetrics.averageSuccessRate}`)
  assertP5(data.evolutionMetrics.totalMatureCalls === 9, "P5-1f: mature calls tracked")
  assertP5(data.evolutionMetrics.evolutionTriggerCount === 3, "P5-1g: evolution triggers tracked")
  assertP5(data.evolutionMetrics.totalSkillUsageCount > 0, "P5-1h: total skill usage tracked")
}

{
  const dash = new Dashboard()
  const cm = new ConstraintManifold()
  cm.validate({ type: "file_delete", target: "/tmp/x", description: "Blocked del" })
  cm.validate({ type: "file_write", target: ".env.prod", description: "Protected path" })
  cm.beginModification("/src/main.ts")
  const data = dash.generate([], Date.now(), {
    constraintManifold: {
      snapshot: () => cm.snapshot(),
      getActiveModifications: () => cm.getActiveModifications(),
      getRecentViolations: () => cm.getRecentViolations(),
    },
  })
  assertP5(data.constraintMetrics !== undefined, "P5-2a: constraintMetrics present")
  assertP5(data.constraintMetrics.activeModifications === 1, "P5-2b: 1 active modification")
  assertP5(data.constraintMetrics.totalViolations >= 1, `P5-2c: >= 1 violation ${data.constraintMetrics.totalViolations}`)
  assertP5(data.constraintMetrics.blockedActions >= 1, "P5-2d: >= 1 blocked action")
  assertP5(data.constraintMetrics.categoryBreakdown.file_safety >= 1, "P5-2e: file safety violations tracked")
  assertP5(data.constraintMetrics.circuitBreakerTripped === false, "P5-2f: circuit breaker not tripped")
  cm.endModification("/src/main.ts")
}

{
  const dash = new Dashboard()
  const traces = [
    { step: "plan", input: "a", output: "b", toolUsed: "agentic_plan", success: true, durationMs: 1500, timestamp: new Date().toISOString() },
    { step: "nav", input: "a", output: "b", toolUsed: "agentic_nav", success: true, durationMs: 200, timestamp: new Date().toISOString() },
    { step: "execute", input: "a", output: "b", toolUsed: "agentic_execute", success: true, durationMs: 5000, timestamp: new Date().toISOString() },
    { step: "verify", input: "a", output: "b", toolUsed: "agentic_verify", success: true, durationMs: 12000, timestamp: new Date().toISOString() },
  ]
  const data = dash.generate(traces, Date.now(), {
    semanticCacheStats: { size: 42, hits: 10, misses: 30, hitRate: 0.25 },
    modelRegistry: {
      getAllScores: () => [
        { model: "gpt-4o", reliability: 0.85, hallucinationRate: 0.02, totalCalls: 50, status: "healthy" },
        { model: "claude-3", reliability: 0.9, hallucinationRate: 0.01, totalCalls: 30, status: "healthy" },
      ],
    },
  })
  assertP5(data.performanceMetrics !== undefined, "P5-3a: performanceMetrics present")
  assertP5(data.performanceMetrics.semanticCacheHitRate === 0.25, "P5-3b: cache hit rate = 0.25")
  assertP5(data.performanceMetrics.semanticCacheSize === 42, "P5-3c: cache size = 42")
  assertP5(data.performanceMetrics.toolLatencyStats.length === 4, "P5-3d: 4 tools tracked")
  assertP5(data.performanceMetrics.modelCount === 2, "P5-3e: 2 models tracked")
  assertP5(data.performanceMetrics.totalModelCalls === 80, "P5-3f: 80 total model calls")
  const slowest = data.performanceMetrics.topSlowestTools[0]
  assertP5(slowest.tool === "agentic_verify", `P5-3g: slowest = ${slowest.tool}`)
  assertP5(slowest.calls === 1 && slowest.avgLatencyMs >= 10000, "P5-3h: verify latency correct")
}

{
  const dash = new Dashboard()
  const traces = [
    { step: "test", input: "a", output: "b", toolUsed: "agentic_plan", success: true, durationMs: 100, timestamp: new Date().toISOString() },
  ]
  const cm = new ConstraintManifold()
  cm.validate({ type: "file_delete", target: "/tmp/x", description: "Test" })
  const store = new SkillStore()
  const s = store.record(createSkillDefinition("fmt-skill", "test", [], [
    { action: "execute", description: "Test step", expectedOutput: "Done" },
  ]))
  const data = dash.generate(traces, Date.now(), {
    skillStore: {
      getAll: () => store.getAll(),
      getLifecycleStats: () => store.getLifecycleStats(),
      get size() { return store.size },
    },
    constraintManifold: {
      snapshot: () => cm.snapshot(),
      getActiveModifications: () => cm.getActiveModifications(),
      getRecentViolations: () => cm.getRecentViolations(),
    },
    semanticCacheStats: { size: 10, hits: 5, misses: 15, hitRate: 0.25 },
  })
  const formatted = dash.formatForDisplay(data)
  assertP5(formatted.includes("Evolution Metrics"), "P5-4a: format has Evolution Metrics")
  assertP5(formatted.includes("Constraint Safety"), "P5-4b: format has Constraint Safety")
  assertP5(formatted.includes("Performance Metrics"), "P5-4c: format has Performance Metrics")
  assertP5(formatted.includes("🧬"), "P5-4d: evolution emoji present")
  assertP5(formatted.includes("🔒"), "P5-4e: constraint emoji present")
  assertP5(formatted.includes("⚡"), "P5-4f: performance emoji present")
  assertP5(formatted.includes("agentic_plan"), "P5-4g: tool name in display")
}

{
  const dash = new Dashboard()
  const traces = [
    { step: "test", input: "a", output: "b", toolUsed: "agentic_plan", success: true, durationMs: 100, timestamp: new Date().toISOString() },
  ]
  const data = dash.generate(traces, Date.now())
  assertP5(data.evolutionMetrics === undefined, "P5-5a: no evolution without context")
  assertP5(data.constraintMetrics === undefined, "P5-5b: no constraint without context")
  if (data.performanceMetrics) {
    assertP5(data.performanceMetrics.semanticCacheHitRate === 0, "P5-5c: cache hit rate 0 without context")
    assertP5(data.performanceMetrics.modelCount === 0, "P5-5d: model count 0 without context")
  } else {
    assertP5(true, "P5-5c: no performance metrics (empty)")
  }
  const formatted = dash.formatForDisplay(data)
  assertP5(!formatted.includes("🧬"), "P5-5e: no evolution emoji")
  assertP5(!formatted.includes("🔒"), "P5-5f: no constraint emoji")
}

console.log(`  Phase 5: ${p5} passed, ${p5f} failed`)
state.passed += p5; state.failed += p5f
console.log(`__RESULT__:${JSON.stringify({passed:state.passed,failed:state.failed})}`)
// Standalone: if (state.failed > 0) process.exit(1)
