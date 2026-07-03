// test/_runall-adv-verifier.mjs — Verifier semantic verification tests
import { assert, section, mockCtx, freshSid, pluginDist, G, R, B, D, Y, RST, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, chmodSync, mkdtempSync, join, tmpdir, sdkMockClient, state, projectDir } from "./_common.mjs"

export async function runAdvancedVerifierTests(mod) {
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

// 56. Verifier — semantic verification (no LLM fallback)
console.log("\n[56] Verifier — semantic verification")
const v = new mod.Verifier()
assert(typeof v.setLLM === "function", "Verifier.setLLM is a function")
assert(typeof v.hasLLM === "function", "Verifier.hasLLM is a function")
assert(v.hasLLM() === false, "hasLLM returns false when no LLM set")
const semanticSkip = await v.verifySemantic("test-step", "test intent", ["src/test.ts"], projectDir)
assert(semanticSkip.passed === true, "verifySemantic returns passed=true when no LLM")
assert(semanticSkip.output.includes("no LLM"), "verifySemantic output mentions no LLM")

// verifyAllDeep with no LLM (should not include semantic check)
const deepResult = await v.verifyAllDeep("test-step", projectDir)
assert(typeof deepResult.passed === "boolean", "verifyAllDeep returns passed boolean")
assert(Array.isArray(deepResult.checks), "verifyAllDeep returns checks array")
assert(deepResult.checks.every(c => c.name !== "semantic"), "verifyAllDeep does not include semantic check when no LLM")

// Handles empty intent gracefully
const semanticSkip2 = await v.verifySemantic("test-step", "", [], projectDir)
assert(semanticSkip2.passed === true, "verifySemantic with empty params returns passed=true when no LLM")

assert(true, "Verifier semantic verification tests passed")
}

// ── Standalone execution ──
const _isMain = typeof process !== "undefined" && process.argv[1] && (process.argv[1] === import.meta.url || process.argv[1].endsWith("/_runall-adv-verifier.mjs"))
if (_isMain) {
  const { pluginDist: _pd } = await import("./_common.mjs")
  const _mod = await import(_pd)
  await runAdvancedVerifierTests(_mod)
  const { state } = await import("./_state.mjs")
  console.log(`__RESULT__:${JSON.stringify({ passed: state.passed, failed: state.failed })}`)
  process.exit(state.failed > 0 ? 1 : 0)
}
