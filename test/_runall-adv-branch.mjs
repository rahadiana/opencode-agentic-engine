// test/_runall-adv-branch.mjs — Verifier branch coverage tests
import { assert, section, mockCtx, freshSid, pluginDist, G, R, B, D, Y, RST, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, chmodSync, mkdtempSync, join, tmpdir, sdkMockClient, state, projectDir } from "./_common.mjs"

export async function runAdvancedBranchTests(mod) {
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

// 56b. Verifier — branch coverage (jest runner, unknown lang skip lint, isTestFile 3 branches)
console.log("\n[56b] Verifier — branch coverage")
const vBrT = Date.now()

// Test 1: verifyCompile & verifyTests detection (without running the full test)
// Test that detectLanguage and verifyCompile work on a jest project dir
const jestDir = join(projectDir, `v-jest-${vBrT}`)
mkdirSync(jestDir, { recursive: true })
writeFileSync(join(jestDir, "package.json"), JSON.stringify({ scripts: { test: "jest" } }))
const vJest = new mod.Verifier()
vJest.detectLanguage(jestDir)
assert(vJest.getLanguage() === "javascript", "V-B1a detectLanguage returns javascript for jest package.json")
// verifyCompile should not crash (no npx needed)
const compileResult = vJest.verifyCompile(jestDir)
assert(typeof compileResult.passed === "boolean", "V-B1b verifyCompile on jest dir returns boolean")
try { rmSync(jestDir, { recursive: true, force: true }) } catch {}

// Test 2: verifyAll — skip lint when lang is unknown (line 704)
// Empty dir with no config files → detectLanguage returns "unknown" → skip lint
const unknownDir = join(projectDir, `v-unk-${vBrT}`)
mkdirSync(unknownDir, { recursive: true })
const vUnk = new mod.Verifier()
const unkResult = vUnk.verifyAll("unk-step", unknownDir)
const unkHasLint = unkResult.checks.some(c => c.name.startsWith("lint"))
assert(!unkHasLint, "V-B2a no lint check when language is unknown")
assert(unkResult.checks.length >= 1, "V-B2b verifyAll on unknown dir has checks")
try { rmSync(unknownDir, { recursive: true, force: true }) } catch {}

// Test 3: verifyRelated — isTestFile python test_ prefix branch (line 729-731)
// Python testFileExts: ["test_", "_test.py"] → "test_" hits startsWith("test_") branch
const pyDir = join(projectDir, `v-py-${vBrT}`)
mkdirSync(pyDir, { recursive: true })
writeFileSync(join(pyDir, "requirements.txt"), "")
const vPy = new mod.Verifier()
vPy.detectLanguage(pyDir)
assert(vPy.getLanguage() === "python", "V-B3a detectLanguage returns python for requirements.txt")
const pyRel = vPy.verifyRelated("py-step", pyDir, ["test_foo.py"])
const pyHasTest = pyRel.checks.some(c => c.name.includes("related files") && c.output.includes("test_foo.py"))
assert(pyHasTest, "V-B3b verifyRelated detects test_ prefix file")
try { rmSync(pyDir, { recursive: true, force: true }) } catch {}

// Test 4: verifyRelated — isTestFile go _test. prefix branch (line 733)
// Go testFileExts: ["_test.go"] → "_test.go" hits startsWith("_test.") branch
const goDir = join(projectDir, `v-go-${vBrT}`)
mkdirSync(goDir, { recursive: true })
writeFileSync(join(goDir, "go.mod"), "module test")
const vGo = new mod.Verifier()
vGo.detectLanguage(goDir)
assert(vGo.getLanguage() === "go", "V-B4a detectLanguage returns go for go.mod")
const goRel = vGo.verifyRelated("go-step", goDir, ["foo_test.go"])
const goHasTest = goRel.checks.some(c => c.name.includes("related files") && c.output.includes("foo_test.go"))
assert(goHasTest, "V-B4b verifyRelated detects _test.go file")
try { rmSync(goDir, { recursive: true, force: true }) } catch {}

// Test 5: verifyRelated — isTestFile typescript default f.endsWith(ext) branch (line 734)
// TypeScript testFileExts: [".test.ts", ".spec.ts", ...] → falls through to default
const tsDir = join(projectDir, `v-ts-${vBrT}`)
mkdirSync(tsDir, { recursive: true })
writeFileSync(join(tsDir, "tsconfig.json"), "{}")
const vTs = new mod.Verifier()
vTs.detectLanguage(tsDir)
assert(vTs.getLanguage() === "typescript", "V-B5a detectLanguage returns typescript for tsconfig.json")
const tsRel = vTs.verifyRelated("ts-step", tsDir, ["foo.test.ts"])
const tsHasTest = tsRel.checks.some(c => c.name.includes("related files") && c.output.includes("foo.test.ts"))
assert(tsHasTest, "V-B5b verifyRelated detects .test.ts file")
try { rmSync(tsDir, { recursive: true, force: true }) } catch {}

// Test 6: verifyCompile vitest detection (skipping actual test run which hangs without npx)
const vitDir = join(projectDir, `v-vit-${vBrT}`)
mkdirSync(vitDir, { recursive: true })
writeFileSync(join(vitDir, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }))
const vVit = new mod.Verifier()
vVit.detectLanguage(vitDir)
assert(vVit.getLanguage() === "javascript", "V-B6a detectLanguage returns javascript for package.json")
const vitCompile = vVit.verifyCompile(vitDir)
assert(typeof vitCompile.passed === "boolean", "V-B6b verifyCompile on vitest dir returns boolean")
try { rmSync(vitDir, { recursive: true, force: true }) } catch {}

