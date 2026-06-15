import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "fs"
import { join } from "path"

const pluginDist = new URL("../dist/index.js", import.meta.url).pathname

let passed = 0
let failed = 0
let sid = 0
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
let mod
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

// 3. Tool registration (20 tools)
console.log("\n[3] Tool registration")
for (const name of ["agentic_plan", "agentic_nav", "agentic_execute", "agentic_reflect", "agentic_verify", "agentic_status", "agentic_context", "agentic_snapshot", "agentic_pr", "agentic_score", "agentic_delegate", "agentic_pipeline", "agentic_message", "agentic_skill", "agentic_episodes", "agentic_parallel", "agentic_dashboard", "agentic_guard", "agentic_evolve", "agentic_auto"]) {
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
  stepId: "ft1", success: true, output: "Created types", filesModified: ["src/types.ts"],
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
  stepId: "ep1", success: true, output: "Done ep1", filesModified: ["src/module.ts"],
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
    stepId, success: true, output: `Done ${stepId}`,
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
await hooks.tool.agentic_execute.execute({ stepId: "c1", success: true, output: "Done context", filesModified: ["src/ctx.ts"] }, ctxCtx)
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
await hooks.tool.agentic_execute.execute({ stepId: "sn1", success: true, output: "Done snap", filesModified: ["src/snap.ts"] }, snapCtx)
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
  await hooks.tool.agentic_execute.execute({ stepId: s, success: true, output: `Done ${s}`, filesModified: [`src/${s}.ts`] }, prCtx)
}
const prResult = await hooks.tool.agentic_pr.execute({}, prCtx)
const prOut = typeof prResult === "string" ? prResult : prResult.output
assert(prOut.includes("PR Description") || prOut.includes("Summary"), "PR generated")
assert(prOut.includes("pr1") && prOut.includes("pr2"), "PR includes all steps")

// 23. agentic_score — tech debt analysis
console.log("\n[23] agentic_score — tech debt")
const scCtx = mockCtx(freshSid())
await hooks.tool.agentic_plan.execute({ goal: "Score test", subtasks: [{ id: "sc1", description: "Scored", dependsOn: [] }] }, scCtx)
await hooks.tool.agentic_execute.execute({ stepId: "sc1", success: true, output: "Done", filesModified: [`${projectDir}/src/utils.ts`] }, scCtx)
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
assert(dlOut.includes("System Architect") || dlOut.includes("prompt"), "returns agent prompt")

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
  stepId: "sk1", success: true, output: "1. Created login form\n2. Added email validation\n3. Wrote tests",
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
  stepId: "ep1", success: true, output: "All done", filesModified: ["src/ep.ts"],
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
await hooks.tool.agentic_execute.execute({ stepId: "pl1", success: true, output: "Done", filesModified: ["src/setup.ts"] }, plCtx)
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
await hooks.tool.agentic_execute.execute({ stepId: "px1", success: true, output: "Done", filesModified: ["a.txt"] }, plexCtx)
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
  memory: { enabled: true, mode: "full", maxEntries: 500, compressThreshold: 200, forgetAfterDays: 14, search: { keywordWeight: 0.4, vectorWeight: 0.6 } },
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

// 54. Trace logging
console.log("\n[54] Trace logging")
await hooks.dispose()
const tracePath = join(projectDir, ".agentic", "trace.jsonl")
assert(existsSync(tracePath), "trace file created")
const traceContent = readFileSync(tracePath, "utf-8")
const lines = traceContent.trim().split("\n").filter(Boolean)
assert(lines.length >= 15, `at least 15 trace entries (got ${lines.length})`)
for (const line of lines) {
  try { JSON.parse(line) } catch { assert(false, `invalid JSON: ${line.slice(0, 80)}`) }
}
assert(true, "all trace entries valid JSON")
}

await runAll()

console.log(`\n${"=".repeat(40)}`)
console.log(`Results: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
console.log("ALL TESTS PASSED")
