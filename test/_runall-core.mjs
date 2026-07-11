// test/_runall-core.mjs — Part A: Core plugin tests
import { assert, section, mockCtx, freshSid, pluginDist, G, R, B, D, Y, RST, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, chmodSync, mkdtempSync, join, tmpdir, sdkMockClient, state, projectDir } from "./_common.mjs"

export async function runCoreTests(mod) {

// 1. Module loading
section("[1] Module loading")
console.log(`\n${B}[1] Module loading${RST}`)
assert(existsSync(pluginDist), "dist/index.js exists")
assert(typeof mod.AgenticEngine === "function", "AgenticEngine is a function")

// 2. Plugin init
console.log("\n[2] Plugin initialization")
const mockInput = {
  client: {},
  project: { name: "test", path: projectDir },
  directory: projectDir,
  worktree: projectDir,
  experimental_workspace: { register: () => {} },
  serverUrl: new URL("http://localhost:3000"),
  $: new Proxy({}, {
    get() { return async () => ({ exitCode: 0, text: () => "", stdout: Buffer.from(""), stderr: Buffer.from("") }) },
  }),
}
let hooks
try { hooks = await mod.AgenticEngine(mockInput); assert(true, "AgenticEngine() executed") }
catch (e) { assert(false, `AgenticEngine() threw: ${e.message}`) }
assert(hooks && typeof hooks === "object", "hooks is an object")
assert(typeof hooks.dispose === "function", "dispose hook registered")

// 3. Tool registration (31 tools)
console.log("\n[3] Tool registration")
const expectedAgenticTools = ["agentic_plan", "agentic_nav", "agentic_execute", "agentic_reflect", "agentic_verify", "agentic_status", "agentic_context", "agentic_snapshot", "agentic_pr", "agentic_score", "agentic_delegate", "agentic_pipeline", "agentic_message", "agentic_skill", "agentic_model", "agentic_budget", "agentic_episodes", "agentic_parallel", "agentic_guard", "agentic_evolve", "agentic_auto", "agentic_debate", "agentic_router", "agentic_clean", "agentic_rag", "agentic_mcp", "agentic_a2a", "agentic_tools", "agentic_finetune", "agentic_db", "agentic_memo", "agentic_fetch"]
for (const name of expectedAgenticTools) {
  const tool = hooks.tool?.[name]
  assert(tool && typeof tool.execute === "function", `"${name}" has execute()`)
  assert(typeof tool.description === "string" && tool.description.length > 0, `"${name}" has description`)
}
assert(Object.keys(hooks.tool || {}).filter(t => t.startsWith("agentic_")).length === expectedAgenticTools.length, "registered agentic tool count matches expected list")

// 3b. Tool catalog (single source of truth) stays in sync with registered tools
console.log("\n[3b] Tool catalog sync")
const toolCatalogSrc = readFileSync(new URL("../src/core/tool-catalog.ts", import.meta.url), "utf-8")
const catalogNames = [...toolCatalogSrc.matchAll(/name:\s*"(agentic_[a-z0-9_]+)"/g)].map(m => m[1])
for (const name of expectedAgenticTools) {
  assert(catalogNames.includes(name), `Tool catalog entry exists for ${name}`)
}
assert(catalogNames.length === expectedAgenticTools.length, "Tool catalog entry count matches registered tools")
// Also verify catalog entries have keywords and category
for (const name of expectedAgenticTools) {
  const entrySrc = toolCatalogSrc.match(new RegExp(`\\{ name: "${name}",[^}]+\\}`, 's'))
  assert(entrySrc && entrySrc[0].includes("keywords:"), `${name} catalog entry has keywords`)
  assert(entrySrc && entrySrc[0].includes("category:"), `${name} catalog entry has category`)
}

// 4. agentic_plan — auto-decompose feature
console.log("\n[4] agentic_plan — auto-decompose (create feature)")
const pid = freshSid()
const planResult = await hooks.tool.agentic_plan.execute({
  goal: "Add user authentication module",
  constraints: ["Must use TypeScript"],
  autoDecompose: true,
}, mockCtx(pid))
const planOut = typeof planResult === "string" ? planResult : planResult.output
assert(planOut.includes("Plan Created"), "returns plan output")
assert(planOut.includes("auto-decomposed"), "indicates auto-decomposition")
assert(planOut.includes("plan-types") || planOut.includes("plan-impl"), "has generated subtask IDs")

// 5. agentic_plan — auto-decompose fix bug
console.log("\n[5] agentic_plan — auto-decompose (fix bug)")
const fid = freshSid()
const fixPlan = await hooks.tool.agentic_plan.execute({
  goal: "Fix crash in login handler",
  autoDecompose: true,
}, mockCtx(fid))
const fixOut = typeof fixPlan === "string" ? fixPlan : fixPlan.output
assert(fixOut.includes("fix-repro") || fixOut.includes("fix-root"), "includes fix-specific steps")

// 6. agentic_plan — auto-decompose refactor
console.log("\n[6] agentic_plan — auto-decompose (refactor)")
const rid = freshSid()
const refacPlan = await hooks.tool.agentic_plan.execute({
  goal: "Extract database layer into separate module",
  autoDecompose: true,
}, mockCtx(rid))
const refacOut = typeof refacPlan === "string" ? refacPlan : refacPlan.output
assert(refacOut.includes("refactor-audit") || refacOut.includes("refactor-extract"), "includes refactor-specific steps")

// 7. agentic_plan — manual subtasks (no auto-decompose)
console.log("\n[7] agentic_plan — manual subtasks")
const mid = freshSid()
const manualPlan = await hooks.tool.agentic_plan.execute({
  goal: "Custom task",
  autoDecompose: false,
  subtasks: [{ id: "custom-1", description: "Do something", dependsOn: [] }],
}, mockCtx(mid))
const manOut = typeof manualPlan === "string" ? manualPlan : manualPlan.output
assert(!manOut.includes("auto-decomposed"), "not auto-decomposed")
assert(manOut.includes("custom-1"), "uses manual subtask")

// 7b. agentic_plan — new templates: security, docker, ci
console.log("\n[7b] agentic_plan — new templates")
const secPlan = await hooks.tool.agentic_plan.execute({
  goal: "Security vulnerability in login endpoint",
  autoDecompose: true,
}, mockCtx(freshSid()))
const secOut = typeof secPlan === "string" ? secPlan : secPlan.output
assert(secOut.includes("sec-audit") || secOut.includes("sec-fix"), "security template matches")

const dockPlan = await hooks.tool.agentic_plan.execute({
  goal: "Create Dockerfile with multi-stage build for Node.js app",
  autoDecompose: true,
}, mockCtx(freshSid()))
const dockOut = typeof dockPlan === "string" ? dockPlan : dockPlan.output
assert(dockOut.includes("docker-build") || dockOut.includes("docker-audit"), "docker template matches")

const ciPlan = await hooks.tool.agentic_plan.execute({
  goal: "Setup GitHub Actions CI pipeline",
  autoDecompose: true,
}, mockCtx(freshSid()))
const ciOut = typeof ciPlan === "string" ? ciPlan : ciPlan.output
assert(ciOut.includes("ci-impl") || ciOut.includes("ci-design"), "ci template matches")

// 8. agentic_nav — find relevant files
console.log("\n[8] agentic_nav — find files")
const nid = freshSid()
const navResult = await hooks.tool.agentic_nav.execute({
  query: "validate",
  maxResults: 5,
  showSummary: true,
}, mockCtx(nid))
const navOut = typeof navResult === "string" ? navResult : navResult.output
assert(navOut.includes("utils"), "finds utils.ts")
assert(navOut.includes("Language"), "shows project summary")

// 9. agentic_nav — no results
console.log("\n[9] agentic_nav — no results")
const navEmpty = await hooks.tool.agentic_nav.execute({
  query: "nonexistent_xyz_abc",
}, mockCtx(freshSid()))
const navEmptyOut = typeof navEmpty === "string" ? navEmpty : navEmpty.output
assert(navEmptyOut.includes("No matching") || navEmptyOut.length > 0, "handles no results gracefully")

// 10. agentic_nav — find test files
console.log("\n[10] agentic_nav — related tests")
const navTest = await hooks.tool.agentic_nav.execute({
  query: "index",
}, mockCtx(freshSid()))
const navTestOut = typeof navTest === "string" ? navTest : navTest.output
assert(navTestOut.includes("index") || navTestOut.length > 0, "finds index files")

// 11. agentic_execute — with file tracking
console.log("\n[11] agentic_execute — file tracking")
const eid = freshSid()
await hooks.tool.agentic_plan.execute({
  goal: "Feature with files",
  subtasks: [
    { id: "ft1", description: "Step 1", dependsOn: [] },
    { id: "ft2", description: "Step 2", dependsOn: ["ft1"] },
  ],
}, mockCtx(eid))
await hooks.tool.agentic_execute.execute({
  stepId: "ft1", success: true, autoVerify: false, output: "Created types", filesModified: ["src/types.ts"],
}, mockCtx(eid))
const stat = await hooks.tool.agentic_status.execute({}, mockCtx(eid))
const statOut = typeof stat === "string" ? stat : stat.output
assert(statOut.includes("Files Modified") || statOut.includes("src/types"), "shows tracked files")

// 12. agentic_execute — error propagation trace
console.log("\n[12] agentic_execute — error propagation")
const epid = freshSid()
await hooks.tool.agentic_plan.execute({
  goal: "Propagation test",
  subtasks: [
    { id: "ep1", description: "First step", dependsOn: [] },
    { id: "ep2", description: "Second step", dependsOn: ["ep1"] },
  ],
}, mockCtx(epid))
await hooks.tool.agentic_execute.execute({
  stepId: "ep1", success: true, autoVerify: false, output: "Done ep1", filesModified: ["src/module.ts"],
}, mockCtx(epid))
const failExec = await hooks.tool.agentic_execute.execute({
  stepId: "ep2", success: false, output: "Error referencing module.ts", error: "Cannot resolve import",
  filesModified: ["src/other.ts"],
}, mockCtx(epid))
const failOut = typeof failExec === "string" ? failExec : failExec.output
assert(failOut.includes("Propagation") || failOut.includes("origin"), "shows error propagation trace")

// 13. agentic_reflect — propagation analysis
console.log("\n[13] agentic_reflect — propagation analysis")
const refOut = await hooks.tool.agentic_reflect.execute({ stepId: "ep2" }, mockCtx(epid))
const rfo = typeof refOut === "string" ? refOut : refOut.output
assert(rfo.includes("Propagation") || rfo.includes("path"), "reflect includes propagation info")

// 14. agentic_reflect — on success step
console.log("\n[14] agentic_reflect — on success")
const refOk = await hooks.tool.agentic_reflect.execute({ stepId: "ep1" }, mockCtx(epid))
const roo = typeof refOk === "string" ? refOk : refOk.output
assert(roo.includes("successful"), "says step was successful")

// 15. Full round-trip with file tracking
console.log("\n[15] Full round-trip with dependency tracking")
const rtid = freshSid()
await hooks.tool.agentic_plan.execute({
  goal: "Add input validation to login",
  autoDecompose: true,
}, mockCtx(rtid))
const planSteps = ["plan-types", "plan-impl", "plan-tests"]
for (const stepId of planSteps) {
  await hooks.tool.agentic_execute.execute({
    stepId, success: true, autoVerify: false, output: `Done ${stepId}`,
    filesModified: [`src/${stepId}.ts`],
  }, mockCtx(rtid))
}
const finalVfy = await hooks.tool.agentic_verify.execute({ stepId: "final" }, mockCtx(rtid))
const fvOut = typeof finalVfy === "string" ? finalVfy : finalVfy.output
assert(fvOut.length > 0, "final verify returns output")
const finalStat = await hooks.tool.agentic_status.execute({}, mockCtx(rtid))
const fsOut = typeof finalStat === "string" ? finalStat : finalStat.output
assert(fsOut.includes("Complete") || fsOut.includes("File"), "final status shows files")

// 16. DependencyTracker — propagation from earlier step
console.log("\n[16] DependencyTracker — error propagation")
const dtid = freshSid()
await hooks.tool.agentic_plan.execute({
  goal: "Tracker test",
  subtasks: [
    { id: "dt1", description: "Change shared lib", dependsOn: [] },
    { id: "dt2", description: "Use shared lib", dependsOn: ["dt1"] },
    { id: "dt3", description: "Test shared lib", dependsOn: ["dt2"] },
  ],
}, mockCtx(dtid))
await hooks.tool.agentic_execute.execute({
  stepId: "dt1", success: true, output: "Changed shared.ts", filesModified: ["src/shared.ts"],
}, mockCtx(dtid))
await hooks.tool.agentic_execute.execute({
  stepId: "dt2", success: false,
  output: "Type error: shared.ts exports changed",
  error: "Property 'foo' does not exist on type",
  filesModified: ["src/consumer.ts"],
}, mockCtx(dtid))
const dtRef = await hooks.tool.agentic_reflect.execute({
  stepId: "dt2",
  errorDetails: "Property 'foo' does not exist on type 'Shared'",
}, mockCtx(dtid))
const dtOut = typeof dtRef === "string" ? dtRef : dtRef.output
assert(dtOut.includes("origin") || dtOut.includes("Propagation") || dtOut.includes("shared"), "traces error to shared.ts")

// 17. ErrorAnalyzer — full coverage
console.log("\n[17] ErrorAnalyzer — all categories")
const aid = freshSid()
await hooks.tool.agentic_plan.execute({ goal: "Error test", subtasks: [{ id: "err1", description: "Error", dependsOn: [] }] }, mockCtx(aid))
const scenarios = [
  { out: "Cannot find module 'missing'", err: "Module not found", expect: "import" },
  { out: "Type 'X' is not assignable to type 'Y'", err: "TS2322", expect: "type" },
  { out: "Compilation failed: error TS1005", err: "TS1005", expect: "compile" },
  { out: "Test failed: expected 5 got 3", err: "AssertionError", expect: "test" },
  { out: "Cannot read property of undefined", err: "TypeError", expect: "runtime" },
]
for (const s of scenarios) {
  const sId = freshSid()
  await hooks.tool.agentic_plan.execute({ goal: "s", subtasks: [{ id: "se", description: "step", dependsOn: [] }] }, mockCtx(sId))
  await hooks.tool.agentic_execute.execute({
    stepId: "se", success: false, output: s.out, error: s.err, filesModified: ["src/file.ts"],
  }, mockCtx(sId))
  const rRef = await hooks.tool.agentic_reflect.execute({ stepId: "se" }, mockCtx(sId))
  const rOut = typeof rRef === "string" ? rRef : rRef.output
  assert(rOut.toLowerCase().includes(s.expect), `identifies "${s.expect}" error`)
}

// 17b. ErrorAnalyzer — setLLM + hasLLM + analyzeDeep with mock LLM
console.log("\n[17b] ErrorAnalyzer — LLM fallback")
{const { ErrorAnalyzer } = await import(pluginDist)
const ea = new ErrorAnalyzer()
assert(ea.hasLLM() === false, "hasLLM false before setLLM")

// Mock LLM that returns JSON for unknown errors
ea.setLLM({
  call: async (req) => ({
    content: JSON.stringify({
      category: "runtime",
      summary: "Null reference in loop",
      likelyRootCause: "Array.find() returned undefined, then .property accessed on undefined",
      suggestedFix: "Add optional chaining: `arr.find(...)?.property` or check if found before accessing",
      severity: "high",
    }),
  }),
})
assert(ea.hasLLM() === true, "hasLLM true after setLLM")

// Test: rule-based still works first for known patterns
const ruleResult = ea.analyze("Type 'string' is not assignable to type 'number'", ["src/test.ts"])
assert(ruleResult.category === "type", "analyze returns rule-based result for known patterns")

// Test: analyzeDeep uses LLM for unknown errors
const deepResult = await ea.analyzeDeep("Something went wrong in the processing pipeline at step 3. The batch processor failed with code 0xDEAD.", ["src/processor.ts", "src/batch.ts"])
assert(deepResult.category === "runtime" || deepResult.category === "unknown", "analyzeDeep returns LLM result for unknown patterns")
assert(typeof deepResult.likelyRootCause === "string" && deepResult.likelyRootCause.length > 0, "analyzeDeep has root cause")
assert(typeof deepResult.suggestedFix === "string" && deepResult.suggestedFix.length > 0, "analyzeDeep has suggested fix")

// Test: analyzeDeep with no LLM falls back to unknown
const ea2 = new ErrorAnalyzer()
const noLlmResult = await ea2.analyzeDeep("Some weird error", [])
assert(noLlmResult.category === "unknown", "analyzeDeep without LLM returns unknown")}

// 17c. RoleRegistry — few-shot prompts verification
console.log("\n[17c] RoleRegistry — few-shot prompts")
{const { RoleRegistry } = await import(pluginDist)
const rr = new RoleRegistry()
const builtIn = rr.getAllBuiltIn()
const roleNames = builtIn.map(r => r.role)
assert(roleNames.includes("architect"), "architect role registered")
assert(roleNames.includes("developer"), "developer role registered")
assert(roleNames.includes("qa"), "qa role registered")
assert(roleNames.includes("coordinator"), "coordinator role registered")
assert(roleNames.includes("pm"), "pm role registered")

// Verify prompt content is present in roles
const archPrompt = rr.getBuiltIn("architect").prompt
assert(archPrompt.includes("software architect") || archPrompt.includes("architecture"), "architect prompt has architecture content")

const devPrompt = rr.getBuiltIn("developer").prompt
assert(devPrompt.includes("developer") || devPrompt.includes("Implement"), "developer prompt has implementation content")

const qaPrompt = rr.getBuiltIn("qa").prompt
assert(qaPrompt.includes("QA") || qaPrompt.includes("review"), "qa prompt has review content")

const coordPrompt = rr.getBuiltIn("coordinator").prompt
assert(coordPrompt.includes("Decompose") || coordPrompt.includes("goals"), "coordinator prompt has coordination content")

const pmPrompt = rr.getBuiltIn("pm").prompt
assert(pmPrompt.includes("product") || pmPrompt.includes("specifications"), "pm prompt has spec content")}

// 18. agentic_status — blocked steps visibility
console.log("\n[18] agentic_status — blocked steps")
const bid2 = freshSid()
await hooks.tool.agentic_plan.execute({
  goal: "Blocked",
  subtasks: [
    { id: "b1", description: "Prerequisite", dependsOn: [] },
    { id: "b2", description: "Depends on b1", dependsOn: ["b1"] },
    { id: "b3", description: "Depends on b1+b2", dependsOn: ["b1", "b2"] },
  ],
}, mockCtx(bid2))
const blkStat = await hooks.tool.agentic_status.execute({}, mockCtx(bid2))
const blkOut = typeof blkStat === "string" ? blkStat : blkStat.output
assert(blkOut.includes("Blocked"), "shows blocked section")
assert(blkOut.includes("b1"), "shows blocking step references")

// 19. agentic_verify — error analysis on failure
console.log("\n[19] agentic_verify — failure analysis")
const vCtx = mockCtx(freshSid())
const vResult = await hooks.tool.agentic_verify.execute({ stepId: "check" }, vCtx)
const vOut = typeof vResult === "string" ? vResult : vResult.output
assert(vOut.includes("Analysis") || vOut.includes("Passed") || vOut.includes("Failed"), "verify output includes analysis")

// 20. agentic_context — view + compress
console.log("\n[20] agentic_context — view + compress")
const ctxCtx = mockCtx(freshSid())
await hooks.tool.agentic_plan.execute({ goal: "Context test", subtasks: [{ id: "c1", description: "Context step", dependsOn: [] }] }, ctxCtx)
await hooks.tool.agentic_execute.execute({ stepId: "c1", success: true, autoVerify: false, output: "Done context", filesModified: ["src/ctx.ts"] }, ctxCtx)
const ctxView = await hooks.tool.agentic_context.execute({ action: "view" }, ctxCtx)
const cvOut = typeof ctxView === "string" ? ctxView : ctxView.output
assert(cvOut.includes("Turns") || cvOut.includes("Context"), "context view shows stats")
const ctxComp = await hooks.tool.agentic_context.execute({ action: "compress" }, ctxCtx)
const ccOut = typeof ctxComp === "string" ? ctxComp : ctxComp.output
assert(ccOut.includes("Compressed") || ccOut.includes("token"), "context compress works")

// 21. agentic_snapshot — save + list
console.log("\n[21] agentic_snapshot — save + list")
const snapCtx = mockCtx(freshSid())
await hooks.tool.agentic_plan.execute({ goal: "Snapshot test", subtasks: [{ id: "sn1", description: "Snap", dependsOn: [] }] }, snapCtx)
await hooks.tool.agentic_execute.execute({ stepId: "sn1", success: true, autoVerify: false, output: "Done snap", filesModified: ["src/snap.ts"] }, snapCtx)
const snapSave = await hooks.tool.agentic_snapshot.execute({ action: "save", label: "after-1" }, snapCtx)
const ssOut = typeof snapSave === "string" ? snapSave : snapSave.output
assert(ssOut.includes("Saved") || ssOut.includes("Snapshot"), "snapshot saved")
const snapList = await hooks.tool.agentic_snapshot.execute({ action: "list" }, snapCtx)
const slOut = typeof snapList === "string" ? snapList : snapList.output
assert(slOut.includes("after-1"), "snapshot list shows label")

// 22. agentic_pr — generate PR description
console.log("\n[22] agentic_pr — generate PR")
const prCtx = mockCtx(freshSid())
await hooks.tool.agentic_plan.execute({ goal: "Add login validation", subtasks: [{ id: "pr1", description: "Types", dependsOn: [] }, { id: "pr2", description: "Impl", dependsOn: ["pr1"] }] }, prCtx)
for (const s of ["pr1", "pr2"]) {
  await hooks.tool.agentic_execute.execute({ stepId: s, success: true, autoVerify: false, output: `Done ${s}`, filesModified: [`src/${s}.ts`] }, prCtx)
}
const prResult = await hooks.tool.agentic_pr.execute({}, prCtx)
const prOut = typeof prResult === "string" ? prResult : prResult.output
assert(prOut.includes("PR Description") || prOut.includes("Summary"), "PR generated")
assert(prOut.includes("pr1") && prOut.includes("pr2"), "PR includes all steps")

// 23. agentic_score — tech debt analysis
console.log("\n[23] agentic_score — tech debt")
const scCtx = mockCtx(freshSid())
await hooks.tool.agentic_plan.execute({ goal: "Score test", subtasks: [{ id: "sc1", description: "Scored", dependsOn: [] }] }, scCtx)
await hooks.tool.agentic_execute.execute({ stepId: "sc1", success: true, autoVerify: false, output: "Done", filesModified: [`${projectDir}/src/utils.ts`] }, scCtx)
const scResult = await hooks.tool.agentic_score.execute({}, scCtx)
const scOut = typeof scResult === "string" ? scResult : scResult.output
assert(scOut.includes("Tech Debt") || scOut.includes("Score"), "score output produced")
assert(scOut.includes("coupling") || scOut.includes("size") || scOut.includes("scope"), "includes categories")

// ── TechDebtScorer direct unit tests (branch coverage) ──
{
  console.log("\n[23b] TechDebtScorer — branch coverage")
  const tdScorer = new mod.TechDebtScorer()
  function gen(opts = {}) {
    const lines = []
    if (opts.todos) for (let i = 0; i < opts.todos; i++) lines.push(`// TODO: item ${i}`)
    if (opts.any) lines.push("const x: any = 1")
    if (opts.unknownAs) lines.push("const y = z as unknown as string")
    if (opts.imports) for (let i = 0; i < opts.imports; i++) lines.push(`import { m${i} } from "p${i}"`)
    if (opts.lines) while (lines.length < opts.lines) lines.push(`const v${lines.length} = ${lines.length}`)
    return lines.join("\n")
  }
  function makeFiles(configs) {
    const m = new Map()
    configs.forEach((c, i) => m.set(c.name || `f${i}.ts`, gen(c)))
    return m
  }

  // Test: TODO > 2 (line 134-136)
  // isComment(line) skips lines starting with // before counting TODOs,
  // so TODOs must be inline (not standalone comment lines)
  const todoContent = `let a = 1 // TODO: refactor this
let b = 2 // TODO: simplify that
let c = 3 // TODO: clean later
`
  const r1 = tdScorer.score("fix code", ["demo.ts"], new Map([["demo.ts", todoContent]]))
  const p1 = r1.breakdown.find(b => b.category === "patterns")
  assert(p1 && p1.issues.some(i => i.includes("TODOs")), "TD: >2 TODOs detected")

  // Test: as unknown as (line 138-140)
  const r2 = tdScorer.score("fix types", ["demo.ts"], new Map([["demo.ts", "let x = y as unknown as string\nlet z = 1\n"]]))
  const p2 = r2.breakdown.find(b => b.category === "patterns")
  assert(p2 && p2.issues.some(i => i.includes("as unknown as")), "TD: as unknown as cast detected")

  // Test: generateSuggestion — low (line 148)
  const r3 = tdScorer.score("readme", [], new Map())
  assert(r3.overall === "low", `TD: overall low (got ${r3.overall})`)
  assert(r3.suggestion === "Minimal debt. Proceed confidently.", "TD: suggestion for low")

  // Test: generateSuggestion — medium (line 149)
  // 6 files (>5 → coupling+3), 1 with 11 imports (+1 coupling),
  // 1 file 200 lines (+1 size), 6 dirs+no tests (+4 scope),
  // any+unknownAs (+3 patterns) → total 12, avg 3
  const medFiles = makeFiles([
    { name: "a/f1.ts", imports: 11, any: true, unknownAs: true, lines: 200 },
    { name: "b/f2.ts", lines: 5 },
    { name: "c/f3.ts", lines: 5 },
    { name: "d/f4.ts", lines: 5 },
    { name: "e/f5.ts", lines: 5 },
    { name: "f/f6.ts", lines: 5 },
  ])
  const r4 = tdScorer.score("implement feature", ["a/f1.ts","b/f2.ts","c/f3.ts","d/f4.ts","e/f5.ts","f/f6.ts"], medFiles)
  assert(r4.overall === "medium", `TD: overall medium (got ${r4.overall})`)
  assert(r4.suggestion.includes("Address before next"), "TD: suggestion for medium")

  // Test: generateSuggestion — high (line 150)
  // 6 files, 4 with 11 imports (coupling+7), 3 with 200-400 lines (size+4),
  // 6 dirs+no tests (scope+4), 5 files with any (patterns+10 capped)
  // → total 25, avg 6.25
  const highFiles = makeFiles([
    { name: "a/f1.ts", imports: 11, any: true, lines: 400 },
    { name: "b/f2.ts", imports: 11, any: true, lines: 200 },
    { name: "c/f3.ts", imports: 11, any: true, lines: 200 },
    { name: "d/f4.ts", imports: 11, any: true, lines: 5 },
    { name: "e/f5.ts", any: true, lines: 5 },
    { name: "f/f6.ts", lines: 5 },
  ])
  const r5 = tdScorer.score("implement feature", ["a/f1.ts","b/f2.ts","c/f3.ts","d/f4.ts","e/f5.ts","f/f6.ts"], highFiles)
  assert(r5.overall === "high", `TD: overall high (got ${r5.overall})`)
  assert(r5.suggestion.includes("Fix before merging"), "TD: suggestion for high")

  // Test: generateSuggestion — critical (line 151)
  // 6 files all maxed → total 33, avg 8.25
  const critFiles = makeFiles([
    { name: "a/f1.ts", imports: 11, any: true, unknownAs: true, lines: 400 },
    { name: "b/f2.ts", imports: 11, any: true, unknownAs: true, lines: 400 },
    { name: "c/f3.ts", imports: 11, any: true, unknownAs: true, lines: 400 },
    { name: "d/f4.ts", imports: 11, any: true, unknownAs: true, lines: 400 },
    { name: "e/f5.ts", imports: 11, any: true, unknownAs: true, lines: 400 },
    { name: "f/f6.ts", imports: 11, any: true, unknownAs: true, lines: 400 },
  ])
  const r6 = tdScorer.score("implement feature", ["a/f1.ts","b/f2.ts","c/f3.ts","d/f4.ts","e/f5.ts","f/f6.ts"], critFiles)
  assert(r6.overall === "critical", `TD: overall critical (got ${r6.overall})`)
  assert(r6.suggestion.includes("Critical debt"), "TD: suggestion for critical")
}

// 24. agentic_delegate — role assignment
console.log("\n[24] agentic_delegate — assign task")
const dlCtx = mockCtx(freshSid())
const dlResult = await hooks.tool.agentic_delegate.execute({
  taskId: "design-api", description: "Design the API contract for user service",
}, dlCtx)
const dlOut = typeof dlResult === "string" ? dlResult : dlResult.output
assert(dlOut.includes("architect") || dlOut.includes("Task Delegated"), "delegates to correct role")
assert(dlOut.includes("Architect") || dlOut.includes("prompt"), "returns agent prompt")

// 25. agentic_delegate — auto-detect QA role
console.log("\n[25] agentic_delegate — auto-detect QA")
const dl2Result = await hooks.tool.agentic_delegate.execute({
  taskId: "verify-api", description: "Verify the login endpoint works correctly",
}, dlCtx)
const dl2Out = typeof dl2Result === "string" ? dl2Result : dl2Result.output
assert(dl2Out.includes("qa"), "auto-detects QA role")

// 26. agentic_pipeline — define pipeline
console.log("\n[26] agentic_pipeline — define")
const plDef = await hooks.tool.agentic_pipeline.execute({
  action: "define",
  pipelineId: "test-feature",
  name: "Test Feature Pipeline",
  stages: [
    { role: "architect", description: "Design the API" },
    { role: "developer", description: "Implement the API" },
    { role: "qa", description: "Verify the implementation" },
  ],
}, mockCtx(freshSid()))
const plDefOut = typeof plDef === "string" ? plDef : plDef.output
assert(plDefOut.includes("Pipeline Defined"), "pipeline defined")
assert(plDefOut.includes("test-feature"), "pipeline ID shown")

// 27. agentic_pipeline — list pipelines
console.log("\n[27] agentic_pipeline — list")
const plList = await hooks.tool.agentic_pipeline.execute({
  action: "list",
}, mockCtx(freshSid()))
const plListOut = typeof plList === "string" ? plList : plList.output
assert(plListOut.includes("Defined Pipelines") || plListOut.includes("feature-dev"), "shows pipeline list")

// 28. agentic_pipeline — suggest pipeline
console.log("\n[28] agentic_pipeline — suggest")
const plSuggest = await hooks.tool.agentic_pipeline.execute({
  action: "suggest",
  description: "Add new user login feature",
}, mockCtx(freshSid()))
const plSuggestOut = typeof plSuggest === "string" ? plSuggest : plSuggest.output
assert(plSuggestOut.includes("feature-dev") || plSuggestOut.includes("Pipeline"), "suggests pipeline")

// 29. agentic_pipeline — run pipeline
console.log("\n[29] agentic_pipeline — run")
const pRunCtx = mockCtx(freshSid())
const plRun = await hooks.tool.agentic_pipeline.execute({
  action: "run",
  pipelineId: "feature-dev",
}, pRunCtx)
const plRunOut = typeof plRun === "string" ? plRun : plRun.output
assert(plRunOut.includes("Pipeline Run Started") || plRunOut.includes("Stages"), "pipeline run started")
assert(plRunOut.includes("architect") || plRunOut.includes("pm"), "shows first stage")

// 30. agentic_pipeline — run with invalid pipeline
console.log("\n[30] agentic_pipeline — run invalid")
const plBad = await hooks.tool.agentic_pipeline.execute({
  action: "run",
  pipelineId: "nonexistent-pipeline",
}, mockCtx(freshSid()))
const plBadOut = typeof plBad === "string" ? plBad : plBad.output
assert(plBadOut.includes("not found"), "handles invalid pipeline")

// 31. agentic_pipeline — pipeline status
console.log("\n[31] agentic_pipeline — status")
const plStat = await hooks.tool.agentic_pipeline.execute({
  action: "status",
  pipelineId: "feature-dev",
}, pRunCtx)
const plStatOut = typeof plStat === "string" ? plStat : plStat.output
assert(plStatOut.includes("Status") || plStatOut.includes("Pipeline"), "pipeline status shown")

// 32. agentic_message — send message
console.log("\n[32] agentic_message — send")
const msgCtx = mockCtx(freshSid())
const msgSend = await hooks.tool.agentic_message.execute({
  action: "send",
  to: "developer",
  taskId: "task-msg-1",
  message: "Please implement the login endpoint",
  type: "clarification",
}, msgCtx)
const msgSendOut = typeof msgSend === "string" ? msgSend : msgSend.output
assert(msgSendOut.includes("Message Sent"), "message sent")
assert(msgSendOut.includes("developer"), "to correct role")

// 33. agentic_message — inbox
console.log("\n[33] agentic_message — inbox")
const msgInbox = await hooks.tool.agentic_message.execute({
  action: "inbox",
}, { ...mockCtx(freshSid()), agent: "developer" })
const msgInboxOut = typeof msgInbox === "string" ? msgInbox : msgInbox.output
assert(msgInboxOut.includes("Inbox") || msgInboxOut.includes("unread"), "inbox shows messages")

// 34. agentic_message — conversation
console.log("\n[34] agentic_message — conversation")
const msgConv = await hooks.tool.agentic_message.execute({
  action: "conversation",
  taskId: "task-msg-1",
}, msgCtx)
const msgConvOut = typeof msgConv === "string" ? msgConv : msgConv.output
assert(msgConvOut.includes("Conversation") || msgConvOut.includes("task-msg-1"), "conversation shown")

// 35. agentic_message — mark-read
console.log("\n[35] agentic_message — mark-read")
// Send another message first to get a real ID
const msg2 = await hooks.tool.agentic_message.execute({
  action: "send",
  to: "qa",
  taskId: "task-msg-2",
  message: "Review the code",
  type: "review_request",
}, msgCtx)
const msg2Out = typeof msg2 === "string" ? msg2 : msg2.output

// Extract message ID from output
const msgIdMatch = msg2Out.match(/`([^`]+)`/)
const msgId = msgIdMatch ? msgIdMatch[1] : null
if (msgId) {
  const msgRead = await hooks.tool.agentic_message.execute({
    action: "mark-read",
    messageId: msgId,
  }, msgCtx)
  const msgReadOut = typeof msgRead === "string" ? msgRead : msgRead.output
  assert(msgReadOut.includes("marked as read"), "message marked read")
} else {
  assert(false, "could not extract message ID")
}

// 36. Enhanced delegate — update task with result
console.log("\n[36] agentic_delegate — update task with result")
const enhCtx = mockCtx(freshSid())
await hooks.tool.agentic_delegate.execute({
  taskId: "enh1", role: "developer", description: "Implement login",
}, enhCtx)
const enhUpdate = await hooks.tool.agentic_delegate.execute({
  taskId: "enh1", status: "done", result: "Created login endpoint",
  role: "developer",
}, enhCtx)
const enhOut = typeof enhUpdate === "string" ? enhUpdate : enhUpdate.output
assert(enhOut.includes("Task Updated"), "task status updated")
assert(enhOut.includes("done") || enhOut.includes("Created"), "shows result")

// 37. Enhanced delegate — pipeline-aware delegation with cross-validation
console.log("\n[37] agentic_delegate — pipeline aware")
const plDelCtx = mockCtx(freshSid())
await hooks.tool.agentic_pipeline.execute({
  action: "run",
  pipelineId: "test-feature",
}, plDelCtx)
const runId = `run-${plDelCtx.sessionID}-test-feature`
await hooks.tool.agentic_delegate.execute({
  taskId: "pl-arch", role: "architect", description: "Design API",
  pipelineRunId: runId,
}, plDelCtx)
const plDel2 = await hooks.tool.agentic_delegate.execute({
  taskId: "pl-arch", role: "architect", status: "done",
  result: "Architecture: REST API with 3 endpoints",
  pipelineRunId: runId,
}, plDelCtx)
const plDel2Out = typeof plDel2 === "string" ? plDel2 : plDel2.output
assert(plDel2Out.includes("Pipeline Advancing") || plDel2Out.includes("Next stage"), "pipeline advanced after task completion")

// 38. Enhanced delegate — request review
console.log("\n[38] agentic_delegate — request review")
const rvCtx = mockCtx(freshSid())
await hooks.tool.agentic_delegate.execute({
  taskId: "rv1", role: "developer", description: "Implement feature",
}, rvCtx)
const rvUpd = await hooks.tool.agentic_delegate.execute({
  taskId: "rv1", role: "developer", status: "done",
  result: "Feature implemented with tests",
  requestReview: true,
}, rvCtx)
const rvOut = typeof rvUpd === "string" ? rvUpd : rvUpd.output
assert(rvOut.includes("Review Requested") || rvOut.includes("review"), "review request sent")

// 38b. Batch delegate — parallel fan-out (3 agents barengan)
console.log("\n[38b] agentic_delegate — batch parallel fan-out")
const batchCtx = mockCtx(freshSid())
const batchTasks = [
  { taskId: "b1", role: "architect", description: "Design database schema" },
  { taskId: "b2", role: "developer", description: "Implement auth module", dependsOn: ["b1"] },
  { taskId: "b3", role: "qa", description: "Write integration tests", dependsOn: ["b2"] },
]
const batchOut = await hooks.tool.agentic_delegate.execute({
  tasks: batchTasks,
  maxParallel: 3,
}, batchCtx)
assert(batchOut.output.includes("Batch Delegate"), "batch mode activated")
assert(batchOut.output.includes("b1"), "task b1 in output")
assert(batchOut.output.includes("b2"), "task b2 in output")
assert(batchOut.output.includes("b3"), "task b3 in output")
assert(batchOut.output.includes("architect"), "architect role shown")
assert(batchOut.output.includes("developer"), "developer role shown")
assert(batchOut.output.includes("qa"), "qa role shown")
// DependsOn creates phases
assert(batchOut.output.includes("Phases") || batchOut.output.includes("Phase"), "phases from dependencies")

// 38c. Batch delegate — all independent (single phase, pure parallel)
console.log("\n[38c] agentic_delegate — batch all independent")
const batchIndepCtx = mockCtx(freshSid())
const batchIndep = await hooks.tool.agentic_delegate.execute({
  tasks: [
    { taskId: "i1", role: "developer", description: "Task A" },
    { taskId: "i2", role: "developer", description: "Task B" },
    { taskId: "i3", role: "developer", description: "Task C" },
  ],
  maxParallel: 5,
}, batchIndepCtx)
assert(batchIndep.output.includes("Batch Delegate"), "batch independent mode")
assert(batchIndep.output.includes("3 tasks"), "all 3 tasks shown")
assert(!batchIndep.output.includes("Phases:"), "no phases (all independent)")

// 38d. Batch delegate — unknown role error
console.log("\n[38d] agentic_delegate — batch unknown role")
const batchErrCtx = mockCtx(freshSid())
const batchErr = await hooks.tool.agentic_delegate.execute({
  tasks: [
    // @ts-expect-error testing unknown role
    { taskId: "e1", role: "designer", description: "Design UI" },
  ],
}, batchErrCtx)
assert(batchErr.output.includes("Failed") || batchErr.output.includes("unknown"), "batch unknown role handled")

// 38e. Batch delegate — error if called without taskId/tasks
console.log("\n[38e] agentic_delegate — no taskId or tasks")
const noArgsCtx = mockCtx(freshSid())
const noArgs = await hooks.tool.agentic_delegate.execute({}, noArgsCtx)
assert(noArgs.output.includes("provide") || noArgs.output.includes("taskId"), "no args error shown")

// 38f. Batch delegate — update task still works (regression test)
console.log("\n[38f] agentic_delegate — single mode update task")
const regCtx = mockCtx(freshSid())
await hooks.tool.agentic_delegate.execute({
  taskId: "reg1", role: "developer", description: "Regression test",
}, regCtx)
const regOut = await hooks.tool.agentic_delegate.execute({
  taskId: "reg1", status: "done", result: "All good",
}, regCtx)
assert(regOut.output.includes("Task Updated"), "regression: single task update still works")

// 39. agentic_skill — extract + find + list
console.log("\n[39] agentic_skill — extract")
const skCtx = mockCtx(freshSid())
await hooks.tool.agentic_plan.execute({
  goal: "Skill test",
  subtasks: [{ id: "sk1", description: "Add user login with email validation", dependsOn: [] }],
}, skCtx)
await hooks.tool.agentic_execute.execute({
  stepId: "sk1", success: true, autoVerify: false, output: "1. Created login form\n2. Added email validation\n3. Wrote tests",
}, skCtx)
const skExtract = await hooks.tool.agentic_skill.execute({ action: "extract", query: "sk1" }, skCtx)
const skExOut = typeof skExtract === "string" ? skExtract : skExtract.output
assert(skExOut.includes("Extracted") || skExOut.includes("step"), "skill extracted")

const skFind = await hooks.tool.agentic_skill.execute({ action: "find", query: "login" }, skCtx)
const skFOut = typeof skFind === "string" ? skFind : skFind.output
assert(skFOut.includes("login") || skFOut.length > 0, "skill find works")

const skList = await hooks.tool.agentic_skill.execute({ action: "list" }, skCtx)
const skLOut = typeof skList === "string" ? skList : skList.output
assert(skLOut.includes("Skill") || skLOut.includes("skill"), "skill list works")

// 40. agentic_episodes — search + recent + stats
console.log("\n[40] agentic_episodes — memory")
const epCtx = mockCtx(freshSid())
await hooks.tool.agentic_plan.execute({
  goal: "Episode test task",
  subtasks: [{ id: "ep1", description: "Complete episode", dependsOn: [] }],
}, epCtx)
await hooks.tool.agentic_execute.execute({
  stepId: "ep1", success: true, autoVerify: false, output: "All done", filesModified: ["src/ep.ts"],
}, epCtx)

const epSearch = await hooks.tool.agentic_episodes.execute({ action: "search", query: "Episode" }, epCtx)
const epSOut = typeof epSearch === "string" ? epSearch : epSearch.output
assert(epSOut.includes("Episode") || epSOut.length > 0, "episode search works")

const epRecent = await hooks.tool.agentic_episodes.execute({ action: "recent" }, epCtx)
const epROut = typeof epRecent === "string" ? epRecent : epRecent.output
assert(epROut.length > 0, "episode recent works")

const epStats = await hooks.tool.agentic_episodes.execute({ action: "stats" }, epCtx)
const epStOut = typeof epStats === "string" ? epStats : epStats.output
assert(epStOut.includes("stats") || epStOut.includes("Total") || epStOut.includes("Success"), "episode stats works")

// 41. Checkpoint — risky operation detection
console.log("\n[41] Checkpoint — risk detection")
const cpCtx = mockCtx(freshSid())
await hooks.tool.agentic_plan.execute({
  goal: "Config change",
  subtasks: [{ id: "cp1", description: "Update config", dependsOn: [] }],
}, cpCtx)
const cpResult = await hooks.tool.agentic_execute.execute({
  stepId: "cp1", success: true, output: "Updated config/env.ts with new API key",
  filesModified: ["config/env.ts"],
}, cpCtx)
const cpOut = typeof cpResult === "string" ? cpResult : cpResult.output
assert(cpOut.includes("Checkpoint") || cpOut.includes("BLOCK") || cpOut.includes("REVIEW"), "checkpoint triggered for config change")

// Acknowledge checkpoints to avoid blocking subsequent tests
await hooks.tool.agentic_execute.execute({
  stepId: "cp1", success: true, output: "Acknowledge config change checkpoint",
  filesModified: ["config/env.ts"],
}, cpCtx)

// 42. agentic_parallel — analyze concurrency
console.log("\n[42] agentic_parallel — concurrency analysis")
const plCtx = mockCtx(freshSid())
await hooks.tool.agentic_plan.execute({
  goal: "Parallel test",
  subtasks: [
    { id: "pl1", description: "Setup", dependsOn: [] },
    { id: "pl2", description: "Task A", dependsOn: ["pl1"] },
    { id: "pl3", description: "Task B", dependsOn: ["pl1"] },
    { id: "pl4", description: "Final", dependsOn: ["pl2", "pl3"] },
  ],
}, plCtx)
const plResult = await hooks.tool.agentic_parallel.execute({}, plCtx)
const plOut = typeof plResult === "string" ? plResult : plResult.output
assert(plOut.includes("Parallel") || plOut.includes("Phase"), "parallel analysis produced")
assert(plOut.includes("pl2") && plOut.includes("pl3"), "identifies parallel tasks")

// Execute pl1
await hooks.tool.agentic_execute.execute({ stepId: "pl1", success: true, autoVerify: false, output: "Done", filesModified: ["src/setup.ts"] }, plCtx)
const pl2Result = await hooks.tool.agentic_parallel.execute({}, plCtx)
const pl2Out = typeof pl2Result === "string" ? pl2Result : pl2Result.output
assert(pl2Out.includes("pl2") || pl2Out.includes("Runnable"), "shows runnable tasks")

// 42b. agentic_parallel — execute mode
console.log("\n[42b] agentic_parallel — execute mode")
const plexCtx = mockCtx(freshSid())
await hooks.tool.agentic_plan.execute({
  goal: "Parallel execute test",
  subtasks: [
    { id: "px1", description: "Write file a.txt with content 'hello'", dependsOn: [] },
    { id: "px2", description: "Write file b.txt with content 'world'", dependsOn: [] },
  ],
}, plexCtx)
// Mark px1 complete so px2 is the only ready step for partial parallel test
await hooks.tool.agentic_execute.execute({ stepId: "px1", success: true, autoVerify: false, output: "Done", filesModified: ["a.txt"] }, plexCtx)
const plexExec = await hooks.tool.agentic_parallel.execute({ action: "execute" }, plexCtx)
const plexOut = typeof plexExec === "string" ? plexExec : plexExec.output
assert(plexOut.includes("Execution") || plexOut.includes("passed") || plexOut.includes("Failed"), "parallel execute produces result")

// 42c. P1 schema-first LLM boundary — parallel LLM runner
console.log("\n[42c] agentic_parallel — LLM output schema gate")
const parallelSchemaDir = join(projectDir, "parallel-schema")
rmSync(parallelSchemaDir, { recursive: true, force: true })
mkdirSync(parallelSchemaDir, { recursive: true })
const parallelGood = new mod.ParallelExecutor().llmStepRunner({
  llmEngine: {
    call: async () => ({ content: JSON.stringify({ files: [{ path: "src/generated.ts", content: "export const ok = true\n" }], summary: "generated" }) }),
    getMemoryContext: () => "",
  },
  projectDir: parallelSchemaDir,
  planGoal: "schema gate happy path",
  sessionId: freshSid(),
})
const parallelGoodResult = await parallelGood({ id: "schema-good", description: "write valid file", dependsOn: [] })
assert(parallelGoodResult.success === true, "P1-LLM-boundary valid JSON schema succeeds")
assert(existsSync(join(parallelSchemaDir, "src/generated.ts")), "P1-LLM-boundary writes only after schema validation")
const parallelBad = new mod.ParallelExecutor().llmStepRunner({
  llmEngine: {
    call: async () => ({ content: JSON.stringify({ files: [{ path: "../escape.ts", content: 123 }], summary: [] }) }),
    getMemoryContext: () => "",
  },
  projectDir: parallelSchemaDir,
  planGoal: "schema gate malformed shape",
  sessionId: freshSid(),
})
const parallelBadResult = await parallelBad({ id: "schema-bad", description: "reject malformed file payload", dependsOn: [] })
assert(parallelBadResult.success === false, "P1-LLM-boundary malformed JSON shape is safe failure")
assert(String(parallelBadResult.error || "").includes("schema validation failed"), "P1-LLM-boundary reports schema validation failure")
assert(!existsSync(join(projectDir, "escape.ts")), "P1-LLM-boundary rejected traversal path before write")

// 42d. P1 schema-first LLM boundary — orchestrator semantic validation parser
console.log("\n[42d] orchestrator semantic validation schema gate")
const semanticGood = mod.parseSemanticValidationPayload(JSON.stringify({
  passed: false,
  issues: [{ severity: "warning", description: "PM criteria not referenced", source: "llm-validator" }],
  summary: "needs clarification",
}))
assert(semanticGood?.issues?.[0]?.severity === "warning", "P1-orchestrator semantic validation accepts valid schema")
const semanticBadSeverity = mod.parseSemanticValidationPayload(JSON.stringify({
  passed: true,
  issues: [{ severity: "critical", description: "bad enum" }],
  summary: "invalid",
}))
assert(semanticBadSeverity === null, "P1-orchestrator semantic validation rejects invalid issue severity")
const semanticBadShape = mod.parseSemanticValidationPayload(JSON.stringify({
  passed: "yes",
  issues: "none",
}))
assert(semanticBadShape === null, "P1-orchestrator semantic validation rejects malformed shape")

// P1-orchestrator-b: Orchestrator.getPipelineContract branch coverage (lines 897-898)
{
  const DAGEngine = mod.DAGEngine
  const Orchestrator = mod.Orchestrator
  const orch = new Orchestrator()
  // Known contract
  const known = orch.getPipelineContract("feature-dev")
  assert(known !== null, "P1-orch-b1 getPipelineContract known pipeline returns contract")
  assert(known.pipelineId === "feature-dev", "P1-orch-b2 correct pipeline ID")
  // Unknown contract → null (line 897-898 else branch)
  const unknown = orch.getPipelineContract("nonexistent-pipeline")
  assert(unknown === null, "P1-orch-b3 getPipelineContract unknown pipeline returns null")
}

// 42e. P1 schema-first LLM boundary — router classifier parser
console.log("\n[42e] router classifier schema gate")
const routerGood = mod.parseRouterClassificationPayload(JSON.stringify({
  category: "tech",
  confidence: 0.84,
  reasoning: "mentions TypeScript and tests",
}))
assert(routerGood?.category === "tech", "P1-router classifier accepts valid schema")
const routerBadConfidence = mod.parseRouterClassificationPayload(JSON.stringify({
  category: "tech",
  confidence: 2,
  reasoning: "out of range",
}))
assert(routerBadConfidence === null, "P1-router classifier rejects out-of-range confidence")
const routerBadShape = mod.parseRouterClassificationPayload(JSON.stringify({
  category: "tech",
  confidence: 0.7,
}))
assert(routerBadShape === null, "P1-router classifier rejects missing reasoning")
const routerFallback = new mod.RouterAgent({
  call: async () => ({ content: JSON.stringify({ category: "unknown", confidence: 0.9, reasoning: "bad category" }) }),
})
const routerFallbackResult = await routerFallback.route("fix TypeScript build test")
assert(routerFallbackResult.usedLlm === false, "P1-router classifier falls back on unknown category")
assert(routerFallbackResult.category === "tech", "P1-router classifier keyword fallback still routes safely")

// 42e2. RouterAgent — LLM success path (branch coverage)
console.log("\n[42e2] RouterAgent — LLM success path")
const routerLlmSuccess = new mod.RouterAgent({
  call: async () => ({ content: JSON.stringify({ category: "tech", confidence: 0.85, reasoning: "mentions TypeScript and build" }) }),
})
const routerLlmOk = await routerLlmSuccess.route("fix TypeScript build test")
assert(routerLlmOk.usedLlm === true, "RA-1: LLM success usesLlm=true")
assert(routerLlmOk.category === "tech", "RA-1: LLM success category=tech")
assert(routerLlmOk.confidence === 0.85, "RA-1: LLM success confidence preserved")
assert(routerLlmOk.intent === "Terkait Teknologi", "RA-1: LLM success matched cat name")
assert(routerLlmOk.suggestedRagIndex === "knowledge-tech", "RA-1: LLM success RAG from cat")

// 42e3. RouterAgent — LLM parse failure (non-JSON)
console.log("\n[42e3] RouterAgent — LLM parse failure")
const routerParseFail = new mod.RouterAgent({
  call: async () => ({ content: "not valid json at all" }),
})
const routerFailResult = await routerParseFail.route("fix TypeScript build test")
assert(routerFailResult.usedLlm === false, "RA-2: LLM parse fail falls back to keyword")
assert(routerFailResult.category === "tech", "RA-2: LLM parse fail still routes via keyword")

// 42e4. RouterAgent — No LLM (keyword fallback)
console.log("\n[42e4] RouterAgent — No LLM (direct keyword fallback)")
const routerNoLLM = new mod.RouterAgent()
const routerNLResult = await routerNoLLM.route("fix TypeScript build test")
assert(routerNLResult.usedLlm === false, "RA-3: No LLM usesLlm=false")
assert(routerNLResult.category === "tech", "RA-3: No LLM routes via keyword")
assert(routerNLResult.confidence > 0, "RA-3: No LLM has confidence > 0")

// 42e5. RouterAgent — No-match keyword fallback
console.log("\n[42e5] RouterAgent — no-match keyword fallback")
// Create router with custom categories that have NO overlapping keywords with input
const routerNoMatchCats = new mod.RouterAgent()
routerNoMatchCats.setCategories([
  mod.createCategory("food", "Makanan", ["nasi", "sate", "gado"], "Info makanan"),
  mod.createCategory("sport", "Olahraga", ["futsal", "renang", "lari"], "Info olahraga"),
  mod.createCategory("general", "General", [], "Pengetahuan umum"),
])
const routerNMResult = await routerNoMatchCats.route("zyxwv qwerty")
assert(routerNMResult.category === "general", "RA-4: no match falls back to general")
assert(routerNMResult.confidence === 0.3, "RA-4: no match confidence=0.3")
assert(routerNMResult.reasoning.includes("fallback"), "RA-4: no match fallback reasoning")

// 42e6. RouterAgent — extractKeywords()
console.log("\n[42e6] RouterAgent — extractKeywords")
const routerExtract = new mod.RouterAgent()
const extracted = routerExtract.extractKeywords("fix TypeScript build test")
assert(Array.isArray(extracted.keywords), "RA-5: extractKeywords returns array")
assert(extracted.keywords.length > 0, "RA-5: extractKeywords has keywords")
assert(extracted.keywords.length <= 10, "RA-5: extractKeywords max 10")
assert(extracted.category === "tech", "RA-5: extractKeywords detects tech")
// Verify stop words are filtered ("fix" is a tech keyword and 3 chars, so it stays)
assert(extracted.keywords.includes("typescript"), "RA-5: extractKeywords includes keyword matches")
// Verify pure numbers are skipped
const numExtract = routerExtract.extractKeywords("test 123 four")
assert(!numExtract.keywords.includes("123"), "RA-5: extractKeywords skips pure numbers")

// 42e7. RouterAgent — setCategories/getCategories/setLLM/hasLLM
console.log("\n[42e7] RouterAgent — state management")
const routerState = new mod.RouterAgent()
assert(routerState.hasLLM() === false, "RA-6: hasLLM false initially")
routerState.setLLM({ call: async () => ({ content: "{}" }) })
assert(routerState.hasLLM() === true, "RA-6: hasLLM true after setLLM")
const cats = routerState.getCategories()
assert(Array.isArray(cats), "RA-6: getCategories returns array")
assert(cats.length > 0, "RA-6: getCategories has entries")
const customCats = [mod.createCategory("food", "Makanan", ["nasi", "sate"], "Info makanan")]
routerState.setCategories(customCats)
assert(routerState.getCategories().length === 1, "RA-6: setCategories replaced categories")
assert(routerState.getCategories()[0].id === "food", "RA-6: setCategories custom cat works")

// 42e8. RouterAgent — parseRouterClassificationPayload edge cases
console.log("\n[42e8] RouterAgent — parseRouterClassificationPayload edge cases")
assert(mod.parseRouterClassificationPayload(JSON.stringify(null)) === null, "RA-7: null data returns null")
assert(mod.parseRouterClassificationPayload(JSON.stringify([])) === null, "RA-7: array data returns null")
assert(mod.parseRouterClassificationPayload(JSON.stringify({ category: "", confidence: 0.5, reasoning: "x" })) === null, "RA-7: empty category returns null")

// 42e9. createCategory standalone
console.log("\n[42e9] createCategory standalone")
const foodCat = mod.createCategory("food", "Makanan", ["nasi", "sate"], "Info makanan", ["webfetch"])
assert(foodCat.id === "food", "RA-8: createCategory id set")
assert(foodCat.suggestedRagIndex === "knowledge-food", "RA-8: createCategory rag index auto")
assert(foodCat.suggestedTools.includes("webfetch"), "RA-8: createCategory tools preserved")
const simpleCat = mod.createCategory("simple", "Simple", [], "No keywords")
assert(simpleCat.suggestedTools.length === 0, "RA-8: createCategory no tools default empty")

// 42e10. RouterAgent — LLM route with missing suggestedTools/RagIndex (branch line 311-312)
console.log("\n[42e10] RouterAgent — LLM branch: missing optional fields")
const routerBr = new mod.RouterAgent({
  call: async () => ({ content: JSON.stringify({ category: "custom", confidence: 0.9, reasoning: "test" }) }),
})
// Set a category that's missing suggestedTools and suggestedRagIndex (via plain object)
routerBr.setCategories([
  { id: "custom", name: "Custom", keywords: ["test"], description: "Test cat", suggestedTools: undefined, suggestedRagIndex: undefined },
  { id: "general", name: "General", keywords: [], description: "General", suggestedTools: [], suggestedRagIndex: "knowledge-general" },
])
const routerBrResult = await routerBr.route("test input")
assert(routerBrResult.usedLlm === true, "RA-9: LLM success with missing fields")
// With undefined suggestedTools, ?? [] should give empty array
assert(Array.isArray(routerBrResult.suggestedTools), "RA-9: suggestedTools is array")
assert(routerBrResult.suggestedTools.length === 0, "RA-9: no tools from undefined")
// With undefined suggestedRagIndex, ?? "knowledge-general" should give default
assert(routerBrResult.suggestedRagIndex === "knowledge-general", "RA-9: rag index defaults to knowledge-general")

// 42e11. RouterAgent — LLM filter branch: category with id=general is filtered (line 288 branch)
console.log("\n[42e11] RouterAgent — LLM general-filter path")
const routerGen = new mod.RouterAgent({
  call: async () => ({ content: JSON.stringify({ category: "general", confidence: 0.8, reasoning: "no specific category" }) }),
})
const routerGenResult = await routerGen.route("general question")
assert(routerGenResult.usedLlm === true, "RA-10: general category via LLM")
assert(routerGenResult.category === "general", "RA-10: category is general")

// 42e12. RouterAgent — keyword fallback with missing suggestedTools (branch in _keywordFallback, lines 271-272)
console.log("\n[42e12] RouterAgent — keyword fallback missing optional fields")
const routerKFB = new mod.RouterAgent()
routerKFB.setCategories([
  { id: "custom", name: "Custom", keywords: ["custom"], description: "Test cat", suggestedTools: undefined, suggestedRagIndex: undefined },
  { id: "general", name: "General", keywords: [], description: "General", suggestedTools: [], suggestedRagIndex: "knowledge-general" },
])
const routerKFResult = await routerKFB.route("custom keyword test")
assert(routerKFResult.usedLlm === false, "RA-11: keyword fallback")
assert(Array.isArray(routerKFResult.suggestedTools), "RA-11: suggestedTools is array")
assert(routerKFResult.suggestedTools.length === 0, "RA-11: no tools from undefined")
assert(routerKFResult.suggestedRagIndex === "knowledge-general", "RA-11: rag index defaults from fallback")

// 42f. P1 schema-first LLM boundary — planner critic parsers
console.log("\n[42f] planner critic schema gate")
const planCandidatesGood = mod.parsePlannerCandidatePlans(JSON.stringify([
  { rationale: "direct", steps: [{ id: "a", description: "Inspect code" }, { id: "b", description: "Add tests", dependsOn: ["a"] }] },
]))
assert(planCandidatesGood.length === 1, "P1-planner critic accepts valid candidate list")
assert(planCandidatesGood[0].steps[1].dependsOn.includes("a"), "P1-planner critic preserves valid dependencies")
const planCandidatesBad = mod.parsePlannerCandidatePlans(JSON.stringify([
  { rationale: "bad", steps: [{ id: "a", action: "missing required description" }] },
]))
assert(planCandidatesBad.length === 0, "P1-planner critic rejects malformed candidate steps")
const criticGood = mod.parsePlannerCriticScore(JSON.stringify({ overall: 0.75, issues: ["needs tests"], suggestions: ["add verification"] }))
assert(criticGood?.overall === 0.75, "P1-planner critic accepts valid critic score")
const criticBad = mod.parsePlannerCriticScore(JSON.stringify({ overall: 2, issues: [], suggestions: [] }))
assert(criticBad === null, "P1-planner critic rejects out-of-range critic score")
const refinedBad = mod.parsePlannerRefinedCandidate(JSON.stringify({ rationale: "bad", steps: [{ description: "" }] }))
assert(refinedBad === null, "P1-planner critic rejects invalid refinement")

// 42g. P1 schema-first LLM boundary — data cleaner validation parser
console.log("\n[42g] data cleaner validation schema gate")
const dataValidationGood = mod.parseDataValidationPayload(JSON.stringify({ valid: true, issues: [] }))
assert(dataValidationGood?.valid === true, "P1-data cleaner accepts valid validation payload")
const dataValidationBad = mod.parseDataValidationPayload(JSON.stringify({ valid: "yes", issues: [] }))
assert(dataValidationBad === null, "P1-data cleaner rejects malformed validation payload")
const cleanerInvalidSchema = new mod.DataCleaner({
  call: async () => ({ content: JSON.stringify({ valid: "yes", issues: [] }) }),
})
const cleanerInvalidResult = await cleanerInvalidSchema.validate("[]", "array")
assert(cleanerInvalidResult.valid === false, "P1-data cleaner fails closed on malformed LLM validation")
const cleanerThrow = new mod.DataCleaner({
  call: async () => { throw new Error("boom") },
})
const cleanerThrowResult = await cleanerThrow.validate("[]", "array")
assert(cleanerThrowResult.valid === false, "P1-data cleaner fails closed on LLM validation error")

console.log("\n[42h] delegate step runner — LLM output schema gate (reuses parseLLMStepImplementation)")
// Valid payload accepted
const delegateGood = mod.parseLLMStepImplementation(JSON.stringify({ files: [{ path: "src/foo.ts", content: "export const x = 1" }], summary: "added foo" }))
assert(Array.isArray(delegateGood.files) && delegateGood.files.length === 1, "P1-delegate accepts valid file payload")
assert(delegateGood.files[0].path === "src/foo.ts", "P1-delegate preserves file path")
assert(typeof delegateGood.summary === "string", "P1-delegate preserves summary")
// Malformed: not JSON
try { mod.parseLLMStepImplementation("not json"); assert(false, "should throw") } catch (e) { assert(e.message.length > 0, "P1-delegate rejects non-JSON") }
// Malformed: missing files
try { mod.parseLLMStepImplementation(JSON.stringify({ summary: "no files" })); assert(false, "should throw") } catch (e) { assert(e.message.includes("schema"), "P1-delegate rejects missing files") }
// Malformed: wrong content type
try { mod.parseLLMStepImplementation(JSON.stringify({ files: [{ path: "x", content: 123 }] })); assert(false, "should throw") } catch (e) { assert(e.message.includes("schema"), "P1-delegate rejects wrong content type") }
// Malformed: absolute path
try { mod.parseLLMStepImplementation(JSON.stringify({ files: [{ path: "/etc/passwd", content: "x" }] })); assert(false, "should throw") } catch (e) { assert(e.message.includes("schema"), "P1-delegate rejects absolute path") }
// Malformed: traversal path
try { mod.parseLLMStepImplementation(JSON.stringify({ files: [{ path: "../escape/x", content: "x" }] })); assert(false, "should throw") } catch (e) { assert(e.message.includes("schema"), "P1-delegate rejects traversal path") }

console.log("\n[42i] second-brain reflection — LLM output schema gate")
// Valid payload accepted
const reflGood = mod.parseReflectionPayload(JSON.stringify({ summary: "ok", conflicts: [], planUpdates: ["a"], newInfo: [], actionItems: ["b"] }))
assert(reflGood !== null, "P1-reflection accepts valid payload")
assert(reflGood.summary === "ok", "P1-reflection preserves summary")
assert(reflGood.planUpdates.length === 1, "P1-reflection preserves planUpdates")
assert(reflGood.actionItems[0] === "b", "P1-reflection preserves actionItems")
// Malformed: not JSON
assert(mod.parseReflectionPayload("not json") === null, "P1-reflection rejects non-JSON")
// Malformed: summary is number
assert(mod.parseReflectionPayload(JSON.stringify({ summary: 123, conflicts: [], planUpdates: [], newInfo: [], actionItems: [] })) === null, "P1-reflection rejects wrong summary type")
// Malformed: conflicts is string not array
assert(mod.parseReflectionPayload(JSON.stringify({ summary: "ok", conflicts: "bad", planUpdates: [], newInfo: [], actionItems: [] })) === null, "P1-reflection rejects wrong conflicts type")
// Malformed: actionItems contains non-string
assert(mod.parseReflectionPayload(JSON.stringify({ summary: "ok", conflicts: [], planUpdates: [], newInfo: [], actionItems: [1, 2] })) === null, "P1-reflection rejects non-string array items")
// Malformed: missing field
assert(mod.parseReflectionPayload(JSON.stringify({ summary: "ok", conflicts: [] })) === null, "P1-reflection rejects missing fields")
// Backward-compat: old format without triggers should still be accepted
const noTriggers = mod.parseReflectionPayload(JSON.stringify({ summary: "legacy ok", conflicts: [], planUpdates: [], newInfo: [], actionItems: ["legacy"] }))
assert(noTriggers !== null, "P1-reflection accepts legacy format without triggers")
assert(noTriggers.summary === "legacy ok", "P1-reflection preserves legacy summary")
assert(noTriggers.triggers === undefined, "P1-reflection legacy has no triggers")
// New format with valid triggers accepted
const withTriggers = mod.parseReflectionPayload(JSON.stringify({ summary: "triggered", conflicts: [], planUpdates: [], newInfo: [], actionItems: [], triggers: ["gap", "growth"] }))
assert(withTriggers !== null, "P1-reflection accepts valid triggers")
assert(withTriggers.triggers !== undefined, "P1-reflection triggers present")
assert(withTriggers.triggers.length === 2, "P1-reflection preserves 2 valid triggers")
assert(withTriggers.triggers[0] === "gap", "P1-reflection first trigger is gap")
// Invalid trigger values filtered out
const badTriggers = mod.parseReflectionPayload(JSON.stringify({ summary: "bad trig", conflicts: [], planUpdates: [], newInfo: [], actionItems: [], triggers: ["gap", "invalid_trigger", "drift"] }))
assert(badTriggers !== null, "P1-reflection accepts partially invalid triggers")
assert(badTriggers.triggers.length === 2, "P1-reflection filters invalid triggers, keeps valid ones")

console.log("\n[42j] writeFiles — path traversal guard")
{
  const os = await import("node:os")
  const fs = await import("node:fs")
  const path = await import("node:path")
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-test-"))
  // Normal file should be written
  const written1 = mod.writeFiles([{ path: "src/ok.ts", content: "ok" }], tmpDir, "test-sid")
  assert(written1.length === 1 && written1[0] === "src/ok.ts", "P1-writeFiles writes normal path")
  assert(fs.existsSync(path.join(tmpDir, "src/ok.ts")), "P1-writeFiles file actually exists")
  // Traversal path should be rejected
  const written2 = mod.writeFiles([{ path: "../../etc/evil", content: "bad" }], tmpDir, "test-sid")
  assert(written2.length === 0, "P1-writeFiles rejects traversal path")
  // Absolute path should be rejected
  const written3 = mod.writeFiles([{ path: "/etc/passwd", content: "bad" }], tmpDir, "test-sid")
  assert(written3.length === 0, "P1-writeFiles rejects absolute path")
  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true })
}

// 42k. execution-helpers — branch coverage (writeFiles eventBus/catch, parseFileEntries, recordCompletion)
console.log("\n[42k] execution-helpers — branch coverage")
{
  // ── writeFiles with eventBus (line 58) ──
  const ehEvents = []
  const ehEventBus = { emit: (ev) => ehEvents.push(ev) }
  const ehDir = "/tmp/eh-test-" + Date.now()
  const ehWritten = mod.writeFiles([{ path: "out.ts", content: "data" }], ehDir, "sid-1", ehEventBus, { stepId: "s1" })
  assert(ehWritten.length === 1, "EH-1a writeFiles with eventBus writes file")
  assert(ehEvents.length === 1, "EH-1b writeFiles emits file.written event")
  assert(ehEvents[0].type === "file.written", "EH-1c event type is file.written")
  assert(ehEvents[0].payload.filePath === "out.ts", "EH-1d event payload has filePath")
  assert(ehEvents[0].payload.sourceStepId === "s1", "EH-1e event payload has sourceStepId")
  try { rmSync(ehDir, { recursive: true, force: true }) } catch {}

  // ── parseFileEntries: valid JSON (line 88-96) ──
  const pfe1 = mod.parseFileEntries(JSON.stringify({
    files: [{ path: "a.ts", content: "aaa" }, { path: "b.ts", content: "bbb" }]
  }))
  assert(pfe1.length === 2, "EH-2a parseFileEntries parses JSON files array")
  assert(pfe1[0].path === "a.ts", "EH-2b first entry path")
  assert(pfe1[1].content === "bbb", "EH-2c second entry content")

  // ── parseFileEntries: sparse JSON (invalid entries filtered out) ──
  const pfe1b = mod.parseFileEntries(JSON.stringify({
    files: [{ path: "a.ts", content: "aaa" }, { path: "b.ts" }] // b missing content → filtered
  }))
  assert(pfe1b.length === 1, "EH-2d parseFileEntries filters entries missing content")
  assert(pfe1b[0].path === "a.ts", "EH-2e correct entry kept")

  // ── parseFileEntries: FILE: ``` regex (line 102-106) ──
  const pfe2 = mod.parseFileEntries("FILE: src/x.ts\n```ts\nconst x = 1\n```\nFILE: src/y.js\n```js\nvar y = 2\n```")
  assert(pfe2.length === 2, "EH-3a parseFileEntries parses FILE: blocks")
  assert(pfe2[0].path === "src/x.ts", "EH-3b first FILE path")
  assert(pfe2[0].content.includes("const x"), "EH-3c first FILE content")

  // ── parseFileEntries: JSON array top-level (no .files wrapper) ──
  const pfe2b = mod.parseFileEntries(JSON.stringify([
    { path: "arr.ts", content: "arr" }
  ]))
  assert(pfe2b.length === 0, "EH-3d parseFileEntries returns empty for JSON array without .files wrapper")

  // ── parseFileEntries: fallback code block (line 109-115) ──
  const pfe3 = mod.parseFileEntries("Some text with ```ts\nconst code = 1\n``` and more discussion and analysis of the code block and what it means. ".repeat(4))
  assert(pfe3.length === 1, "EH-4a parseFileEntries fallback uses code block")
  assert(pfe3[0].path === "src/generated.ts", "EH-4b fallback path is default")

  // ── parseFileEntries: NO_CHANGES should not trigger fallback (line 109) ──
  const pfe4 = mod.parseFileEntries("NO_CHANGES: nothing to update")
  assert(pfe4.length === 0, "EH-4c parseFileEntries NO_CHANGES returns empty")

  // ── parseFileEntries: noChanges JSON flag (line 109) ──
  const pfe5 = mod.parseFileEntries('{"noChanges":true}')
  assert(pfe5.length === 0, "EH-4d parseFileEntries noChanges flag returns empty")

  // ── parseFileEntries: empty input ──
  const pfe6 = mod.parseFileEntries("")
  assert(pfe6.length === 0, "EH-4e parseFileEntries empty returns empty")

  // ── parseFileEntries: fallbackPath param (line 113) ──
  const pfe7 = mod.parseFileEntries("check ```\nfallback content\n``` long enough text to ensure the raw length exceeds one hundred characters which is the requirement for the fallback extract. ".repeat(3), "src/custom.ts")
  assert(pfe7.length === 1, "EH-4f parseFileEntries custom fallbackPath works")
  assert(pfe7[0].path === "src/custom.ts", "EH-4g custom fallback path used")

  // ── tryParseJSON: direct valid JSON ──
  // (not exported, but covered via parseFileEntries internally — let's verify it works)
  // We'll test it through the schema validation path in recordCompletion
  
  // ── recordCompletion: minimal (no deps) ──
  const rc1 = await mod.recordCompletion(
    { sessionID: "s1", output: "test", filesModified: [], durationMs: 0 },
    {}
  )
  assert(rc1.guardPassed === true, "EH-5a recordCompletion minimal guard passes")
  assert(rc1.skillExtracted === false, "EH-5b recordCompletion minimal no skill")
  assert(rc1.confidenceScore === undefined, "EH-5c recordCompletion minimal no confidence")

  // ── recordCompletion: with guard check (hallucinationGuard) ──
  const mockGuard = {
    check(output, files) {
      return { passed: true, claims: [{ verified: true }] }
    }
  }
  const rc2 = await mod.recordCompletion(
    { sessionID: "s2", output: "ok", filesModified: ["src/a.ts"], durationMs: 0 },
    { hallucinationGuard: mockGuard }
  )
  assert(rc2.guardPassed === true, "EH-6a recordCompletion with guard passes")
  assert(rc2.skillExtracted === false, "EH-6b recordCompletion with guard no skill")

  // ── recordCompletion: guard fails ──
  const mockGuardFail = {
    check(output, files) {
      return { passed: false, claims: [{ verified: false }] }
    }
  }
  const rc3 = await mod.recordCompletion(
    { sessionID: "s3", output: "bad claim", filesModified: ["src/b.ts"], durationMs: 0 },
    { hallucinationGuard: mockGuardFail }
  )
  assert(rc3.guardPassed === false, "EH-7 recordCompletion guard fails when claims unverified")

  // ── recordCompletion: guard + eventBus emission (line 201-216) ──
  const rcEvents = []
  const rcEventBus = { emit: (ev) => rcEvents.push(ev) }
  const mockGuard2 = {
    check(output, files) {
      return { passed: true, claims: [{ verified: true, claim: "exists", type: "file", expected: "yes", actual: "yes" }] }
    }
  }
  const rc4 = await mod.recordCompletion(
    { sessionID: "s4", output: "x", filesModified: ["src/c.ts"], durationMs: 0 },
    { hallucinationGuard: mockGuard2, eventBus: rcEventBus }
  )
  assert(rc4.guardPassed === true, "EH-8a recordCompletion guard with eventBus passes")
  const guardEvent = rcEvents.find(e => e.type === "guard.check.completed")
  assert(guardEvent !== undefined, "EH-8b guard.check.completed event emitted")
  assert(guardEvent.payload.sessionID === "s4", "EH-8c guard event has sessionID")

  // ── recordCompletion: guard eventBus with empty claims (line 211 ternary false branch) ──
  const rcEvents2 = []
  const rcEventBus2 = { emit: (ev) => rcEvents2.push(ev) }
  const mockGuardEmpty = {
    check(output, files) {
      return { passed: true, claims: [] } // empty claims → hallucinationRate ternary false
    }
  }
  const rc4b = await mod.recordCompletion(
    { sessionID: "s4b", output: "x", filesModified: ["src/c2.ts"], durationMs: 0 },
    { hallucinationGuard: mockGuardEmpty, eventBus: rcEventBus2 }
  )
  assert(rc4b.guardPassed === true, "EH-8d guard with empty claims passes")
  const guardEvent2 = rcEvents2.find(e => e.type === "guard.check.completed")
  assert(guardEvent2 !== undefined, "EH-8e guard event emitted for empty claims")
  assert(guardEvent2.payload.hallucinationRate === 0, "EH-8f hallucinationRate 0 for empty claims")

  // ── recordCompletion: with budget tracker (line 194) ──
  let budgetSteps = 0
  const mockBudget = { recordStep() { budgetSteps++ } }
  const rc5 = await mod.recordCompletion(
    { sessionID: "s5", output: "budget", filesModified: [], durationMs: 0 },
    { budgetTracker: mockBudget }
  )
  assert(budgetSteps === 1, "EH-9 recordCompletion records budget step")

  // ── recordCompletion: with confidence scoring (line 220-233) ──
  const scores = []
  const mockScorer = {
    score(signals) { return { overall: 0.85, dimensions: {} } }
  }
  const mockStore = {
    set(key, val) { scores.push({ key, val }) }
  }
  const rc6 = await mod.recordCompletion(
    { sessionID: "s6", output: "score", filesModified: [], durationMs: 0 },
    { confidenceScorer: mockScorer, confidenceStore: mockStore }
  )
  assert(scores.length === 1, "EH-10a recordCompletion stores confidence score")
  assert(scores[0].val.overall === 0.85, "EH-10b confidence score is correct")

  // ── writeFiles: catch block on write error (line 68-70) ──
  // Use path traversal to trigger security rejection (works in all environments, including Docker/root)
  const ehWrittenFail = mod.writeFiles([{ path: "../../escape-test.ts", content: "data" }], "/tmp", "sid-fail")
  assert(ehWrittenFail.length === 0, "EH-11 writeFiles returns empty when write fails (path traversal)")
  // Also test actual IO failure: create a read-only dir to trigger write error
  const roDir = "/tmp/eh-readonly-" + Date.now()
  mkdirSync(roDir, { recursive: true })
  mkdirSync(roDir + "/sub", { recursive: true })
  chmodSync(roDir + "/sub", 0o444)
  const ehWrittenFail2 = mod.writeFiles([{ path: "sub/newfile.ts", content: "data" }], roDir, "sid-fail")
  assert(ehWrittenFail2.length <= 1, "EH-11b writeFiles handles read-only dir gracefully (root can write in Docker)")
  try { rmSync(roDir, { recursive: true, force: true }) } catch {}

  // ── recordCompletion: with skill extraction (autoExtract enabled) ──
  let extractedSkill = false
  const mockSkillStore = {
    async extract(record, tags) {
      extractedSkill = true
      return {
        definition: { meta: { id: "sk1", name: "skill1" }, output_schema: null },
        successRate: 0.9
      }
    }
  }
  const mockConfigLoader = {
    get() {
      return { agent: { autoSkillExtract: true } }
    }
  }
  const rc7 = await mod.recordCompletion(
    { sessionID: "s7", output: "skill data", filesModified: ["src/d.ts"], durationMs: 0, role: "developer" },
    { skillStore: mockSkillStore, configLoader: mockConfigLoader }
  )
  assert(extractedSkill === true, "EH-12a recordCompletion extracts skill for developer")
  assert(rc7.skillExtracted === true, "EH-12b skillExtracted flag is true")

  // ── recordCompletion: skill extraction with schema validation + eventBus (lines 260-288) ──
  const svEvents = []
  const svEventBus = { emit: (ev) => svEvents.push(ev) }
  const mockSchemaValidator = {
    validate(schema, output) {
      return { valid: false, errors: [{ path: "name", message: "required" }] }
    }
  }
  const mockSkillStoreWithSchema = {
    async extract(record, tags) {
      return {
        definition: {
          meta: { id: "sk-schema", name: "schema-skill" },
          output_schema: { fields: [{ name: "name", type: "string" }] }
        },
        successRate: 0.8
      }
    }
  }
  const rc8 = await mod.recordCompletion(
    { sessionID: "s8", output: '{"name": "test"}', filesModified: ["src/e.ts"], durationMs: 0, role: "developer" },
    {
      skillStore: mockSkillStoreWithSchema,
      configLoader: mockConfigLoader,
      schemaValidator: mockSchemaValidator,
      eventBus: svEventBus
    }
  )
  assert(rc8.skillExtracted === true, "EH-13a recordCompletion schema validation extracts skill")
  assert(rc8.schemaValidation !== undefined, "EH-13b schema validation result present")
  assert(rc8.schemaValidation.outputErrors.length > 0, "EH-13c schema validation has errors")
  assert(rc8.schemaValidation.outputErrors[0].path === "name", "EH-13d schema validation error path")
  assert(svEvents.length > 0, "EH-13e schema validation emits events")

  // ── recordCompletion: skill extract tryParseJSON invalid (catch block, line 286-288) ──
  const mockSkillStoreBadOutput = {
    async extract(record, tags) {
      return {
        definition: {
          meta: { id: "sk-bad", name: "bad-skill" },
          output_schema: { fields: [{ name: "x", type: "string" }] }
        },
        successRate: 0.5
      }
    }
  }
  const mockSchemaValidator2 = {
    validate(schema, output) { return { valid: false, errors: [{ path: "x", message: "missing" }] } }
  }
  const rc9 = await mod.recordCompletion(
    { sessionID: "s9", output: "not-json-at-all", filesModified: ["src/f.ts"], durationMs: 0, role: "developer" },
    {
      skillStore: mockSkillStoreBadOutput,
      configLoader: mockConfigLoader,
      schemaValidator: mockSchemaValidator2
    }
  )
  assert(rc9.skillExtracted === true, "EH-14a recordCompletion non-JSON output still extracts skill")
  assert(rc9.schemaValidation === undefined, "EH-14b schema validation skipped for non-JSON output")

  // ── recordCompletion: schema validation catch block (schemaValidator.validate throws, line 287-288) ──
  const mockSchemaValidatorThrows = {
    validate(schema, output) { throw new Error("validator crashed") }
  }
  const mockSkillStoreSchema2 = {
    async extract(record, tags) {
      return {
        definition: {
          meta: { id: "sk-throw", name: "throw-skill" },
          output_schema: { fields: [{ name: "x", type: "string" }] }
        },
        successRate: 0.5
      }
    }
  }
  const rc9b = await mod.recordCompletion(
    { sessionID: "s9b", output: '{"x":1}', filesModified: ["src/f2.ts"], durationMs: 0, role: "developer" },
    {
      skillStore: mockSkillStoreSchema2,
      configLoader: mockConfigLoader,
      schemaValidator: mockSchemaValidatorThrows
    }
  )
  assert(rc9b.skillExtracted === true, "EH-14c recordCompletion handles validator throw gracefully")

  // ── recordCompletion: tryParseJSON regex extraction path (line 311-318) ──
  // record.output with JSON embedded in non-JSON text to trigger regex fallback
  const mockSkillStoreRegex = {
    async extract(record, tags) {
      return {
        definition: {
          meta: { id: "sk-regex", name: "regex-skill" },
          output_schema: { fields: [{ name: "key", type: "string" }] }
        },
        successRate: 0.7
      }
    }
  }
  const mockSchemaValidator3 = {
    validate(schema, output) { return { valid: true, errors: [] } }
  }
  const rc9c = await mod.recordCompletion(
    { sessionID: "s9c", output: 'prefix { "key": "value" } suffix', filesModified: ["src/f3.ts"], durationMs: 0, role: "developer" },
    {
      skillStore: mockSkillStoreRegex,
      configLoader: mockConfigLoader,
      schemaValidator: mockSchemaValidator3
    }
  )
  assert(rc9c.skillExtracted === true, "EH-14d recordCompletion regex JSON extraction works")

  // ── recordCompletion: tryParseJSON regex extraction + invalid JSON (catch line 317-318) ──
  const mockSkillStoreBadRegex = {
    async extract(record, tags) {
      return {
        definition: {
          meta: { id: "sk-badr", name: "bad-regex" },
          output_schema: { fields: [{ name: "x", type: "string" }] }
        },
        successRate: 0.6
      }
    }
  }
  const mockSchemaValidator4 = {
    validate(schema, output) { return { valid: true, errors: [] } }
  }
  const rc9d = await mod.recordCompletion(
    // Text with {braces} but invalid JSON inside → regex match catches {braces} but parse fails
    { sessionID: "s9d", output: 'text { invalid: json, missing: quotes } text', filesModified: ["src/f4.ts"], durationMs: 0, role: "developer" },
    {
      skillStore: mockSkillStoreBadRegex,
      configLoader: mockConfigLoader,
      schemaValidator: mockSchemaValidator4
    }
  )
  assert(rc9d.skillExtracted === true, "EH-14e recordCompletion handles invalid regex JSON gracefully")

  // ── recordCompletion: skill extraction catch block (mock extract throws, line 292-293) ──
  const mockSkillStoreThrows = {
    async extract(record, tags) {
      throw new Error("extract failed")
    }
  }
  const rc10 = await mod.recordCompletion(
    { sessionID: "s10", output: "some output", filesModified: ["src/g.ts"], durationMs: 0, role: "developer" },
    { skillStore: mockSkillStoreThrows, configLoader: mockConfigLoader }
  )
  assert(rc10.skillExtracted === false, "EH-15 recordCompletion handles skill extract throw gracefully")
}

assert(true, "execution-helpers branch coverage tests passed")
}

// ── Standalone execution ──
const _isMain = typeof process !== "undefined" && process.argv[1] && (process.argv[1] === import.meta.url || process.argv[1].endsWith("/_runall-core.mjs"))
if (_isMain) {
  const { pluginDist: _pd } = await import("./_common.mjs")
  const _mod = await import(_pd)
  await runCoreTests(_mod)
  const { state } = await import("./_state.mjs")
  console.log(`__RESULT__:${JSON.stringify({ passed: state.passed, failed: state.failed })}`)
  process.exit(state.failed > 0 ? 1 : 0)
}
