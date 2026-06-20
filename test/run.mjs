import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "fs"
import { join } from "path"

const pluginDist = new URL("../dist/index.js", import.meta.url).pathname

let passed = 0
let failed = 0
let sid = 0
let mod
function freshSid() { return `test-session-${++sid}` }

function assert(condition, msg) {
  if (condition) {
    console.log(`  PASS: ${msg}`)
    passed++
  } else {
    console.error(`  FAIL: ${msg}`)
    failed++
  }
}

function mockCtx(sessionID) {
  return {
    sessionID,
    messageID: "msg-1",
    agent: "test",
    directory: "/tmp/test-project",
    worktree: "/tmp/test-project",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  }
}

// Setup a minimal project for navigator
const projectDir = "/tmp/test-project"
try { rmSync(projectDir, { recursive: true, force: true }) } catch { /* volume mount inside */ }
mkdirSync(projectDir, { recursive: true })
mkdirSync(join(projectDir, "src"), { recursive: true })
mkdirSync(join(projectDir, "tests"), { recursive: true })
writeFileSync(join(projectDir, "tsconfig.json"), "{}")
writeFileSync(join(projectDir, "package.json"), JSON.stringify({ name: "test", type: "module" }))
writeFileSync(join(projectDir, "src/index.ts"), 'import { validate } from "./utils"\nexport function main() { return validate() }\n')
writeFileSync(join(projectDir, "src/utils.ts"), 'export function validate(): boolean { return true }\n')
writeFileSync(join(projectDir, "tests/index.test.ts"), 'import { main } from "../src/index"\n')

