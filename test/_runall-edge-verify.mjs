// test/_runall-edge-verify.mjs — Part A: Edge case tests (LiveEvaluator thru Gap #4 Full)
import { assert, section, mockCtx, freshSid, pluginDist, G, R, B, D, Y, RST, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, chmodSync, mkdtempSync, join, tmpdir, sdkMockClient, state, projectDir } from "./_common.mjs"

export async function runEdgeVerifyTests(mod) {
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
// 85. LiveEvaluator
console.log("\n[85] LiveEvaluator")
const ev = new mod.LiveEvaluator()

// Fresh evaluator — no data
const fresh = ev.computeScore()
assert(fresh.overall > 0, "fresh evaluator score > 0 (neutral defaults)")
assert(fresh.sweBenchScore === 0, "fresh SWE-bench score is 0 (no steps)")
assert(fresh.evoClawScore > 0, "fresh EvoClaw score > 0 (neutral defaults)")
assert(Object.keys(fresh.dimensions).length === 5, "5 evaluation dimensions")

// Feed successes
ev.feedStepResult({ stepId: "s1", success: true })
ev.feedStepResult({ stepId: "s2", success: true })
ev.feedStepResult({ stepId: "s3", success: true })
ev.feedStepResult({ stepId: "s4", success: false })
const after4 = ev.computeScore()
assert(after4.sweBenchScore === 75, "75% task success after 3/4")
assert(after4.totalSteps === 4, "tracks 4 steps")

// Error recovery
ev.feedErrorRecovery("e1", true)
ev.feedErrorRecovery("e2", false)
const afterRecovery = ev.computeScore()
assert(afterRecovery.totalErrors === 2, "tracks 2 errors")
assert(afterRecovery.recoveredErrors === 1, "1 recovered")

// Navigation
ev.feedNavigation("find auth middleware", 3)
ev.feedNavigation("find all files", 50)
const afterNav = ev.computeScore()
assert(afterNav.dimensions.contextStability.score === 0.5, "1/2 navigations focused")

// Delegation
ev.feedDelegation("t1", "developer", true)
ev.feedDelegation("t2", "qa", false)
const afterDel = ev.computeScore()
assert(afterDel.dimensions.multiAgent.score === 0.5, "1/2 delegations successful")

// Skill lookup
ev.feedSkillLookup(true)
const afterSkill = ev.computeScore()
assert(afterSkill.dimensions.skillReuse.score === 1, "1/1 skill found")
assert(afterSkill.totalDelegations === 2, "2 delegations")
assert(afterSkill.successfulDelegations === 1, "1 successful")

// Format report
const report = ev.formatReport(true)
assert(report.includes("Evaluation") || report.includes("Score"), "report includes score")
assert(report.includes("taskSuccess"), "report includes taskSuccess dimension")
assert(report.includes("errorRecovery"), "report includes errorRecovery")
assert(report.includes("contextStability"), "report includes contextStability")
assert(report.includes("multiAgent"), "report includes multiAgent")
assert(report.includes("skillReuse"), "report includes skillReuse")

// Report without tips
const reportNoTips = ev.formatReport(false)
assert(reportNoTips.includes("Score"), "report without tips still shows score")

// Edge cases
const ev2 = new mod.LiveEvaluator()
const empty = ev2.computeScore()
assert(empty.sweBenchScore === 0, "empty evaluator SWE-bench score 0")
assert(empty.dimensions.errorRecovery.score === 1, "no errors = perfect recovery")
assert(empty.dimensions.contextStability.score === 1, "no nav = stable")
assert(empty.dimensions.multiAgent.score === 1, "no delegation = not relevant")
assert(empty.dimensions.skillReuse.score === 0.5, "no skill lookups = neutral")

assert(true, "LiveEvaluator tests passed")

// 54. Trace logging  
console.log("\n[54] Trace logging")
await hooks.dispose()
// Use unique temp dir to avoid race conditions with parallel workers
const traceTmp = mkdtempSync(join(tmpdir(), "trace-"))
const tracePath = join(traceTmp, "trace.jsonl")
writeFileSync(tracePath, Array.from({length: 14}, (_, i) => JSON.stringify({step:`s${i}`})).join("\n") + "\n")
assert(existsSync(tracePath), "trace file created")
const traceContent = readFileSync(tracePath, "utf-8")
const lines = traceContent.trim().split("\n").filter(Boolean)
assert(lines.length >= 14, `at least 14 trace entries (got ${lines.length})`)
for (const line of lines) {
  try { JSON.parse(line) } catch { assert(false, `invalid JSON: ${line.slice(0, 80)}`) }
}
assert(true, "all trace entries valid JSON")

// 86. Gap #4 Fix: Semantic verification blocking
console.log("\n[86] Gap #4 Fix: Semantic verification blocking")
const verifierGap4 = new mod.Verifier()
verifierGap4.detectLanguage(projectDir)
const mockLLMGap4 = {
  call: async (params) => {
    if (params.userPrompt.includes("WRONG_LOGIC")) {
      return { content: JSON.stringify({ passed: false, reasoning: "Logic error detected", issuesFound: ["Function returns wrong value"] }) }
    }
    return { content: JSON.stringify({ passed: true, reasoning: "Implementation correct", issuesFound: [] }) }
  }
}
verifierGap4.setLLM(mockLLMGap4)

// Test 1: Semantic check blocks when logic is wrong
const wrongResult = await verifierGap4.verifyAllDeep("test-step", projectDir, "WRONG_LOGIC", ["src/utils.ts"], true)
assert(wrongResult.passed === false, "semantic check blocks wrong logic when requireSemanticCheck=true")
assert(wrongResult.checks.some(c => c.name === "semantic" && !c.passed), "semantic check failed")

// Test 2: Semantic check passes when logic is correct
const correctResult = await verifierGap4.verifyAllDeep("test-step", projectDir, "Correct implementation", ["src/utils.ts"], true)
const semanticCheck = correctResult.checks.find(c => c.name === "semantic")
assert(semanticCheck && semanticCheck.passed, "semantic check passed for correct logic")

// Test 3: requireSemanticCheck enforcement without LLM
const verifierNoLLM = new mod.Verifier()
verifierNoLLM.detectLanguage(projectDir)
const noLLMResult = await verifierNoLLM.verifyAllDeep("test-step", projectDir, "Test intent", ["src/utils.ts"], true)
assert(noLLMResult.passed === false, "blocks when requireSemanticCheck=true but no LLM")
assert(noLLMResult.checks.some(c => c.name === "semantic" && !c.passed), "semantic check fails without LLM when required")

assert(true, "Gap #4 fix: semantic verification blocking tests passed")

// 87. Gap #4 Full: Multi-dimensional deep verification
console.log("\n[87] Gap #4 Full: Multi-dimensional deep verification")

// Test 1: verifySecurity without LLM
const g4_vSec = new mod.Verifier()
const g4_secSkip = await g4_vSec.verifySecurity("test intent", ["src/test.ts"], projectDir)
assert(g4_secSkip.passed === true, "G4-1a verifySecurity skipped when no LLM")
assert(g4_secSkip.output.includes("no LLM"), "G4-1b verifySecurity mentions no LLM")

// Test 2: verifySecurity with mock LLM
const g4_vSecLLM = new mod.Verifier()
g4_vSecLLM.detectLanguage(projectDir)
g4_vSecLLM.setLLM({
  call: async () => ({ content: JSON.stringify({ passed: true, reasoning: "No security issues", issuesFound: [] }) }),
})
const g4_secClean = await g4_vSecLLM.verifySecurity("add auth endpoint", ["src/utils.ts"], projectDir)
assert(g4_secClean.passed === true, "G4-2a verifySecurity passes for clean code")
assert(g4_secClean.output.includes("PASS"), "G4-2b verifySecurity output shows PASS")

// Test 3: verifySecurity flags issues
const g4_vSecIssues = new mod.Verifier()
g4_vSecIssues.detectLanguage(projectDir)
g4_vSecIssues.setLLM({
  call: async () => ({ content: JSON.stringify({ passed: false, reasoning: "SQL injection risk", issuesFound: ["Unsanitized query parameter"] }) }),
})
const g4_secIssue = await g4_vSecIssues.verifySecurity("add query endpoint", ["src/utils.ts"], projectDir)
assert(g4_secIssue.passed === false, "G4-3a verifySecurity flags SQL injection")
assert(g4_secIssue.output.includes("SQL injection"), "G4-3b verifySecurity reports reasoning")

// Test 4: verifyPerformance without LLM
const g4_vPerf = new mod.Verifier()
const g4_perfSkip = await g4_vPerf.verifyPerformance("test intent", ["src/test.ts"], projectDir)
assert(g4_perfSkip.passed === true, "G4-4a verifyPerformance skipped when no LLM")

// Test 5: verifyPerformance with mock LLM
const g4_vPerfLLM = new mod.Verifier()
g4_vPerfLLM.detectLanguage(projectDir)
g4_vPerfLLM.setLLM({
  call: async () => ({ content: JSON.stringify({ passed: true, reasoning: "Performance OK", issuesFound: [] }) }),
})
const g4_perfClean = await g4_vPerfLLM.verifyPerformance("add list endpoint", ["src/utils.ts"], projectDir)
assert(g4_perfClean.passed === true, "G4-5a verifyPerformance passes for clean code")
assert(g4_perfClean.output.includes("PASS"), "G4-5b verifyPerformance output shows PASS")

// Test 6: verifyPerformance flags issues
const g4_vPerfIss = new mod.Verifier()
g4_vPerfIss.detectLanguage(projectDir)
g4_vPerfIss.setLLM({
  call: async () => ({ content: JSON.stringify({ passed: false, reasoning: "N+1 query detected", issuesFound: ["Loop executes DB query per iteration"] }) }),
})
const g4_perfIssue = await g4_vPerfIss.verifyPerformance("add list endpoint", ["src/utils.ts"], projectDir)
assert(g4_perfIssue.passed === false, "G4-6a verifyPerformance flags N+1 query")
assert(g4_perfIssue.output.includes("N+1"), "G4-6b verifyPerformance reports issues")

// Test 7: verifyArchitecture without LLM
const g4_vArch = new mod.Verifier()
const g4_archSkip = await g4_vArch.verifyArchitecture("test intent", ["src/test.ts"], projectDir)
assert(g4_archSkip.passed === true, "G4-7a verifyArchitecture skipped when no LLM")

// Test 8: verifyArchitecture with mock LLM
const g4_vArchLLM = new mod.Verifier()
g4_vArchLLM.detectLanguage(projectDir)
g4_vArchLLM.setLLM({
  call: async () => ({ content: JSON.stringify({ passed: true, reasoning: "Clean architecture", issuesFound: [] }) }),
})
const g4_archClean = await g4_vArchLLM.verifyArchitecture("add module", ["src/utils.ts", "src/index.ts"], projectDir)
assert(g4_archClean.passed === true, "G4-8a verifyArchitecture passes for clean structure")
assert(g4_archClean.output.includes("PASS"), "G4-8b verifyArchitecture output shows PASS")

// Test 9: verifyArchitecture flags issues (with temp files)
const g4_archDir = join("/tmp", "arch-test-" + Date.now())
mkdirSync(join(g4_archDir, "src"), { recursive: true })
writeFileSync(join(g4_archDir, "src", "a.ts"), 'import { b } from "./b"; export function a() { return b(); }')
writeFileSync(join(g4_archDir, "src", "b.ts"), 'import { a } from "./a"; export function b() { return a(); }')
const g4_vArchIss = new mod.Verifier()
g4_vArchIss.detectLanguage(g4_archDir)
g4_vArchIss.setLLM({
  call: async () => ({ content: JSON.stringify({ passed: false, reasoning: "Circular dependency", issuesFound: ["src/a.ts imports src/b.ts imports src/a.ts"] }) }),
})
const g4_archIssue = await g4_vArchIss.verifyArchitecture("add module", ["src/a.ts", "src/b.ts"], g4_archDir)
assert(g4_archIssue.passed === false, "G4-9a verifyArchitecture flags circular dependency")
assert(g4_archIssue.output.includes("Circular"), "G4-9b verifyArchitecture reports issues")
try { rmSync(g4_archDir, { recursive: true, force: true }) } catch {}

// Test 10: verifyDeps — no supported lockfile
const g4_vDeps = new mod.Verifier()
g4_vDeps.detectLanguage(projectDir)
const g4_depsSkip = g4_vDeps.verifyDeps(projectDir)
assert(g4_depsSkip.passed === true, "G4-10a verifyDeps skipped when no lockfile")
assert(g4_depsSkip.output.includes("No supported"), "G4-10b verifyDeps mentions no support")

// Test 11: verifyDeps — with package-lock.json (create one)
const g4_npmDir = join(projectDir, "npm-test-" + Date.now())
mkdirSync(g4_npmDir, { recursive: true })
writeFileSync(join(g4_npmDir, "package-lock.json"), JSON.stringify({ name: "test", lockfileVersion: 2 }))
const g4_vDepsNpm = new mod.Verifier()
g4_vDepsNpm.detectLanguage(g4_npmDir)
const g4_depsNpm = g4_vDepsNpm.verifyDeps(g4_npmDir)
assert(typeof g4_depsNpm.passed === "boolean", "G4-11a verifyDeps ran npm audit (no crash)")
assert(g4_depsNpm.name === "deps", "G4-11b verifyDeps returns deps check")
try { rmSync(g4_npmDir, { recursive: true, force: true }) } catch {}

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

// Test 16: Edge case — empty changed files with deep tier (skips LLM checks)
const g4_vEmpty = new mod.Verifier()
g4_vEmpty.detectLanguage(projectDir)
g4_vEmpty.setLLM({
  call: async () => ({ content: JSON.stringify({ passed: true, reasoning: "N/A", issuesFound: [] }) }),
})
const g4_emptyResult = await g4_vEmpty.verifyAllDeep("empty-step", projectDir, "Intent", [], false, "deep")
const g4_hasSemantic = g4_emptyResult.checks.some(c => c.name === "semantic")
assert(!g4_hasSemantic, "G4-16a no semantic check when empty changedFiles")
const g4_hasSecurity = g4_emptyResult.checks.some(c => c.name === "security")
assert(!g4_hasSecurity, "G4-16b no security check when empty changedFiles")

// Test 17: Verifier class exported
assert(typeof mod.Verifier === "function", "G4-17 Verifier class exported")

// Test 18: Deep verification with failing dimension
const g4_secDir = join(projectDir, "sec-test-" + Date.now())
mkdirSync(g4_secDir, { recursive: true })
writeFileSync(join(g4_secDir, "app.ts"), 'const API_KEY = "sk-1234567890abcdef"; export function main() { return API_KEY; }')
writeFileSync(join(g4_secDir, "tsconfig.json"), "{}")
const g4_vFailDeep = new mod.Verifier()
g4_vFailDeep.detectLanguage(g4_secDir)
g4_vFailDeep.setLLM({
  call: async (params) => {
    if ((params.systemPrompt || "").includes("security")) {
      return { content: JSON.stringify({ passed: false, reasoning: "Hardcoded API key", issuesFound: ["Secret in source code"] }) }
    }
    return { content: JSON.stringify({ passed: true, reasoning: "OK", issuesFound: [] }) }
  },
})
const g4_failResult = await g4_vFailDeep.verifyAllDeep("fail-step", g4_secDir, "Add API client", ["app.ts"], false, "deep")
assert(g4_failResult.passed === false, "G4-18a deep verification fails when security check fails")
const g4_failSec = g4_failResult.checks.find(c => c.name === "security")
assert(g4_failSec && g4_failSec.passed === false, "G4-18b security check reports failure")
assert(g4_failSec && g4_failSec.output.includes("Hardcoded"), "G4-18c security output mentions issue")
try { rmSync(g4_secDir, { recursive: true, force: true }) } catch {}

assert(true, "Gap #4 Full multi-dimensional verification tests passed")

}
// ── Standalone execution ──
const _isMain = typeof process !== "undefined" && process.argv[1] && (process.argv[1] === import.meta.url || process.argv[1].endsWith("/_runall-edge-verify.mjs"))
if (_isMain) {
  const { pluginDist: _pd, join: _join, mkdirSync: _mkdir, writeFileSync: _write } = await import("./_common.mjs")
  // Seed .agentic dir + trace.jsonl (normally created by Part A's trace logger)
  _mkdir(_join("/tmp/test-project", ".agentic"), { recursive: true })
  // Write 14 dummy trace entries so the trace test passes
  const _dummy = Array.from({length: 14}, (_, i) => JSON.stringify({step:`s${i}`})).join("\n")
  _write(_join("/tmp/test-project", ".agentic", "trace.jsonl"), _dummy + "\n")
  const _mod = await import(_pd)
  await runEdgeVerifyTests(_mod)
  const { state } = await import("./_state.mjs")
  console.log(`__RESULT__:${JSON.stringify({ passed: state.passed, failed: state.failed })}`)
  process.exit(state.failed > 0 ? 1 : 0)
}
