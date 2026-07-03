// _b_sandbox.mjs — Part B: CodeSandbox tests
import { pluginDist, G, R, RST, state, assert, section, mockCtx, freshSid, join, tmpdir, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, chmodSync, mkdtempSync, sdkMockClient, Y, B, D, projectDir } from "./_common.mjs"

// ── Code Sandbox Tests (Comparison 24) ───────────────────────────────
console.log("\n[SANDBOX] CodeSandbox — banned tokens + VM sandbox + module registry")
const sandboxMod = await import(pluginDist)
const { CodeSandbox, CodeModuleRegistry, checkBannedTokens, sandboxExecute, runSandboxTests, DEFAULT_BANNED_TOKENS } = sandboxMod
let sPassed = 0, sFailed = 0
const s = (name, fn) => { try { fn(); sPassed++; console.log(`  PASS: ${name}`) } catch (e) { sFailed++; console.log(`  FAIL: ${name} — ${e.message}`) } }

// SANDBOX-1: Constructor
const sb1 = new CodeSandbox()
s("SANDBOX-1a CodeSandbox created", () => {
  if (typeof sb1.execute !== "function") throw new Error("execute method missing")
})
s("SANDBOX-1b getRegistry returns registry", () => {
  const reg = sb1.getRegistry()
  if (!(reg instanceof CodeModuleRegistry)) throw new Error("Expected CodeModuleRegistry")
})

// SANDBOX-2: checkBannedTokens — clean code
const sb2_code = `function handler(input) { return input.x * 2; }`
const sb2_issues = checkBannedTokens(sb2_code)
s("SANDBOX-2a clean code has no issues", () => {
  if (sb2_issues.length !== 0) throw new Error(`Expected 0 issues, got ${sb2_issues.length}`)
})

// SANDBOX-3: checkBannedTokens — dangerous code
const sb3_code = `function handler(input) { require('fs').readFileSync('/etc/passwd'); return input; }`
const sb3_issues = checkBannedTokens(sb3_code)
s("SANDBOX-3a require() detected", () => {
  if (sb3_issues.length === 0) throw new Error("Expected banned token issues")
})
s("SANDBOX-3b require() is error severity", () => {
  if (!sb3_issues.some(i => i.token === "require" && i.severity === "error")) throw new Error("require should be error")
})

// SANDBOX-4: checkBannedTokens — process and eval
const sb4_code = `function handler(input) { process.env.SECRET; eval(input.cmd); return input; }`
const sb4_issues = checkBannedTokens(sb4_code)
s("SANDBOX-4a process.env detected", () => {
  if (!sb4_issues.some(i => i.token === "process")) throw new Error("process should be detected")
})
s("SANDBOX-4b eval detected", () => {
  if (!sb4_issues.some(i => i.token === "eval")) throw new Error("eval should be detected")
})
s("SANDBOX-4c multiple issues found", () => {
  if (sb4_issues.length < 2) throw new Error(`Expected >=2 issues, got ${sb4_issues.length}`)
})

// SANDBOX-5: sandboxExecute — simple handler
const sb5_code = `function handler(input) { return { result: input.x + input.y }; }`
const sb5r = sandboxExecute(sb5_code, { x: 10, y: 20 })
s("SANDBOX-5a simple handler executes", () => {
  if (!sb5r.success) throw new Error(`Execution failed: ${sb5r.error}`)
})
s("SANDBOX-5b correct result", () => {
  if (sb5r.output?.result !== 30) throw new Error(`Expected 30, got ${sb5r.output?.result}`)
})
s("SANDBOX-5c durationMs is positive", () => {
  if (typeof sb5r.durationMs !== "number" || sb5r.durationMs < 0) throw new Error("Invalid durationMs")
})

// SANDBOX-6: sandboxExecute — arrow function handler
const sb6_code = `const handler = (input) => ({ doubled: input.n * 2 });`
const sb6r = sandboxExecute(sb6_code, { n: 21 })
s("SANDBOX-6a arrow handler executes", () => {
  if (!sb6r.success) throw new Error(`Execution failed: ${sb6r.error}`)
})
s("SANDBOX-6b correct result from arrow", () => {
  if (sb6r.output?.doubled !== 42) throw new Error(`Expected 42, got ${sb6r.output?.doubled}`)
})