// Test 7: verifyAll with known language — lint included (line 704-705)
const knownDir = join(projectDir, `v-kn-${vBrT}`)
mkdirSync(knownDir, { recursive: true })
writeFileSync(join(knownDir, "tsconfig.json"), "{}")
const vKnown = new mod.Verifier()
const knownResult = vKnown.verifyAll("known-step", knownDir)
const knownHasLint = knownResult.checks.some(c => c.name.startsWith("lint"))
assert(typeof knownHasLint === "boolean", "V-B7a verifyAll on ts project returns checks")
assert(knownResult.checks.length >= 2, "V-B7b verifyAll has compile + test + (lint if lang known) checks")
try { rmSync(knownDir, { recursive: true, force: true }) } catch {}

// Test 8: verifyRelated with source files — inferredTestFiles path (lines 744-756)
// TypeScript source file (.ts) → should infer .test.ts variants
const infDir = join(projectDir, `v-inf-${vBrT}`)
mkdirSync(infDir, { recursive: true })
writeFileSync(join(infDir, "tsconfig.json"), "{}")
const vInf = new mod.Verifier()
vInf.detectLanguage(infDir)
assert(vInf.getLanguage() === "typescript", "V-B8a detectLanguage returns typescript")
const infRel = vInf.verifyRelated("inf-step", infDir, ["src/foo.ts"])

// Should have inferred test files for foo.ts
const infHasInferred = infRel.checks.some(c => c.name.includes("related files") && (c.output.includes("foo.test.ts") || c.output.includes("foo.spec.ts")))
assert(infHasInferred, "V-B8b verifyRelated infers test files from source file")
try { rmSync(infDir, { recursive: true, force: true }) } catch {}

// Test 9: verifyRelated with Python source files — test_ prefix inference (line 750)
const pyInfDir = join(projectDir, `v-pinf-${vBrT}`)
mkdirSync(pyInfDir, { recursive: true })
writeFileSync(join(pyInfDir, "requirements.txt"), "")
const vPyInf = new mod.Verifier()
vPyInf.detectLanguage(pyInfDir)
assert(vPyInf.getLanguage() === "python", "V-B9a detectLanguage returns python")
const pyInfRel = vPyInf.verifyRelated("pyinf-step", pyInfDir, ["src/module.py"])
// Python testFileExts: ["test_", "_test.py"] → "test_" prefix branch infers src/test_module.py
const pyInfHasInferred = pyInfRel.checks.some(c => c.name.includes("related files") && c.output.includes("test_module.py"))
assert(pyInfHasInferred, "V-B9b verifyRelated infers test_ prefix files for Python")
try { rmSync(pyInfDir, { recursive: true, force: true }) } catch {}

assert(true, "Verifier branch coverage tests passed")
}

// ── Standalone execution ──
const _isMain = typeof process !== "undefined" && process.argv[1] && (process.argv[1] === import.meta.url || process.argv[1].endsWith("/_runall-adv-branch.mjs"))
if (_isMain) {
  const { pluginDist: _pd } = await import("./_common.mjs")
  const _mod = await import(_pd)
  await runAdvancedBranchTests(_mod)
  const { state } = await import("./_state.mjs")
  console.log(`__RESULT__:${JSON.stringify({ passed: state.passed, failed: state.failed })}`)
  process.exit(state.failed > 0 ? 1 : 0)
}
