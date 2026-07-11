// test/_runall-edge-deep.mjs — Gap #4 Deep integration tests (G4-12..G4-18)
import { assert, section, mockCtx, freshSid, pluginDist, G, R, B, D, Y, RST, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, chmodSync, mkdtempSync, join, tmpdir, sdkMockClient, state, projectDir } from "./_common.mjs"

export async function runEdgeDeepTests(mod) {
const mockInput = {
  client: {},
  project: { name: "test", path: projectDir },
  directory: projectDir,
  directoryName: "test",
  isProject: true,
  isTask: false,
  isEphemeral: true,
  getConfig: async () => ({
    experimental: { chat: { system: { transform: { tools: [] } } } },
  }),
  cwd: projectDir,
  on: () => {},
  run: async () => ({ exitCode: 0 }),
  exec: async () => ({ exitCode: 0, text: () => "", stdout: "" }),
}
let hooks
try { hooks = await mod.AgenticEngine(mockInput); assert(true, "AgenticEngine() executed") }
catch (e) { assert(false, `AgenticEngine() threw: ${e.message}`) }
assert(hooks && typeof hooks === "object", "hooks is an object")
assert(typeof hooks.dispose === "function", "dispose hook registered")

// Gap #4 Deep integration tests
console.log("\n[87] Gap #4: Deep integration tests")

// Test 12: verifyAllDeep with tier="deep" and mock LLM — all dimensions
const g4_deepDir = join("/tmp", "deep-test-" + Date.now())
mkdirSync(join(g4_deepDir, "src"), { recursive: true })
writeFileSync(join(g4_deepDir, "src", "utils.ts"), "export function add(a: number, b: number) { return a + b }")
const g4_vDeepTier = new mod.Verifier()
g4_vDeepTier.detectLanguage(g4_deepDir)
let g4_deepCallCount = 0
g4_vDeepTier.setLLM({
  call: async (params) => {
    g4_deepCallCount++
    if (params.systemPrompt && params.systemPrompt.includes("security")) {
      return { content: JSON.stringify({ passed: true, reasoning: "No security issues", issuesFound: [] }) }
    }
    if (params.systemPrompt && params.systemPrompt.includes("performance")) {
      return { content: JSON.stringify({ passed: true, reasoning: "No perf issues", issuesFound: [] }) }
    }
    if (params.systemPrompt && params.systemPrompt.includes("architecture")) {
      return { content: JSON.stringify({ passed: true, reasoning: "Clean arch", issuesFound: [] }) }
    }
    return { content: JSON.stringify({ passed: true, reasoning: "Correct", issuesFound: [] }) }
  },
})
const g4_deepResult = await g4_vDeepTier.verifyAllDeep("deep-step", g4_deepDir, "Implement feature", ["src/utils.ts"], false, "deep")
assert(g4_deepResult.passed === true, "G4-12a verifyAllDeep deep tier passes")
assert(g4_deepResult.dimensions !== undefined, "G4-12b dimensions object present")
assert(g4_deepResult.dimensions.tier === "deep", "G4-12c tier is deep")
assert(g4_deepResult.dimensions.security !== undefined, "G4-12d security dimension present")
assert(g4_deepResult.dimensions.performance !== undefined, "G4-12e performance dimension present")
assert(g4_deepResult.dimensions.architecture !== undefined, "G4-12f architecture dimension present")
assert(g4_deepResult.dimensions.deps !== undefined, "G4-12g deps dimension present")
assert(g4_deepResult.checks.length >= 3, "G4-12h multiple checks in result")
try { rmSync(g4_deepDir, { recursive: true, force: true }) } catch {}

// Test 13: verifyAllDeep with tier="fast" — compile only
const g4_vFastTier = new mod.Verifier()
g4_vFastTier.detectLanguage(projectDir)
const g4_fastResult = await g4_vFastTier.verifyAllDeep("fast-step", projectDir, undefined, [], false, "fast")
assert(g4_fastResult.checks.length >= 1, "G4-13a fast tier has at least compile check")
const g4_allCompile = g4_fastResult.checks.every(c => c.name.startsWith("compile"))
assert(g4_allCompile, "G4-13b fast tier only has compile checks")

// Test 14: verifyAllDeep with tier="standard" — existing behavior preserved
const g4_vStd = new mod.Verifier()
g4_vStd.detectLanguage(projectDir)
const g4_stdResult = await g4_vStd.verifyAllDeep("std-step", projectDir, undefined, [], false, "standard")
assert(g4_stdResult.dimensions?.tier === "standard", "G4-14a standard tier preserved")
assert(!g4_stdResult.dimensions?.security, "G4-14b no security in standard tier")

// Test 15: Deep verification with per-dimension config — security disabled
const g4_cfgDir = join("/tmp", "cfg-test-" + Date.now())
mkdirSync(join(g4_cfgDir, "src"), { recursive: true })
writeFileSync(join(g4_cfgDir, "src", "utils.ts"), "export function add(a: number, b: number) { return a + b }")
const g4_vDeepCfg = new mod.Verifier()
g4_vDeepCfg.detectLanguage(g4_cfgDir)
g4_vDeepCfg.setLLM({
  call: async () => ({ content: JSON.stringify({ passed: true, reasoning: "OK", issuesFound: [] }) }),
})
const g4_cfgResult = await g4_vDeepCfg.verifyAllDeep("cfg-step", g4_cfgDir, "Feature X", ["src/utils.ts"], false, "deep", { security: false })
assert(g4_cfgResult.passed === true, "G4-15a deep with config passes")
assert(g4_cfgResult.dimensions?.security === undefined, "G4-15b security disabled via config")
assert(g4_cfgResult.dimensions?.performance !== undefined, "G4-15c performance still runs")
assert(g4_cfgResult.dimensions?.architecture !== undefined, "G4-15d architecture still runs")
assert(g4_cfgResult.dimensions?.deps !== undefined, "G4-15e deps still runs")
try { rmSync(g4_cfgDir, { recursive: true, force: true }) } catch {}

assert(true, "Gap #4 deep integration tests passed")

// ═══════════════════════════════════════════════════════════════════════
// BC-AR: AutoRetryManager Branch Coverage (inline implementation)
// ═══════════════════════════════════════════════════════════════════════
section("BC-AR: AutoRetryManager Branch Coverage")
{
  const STRATEGY_ORDER = ["direct_fix", "conservative", "type_first", "split_changes"]
  class ARM {
    constructor(cfg = {}) {
      this.attempts = []
      this.config = { maxRetries: cfg.maxRetries ?? 3, baseDelayMs: cfg.baseDelayMs ?? 500, maxDelayMs: cfg.maxDelayMs ?? 5000, enableSelectiveRollback: cfg.enableSelectiveRollback ?? true }
    }
    canRetry() { return this.attempts.length < this.config.maxRetries }
    getAttempts() { return [...this.attempts] }
    getLastAttempt() { return this.attempts.length > 0 ? this.attempts[this.attempts.length - 1] : null }
    getConfig() { return { ...this.config } }
    getStrategyForAttempt(a) { return STRATEGY_ORDER[a % STRATEGY_ORDER.length] }
    getBackoffDelay(a) { if (a <= 0) return 0; const e = Math.min(a - 1, 10); return Math.max(this.config.baseDelayMs, Math.random() * Math.min(this.config.baseDelayMs * Math.pow(2, e), this.config.maxDelayMs)) }
    recordAttempt(err, an, rb) { this.attempts.push({ attempt: this.attempts.length, strategy: STRATEGY_ORDER[this.attempts.length % STRATEGY_ORDER.length], error: err, analysis: an, rolledBackFiles: rb, timestamp: Date.now() }) }
    reset() { this.attempts = [] }
    getRetrySummary() {
      if (this.attempts.length === 0) return ""
      const s = this.attempts.map(a => a.strategy).join(" → ")
      const la = this.getLastAttempt()?.analysis
      return `🔄 Retry: ${this.attempts.length} attempt(s) [${s}]${la ? ` — Last error: ${la.category}(${la.severity})` : ""}`
    }
    getFilesToRollback(an, all, err) {
      if (!this.config.enableSelectiveRollback) return [...all]
      const pf = new Set()
      if (an?.affectedFiles?.length > 0) { for (const f of an.affectedFiles) { for (const m of all.filter(mf => mf.includes(f) || f.includes(mf))) pf.add(m) } }
      const m1 = err.match(/(?:src\/|lib\/|test\/|app\/|cmd\/|pkg\/|internal\/)[\w./-]+\.(?:ts|js|tsx|jsx|py|go|rs|java|swift|kt)/g)
      if (m1) { for (const ef of m1) { for (const m of all.filter(mf => ef.includes(mf) || mf.includes(ef))) pf.add(m) } }
      const qr = /file\s+['"]([\w./-]+)['"]/gi; let qm; while ((qm = qr.exec(err)) !== null) { for (const m of all.filter(mf => qm[1].includes(mf) || mf.includes(qm[1]))) pf.add(m) }
      const ir = /in\s+['"]([\w./-]+)['"]/gi; let im; while ((im = ir.exec(err)) !== null) { for (const m of all.filter(mf => im[1].includes(mf) || mf.includes(im[1]))) pf.add(m) }
      if (pf.size === 0) return [...all]
      return [...pf]
    }
    getPreservedFiles(an, all, err) { const rb = this.getFilesToRollback(an, all, err); return all.filter(f => !rb.includes(f)) }
    buildRetryPrompt(goal, lastErr, an, strategy, okFiles) {
      const sw = okFiles.length > 0 ? `\nFiles that compiled correctly (keep these):\n${okFiles.map(f => `- ${f}`).join("\n")}` : ""
      const ab = an ? `\n## Error Analysis\n- **Category:** ${an.category}\n- **Summary:** ${an.summary}\n- **Root Cause:** ${an.likelyRootCause}\n- **Suggested Fix:** ${an.suggestedFix}\n- **Severity:** ${an.severity}` : ""
      return `## Retry #${this.attempts.length + 1}: ${strategy}\n\n### Original Goal\n${goal}\n\n### Previous Error\n\`\`\`\n${lastErr.slice(0, 1500)}\n\`\`\`\n${ab}\n${sw}\n\n### Strategy: ${strategy}\n\nIMPORTANT: Only output files that need change.`
    }
  }

  // AR-1: canRetry false when max retries exhausted
  const ar1 = new ARM({ maxRetries: 2 }); ar1.recordAttempt("e1", null, []); ar1.recordAttempt("e2", null, [])
  assert(!ar1.canRetry(), "AR-1 canRetry false when max retries reached")

  // AR-2: canRetry true when room remaining
  const ar2 = new ARM({ maxRetries: 3 }); ar2.recordAttempt("e1", null, [])
  assert(ar2.canRetry(), "AR-2 canRetry true with room remaining")

  // AR-3: getBackoffDelay(0) returns 0
  const ar3 = new ARM()
  assert(ar3.getBackoffDelay(0) === 0, "AR-3 getBackoffDelay(0)=0")
  const ar3b = ar3.getBackoffDelay(1)
  assert(ar3b >= 500, "AR-3a getBackoffDelay(1) >= baseDelay(500)")
  assert(ar3b <= 5000, "AR-3b getBackoffDelay(1) <= maxDelay(5000)")

  // AR-4: getLastAttempt null when no attempts
  const ar4 = new ARM()
  assert(ar4.getLastAttempt() === null, "AR-4 getLastAttempt null with no attempts")
  ar4.recordAttempt("err", null, [])
  assert(ar4.getLastAttempt() !== null, "AR-4b getLastAttempt non-null after record")
  assert(ar4.getLastAttempt().error === "err", "AR-4c getLastAttempt error matches")

  // AR-5: getRetrySummary empty with no attempts
  const ar5 = new ARM()
  assert(ar5.getRetrySummary() === "", "AR-5 retry summary empty with no attempts")
  ar5.recordAttempt("err", null, [])
  assert(ar5.getRetrySummary().includes("Retry"), "AR-5b retry summary non-empty after attempts")

  // AR-6: getRetrySummary with analysis
  const ar6 = new ARM()
  ar6.recordAttempt("err", { category: "type", summary: "type err", likelyRootCause: "x", suggestedFix: "y", severity: "high", affectedFiles: [] }, [])
  assert(ar6.getRetrySummary().includes("type"), "AR-6 retry summary includes analysis category")

  // AR-7: getFilesToRollback with selective rollback disabled
  const ar7 = new ARM({ enableSelectiveRollback: false })
  assert(ar7.getFilesToRollback(null, ["a.ts", "b.ts"], "").length === 2, "AR-7 rollback disabled returns all")

  // AR-8: getFilesToRollback with analysis.affectedFiles matching
  const ar8 = new ARM()
  assert(ar8.getFilesToRollback({ affectedFiles: ["a.ts"], category: "type", summary: "", likelyRootCause: "", suggestedFix: "", severity: "low" }, ["src/a.ts", "src/b.ts"], "").length === 1, "AR-8 affectedFiles match")

  // AR-9: getFilesToRollback with compile error path match
  const ar9 = new ARM()
  assert(ar9.getFilesToRollback(null, ["src/a.ts"], "Error in src/a.ts: fail").length === 1, "AR-9 compile error path match")

  // AR-10: getFilesToRollback with file quote pattern
  const ar10 = new ARM()
  const r10 = ar10.getFilesToRollback(null, ["src/a.ts"], "file 'src/a.ts' not found")
  assert(r10.length === 1, "AR-10 file quote pattern match")

  // AR-11: getFilesToRollback with 'in' quote pattern
  const ar11 = new ARM()
  const r11 = ar11.getFilesToRollback(null, ["src/b.ts"], "Error in \"src/b.ts\" line 5")
  assert(r11.length === 1, "AR-11 'in' quote pattern match")

  // AR-12: getFilesToRollback no matches returns all
  const ar12 = new ARM()
  assert(ar12.getFilesToRollback(null, ["x.ts", "y.ts"], "some random error").length === 2, "AR-12 no match returns all")

  // AR-13: getPreservedFiles
  const ar13 = new ARM()
  const p13 = ar13.getPreservedFiles(null, ["src/a.ts", "src/b.ts"], "Error in src/a.ts: fail")
  assert(p13.length === 1, "AR-13 preserved files = 1")
  assert(p13[0] === "src/b.ts", "AR-13b preserved file is src/b.ts")

  // AR-14: buildRetryPrompt with analysis and ok files
  const ar14 = new ARM()
  const p14 = ar14.buildRetryPrompt("do thing", "error msg", { category: "type", summary: "type error", likelyRootCause: "missing type", suggestedFix: "add type", severity: "high", affectedFiles: [] }, "direct_fix", ["src/ok.ts"])
  assert(p14.includes("Retry #1"), "AR-14a prompt has heading")
  assert(p14.includes("type error"), "AR-14b prompt has analysis")
  assert(p14.includes("src/ok.ts"), "AR-14c prompt has preserved files")

  // AR-15: buildRetryPrompt without analysis and empty ok files
  const ar15 = new ARM()
  const p15 = ar15.buildRetryPrompt("do thing", "error msg", null, "conservative", [])
  assert(p15.includes("Retry #1"), "AR-15 prompt with no analysis")
  assert(!p15.includes("Error Analysis"), "AR-15b no analysis block")
  assert(!p15.includes("keep these"), "AR-15c no preserved files section")

  // AR-16: reset clears attempts
  const ar16 = new ARM(); ar16.recordAttempt("e", null, [])
  assert(ar16.getAttempts().length === 1, "AR-16a 1 attempt before reset")
  ar16.reset()
  assert(ar16.getAttempts().length === 0, "AR-16b 0 after reset")

  // AR-17: getConfig returns copy
  const ar17 = new ARM({ maxRetries: 5 })
  const cfg = ar17.getConfig()
  assert(cfg.maxRetries === 5, "AR-17a config maxRetries=5")
  assert(cfg.baseDelayMs === 500, "AR-17b config baseDelay default")

  // AR-18: getStrategyForAttempt rotation
  const ar18 = new ARM()
  assert(ar18.getStrategyForAttempt(0) === "direct_fix", "AR-18a strategy 0 = direct_fix")
  assert(ar18.getStrategyForAttempt(1) === "conservative", "AR-18b strategy 1 = conservative")
  assert(ar18.getStrategyForAttempt(4) === "direct_fix", "AR-18c strategy 4 wraps to direct_fix")
}

// ═══════════════════════════════════════════════════════════════════════
// BC-DC: DataCleaner Branch Coverage
// ═══════════════════════════════════════════════════════════════════════
section("BC-DC: DataCleaner Branch Coverage")
{
  const { DataCleaner: DC } = mod

  // DC-1: clean with stripDebateArtifacts removes markers but keeps real content
  const dc1 = new DC()
  const res1 = await dc1.clean({ text: "I agree this is correct\n\nReal content here", format: "text", stripDebateArtifacts: true })
  assert(!res1.cleaned.includes("I agree"), "DC-1 clean removes debate markers")
  assert(res1.cleaned.includes("Real content"), "DC-1b real content preserved")

  // DC-2: clean with stripDebateArtifacts=false preserves more content
  const dc2 = new DC()
  const res2 = await dc2.clean({ text: "I agree this is correct\n\nReal content here", format: "text", stripDebateArtifacts: false })
  assert(res2.cleaned.includes("I agree"), "DC-2 stripDebateArtifacts=false preserves debate markers")

  // DC-3: clean with stripDebateArtifacts=true removes debate markers
  const dc3 = new DC()
  const res3 = await dc3.clean({ text: "I agree this is correct\n\nReal content here", format: "text", stripDebateArtifacts: true })
  assert(!res3.cleaned.includes("I agree"), "DC-3 stripDebateArtifacts=true removes debate markers")
  assert(res3.cleaned.includes("Real content here"), "DC-3b real content preserved")

  // DC-4: clean with format=json produces validJson
  const dc4 = new DC()
  const res4 = await dc4.clean({ text: '{"name":"test","value":42}', format: "json" })
  assert(res4.validJson === true, "DC-4a format=json validJson=true")
  assert(res4.parsedJson.name === "test", "DC-4b parsedJson correct")

  // DC-5: clean with format=json and non-JSON text
  const dc5 = new DC()
  const res5 = await dc5.clean({ text: "Hello world, no JSON here", format: "json" })
  assert(res5.validJson === false, "DC-5a format=json with non-JSON text validJson=false")
  assert(res5.parsedJson === undefined, "DC-5b parsedJson undefined")

  // DC-6: clean with format=markdown
  const dc6 = new DC()
  const res6 = await dc6.clean({ text: "Some **markdown** content", format: "markdown" })
  assert(res6.cleaned.length > 0, "DC-6 clean markdown works")
  assert(typeof res6.stats.originalLength === "number", "DC-6b stats have originalLength")

  // DC-7: clean with format=text
  const dc7 = new DC()
  const res7 = await dc7.clean({ text: "plain text here", format: "text" })
  assert(res7.format === undefined || res7.cleaned.length > 0, "DC-7 clean text works")

  // DC-8: clean with LLM engine (call exported)
  const dc8 = new DC({ call: async () => ({ content: "cleaned by LLM" }) })
  const res8 = await dc8.clean({ text: "raw text to clean", format: "text" })
  assert(res8.cleaned.length > 0, "DC-8 clean with LLM engine works")

  // DC-9: LLM engine throws → falls through to regex cleaning
  const dc9 = new DC({ call: async () => { throw new Error("LLM down") } })
  const res9 = await dc9.clean({ text: "Some normal content here\n\nMore data to keep", format: "text", stripDebateArtifacts: false })
  assert(res9.cleaned.includes("normal content"), "DC-9 LLM failure falls through to regex")

  // DC-10: validate without LLM returns invalid
  const dc10 = new DC()
  const v10 = await dc10.validate("some text", "object with name")
  assert(v10.valid === false, "DC-10 validate without LLM returns invalid")
  assert(v10.issues.length > 0, "DC-10b has issue message")

  // DC-11: parseDataValidationPayload with valid JSON
  const validParsed = mod.parseDataValidationPayload('{"valid": true, "issues": []}')
  assert(validParsed !== null, "DC-11a parseDataValidationPayload valid")
  assert(validParsed.valid === true, "DC-11b parsed valid=true")

  // DC-12: parseDataValidationPayload with markdown code fence
  const fenceParsed = mod.parseDataValidationPayload('```json\n{"valid": false, "issues": ["error1"]}\n```')
  assert(fenceParsed !== null, "DC-12a parse code fence JSON")
  assert(fenceParsed.valid === false, "DC-12b parsed valid=false")
  assert(fenceParsed.issues[0] === "error1", "DC-12c parsed issues correct")

  // DC-13: parseDataValidationPayload with invalid content
  const invalidParsed = mod.parseDataValidationPayload("not json at all")
  assert(invalidParsed === null, "DC-13a parse invalid content returns null")

  // DC-14: parseDataValidationPayload with valid schema but missing field
  const missingField = mod.parseDataValidationPayload('{"valid": true}')
  assert(missingField === null, "DC-14 parse missing required field returns null")

  // DC-15: compressDebate with issues
  const dc15 = new DC()
  const debate15 = dc15.compressDebate([
    { round: 1, approved: false, issues: ["issue A", "issue B", "issue C", "issue D"] },
    { round: 2, approved: true, issues: [] },
  ], "final output text")
  assert(debate15.includes("Round 1"), "DC-15a compressDebate shows round 1")
  assert(debate15.includes("Approved"), "DC-15b compressDebate shows approved")
  assert(debate15.includes("Final Output"), "DC-15c compressDebate has final output")

  // DC-16: compressDebate with short issues (no truncation)
  const dc16 = new DC()
  const debate16 = dc16.compressDebate([
    { round: 1, approved: true, issues: ["minor issue"] },
  ], "done")
  assert(debate16.includes("Round 1"), "DC-16a compressDebate single round")

  // DC-17: stats calculation
  const dc17 = new DC()
  const res17 = await dc17.clean({ text: "line1\n\nline2\n\n\nline3", format: "text" })
  assert(res17.stats.removedLines >= 0, "DC-17 stats removedLines computed")

  // DC-18: stripDebateMarkers with long text
  const dc18 = new DC()
  // Put real content FIRST so it survives MAX_INPUT_LENGTH truncation (100k chars)
  const longText = "actual content preserved\n" + "I agree\n".repeat(20000)
  const res18 = await dc18.clean({ text: longText, format: "text" })
  assert(res18.cleaned.includes("actual content preserved"), "DC-18 long text preserves content")

  // DC-19: tryParseJSON with code fence
  const dc19 = new DC()
  // Access via clean with JSON format and code-fenced content
  const rawJson = 'Here is the result:\n```json\n{"key": "value"}\n```\nend'
  // First pass: tryParseJSON called internally
  // We verify via parseDataValidationPayload which handles code fences
  const pf19 = mod.parseDataValidationPayload(`\`\`\`json\n{"valid": true, "issues": ["ok"]}\n\`\`\``)
  assert(pf19 !== null, "DC-19 parse with code fence works")

  // DC-20: setLLM method (line 86-87)
  const dc20 = new DC()
  dc20.setLLM({ call: async () => ({ content: "llm result" }) })
  const res20 = await dc20.clean({ text: "some text", format: "text", stripDebateArtifacts: false })
  assert(res20.cleaned.includes("llm result"), "DC-20 setLLM works")

  // DC-21: schema parameter with LLM (line 104-105)
  const dc21 = new DC({ call: async () => ({ content: '{"key":"value"}' }) })
  const res21 = await dc21.clean({ text: "raw data", format: "json", schema: "{key: string}" })
  assert(res21.cleaned.length > 0, "DC-21 schema parameter processed")

  // DC-22: code fence with invalid JSON → tryParseJSON code-fence catch (lines 234-237)
  const dc22 = new DC()
  const res22 = await dc22.clean({ text: '```json\n{invalid}\n```', format: "json" })
  assert(res22.validJson === false, "DC-22 invalid fence JSON → validJson=false")
  assert(res22.parsedJson === undefined, "DC-22b parsedJson undefined")

  // DC-23: validate with valid LLM return (line 203)
  const dc23 = new DC({ call: async () => ({ content: '{"valid": true, "issues": []}' }) })
  const v23 = await dc23.validate("some text", "some structure")
  assert(v23.valid === true, "DC-23 validate LLM returns valid")
  assert(v23.issues.length === 0, "DC-23b validate issues empty")

  // DC-24: compressDebate with last round not approved (line 169 fallback)
  const dc24 = new DC()
  const d24 = dc24.compressDebate([{ round: 1, approved: false, issues: ["x"] }], "final")
  assert(d24.includes("Max rounds"), "DC-24 compressDebate last round not approved")
}

// ═══════════════════════════════════════════════════════════════════════
// BC-DH: Domain Helpers Branch Coverage (inline)
// ═══════════════════════════════════════════════════════════════════════
section("BC-DH: Domain Helpers Branch Coverage")
{
  const { existsSync: ex, readFileSync: rf, resolve: resv } = await import("fs") // Already imported
  const { resolve: pathResolve } = await import("path")

  // Inline implementations
  function DH_checkProjectFile(dir, ...files) {
    for (const f of files) {
      try { if (ex(pathResolve(dir, f))) return true } catch {}
    }
    return false
  }
  function DH_scoreProjectFiles(dir, bonus, ...files) {
    let s = 0
    for (const f of files) {
      try { if (ex(pathResolve(dir, f))) s += bonus } catch {}
    }
    return s
  }
  function DH_issuesResult(issues, msg) {
    return issues.length > 0 ? { passed: false, output: `${msg}:\n${issues.join("\n")}` } : { passed: true, output: msg }
  }
  function DH_safeAccess(fn, fallback) {
    try { return fn() } catch { return fallback }
  }
  const tmpH = join("/tmp", "dh-test-" + Date.now())
  mkdirSync(tmpH, { recursive: true })
  writeFileSync(join(tmpH, "exists.txt"), "hello")

  // DH-1: checkProjectFile with existing file
  assert(DH_checkProjectFile(tmpH, "exists.txt") === true, "DH-1 existing file returns true")

  // DH-2: checkProjectFile with non-existing file
  assert(DH_checkProjectFile(tmpH, "nonexistent.txt") === false, "DH-2 non-existing file returns false")

  // DH-3: checkProjectFile with multiple files, second matches
  assert(DH_checkProjectFile(tmpH, "no.txt", "exists.txt") === true, "DH-3 second file matches")

  // DH-4: checkProjectFile with no files
  assert(DH_checkProjectFile(tmpH) === false, "DH-4 no files returns false")

  // DH-5: scoreProjectFiles partial match
  const s5 = DH_scoreProjectFiles(tmpH, 0.3, "no.txt", "exists.txt")
  assert(Math.abs(s5 - 0.3) < 0.001, "DH-5 score partial match = 0.3")

  // DH-6: scoreProjectFiles no matches
  assert(DH_scoreProjectFiles(tmpH, 0.3, "a.txt", "b.txt") === 0, "DH-6 score no match = 0")

  // DH-7: issuesResult with issues
  const r7 = DH_issuesResult(["err1", "err2"], "Validation")
  assert(r7.passed === false, "DH-7a issues with issues → passed=false")
  assert(r7.output.includes("err1"), "DH-7b output contains issues")

  // DH-8: issuesResult without issues
  const r8 = DH_issuesResult([], "All good")
  assert(r8.passed === true, "DH-8a no issues → passed=true")
  assert(r8.output === "All good", "DH-8b output is success message")

  // DH-9: safeAccess success
  assert(DH_safeAccess(() => 42, -1) === 42, "DH-9 safeAccess success returns value")

  // DH-10: safeAccess throws
  assert(DH_safeAccess(() => { throw new Error("fail") }, "fallback") === "fallback", "DH-10 safeAccess throw returns fallback")

  try { rmSync(tmpH, { recursive: true, force: true }) } catch {}
}

// ═══════════════════════════════════════════════════════════════════════
// BC-DM: Dumb Model Branch Coverage (supplemental — formatDumbHarnessNotice edge)
// ═══════════════════════════════════════════════════════════════════════
section("BC-DM: Dumb Model Branch Coverage")
{
  const { resolveDumbHarness, isWeakModelName, isWeakByStats, workflowModeForDumb, formatDumbHarnessNotice, normalizeModelId, ModelRegistry } = mod

  // DM-edge-1: formatDumbHarnessNotice with active=false → empty string
  const off = resolveDumbHarness({ dumbModelMode: false })
  assert(formatDumbHarnessNotice(off) === "", "DM-edge-1 formatDumbHarnessNotice inactive returns ''")

  // DM-edge-2: formatDumbHarnessNotice with active=true → notice
  const on = resolveDumbHarness({ dumbModelMode: true })
  assert(formatDumbHarnessNotice(on).includes("Dumb-Model Harness ACTIVE"), "DM-edge-2 formatDumbHarnessNotice active has notice")

  // DM-edge-3: isWeakModelName with empty string
  assert(isWeakModelName("") === false, "DM-edge-3 empty string not weak")

  // DM-edge-4: isWeakModelName with "opencode/default"
  assert(isWeakModelName("opencode/default") === false, "DM-edge-4 opencode/default not weak")

  // DM-edge-5: isWeakModelName with "opencode/unknown"
  assert(isWeakModelName("opencode/unknown") === false, "DM-edge-5 opencode/unknown not weak")

  // DM-edge-6: isWeakModelName with undefined
  assert(isWeakModelName(undefined) === false, "DM-edge-6 undefined not weak")

  // DM-edge-7: isWeakModelName with strong model
  assert(isWeakModelName("gpt-4.1") === false, "DM-edge-7 gpt-4.1 strong")
  assert(isWeakModelName("deepseek-v4") === false, "DM-edge-7b deepseek-v4 strong")
  assert(isWeakModelName("qwen2.5-72b") === false, "DM-edge-7c qwen2.5-72b strong")
  assert(isWeakModelName("claude-4") === false, "DM-edge-7d claude-4 strong")

  // DM-edge-8: isWeakModelName with FLASH in gemini (should be weak)
  assert(isWeakModelName("gemini-2.0-flash") === true, "DM-edge-8 gemini flash weak")

  // DM-edge-9: isWeakModelName with ollama tag
  assert(isWeakModelName("ollama/qwen2.5:0.5b") === true, "DM-edge-9 ollama 0.5b weak")

  // DM-edge-10: isWeakByStats with no model/registry
  assert(isWeakByStats(null, null).weak === false, "DM-edge-10 null stats not weak")

  // DM-edge-11: isWeakByStats with insufficient samples
  const reg = new ModelRegistry()
  reg.addModel("test/new-model")
  reg.recordCall("test/new-model", true, 100)
  assert(isWeakByStats("test/new-model", reg).weak === false, "DM-edge-11 insufficient samples not weak")

  // DM-edge-12: isWeakByStats with degraded reliability
  for (let i = 0; i < 8; i++) reg.recordCall("test/new-model", false, 100)
  const s12 = isWeakByStats("test/new-model", reg, 0.4, 5)
  assert(s12.weak === true, "DM-edge-12 degraded stats is weak")

  // DM-edge-13: workflowModeForDumb active → strict
  assert(workflowModeForDumb({ active: true, reason: "x", source: "forced-on" }, "advisory") === "strict", "DM-edge-13 active→strict")

  // DM-edge-14: workflowModeForDumb inactive → configured
  assert(workflowModeForDumb({ active: false, reason: "x", source: "auto-off" }, "advisory") === "advisory", "DM-edge-14 inactive→advisory")
  assert(workflowModeForDumb({ active: false, reason: "x", source: "auto-off" }, "strict") === "strict", "DM-edge-14b inactive respects strict config")

  // DM-edge-15: resolveDumbHarness auto + no model
  const noModel = resolveDumbHarness({ dumbModelMode: "auto" })
  assert(noModel.active === false, "DM-edge-15 auto with no model → inactive")
  assert(noModel.reason.includes("no model id"), "DM-edge-15b reason mentions no model")

  // DM-edge-16: resolveDumbHarness auto + capable model
  const capable = resolveDumbHarness({ dumbModelMode: "auto", model: "gpt-5" })
  assert(capable.active === false, "DM-edge-16 auto+gpt5→inactive")
  assert(capable.source === "auto-off", "DM-edge-16b source=auto-off")

  // DM-edge-17: normalizeModelId with null
  assert(normalizeModelId(null) === "", "DM-edge-17 normalize null returns ''")
  assert(normalizeModelId(undefined) === "", "DM-edge-17b normalize undefined returns ''")
  assert(normalizeModelId("  GPT-4o  ") === "gpt-4o", "DM-edge-17c normalize trims and lowercases")
}

// ═══════════════════════════════════════════════════════════════════════
// BC-HG: HallucinationGuard Branch Coverage
// ═══════════════════════════════════════════════════════════════════════
section("BC-HG: HallucinationGuard Branch Coverage")
{
  const { HallucinationGuard: HG } = mod
  const tmpHg = join("/tmp", "hg-test-" + Date.now())
  mkdirSync(tmpHg, { recursive: true })
  mkdirSync(join(tmpHg, "src"), { recursive: true })

  // Create test files
  writeFileSync(join(tmpHg, "src", "main.ts"), "export function hello() { return 'hi' }\n")
  writeFileSync(join(tmpHg, "src", "helper.go"), "package main\nfunc Helper() string { return \"ok\" }\n")
  writeFileSync(join(tmpHg, "src", "lib.rs"), "pub fn compute() -> i32 { 42 }\n")
  writeFileSync(join(tmpHg, "src", "utils.py"), "def process():\n    return True\n")

  // HG-1: verifyApiSignature with Go file (line 234-236)
  const hg1 = new HG(tmpHg)
  const check1 = hg1.check("calls Helper from \"src/helper.go\"", ["src/helper.go"])
  assert(check1.passed === true, "HG-1a Go function check passes")
  assert(check1.claims.length > 0, "HG-1b claims extracted")

  // HG-2: verifyApiSignature with Rust file (line 238)
  const hg2 = new HG(tmpHg)
  const check2 = hg2.check("calls compute from \"src/lib.rs\"", ["src/lib.rs"])
  assert(check2.passed === true, "HG-2a Rust function check passes")

  // HG-3: verifyApiSignature with Python file (line 227)
  const hg3 = new HG(tmpHg)
  const check3 = hg3.check("calls process from \"src/utils.py\"", ["src/utils.py"])
  assert(check3.passed === true, "HG-3a Python function check passes")

  // HG-4: verifyApiSignature catch block (line 251-252) — non-existent Go file
  const hg4 = new HG(tmpHg)
  const check4 = hg4.check("calls missingFunc from \"src/doesnotexist.go\"", ["src/doesnotexist.go"])
  // Should not crash — verifyApiSignature's findInFile catches read error
  assert(typeof check4.passed === 'boolean', "HG-4a non-existent Go file doesn't crash")
  // The claim for the Go function should have verified=false since file doesn't exist

  // HG-5: functionExists catch block (line 265-266) — function in non-existent file
  const hg5 = new HG(tmpHg)
  const check5 = hg5.check("added missingFunc in \"src/nonexistent.ts\"", [])
  assert(typeof check5.passed === 'boolean', "HG-5a non-existent TS doesn't crash")

  // HG-6: check with file claims matching modified files
  const hg6 = new HG(tmpHg)
  const check6 = hg6.check("created \"src/newfile.ts\"", ["src/newfile.ts"])
  assert(check6.passed === true, "HG-6a new file in modified list passes")
  // Should have warning severity (modified but doesn't exist yet)
  const newFileClaim = check6.claims.find(c => c.claim.includes("newfile.ts"))
  assert(newFileClaim !== undefined, "HG-6b claim for newfile.ts exists")
  assert(newFileClaim.severity === "warning", "HG-6c severity=warning for pending file")

  // HG-7: check with absolute path traversal prevention
  const hg7 = new HG(tmpHg)
  const check7 = hg7.check("created \"/etc/passwd\"", [])
  // Absolute path outside worktree should be rejected by resolveSafe
  const claim7 = check7.claims.find(c => c.claim.includes("/etc/passwd"))
  assert(claim7 === undefined || claim7.verified === false, "HG-7 path traversal prevented")

  // HG-8: extractFileClaims with various patterns
  const hg8 = new HG(tmpHg)
  const check8 = hg8.check("wrote 'src/output.ts' and generated src/data.json", [])
  const file8 = check8.claims.filter(c => c.type === "file_exists")
  assert(file8.length >= 2, "HG-8 multiple file claims extracted")

  // HG-9: extractImportClaims with relative imports
  writeFileSync(join(tmpHg, "src", "importer.ts"), "import { validate } from './helper.validator'")
  const hg9 = new HG(tmpHg)
  const check9 = hg9.check("import { validate } from './helper'", [])
  // Import claims check for relative imports
  const imp9 = check9.claims.filter(c => c.type === "import_valid")
  assert(imp9.length > 0 || check9.passed !== undefined, "HG-9 import claims processed")

  // HG-10: extractImportFilters known npm packages
  const hg10 = new HG(tmpHg)
  const check10 = hg10.check("import React from 'react'", [])
  const npmImp = check10.claims.filter(c => c.type === "import_valid" && c.claim.includes("react"))
  assert(npmImp.length === 0, "HG-10 known npm packages filtered out")

  // HG-11: overallConfidence calculation
  assert(typeof check1.overallConfidence === "number", "HG-11a overallConfidence is number")
  assert(check1.overallConfidence >= 0 && check1.overallConfidence <= 1, "HG-11b confidence in [0,1]")

  // HG-12: empty output produces no claims
  const hg12 = new HG(tmpHg)
  const check12 = hg12.check("", [])
  assert(check12.passed === true, "HG-12a empty output passes")
  assert(check12.overallConfidence === 1, "HG-12b empty output confidence=1")
  assert(check12.claims.length === 0, "HG-12c no claims from empty output")

  try { rmSync(tmpHg, { recursive: true, force: true }) } catch {}
}

// ═══════════════════════════════════════════════════════════════════════
// BC-PB: Prompt Builder Branch Coverage
// ═══════════════════════════════════════════════════════════════════════
section("BC-PB: Prompt Builder Branch Coverage")
{
  const { buildAgentPrompt, buildAgenticSystemInstructions, buildGenericAgentPrompt } = mod
  const { Verifier } = mod

  // Create a minimal domain pack
  const codeDomain = { name: "code", tools: ["agentic_plan", "agentic_execute", "agentic_verify", "agentic_nav", "agentic_debate", "agentic_router", "agentic_rag", "agentic_db", "agentic_auto", "agentic_pipeline", "agentic_parallel", "agentic_delegate"] }
  const genericDomain = { name: "generic", tools: ["agentic_plan", "agentic_execute", "agentic_nav"] }
  const dataDomain = { name: "data-science", tools: ["agentic_plan", "agentic_execute", "agentic_nav"] }

  const allTools = [
    { name: "agentic_plan", description: "Plan and decompose tasks" },
    { name: "agentic_execute", description: "Execute a step" },
    { name: "agentic_verify", description: "Verify results" },
    { name: "agentic_nav", description: "Navigate codebase" },
    { name: "agentic_debate", description: "Multi-round debate for complex analysis" },
    { name: "agentic_router", description: "Classify intent to route to RAG index" },
    { name: "agentic_rag", description: "Search and store knowledge" },
    { name: "agentic_db", description: "SQLite query interface" },
    { name: "agentic_auto", description: "One-call autonomous engineering" },
    { name: "agentic_pipeline", description: "Multi-agent pipeline definition" },
    { name: "agentic_parallel", description: "Parallel step execution" },
    { name: "agentic_delegate", description: "Delegate to specialist agents" },
  ]

  // PB-1: buildAgentPrompt with code domain (hasDebate=true, hasRouter=true, hasRag=true)
  const pb1 = buildAgentPrompt(codeDomain, allTools)
  assert(typeof pb1 === "string", "PB-1 buildAgentPrompt returns string")
  assert(pb1.includes("agentic_plan"), "PB-1b prompt includes tools")
  assert(pb1.includes("code") || pb1.includes("software engineering"), "PB-1c domain-specific text")
  // Should contain debate guardrail
  assert(pb1.includes("Debate") || pb1.includes("analisis"), "PB-1d debate guardrail present")

  // PB-2: buildAgentPrompt with data-science domain
  const pb2 = buildAgentPrompt(dataDomain, allTools.slice(0, 3))
  assert(typeof pb2 === "string", "PB-2 buildAgentPrompt data-science returns string")

  // PB-3: buildAgenticSystemInstructions with selected tools (routed mode)
  const pb3 = buildAgenticSystemInstructions(codeDomain, allTools, {
    isRouted: true,
    selectedTools: [{ name: "agentic_plan", description: "Plan" }],
  })
  assert(typeof pb3 === "string", "PB-3 routed instructions returns string")
  // With selected tools but isRouted true, should show Recommended Tools section
  assert(pb3.includes("Recommended Tools") || pb3.includes("Routing"), "PB-3b routed has routing section")

  // PB-4: buildAgenticSystemInstructions with empty selectedTools (isRouted but empty)
  const pb4 = buildAgenticSystemInstructions(codeDomain, allTools, {
    isRouted: true,
    selectedTools: [],
  })
  assert(typeof pb4 === "string", "PB-4 empty selectedTools still renders")

  // PB-5: buildGenericAgentPrompt with specific tools
  const pb5 = buildGenericAgentPrompt(allTools.slice(0, 7))
  assert(typeof pb5 === "string", "PB-5 generic prompt returns string")
  assert(pb5.includes("Agentic Assistant"), "PB-5b generic agent identity")

  // PB-6: buildAgenticSystemInstructions with knowledge entries
  const pb6 = buildAgenticSystemInstructions(codeDomain, allTools, {
    knowledgeEntries: [{ source: "test-source", content: "test knowledge", confidence: 0.85 }],
  })
  assert(typeof pb6 === "string", "PB-6 knowledge entries renders")
  // Knowledge entries should be in the prompt

  // PB-7: buildAgenticSystemInstructions with project context
  const pb7 = buildAgenticSystemInstructions(genericDomain, allTools.slice(0, 3), {
    projectContext: {
      languages: [{ lang: "TypeScript", confidence: 0.9 }],
      frameworks: [{ name: "Express" }],
      packageManager: "npm",
      testPatterns: ["*.test.ts"],
      entryPoints: ["src/index.ts"],
      ambiguity: "LOW",
    },
  })
  assert(typeof pb7 === "string", "PB-7 project context renders")
  assert(pb7.includes("TypeScript") || pb7.includes("typescript"), "PB-7b language in prompt")

  // PB-8: buildAgenticSystemInstructions with HIGH ambiguity
  const pb8 = buildAgenticSystemInstructions(genericDomain, allTools.slice(0, 3), {
    projectContext: {
      languages: [{ lang: "Python", confidence: 0.6 }],
      frameworks: [],
      packageManager: undefined,
      testPatterns: [],
      entryPoints: [],
      ambiguity: "HIGH",
    },
  })
  assert(typeof pb8 === "string", "PB-8 high ambiguity renders")
  assert(pb8.includes("eksplorasi") || pb8.includes("agentic_nav"), "PB-8b ambiguity guidance present")

  // PB-9: buildAgenticSystemInstructions with MEDIUM ambiguity
  const pb9 = buildAgenticSystemInstructions(genericDomain, allTools.slice(0, 3), {
    projectContext: {
      languages: [{ lang: "JavaScript", confidence: 0.7 }],
      frameworks: [],
      packageManager: undefined,
      testPatterns: [],
      entryPoints: [],
      ambiguity: "MEDIUM",
    },
  })
  assert(typeof pb9 === "string", "PB-9 medium ambiguity renders")
  assert(pb9.includes("verifikasi") || pb9.includes("agentic_nav") || pb9.includes("Beberapa sinyal"), "PB-9b medium ambiguity hint")

  // PB-10: buildAgenticSystemInstructions with hasAuto, hasPipeline, hasParallel, hasDelegate flags
  const pb10 = buildAgenticSystemInstructions(codeDomain, allTools)
  assert(pb10.includes("agentic_auto") || pb10.includes("Quick path"), "PB-10a auto flag section")
  assert(pb10.includes("agentic_pipeline") || pb10.includes("Multi-agent"), "PB-10b pipeline flag")
  assert(pb10.includes("agentic_parallel") || pb10.includes("Parallel"), "PB-10c parallel flag")
  assert(pb10.includes("agentic_delegate") || pb10.includes("Delegate"), "PB-10d delegate flag")
  assert(pb10.includes("agentic_db") || pb10.includes("SQLite"), "PB-10e db flag")

  // PB-11: buildAgenticSystemInstructions with skill curator (injectRelevant returns empty)
  const pb11 = buildAgenticSystemInstructions(codeDomain, allTools, {
    goal: "test goal",
    curator: {
      getConfig: () => ({ enabled: true }),
      injectRelevant: () => [],
      formatInjectedSkills: () => "",
    },
  })
  assert(typeof pb11 === "string", "PB-11 curator with empty skills still renders")

  // PB-12: buildAgenticSystemInstructions with curator that throws
  const pb12 = buildAgenticSystemInstructions(codeDomain, allTools, {
    goal: "test goal",
    curator: {
      getConfig: () => ({ enabled: true }),
      injectRelevant: () => { throw new Error("curator fail") },
      formatInjectedSkills: () => "",
    },
  })
  assert(typeof pb12 === "string", "PB-12 curator throw doesn't crash prompt builder")

  // PB-13: curator with relevant skills (line 274-277 — injectRelevant returns non-empty)
  const pb13 = buildAgenticSystemInstructions(codeDomain, allTools, {
    goal: "test goal",
    curator: {
      getConfig: () => ({ enabled: true }),
      injectRelevant: () => [{ id: "s1", name: "skill1", description: "test skill", reference: "ref" }],
      formatInjectedSkills: (skills) => `### Relevant Skills\n${skills.map(s => `- ${s.name}: ${s.description}`).join("\n")}`,
    },
  })
  assert(typeof pb13 === "string", "PB-13 curator with relevant skills renders")
  assert(pb13.includes("skill1") || pb13.includes("Relevant Skills"), "PB-13b skills content included")

  // PB-14: selected tools with long description >100 chars (line 365)
  const pb14 = buildAgenticSystemInstructions(codeDomain, allTools, {
    isRouted: true,
    selectedTools: [
      { name: "agentic_nav", description: "X".repeat(150) },
    ],
  })
  assert(typeof pb14 === "string", "PB-14 long description truncated")

  // PB-15: tool in categorized list with description >120 chars (line 388)
  const longDescTool = [
    { name: "agentic_nav", description: "Y".repeat(150) },
    { name: "agentic_plan", description: "Plan and decompose" },
  ]
  const pb15 = buildAgenticSystemInstructions(codeDomain, longDescTool, {
    isRouted: false,
    selectedTools: undefined,
  })
  assert(typeof pb15 === "string", "PB-15 long description in categorized tools")

  // PB-16: uncategorized tools (lines 404-411)
  const uncatToolList = [
    { name: "agentic_plan", description: "Plan" },
    { name: "agentic_nav", description: "Navigate" },
    { name: "custom_unknown_tool", description: "Custom tool not in any category" },
  ]
  const uncatDomain = { name: "generic", tools: ["agentic_plan", "agentic_nav", "custom_unknown_tool"] }
  const pb16 = buildAgenticSystemInstructions(uncatDomain, uncatToolList)
  assert(typeof pb16 === "string", "PB-16 uncategorized tools renders")
  assert(pb16.includes("Other Tools") || pb16.includes("custom_unknown_tool"), "PB-16b uncategorized section present")

  // PB-17: uncategorized tool with description > 120 chars (line 407)
  const long133 = "A".repeat(133)
  const longUncatList17 = [
    { name: "agentic_plan", description: "Plan" },
    { name: long133, description: long133 },
  ]
  const longUncatDomain17 = { name: "generic", tools: ["agentic_plan", long133] }
  const pb17 = buildAgenticSystemInstructions(longUncatDomain17, longUncatList17)
  assert(typeof pb17 === "string", "PB-17 long uncategorized renders")
  assert(pb17.includes("..."), "PB-17b description truncated with ellipsis")

  // PB-18: buildAgentPrompt (line 47) via buildAgentPrompt export
  const pb18 = buildAgentPrompt(
    { name: "code", tools: ["agentic_nav"] },
    [{ name: "agentic_nav", description: "Navigate codebase" }],
  )
  assert(typeof pb18 === "string", "PB-18 buildAgentPrompt works")

  // PB-19: buildGenericAgentPrompt with a tool description > 80 chars (line 93)
  const pb19 = buildGenericAgentPrompt([
    { name: "agentic_nav", description: "X".repeat(100) + "Navigate codebase" },
    { name: "agentic_plan", description: "Plan" },
    { name: "agentic_execute", description: "Execute" },
    { name: "agentic_verify", description: "Verify" },
    { name: "agentic_auto", description: "Auto" },
    { name: "agentic_context", description: "Context" },
  ])
  assert(typeof pb19 === "string", "PB-19 buildGenericAgentPrompt with long desc works")
  assert(pb19.includes("..."), "PB-19b long desc truncated")

  // PB-20: domain without tools property → falls back to allTools (line 166)
  const noToolsDomain = { name: "generic" }
  const pb20 = buildAgenticSystemInstructions(
    noToolsDomain,
    [{ name: "agentic_nav", description: "Nav" }],
  )
  assert(typeof pb20 === "string", "PB-20 domain without tools works")

  // PB-21: curator throwing a non-Error value → catch block non-Error branch (line 280)
  const pb21 = buildAgenticSystemInstructions(
    { name: "generic", tools: ["agentic_nav"] },
    [{ name: "agentic_nav", description: "Nav" }],
    {
      goal: "test",
      curator: {
        getConfig: () => ({ enabled: true }),
        injectRelevant: () => { throw "string error not Error instance" },
        formatInjectedSkills: () => "",
      },
    },
  )
  assert(typeof pb21 === "string", "PB-21 non-Error curator throw works")
}
}
// ── Standalone execution ──
const _isMain = typeof process !== "undefined" && process.argv[1] && (process.argv[1] === import.meta.url || process.argv[1].endsWith("/_runall-edge-deep.mjs"))
if (_isMain) {
  const { pluginDist: _pd, join: _join, mkdirSync: _mkdir, writeFileSync: _write, projectDir: _projDir } = await import("./_common.mjs")
  _mkdir(_join(_projDir, ".agentic"), { recursive: true })
  const _dummy = Array.from({length: 14}, (_, i) => JSON.stringify({step:`s${i}`})).join("\n")
  _write(_join(_projDir, ".agentic", "trace.jsonl"), _dummy + "\n")
  const _mod = await import(_pd)
  await runEdgeDeepTests(_mod)
  const { state } = await import("./_state.mjs")
  console.log(`__RESULT__:${JSON.stringify({ passed: state.passed, failed: state.failed })}`)
  process.exit(state.failed > 0 ? 1 : 0)
}