// SANDBOX-7: sandboxExecute — banned token rejection
const sb7_code = `function handler(input) { return require('fs').existsSync('/tmp'); }`
const sb7r = sandboxExecute(sb7_code, {})
s("SANDBOX-7a banned token blocks execution", () => {
  if (sb7r.success !== false) throw new Error("Should have failed")
})
s("SANDBOX-7b error mentions banned token", () => {
  if (!sb7r.error || !sb7r.error.includes("Banned tokens")) throw new Error(`Expected banned tokens message, got: ${sb7r.error}`)
})

// SANDBOX-8: sandboxExecute — timeout on infinite loop
const sb8_code = `function handler(input) { while(true) {} }`
const sb8r = sandboxExecute(sb8_code, {}, 100)
s("SANDBOX-8a infinite loop times out", () => {
  if (sb8r.success !== false) throw new Error("Should have timed out")
})
s("SANDBOX-8b timeout produces error", () => {
  if (!sb8r.error) throw new Error("Should have error message")
})

// SANDBOX-9: sandboxExecute — handler not defined
const sb9_code = `const x = 42;`
const sb9r = sandboxExecute(sb9_code, {})
s("SANDBOX-9a missing handler fails", () => {
  if (sb9r.success !== false) throw new Error("Should fail without handler function")
})
s("SANDBOX-9b error mentions handler", () => {
  if (!sb9r.error || !sb9r.error.includes("handler")) throw new Error(`Should mention handler, got: ${sb9r.error}`)
})

// SANDBOX-10: runSandboxTests — all pass
const sb10_code = `function handler(input) { return input.nums.map(n => n * 2); }`
const sb10_tests = [
  { name: "test1", input: { nums: [1, 2, 3] }, expected: [2, 4, 6] },
  { name: "test2", input: { nums: [0, -1] }, expected: [0, -2] },
]
const sb10r = runSandboxTests(sb10_code, sb10_tests)
s("SANDBOX-10a all tests pass", () => {
  if (sb10r.passed !== 2) throw new Error(`Expected 2 passed, got ${sb10r.passed}`)
})
s("SANDBOX-10b no failures", () => {
  if (sb10r.failures.length !== 0) throw new Error(`Expected 0 failures, got ${sb10r.failures.length}`)
})
s("SANDBOX-10c passRate is 1.0", () => {
  if (sb10r.passRate !== 1.0) throw new Error(`Expected passRate 1.0, got ${sb10r.passRate}`)
})

// SANDBOX-11: runSandboxTests — some fail
const sb11_code = `function handler(input) { return input.nums.map(n => n * 2); }`
const sb11_tests = [
  { name: "correct", input: { nums: [1, 2] }, expected: [2, 4] },
  { name: "wrong", input: { nums: [3] }, expected: [100] },
]
const sb11r = runSandboxTests(sb11_code, sb11_tests)
s("SANDBOX-11a one passes, one fails", () => {
  if (sb11r.passed !== 1) throw new Error(`Expected 1 passed, got ${sb11r.passed}`)
})
s("SANDBOX-11b total is 2", () => {
  if (sb11r.total !== 2) throw new Error(`Expected total 2, got ${sb11r.total}`)
})
s("SANDBOX-11c failures populated", () => {
  if (sb11r.failures.length !== 1) throw new Error(`Expected 1 failure, got ${sb11r.failures.length}`)
})
s("SANDBOX-11d failure has name", () => {
  if (sb11r.failures[0].name !== "wrong") throw new Error(`Expected name 'wrong', got ${sb11r.failures[0].name}`)
})

