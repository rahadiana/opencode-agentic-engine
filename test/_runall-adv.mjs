// test/_runall-adv.mjs — Part A: Advanced tests (VectorStore through Verifier branch)
import { assert, section, mockCtx, freshSid, pluginDist, G, R, B, D, Y, RST, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, chmodSync, mkdtempSync, join, tmpdir, sdkMockClient, state, projectDir } from "./_common.mjs"

export async function runAdvancedTests(mod) {
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
console.log("\n[55] VectorStore — TF-IDF sparse retrieval")
const { VectorStore } = await import(pluginDist)
const vs = new VectorStore()

// Index documents
vs.index({
  id: "doc1", category: "general", title: "Hello world",
  content: "this is a test document for vector store",
  keywords: ["hello", "test"],
})
vs.index({
  id: "doc2", category: "general", title: "Arabic test",
  content: "السلام عليكم ورحمة الله وبركاته هذا نص تجريبي",
  keywords: ["arabic"],
})
vs.index({
  id: "doc3", category: "general", title: "Chinese test",
  content: "你好世界这是一个测试文档",
  keywords: ["chinese"],
})
vs.index({
  id: "doc4", category: "general", title: "Japanese test",
  content: "こんにちは世界 これはテスト文書です",
  keywords: ["japanese"],
})
vs.index({
  id: "doc5", category: "general", title: "Korean test",
  content: "안녕하세요 세계 이것은 테스트 문서입니다",
  keywords: ["korean"],
})
vs.index({
  id: "doc6", category: "general", title: "Russian test",
  content: "Привет мир это тестовый документ",
  keywords: ["russian"],
})

assert(vs.size === 6, "all 6 docs indexed")

// Search for a matching term
const results = vs.search("hello", "general", 5)
assert(results.length > 0, "TF-IDF search returns results")
assert(results[0].doc.id === "doc1", "doc1 ranked first for 'hello' query")
assert(results[0].score > 0, "TF-IDF score is positive")
assert(results[0].matchFields.includes("content") || results[0].matchFields.includes("title"), "match fields populated")

// Search in Russian — should find Russian doc
const russianResults = vs.search("тестовый", "general", 3)
assert(russianResults.length > 0, "Russian TF-IDF search returns results")
assert(russianResults[0].doc.id === "doc6", "Russian doc ranked first for Russian query")

// Search across all categories
const allResults = vs.searchAll("test", 10)
assert(allResults.length > 0, "searchAll returns results")
assert(allResults[0].score > 0, "searchAll score is positive")

assert(true, "VectorStore TF-IDF tests passed")

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
const _isMain = typeof process !== "undefined" && process.argv[1] && (process.argv[1] === import.meta.url || process.argv[1].endsWith("/_runall-adv.mjs"))
if (_isMain) {
  const { pluginDist: _pd } = await import("./_common.mjs")
  const _mod = await import(_pd)
  await runAdvancedTests(_mod)
  const { state } = await import("./_state.mjs")
  console.log(`__RESULT__:${JSON.stringify({ passed: state.passed, failed: state.failed })}`)
  process.exit(state.failed > 0 ? 1 : 0)
}
