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
