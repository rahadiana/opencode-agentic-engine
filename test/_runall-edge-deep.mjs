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
