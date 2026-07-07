// test/_runall-edge-gap4.mjs — Gap #4 Individual dimension tests (G4-1..G4-11)
import { assert, section, mockCtx, freshSid, pluginDist, G, R, B, D, Y, RST, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, chmodSync, mkdtempSync, join, tmpdir, sdkMockClient, state, projectDir } from "./_common.mjs"

export async function runEdgeGap4Tests(mod) {
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

// 87. Gap #4: Multi-dimensional deep verification — individual dimension tests
console.log("\n[87] Gap #4: Individual dimension tests")

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

assert(true, "Gap #4 individual dimension tests passed")

}
// ── Standalone execution ──
const _isMain = typeof process !== "undefined" && process.argv[1] && (process.argv[1] === import.meta.url || process.argv[1].endsWith("/_runall-edge-gap4.mjs"))
if (_isMain) {
  const { pluginDist: _pd, join: _join, mkdirSync: _mkdir, writeFileSync: _write, projectDir: _projDir } = await import("./_common.mjs")
  _mkdir(_join(_projDir, ".agentic"), { recursive: true })
  const _dummy = Array.from({length: 14}, (_, i) => JSON.stringify({step:`s${i}`})).join("\n")
  _write(_join(_projDir, ".agentic", "trace.jsonl"), _dummy + "\n")
  const _mod = await import(_pd)
  await runEdgeGap4Tests(_mod)
  const { state } = await import("./_state.mjs")
  console.log(`__RESULT__:${JSON.stringify({ passed: state.passed, failed: state.failed })}`)
  process.exit(state.failed > 0 ? 1 : 0)
}
