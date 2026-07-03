/**
 * TOOL STRESS TEST — Edge cases for all 31 agentic tools.
 *
 * Tests each tool with:
 *   - Empty/missing required args
 *   - Boundary values (empty strings, zero, negative)
 *   - Invalid enum values
 *   - Missing session context
 *
 * Run: node test/_stress-tools.mjs
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs"
import { join } from "path"

const pluginDist = new URL("../dist/index.js", import.meta.url).pathname

let passed = 0
let failed = 0
const failedTests = []
let currentSection = ""
let sectionStart = 0

const G = "\x1b[32m", R = "\x1b[31m", Y = "\x1b[33m", B = "\x1b[34m", D = "\x1b[2m", RST = "\x1b[0m"

function assert(condition, msg) {
  if (condition) {
    console.log(`  ${G}PASS${RST}: ${msg}`)
    passed++
  } else {
    console.error(`  ${R}FAIL${RST}: ${msg}`)
    failed++
    failedTests.push({ section: currentSection, msg })
  }
}

function section(name) {
  if (sectionStart > 0) {
    const ms = Date.now() - sectionStart
    console.log(`  ${D}(${ms}ms)${RST}`)
  }
  currentSection = name
  sectionStart = Date.now()
  console.log(`\n${B}${name}${RST}`)
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

// ── Setup test project ──
const projectDir = "/tmp/stress-tools-project"
try { rmSync(projectDir, { recursive: true, force: true }) } catch {}
mkdirSync(projectDir, { recursive: true })
mkdirSync(join(projectDir, "src"), { recursive: true })
writeFileSync(join(projectDir, "package.json"), JSON.stringify({ name: "stress-tools", type: "module" }))
writeFileSync(join(projectDir, "src/index.ts"), "export function main() { return true; }\n")

const mockInput = {
  client: {},
  project: { name: "stress-tools", path: projectDir },
  directory: projectDir,
  worktree: projectDir,
  experimental_workspace: { register: () => {} },
  serverUrl: new URL("http://localhost:3000"),
  $: new Proxy({}, {
    get() { return async () => ({ exitCode: 0, text: () => "", stdout: Buffer.from(""), stderr: Buffer.from("") }) },
  }),
}

// ── Load module ──
let mod, hooks
section("[Setup] Load module + init plugin")
try {
  mod = await import(pluginDist)
  assert(true, "module loaded")
  hooks = await mod.AgenticEngine(mockInput)
  assert(true, "AgenticEngine() executed")
  assert(hooks && typeof hooks.tool === "object", "hooks.tool is object")
} catch (e) {
  assert(false, `Setup failed: ${e.message}`)
  process.exit(1)
}

const toolNames = Object.keys(hooks.tool || {}).filter(t => t.startsWith("agentic_"))
assert(toolNames.length === 31, `31 agentic tools registered (got ${toolNames.length})`)

// ─────────────────────────────────────────────────────────
// 1. agentic_plan — edge cases
// ─────────────────────────────────────────────────────────
section("[1] agentic_plan — edge cases")
{
  const emptyGoal = await hooks.tool.agentic_plan.execute({ goal: "" }, mockCtx("plan-e1"))
  assert(typeof emptyGoal.output === "string" && emptyGoal.output.length > 0, "Empty goal: returns output")

  const noGoal = await hooks.tool.agentic_plan.execute({}, mockCtx("plan-e2"))
  assert(typeof noGoal.output === "string" && noGoal.output.length > 0, "Missing goal: returns output")

  const emptyConstraints = await hooks.tool.agentic_plan.execute({ goal: "test", constraints: [] }, mockCtx("plan-e3"))
  assert(typeof emptyConstraints.output === "string", "Empty constraints array: returns output")

  const noSubtasks = await hooks.tool.agentic_plan.execute({ goal: "test", subtasks: [], autoDecompose: false }, mockCtx("plan-e4"))
  assert(typeof noSubtasks.output === "string", "Empty subtasks with autoDecompose=false: returns output")

  const garbage = await hooks.tool.agentic_plan.execute({ goal: "!@#$%^&*()_+ 123" }, mockCtx("plan-e5"))
  assert(typeof garbage.output === "string", "Garbage goal: returns output")
}

console.log(`\n${Y}Progress: ${passed} passed, ${failed} failed${RST}`)

// ─────────────────────────────────────────────────────────
// 2. agentic_nav — edge cases
// ─────────────────────────────────────────────────────────
section("[2] agentic_nav — edge cases")
{
  const emptyQ = await hooks.tool.agentic_nav.execute({ query: "" }, mockCtx("nav-e1"))
  assert(typeof emptyQ.output === "string", "Empty query: returns output")

  const noQ = await hooks.tool.agentic_nav.execute({}, mockCtx("nav-e2"))
  assert(typeof noQ.output === "string", "Missing query: returns output")

  const zeroMax = await hooks.tool.agentic_nav.execute({ query: "test", maxResults: 0 }, mockCtx("nav-e3"))
  assert(typeof zeroMax.output === "string", "maxResults=0: returns output")

  const negMax = await hooks.tool.agentic_nav.execute({ query: "test", maxResults: -1 }, mockCtx("nav-e4"))
  assert(typeof negMax.output === "string", "maxResults=-1: returns output")

  const summaryEmpty = await hooks.tool.agentic_nav.execute({ query: "", showSummary: true }, mockCtx("nav-e5"))
  assert(typeof summaryEmpty.output === "string", "Empty query + showSummary: returns output")
}

console.log(`\n${Y}Progress: ${passed} passed, ${failed} failed${RST}`)

// ─────────────────────────────────────────────────────────
// 3. agentic_execute — edge cases
// ─────────────────────────────────────────────────────────
section("[3] agentic_execute — edge cases")
{
  const execSid = "exec-edge"
  await hooks.tool.agentic_plan.execute({
    goal: "Edge case test",
    subtasks: [{ id: "ee1", description: "Edge step", dependsOn: [] }],
  }, mockCtx(execSid))

  const emptyStep = await hooks.tool.agentic_execute.execute({ stepId: "", success: true, output: "done" }, mockCtx(execSid))
  assert(typeof emptyStep.output === "string", "Empty stepId: returns output")

  const noStep = await hooks.tool.agentic_execute.execute({ success: true, output: "done" }, mockCtx(execSid))
  assert(typeof noStep.output === "string", "Missing stepId: returns output")

  const noSuccess = await hooks.tool.agentic_execute.execute({ stepId: "ee1", output: "done" }, mockCtx(execSid))
  assert(typeof noSuccess.output === "string", "Missing success: returns output")

  const emptyOut = await hooks.tool.agentic_execute.execute({ stepId: "ee1", success: true, output: "" }, mockCtx(execSid))
  assert(typeof emptyOut.output === "string", "Empty output: returns output")

  const emptyFiles = await hooks.tool.agentic_execute.execute({ stepId: "ee1", success: true, output: "done", filesModified: [] }, mockCtx(execSid))
  assert(typeof emptyFiles.output === "string", "Empty filesModified: returns output")

  const badFeedback = await hooks.tool.agentic_execute.execute({ stepId: "ee1", success: true, output: "done", feedback: "invalid" }, mockCtx(execSid))
  assert(typeof badFeedback.output === "string", "Invalid feedback: returns output")

  const emptyEvidence = await hooks.tool.agentic_execute.execute({ stepId: "ee1", success: true, output: "done", verificationEvidence: {} }, mockCtx(execSid))
  assert(typeof emptyEvidence.output === "string", "Empty verificationEvidence: returns output")
}

console.log(`\n${Y}Progress: ${passed} passed, ${failed} failed${RST}`)

// ─────────────────────────────────────────────────────────
// 4. agentic_reflect — edge cases
// ─────────────────────────────────────────────────────────
section("[4] agentic_reflect — edge cases")
{
  const noStep = await hooks.tool.agentic_reflect.execute({ stepId: "nonexistent" }, mockCtx("refl-e1"))
  assert(typeof noStep.output === "string", "Non-existent stepId: returns output")
  assert(noStep.output.includes("No execution record"), "Non-existent stepId: reports no record")

  const emptyStep = await hooks.tool.agentic_reflect.execute({ stepId: "" }, mockCtx("refl-e2"))
  assert(typeof emptyStep.output === "string", "Empty stepId: returns output")

  const noStepId = await hooks.tool.agentic_reflect.execute({}, mockCtx("refl-e3"))
  assert(typeof noStepId.output === "string", "Missing stepId: returns output")
}

console.log(`\n${Y}Progress: ${passed} passed, ${failed} failed${RST}`)

// ─────────────────────────────────────────────────────────
// 5. agentic_verify — edge cases
// ─────────────────────────────────────────────────────────
section("[5] agentic_verify — edge cases")
{
  const noArgs = await hooks.tool.agentic_verify.execute({}, mockCtx("vrf-e1"))
  assert(typeof noArgs.output === "string", "No args: returns output")

  const emptyStep = await hooks.tool.agentic_verify.execute({ stepId: "" }, mockCtx("vrf-e2"))
  assert(typeof emptyStep.output === "string", "Empty stepId: returns output")

  const badTier = await hooks.tool.agentic_verify.execute({ tier: "invalid" }, mockCtx("vrf-e3"))
  assert(typeof badTier.output === "string", "Invalid tier: returns output")

  const emptyDir = await hooks.tool.agentic_verify.execute({ projectDir: "" }, mockCtx("vrf-e4"))
  assert(typeof emptyDir.output === "string", "Empty projectDir: returns output")
}

console.log(`\n${Y}Progress: ${passed} passed, ${failed} failed${RST}`)

// ─────────────────────────────────────────────────────────
// 6. agentic_status — edge cases
// ─────────────────────────────────────────────────────────
section("[6] agentic_status — edge cases")
{
  const noArgs = await hooks.tool.agentic_status.execute({}, mockCtx("stat-e1"))
  assert(typeof noArgs.output === "string", "No args: returns output")

  const badDetail = await hooks.tool.agentic_status.execute({ detail: "invalid" }, mockCtx("stat-e2"))
  assert(typeof badDetail.output === "string", "Invalid detail: returns output")

  const emptyDetail = await hooks.tool.agentic_status.execute({ detail: "" }, mockCtx("stat-e3"))
  assert(typeof emptyDetail.output === "string", "Empty detail: returns output")
}

console.log(`\n${Y}Progress: ${passed} passed, ${failed} failed${RST}`)

// ─────────────────────────────────────────────────────────
// 7. agentic_context — edge cases
// ─────────────────────────────────────────────────────────
section("[7] agentic_context — edge cases")
{
  const noAction = await hooks.tool.agentic_context.execute({}, mockCtx("ctx-e1"))
  assert(typeof noAction.output === "string", "Missing action: returns output")

  const badAction = await hooks.tool.agentic_context.execute({ action: "invalid" }, mockCtx("ctx-e2"))
  assert(typeof badAction.output === "string", "Invalid action: returns output")

  const emptyAction = await hooks.tool.agentic_context.execute({ action: "" }, mockCtx("ctx-e3"))
  assert(typeof emptyAction.output === "string", "Empty action: returns output")
}

console.log(`\n${Y}Progress: ${passed} passed, ${failed} failed${RST}`)

// ─────────────────────────────────────────────────────────
// 8. agentic_snapshot — edge cases
// ─────────────────────────────────────────────────────────
section("[8] agentic_snapshot — edge cases")
{
  const noAction = await hooks.tool.agentic_snapshot.execute({}, mockCtx("snap-e1"))
  assert(typeof noAction.output === "string", "Missing action: returns output")

  const badAction = await hooks.tool.agentic_snapshot.execute({ action: "invalid" }, mockCtx("snap-e2"))
  assert(typeof badAction.output === "string", "Invalid action: returns output")

  const emptyLabel = await hooks.tool.agentic_snapshot.execute({ action: "save", label: "" }, mockCtx("snap-e3"))
  assert(typeof emptyLabel.output === "string", "Save with empty label: returns output")

  const restoreNoLabel = await hooks.tool.agentic_snapshot.execute({ action: "restore" }, mockCtx("snap-e4"))
  assert(typeof restoreNoLabel.output === "string", "Restore with no label: returns output")

  const listOk = await hooks.tool.agentic_snapshot.execute({ action: "list" }, mockCtx("snap-e5"))
  assert(typeof listOk.output === "string", "List: returns output")
}

console.log(`\n${Y}Progress: ${passed} passed, ${failed} failed${RST}`)

// ─────────────────────────────────────────────────────────
// 9. agentic_pr — edge cases
// ─────────────────────────────────────────────────────────
section("[9] agentic_pr — edge cases")
{
  const noPlan = await hooks.tool.agentic_pr.execute({}, mockCtx("pr-e1"))
  assert(typeof noPlan.output === "string", "No plan: returns output")

  const badAction = await hooks.tool.agentic_pr.execute({ action: "invalid" }, mockCtx("pr-e2"))
  assert(typeof badAction.output === "string", "Invalid action: returns output")

  const emptyTitle = await hooks.tool.agentic_pr.execute({ title: "" }, mockCtx("pr-e3"))
  assert(typeof emptyTitle.output === "string", "Empty title: returns output")
}

console.log(`\n${Y}Progress: ${passed} passed, ${failed} failed${RST}`)

// ─────────────────────────────────────────────────────────
// 10. agentic_score — edge cases
// ─────────────────────────────────────────────────────────
section("[10] agentic_score — edge cases")
{
  const noFiles = await hooks.tool.agentic_score.execute({}, mockCtx("score-e1"))
  assert(typeof noFiles.output === "string", "No files: returns output")

  const emptyFiles = await hooks.tool.agentic_score.execute({ files: [] }, mockCtx("score-e2"))
  assert(typeof emptyFiles.output === "string", "Empty files array: returns output")

  const badFiles = await hooks.tool.agentic_score.execute({ files: ["/nonexistent/file.ts"] }, mockCtx("score-e3"))
  assert(typeof badFiles.output === "string", "Non-existent files: returns output")
}

console.log(`\n${Y}Progress: ${passed} passed, ${failed} failed${RST}`)

// ─────────────────────────────────────────────────────────
// 11. agentic_delegate — edge cases
// ─────────────────────────────────────────────────────────
section("[11] agentic_delegate — edge cases")
{
  const emptyDesc = await hooks.tool.agentic_delegate.execute({ taskId: "t1", description: "", role: "developer" }, mockCtx("del-e1"))
  assert(typeof emptyDesc.output === "string", "Empty description: returns output")

  const noRole = await hooks.tool.agentic_delegate.execute({ taskId: "t2", description: "test task" }, mockCtx("del-e2"))
  assert(typeof noRole.output === "string", "Missing role: returns output")

  const badRole = await hooks.tool.agentic_delegate.execute({ taskId: "t3", description: "test", role: "invalid_role" }, mockCtx("del-e3"))
  assert(typeof badRole.output === "string", "Invalid role: returns output")

  const emptyTasks = await hooks.tool.agentic_delegate.execute({ description: "batch", tasks: [] }, mockCtx("del-e4"))
  assert(typeof emptyTasks.output === "string", "Empty tasks array: returns output")
}

console.log(`\n${Y}Progress: ${passed} passed, ${failed} failed${RST}`)

// ─────────────────────────────────────────────────────────
// 12. agentic_pipeline — edge cases
// ─────────────────────────────────────────────────────────
section("[12] agentic_pipeline — edge cases")
{
  const noAction = await hooks.tool.agentic_pipeline.execute({}, mockCtx("pipe-e1"))
  assert(typeof noAction.output === "string", "Missing action: returns output")

  const badAction = await hooks.tool.agentic_pipeline.execute({ action: "invalid" }, mockCtx("pipe-e2"))
  assert(typeof badAction.output === "string", "Invalid action: returns output")

  const emptyAction = await hooks.tool.agentic_pipeline.execute({ action: "" }, mockCtx("pipe-e3"))
  assert(typeof emptyAction.output === "string", "Empty action: returns output")

  const emptyStages = await hooks.tool.agentic_pipeline.execute({ action: "define", pipelineId: "p1", stages: [] }, mockCtx("pipe-e4"))
  assert(typeof emptyStages.output === "string", "Empty stages: returns output")

  const noPipeline = await hooks.tool.agentic_pipeline.execute({ action: "run", pipelineId: "nonexistent" }, mockCtx("pipe-e5"))
  assert(typeof noPipeline.output === "string", "Run non-existent: returns output")

  const badStatus = await hooks.tool.agentic_pipeline.execute({ action: "status" }, mockCtx("pipe-e6"))
  assert(typeof badStatus.output === "string", "Status without pipelineId: returns output")
}

console.log(`\n${Y}Progress: ${passed} passed, ${failed} failed${RST}`)

// ─────────────────────────────────────────────────────────
// 13. agentic_message — edge cases
// ─────────────────────────────────────────────────────────
section("[13] agentic_message — edge cases")
{
  const noAction = await hooks.tool.agentic_message.execute({}, mockCtx("msg-e1"))
  assert(typeof noAction.output === "string", "Missing action: returns output")

  const badAction = await hooks.tool.agentic_message.execute({ action: "invalid" }, mockCtx("msg-e2"))
  assert(typeof badAction.output === "string", "Invalid action: returns output")

  const emptyMsg = await hooks.tool.agentic_message.execute({ action: "send", to: "developer", message: "" }, mockCtx("msg-e3"))
  assert(typeof emptyMsg.output === "string", "Empty message: returns output")

  const emptyTo = await hooks.tool.agentic_message.execute({ action: "send", to: "", message: "hello" }, mockCtx("msg-e4"))
  assert(typeof emptyTo.output === "string", "Empty recipient: returns output")

  const inbox = await hooks.tool.agentic_message.execute({ action: "inbox" }, mockCtx("msg-e5"))
  assert(typeof inbox.output === "string", "Inbox: returns output")
}

console.log(`\n${Y}Progress: ${passed} passed, ${failed} failed${RST}`)

// ─────────────────────────────────────────────────────────
// 14. agentic_skill — edge cases
// ─────────────────────────────────────────────────────────
section("[14] agentic_skill — edge cases")
{
  const noAction = await hooks.tool.agentic_skill.execute({}, mockCtx("sk-e1"))
  assert(typeof noAction.output === "string", "Missing action: returns output")

  const badAction = await hooks.tool.agentic_skill.execute({ action: "invalid" }, mockCtx("sk-e2"))
  assert(typeof badAction.output === "string", "Invalid action: returns output")

  const emptyAction = await hooks.tool.agentic_skill.execute({ action: "" }, mockCtx("sk-e3"))
  assert(typeof emptyAction.output === "string", "Empty action: returns output")

  const emptyQuery = await hooks.tool.agentic_skill.execute({ action: "find", query: "" }, mockCtx("sk-e4"))
  assert(typeof emptyQuery.output === "string", "Find empty query: returns output")

  const listOk = await hooks.tool.agentic_skill.execute({ action: "list" }, mockCtx("sk-e5"))
  assert(typeof listOk.output === "string", "List: returns output")
}

console.log(`\n${Y}Progress: ${passed} passed, ${failed} failed${RST}`)

// ─────────────────────────────────────────────────────────
// 15. agentic_model — edge cases
// ─────────────────────────────────────────────────────────
section("[15] agentic_model — edge cases")
{
  const noAction = await hooks.tool.agentic_model.execute({}, mockCtx("mod-e1"))
  assert(typeof noAction.output === "string", "Missing action: returns output")

  const badAction = await hooks.tool.agentic_model.execute({ action: "invalid" }, mockCtx("mod-e2"))
  assert(typeof badAction.output === "string", "Invalid action: returns output")

  const noModel = await hooks.tool.agentic_model.execute({ action: "set", role: "developer" }, mockCtx("mod-e3"))
  assert(typeof noModel.output === "string", "Set without model: returns output")

  const emptyModel = await hooks.tool.agentic_model.execute({ action: "set", role: "developer", model: "" }, mockCtx("mod-e4"))
  assert(typeof emptyModel.output === "string", "Set with empty model: returns output")

  const getNonexistent = await hooks.tool.agentic_model.execute({ action: "get", tool: "nonexistent_tool" }, mockCtx("mod-e5"))
  assert(typeof getNonexistent.output === "string", "Get non-existent preference: returns output")

  const listOk = await hooks.tool.agentic_model.execute({ action: "list" }, mockCtx("mod-e6"))
  assert(typeof listOk.output === "string", "List: returns output")
}

console.log(`\n${Y}Progress: ${passed} passed, ${failed} failed${RST}`)

// ─────────────────────────────────────────────────────────
// 16. agentic_budget — edge cases
// ─────────────────────────────────────────────────────────
section("[16] agentic_budget — edge cases")
{
  const noAction = await hooks.tool.agentic_budget.execute({}, mockCtx("bud-e1"))
  assert(typeof noAction.output === "string", "Missing action: returns output")

  const badAction = await hooks.tool.agentic_budget.execute({ action: "invalid" }, mockCtx("bud-e2"))
  assert(typeof badAction.output === "string", "Invalid action: returns output")

  const zeroTokens = await hooks.tool.agentic_budget.execute({ action: "set", maxTokens: 0 }, mockCtx("bud-e3"))
  assert(typeof zeroTokens.output === "string", "Set with maxTokens=0: returns output")

  const negSteps = await hooks.tool.agentic_budget.execute({ action: "set", maxSteps: -1 }, mockCtx("bud-e4"))
  assert(typeof negSteps.output === "string", "Set with negative maxSteps: returns output")

  const statusOk = await hooks.tool.agentic_budget.execute({ action: "status" }, mockCtx("bud-e5"))
  assert(typeof statusOk.output === "string", "Status no scope: returns output")

  const getOk = await hooks.tool.agentic_budget.execute({ action: "get" }, mockCtx("bud-e6"))
  assert(typeof getOk.output === "string", "Get no scope: returns output")
}

console.log(`\n${Y}Progress: ${passed} passed, ${failed} failed${RST}`)

// ─────────────────────────────────────────────────────────
// 17. agentic_episodes — edge cases
// ─────────────────────────────────────────────────────────
section("[17] agentic_episodes — edge cases")
{
  const noAction = await hooks.tool.agentic_episodes.execute({}, mockCtx("ep-e1"))
  assert(typeof noAction.output === "string", "Missing action: returns output")

  const badAction = await hooks.tool.agentic_episodes.execute({ action: "invalid" }, mockCtx("ep-e2"))
  assert(typeof badAction.output === "string", "Invalid action: returns output")

  const emptyQ = await hooks.tool.agentic_episodes.execute({ action: "search", query: "" }, mockCtx("ep-e3"))
  assert(typeof emptyQ.output === "string", "Search empty query: returns output")

  const noQ = await hooks.tool.agentic_episodes.execute({ action: "search" }, mockCtx("ep-e4"))
  assert(typeof noQ.output === "string", "Search no query: returns output")

  const statsOk = await hooks.tool.agentic_episodes.execute({ action: "stats" }, mockCtx("ep-e5"))
  assert(typeof statsOk.output === "string", "Stats: returns output")
}

console.log(`\n${Y}Progress: ${passed} passed, ${failed} failed${RST}`)

// ─────────────────────────────────────────────────────────
// 18. agentic_parallel — edge cases
// ─────────────────────────────────────────────────────────
section("[18] agentic_parallel — edge cases")
{
  const noAction = await hooks.tool.agentic_parallel.execute({}, mockCtx("par-e1"))
  assert(typeof noAction.output === "string", "Missing action: returns output")

  const badAction = await hooks.tool.agentic_parallel.execute({ action: "invalid" }, mockCtx("par-e2"))
  assert(typeof badAction.output === "string", "Invalid action: returns output")

  const noPlan = await hooks.tool.agentic_parallel.execute({ action: "analyze" }, mockCtx("par-e3"))
  assert(typeof noPlan.output === "string", "Analyze no plan: returns output")

  const execNoPlan = await hooks.tool.agentic_parallel.execute({ action: "execute" }, mockCtx("par-e4"))
  assert(typeof execNoPlan.output === "string", "Execute no plan: returns output")
}

console.log(`\n${Y}Progress: ${passed} passed, ${failed} failed${RST}`)

// ─────────────────────────────────────────────────────────
// 19. agentic_guard — edge cases
// ─────────────────────────────────────────────────────────
section("[19] agentic_guard — edge cases")
{
  const noStep = await hooks.tool.agentic_guard.execute({ stepId: "nonexistent" }, mockCtx("guard-e1"))
  assert(typeof noStep.output === "string", "Non-existent stepId: returns output")

  const emptyStep = await hooks.tool.agentic_guard.execute({ stepId: "" }, mockCtx("guard-e2"))
  assert(typeof emptyStep.output === "string", "Empty stepId: returns output")

  const noStepId = await hooks.tool.agentic_guard.execute({}, mockCtx("guard-e3"))
  assert(typeof noStepId.output === "string", "Missing stepId: returns output")
}

console.log(`\n${Y}Progress: ${passed} passed, ${failed} failed${RST}`)

// ─────────────────────────────────────────────────────────
// 20. agentic_evolve — edge cases
// ─────────────────────────────────────────────────────────
section("[20] agentic_evolve — edge cases")
{
  const noAction = await hooks.tool.agentic_evolve.execute({}, mockCtx("ev-e1"))
  assert(typeof noAction.output === "string", "Missing action: returns output")

  const badAction = await hooks.tool.agentic_evolve.execute({ action: "invalid" }, mockCtx("ev-e2"))
  assert(typeof badAction.output === "string", "Invalid action: returns output")

  const emptyAction = await hooks.tool.agentic_evolve.execute({ action: "" }, mockCtx("ev-e3"))
  assert(typeof emptyAction.output === "string", "Empty action: returns output")

  const inspectOk = await hooks.tool.agentic_evolve.execute({ action: "inspect" }, mockCtx("ev-e4"))
  assert(typeof inspectOk.output === "string", "Inspect: returns output")

  const noSkill = await hooks.tool.agentic_evolve.execute({ action: "export-skill", name: "nonexistent" }, mockCtx("ev-e5"))
  assert(typeof noSkill.output === "string", "Export non-existent skill: returns output")
}

console.log(`\n${Y}Progress: ${passed} passed, ${failed} failed${RST}`)

// ─────────────────────────────────────────────────────────
// 21. agentic_auto — edge cases
// ─────────────────────────────────────────────────────────
section("[21] agentic_auto — edge cases")
{
  const emptyGoal = await hooks.tool.agentic_auto.execute({ goal: "" }, mockCtx("auto-e1"))
  assert(typeof emptyGoal.output === "string", "Empty goal: returns output")

  const noGoal = await hooks.tool.agentic_auto.execute({}, mockCtx("auto-e2"))
  assert(typeof noGoal.output === "string", "Missing goal: returns output")

  const emptyConstraints = await hooks.tool.agentic_auto.execute({ goal: "test", constraints: [] }, mockCtx("auto-e3"))
  assert(typeof emptyConstraints.output === "string", "Empty constraints: returns output")

  const notThorough = await hooks.tool.agentic_auto.execute({ goal: "simple task", thorough: false, maxSteps: 1 }, mockCtx("auto-e4"))
  assert(typeof notThorough.output === "string", "thorough=false: returns output")

  const zeroSteps = await hooks.tool.agentic_auto.execute({ goal: "test", maxSteps: 0 }, mockCtx("auto-e5"))
  assert(typeof zeroSteps.output === "string", "maxSteps=0: returns output")
}

console.log(`\n${Y}Progress: ${passed} passed, ${failed} failed${RST}`)

// ─────────────────────────────────────────────────────────
// 22. agentic_debate — edge cases
// ─────────────────────────────────────────────────────────
section("[22] agentic_debate — edge cases")
{
  const emptyTask = await hooks.tool.agentic_debate.execute({ task: "" }, mockCtx("deb-e1"))
  assert(typeof emptyTask.output === "string", "Empty task: returns output")

  const noTask = await hooks.tool.agentic_debate.execute({}, mockCtx("deb-e2"))
  assert(typeof noTask.output === "string", "Missing task: returns output")

  const zeroRounds = await hooks.tool.agentic_debate.execute({ task: "test", maxRounds: 0 }, mockCtx("deb-e3"))
  assert(typeof zeroRounds.output === "string", "maxRounds=0: returns output")

  const negRounds = await hooks.tool.agentic_debate.execute({ task: "test", maxRounds: -1 }, mockCtx("deb-e4"))
  assert(typeof negRounds.output === "string", "maxRounds=-1: returns output")

  const badFormat = await hooks.tool.agentic_debate.execute({ task: "test", format: "invalid" }, mockCtx("deb-e5"))
  assert(typeof badFormat.output === "string", "Invalid format: returns output")
}

console.log(`\n${Y}Progress: ${passed} passed, ${failed} failed${RST}`)

// ─────────────────────────────────────────────────────────
// 23. agentic_router — edge cases
// ─────────────────────────────────────────────────────────
section("[23] agentic_router — edge cases")
{
  const emptyInput = await hooks.tool.agentic_router.execute({ input: "" }, mockCtx("rtr-e1"))
  assert(typeof emptyInput.output === "string", "Empty input: returns output")

  const noInput = await hooks.tool.agentic_router.execute({}, mockCtx("rtr-e2"))
  assert(typeof noInput.output === "string", "Missing input: returns output")

  const garbage = await hooks.tool.agentic_router.execute({ input: "!@#$%^&*()" }, mockCtx("rtr-e3"))
  assert(typeof garbage.output === "string", "Garbage input: returns output")

  const emptyCat = await hooks.tool.agentic_router.execute({ input: "test", categories: [] }, mockCtx("rtr-e4"))
  assert(typeof emptyCat.output === "string", "Empty categories: returns output")
}

console.log(`\n${Y}Progress: ${passed} passed, ${failed} failed${RST}`)

// ─────────────────────────────────────────────────────────
// 24. agentic_clean — edge cases
// ─────────────────────────────────────────────────────────
section("[24] agentic_clean — edge cases")
{
  const emptyText = await hooks.tool.agentic_clean.execute({ text: "" }, mockCtx("cln-e1"))
  assert(typeof emptyText.output === "string", "Empty text: returns output")

  const noText = await hooks.tool.agentic_clean.execute({}, mockCtx("cln-e2"))
  assert(typeof noText.output === "string", "Missing text: returns output")

  const badFormat = await hooks.tool.agentic_clean.execute({ text: "hello", format: "invalid" }, mockCtx("cln-e3"))
  assert(typeof badFormat.output === "string", "Invalid format: returns output")

  const schemaNoMatch = await hooks.tool.agentic_clean.execute({ text: "raw text", format: "json", schema: "array of {name}" }, mockCtx("cln-e4"))
  assert(typeof schemaNoMatch.output === "string", "Schema no match: returns output")
}

console.log(`\n${Y}Progress: ${passed} passed, ${failed} failed${RST}`)

// ─────────────────────────────────────────────────────────
// 25. agentic_rag — edge cases
// ─────────────────────────────────────────────────────────
section("[25] agentic_rag — edge cases")
{
  const noAction = await hooks.tool.agentic_rag.execute({}, mockCtx("rag-e1"))
  assert(typeof noAction.output === "string", "Missing action: returns output")

  const badAction = await hooks.tool.agentic_rag.execute({ action: "invalid" }, mockCtx("rag-e2"))
  assert(typeof badAction.output === "string", "Invalid action: returns output")

  const emptyQ = await hooks.tool.agentic_rag.execute({ action: "search", query: "" }, mockCtx("rag-e3"))
  assert(typeof emptyQ.output === "string", "Search empty query: returns output")

  const emptyContent = await hooks.tool.agentic_rag.execute({ action: "store", title: "t", content: "", category: "code" }, mockCtx("rag-e4"))
  assert(typeof emptyContent.output === "string", "Store empty content: returns output")

  const badCat = await hooks.tool.agentic_rag.execute({ action: "search", query: "test", category: "nonexistent" }, mockCtx("rag-e5"))
  assert(typeof badCat.output === "string", "Search in bad category: returns output")

  const statsOk = await hooks.tool.agentic_rag.execute({ action: "stats" }, mockCtx("rag-e6"))
  assert(typeof statsOk.output === "string", "Stats: returns output")
}

console.log(`\n${Y}Progress: ${passed} passed, ${failed} failed${RST}`)

// ─────────────────────────────────────────────────────────
// 26. agentic_mcp — edge cases
// ─────────────────────────────────────────────────────────
section("[26] agentic_mcp — edge cases")
{
  const noAction = await hooks.tool.agentic_mcp.execute({}, mockCtx("mcp-e1"))
  assert(typeof noAction.output === "string", "Missing action: returns output")

  const badAction = await hooks.tool.agentic_mcp.execute({ action: "invalid" }, mockCtx("mcp-e2"))
  assert(typeof badAction.output === "string", "Invalid action: returns output")

  const noTransport = await hooks.tool.agentic_mcp.execute({ action: "connect", name: "test" }, mockCtx("mcp-e3"))
  assert(typeof noTransport.output === "string", "Connect no transport: returns output")

  const callNoServer = await hooks.tool.agentic_mcp.execute({ action: "call", tool: "test" }, mockCtx("mcp-e4"))
  assert(typeof callNoServer.output === "string", "Call no server: returns output")

  const listOk = await hooks.tool.agentic_mcp.execute({ action: "list" }, mockCtx("mcp-e5"))
  assert(typeof listOk.output === "string", "List: returns output")

  const serverStatus = await hooks.tool.agentic_mcp.execute({ action: "server-status" }, mockCtx("mcp-e6"))
  assert(typeof serverStatus.output === "string", "Server status: returns output")
}

console.log(`\n${Y}Progress: ${passed} passed, ${failed} failed${RST}`)

// ─────────────────────────────────────────────────────────
// 27. agentic_a2a — edge cases
// ─────────────────────────────────────────────────────────
section("[27] agentic_a2a — edge cases")
{
  const noAction = await hooks.tool.agentic_a2a.execute({}, mockCtx("a2a-e1"))
  assert(typeof noAction.output === "string", "Missing action: returns output")

  const badAction = await hooks.tool.agentic_a2a.execute({ action: "invalid" }, mockCtx("a2a-e2"))
  assert(typeof badAction.output === "string", "Invalid action: returns output")

  const pingNoUrl = await hooks.tool.agentic_a2a.execute({ action: "ping" }, mockCtx("a2a-e3"))
  assert(typeof pingNoUrl.output === "string", "Ping no URL: returns output")

  const discNoUrl = await hooks.tool.agentic_a2a.execute({ action: "discover" }, mockCtx("a2a-e4"))
  assert(typeof discNoUrl.output === "string", "Discover no URL: returns output")

  const listOk = await hooks.tool.agentic_a2a.execute({ action: "list" }, mockCtx("a2a-e5"))
  assert(typeof listOk.output === "string", "List: returns output")
}

console.log(`\n${Y}Progress: ${passed} passed, ${failed} failed${RST}`)

// ─────────────────────────────────────────────────────────
// 28. agentic_tools — edge cases
// ─────────────────────────────────────────────────────────
section("[28] agentic_tools — edge cases")
{
  const noAction = await hooks.tool.agentic_tools.execute({}, mockCtx("tools-e1"))
  assert(typeof noAction.output === "string", "Missing action: returns output")

  const badAction = await hooks.tool.agentic_tools.execute({ action: "invalid" }, mockCtx("tools-e2"))
  assert(typeof badAction.output === "string", "Invalid action: returns output")

  const emptyQ = await hooks.tool.agentic_tools.execute({ action: "search", query: "" }, mockCtx("tools-e3"))
  assert(typeof emptyQ.output === "string", "Search empty query: returns output")

  const noQ = await hooks.tool.agentic_tools.execute({ action: "search" }, mockCtx("tools-e4"))
  assert(typeof noQ.output === "string", "Search no query: returns output")

  const listOk = await hooks.tool.agentic_tools.execute({ action: "list" }, mockCtx("tools-e5"))
  assert(typeof listOk.output === "string", "List: returns output")

  const statsOk = await hooks.tool.agentic_tools.execute({ action: "stats" }, mockCtx("tools-e6"))
  assert(typeof statsOk.output === "string", "Stats: returns output")
}

console.log(`\n${Y}Progress: ${passed} passed, ${failed} failed${RST}`)

// ─────────────────────────────────────────────────────────
// 29. agentic_finetune — edge cases
// ─────────────────────────────────────────────────────────
section("[29] agentic_finetune — edge cases")
{
  const noAction = await hooks.tool.agentic_finetune.execute({}, mockCtx("ft-e1"))
  assert(typeof noAction.output === "string", "Missing action: returns output")

  const badAction = await hooks.tool.agentic_finetune.execute({ action: "invalid" }, mockCtx("ft-e2"))
  assert(typeof badAction.output === "string", "Invalid action: returns output")

  const emptyAction = await hooks.tool.agentic_finetune.execute({ action: "" }, mockCtx("ft-e3"))
  assert(typeof emptyAction.output === "string", "Empty action: returns output")

  const prepareOk = await hooks.tool.agentic_finetune.execute({ action: "prepare", format: "openai" }, mockCtx("ft-e4"))
  assert(typeof prepareOk.output === "string", "Prepare: returns output")
}

console.log(`\n${Y}Progress: ${passed} passed, ${failed} failed${RST}`)

// ─────────────────────────────────────────────────────────
// 30. agentic_db — edge cases
// ─────────────────────────────────────────────────────────
section("[30] agentic_db — edge cases")
{
  const noAction = await hooks.tool.agentic_db.execute({}, mockCtx("db-e1"))
  assert(typeof noAction.output === "string", "Missing action: returns output")

  const badAction = await hooks.tool.agentic_db.execute({ action: "invalid" }, mockCtx("db-e2"))
  assert(typeof badAction.output === "string", "Invalid action: returns output")

  const emptyAction = await hooks.tool.agentic_db.execute({ action: "" }, mockCtx("db-e3"))
  assert(typeof emptyAction.output === "string", "Empty action: returns output")

  const listOk = await hooks.tool.agentic_db.execute({ action: "list", namespace: "test" }, mockCtx("db-e4"))
  assert(typeof listOk.output === "string", "List namespace: returns output")

  const statsOk = await hooks.tool.agentic_db.execute({ action: "stats" }, mockCtx("db-e5"))
  assert(typeof statsOk.output === "string", "Stats: returns output")
}

console.log(`\n${Y}Progress: ${passed} passed, ${failed} failed${RST}`)

// ─────────────────────────────────────────────────────────
// 31. agentic_memo — edge cases
// ─────────────────────────────────────────────────────────
section("[31] agentic_memo — edge cases")
{
  const noAction = await hooks.tool.agentic_memo.execute({}, mockCtx("memo-e1"))
  assert(typeof noAction.output === "string", "Missing action: returns output")

  const badAction = await hooks.tool.agentic_memo.execute({ action: "invalid" }, mockCtx("memo-e2"))
  assert(typeof badAction.output === "string", "Invalid action: returns output")

  const emptyAction = await hooks.tool.agentic_memo.execute({ action: "" }, mockCtx("memo-e3"))
  assert(typeof emptyAction.output === "string", "Empty action: returns output")

  const listOk = await hooks.tool.agentic_memo.execute({ action: "list" }, mockCtx("memo-e4"))
  assert(typeof listOk.output === "string", "List: returns output")

  const addTodo = await hooks.tool.agentic_memo.execute({ action: "todo", text: "Stress test todo", priority: "low" }, mockCtx("memo-e5"))
  assert(typeof addTodo.output === "string", "Add TODO: returns output")

  const reflectOk = await hooks.tool.agentic_memo.execute({ action: "reflect" }, mockCtx("memo-e6"))
  assert(typeof reflectOk.output === "string", "Reflect: returns output")
}

console.log(`\n${Y}Progress: ${passed} passed, ${failed} failed${RST}`)

// ─────────────────────────────────────────────────────────
// 32. Missing session context — critical edge for ALL tools
// ─────────────────────────────────────────────────────────
section("[32] Missing session context — all tools")
{
  const ctxNames = Object.keys(hooks.tool).filter(t => t.startsWith("agentic_"))
  const emptyCtx = null

  for (const name of ctxNames) {
    try {
      const result = await hooks.tool[name].execute({}, emptyCtx)
      assert(typeof result.output === "string" && result.output.includes("requires an active session"),
        `"${name}" no-session guard: returns proper message`)
    } catch (e) {
      assert(false, `"${name}" no-session guard THREW: ${e.message}`)
    }
  }
}

console.log(`\n${Y}Progress: ${passed} passed, ${failed} failed${RST}`)

// ─────────────────────────────────────────────────────────
// 33. Stability — all passed without crash
// ─────────────────────────────────────────────────────────
section("[33] Stability — zero crashes under edge-case load")
{
  assert(true, "All tool edge case tests completed without crash")
}

// ── Dispose ──
try { await hooks.dispose() } catch {}

// ── Summary ──
const elapsed = Date.now() - sectionStart
const elapsedSec = (elapsed / 1000).toFixed(1)

console.log(`\n${B}═══════════════════════════════════════════${RST}`)
console.log(`${B}       TOOL STRESS TEST RESULTS${RST}`)
console.log(`${B}═══════════════════════════════════════════${RST}`)
console.log(`  ${G}${passed} passed${RST}  ${failed > 0 ? R : G}${failed} failed${RST}  in ${elapsedSec}s`)

if (failed === 0) {
  console.log(`\n${G}ALL TOOL STRESS TESTS PASSED${RST}`)
} else {
  console.log(`\n${R}── Failed Tests ──${RST}`)
  for (const f of failedTests) {
    console.log(`  ${R}✗${RST} ${f.section ? f.section + " \u2192 " : ""}${f.msg}`)
  }
}
process.exit(failed > 0 ? 1 : 0)