// SANDBOX-12: CodeModuleRegistry
const sb12_reg = new CodeModuleRegistry()
const sb12_mod = sb12_reg.register({
  name: "doubler",
  code: "function handler(input) { return input.n * 2; }",
  language: "javascript",
  entry: "handler",
  inputSchema: { n: { type: "number" } },
  outputSchema: { result: { type: "number" } },
})
s("SANDBOX-12a module registered with id", () => {
  if (!sb12_mod.id) throw new Error("Expected id")
})
s("SANDBOX-12b module has createdAt", () => {
  if (!sb12_mod.createdAt) throw new Error("Expected createdAt timestamp")
})
s("SANDBOX-12c module has default successRate", () => {
  if (sb12_mod.successRate !== 1.0) throw new Error(`Expected successRate 1.0, got ${sb12_mod.successRate}`)
})
s("SANDBOX-12d getById returns module", () => {
  const found = sb12_reg.getById(sb12_mod.id)
  if (!found) throw new Error("getById returned undefined")
  if (found.name !== "doubler") throw new Error(`Expected 'doubler', got ${found.name}`)
})

// SANDBOX-13: CodeModuleRegistry — find
const sb13_reg = new CodeModuleRegistry()
sb13_reg.register({ name: "sort-array", code: "function handler(i) { return i.arr.sort(); }", language: "javascript", entry: "handler", inputSchema: {}, outputSchema: {} })
sb13_reg.register({ name: "filter-objects", code: "function handler(i) { return i.items.filter(x => x.active); }", language: "javascript", entry: "handler", inputSchema: {}, outputSchema: {} })
const sb13_find = sb13_reg.find("sort")
s("SANDBOX-13a find by name works", () => {
  if (sb13_find.length !== 1) throw new Error(`Expected 1 result, got ${sb13_find.length}`)
})
s("SANDBOX-13b correct module found", () => {
  if (sb13_find[0].name !== "sort-array") throw new Error(`Expected 'sort-array', got ${sb13_find[0].name}`)
})

// SANDBOX-14: CodeModuleRegistry — recordSuccess / recordFailure
const sb14_reg = new CodeModuleRegistry()
const sb14_mod = sb14_reg.register({ name: "test", code: "// empty", language: "javascript", entry: "handler", inputSchema: {}, outputSchema: {} })
sb14_reg.recordSuccess(sb14_mod.id)
sb14_reg.recordSuccess(sb14_mod.id)
sb14_reg.recordFailure(sb14_mod.id)
const sb14_after = sb14_reg.getById(sb14_mod.id)
s("SANDBOX-14a usageCount after 3 operations", () => {
  if (sb14_after?.usageCount !== 3) throw new Error(`Expected usageCount 3, got ${sb14_after?.usageCount}`)
})
s("SANDBOX-14b successRate reflects 2/3 success", () => {
  // (1.0*0 + 1)/1 = 1.0, then (1.0*1 + 1)/2 = 1.0, then (1.0*2 + 0)/3 ≈ 0.667
  if (!sb14_after || sb14_after.successRate < 0.6 || sb14_after.successRate > 0.7) throw new Error(`Expected ~0.667, got ${sb14_after?.successRate}`)
})

// SANDBOX-15: CodeSandbox.processCode — full pipeline success
const sb15_sandbox = new CodeSandbox()
const sb15_code = `function handler(input) { return { sum: input.a + input.b, product: input.a * input.b }; }`
const sb15r = sb15_sandbox.processCode(sb15_code, "calculator", { a: 3, b: 4 })
s("SANDBOX-15a full pipeline succeeds", () => {
  if (!sb15r.success) throw new Error(`Pipeline failed: ${sb15r.error}`)
})
s("SANDBOX-15b module registered", () => {
  if (!sb15r.module) throw new Error("Expected registered module")
})
s("SANDBOX-15c executionResult present", () => {
  if (!sb15r.executionResult) throw new Error("Expected execution result")
})
s("SANDBOX-15d correct output", () => {
  if (sb15r.executionResult?.output?.sum !== 7) throw new Error(`Expected sum 7, got ${sb15r.executionResult?.output?.sum}`)
})
s("SANDBOX-15e module has name", () => {
  if (sb15r.module?.name !== "calculator") throw new Error(`Expected 'calculator', got ${sb15r.module?.name}`)
})