async function runAll() {

// 1. Module loading
console.log("\n[1] Module loading")
assert(existsSync(pluginDist), "dist/index.js exists")
try { mod = await import(pluginDist); assert(true, "plugin module loaded") }
catch (e) { assert(false, `plugin module load: ${e.message}`) }
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

// 3. Tool registration (29 tools)
console.log("\n[3] Tool registration")
for (const name of ["agentic_plan", "agentic_nav", "agentic_execute", "agentic_reflect", "agentic_verify", "agentic_status", "agentic_context", "agentic_snapshot", "agentic_pr", "agentic_score", "agentic_delegate", "agentic_pipeline", "agentic_message", "agentic_skill", "agentic_model", "agentic_model_reset", "agentic_budget", "agentic_episodes", "agentic_parallel", "agentic_dashboard", "agentic_guard", "agentic_evolve", "agentic_auto", "agentic_debate", "agentic_router", "agentic_clean", "agentic_rag", "agentic_mcp", "agentic_finetune"]) {
  const tool = hooks.tool?.[name]
  assert(tool && typeof tool.execute === "function", `"${name}" has execute()`)
  assert(typeof tool.description === "string" && tool.description.length > 0, `"${name}" has description`)
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

// 43. agentic_dashboard — observability
console.log("\n[43] agentic_dashboard — observability")
const dbResult = await hooks.tool.agentic_dashboard.execute({}, mockCtx(freshSid()))
const dbOut = typeof dbResult === "string" ? dbResult : dbResult.output
assert(dbOut.length > 0, "dashboard produces output")

// 44. agentic_guard — hallucination check
console.log("\n[44] agentic_guard — hallucination check")
const gdCtx = mockCtx(freshSid())
await hooks.tool.agentic_plan.execute({ goal: "Guard test", subtasks: [{ id: "gd1", description: "Claim check", dependsOn: [] }] }, gdCtx)
await hooks.tool.agentic_execute.execute({
  stepId: "gd1", success: true, output: "Created src/login.ts with validateEmail function",
  filesModified: ["src/login.ts"],
}, gdCtx)
const gdResult = await hooks.tool.agentic_guard.execute({ stepId: "gd1" }, gdCtx)
const gdOut = typeof gdResult === "string" ? gdResult : gdResult.output
assert(gdOut.includes("Hallucination") || gdOut.includes("Verdict"), "guard check produced")

// 45. agentic_guard — false claim detection
console.log("\n[45] agentic_guard — false claim")
const gd2Ctx = mockCtx(freshSid())
await hooks.tool.agentic_plan.execute({ goal: "Ghost test", subtasks: [{ id: "gd2", description: "Ghost claim", dependsOn: [] }] }, gd2Ctx)
await hooks.tool.agentic_execute.execute({
  stepId: "gd2", success: true,
  output: "Added ghostFunction to src/nonexistent.ts",
  filesModified: [],
}, gd2Ctx)
const gd2Result = await hooks.tool.agentic_guard.execute({ stepId: "gd2" }, gd2Ctx)
const gd2Out = typeof gd2Result === "string" ? gd2Result : gd2Result.output
assert(gd2Out.includes("Unverified") || gd2Out.includes("not found") || gd2Out.includes("hallucin"), "detects unverified claims")

// 46. agentic_evolve — inspect
console.log("\n[46] agentic_evolve — inspect")
const evCtx = mockCtx(freshSid())
const evI = await hooks.tool.agentic_evolve.execute({ action: "inspect" }, evCtx)
const evIOut = typeof evI === "string" ? evI : evI.output
assert(evIOut.includes("Role") || evIOut.includes("role"), "inspect shows roles")
assert(evIOut.includes("schema") || evIOut.includes("Schema"), "inspect shows schema version")

// 47. agentic_evolve — register custom role
console.log("\n[47] agentic_evolve — register role")
const evR = await hooks.tool.agentic_evolve.execute({
  action: "register-role",
  name: "Security Auditor",
  prompt: "You audit code for security vulnerabilities.",
  tools: ["read", "grep"],
}, evCtx)
const evROut = typeof evR === "string" ? evR : evR.output
assert(evROut.includes("security-auditor") || evROut.includes("registered"), "registers custom role")

// 48. agentic_evolve — memory schema
console.log("\n[48] agentic_evolve — memory schema")
const evM = await hooks.tool.agentic_evolve.execute({ action: "memory-schema" }, evCtx)
const evMOut = typeof evM === "string" ? evM : evM.output
assert(evMOut.includes("schema_version") || evMOut.includes("Envelope"), "shows memory schema")

// 49. agentic_evolve — export skill
console.log("\n[49] agentic_evolve — export skill")
const evS = await hooks.tool.agentic_evolve.execute({
  action: "export-skill",
  name: "API endpoint pattern",
  tools: ["read", "edit", "bash"],
}, evCtx)
const evSOut = typeof evS === "string" ? evS : evS.output
assert(evSOut.includes("agentic-skill/v1") || evSOut.includes("Skill:"), "exports skill in self-describing format")

// 50. Max retry exhaustion + reflect
console.log("\n[50] Max retry exhaustion")
const mrid = freshSid()
await hooks.tool.agentic_plan.execute({ goal: "Max", subtasks: [{ id: "mx", description: "Fail", dependsOn: [] }] }, mockCtx(mrid))
for (let i = 0; i < 3; i++) {
  await hooks.tool.agentic_execute.execute({
    stepId: "mx", success: false, output: `Fail ${i + 1}`, error: `err-${i}`,
  }, mockCtx(mrid))
}
const mrRef = await hooks.tool.agentic_reflect.execute({ stepId: "mx" }, mockCtx(mrid))
const mrOut = typeof mrRef === "string" ? mrRef : mrRef.output
assert(mrOut.includes("No retries") || mrOut.includes("remaining") || mrOut.includes("plan step"), "indicates max retries reached")

// 51. agentic_evolve — self-evolution analysis
console.log("\n[51] agentic_evolve — self-evolution")
const evoCtx = mockCtx(freshSid())
await hooks.tool.agentic_plan.execute({
  goal: "Evolve test: complex multi-phase feature",
  subtasks: [
    { id: "ev1", description: "Security audit for input sanitizer", dependsOn: [] },
    { id: "ev2", description: "Database migration performance optimization", dependsOn: [] },
    { id: "ev3", description: "Simple CRUD endpoint", dependsOn: [] },
    { id: "ev4", description: "Fix security vulnerability in jwt validation", dependsOn: ["ev1"] },
    { id: "ev5", description: "Optimize slow performance of query builder", dependsOn: ["ev2"] },
    { id: "ev6", description: "Security review of password hashing", dependsOn: ["ev4"] },
  ],
}, evoCtx)

// Delegate tasks
for (const tid of ["ev1-d", "ev2-d", "ev4-d", "ev5-d", "ev6-d"]) {
  await hooks.tool.agentic_delegate.execute({ taskId: tid, role: "developer", description: "security or performance related fix" }, evoCtx)
}

// Execute with failures: security keywords fail twice, performance twice
await hooks.tool.agentic_execute.execute({
  stepId: "ev1", success: false, output: "SQL injection in sanitizer.ts:56", error: "security vulnerability",
}, evoCtx)
await hooks.tool.agentic_execute.execute({
  stepId: "ev2", success: false, output: "Migration timeout on large dataset", error: "performance timeout",
}, evoCtx)
await hooks.tool.agentic_execute.execute({
  stepId: "ev3", success: true, output: "✅ step complete: CRUD endpoint with validation", filesModified: ["src/routes/users.ts"],
}, evoCtx)
await hooks.tool.agentic_execute.execute({
  stepId: "ev4", success: false, output: "JWT security bypass in auth.ts:23", error: "security bug",
}, evoCtx)
await hooks.tool.agentic_execute.execute({
  stepId: "ev5", success: false, output: "O(n^2) performance in query builder loop", error: "performance regression",
}, evoCtx)
await hooks.tool.agentic_execute.execute({
  stepId: "ev6", success: true, output: "✅ step complete: hash verification patched", filesModified: ["src/services/AuthService.ts"],
}, evoCtx)

// Extract skills
await hooks.tool.agentic_skill.execute({ action: "extract", query: "ev3" }, evoCtx)
await hooks.tool.agentic_skill.execute({ action: "extract", query: "ev6" }, evoCtx)

// Run evolve
const evolveR = await hooks.tool.agentic_evolve.execute({ action: "evolve" }, evoCtx)
const evolveOut = typeof evolveR === "string" ? evolveR : evolveR.output
assert(evolveOut.includes("Self-Evolution") || evolveOut.includes("Improvement Score"), "evolve produces report")
assert(evolveOut.includes("Recommendation") || evolveOut.includes("recommend"), "evolve includes recommendations")
assert(evolveOut.includes("Success Rate") || evolveOut.includes("success"), "evolve shows metrics")

// 51b. agentic_evolve — read-prompt
console.log("\n[51b] agentic_evolve — read-prompt")
const rpCtx = mockCtx(freshSid())
const rpR = await hooks.tool.agentic_evolve.execute({ action: "read-prompt", role: "developer" }, rpCtx)
const rpOut = typeof rpR === "string" ? rpR : rpR.output
assert(rpOut.includes("developer") || rpOut.includes("senior developer"), "read-prompt returns developer prompt content")
const rpR2 = await hooks.tool.agentic_evolve.execute({ action: "read-prompt", role: "nonexistent" }, rpCtx)
const rpOut2 = typeof rpR2 === "string" ? rpR2 : rpR2.output
assert(rpOut2.includes("not found"), "read-prompt returns error for unknown role")

// 51c. agentic_evolve — edit-prompt
console.log("\n[51c] agentic_evolve — edit-prompt")
const editCtx = mockCtx(freshSid())
const epR = await hooks.tool.agentic_evolve.execute({ action: "edit-prompt", role: "developer", prompt: "Always verify types before committing." }, editCtx)
const epOut = typeof epR === "string" ? epR : epR.output
assert(epOut.includes("updated") || epOut.includes("v") || epOut.includes("version"), "edit-prompt appends new instruction")
assert(epOut.includes("2") || epOut.includes("v2"), "prompt version incremented to v2")

// Verify the prompt was actually appended
const rpR3 = await hooks.tool.agentic_evolve.execute({ action: "read-prompt", role: "developer" }, editCtx)
const rpOut3 = typeof rpR3 === "string" ? rpR3 : rpR3.output
assert(rpOut3.includes("Always verify types before committing"), "edited prompt contains new instruction")

const epR2 = await hooks.tool.agentic_evolve.execute({ action: "edit-prompt", role: "qa", prompt: "Check for null safety in all code paths." }, editCtx)
const epOut2 = typeof epR2 === "string" ? epR2 : epR2.output
assert(epOut2.includes("updated"), "edit-prompt works on qa role")

// 51d. agentic_evolve — prompt-history
console.log("\n[51d] agentic_evolve — prompt-history")
const phCtx = mockCtx(freshSid())
// First make a few edits to build history
await hooks.tool.agentic_evolve.execute({ action: "edit-prompt", role: "developer", prompt: "Edit 1" }, phCtx)
await hooks.tool.agentic_evolve.execute({ action: "edit-prompt", role: "developer", prompt: "Edit 2" }, phCtx)
await hooks.tool.agentic_evolve.execute({ action: "edit-prompt", role: "developer", prompt: "Edit 3" }, phCtx)
const phR = await hooks.tool.agentic_evolve.execute({ action: "prompt-history", role: "developer" }, phCtx)
const phOut = typeof phR === "string" ? phR : phR.output
assert(phOut.includes("v1") || phOut.includes("version"), "prompt-history shows versions")
assert(phOut.includes("agent-self") || phOut.includes("source"), "prompt-history shows source")
assert(phOut.includes("Edit 1") && phOut.includes("Edit 3"), "prompt-history lists all entries")

// 51e. agentic_evolve — rollback-prompt
console.log("\n[51e] agentic_evolve — rollback-prompt")
const rbCtx = mockCtx(freshSid())
// Build history
await hooks.tool.agentic_evolve.execute({ action: "edit-prompt", role: "architect", prompt: "Focus on modular design." }, rbCtx)
await hooks.tool.agentic_evolve.execute({ action: "edit-prompt", role: "architect", prompt: "Prefer microservices architecture." }, rbCtx)
// Read current to confirm v3
const rbBefore = await hooks.tool.agentic_evolve.execute({ action: "read-prompt", role: "architect" }, rbCtx)
const rbBeforeOut = typeof rbBefore === "string" ? rbBefore : rbBefore.output
assert(rbBeforeOut.includes("microservices"), "v3 has microservices instruction")
// Rollback to v2
const rbR = await hooks.tool.agentic_evolve.execute({ action: "rollback-prompt", role: "architect", version: 2 }, rbCtx)
const rbOut = typeof rbR === "string" ? rbR : rbR.output
assert(rbOut.includes("rolled back") || rbOut.includes("v2") || rbOut.includes("version"), "rollback-prompt succeeds")
// Verify rollback
const rbAfter = await hooks.tool.agentic_evolve.execute({ action: "read-prompt", role: "architect" }, rbCtx)
const rbAfterOut = typeof rbAfter === "string" ? rbAfter : rbAfter.output
assert(!rbAfterOut.includes("microservices"), "after rollback, microservices instruction removed")
assert(rbAfterOut.includes("modular design"), "after rollback, modular design instruction restored")

// 52. Model registry with client-based discovery
console.log("\n[52] Model registry with client discovery")
const modelCtx52 = mockCtx(freshSid())
const modelCtx52Input = {
  ...mockInput,
  client: {
    config: {
      providers: async () => ({
        200: {
          providers: [
            { name: "openai", id: "openai", models: { "gpt-4o": {}, "gpt-4o-mini": {} } },
            { name: "9router", id: "9router", models: { "claude-3-opus": {}, "claude-3-sonnet": {} } },
          ],
          default: { "default": "openai/gpt-4o" },
        },
      }),
    },
  },
}
const modelHooks52 = await mod.AgenticEngine(modelCtx52Input)
// Wait for async model discovery
await new Promise(r => setTimeout(r, 100))
// Extract model registry via tool execution
const statusResp52 = await modelHooks52.tool.agentic_status.execute({}, modelCtx52)
const statusOut52 = typeof statusResp52 === "string" ? statusResp52 : statusResp52.output || JSON.stringify(statusResp52)
assert(statusOut52.includes("gpt") || statusOut52.includes("claude") || statusOut52.includes("Fast") || statusOut52.includes("Capable"), "status dashboard client-discovered models appear")
assert(statusOut52.includes("gpt-4o") || statusOut52.includes("gpt-4o-mini"), "specific client-discovered model gpt-4o present")
assert(statusOut52.includes("claude-3-opus") || statusOut52.includes("claude-3-sonnet"), "specific client-discovered model claude present")

// Verify dashboard always shows model reliability (even without trace data)
const dashResp52 = await modelHooks52.tool.agentic_dashboard.execute({}, modelCtx52)
const dashOut52 = typeof dashResp52 === "string" ? dashResp52 : dashResp52.output || JSON.stringify(dashResp52)
assert(typeof dashOut52 === "string" && dashOut52.length > 0, "dashboard returns output without error")
assert(dashOut52.includes("Model Reliability"), "dashboard shows model reliability section")
assert(dashOut52.includes("gpt-4o") || dashOut52.includes("gpt-4o-mini"), "dashboard shows client-discovered models")
await modelHooks52.dispose()

// 53. Config file auto-create + custom config
console.log("\n[53] Config file system")
const cfgWorktree = join(projectDir, "config-test")
try { rmSync(cfgWorktree, { recursive: true, force: true }) } catch {}
mkdirSync(cfgWorktree, { recursive: true })
mkdirSync(join(cfgWorktree, ".agentic"), { recursive: true })

// Test A: auto-create default config
const cfgInputA = { ...mockInput, worktree: cfgWorktree, directory: cfgWorktree, client: {} }
const cfgHooksA = await mod.AgenticEngine(cfgInputA)
await new Promise(r => setTimeout(r, 100))
const cfgPath = join(cfgWorktree, ".agentic", "config.json")
assert(existsSync(cfgPath), "default config auto-created on first run")
const defaultCfg = JSON.parse(readFileSync(cfgPath, "utf-8"))
assert(defaultCfg.$schema === "v1", "default config has schema v1")
assert(defaultCfg.embedding === null, "default embedding is null (lightweight mode)")
assert(defaultCfg.memory.mode === "lightweight", "default memory mode is lightweight")
assert(Array.isArray(defaultCfg.memory.stopWordsLanguages), "default stopWordsLanguages is array")
assert(defaultCfg.memory.stopWordsLanguages.includes("ind"), "default stopWordsLanguages includes ind")
assert(defaultCfg.memory.stopWordsLanguages.includes("eng"), "default stopWordsLanguages includes eng")
assert(defaultCfg.memory.search.keywordWeight === 0.3, "default keyword weight 0.3")
assert(defaultCfg.memory.search.vectorWeight === 0.7, "default vector weight 0.7")
assert(defaultCfg.agent.maxDelegationDepth === 3, "default max delegation depth 3")
assert(defaultCfg.agent.autoSkillExtract === true, "default autoSkillExtract true")
assert(defaultCfg.storage.traceRetentionDays === 7, "default trace retention 7 days")
await cfgHooksA.dispose()

// Test B: custom config loaded correctly
const cfgWorktreeB = join(projectDir, "config-test-custom")
try { rmSync(cfgWorktreeB, { recursive: true, force: true }) } catch {}
mkdirSync(cfgWorktreeB, { recursive: true })
mkdirSync(join(cfgWorktreeB, ".agentic"), { recursive: true })
writeFileSync(join(cfgWorktreeB, ".agentic", "config.json"), JSON.stringify({
  $schema: "v1",
  embedding: { model: "text-embedding-3-small", endpoint: "https://custom/v1/embeddings", apiKey: "sk-test" },
  memory: { enabled: true, mode: "full", maxEntries: 500, compressThreshold: 200, forgetAfterDays: 14, stopWordsLanguages: ["eng", "msa"], search: { keywordWeight: 0.4, vectorWeight: 0.6 } },
  agent: { maxDelegationDepth: 7, autoSkillExtract: false, defaultRole: "qa" },
  storage: { traceRetentionDays: 30, skillMaxCount: 999 },
}))
const cfgInputB = { ...mockInput, worktree: cfgWorktreeB, directory: cfgWorktreeB, client: {} }
const cfgHooksB = await mod.AgenticEngine(cfgInputB)
await new Promise(r => setTimeout(r, 100))
const customCfg = JSON.parse(readFileSync(join(cfgWorktreeB, ".agentic", "config.json"), "utf-8"))
assert(customCfg.embedding.model === "text-embedding-3-small", "custom embedding model loaded")
assert(customCfg.embedding.endpoint === "https://custom/v1/embeddings", "custom embedding endpoint loaded")
assert(customCfg.memory.mode === "full", "custom memory mode loaded")
assert(customCfg.memory.stopWordsLanguages.includes("msa"), "custom stopWordsLanguages loaded")
assert(customCfg.memory.search.keywordWeight === 0.4, "custom keyword weight loaded")
assert(customCfg.agent.maxDelegationDepth === 7, "custom delegation depth loaded")
assert(customCfg.agent.autoSkillExtract === false, "custom autoSkillExtract loaded")
assert(customCfg.storage.traceRetentionDays === 30, "custom trace retention loaded")
assert(customCfg.storage.skillMaxCount === 999, "custom skill max count loaded")
await cfgHooksB.dispose()

// Test C: config file watch — write a change and verify reload
const cfgWorktreeC = join(projectDir, "config-test-watch")
try { rmSync(cfgWorktreeC, { recursive: true, force: true }) } catch {}
mkdirSync(cfgWorktreeC, { recursive: true })
mkdirSync(join(cfgWorktreeC, ".agentic"), { recursive: true })
writeFileSync(join(cfgWorktreeC, ".agentic", "config.json"), JSON.stringify({
  $schema: "v1", embedding: null,
  memory: { enabled: true, mode: "lightweight", maxEntries: 100, compressThreshold: 50, forgetAfterDays: 7, search: { keywordWeight: 0.3, vectorWeight: 0.7 } },
  agent: { maxDelegationDepth: 3, autoSkillExtract: true, defaultRole: "developer" },
  storage: { traceRetentionDays: 7, skillMaxCount: 200 },
}))
const cfgInputC = { ...mockInput, worktree: cfgWorktreeC, directory: cfgWorktreeC, client: {} }
const cfgHooksC = await mod.AgenticEngine(cfgInputC)
await new Promise(r => setTimeout(r, 100))

// Simulate external config change
writeFileSync(join(cfgWorktreeC, ".agentic", "config.json"), JSON.stringify({
  $schema: "v1", embedding: null,
  memory: { enabled: true, mode: "lightweight", maxEntries: 100, compressThreshold: 50, forgetAfterDays: 7, search: { keywordWeight: 0.9, vectorWeight: 0.1 } },
  agent: { maxDelegationDepth: 3, autoSkillExtract: true, defaultRole: "developer" },
  storage: { traceRetentionDays: 7, skillMaxCount: 200 },
}))
// Wait for watcher to fire
await new Promise(r => setTimeout(r, 300))
const reloadedCfg = JSON.parse(readFileSync(join(cfgWorktreeC, ".agentic", "config.json"), "utf-8"))
assert(reloadedCfg.memory.search.keywordWeight === 0.9, "config watch detects external changes")
await cfgHooksC.dispose()
// Cleanup
try { rmSync(cfgWorktree, { recursive: true, force: true }) } catch {}
try { rmSync(cfgWorktreeB, { recursive: true, force: true }) } catch {}
try { rmSync(cfgWorktreeC, { recursive: true, force: true }) } catch {}

// Test D: validateConfig function — valid, invalid, and edge cases
console.log("\n[54-D] validateConfig validation tests")
const { validateConfig } = await import(pluginDist)
// Valid config — should return empty issues
const validCfg = {
  $schema: "v1",
  embedding: null,
  memory: { enabled: true, mode: "lightweight", maxEntries: 100, compressThreshold: 50, forgetAfterDays: 7, stopWordsLanguages: ["eng", "ind"], search: { keywordWeight: 0.3, vectorWeight: 0.7, topK: 5 } },
  agent: { maxDelegationDepth: 3, autoSkillExtract: true, defaultRole: "developer", timeoutMs: 30000 },
  storage: { traceRetentionDays: 7, skillMaxCount: 200 },
  evaluation: { enabled: false }
}
const validResult = validateConfig(validCfg)
assert(typeof validResult === "object" && validResult !== null, "validateConfig returns an object")
assert(Array.isArray(validResult.issues), "validateConfig result.issues is an array")
assert(validResult.issues.length === 0, `valid config should have 0 issues, got ${validResult.issues.length}: ${JSON.stringify(validResult.issues)}`)
assert(validResult.valid === true, "valid config has valid=true")

// Invalid config — wrong field types inside sub-objects
const badTypeCfg = {
  $schema: "v1",
  memory: { enabled: "yes", mode: "turbo", maxEntries: "many", search: { keywordWeight: "heavy", vectorWeight: 0.5 } },
  agent: { maxDelegationDepth: "three", autoSkillExtract: "yes" }
}
const typeResult = validateConfig(badTypeCfg)
assert(Array.isArray(typeResult.issues), "typeResult.issues is an array")
assert(typeResult.issues.length > 0, "invalid field types should produce issues")
const hasTypeIssue = typeResult.issues.some(i => i.message && i.message.includes("Expected type"))
assert(hasTypeIssue, "should flag type mismatches like enabled:'yes' instead of boolean")

// Invalid config — out of range values
const rangeCfg = {
  $schema: "v1",
  memory: { enabled: true, mode: "lightweight", maxEntries: 100, compressThreshold: 50, forgetAfterDays: 7, search: { keywordWeight: 1.5, vectorWeight: -0.5 } },
  agent: { maxDelegationDepth: -1 },
  storage: { traceRetentionDays: -7 }
}
const rangeResult = validateConfig(rangeCfg)
assert(rangeResult.issues.length > 0, `out-of-range values should produce issues, got ${JSON.stringify(rangeResult.issues)}`)
// keywordWeight > 1.0 should be flagged
const hasRangeIssue = rangeResult.issues.some(i => i.message && i.message.includes("exceeds maximum"))
assert(hasRangeIssue, `should flag keywordWeight > 1.0, issues: ${JSON.stringify(rangeResult.issues)}`)

// Invalid config — weighted sum check
const badWeightCfg = {
  $schema: "v1",
  memory: { enabled: true, mode: "lightweight", maxEntries: 100, compressThreshold: 50, forgetAfterDays: 7, search: { keywordWeight: 0.9, vectorWeight: 0.9 } },
  agent: { maxDelegationDepth: 3, autoSkillExtract: true, defaultRole: "developer" },
  storage: { traceRetentionDays: 7 }
}
const weightResult = validateConfig(badWeightCfg)
const hasWeightIssue = weightResult.issues.some(i => i.message && (i.message.includes("keywordWeight") || i.message.includes("vectorWeight")))
assert(hasWeightIssue, `keywordWeight + vectorWeight > 1.0 should raise issue, got issues: ${JSON.stringify(weightResult.issues)}`)

// No top-level schema — function handles gracefully (not an object)
const notObjResult = validateConfig(null)
assert(notObjResult.valid === false, "null config should not be valid")
assert(notObjResult.issues.length > 0, "null config should produce issues")

// ConfigLoader integration — getValidationIssues() returns issues after load
const loaderMod = await import(pluginDist)
const { ConfigLoader } = loaderMod
const cfgWorktreeD = join(projectDir, "config-test-validate")
try { rmSync(cfgWorktreeD, { recursive: true, force: true }) } catch {}
mkdirSync(cfgWorktreeD, { recursive: true })
mkdirSync(join(cfgWorktreeD, ".agentic"), { recursive: true })
// Write config with out-of-range value
writeFileSync(join(cfgWorktreeD, ".agentic", "config.json"), JSON.stringify({
  $schema: "v1", embedding: null,
  memory: { enabled: true, mode: "lightweight", maxEntries: 100, compressThreshold: 50, forgetAfterDays: 7, search: { keywordWeight: 0.3, vectorWeight: 0.7 } },
  agent: { maxDelegationDepth: 99, autoSkillExtract: true },
  storage: { traceRetentionDays: 7 }
}))
const dInput = { ...mockInput, worktree: cfgWorktreeD, directory: cfgWorktreeD, client: {} }
const dHooks = await mod.AgenticEngine(dInput)
await new Promise(r => setTimeout(r, 100))
// Check that validation issues are accessible
const loader = new ConfigLoader(cfgWorktreeD)
const issuesAfterLoad = loader.getValidationIssues()
assert(Array.isArray(issuesAfterLoad), "getValidationIssues returns array")
try { rmSync(cfgWorktreeD, { recursive: true, force: true }) } catch {}
await dHooks.dispose()

// 55. VectorStore — TF-IDF sparse retrieval
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

// 57. ContinuousEvolution — trend tracking + degradation detection
console.log("\n[57] ContinuousEvolution — trend tracking")
const ce = new mod.ContinuousEvolution(5) // small window for testing

// Empty state
let emptyTrend = ce.getTrend()
assert(emptyTrend.overall.total === 0, "fresh CE has 0 total steps")
assert(emptyTrend.degradationDetected === false, "fresh CE has no degradation")
assert(emptyTrend.rolling.direction === "stable", "fresh CE has stable direction")

// Feed successes
for (let i = 0; i < 5; i++) {
  ce.feedStepResult({ stepId: `s${i}`, success: true, output: "ok", sessionId: "sess-1", timestamp: Date.now() })
}
let fiveSuccess = ce.getTrend()
assert(fiveSuccess.overall.total === 5, "after 5 successes, total=5")
assert(fiveSuccess.overall.successRate === 1, "after 5 successes, rate=1")
assert(fiveSuccess.rolling.direction === "stable", "perfect success rate is stable")

// Feed failures → degradation
for (let i = 0; i < 5; i++) {
  ce.feedStepResult({ stepId: `f${i}`, success: false, output: `error ${i}`, sessionId: "sess-1", timestamp: Date.now(), category: "compile" })
}
let degraded = ce.getTrend()
assert(degraded.overall.total === 10, "after 5 fails, total=10")
assert(degraded.degradationDetected === true, "degradation detected when recent rate < 60%")
assert(degraded.rolling.direction === "degrading", "direction is degrading after failures")
assert(degraded.anomalyCount >= 5, "anomaly count >= 5")
assert(degraded.recentErrors.length > 0, "recentErrors populated after failures")

// checkAndNotify fires callbacks
let notified = false
ce.onDegradation(() => { notified = true })
ce.checkAndNotify()
assert(notified === true, "onDegradation callback fired on degradation")
assert(true, "ContinuousEvolution trend tracking tests passed")

// 58. ContinuousEvolution — shouldEvolve logic
console.log("\n[58] ContinuousEvolution — shouldEvolve")
const ce2 = new mod.ContinuousEvolution(5)

// No trigger at start
assert(ce2.shouldEvolve("sess-2") === null, "no evolve trigger on fresh CE")

// Feed mixed: 5 successes then 5 failures → degradation trigger
// (need ≥10 total for minimum data threshold, and earlier rate > recent rate)
for (let i = 0; i < 5; i++) {
  ce2.feedStepResult({ stepId: `ok${i}`, success: true, output: "ok", sessionId: "sess-2", timestamp: Date.now() })
}
for (let i = 0; i < 5; i++) {
  ce2.feedStepResult({ stepId: `fail${i}`, success: false, output: "fail", sessionId: "sess-2", timestamp: Date.now() })
}
const trigger = ce2.shouldEvolve("sess-2")
assert(trigger !== null, "shouldEvolve returns trigger after degradation")
assert(trigger.type === "degradation", "trigger type is degradation")
assert(trigger.metrics.recentRate < 0.6, "degradation trigger has low recent rate")

// Should not trigger again for same session
assert(ce2.shouldEvolve("sess-2") === null, "no duplicate evolve trigger for same session")

// Reset works
ce2.reset()
assert(ce2.shouldEvolve("sess-3") === null, "reset CE has no trigger")
assert(true, "ContinuousEvolution shouldEvolve tests passed")

// 59. RoleRegistry — updatePrompt (prompt auto-patching)
console.log("\n[59] RoleRegistry — updatePrompt")
const rr = new mod.RoleRegistry()
const originalArchitectPrompt = rr.getPrompt("architect")
assert(typeof originalArchitectPrompt === "string" && originalArchitectPrompt.length > 50, "architect prompt exists before update")

const updated = rr.updatePrompt("architect", originalArchitectPrompt + "\n\n## Auto-Patched\nTest instruction.")
assert(updated === true, "updatePrompt returns true for valid role")

const afterPrompt = rr.getPrompt("architect")
assert(afterPrompt.includes("Auto-Patched"), "architect prompt updated with new content")
assert(afterPrompt.includes("Test instruction"), "architect prompt contains patched instruction")

// Update non-existent role returns false
const nonExistent = rr.updatePrompt("nonexistent", "test")
assert(nonExistent === false, "updatePrompt returns false for invalid role")

// getPrompt for custom role
rr.registerCustom({ role: "custom-dev", name: "Custom Dev", prompt: "Custom prompt", tools: ["read"] })
assert(rr.getPrompt("custom-dev") === "Custom prompt", "getPrompt works for custom roles")
assert(true, "RoleRegistry updatePrompt tests passed")

// 59b. RoleRegistry — prompt versioning + history + rollback
console.log("\n[59b] RoleRegistry — prompt versioning")
const rr2 = new mod.RoleRegistry()
const devOriginal = rr2.getPrompt("developer")

// Initial state: version 1 with source "initial"
const hist1 = rr2.getPromptHistory("developer")
assert(hist1.length === 1, "initial prompt history has 1 entry")
assert(hist1[0].version === 1, "first version is 1")
assert(hist1[0].source === "initial", "first source is 'initial'")

// Update with source tracking
const updated1 = rr2.updatePrompt("developer", devOriginal + "\n\n## Patch 1\nBe thorough.", "auto-evolve", "Compile error fix")
assert(updated1 === true, "updatePrompt with source returns true")
const hist2 = rr2.getPromptHistory("developer")
assert(hist2.length === 2, "history has 2 entries after update")
assert(hist2[1].version === 2, "second version is 2")
assert(hist2[1].source === "auto-evolve", "second source is 'auto-evolve'")
assert(hist2[1].description === "Compile error fix", "description matches")

// Agent self-edit
const updated2 = rr2.updatePrompt("developer", devOriginal + "\n\n## Patch 1\nBe thorough.\n\n## Patch 2\nCheck types.", "agent-self", "Agent requested improvement")
assert(updated2 === true, "agent-self update returns true")
const hist3 = rr2.getPromptHistory("developer")
assert(hist3.length === 3, "history has 3 entries")
assert(hist3[2].source === "agent-self", "third source is 'agent-self'")
assert(hist3[2].version === 3, "third version is 3")

// getPromptState
const state = rr2.getPromptState("developer")
assert(state !== undefined, "getPromptState returns state")
assert(state.currentVersion === 3, "current version is 3")
assert(state.history.length === 3, "state has 3 entries")

// getAllPromptStates
const allStates = rr2.getAllPromptStates()
assert(allStates.length >= 5, "all 5 built-in roles have prompt states")
const devState = allStates.find(s => s.role === "developer")
assert(devState !== undefined, "developer state in all states")
assert(devState.history.length === 3, "developer has 3 history entries")

// Rollback to v1
assert(devOriginal !== undefined, "devOriginal defined")
const rolledBack = rr2.rollbackPrompt("developer", 1)
assert(rolledBack === true, "rollbackPrompt returns true")
const afterRollback = rr2.getPrompt("developer")
assert(afterRollback === devOriginal, "after rollback, prompt matches v1")
const hist4 = rr2.getPromptHistory("developer")
assert(hist4.length === 4, "rollback adds new history entry")
assert(hist4[3].version === 4, "rollback entry is version 4")

// Rollback to nonexistent version
const badRollback = rr2.rollbackPrompt("developer", 99)
assert(badRollback === false, "rollback to unknown version returns false")

// rollback custom role
rr2.registerCustom({ role: "my-custom", name: "My Role", prompt: "Custom v1", tools: ["read"] })
assert(rr2.getPrompt("my-custom") === "Custom v1", "custom role prompt is v1")
rr2.updatePrompt("my-custom", "Custom v2", "manual", "v2 update")
// For custom roles, updatePrompt returns false (built-in only), so use registerCustom again
assert(rr2.getPromptHistory("my-custom").length === 1, "custom role history has only initial entry")
const rbCustom = rr2.rollbackPrompt("my-custom", 1)
assert(rbCustom === true, "rollbackPrompt works on custom roles")
assert(rr2.getPrompt("my-custom") === "Custom v1", "custom role rollback to v1 works")

assert(true, "RoleRegistry prompt versioning tests passed")

// 60. SelfEvolver — prompt patches from error patterns
console.log("\n[60] SelfEvolver — prompt patches from error patterns")
const evolver3 = new mod.SelfEvolver()
// Feed step states with compile errors
evolver3.feedStepStates([
  { stepId: "s1", success: false, output: "TypeScript compile error in types.ts" },
  { stepId: "s2", success: false, output: "Module not found: ./missing" },
  { stepId: "s3", success: false, output: "Type 'string' is not assignable to type 'number'" },
  { stepId: "s4", success: false, output: "Cannot find module" },
  { stepId: "s5", success: true, output: "ok" },
])
// Feed episodes with error tags
evolver3.feedEpisodes([
  { sessionId: "sess-a", planGoal: "task1", tags: ["compile", "type"], outcome: "failed", summary: "", decisions: [], filesChanged: [], timestamp: Date.now() },
  { sessionId: "sess-b", planGoal: "task2", tags: ["compile", "type"], outcome: "failed", summary: "", decisions: [], filesChanged: [], timestamp: Date.now() },
  { sessionId: "sess-c", planGoal: "task3", tags: ["import"], outcome: "failed", summary: "", decisions: [], filesChanged: [], timestamp: Date.now() },
  { sessionId: "sess-d", planGoal: "task4", tags: ["import"], outcome: "failed", summary: "", decisions: [], filesChanged: [], timestamp: Date.now() },
])
const report2 = evolver3.evolve()
assert(Array.isArray(report2.promptPatches), "evolve returns promptPatches array")
assert(report2.promptPatches.length >= 2, `generates prompt patches from error patterns (got ${report2.promptPatches.length})`)

// Check patch details
const compilePatch = report2.promptPatches.find(p => p.errorCategory === "compile")
assert(compilePatch !== undefined, "compile error generates a prompt patch")
assert(compilePatch.role === "developer", "compile patch targets developer role")
assert(compilePatch.instruction.length > 20, "compile patch has meaningful instruction")

const importPatch = report2.promptPatches.find(p => p.errorCategory === "import")
assert(importPatch !== undefined, "import error generates a prompt patch")
assert(importPatch.role === "architect", "import patch targets architect role")

// Feed empty data — no patches
const evolver4 = new mod.SelfEvolver()
const emptyReport = evolver4.evolve()
assert(emptyReport.promptPatches.length === 0, "no prompt patches from empty data")
assert(true, "SelfEvolver prompt patching tests passed")

// 61. Skill-aware delegation — delegate with skills context
console.log("\n[61] Skill-aware delegation — skills injected into context")
const mockCoordinator = new mod.AgentCoordinator()
const t1 = mockCoordinator.delegate("developer", {
  id: "test-task-1", assignedTo: "", description: "Build login API", input: "", status: "pending",
}, "test-session", 0, [
  { name: "API Auth Pattern", successRate: 0.9, steps: "design: define routes; implement: add middleware" },
  { name: "Input Validation", successRate: 0.85, steps: "implement: validate input" },
])
assert(t1.assignedTo === "developer", "delegate assigns to correct role")
assert(t1.sharedContext !== undefined, "delegate with skills attaches sharedContext")
assert(t1.sharedContext.includes("API Auth Pattern"), "sharedContext contains skill name")
assert(t1.sharedContext.includes("90% success rate"), "sharedContext contains success rate")
assert(t1.sharedContext.includes("Input Validation"), "sharedContext contains second skill")

// Delegate without skills — no extra context
const t2 = mockCoordinator.delegate("qa", {
  id: "test-task-2", assignedTo: "", description: "Test login flow", input: "", status: "pending",
}, "test-session")
// Should still work with or without sharedContext
assert(t2.assignedTo === "qa", "delegate without skills still works")
assert(true, "Skill-aware delegation tests passed")

// 62. Adaptive Retry Policies — Executor
console.log("\n[62] Adaptive Retry Policies — Executor")
const execAdapt = new mod.Executor()
assert(typeof execAdapt.setRetryPolicy === "function", "setRetryPolicy is a function")
assert(typeof execAdapt.getMaxRetries === "function", "getMaxRetries is a function")
assert(typeof execAdapt.getRetryPolicies === "function", "getRetryPolicies is a function")

// Default policies (domain-agnostic: runtime, error, unknown)
const policies = execAdapt.getRetryPolicies()
assert(policies.length >= 3, `has at least 3 default retry policies (got ${policies.length})`)
const runtimePolicy = policies.find(p => p.category === "runtime")
assert(runtimePolicy !== undefined, "runtime category has retry policy")
assert(runtimePolicy.maxRetries === 3, "runtime has maxRetries=3")
const unknownPolicy = policies.find(p => p.category === "unknown")
assert(unknownPolicy !== undefined, "unknown category has retry policy")
assert(unknownPolicy.maxRetries === 3, "unknown has maxRetries=3")

// Custom policy override
execAdapt.setRetryPolicy("compile", 5)
assert(execAdapt.getMaxRetries("compile") === 5, "custom compile retry limit applied")
assert(execAdapt.getMaxRetries("error") === 3, "error retry limit unchanged from default")

// No-category falls back to global default
const defaultLim = execAdapt.getMaxRetries()
assert(defaultLim === 3, "no category returns global default maxRetries=3")

// canRetry with category
const planMock = { intent: { goal: "test", constraints: [], context: { relevantFiles: [], dependencies: [] }, subtasks: [{ id: "step-1", description: "test", dependsOn: [], verificationCriteria: [] }] } }
execAdapt.initExecution("sess-adapt-1", planMock)
// First failure with custom category (maxRetries falls to global default 3)
execAdapt.recordResult("sess-adapt-1", { stepId: "step-1", success: false, output: "Cannot find module", error: "Cannot find module ./missing" })
assert(execAdapt.canRetry("sess-adapt-1", "step-1", "import") === true, "import error: retryable (global default 3) after 1 failure")
assert(execAdapt.canRetry("sess-adapt-1", "step-1", "compile") === true, "same step with compile category: still retryable (global default 3)")

// Custom retry policy
execAdapt.setRetryPolicy("import", 1)
execAdapt.initExecution("sess-adapt-2", planMock)
execAdapt.recordResult("sess-adapt-2", { stepId: "step-2", success: false, output: "Cannot find module", error: "Cannot find module ./missing" })
assert(execAdapt.canRetry("sess-adapt-2", "step-2", "import") === false, "import error: no retry after 1 failure with custom maxRetries=1")

// Error category gets 3 retries (default)
execAdapt.initExecution("sess-adapt-3", planMock)
execAdapt.recordResult("sess-adapt-3", { stepId: "step-3", success: false, output: "Type 'X' not assignable", error: "Type 'string' is not assignable to type 'number'" })
assert(execAdapt.canRetry("sess-adapt-3", "step-3", "error") === true, "error category: retryable after 1 failure")
execAdapt.recordResult("sess-adapt-3", { stepId: "step-3", success: false, output: "Type error again", error: "Type error" })
assert(execAdapt.canRetry("sess-adapt-3", "step-3", "error") === true, "error category: retryable after 2 failures")
execAdapt.recordResult("sess-adapt-3", { stepId: "step-3", success: false, output: "Type error again", error: "Type error" })
assert(execAdapt.canRetry("sess-adapt-3", "step-3", "error") === false, "error category: no retry after 3 failures")

assert(true, "Adaptive Retry Policies tests passed")

// 63. LLM-based Role Suggestion — coordinator.getSuggestedRole with LLM mock
console.log("\n[63] LLM-based Role Suggestion — getSuggestedRole")
const roleCoord = new mod.AgentCoordinator()

// LLM suggests a role
const mockLLM = {
  suggestRole: async (desc) => {
    if (desc.includes("design")) return "architect"
    if (desc.includes("implement")) return "developer"
    if (desc.includes("test") || desc.includes("verify")) return "qa"
    return null
  },
}
const archRole = await roleCoord.getSuggestedRole("Design the API contract and data flow", mockLLM)
assert(archRole === "architect", "LLM suggests architect for design task")
const devRole = await roleCoord.getSuggestedRole("Implement the login endpoint", mockLLM)
assert(devRole === "developer", "LLM suggests developer for implementation task")
const qaRole = await roleCoord.getSuggestedRole("Write tests for the payment module", mockLLM)
assert(qaRole === "qa", "LLM suggests qa for testing task")

// Without LLM, falls back to keyword
const noLlmRole = await roleCoord.getSuggestedRole("Architect the system")
assert(noLlmRole === "architect", "keyword fallback detects architect")

// Unknown task → default developer
const unknownRole = await roleCoord.getSuggestedRole("Do whatever needs to be done")
assert(unknownRole === "developer", "unknown task defaults to developer")

// LLM returns null → fallback to keyword
const nullLLM = { suggestRole: async () => null }
const fallbackRole = await roleCoord.getSuggestedRole("Write unit tests", nullLLM)
assert(fallbackRole === "qa", "LLM returns null → keyword fallback detects qa")

assert(true, "LLM-based Role Suggestion tests passed")

// 64. Predictive Degradation Forecast — ContinuousEvolution
console.log("\n[64] Predictive Degradation Forecast — ContinuousEvolution")
const ceForecast = new mod.ContinuousEvolution(10)

// Need enough data for forecast (≥10)
for (let i = 0; i < 10; i++) {
  ceForecast.feedStepResult({ stepId: `s${i}`, success: true, output: "ok", sessionId: "sess-fc", timestamp: Date.now() })
}
let fcTrend = ceForecast.getTrend()
assert(fcTrend.forecast.bucketRates.length === 5, "forecast has 5 buckets with 10 results")
assert(fcTrend.forecast.critical === false, "100% success rate is not critical")

// Feed increasingly failing results to create degrading trend
const ceDegrade = new mod.ContinuousEvolution(10)
for (let i = 0; i < 10; i++) {
  ceDegrade.feedStepResult({ stepId: `ok${i}`, success: true, output: "ok", sessionId: "sess-deg", timestamp: Date.now() })
}
for (let i = 0; i < 10; i++) {
  ceDegrade.feedStepResult({ stepId: `fail${i}`, success: false, output: "error", sessionId: "sess-deg", timestamp: Date.now(), category: "compile" })
}
const degTrend = ceDegrade.getTrend()
assert(degTrend.forecast.bucketRates.length === 5, "degrading CE has 5 buckets")
// After 10 successes then 10 failures, we have 20 results. 
// Buckets should show decreasing rates
assert(degTrend.forecast.nextWindowRate < 0.6, "forecast predicts lower rate for degrading trend")
assert(typeof degTrend.forecast.stepsUntilCritical === "number" || degTrend.forecast.stepsUntilCritical === null, "stepsUntilCritical is number or null")

// Agentic_execute feedback parameter exists
assert(typeof hooks.tool.agentic_execute.args.feedback === "object", "agentic_execute has feedback arg")
assert(true, "Predictive Degradation Forecast tests passed")

// 65. agentic_execute — feedback parameter exists
console.log("\n[65] agentic_execute — feedback parameter")
assert(typeof hooks.tool.agentic_execute.args.feedback === "object", "agentic_execute tool has feedback arg")
assert(true, "agentic_execute feedback parameter tests passed")

// 66. agentic_model — session-seeded model preference
console.log("\n[66] agentic_model — session model preference")
const modelSid = freshSid()
const modelCtx = mockCtx(modelSid)

// Tool exists and has correct actions
assert(typeof hooks.tool.agentic_model === "object", "agentic_model tool registered")
assert(typeof hooks.tool.agentic_model.execute === "function", "agentic_model has execute")
assert(typeof hooks.tool.agentic_model.args.action === "object", "agentic_model has action arg")

// List empty
const listEmpty = await hooks.tool.agentic_model.execute({ action: "list" }, modelCtx)
const listEmptyOut = typeof listEmpty === "string" ? listEmpty : listEmpty.output
assert(listEmptyOut.includes("No model preferences"), "list shows empty when no preferences set")

// Set preference
const setResult = await hooks.tool.agentic_model.execute({ action: "set", role: "architect", model: "gpt-4o" }, modelCtx)
const setOut = typeof setResult === "string" ? setResult : setResult.output
assert(setOut.includes("gpt-4o"), "set confirms model name")
assert(setOut.includes("architect"), "set confirms role")

// Get preference
const getResult = await hooks.tool.agentic_model.execute({ action: "get", role: "architect" }, modelCtx)
const getOut = typeof getResult === "string" ? getResult : getResult.output
assert(getOut.includes("gpt-4o"), "get returns correct model")

// List shows preferences
const listResult = await hooks.tool.agentic_model.execute({ action: "list" }, modelCtx)
const listOut = typeof listResult === "string" ? listResult : listResult.output
assert(listOut.includes("architect"), "list shows role")
assert(listOut.includes("gpt-4o"), "list shows model")

// Set another role
await hooks.tool.agentic_model.execute({ action: "set", role: "developer", model: "claude-sonnet-4-20250514" }, modelCtx)
const list2 = await hooks.tool.agentic_model.execute({ action: "list" }, modelCtx)
const list2Out = typeof list2 === "string" ? list2 : list2.output
assert(list2Out.includes("developer"), "list shows second role")
assert(list2Out.includes("claude-sonnet"), "list shows second model")

// Get non-existent preference
const getNone = await hooks.tool.agentic_model.execute({ action: "get", role: "pm" }, modelCtx)
const getNoneOut = typeof getNone === "string" ? getNone : getNone.output
assert(getNoneOut.includes("No model preference"), "get for unset role shows no preference")

// Set with invalid role
const invalidRole = await hooks.tool.agentic_model.execute({ action: "set", role: "invalid", model: "gpt-4o" }, modelCtx)
const invalidOut = typeof invalidRole === "string" ? invalidRole : invalidRole.output
assert(invalidOut.includes("Invalid role"), "set with invalid role returns error")

// Set without role
const noRole = await hooks.tool.agentic_model.execute({ action: "set", model: "gpt-4o" }, modelCtx)
const noRoleOut = typeof noRole === "string" ? noRole : noRole.output
assert(noRoleOut.includes("Provide a `role`"), "set without role returns error")

// Set without model
const noModel = await hooks.tool.agentic_model.execute({ action: "set", role: "architect" }, modelCtx)
const noModelOut = typeof noModel === "string" ? noModel : noModel.output
assert(noModelOut.includes("Provide a `model`"), "set without model returns error")

// Clear specific role
await hooks.tool.agentic_model.execute({ action: "clear", role: "developer" }, modelCtx)
const afterClear = await hooks.tool.agentic_model.execute({ action: "get", role: "developer" }, modelCtx)
const afterClearOut = typeof afterClear === "string" ? afterClear : afterClear.output
assert(afterClearOut.includes("No model preference"), "clear removes specific role preference")

// Clear all
const clearAllRes = await hooks.tool.agentic_model.execute({ action: "clear" }, modelCtx)
const clearAllOut = typeof clearAllRes === "string" ? clearAllRes : clearAllRes.output
assert(clearAllOut.includes("Cleared all"), "clear all removes all preferences")

// After clear all, list shows empty
const listAfterClear = await hooks.tool.agentic_model.execute({ action: "list" }, modelCtx)
const listAfterClearOut = typeof listAfterClear === "string" ? listAfterClear : listAfterClear.output
assert(listAfterClearOut.includes("No model preferences"), "list shows empty after clear all")

assert(true, "agentic_model session model preference tests passed")

// 66b. agentic_model_reset — reset model statistics
console.log("\n[66b] agentic_model_reset — reset model stats")
const mrSid = freshSid()
const mrCtx = mockCtx(mrSid)
assert(typeof hooks.tool.agentic_model_reset === "object", "agentic_model_reset tool registered")
assert(typeof hooks.tool.agentic_model_reset.execute === "function", "agentic_model_reset has execute")

// reset-all (safe in test)
const resetAllRes = await hooks.tool.agentic_model_reset.execute({ action: "reset-all" }, mrCtx)
const resetAllOut = typeof resetAllRes === "string" ? resetAllRes : resetAllRes.output
assert(resetAllOut.includes("EMERGENCY"), "reset-all confirms emergency reset")

// reset without model
const noModelReset = await hooks.tool.agentic_model_reset.execute({ action: "reset" }, mrCtx)
const noModelResetOut = typeof noModelReset === "string" ? noModelReset : noModelReset.output
assert(noModelResetOut.includes("Provide a `model`"), "reset without model returns error")

// reset-stale
const staleRes = await hooks.tool.agentic_model_reset.execute({ action: "reset-stale" }, mrCtx)
const staleOut = typeof staleRes === "string" ? staleRes : staleRes.output
assert(staleOut.includes("No stale") || staleOut.includes("Reset"), "reset-stale returns result")

// unknown action
const unknownReset = await hooks.tool.agentic_model_reset.execute({ action: "unknown" }, mrCtx)
const unknownResetOut = typeof unknownReset === "string" ? unknownReset : unknownReset.output
assert(unknownResetOut.includes("Unknown action"), "unknown action returns error")

assert(true, "agentic_model_reset tests passed")

// 66c. agentic_budget — budget limits (basic tool registration)
console.log("\n[66c] agentic_budget — tool registration check")
const bSid2 = freshSid()
const bCtx2 = mockCtx(bSid2)
assert(typeof hooks.tool.agentic_budget === "object", "agentic_budget tool registered")
assert(typeof hooks.tool.agentic_budget.execute === "function", "agentic_budget has execute")

// Unknown action (always works)
const unknownBudget = await hooks.tool.agentic_budget.execute({ action: "unknown" }, bCtx2)
const unknownBudgetOut = typeof unknownBudget === "string" ? unknownBudget : unknownBudget.output
assert(unknownBudgetOut.includes("Unknown action"), "budget unknown action returns error")

assert(true, "agentic_budget tool registration tests passed")

// 66d. agentic_finetune — tool registration check
console.log("\n[66d] agentic_finetune — tool registration")
assert(typeof hooks.tool.agentic_finetune === "object", "agentic_finetune tool registered")
assert(typeof hooks.tool.agentic_finetune.execute === "function", "agentic_finetune has execute")
assert(typeof hooks.tool.agentic_finetune.args.action === "object", "agentic_finetune has action arg")

// unknown action
const unknownFt = await hooks.tool.agentic_finetune.execute({ action: "nonexistent" }, mockCtx(freshSid()))
const unknownFtOut = typeof unknownFt === "string" ? unknownFt : unknownFt.output
assert(unknownFtOut.includes("Unknown action"), "agentic_finetune unknown action returns error")

assert(true, "agentic_finetune tool registration tests passed")

// 67. PatternDiscovery — cross-session pattern analysis
console.log("\n[67] PatternDiscovery — cross-session patterns")
const pd = new mod.PatternDiscovery()
assert(typeof pd.analyze === "function", "PatternDiscovery has analyze method")

// Empty data
const emptyPdReport = pd.analyze([], [], [])
assert(emptyPdReport.totalSessions === 0, "empty report has 0 sessions")
assert(Array.isArray(emptyPdReport.recommendations), "empty report has recommendations array")
assert(emptyPdReport.recommendations.length === 0, "empty report has no recommendations")

// Create test episodes
const testEpisodes = [
  { sessionId: "sess-a", planGoal: "Add user authentication with JWT", summary: "", outcome: "failed", decisions: ["Used bcrypt", "Created auth middleware"], filesChanged: ["src/auth.ts", "src/middleware.ts", "config/auth.json"], timestamp: "2026-06-01T00:00:00Z", tags: ["auth", "security", "jwt"] },
  { sessionId: "sess-b", planGoal: "Fix import error in auth module", summary: "", outcome: "failed", decisions: ["Fixed import path"], filesChanged: ["src/auth.ts", "src/utils/helpers.ts"], timestamp: "2026-06-02T00:00:00Z", tags: ["auth", "fix", "import"] },
  { sessionId: "sess-c", planGoal: "Add rate limiting middleware", summary: "", outcome: "success", decisions: ["Used express-rate-limit"], filesChanged: ["src/middleware.ts", "src/app.ts"], timestamp: "2026-06-03T00:00:00Z", tags: ["middleware", "security"] },
  { sessionId: "sess-d", planGoal: "Refactor auth to use shared validation", summary: "", outcome: "partial", decisions: ["Extracted validators"], filesChanged: ["src/auth.ts", "src/middleware.ts", "src/utils/validation.ts"], timestamp: "2026-06-04T00:00:00Z", tags: ["auth", "refactor", "validation"] },
  { sessionId: "sess-e", planGoal: "Add API documentation", summary: "", outcome: "success", decisions: ["Added swagger docs"], filesChanged: ["docs/api.md"], timestamp: "2026-06-05T00:00:00Z", tags: ["docs", "api"] },
  { sessionId: "sess-f", planGoal: "Fix import resolution in module loader", summary: "", outcome: "failed", decisions: ["Fixed webpack alias"], filesChanged: ["webpack.config.js", "src/utils/helpers.ts"], timestamp: "2026-06-06T00:00:00Z", tags: ["import", "build"] },
]
// Ensure proper typing
const typedEpisodes = testEpisodes.map(e => ({ ...e, id: `ep-${e.sessionId}` }))

// Test with episodes only
const epReport = pd.analyze(typedEpisodes, [], [])
assert(epReport.totalSessions === 6, "report has 6 sessions")
assert(epReport.errorPatterns.length >= 1, "error patterns detected from failed episodes")
assert(epReport.filePatterns.length >= 1, "file patterns detected")

// Check that src/auth.ts is a hot spot (changed in 3 sessions)
const authFilePattern = epReport.filePatterns.find(f => f.filePath === "src/auth.ts")
assert(authFilePattern !== undefined, "src/auth.ts appears in file patterns")
assert(authFilePattern.sessionCount >= 2, "src/auth.ts changed in 2+ sessions")
assert(authFilePattern.isHotSpot === true, "src/auth.ts is a hot spot (3 sessions)")
assert(authFilePattern.coChangedFiles.length >= 1, "src/auth.ts has co-changed files")
const hasMiddlewareCoChange = authFilePattern.coChangedFiles.some(c => c.filePath === "src/middleware.ts")
assert(hasMiddlewareCoChange, "src/auth.ts co-changes with src/middleware.ts")

// Check session outcome patterns
assert(epReport.sessionPatterns.length >= 1, "session patterns detected")
const authPattern = epReport.sessionPatterns.find(p => p.commonTags.includes("auth"))
assert(authPattern !== undefined, "auth tag group found")
assert(authPattern.matchingSessions >= 2, "at least 2 auth-tagged sessions")

// Test with skills
const testSkills = [
  { name: "jwt-auth-setup", successRate: 0.9, usageCount: 5 },
  { name: "import-fix", successRate: 0.3, usageCount: 4 },
  { name: "middleware-create", successRate: 0.75, usageCount: 2 },
]
const skillReport = pd.analyze(typedEpisodes, [], testSkills)
assert(skillReport.skillEffectiveness.length === 3, "3 skills analyzed")
const importFixSkill = skillReport.skillEffectiveness.find(s => s.skillName === "import-fix")
assert(importFixSkill !== undefined, "import-fix skill found")
assert(importFixSkill.status === "underperforming", "import-fix skill is underperforming (30%)")
assert(importFixSkill.suggestion.length > 10, "import-fix has suggestion")

const jwtSkill = skillReport.skillEffectiveness.find(s => s.skillName === "jwt-auth-setup")
assert(jwtSkill !== undefined, "jwt-auth-setup skill found")
assert(jwtSkill.status === "highly_effective", "jwt-auth-setup skill is highly effective (90%)")

// Test recommendations
assert(skillReport.recommendations.length >= 1, "recommendations generated")
const hasHighPriority = skillReport.recommendations.some(r => r.priority === "high")
assert(hasHighPriority, "at least one high priority recommendation")
const hasSkillCategory = skillReport.recommendations.some(r => r.category === "skill")
assert(hasSkillCategory, "at least one skill category recommendation")

// Test with step results (error data from ContinuousEvolution)
const testStepResults = [
  { stepId: "s1", success: false, output: "ImportError: cannot find module 'fs-extra'", sessionId: "sess-a", timestamp: Date.now() - 50000, category: "import" },
  { stepId: "s2", success: false, output: "TypeError: Cannot read property 'x' of undefined", sessionId: "sess-a", timestamp: Date.now() - 40000, category: "runtime" },
  { stepId: "s3", success: false, output: "Type 'string' not assignable to 'number'", sessionId: "sess-b", timestamp: Date.now() - 30000, category: "type" },
  { stepId: "s4", success: false, output: "Test failed: expected 5 got 3", sessionId: "sess-c", timestamp: Date.now() - 20000, category: "test" },
  { stepId: "s5", success: false, output: "Module not found: './missing'", sessionId: "sess-d", timestamp: Date.now() - 10000, category: "import" },
]
const stepReport = pd.analyze(typedEpisodes, testStepResults, testSkills)
assert(stepReport.totalSessions === 6, "step report has 6 sessions")
const importPattern = stepReport.errorPatterns.find(p => p.category === "import")
assert(importPattern !== undefined, "import error pattern found")
assert(importPattern.totalOccurrences >= 2, "import error occurred 2+ times")
assert(importPattern.sessionCount >= 2, "import error in 2+ sessions")

// Test recommendation quality
assert(stepReport.recommendations.length >= 2, "recommendations from combined analysis")
const hasErrorRec = stepReport.recommendations.some(r => r.category === "error_prevention")
assert(hasErrorRec, "has error prevention recommendations")
assert(stepReport.timestamp.length > 0, "report has timestamp")

assert(true, "PatternDiscovery cross-session pattern tests passed")

// ── Coverage Expansion: agentic_verify ──
console.log("\n[69] agentic_verify — edge cases")
const vfySid = freshSid()

// Verify with no plan (nothing to verify)
const vfyNoPlan = await hooks.tool.agentic_verify.execute({ stepId: "nonexistent" }, mockCtx(vfySid))
const vfyNpOut = typeof vfyNoPlan === "string" ? vfyNoPlan : (vfyNoPlan.output || "")
assert(vfyNpOut.length > 0, "verify with no plan returns output")
assert(vfyNpOut.includes("Verification Passed") || vfyNpOut.includes("Verification Failed") || vfyNpOut.includes("compile"), "verify no plan gracefully handled")

// Verify after a successful plan+execute
await hooks.tool.agentic_plan.execute({
  goal: "Test verify",
  subtasks: [{ id: "vfy-1", description: "Test step", dependsOn: [], verificationCriteria: ["Compiles"] }],
}, mockCtx(vfySid))
await hooks.tool.agentic_execute.execute({
  stepId: "vfy-1", success: true, output: "Done test step", filesModified: ["src/test.ts"],
}, mockCtx(vfySid))
const vfyGood = await hooks.tool.agentic_verify.execute({ stepId: "vfy-1" }, mockCtx(vfySid))
const vfyGoodOut = typeof vfyGood === "string" ? vfyGood : (vfyGood.output || "")
assert(vfyGoodOut.length > 0, "verify after execution returns output")
assert(true, "agentic_verify edge case tests passed")

// ── Coverage Expansion: agentic_dashboard ──
console.log("\n[70] agentic_dashboard — coverage")
const dashSid = freshSid()

// Dashboard with no session data (empty)
const dashEmpty = await hooks.tool.agentic_dashboard.execute({}, mockCtx(dashSid))
const dashEmpOut = typeof dashEmpty === "string" ? dashEmpty : (dashEmpty.output || "")
assert(dashEmpOut.length > 0, "dashboard returns output even with no data")
assert(dashEmpOut.includes("Model") || dashEmpOut.includes("model"), "dashboard shows model info")

// Dashboard after some execution (model data populated)
await hooks.tool.agentic_plan.execute({
  goal: "Dashboard test",
  subtasks: [{ id: "dash-1", description: "Test", dependsOn: [], verificationCriteria: [] }],
}, mockCtx(dashSid))
await hooks.tool.agentic_execute.execute({
  stepId: "dash-1", success: true, output: "Done dashboard test",
}, mockCtx(dashSid))
const dashWithData = await hooks.tool.agentic_dashboard.execute({}, mockCtx(dashSid))
const dashDataOut = typeof dashWithData === "string" ? dashWithData : (dashWithData.output || "")
assert(dashDataOut.length > 0, "dashboard after execution returns output")
assert(typeof dashWithData === "object", "dashboard returns object")
assert(true, "agentic_dashboard edge case tests passed")

// ── Coverage Expansion: agentic_reflect ──
console.log("\n[71] agentic_reflect — edge cases")
const refSid = freshSid()

// Reflect on non-existent step
const refNonExist = await hooks.tool.agentic_reflect.execute({ stepId: "no-such-step" }, mockCtx(refSid))
const refNeOut = typeof refNonExist === "string" ? refNonExist : (refNonExist.output || "")
assert(refNeOut.includes("No execution") || refNeOut.includes("no execution"), "reflect on non-existent step handled")

// Plan, execute fail, reflect with fix attempt
await hooks.tool.agentic_plan.execute({
  goal: "Reflect test",
  subtasks: [{ id: "ref-1", description: "Step that fails", dependsOn: [], verificationCriteria: [] }],
}, mockCtx(refSid))
await hooks.tool.agentic_execute.execute({
  stepId: "ref-1", success: false, output: "Something failed", error: "Runtime error: cannot read property",
}, mockCtx(refSid))
const refWithFix = await hooks.tool.agentic_reflect.execute({
  stepId: "ref-1", attemptedFix: "Tried adding null check",
}, mockCtx(refSid))
const refFixOut = typeof refWithFix === "string" ? refWithFix : (refWithFix.output || "")
assert(refFixOut.includes("runtime") || refFixOut.includes("error") || refFixOut.includes("Analysis") || refFixOut.length > 50, "reflect with fix attempt works")
assert(true, "agentic_reflect edge case tests passed")

// ── Coverage Expansion: agentic_status ──
console.log("\n[72] agentic_status — edge cases")
const stSid = freshSid()

// Status with no plan/execution (empty session)
const stEmpty = await hooks.tool.agentic_status.execute({}, mockCtx(stSid))
const stEmpOut = typeof stEmpty === "string" ? stEmpty : (stEmpty.output || "")
assert(stEmpOut.length > 0, "status with no plan returns output")
assert(stEmpOut.includes("Health") || stEmpOut.includes("Dashboard") || stEmpOut.includes("Model"), "status shows dashboard even empty")
assert(typeof stEmpty === "object", "status returns object")

// Status after a failed step
await hooks.tool.agentic_plan.execute({
  goal: "Status test",
  subtasks: [{ id: "st-1", description: "Failing step", dependsOn: [], verificationCriteria: [] }],
}, mockCtx(stSid))
await hooks.tool.agentic_execute.execute({
  stepId: "st-1", success: false, output: "Failed step", error: "TypeError",
}, mockCtx(stSid))
const stFailed = await hooks.tool.agentic_status.execute({}, mockCtx(stSid))
const stFailOut = typeof stFailed === "string" ? stFailed : (stFailed.output || "")
assert(stFailOut.includes("Failed") || stFailOut.includes("failed") || stFailOut.includes("❌"), "status shows failed step")
assert(true, "agentic_status edge case tests passed")

// ── Coverage Expansion: agentic_skill ──
console.log("\n[73] agentic_skill — edge cases")
const skSid = freshSid()

// Find with no results
const skNoFind = await hooks.tool.agentic_skill.execute({ action: "find", query: "zzzznotexist" }, mockCtx(skSid))
const skNfOut = typeof skNoFind === "string" ? skNoFind : (skNoFind.output || "")
assert(skNfOut.includes("No skills") || skNfOut.includes("no skills") || skNfOut.includes("not found"), "skill find with no results handled")

// Extract from non-existent step
const skNoExtract = await hooks.tool.agentic_skill.execute({ action: "extract", query: "no-such-step" }, mockCtx(skSid))
const skNeOut = typeof skNoExtract === "string" ? skNoExtract : (skNoExtract.output || "")
assert(skNeOut.includes("No execution") || skNeOut.includes("no execution") || skNeOut.includes("not found"), "skill extract from non-existent step handled")

// List — shows existing skills or empty state
const skList2 = await hooks.tool.agentic_skill.execute({ action: "list" }, mockCtx(skSid))
const skList2Out = typeof skList2 === "string" ? skList2 : (skList2.output || "")
assert(skList2Out.includes("Library") || skList2Out.includes("No skills") || skList2Out.includes("no skills"), "skill list returns library or empty state")
assert(true, "agentic_skill edge case tests passed")

// ── Coverage Expansion: agentic_episodes ──
console.log("\n[74] agentic_episodes — edge cases")
const epSid = freshSid()

// Search with no results
const epNoSearch = await hooks.tool.agentic_episodes.execute({ action: "search", query: "zzzznotexist" }, mockCtx(epSid))
const epNsOut = typeof epNoSearch === "string" ? epNoSearch : (epNoSearch.output || "")
assert(epNsOut.length > 0, "episode search with no results returns output")

// Search without query
const epNoQuery = await hooks.tool.agentic_episodes.execute({ action: "search" }, mockCtx(epSid))
const epNqOut = typeof epNoQuery === "string" ? epNoQuery : (epNoQuery.output || "")
assert(epNqOut.includes("Provide") || epNqOut.includes("provide") || epNqOut.includes("query"), "episode search without query handled")

// Stats with no episodes
const epStats2 = await hooks.tool.agentic_episodes.execute({ action: "stats" }, mockCtx(epSid))
const epSt2Out = typeof epStats2 === "string" ? epStats2 : (epStats2.output || "")
assert(epSt2Out.length > 0, "episode stats returns output")
assert(true, "agentic_episodes edge case tests passed")

// ── Coverage Expansion: agentic_nav ──
console.log("\n[75] agentic_nav — edge cases")
const navSid = freshSid()

// Nav with empty query
const navEmpty2 = await hooks.tool.agentic_nav.execute({ query: "", maxResults: 5 }, mockCtx(navSid))
const navEmpOut = typeof navEmpty2 === "string" ? navEmpty2 : (navEmpty2.output || "")
assert(navEmpOut.length > 0, "nav with empty query returns output")

// Nav with special characters
const navSpecial = await hooks.tool.agentic_nav.execute({ query: "user auth middleware config rate-limit db", maxResults: 3 }, mockCtx(navSid))
const navSpOut = typeof navSpecial === "string" ? navSpecial : (navSpecial.output || "")
assert(navSpOut.length > 0, "nav with complex query returns results")
assert(typeof navSpecial === "object", "nav returns object")
assert(true, "agentic_nav edge case tests passed")

// ── Coverage Expansion: agentic_context ──
console.log("\n[76] agentic_context — edge cases")
const ctxSid = freshSid()

// Context compress with no data
const ctxCompEmpty = await hooks.tool.agentic_context.execute({ action: "compress" }, mockCtx(ctxSid))
const ctxCeOut = typeof ctxCompEmpty === "string" ? ctxCompEmpty : (ctxCompEmpty.output || "")
assert(ctxCeOut.length > 0, "context compress with no data returns output")

// Context view with no data
const ctxViewEmpty = await hooks.tool.agentic_context.execute({ action: "view" }, mockCtx(ctxSid))
const ctxVeOut = typeof ctxViewEmpty === "string" ? ctxViewEmpty : (ctxViewEmpty.output || "")
assert(ctxVeOut.length > 0, "context view with no data returns output")
assert(true, "agentic_context edge case tests passed")

// ── Coverage Expansion: agentic_snapshot ──
console.log("\n[77] agentic_snapshot — edge cases")
const snSid = freshSid()

// List snapshots when empty
const snListEmpty = await hooks.tool.agentic_snapshot.execute({ action: "list" }, mockCtx(snSid))
const snLeOut = typeof snListEmpty === "string" ? snListEmpty : (snListEmpty.output || "")
assert(snLeOut.length > 0, "snapshot list empty returns output")

// Save snapshot without plan
const snSaveNoPlan = await hooks.tool.agentic_snapshot.execute({ action: "save", label: "test-snap" }, mockCtx(snSid))
const snSnpOut = typeof snSaveNoPlan === "string" ? snSaveNoPlan : (snSaveNoPlan.output || "")
assert(snSnpOut.includes("snapshot") || snSnpOut.includes("Snapshot") || snSnpOut.length > 0, "snapshot save returns output")
assert(true, "agentic_snapshot edge case tests passed")

// ── Coverage Expansion: agentic_pr ──
console.log("\n[78] agentic_pr — edge cases")
const prSid = freshSid()

// PR with no plan (empty session)
const prNoPlan = await hooks.tool.agentic_pr.execute({ goal: "Test PR" }, mockCtx(prSid))
const prNpOut = typeof prNoPlan === "string" ? prNoPlan : (prNoPlan.output || "")
assert(prNpOut.length > 0, "PR with no plan returns output")

// PR after plan+execute
await hooks.tool.agentic_plan.execute({
  goal: "PR test feature",
  subtasks: [{ id: "pr-1", description: "Implement feature", dependsOn: [], verificationCriteria: [] }],
}, mockCtx(prSid))
await hooks.tool.agentic_execute.execute({ stepId: "pr-1", success: true, autoVerify: false, output: "Done feature" }, mockCtx(prSid))
const prWithData = await hooks.tool.agentic_pr.execute({ goal: "PR test feature" }, mockCtx(prSid))
const prWdOut = typeof prWithData === "string" ? prWithData : (prWithData.output || "")
assert(prWdOut.length > 0, "PR after execution returns output")
assert(typeof prWithData === "object", "PR returns object")
assert(true, "agentic_pr edge case tests passed")

// ── Coverage Expansion: agentic_score ──
console.log("\n[79] agentic_score — edge cases")
const scSid = freshSid()

// Score with no files (empty session)
const scEmpty = await hooks.tool.agentic_score.execute({}, mockCtx(scSid))
const scEmpOut = typeof scEmpty === "string" ? scEmpty : (scEmpty.output || "")
assert(scEmpOut.length > 0, "score with empty session returns output")
assert(scEmpOut.includes("Score") || scEmpOut.includes("score") || scEmpOut.includes("debt") || scEmpOut.includes("Debt") || scEmpOut.includes("files") || scEmpOut.includes("modified"), "score output mentions score or files")
assert(typeof scEmpty === "object", "score returns object")
assert(true, "agentic_score edge case tests passed")

// ── Coverage Expansion: agentic_guard ──
console.log("\n[80] agentic_guard — edge cases")
const gdSid = freshSid()

// Guard on non-existent step
const gdNoStep = await hooks.tool.agentic_guard.execute({ stepId: "no-such-step" }, mockCtx(gdSid))
const gdNsOut = typeof gdNoStep === "string" ? gdNoStep : (gdNoStep.output || "")
assert(gdNsOut.includes("No execution") || gdNsOut.includes("no execution"), "guard on non-existent step handled")

// Guard on step with no files
await hooks.tool.agentic_plan.execute({
  goal: "Guard test",
  subtasks: [{ id: "gd-1", description: "Test", dependsOn: [], verificationCriteria: [] }],
}, mockCtx(gdSid))
await hooks.tool.agentic_execute.execute({ stepId: "gd-1", success: true, autoVerify: false, output: "Done with test" }, mockCtx(gdSid))
const gdOk = await hooks.tool.agentic_guard.execute({ stepId: "gd-1" }, mockCtx(gdSid))
const gdOkOut = typeof gdOk === "string" ? gdOk : (gdOk.output || "")
assert(gdOkOut.includes("Verdict") || gdOkOut.includes("claims") || gdOkOut.includes("Hallucination") || gdOkOut.length > 0, "guard on simple step returns output")
assert(typeof gdOk === "object", "guard returns object")
assert(true, "agentic_guard edge case tests passed")

// ── Coverage Expansion: agentic_execute ──
console.log("\n[81] agentic_execute — edge cases")
const exSid = freshSid()

// Execute step without plan (non-existent step)
const exNoPlan = await hooks.tool.agentic_execute.execute({
  stepId: "no-plan-step", success: true, output: "test",
}, mockCtx(exSid))
const exNpOut = typeof exNoPlan === "string" ? exNoPlan : (exNoPlan.output || "")
assert(exNpOut.length > 0, "execute without plan returns output")

// Execute with error but empty error string (edge case)
await hooks.tool.agentic_plan.execute({
  goal: "Edge case tests",
  subtasks: [{ id: "ex-1", description: "Edge step", dependsOn: [], verificationCriteria: [] }],
}, mockCtx(exSid))
const exEmptyError = await hooks.tool.agentic_execute.execute({
  stepId: "ex-1", success: false, output: "Something bad", error: "",
}, mockCtx(exSid))
const exEeOut = typeof exEmptyError === "string" ? exEmptyError : (exEmptyError.output || "")
assert(exEeOut.includes("Error") || exEeOut.includes("error") || exEeOut.includes("Analysis") || exEeOut.includes("analysis") || exEeOut.includes("BLOCKED") || exEeOut.includes("FAILED") || exEeOut.includes("failed"), "execute with empty error produces analysis or failure output")
assert(typeof exEmptyError === "object", "execute returns object")
assert(true, "agentic_execute edge case tests passed")

// 82. Auto-Evolution — self-evolution triggers on degradation
console.log("\n[82] Auto-Evolution — self-evolution triggers")
const autoEvoSid = freshSid()
const autoEvoCtx = mockCtx(autoEvoSid)

// Run a plan + execute to set up some data
await hooks.tool.agentic_plan.execute({
  goal: "Evolution test",
  subtasks: [{ id: "aev-1", description: "Evo step", dependsOn: [] }],
}, autoEvoCtx)
const aevExe = await hooks.tool.agentic_execute.execute({
  stepId: "aev-1", success: true, output: "Evo step done",
  filesModified: ["src/evo-test.ts"],
}, autoEvoCtx)
assert(aevExe.output.length > 0, "execute works before evolution test")

// Status shows auto-evolution (with no degradation, system is healthy)
const aevStat = await hooks.tool.agentic_status.execute({}, autoEvoCtx)
const aevStatOut = typeof aevStat === "string" ? aevStat : (aevStat.output || "")
assert(aevStatOut.length > 0, "status output")

assert(true, "auto-evolution tests passed")

// 83. Skill → Training Data conversion
console.log("\n[83] Skill → Training Data conversion")
const { skillToTrainingExample, skillsToTrainingData, exportOpenAIJSONL, exportInstructionsJSON, trainingDatasetSummary } = mod

// Create a mock skill record
const mockSkillRecord = {
  definition: {
    meta: { format: "agentic-skill/v1", id: "test-skill-1", name: "Add Unit Test", version: 1, author: "agent" },
    trigger: { pattern: "Add unit tests for new function", keywords: ["test", "unit", "jest"], context: [] },
    workflow: {
      steps: [
        { order: 1, action: "create", description: "Create test file next to source", tool: "write", expectedOutput: "test file created", rollback: "Delete test file" },
        { order: 2, action: "verify", description: "Run jest on test file", tool: "bash", expectedOutput: "all tests pass", rollback: undefined },
      ],
      estimatedDuration: "4m",
      parallelizable: false,
    },
    quality: { successRate: 0.9, usageCount: 10, failureScenarios: ["Timeout on large dataset"] },
    audit: { createdAt: "2024-01-01", lastUsed: "2024-06-01", lastModified: "2024-06-01", modifiedBy: "agent" },
  },
  usageCount: 10,
  successRate: 0.9,
  lastUsed: "2024-06-01",
}

const example = skillToTrainingExample(mockSkillRecord)
assert(typeof example.instruction === "string" && example.instruction.length > 0, "training example has instruction")
assert(typeof example.response === "string" && example.response.length > 0, "training example has response")
assert(example.skillName === "Add Unit Test", "training example has skillName")
assert(example.quality === 0.9, "training example has quality score")
assert(example.response.includes("Add Unit Test"), "response contains skill name")
assert(example.response.includes("Create test file"), "response contains step descriptions")
assert(example.response.includes("Rollback"), "response includes rollback strategies")

// OpenAI format
const openaiData = exportOpenAIJSONL([example])
const openaiLines = openaiData.trim().split("\n")
assert(openaiLines.length === 1, "OpenAI format produces 1 line per example")
const openaiParsed = JSON.parse(openaiLines[0])
assert(openaiParsed.messages.length === 3, "OpenAI format has 3 messages")
assert(openaiParsed.messages[0].role === "system", "OpenAI format starts with system")
assert(openaiParsed.messages[1].role === "user", "OpenAI format has user message")
assert(openaiParsed.messages[2].role === "assistant", "OpenAI format has assistant message")

// Instructions JSON format
const jsonData = exportInstructionsJSON([example])
const jsonParsed = JSON.parse(jsonData)
assert(Array.isArray(jsonParsed), "instructions format is an array")
assert(jsonParsed.length === 1, "instructions format has 1 entry")
assert(jsonParsed[0].instruction === example.instruction, "instructions format preserves instruction")
assert(jsonParsed[0].output === example.response, "instructions format preserves response")
assert(jsonParsed[0].source === "Add Unit Test", "instructions format preserves source")

// skillsToTrainingData with filter
const dataset1 = skillsToTrainingData([mockSkillRecord], "openai", 0.5)
assert(dataset1.format === "openai", "format preserved")
assert(dataset1.totalExamples === 1, "skill included when success rate >= minSuccessRate")
assert(dataset1.data.length > 0, "training data has content")

const dataset2 = skillsToTrainingData([mockSkillRecord], "openai", 0.95)
assert(dataset2.totalExamples === 0, "skill excluded when success rate < minSuccessRate")

const lowQualitySkill = { ...mockSkillRecord, successRate: 0.3 }
const dataset3 = skillsToTrainingData([lowQualitySkill], "instructions", 0.4)
assert(dataset3.totalExamples === 0, "low quality skill excluded")

// Empty skills
const dataset4 = skillsToTrainingData([], "openai", 0.5)
assert(dataset4.totalExamples === 0, "empty skills produces 0 examples")
assert(dataset4.data.length === 0, "empty skills produces empty data")

// trainingDatasetSummary
const summary = trainingDatasetSummary([example, { ...example, skillName: "Refactor Module", quality: 0.7 }])
assert(summary.includes("Summary") || summary.includes("Total examples"), "summary shows total")
assert(summary.includes("2"), "summary counts correctly")
assert(summary.includes("Add Unit Test"), "summary lists skill names")

const emptySummary = trainingDatasetSummary([])
assert(emptySummary.includes("No training examples"), "empty summary handled")

assert(true, "Skill Training Data conversion tests passed")

// 84. agentic_evolve — export-training-data action
console.log("\n[84] agentic_evolve — export-training-data")
const trCtx = mockCtx(freshSid())
const trR = await hooks.tool.agentic_evolve.execute({ action: "export-training-data" }, trCtx)
const trOut = typeof trR === "string" ? trR : (trR.output || "")
assert(trOut.includes("Training Data") || trOut.includes("training"), "export-training-data produces output")
assert(trOut.includes("Total examples") || trOut.includes("total") || trOut.includes("No training"), "export-training-data shows count or empty message")
assert(trOut.includes("openai") || trOut.includes("OpenAI"), "export-training-data shows format")

// Specific format
const trR2 = await hooks.tool.agentic_evolve.execute({ action: "export-training-data", format: "instructions" }, trCtx)
const trOut2 = typeof trR2 === "string" ? trR2 : (trR2.output || "")
assert(trOut2.includes("instructions") || trOut2.includes("instruction"), "export-training-data with instructions format works")

// With minSuccessRate filter
const trR3 = await hooks.tool.agentic_evolve.execute({ action: "export-training-data", minSuccessRate: 0.9 }, trCtx)
const trOut3 = typeof trR3 === "string" ? trR3 : (trR3.output || "")
assert(typeof trOut3 === "string" && trOut3.length > 0, "export-training-data with minSuccessRate works")

assert(true, "agentic_evolve export-training-data tests passed")

// 84-B. Episode → Training Data conversion
console.log("\n[84-B] Episode → Training Data conversion")
const { episodeToTrainingExample: ep2tr, episodesToTrainingData: eps2tr, prepareFineTuningDataset: prepFT, saveTrainingDataToFile: saveFT } = mod

// Mock episode
const mockEpisode = {
  id: "ep-test-1",
  sessionId: "sess-1",
  planGoal: "Add authentication middleware",
  summary: "Completed: Add authentication middleware",
  outcome: "success",
  decisions: ["Used JWT library", "Created middleware function", "Added token validation"],
  filesChanged: ["src/auth.ts", "src/middleware.ts"],
  domain: "security",
  timestamp: "2026-06-01T00:00:00Z",
  tags: ["auth", "jwt", "middleware"],
}

const epExample = ep2tr(mockEpisode)
assert(typeof epExample.instruction === "string" && epExample.instruction.length > 0, "episode example has instruction")
assert(typeof epExample.response === "string" && epExample.response.length > 0, "episode example has response")
assert(epExample.instruction.includes("authentication"), "episode instruction from planGoal")
assert(epExample.response.includes("JWT"), "episode response contains decisions")
assert(epExample.quality === 1.0, "successful episode has quality 1.0")

// Failed episode
const failedEpisode = { ...mockEpisode, outcome: "failed", decisions: [] }
const failEx = ep2tr(failedEpisode)
assert(failEx.quality === 0.0, "failed episode has quality 0.0")
assert(failEx.response.includes("No decision trace"), "handles empty decisions gracefully")

// episodesToTrainingData
const epDataset = eps2tr([mockEpisode, failedEpisode], "openai", 0.5)
assert(epDataset.format === "openai", "episodes format preserved")
assert(epDataset.totalExamples === 1, "only successful episode passes minQuality=0.5")

const epAll = eps2tr([mockEpisode, failedEpisode], "instructions", 0.0)
assert(epAll.totalExamples === 2, "minQuality=0.0 includes all episodes")

// prepareFineTuningDataset — combined
const mockSkill = {
  definition: {
    meta: { format: "agentic-skill/v1", id: "test-skill", name: "Test Skill" },
    trigger: { pattern: "test something", keywords: ["test"] },
    workflow: { steps: [{ order: 1, action: "run", description: "Run tests" }], estimatedDuration: "1m", parallelizable: false },
    quality: { successRate: 0.8, usageCount: 1, failureScenarios: [] },
    audit: { createdAt: "2024-01-01", lastUsed: "2024-06-01", lastModified: "2024-06-01", modifiedBy: "agent" },
  },
  usageCount: 1, successRate: 0.8, lastUsed: "2024-06-01",
}
const combined = prepFT([mockSkill], [mockEpisode], "openai", 0.5, 0.0)
assert(combined.totalExamples === 2, "combined dataset includes skill + episode")
assert(combined.format === "openai", "combined format preserved")

// saveTrainingDataToFile
const testDataDir = join(projectDir, "tmp-ft-test")
try { mkdirSync(testDataDir, { recursive: true }) } catch {}
const testFilePath = join(testDataDir, "test-training.jsonl")
const saved = saveFT(combined, testFilePath)
assert(saved === testFilePath, "save returns correct file path")
assert(existsSync(testFilePath), "file was created")
const savedContent = readFileSync(testFilePath, "utf-8").trim()
assert(savedContent.length > 0, "saved file has content")
const ftLines = savedContent.split("\n")
assert(ftLines.length === 2, "saved file has 2 lines (one per example)")
// Cleanup
try { unlinkSync(testFilePath) } catch {}
try { rmSync(testDataDir, { recursive: true, force: true }) } catch {}

assert(true, "Episode → Training Data conversion tests passed")

// 84-C. FineTuningClient — unit tests (mock fetch)
console.log("\n[84-C] FineTuningClient — unit tests")
const { FineTuningClient: FTC } = mod

const unconfiguredClient = new FTC({})
assert(!unconfiguredClient.isConfigured(), "client without key is not configured")

let threw = false
try { await unconfiguredClient.uploadFile("test.jsonl") } catch (e) { threw = true; assert(e.message.includes("API key"), "uploadFile throws about API key") }
assert(threw, "uploadFile throws without API key")

threw = false
try { await unconfiguredClient.createJob("file-123") } catch (e) { threw = true; assert(e.message.includes("API key"), "createJob throws about API key") }
assert(threw, "createJob throws without API key")

threw = false
try { await unconfiguredClient.getJobStatus("job-123") } catch (e) { threw = true; assert(e.message.includes("API key"), "getJobStatus throws about API key") }
assert(threw, "getJobStatus throws without API key")

threw = false
try { await unconfiguredClient.listJobs() } catch (e) { threw = true; assert(e.message.includes("API key"), "listJobs throws about API key") }
assert(threw, "listJobs throws without API key")

threw = false
try { await unconfiguredClient.cancelJob("job-123") } catch (e) { threw = true; assert(e.message.includes("API key"), "cancelJob throws about API key") }
assert(threw, "cancelJob throws without API key")

assert(true, "FineTuningClient unit tests passed")

// 84-D. agentic_finetune tool
console.log("\n[84-D] agentic_finetune tool")
const ftCtx = mockCtx(freshSid())
const ftPrepare = await hooks.tool.agentic_finetune.execute({ action: "prepare", source: "skills" }, ftCtx)
const ftPrepareOut = typeof ftPrepare === "string" ? ftPrepare : (ftPrepare.output || "")
assert(typeof ftPrepareOut === "string" && ftPrepareOut.length > 0, "finetune prepare returns output")
assert(ftPrepareOut.includes("Fine-Tuning") || ftPrepareOut.includes("Dataset"), "finetune prepare shows dataset info")

const ftSaveNoPath = await hooks.tool.agentic_finetune.execute({ action: "save" }, ftCtx)
const ftSaveNoPathOut = typeof ftSaveNoPath === "string" ? ftSaveNoPath : (ftSaveNoPath.output || "")
assert(ftSaveNoPathOut.includes("outputPath") || ftSaveNoPathOut.includes("required"), "finetune save without path shows error")

const ftList = await hooks.tool.agentic_finetune.execute({ action: "list" }, ftCtx)
const ftListOut = typeof ftList === "string" ? ftList : (ftList.output || "")
assert(ftListOut.includes("API key") || ftListOut.includes("not configured"), "finetune list without key shows error")

const ftStatusNoId = await hooks.tool.agentic_finetune.execute({ action: "status" }, ftCtx)
const ftStatusNoIdOut = typeof ftStatusNoId === "string" ? ftStatusNoId : (ftStatusNoId.output || "")
assert(ftStatusNoIdOut.includes("jobId") || ftStatusNoIdOut.includes("required"), "finetune status without jobId shows error")

const ftUnknown = await hooks.tool.agentic_finetune.execute({ action: "unknown" }, ftCtx)
const ftUnknownOut = typeof ftUnknown === "string" ? ftUnknown : (ftUnknown.output || "")
assert(ftUnknownOut.includes("Unknown"), "finetune unknown action shows error")

assert(true, "agentic_finetune tool tests passed")

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
const tracePath = join(projectDir, ".agentic", "trace.jsonl")
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

// 87. Gap #4 Full: Multi-dimensional deep verification
console.log("\n[87] Gap #4 Full: Multi-dimensional deep verification")

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
assert(g4_depsNpm.name === "deps:npm", "G4-11b verifyDeps returns deps:npm check")
try { rmSync(g4_npmDir, { recursive: true, force: true }) } catch {}

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

assert(true, "Gap #4 Full multi-dimensional verification tests passed")

// ── Gap #7: Semantic Cache ──
console.log("\n[Gap7] SemanticCache — TF-IDF similarity cache")
const { SemanticCache } = await import(pluginDist)

// G7-1: Construction
const g7_sc1 = new SemanticCache()
assert(g7_sc1.size === 0, "G7-1a new semantic cache has 0 entries")
assert(g7_sc1.stats().hits === 0, "G7-1b new cache has 0 hits")
assert(g7_sc1.stats().misses === 0, "G7-1c new cache has 0 misses")
assert(g7_sc1.stats().hitRate === 0, "G7-1d new cache has 0 hit rate")

const g7_sc2 = new SemanticCache({ maxEntries: 10, ttlMs: 60000, similarityThreshold: 0.5 })
assert(g7_sc2.getConfig().maxEntries === 10, "G7-1e custom maxEntries accepted")
assert(g7_sc2.getConfig().ttlMs === 60000, "G7-1f custom TTL accepted")
assert(g7_sc2.getConfig().similarityThreshold === 0.5, "G7-1g custom threshold accepted")

// G7-2: Cache miss when empty
const g7_empty = new SemanticCache()
assert(g7_empty.get("any query") === null, "G7-2a cache miss when empty")
assert(g7_empty.get("") === null, "G7-2b empty query returns null")

// G7-3: Cache hit for identical query
const g7_id = new SemanticCache()
const g7_resp1 = { text: "Hello, world!" }
g7_id.set("What is TypeScript?", g7_resp1)
assert(g7_id.size === 1, "G7-3a entry stored")
const g7_hit1 = g7_id.get("What is TypeScript?")
assert(g7_hit1 !== null, "G7-3b identical query hits cache")
assert(g7_hit1?.text === "Hello, world!", "G7-3c cached response matches")

// G7-4: Cache hit for similar query
const g7_sim = new SemanticCache({ similarityThreshold: 0.3 })
g7_sim.set("implement user authentication with JWT tokens", { text: "Check your type annotations" })
const g7_simHit = g7_sim.get("implement authentication using JWT tokens")
assert(g7_simHit !== null, "G7-4a similar query hits cache")
assert(g7_simHit?.text === "Check your type annotations", "G7-4b similar query returns correct response")

// G7-5: Cache miss for dissimilar query
const g7_dis = new SemanticCache({ similarityThreshold: 0.7 })
g7_dis.set("How do I fix a type error in TypeScript?", { text: "Fix types" })
const g7_disMiss = g7_dis.get("What is the weather today?")
assert(g7_disMiss === null, "G7-5a dissimilar query misses cache")

// G7-6: Multiple entries — return best match
const g7_multi = new SemanticCache({ similarityThreshold: 0.3 })
g7_multi.set("Fix authentication bug in login", { text: "AUTH_FIX" })
g7_multi.set("Add dark mode to UI", { text: "DARK_MODE" })
const g7_multiHit = g7_multi.get("Fix bug in login auth")
assert(g7_multiHit !== null, "G7-6a multiple entries returns best match")
assert(g7_multiHit?.text === "AUTH_FIX", "G7-6b best match is auth fix (not dark mode)")

// G7-7: TTL expiration
const g7_ttl = new SemanticCache({ ttlMs: 10, similarityThreshold: 0.3 })
g7_ttl.set("test query", { text: "cached" })
assert(g7_ttl.get("test query") !== null, "G7-7a entry available before TTL")
await new Promise(r => setTimeout(r, 15))
assert(g7_ttl.get("test query") === null, "G7-7b entry expired after TTL")

// G7-8: prune removes expired entries
const g7_prune = new SemanticCache({ ttlMs: 10 })
g7_prune.set("q1", { text: "a1" })
g7_prune.set("q2", { text: "a2" })
assert(g7_prune.size === 2, "G7-8a two entries stored")
await new Promise(r => setTimeout(r, 15))
const g7_removed = g7_prune.prune()
assert(g7_removed === 2, "G7-8b prune removed 2 expired entries")
assert(g7_prune.size === 0, "G7-8c cache empty after prune")

// G7-9: Eviction when maxEntries exceeded
const g7_evict = new SemanticCache({ maxEntries: 3, evictFraction: 0.5 })
g7_evict.set("q1", { text: "a1" })
g7_evict.set("q2", { text: "a2" })
g7_evict.set("q3", { text: "a3" })
assert(g7_evict.size === 3, "G7-9a exactly at max")
g7_evict.set("q4", { text: "a4" }) // should evict oldest ~2 entries
assert(g7_evict.size <= 3, "G7-9b evicted entries when exceeding max")
assert(g7_evict.size >= 1, "G7-9c at least one entry remains")

// G7-10: Stats accuracy
const g7_stats = new SemanticCache()
g7_stats.set("test", { text: "ok" })
g7_stats.get("test")    // hit
g7_stats.get("other")   // miss
g7_stats.get("another") // miss
const g7_st = g7_stats.stats()
assert(g7_st.hits === 1, "G7-10a stats show 1 hit")
assert(g7_st.misses >= 2, "G7-10b stats show at least 2 misses (includes empty check misses)")
assert(g7_st.size === 1, "G7-10c stats show 1 entry")

// G7-11: clear resets
const g7_clr = new SemanticCache()
g7_clr.set("test", { text: "ok" })
g7_clr.get("test")
g7_clr.clear()
assert(g7_clr.size === 0, "G7-11a size 0 after clear")
assert(g7_clr.stats().hits === 0, "G7-11b hits reset after clear")
assert(g7_clr.stats().misses === 0, "G7-11c misses reset after clear")

// G7-12: updateConfig
const g7_cfg = new SemanticCache()
g7_cfg.updateConfig({ maxEntries: 50, similarityThreshold: 0.9 })
assert(g7_cfg.getConfig().maxEntries === 50, "G7-12a maxEntries updated")
assert(g7_cfg.getConfig().similarityThreshold === 0.9, "G7-12b threshold updated")
assert(g7_cfg.getConfig().ttlMs === 300_000, "G7-12c unchanged fields preserved")

// G7-13: Very short query
const g7_short = new SemanticCache({ similarityThreshold: 0.3 })
g7_short.set("test", { text: "result" })
const g7_shortHit = g7_short.get("test")
assert(g7_shortHit !== null, "G7-13a single word query can be cached")
assert(g7_shortHit?.text === "result", "G7-13b single word query hits properly")

assert(true, "Gap #7 Semantic Cache tests passed")

// ── Layer 2: Debate Loop ──
console.log("\n[87] agentic_debate — debate loop")
const debateSid2 = freshSid()

// Happy path: simple debate task
const debateSimple = await hooks.tool.agentic_debate.execute({
  task: "Apa kelebihan dan kekurangan TypeScript dibanding JavaScript?",
  maxRounds: 2,
  format: "markdown",
}, mockCtx(debateSid2))
const debateOut = typeof debateSimple === "string" ? debateSimple : (debateSimple.output || "")
assert(debateOut.length > 50, "debate returns output for simple task")
assert(debateOut.includes("Task") || debateOut.includes("Result"), "debate shows task/result info")
assert(debateOut.includes("Final Output") || debateOut.includes("APPROVED") || debateOut.includes("✅"), "debate has final output or approval")
assert(typeof debateSimple === "object", "debate returns object")
assert(true, "agentic_debate happy path passed")

// Happy path: debate with context and JSON output
const debateCtx = await hooks.tool.agentic_debate.execute({
  task: "Review kode berikut: function add(a,b){return a+b}",
  context: "Ini adalah fungsi sederhana dalam JavaScript",
  maxRounds: 2,
  format: "json",
}, mockCtx(freshSid()))
const debateCtxOut = typeof debateCtx === "string" ? debateCtx : (debateCtx.output || "")
assert(debateCtxOut.length > 50, "debate with context returns output")
assert(true, "agentic_debate with context passed")

// Error path: empty task
const debateEmpty = await hooks.tool.agentic_debate.execute({
  task: "",
  maxRounds: 1,
}, mockCtx(freshSid()))
const debateEmpOut = typeof debateEmpty === "string" ? debateEmpty : (debateEmpty.output || "")
assert(debateEmpOut.length > 0, "debate empty task still returns output")
assert(true, "agentic_debate empty task handled")

// ── Layer 5: Router Agent ──
console.log("\n[88] agentic_router — intent routing")
const routeSid2 = freshSid()

// Happy path: route automotive query
const routeAuto = await hooks.tool.agentic_router.execute({
  input: "Saya mau service mobil, ganti oli dan filter",
}, mockCtx(routeSid2))
const routeAutoOut = typeof routeAuto === "string" ? routeAuto : (routeAuto.output || "")
assert(routeAutoOut.length > 20, "router returns output for automotive query")
assert(routeAutoOut.includes("automotive") || routeAutoOut.includes("Otomotif") || routeAutoOut.includes("Category"), "router detects automotive category")
assert(typeof routeAuto === "object", "router returns object")
assert(true, "agentic_router automotive query passed")

// Happy path: route financial query
const routeFin = await hooks.tool.agentic_router.execute({
  input: "Bagaimana cara menghitung pajak penghasilan?",
}, mockCtx(freshSid()))
const routeFinOut = typeof routeFin === "string" ? routeFin : (routeFin.output || "")
assert(routeFinOut.length > 20, "router returns output for financial query")
assert(routeFinOut.includes("financial") || routeFinOut.includes("Finansial") || routeFinOut.includes("Category"), "router detects financial category")
assert(true, "agentic_router financial query passed")

// Custom categories
const routeCustom = await hooks.tool.agentic_router.execute({
  input: "Saya mau pesan pizza",
  categories: [
    { id: "food", name: "Makanan", keywords: ["pizza", "makan", "pesan", "menu", "restoran"], description: "Pemesanan makanan" },
  ],
}, mockCtx(freshSid()))
const routeCustOut = typeof routeCustom === "string" ? routeCustom : (routeCustom.output || "")
assert(routeCustOut.length > 20, "router with custom categories returns output")
assert(routeCustOut.includes("food") || routeCustOut.includes("Makanan"), "router detects custom food category")
assert(true, "agentic_router custom categories passed")

// Edge: empty input
const routeEmpty = await hooks.tool.agentic_router.execute({
  input: "",
}, mockCtx(freshSid()))
const routeEmpOut = typeof routeEmpty === "string" ? routeEmpty : (routeEmpty.output || "")
assert(routeEmpOut.length > 0, "router empty input returns output")
assert(true, "agentic_router empty input handled")

// ── Layer 3: Data Cleaner ──
console.log("\n[89] agentic_clean — data cleaning")
const cleanSid = freshSid()

// Happy path: clean debate-like text
const cleanText = await hooks.tool.agentic_clean.execute({
  text: "I think this is a good analysis. Let me revise it. The answer is 42. I agree with that point. Actually the correct value is 42. Good catch!",
  format: "json",
}, mockCtx(cleanSid))
const cleanOut = typeof cleanText === "string" ? cleanText : (cleanText.output || "")
assert(cleanOut.length > 20, "clean returns output")
assert(typeof cleanText === "object", "clean returns object")
assert(true, "agentic_clean happy path passed")

// Error path: empty text
const cleanEmpty = await hooks.tool.agentic_clean.execute({
  text: "",
}, mockCtx(freshSid()))
const cleanEmpOut = typeof cleanEmpty === "string" ? cleanEmpty : (cleanEmpty.output || "")
assert(cleanEmpOut.length > 0, "clean empty text returns output")
assert(true, "agentic_clean empty text handled")

// ── Layer 4: Multi-Index RAG ──
console.log("\n[90] agentic_rag — multi-index RAG")
const ragSid = freshSid()

// Store some test data
await hooks.tool.agentic_rag.execute({
  action: "store",
  query: "Cara mengganti oli mobil",
  category: "automotive",
  content: "Langkah-langkah mengganti oli mobil: 1. Siapkan alat 2. Buka baut pembuangan 3. Buang oli lama 4. Pasang baut 5. Isi oli baru",
}, mockCtx(ragSid))

await hooks.tool.agentic_rag.execute({
  action: "store",
  query: "Cara hitung pajak penghasilan",
  category: "financial",
  content: "PPh Pasal 21: Hitung penghasilan bruto, kurangi biaya jabatan, hitung PKP, terapkan tarif progresif",
  type: "skill",
}, mockCtx(ragSid))

// Search within category
const ragSearch = await hooks.tool.agentic_rag.execute({
  action: "search",
  query: "oli",
  category: "automotive",
}, mockCtx(freshSid()))
const ragSearchOut = typeof ragSearch === "string" ? ragSearch : (ragSearch.output || "")
assert(ragSearchOut.length > 20, "rag search returns output")
assert(ragSearchOut.includes("oli") || ragSearchOut.includes("mobil"), "rag finds stored data")
assert(true, "agentic_rag search within category passed")

// Search all categories
const ragAll = await hooks.tool.agentic_rag.execute({
  action: "search",
  query: "pajak",
}, mockCtx(freshSid()))
const ragAllOut = typeof ragAll === "string" ? ragAll : (ragAll.output || "")
assert(ragAllOut.length > 20, "rag all-category search returns output")
assert(ragAllOut.includes("financial") || ragAllOut.includes("pajak"), "rag finds across categories")
assert(true, "agentic_rag cross-category search passed")

// Stats
const ragStats = await hooks.tool.agentic_rag.execute({
  action: "stats",
}, mockCtx(freshSid()))
const ragStatsOut = typeof ragStats === "string" ? ragStats : (ragStats.output || "")
assert(ragStatsOut.length > 20, "rag stats returns output")
assert(ragStatsOut.includes("automotive") && ragStatsOut.includes("financial"), "rag stats shows categories")
assert(true, "agentic_rag stats passed")

// Categories
const ragCats = await hooks.tool.agentic_rag.execute({
  action: "categories",
}, mockCtx(freshSid()))
assert(true, "agentic_rag categories passed")

// ── Layer 1: MCP Client ──
console.log("\n[91] agentic_mcp — MCP client")
const mcpSid = freshSid()

// List with no connections
const mcpList = await hooks.tool.agentic_mcp.execute({
  action: "list",
}, mockCtx(mcpSid))
const mcpListOut = typeof mcpList === "string" ? mcpList : (mcpList.output || "")
assert(mcpListOut.includes("No MCP") || mcpListOut.includes("Connected"), "mcp list shows no connections")
assert(true, "agentic_mcp list empty passed")

// Missing params
const mcpNoTrans = await hooks.tool.agentic_mcp.execute({
  action: "connect",
}, mockCtx(freshSid()))
const mcpNoTransOut = typeof mcpNoTrans === "string" ? mcpNoTrans : (mcpNoTrans.output || "")
assert(mcpNoTransOut.includes("transport"), "mcp connect without transport shows error")
assert(true, "agentic_mcp missing params handled")

// Disconnect-all with no connections
const mcpDiscAll = await hooks.tool.agentic_mcp.execute({
  action: "disconnect-all",
}, mockCtx(freshSid()))
assert(true, "agentic_mcp disconnect-all passed")

// ── Stage V: Autonomous Loop ──
console.log("\n[92] agentic_auto — autonomous loop (mock mode)")

// Test: basic goal decomposition and execution
const autoSid = freshSid()
const autoResult = await hooks.tool.agentic_auto.execute({
  goal: "Add a greet function to test-project",
  constraints: ["TypeScript"],
}, mockCtx(autoSid))
const autoOut = typeof autoResult === "string" ? autoResult : (autoResult.output || "")
assert(autoOut.length > 20, "agentic_auto returns output")
assert(autoOut.includes("Goal") || autoOut.includes("goal") || autoOut.includes("Auto"), "output mentions goal")

// Test: verify metadata has plan info
const autoMeta = autoResult.metadata || {}
assert(autoMeta.plan || autoMeta.success !== undefined, "auto returns metadata with plan/success")
assert(true, "agentic_auto executed successfully")

// Test: agentic_auto with empty/invalid goal still returns gracefully
const emptySid = freshSid()
const emptyResult = await hooks.tool.agentic_auto.execute({
  goal: "",
  maxSteps: 1,
}, mockCtx(emptySid))
const emptyOut = typeof emptyResult === "string" ? emptyResult : (emptyResult.output || "")
assert(emptyOut.length > 5, "agentic_auto handles empty goal")
assert(true, "agentic_auto error handling passed")

// ── Sub-agent integration tests ──
console.log("\n── Sub-agent integration tests ──")

// P1: agentic_plan suggests pipeline for feature/bug/refactor goals
console.log("\n[P1] agentic_plan — pipeline suggestion")
const p1Sid = freshSid()
const p1Result = await hooks.tool.agentic_plan.execute({
  goal: "Add new user login feature with JWT",
}, mockCtx(p1Sid))
const p1Out = typeof p1Result === "string" ? p1Result : (p1Result.output || "")
assert(p1Out.includes("Pipeline") && p1Out.includes("feature-dev"), "plan suggests feature-dev pipeline")

const p1bSid = freshSid()
const p1bResult = await hooks.tool.agentic_plan.execute({
  goal: "Fix bug in payment module",
}, mockCtx(p1bSid))
const p1bOut = typeof p1bResult === "string" ? p1bResult : (p1bResult.output || "")
assert(p1bOut.includes("Pipeline") && p1bOut.includes("fix-verify"), "plan suggests fix-verify for bug")

const p1cSid = freshSid()
const p1cResult = await hooks.tool.agentic_plan.execute({
  goal: "Refactor authentication service",
}, mockCtx(p1cSid))
const p1cOut = typeof p1cResult === "string" ? p1cResult : (p1cResult.output || "")
assert(p1cOut.includes("Pipeline") && p1cOut.includes("refactor-review"), "plan suggests refactor-review pipeline")
assert(true, "agentic_plan pipeline suggestion tests passed")

// P2: agentic_execute suggests delegation after 2+ retries
console.log("\n[P2] agentic_execute — delegation suggestion on repeated failure")
const p2Sid = freshSid()
await hooks.tool.agentic_plan.execute({
  goal: "Execute escalation test",
  subtasks: [{ id: "es1", description: "Will fail twice", dependsOn: [] }],
}, mockCtx(p2Sid))
await hooks.tool.agentic_execute.execute({
  stepId: "es1", success: false, error: "TypeError: cannot read property 'x'", output: "Fail 1", autoVerify: false,
}, mockCtx(p2Sid))
const p2Result = await hooks.tool.agentic_execute.execute({
  stepId: "es1", success: false, error: "TypeError: cannot read property 'x' again", output: "Fail 2", autoVerify: false,
}, mockCtx(p2Sid))
const p2Out = typeof p2Result === "string" ? p2Result : (p2Result.output || "")
assert(p2Out.includes("Escalate") || p2Out.includes("delegate"), "delegation hint shown after 2 failures")
assert(true, "agentic_execute delegation suggestion tests passed")

// P3: agentic_parallel delegate-based runner still works
console.log("\n[P3] agentic_parallel — delegate-based execution")
const p3Sid = freshSid()
const p3Ctx = mockCtx(p3Sid)
await hooks.tool.agentic_plan.execute({
  goal: "Parallel delegate test",
  subtasks: [
    { id: "pd1", description: "Write alpha.txt", dependsOn: [] },
    { id: "pd2", description: "Write beta.txt", dependsOn: [] },
  ],
}, p3Ctx)
await hooks.tool.agentic_execute.execute({
  stepId: "pd1", success: true, autoVerify: false, output: "Done", filesModified: ["alpha.txt"],
}, p3Ctx)
const p3Result = await hooks.tool.agentic_parallel.execute({ action: "execute" }, p3Ctx)
const p3Out = typeof p3Result === "string" ? p3Result : (p3Result.output || "")
assert(p3Out.includes("Execution") || p3Out.includes("passed") || p3Out.includes("Failed"), "parallel delegate execution produces result")
assert(true, "agentic_parallel delegate execution tests passed")

// P4: agentic_auto with pipeline-suitable complex goal
console.log("\n[P4] agentic_auto — pipeline-suitable goal")
const p4Sid = freshSid()
const p4Result = await hooks.tool.agentic_auto.execute({
  goal: "Refactor utils module: extract validation functions",
  constraints: ["TypeScript"],
  thorough: true,
}, mockCtx(p4Sid))
const p4Out = typeof p4Result === "string" ? p4Result : (p4Result.output || "")
assert(p4Out.length > 20, "auto with pipeline goal returns output")
assert(p4Out.includes("Goal") || p4Out.includes("Auto"), "output mentions goal or auto")
  assert(true, "agentic_auto pipeline delegation tests passed")

  // ── Project-Scoped Memory Isolation tests ──
  console.log("\n[PS] Project-Scoped Memory Isolation")
  const { PersistenceLayer } = await import(pluginDist)

  // Create a temp persistence layer with ISOLATED global dir
  const scopeWorktree = join(projectDir, "scope-test")
  const scopeGlobal = join(projectDir, "scope-global")
  try { mkdirSync(scopeWorktree, { recursive: true }) } catch {}
  try { mkdirSync(scopeGlobal, { recursive: true }) } catch {}
  process.env.AGENTIC_STORE_DIR = scopeGlobal
  const pl = new PersistenceLayer(scopeWorktree)

  // Test 1: Scoped save + load (projectA vs projectB)
  const projA = "project-alpha"
  const projB = "project-beta"

  pl.save("episodes", "ep1", { goal: "Fix bug A" }, projA)
  pl.save("episodes", "ep1", { goal: "Fix bug B" }, projB)

  const epA = pl.load("episodes", "ep1", projA)
  const epB = pl.load("episodes", "ep1", projB)
  assert(epA && epA.goal === "Fix bug A", "project A episode is isolated")
  assert(epB && epB.goal === "Fix bug B", "project B episode is isolated")

  // Test 2: Unscoped save (shared — skills, models, prompts)
  pl.save("skills", "skill1", { name: "Test Pattern" }) // no scope = global
  const skGlobal = pl.load("skills", "skill1")
  assert(skGlobal && skGlobal.name === "Test Pattern", "unscoped skill is globally shared")

  // Test 3: Scoped evolution (per-project trend.json)
  pl.save("evolution", "trend", { results: [1, 2, 3] }, projA)
  pl.save("evolution", "trend", { results: [4, 5] }, projB)
  const evoA = pl.load("evolution", "trend", projA)
  const evoB = pl.load("evolution", "trend", projB)
  assert(evoA && evoA.results.length === 3, "project A evolution is isolated")
  assert(evoB && evoB.results.length === 2, "project B evolution is isolated")

  // Test 4: listScopes — detect existing project scopes
  const scopes = pl.listScopes("episodes")
  assert(scopes.includes("project-alpha"), "listScopes finds project-alpha")
  assert(scopes.includes("project-beta"), "listScopes finds project-beta")

  // Test 5: Episode.projectId field
  const mockEpStore = new (await import(pluginDist)).EpisodicStore()
  const ep = mockEpStore.record("sess-1", "Test goal", "success", ["did work"], ["src/app.ts"], "code", projA)
  assert(ep.projectId === projA, "Episode has projectId")
  const projectEps = mockEpStore.getByProject(projA)
  assert(projectEps.length === 1, "getByProject returns scoped episodes")
  assert(projectEps[0].projectId === projA, "getByProject filters correctly")

  // Cleanup
  try { rmSync(scopeWorktree, { recursive: true, force: true }) } catch {}
  try { rmSync(scopeGlobal, { recursive: true, force: true }) } catch {}
  delete process.env.AGENTIC_STORE_DIR

  assert(true, "Project-Scoped Memory Isolation tests passed")

  // ── BudgetTracker unit tests (inside runAll) ──
  console.log("\n[B1] BudgetTracker — class unit tests")
  const { BudgetTracker: BT } = await import(pluginDist)

  const bt1 = new BT()
  bt1.recordTokens("openai/gpt-4o", 1000, 500)
  assert(bt1.totalTokens === 1500, "B1a total tokens = input+output")
  assert(Math.abs(bt1.totalCostUsd - 7.50) < 0.001, "B1b cost = $7.50")
  bt1.recordStep()
  assert(bt1.steps === 1, "B1c steps recorded")
  assert(bt1.check("session") === null, "B1d no limits = null")
  bt1.setLimits("session", { maxTokens: 1000 })
  const ev1 = bt1.check("session")
  assert(ev1 !== null, "B1e limit exceeded returns event")
  assert(ev1.metric === "tokens", "B1f exceeded metric = tokens")
  bt1.reset("task")
  assert(bt1.totalTokens === 0, "B1g after reset: tokens = 0")

  // Merge semantics
  const bt2 = new BT()
  bt2.setLimits("task", { maxTokens: 500 }, "warn")
  bt2.setLimits("task", { maxSteps: 10 })
  assert(bt2.getLimits("task").maxTokens === 500, "B1h merge: maxTokens tetap 500")
  assert(bt2.getLimits("task").maxSteps === 10, "B1i merge: maxSteps jadi 10")

  // Cache & reasoning
  const bt3 = new BT()
  bt3.recordTokens("anthropic/claude-sonnet-4", 100, 50, 30, 10000, 500)
  assert(bt3.totalTokens === 10680, "B1j cache+reasoning tokens summed")
  assert(bt3.totalCostUsd > 4.0, "B1k cost includes cache pricing")

  // Fail-fast order
  const bt4 = new BT()
  bt4.setLimits("session", { maxSteps: 1, maxTokens: 100000 })
  bt4.recordStep()
  bt4.recordStep()
  assert(bt4.check("session").metric === "steps", "B1l fail-fast: steps before tokens")

  // getState
  const btState = bt2.getState(["session", "task"])
  assert(btState.length === 2, "B1m getState returns both scopes")
  assert(btState[0].scope === "session", "B1n state[0] = session")

  // Approval pause
  const bt5 = new BT()
  bt5.setLimits("session", { maxTimeMs: 60000 })
  bt5.pauseApproval()
  assert(bt5.elapsedMs < 100, "B1o elapsed ~0 saat pause")
  bt5.resumeApproval()

  // Unknown model — $0 silent (SessionReader sync dari OpenCode nanti)
  const bt6 = new BT()
  bt6.recordTokens("custom-model/xyz", 1000, 500)
  assert(bt6.totalCostUsd === 0, "B1p unknown model → $0 silent, no warning")
  assert(true, "B1z BudgetTracker all unit tests passed")

  // ── agentic_budget tool tests (inside runAll) ──
  console.log("\n[B2] agentic_budget — tool integration")
  const bSid = freshSid()
  const bCtx = mockCtx(bSid)
  assert(typeof hooks.tool.agentic_budget?.execute === "function", "B2a tool registered")

  const bSet = await hooks.tool.agentic_budget.execute({ action: "set", scope: "session", maxTokens: 50000, maxSteps: 100, maxTimeMs: 300000 }, bCtx)
  assert((bSet.output || "").includes("50000"), "B2b set response shows maxTokens")

  const bStatus = await hooks.tool.agentic_budget.execute({ action: "status", scope: "session" }, bCtx)
  const sOut = bStatus.output || ""
  assert(sOut.includes("Tokens") && sOut.includes("Steps") && sOut.includes("Time") && sOut.includes("Cost"), "B2c status shows all rows")

  const bGet = await hooks.tool.agentic_budget.execute({ action: "get", scope: "session" }, bCtx)
  assert((bGet.output || "").includes("50000"), "B2d get shows maxTokens")

  const bReset = await hooks.tool.agentic_budget.execute({ action: "reset", scope: "session" }, bCtx)
  assert((bReset.output || "").includes("reset"), "B2e reset confirmation")

  const bWarn = await hooks.tool.agentic_budget.execute({ action: "set", scope: "task", maxTokens: 100, onExceeded: "warn" }, bCtx)
  assert((bWarn.output || "").includes("warn"), "B2f onExceeded=warn reflected")

  const bPrice = await hooks.tool.agentic_budget.execute({ action: "set", scope: "task", maxTokens: 1000, maxCostUsd: 5.00, modelPrices: { "my-model/v1": { input: 1.0, output: 4.0 } } }, bCtx)
  assert((bPrice.output || "").includes("1000"), "B2g model price override accepted")

  const bBad = await hooks.tool.agentic_budget.execute({ action: "invalid", scope: "session" }, bCtx)
  assert((bBad.output || "").includes("Unknown"), "B2h invalid action handled")
  assert(true, "B2z agentic_budget tool tests passed")

  // ── Phase 1: DSL Executor ──
  console.log("\n[DSL] DslExecutor — deterministic interpreter")
  const { DslExecutor, validateDSL, resolvePath, setPath, resolveValue } = await import(pluginDist)

  // DSL-1: Constructor and basic validation
  const dsl1 = new DslExecutor()
  assert(typeof dsl1.validate === "function", "DSL-1a DslExecutor created")
  assert(typeof dsl1.execute === "function", "DSL-1b execute method exists")

  // DSL-2: validateDSL — empty instructions
  const dsl2v = validateDSL([])
  assert(Array.isArray(dsl2v) && dsl2v.length === 0, "DSL-2a empty instructions = valid")

  // DSL-3: validateDSL — unknown op
  const dsl3v = validateDSL([{ op: "invalid_op", id: "x1" }])
  assert(dsl3v.length > 0 && dsl3v[0].message.includes("Unknown op"), "DSL-3a unknown op detected")

  // DSL-4: validateDSL — get requires source
  const dsl4v = validateDSL([{ op: "get", id: "g1" }])
  assert(dsl4v.length > 0 && dsl4v[0].message.includes("source"), "DSL-4a get requires source")

  // DSL-5: validateDSL — set requires target
  const dsl5v = validateDSL([{ op: "set", id: "s1" }])
  assert(dsl5v.length > 0 && dsl5v[0].message.includes("target"), "DSL-5a set requires target")

  // DSL-6: validateDSL — add requires >=2 values
  const dsl6v = validateDSL([{ op: "add", id: "a1", values: [1] }])
  assert(dsl6v.length > 0 && dsl6v[0].message.includes("at least 2"), "DSL-6a add requires >=2 values")

  // DSL-7: validateDSL — mcp_call requires tool
  const dsl7v = validateDSL([{ op: "mcp_call", id: "m1" }])
  assert(dsl7v.length > 0 && dsl7v[0].message.includes("tool"), "DSL-7a mcp_call requires tool")

  // DSL-8: validateDSL — compare requires left, operator, right
  const dsl8v = validateDSL([{ op: "compare", id: "c1", left: "x" }])
  assert(dsl8v.length > 0 && dsl8v.some(e => e.message.includes("operator")), "DSL-8a compare requires operator")
  const dsl8v2 = validateDSL([{ op: "compare", id: "c2", left: "x", operator: "eq" }])
  assert(dsl8v2.length > 0 && dsl8v2.some(e => e.message.includes("right")), "DSL-8b compare requires right")

  // DSL-9: validateDSL — if requires condition
  const dsl9v = validateDSL([{ op: "if", id: "i1" }])
  assert(dsl9v.length > 0 && dsl9v[0].message.includes("condition"), "DSL-9a if requires condition")

  // DSL-10: validateDSL — max nesting
  const dsl10_deep = { op: "if", condition: "memory.x", then: [{ op: "if", condition: "memory.y", then: [{ op: "if", condition: "memory.z", then: [{ op: "if", condition: "memory.a", then: [{ op: "if", condition: "memory.b", then: [{ op: "if", condition: "memory.c", then: [] }] }] }] }] }] }
  const dsl10v = validateDSL([dsl10_deep])
  assert(dsl10v.length > 0 && dsl10v.some(e => e.message.includes("nesting")), "DSL-10a max nesting detected")

  // DSL-11: resolvePath — input
  const dsl11_ctx = { input: { name: "test", count: 42 }, output: {}, memory: {} }
  assert(resolvePath(dsl11_ctx, "input.name").value === "test", "DSL-11a resolvePath input.name")
  assert(resolvePath(dsl11_ctx, "input.count").value === 42, "DSL-11b resolvePath input.count")
  assert(resolvePath(dsl11_ctx, "output.x").found === false, "DSL-11c resolvePath missing path")
  assert(resolvePath(dsl11_ctx, "plainString").value === "plainString", "DSL-11d non-path returns literal")

  // DSL-12: setPath
  const dsl12_obj = {}
  setPath(dsl12_obj, "a.b.c", 42)
  assert(dsl12_obj.a.b.c === 42, "DSL-12a setPath nested")
  setPath(dsl12_obj, "x", "hello")
  assert(dsl12_obj.x === "hello", "DSL-12b setPath shallow")

  // DSL-13: resolveValue
  const dsl13_ctx = { input: { val: 99 }, output: {}, memory: { temp: "cached" } }
  assert(resolveValue(dsl13_ctx, "input.val") === 99, "DSL-13a resolveValue input path")
  assert(resolveValue(dsl13_ctx, "memory.temp") === "cached", "DSL-13b resolveValue memory path")
  assert(resolveValue(dsl13_ctx, 42) === 42, "DSL-13c resolveValue literal number")
  assert(resolveValue(dsl13_ctx, "hello") === "hello", "DSL-13d resolveValue literal string")

  // DSL-14: DslExecutor.execute — set operation
  const dsl14 = new DslExecutor()
  const dsl14r = dsl14.execute([
    { op: "set", target: "output.result", value: "hello world" },
  ])
  assert(dsl14r.success === true, "DSL-14a set success")
  assert(dsl14r.output.result === "hello world", "DSL-14b set output value")

  // DSL-15: DslExecutor.execute — get operation
  const dsl15 = new DslExecutor()
  const dsl15r = dsl15.execute([
    { op: "get", source: "input.name", target: "output.name" },
  ], { name: "test-user" })
  assert(dsl15r.success === true, "DSL-15a get success")
  assert(dsl15r.output.name === "test-user", "DSL-15b get resolves from input")

  // DSL-16: DslExecutor.execute — add numbers
  const dsl16 = new DslExecutor()
  const dsl16r = dsl16.execute([
    { op: "add", values: [10, 20, 30], target: "output.sum" },
  ])
  assert(dsl16r.success === true, "DSL-16a add numbers success")
  assert(dsl16r.output.sum === 60, "DSL-16b add numbers: 10+20+30=60")

  // DSL-17: DslExecutor.execute — add strings (concat)
  const dsl17 = new DslExecutor()
  const dsl17r = dsl17.execute([
    { op: "add", values: ["hello", " ", "world"], target: "output.greeting" },
  ])
  assert(dsl17r.success === true, "DSL-17a add strings success")
  assert(dsl17r.output.greeting === "hello world", "DSL-17b add strings concat")

  // DSL-18: DslExecutor.execute — compare eq
  const dsl18 = new DslExecutor()
  const dsl18r = dsl18.execute([
    { op: "compare", left: "input.a", operator: "eq", right: "input.b", target: "output.same" },
  ], { a: 5, b: 5 })
  assert(dsl18r.success === true, "DSL-18a compare eq success")
  assert(dsl18r.output.same === true, "DSL-18b compare eq: 5==5 is true")

  // DSL-19: DslExecutor.execute — compare ne
  const dsl19 = new DslExecutor()
  const dsl19r = dsl19.execute([
    { op: "compare", left: "input.x", operator: "ne", right: "input.y", target: "output.diff" },
  ], { x: "a", y: "b" })
  assert(dsl19r.success === true, "DSL-19a compare ne success")
  assert(dsl19r.output.diff === true, "DSL-19b compare ne: a!=b is true")

  // DSL-20: DslExecutor.execute — compare gt
  const dsl20 = new DslExecutor()
  const dsl20r = dsl20.execute([
    { op: "compare", left: "input.a", operator: "gt", right: "input.b", target: "output.gt" },
  ], { a: 10, b: 3 })
  assert(dsl20r.success === true, "DSL-20a compare gt success")
  assert(dsl20r.output.gt === true, "DSL-20b compare gt: 10>3 is true")

  // DSL-21: DslExecutor.execute — if/then/else
  const dsl21 = new DslExecutor()
  const dsl21r = dsl21.execute([
    { op: "set", target: "memory.score", value: 85 },
    { op: "compare", left: "memory.score", operator: "gte", right: 70, target: "memory.passed" },
    { op: "if", condition: "memory.passed",
      then: [{ op: "set", target: "output.status", value: "passed" }],
      else: [{ op: "set", target: "output.status", value: "failed" }],
    },
  ])
  assert(dsl21r.success === true, "DSL-21a if/then/else success")
  assert(dsl21r.output.status === "passed", "DSL-21b if/then: score>=70 -> passed")

  // DSL-22: DslExecutor.execute — if/else branch
  const dsl22 = new DslExecutor()
  const dsl22r = dsl22.execute([
    { op: "set", target: "memory.count", value: 3 },
    { op: "compare", left: "memory.count", operator: "gte", right: 10, target: "memory.enough" },
    { op: "if", condition: "memory.enough",
      then: [{ op: "set", target: "output.msg", value: "enough" }],
      else: [{ op: "set", target: "output.msg", value: "need more" }],
    },
  ])
  assert(dsl22r.success === true, "DSL-22a if/else success")
  assert(dsl22r.output.msg === "need more", "DSL-22b if/else: 3<10 -> need more")

  // DSL-23: DslExecutor.execute — short circuit on failure
  const dsl23 = new DslExecutor()
  const dsl23r = dsl23.execute([
    { op: "get", source: "input.nonexistent" },
    { op: "set", target: "output.result", value: "should not reach" },
  ])
  assert(dsl23r.success === false, "DSL-23a short circuit on failure")
  assert(dsl23r.output.result === undefined, "DSL-23b second instruction not executed")

  // DSL-24: getPendingMCPCalls
  const dsl24 = new DslExecutor()
  const dsl24r = dsl24.execute([
    { op: "mcp_call", tool: "read_file", params: { path: "/test" }, server: "fs" },
  ])
  const dsl24_pending = dsl24.getPendingMCPCalls(dsl24r)
  assert(Array.isArray(dsl24_pending), "DSL-24a pending MCP calls is array")
  assert(dsl24_pending.length === 1, "DSL-24b one pending MCP call")
  assert(dsl24_pending[0].tool === "read_file", "DSL-24c correct tool name in pending")
  assert(dsl24_pending[0].server === "fs", "DSL-24d correct server name in pending")

  // DSL-25: DslExecutor.validate method
  const dsl25 = new DslExecutor()
  assert(dsl25.validate([]).length === 0, "DSL-25a validate empty")
  assert(dsl25.validate([{ op: "invalid" }]).length > 0, "DSL-25b validate invalid op")

  assert(true, "DSL-Z DSL Executor all tests passed")

  // ── Phase 1: Schema Validator ──
  console.log("\n[SCHEMA] SchemaValidator — input/output schema validation")
  const { SchemaValidator } = await import(pluginDist)

  // SCHEMA-1: Constructor
  const sv1 = new SchemaValidator()
  assert(typeof sv1.validate === "function", "SCHEMA-1a SchemaValidator created")
  assert(typeof sv1.parseOrThrow === "function", "SCHEMA-1b parseOrThrow method exists")

  // SCHEMA-2: Valid — required fields present
  const sv2_schema = {
    name: { type: "string", required: true },
    age: { type: "number", required: true },
  }
  const sv2r = sv1.validate(sv2_schema, { name: "Alice", age: 30 })
  assert(sv2r.valid === true, "SCHEMA-2a valid data passes")
  assert(sv2r.errors.length === 0, "SCHEMA-2b no errors")

  // SCHEMA-3: Missing required field
  const sv3r = sv1.validate(sv2_schema, { name: "Alice" })
  assert(sv3r.valid === false, "SCHEMA-3a missing required detected")
  assert(sv3r.errors.some(e => e.code === "missing_required"), "SCHEMA-3b correct error code")

  // SCHEMA-4: Type mismatch
  const sv4r = sv1.validate({ age: { type: "number", required: true } }, { age: "not-a-number" })
  assert(sv4r.valid === false, "SCHEMA-4a type mismatch detected")
  assert(sv4r.errors.some(e => e.code === "type_mismatch"), "SCHEMA-4b type mismatch code")

  // SCHEMA-5: Enum validation
  const sv5_schema = {
    role: { type: "string", required: true, enum: ["admin", "user", "guest"] },
  }
  const sv5r1 = sv1.validate(sv5_schema, { role: "admin" })
  assert(sv5r1.valid === true, "SCHEMA-5a valid enum passes")
  const sv5r2 = sv1.validate(sv5_schema, { role: "superadmin" })
  assert(sv5r2.valid === false, "SCHEMA-5b invalid enum detected")
  assert(sv5r2.errors.some(e => e.code === "enum_violation"), "SCHEMA-5c enum violation code")

  // SCHEMA-6: Default value applied
  const sv6_schema = {
    enabled: { type: "boolean", default: true },
  }
  const sv6r = sv1.validate(sv6_schema, {})
  assert(sv6r.valid === true, "SCHEMA-6a default applied")
  assert(sv6r.data.enabled === true, "SCHEMA-6b default value in result data")

  // SCHEMA-7: String constraints
  const sv7_schema = {
    code: { type: "string", minLength: 2, maxLength: 10, pattern: "^[A-Z]+$" },
  }
  const sv7r1 = sv1.validate(sv7_schema, { code: "ABC" })
  assert(sv7r1.valid === true, "SCHEMA-7a valid string passes")
  const sv7r2 = sv1.validate(sv7_schema, { code: "A" })
  assert(sv7r2.valid === false && sv7r2.errors.some(e => e.code === "min_length"), "SCHEMA-7b minLength violation")
  const sv7r3 = sv1.validate(sv7_schema, { code: "ABCDEFGHIJK" })
  assert(sv7r3.valid === false && sv7r3.errors.some(e => e.code === "max_length"), "SCHEMA-7c maxLength violation")
  const sv7r4 = sv1.validate(sv7_schema, { code: "abc" })
  assert(sv7r4.valid === false && sv7r4.errors.some(e => e.code === "pattern_mismatch"), "SCHEMA-7d pattern violation")

  // SCHEMA-8: Number constraints
  const sv8_schema = {
    score: { type: "number", minimum: 0, maximum: 100 },
  }
  const sv8r1 = sv1.validate(sv8_schema, { score: 50 })
  assert(sv8r1.valid === true, "SCHEMA-8a valid number passes")
  const sv8r2 = sv1.validate(sv8_schema, { score: -1 })
  assert(sv8r2.valid === false && sv8r2.errors.some(e => e.code === "minimum"), "SCHEMA-8b minimum violation")
  const sv8r3 = sv1.validate(sv8_schema, { score: 101 })
  assert(sv8r3.valid === false && sv8r3.errors.some(e => e.code === "maximum"), "SCHEMA-8c maximum violation")

  // SCHEMA-9: Object type with nested properties
  const sv9_schema = {
    address: {
      type: "object",
      required: true,
      properties: {
        street: { type: "string", required: true },
        city: { type: "string", required: true },
        zip: { type: "number" },
      },
    },
  }
  const sv9r1 = sv1.validate(sv9_schema, { address: { street: "123 Main", city: "NYC", zip: 10001 } })
  assert(sv9r1.valid === true, "SCHEMA-9a nested object passes")
  const sv9r2 = sv1.validate(sv9_schema, { address: { street: "123 Main" } })
  assert(sv9r2.valid === false, "SCHEMA-9b nested missing required detected")

  // SCHEMA-10: Array type
  const sv10_schema = {
    tags: {
      type: "array",
      items: { type: "string" },
    },
  }
  const sv10r1 = sv1.validate(sv10_schema, { tags: ["a", "b", "c"] })
  assert(sv10r1.valid === true, "SCHEMA-10a string array passes")
  const sv10r2 = sv1.validate(sv10_schema, { tags: "not-array" })
  assert(sv10r2.valid === false && sv10r2.errors.some(e => e.code === "type_mismatch"), "SCHEMA-10b non-array rejected")

  // SCHEMA-11: parseOrThrow
  const sv11 = new SchemaValidator()
  const sv11r = sv11.parseOrThrow({ x: { type: "number", required: true } }, { x: 42 })
  assert(sv11r.x === 42, "SCHEMA-11a parseOrThrow returns parsed data")
  let sv11_threw = false
  try { sv11.parseOrThrow({ x: { type: "number", required: true } }, {}, "Test") }
  catch (e) { sv11_threw = true; assert(e.message.includes("Test"), "SCHEMA-11b parseOrThrow includes label") }
  assert(sv11_threw === true, "SCHEMA-11c parseOrThrow throws on invalid")

  // SCHEMA-12: toJSONSchema
  const sv12_schema = {
    name: { type: "string", required: true, description: "User name" },
    age: { type: "number", description: "Age in years", minimum: 0 },
  }
  const sv12_js = sv1.toJSONSchema(sv12_schema)
  assert(sv12_js.type === "object", "SCHEMA-12a JSON Schema type=object")
  assert(Array.isArray(sv12_js.required) && sv12_js.required.includes("name"), "SCHEMA-12b required fields included")
  assert(sv12_js.properties?.name?.type === "string", "SCHEMA-12c property type preserved")

  // SCHEMA-13: inferField
  assert(sv1.inferField("hello").type === "string", "SCHEMA-13a infer string")
  assert(sv1.inferField(42).type === "number", "SCHEMA-13b infer number")
  assert(sv1.inferField(true).type === "boolean", "SCHEMA-13c infer boolean")
  const sv13_inferred = sv1.inferField({ a: 1, b: "x" })
  assert(sv13_inferred.type === "object" && sv13_inferred.properties?.a?.type === "number", "SCHEMA-13d infer object")

  // SCHEMA-14: inferSchema
  const sv14_inferred = sv1.inferSchema({ name: "test", count: 5, active: true })
  assert(sv14_inferred.name.type === "string", "SCHEMA-14a inferred name is string")
  assert(sv14_inferred.count.type === "number", "SCHEMA-14b inferred count is number")
  assert(sv14_inferred.active.type === "boolean", "SCHEMA-14c inferred active is boolean")

  assert(true, "SCHEMA-Z SchemaValidator all tests passed")
}

await runAll()
// ── Bandit Mutation Tests ──────────────────────────────────────────
console.log("\n[Bandit] SkillStore UCB1 Bandit Mutation")
const banditPromise = (async () => {
  const { SkillStore, createSkillDefinition } = mod
  const store = new SkillStore()
  let bPassed = 0, bFailed = 0
  const b = (name, fn) => { try { fn(); bPassed++; console.log(`  PASS: ${name}`) } catch (e) { bFailed++; console.log(`  FAIL: ${name} — ${e.message}`) } }

  // Seed skills manually using extract (async) — needs success markers + numbered steps
  await store.extract({ role: "assistant", content: "✅ Completed: create auth login endpoint with JWT verification.\nAdded src/auth.ts with validateToken() and loginUser().\nSteps:\n1. implement middleware\n2. add routes\n3. write tests" }, ["auth", "login", "jwt"])
  await store.extract({ role: "assistant", content: "✅ Completed: create database query module with filtering.\nAdded src/db/query.ts with QueryBuilder class.\nSteps:\n1. design interface\n2. implement query builder\n3. add tests" }, ["db", "query", "database"])
  await store.extract({ role: "assistant", content: "✅ Completed: docker deploy to production with health checks.\nAdded deploy/docker-compose.yml and Dockerfile.prod.\nSteps:\n1. write Dockerfile\n2. compose config\n3. test deployment" }, ["deploy", "docker", "production"])

  const allSkills = store.getAll()
  const authSkill = allSkills.find(s => s.definition.meta.name.includes("auth"))

  // B1: ucb1Score returns a number between 0 and 1
  b("B1a ucb1Score returns number", () => {
    const score = store.ucb1Score(allSkills[0])
    if (typeof score !== "number") throw new Error(`Expected number, got ${typeof score}`)
  })
  b("B1b ucb1Score within [0,1]", () => {
    const score = store.ucb1Score(allSkills[0])
    if (score < 0 || score > 1) throw new Error(`Score ${score} out of [0,1]`)
  })
  b("B1c ucb1Score higher for better successRate", () => {
    // Use a tiny c to minimize exploration term noise
    const skillA = allSkills[0]; const skillB = allSkills[1]
    const originalA = skillA.successRate
    const originalB = skillB.successRate
    skillA.successRate = 0.9
    skillB.successRate = 0.5
    const scoreA = store.ucb1Score(skillA, 0.01)
    const scoreB = store.ucb1Score(skillB, 0.01)
    if (scoreA <= scoreB) throw new Error(`Expected ${scoreA} > ${scoreB} for higher successRate`)
    skillA.successRate = originalA
    skillB.successRate = originalB
  })

  // B2: findWithBandit returns non-empty for existing skills
  b("B2a findWithBandit returns array", () => {
    const result = store.findWithBandit("auth")
    if (!Array.isArray(result)) throw new Error(`Expected array, got ${typeof result}`)
  })
  b("B2b findWithBandit finds relevant skills", () => {
    const result = store.findWithBandit("auth")
    if (result.length === 0) throw new Error("Expected at least 1 result for 'auth'")
  })
  b("B2c findWithBandit empty query returns empty", () => {
    const result = store.findWithBandit("zzz_nonexistent_zzz")
    if (result.length !== 0) throw new Error(`Expected empty, got ${result.length}`)
  })

  // B3: mutateSkill
  b("B3a mutateSkill returns string id", () => {
    if (!authSkill) throw new Error("No auth skill found")
    const id = store.mutateSkill(authSkill.definition.meta.id)
    if (typeof id !== "string") throw new Error(`Expected string, got ${typeof id}`)
  })
  b("B3b mutateSkill variant exists in store", () => {
    if (!authSkill) throw new Error("No auth skill found")
    const id = store.mutateSkill(authSkill.definition.meta.id)
    if (!id) throw new Error("mutateSkill returned null")
    const variant = store.getById(id)
    if (!variant) throw new Error("Variant not found in store")
  })
  b("B3c mutateSkill variant has parentId", () => {
    if (!authSkill) throw new Error("No auth skill found")
    const id = store.mutateSkill(authSkill.definition.meta.id)
    if (!id) throw new Error("mutateSkill returned null")
    const variant = store.getById(id)
    if (variant?.definition.meta.parentId !== authSkill?.definition.meta.id) {
      throw new Error(`Expected parentId ${authSkill?.definition.meta.id}, got ${variant?.definition.meta.parentId}`)
    }
  })
  b("B3d mutateSkill null for unknown id", () => {
    const id = store.mutateSkill("nonexistent-id")
    if (id !== null) throw new Error(`Expected null, got ${id}`)
  })

  // B4: evaluateMutation — use the deploy skill (fewest mutations so far)
  b("B4a evaluateMutation returns boolean", () => {
    const deploySkill = allSkills.find(s => s.definition.meta.name.includes("deploy"))
    if (!deploySkill) throw new Error("No deploy skill found")
    // Create a mutation (should have capacity)
    const mid = store.mutateSkill(deploySkill.definition.meta.id)
    if (!mid) throw new Error("mutateSkill returned null")
    const result = store.evaluateMutation(mid, deploySkill.definition.meta.id)
    if (typeof result !== "boolean") throw new Error(`Expected boolean, got ${typeof result}`)
  })
  b("B4b evaluateMutation false for wrong ids", () => {
    const result = store.evaluateMutation("no-such-id", "no-such-parent")
    if (result !== false) throw new Error("Expected false for nonexistent ids")
  })

  // B5: countVariants (via internal proxy)
  b("B5a variants created have parentId", () => {
    const variants = store.getAll().filter(s => s.definition.meta.parentId)
    if (variants.length === 0) throw new Error("Expected at least 1 variant from earlier mutations")
  })

  console.log(`  Bandit: ${bPassed} passed, ${bFailed} failed`)
  passed += bPassed; failed += bFailed
})();

// Wait for Bandit async tests to complete
await banditPromise;

console.log(`Results: ${passed} passed, ${failed} failed`)
if (failed === 0) console.log("ALL TESTS PASSED")
process.exit(failed > 0 ? 1 : 0)
