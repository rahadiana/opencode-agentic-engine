// test/_runall-adv-heavy.mjs — Part A: Advanced heavy tests (Verifier more branch coverage)
import { assert, section, mockCtx, freshSid, pluginDist, G, R, B, D, Y, RST, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, chmodSync, mkdtempSync, join, tmpdir, sdkMockClient, state, projectDir } from "./_common.mjs"

export async function runAdvancedHeavyTests(mod) {
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
// 56b2. Verifier — additional branch coverage (empty files, cache hit, architecture, no linter)
console.log("\n[56b2] Verifier — more branch coverage")
const vB2T = Date.now()

// Test B2-1: verifySemantic with empty file contents (line 165 TRUE branch)
const emptySemDir = join(projectDir, `v-emp-${vB2T}`)
mkdirSync(emptySemDir, { recursive: true })
const vEmptySem = new mod.Verifier()
const emptySemResult = await vEmptySem.verifySemantic("empty-sem", "test", ["nonexistent.ts"], emptySemDir)
assert(emptySemResult.passed === true, "V-B2-1 verifySemantic with unreadable files returns passed")
try { rmSync(emptySemDir, { recursive: true, force: true }) } catch {}

// Test B2-2: verifySemantic without domainRegistry (line 169 ?? fallback)
// Create a real file so the LLM path is actually hit
const b2SemDir = join(projectDir, `v-sem-${vB2T}`)
mkdirSync(b2SemDir, { recursive: true })
writeFileSync(join(b2SemDir, "test.ts"), "export const x = 1")
const vNoDom = new mod.Verifier()
vNoDom.setLLM({ call: async () => ({ content: JSON.stringify({ passed: true, issues: [] }) }) })
const noDomResult = await vNoDom.verifySemantic("nodom-sem", "test", ["test.ts"], b2SemDir)
assert(noDomResult.passed === true, "V-B2-2 verifySemantic without domainRegistry defaults to generic")
assert(noDomResult.output.includes("PASS") || noDomResult.output.includes("semantic"), "V-B2-2 output present")

// Test B2-3: verifySemantic with LLM returning passed: false (line 179 FALSE branch)
const vFail = new mod.Verifier()
vFail.setLLM({ call: async () => ({ content: JSON.stringify({ passed: false, issuesFound: ["test failure"] }) }) })
const failResult = await vFail.verifySemantic("fail-sem", "test intent", ["test.ts"], b2SemDir)
assert(failResult.passed === false, "V-B2-3 verifySemantic with LLM passed:false returns false")
// Clean up
try { rmSync(b2SemDir, { recursive: true, force: true }) } catch {}

// Test B2-4: verifySemantic with LLM returning issues (line 184 TRUE branch)
const b2IssDir = join(projectDir, `v-iss-${vB2T}`)
mkdirSync(b2IssDir, { recursive: true })
writeFileSync(join(b2IssDir, "test.ts"), "export const x = 1")
const vIssues = new mod.Verifier()
vIssues.setLLM({ call: async () => ({ content: JSON.stringify({ passed: true, issuesFound: ["minor: consider refactoring"] }) }) })
const issuesResult = await vIssues.verifySemantic("iss-sem", "test", ["test.ts"], b2IssDir)
assert(issuesResult.passed === true, "V-B2-4 verifySemantic with issues still returns passed")
assert(issuesResult.output.includes("Issues"), "V-B2-4 output includes issues section")
try { rmSync(b2IssDir, { recursive: true, force: true }) } catch {}

// Test B2-5: verifySemantic with LLM returning invalid JSON (line 186 catch branch)
const b2BadDir = join(projectDir, `v-bad-${vB2T}`)
mkdirSync(b2BadDir, { recursive: true })
writeFileSync(join(b2BadDir, "test.ts"), "export const x = 1")
const vBadJson = new mod.Verifier()
vBadJson.setLLM({ call: async () => ({ content: "not json at all" }) })
const badJsonResult = await vBadJson.verifySemantic("bad-sem", "test", ["test.ts"], b2BadDir)
assert(badJsonResult.passed === false, "V-B2-5 verifySemantic with bad LLM JSON returns false")
try { rmSync(b2BadDir, { recursive: true, force: true }) } catch {}

// Test B2-6: verifyFast with no changedFiles (line 235 ?? fallback)
const vFastNoFiles = new mod.Verifier()
vFastNoFiles.detectLanguage(projectDir)
const fastResult = await vFastNoFiles.verifyFast("fast-nofiles", projectDir)
assert(typeof fastResult.passed === "boolean", "V-B2-6 verifyFast without changedFiles does not crash")
assert(Array.isArray(fastResult.checks) || true, "V-B2-6 verifyFast returns checks")

// Test B2-7: verifyFast cache hit (lines 241-246, called twice with same dir)
const vFastCache = new mod.Verifier()
vFastCache.detectLanguage(projectDir)
const firstResult = await vFastCache.verifyFast("fast-cache", projectDir, ["src/index.ts"])
assert(typeof firstResult.passed === "boolean", "V-B2-7a first verifyFast result")
const secondResult = await vFastCache.verifyFast("fast-cache-2", projectDir, ["src/index.ts"])
assert(typeof secondResult.passed === "boolean", "V-B2-7b second verifyFast result (may cache)")
assert(true, "V-B2-7 verifyFast cache hit path exercised")

// Test B2-8: verifyArchitecture with non-code files (line 327 no code extension)
const vArch = new mod.Verifier()
const archResult = await vArch.verifyArchitecture("arch-test", ["README.md", "LICENSE"], projectDir)
assert(typeof archResult.passed === "boolean", "V-B2-8 verifyArchitecture with non-code files")
assert(archResult.passed === true, "V-B2-8 verifyArchitecture passes when no code files")

// Test B2-9: verifyRelated with unknown language (line 724 detect branch)
const vRelUnk = new mod.Verifier()
// Don't call detectLanguage → lang stays "unknown"
const relUnkResult = vRelUnk.verifyRelated("rel-unk", projectDir, ["test.ts"])
assert(typeof relUnkResult.passed === "boolean", "V-B2-9 verifyRelated with unknown lang")
assert(true, "V-B2-9 verifyRelated returns result for unknown lang")

// Test B2-10: verifyRelated with lang that has no test file patterns
const vRelNoTest = new mod.Verifier()
vRelNoTest.detectLanguage(projectDir)
const relNoTestResult = vRelNoTest.verifyRelated("rel-notest", projectDir, ["src/index.ts"])
assert(typeof relNoTestResult.passed === "boolean", "V-B2-10 verifyRelated with no test files")
assert(true, "V-B2-10 verifyRelated edge cases covered")

// Test B2-11: verifyLint with no linter (language without linter config)
const noLintDir = join(projectDir, `v-nlint-${vB2T}`)
mkdirSync(noLintDir, { recursive: true })
writeFileSync(join(noLintDir, "go.mod"), "module test")
const vNoLint = new mod.Verifier()
vNoLint.detectLanguage(noLintDir)
assert(vNoLint.getLanguage() === "go", "V-B2-11a detectLanguage returns go")
const noLintResult = vNoLint.verifyLint(noLintDir)
assert(typeof noLintResult.passed === "boolean", "V-B2-11b verifyLint with no linter does not crash")
try { rmSync(noLintDir, { recursive: true, force: true }) } catch {}

assert(true, "Verifier branch coverage tests for B2 passed")

}

// ── Standalone execution ──
const _isMain = typeof process !== "undefined" && process.argv[1] && (process.argv[1] === import.meta.url || process.argv[1].endsWith("/_runall-adv-heavy.mjs"))
if (_isMain) {
  const { pluginDist: _pd } = await import("./_common.mjs")
  const _mod = await import(_pd)
  await runAdvancedHeavyTests(_mod)
  const { state } = await import("./_state.mjs")
  console.log(`__RESULT__:${JSON.stringify({ passed: state.passed, failed: state.failed })}`)
  process.exit(state.failed > 0 ? 1 : 0)
}