// SANDBOX-16: CodeSandbox.processCode — banned token rejection
const sb16_sandbox = new CodeSandbox()
const sb16_code = `function handler(input) { eval(input.cmd); return input; }`
const sb16r = sb16_sandbox.processCode(sb16_code, "danger", { cmd: "bad" })
s("SANDBOX-16a banned token blocks pipeline", () => {
  if (sb16r.success !== false) throw new Error("Should fail on banned tokens")
})
s("SANDBOX-16b issues populated", () => {
  if (!sb16r.issues || sb16r.issues.length === 0) throw new Error("Expected issues")
})
s("SANDBOX-16c no module registered for banned code", () => {
  if (sb16r.module) throw new Error("Should not register module for banned code")
})

// SANDBOX-17: CodeSandbox.processCode — with test cases
const sb17_sandbox = new CodeSandbox()
const sb17_code = `function handler(input) { return input.names.filter(n => n.startsWith('A')); }`
const sb17_tests = [
  { name: "filters correctly", input: { names: ["Alice", "Bob", "Anna", "John"] }, expected: ["Alice", "Anna"] },
  { name: "empty input", input: { names: [] }, expected: [] },
]
const sb17r = sb17_sandbox.processCode(sb17_code, "filter-names", { names: ["Alice", "Bob"] }, sb17_tests)
s("SANDBOX-17a pipeline with tests succeeds", () => {
  if (!sb17r.success) throw new Error(`Pipeline failed: ${sb17r.error}`)
})
s("SANDBOX-17b module registered after tests pass", () => {
  if (!sb17r.module) throw new Error("Expected registered module")
})

// SANDBOX-18: CodeSandbox — setBannedTokens custom
const sb18_sandbox = new CodeSandbox()
sb18_sandbox.setBannedTokens([
  { name: "danger", pattern: /alert\(/g, severity: "error", reason: "No alerts" },
])
const sb18_code = `function handler(input) { alert('x'); return input; }`
const sb18r = sb18_sandbox.checkCode(sb18_code)
s("SANDBOX-18a custom banned token works", () => {
  if (sb18r.length === 0) throw new Error("Expected to detect custom token")
})
s("SANDBOX-18b correct custom token name", () => {
  if (sb18r[0].token !== "danger") throw new Error(`Expected 'danger', got ${sb18r[0].token}`)
})

// SANDBOX-19: CodeModuleRegistry — size and remove
const sb19_reg = new CodeModuleRegistry()
sb19_reg.register({ name: "m1", code: "//", language: "javascript", entry: "h", inputSchema: {}, outputSchema: {} })
sb19_reg.register({ name: "m2", code: "//", language: "javascript", entry: "h", inputSchema: {}, outputSchema: {} })
s("SANDBOX-19a size is 2", () => {
  if (sb19_reg.size !== 2) throw new Error(`Expected 2, got ${sb19_reg.size}`)
})
sb19_reg.remove("no-such-id")
s("SANDBOX-19b remove unknown returns false (size unchanged)", () => {
  if (sb19_reg.size !== 2) throw new Error(`Expected 2, got ${sb19_reg.size}`)
})
const all19 = sb19_reg.getAll()
s("SANDBOX-19c getAll returns all modules", () => {
  if (all19.length !== 2) throw new Error(`Expected 2, got ${all19.length}`)
})

// SANDBOX-20: sandboxExecute — null/undefined input
const sb20_code = `function handler(input) { return { exists: !!input, keys: Object.keys(input || {}) }; }`
const sb20r = sandboxExecute(sb20_code, {})
s("SANDBOX-20a empty object input works", () => {
  if (!sb20r.success) throw new Error(`Failed: ${sb20r.error}`)
})
s("SANDBOX-20b returns correct result", () => {
  if (!sb20r.output?.exists) throw new Error("expected exists=true")
})

console.log(`  Sandbox: ${sPassed} passed, ${sFailed} failed`)
state.passed += sPassed; state.failed += sFailed
console.log(`__RESULT__:${JSON.stringify({passed:state.passed,failed:state.failed})}`)
// Standalone: if (state.failed > 0) process.exit(1)
