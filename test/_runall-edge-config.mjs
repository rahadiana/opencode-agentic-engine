// test/_runall-edge-config.mjs — Gap #4 Config/edge case tests (G4-16..G4-18)
import { assert, section, mockCtx, freshSid, pluginDist, G, R, B, D, Y, RST, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, chmodSync, mkdtempSync, join, tmpdir, sdkMockClient, state, projectDir } from "./_common.mjs"

export async function runEdgeConfigTests(mod) {
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

// Gap #4 Config/edge case tests
console.log("\n[87] Gap #4: Config/edge case tests")

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

assert(true, "Gap #4 config/edge case tests passed")

}
// ── Standalone execution ──
const _isMain = typeof process !== "undefined" && process.argv[1] && (process.argv[1] === import.meta.url || process.argv[1].endsWith("/_runall-edge-config.mjs"))
if (_isMain) {
  const { pluginDist: _pd, join: _join, mkdirSync: _mkdir, writeFileSync: _write, projectDir: _projDir } = await import("./_common.mjs")
  _mkdir(_join(_projDir, ".agentic"), { recursive: true })
  const _dummy = Array.from({length: 14}, (_, i) => JSON.stringify({step:`s${i}`})).join("\n")
  _write(_join(_projDir, ".agentic", "trace.jsonl"), _dummy + "\n")
  const _mod = await import(_pd)
  await runEdgeConfigTests(_mod)
  const { state } = await import("./_state.mjs")
  console.log(`__RESULT__:${JSON.stringify({ passed: state.passed, failed: state.failed })}`)
  process.exit(state.failed > 0 ? 1 : 0)
}
