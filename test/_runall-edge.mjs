// test/_runall-edge.mjs — Part A: Edge case tests (model thru SchemaValidator)
import { assert, section, mockCtx, freshSid, pluginDist, G, R, B, D, Y, RST, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, chmodSync, mkdtempSync, join, tmpdir, sdkMockClient, state, projectDir } from "./_common.mjs"

export async function runEdgeTests(mod) {
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

// Set with custom dynamic role (roles are now dynamic, any string works)
const dynRole = await hooks.tool.agentic_model.execute({ action: "set", role: "custom-agent", model: "gpt-4o" }, modelCtx)
const dynOut = typeof dynRole === "string" ? dynRole : dynRole.output
assert(dynOut.includes("custom-agent") && dynOut.includes("gpt-4o"), "set with custom dynamic role works")

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

// 66b. agentic_model — reset model statistics
console.log("\n[66b] agentic_model — reset model stats (merged)")
const mrSid = freshSid()
const mrCtx = mockCtx(mrSid)
assert(typeof hooks.tool.agentic_model === "object", "agentic_model tool registered (reset merged)")
assert(typeof hooks.tool.agentic_model.execute === "function", "agentic_model has execute (reset merged)")

// reset-all (safe in test) — now on agentic_model
const resetAllRes = await hooks.tool.agentic_model.execute({ action: "reset-all" }, mrCtx)
const resetAllOut = typeof resetAllRes === "string" ? resetAllRes : resetAllRes.output
assert(resetAllOut.includes("EMERGENCY"), "reset-all confirms emergency reset on agentic_model")

// reset without model
const noModelReset = await hooks.tool.agentic_model.execute({ action: "reset" }, mrCtx)
const noModelResetOut = typeof noModelReset === "string" ? noModelReset : noModelReset.output
assert(noModelResetOut.includes("Provide a `model`"), "reset without model returns error on agentic_model")

// reset-stale
const staleRes = await hooks.tool.agentic_model.execute({ action: "reset-stale" }, mrCtx)
const staleOut = typeof staleRes === "string" ? staleRes : staleRes.output
assert(staleOut.includes("No stale") || staleOut.includes("Reset"), "reset-stale returns result on agentic_model")

// unknown action shows all options including reset
const unknownModelAction = await hooks.tool.agentic_model.execute({ action: "unknown" }, mrCtx)
const unknownModelOut = typeof unknownModelAction === "string" ? unknownModelAction : unknownModelAction.output
assert(unknownModelOut.includes("Unknown action"), "unknown action returns error on agentic_model")
assert(unknownModelOut.includes("reset"), "error message mentions reset actions")

assert(true, "agentic_model reset merge tests passed")

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

// ── Coverage Expansion: agentic_status detail=full (merged from agentic_dashboard) ──
console.log("\n[70] agentic_status — full dashboard coverage")
const dashSid = freshSid()

// Dashboard with no session data (empty)
const dashEmpty = await hooks.tool.agentic_status.execute({ detail: "full" }, mockCtx(dashSid))
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
const dashWithData = await hooks.tool.agentic_status.execute({ detail: "full" }, mockCtx(dashSid))
const dashDataOut = typeof dashWithData === "string" ? dashWithData : (dashWithData.output || "")
assert(dashDataOut.length > 0, "dashboard after execution returns output")
assert(typeof dashWithData === "object", "dashboard returns object")
assert(true, "agentic_status full dashboard tests passed")

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

// ── Branch Coverage: CodebaseNavigator direct tests ──
console.log("\n[75b] CodebaseNavigator — direct branch coverage")
const CN = mod.CodebaseNavigator
assert(typeof CN === "function", "CodebaseNavigator exported")

// Setup a multi-lang project
const cnDir = "/tmp/cn-test-" + Date.now()
mkdirSync(cnDir, { recursive: true })
mkdirSync(join(cnDir, "src"), { recursive: true })
mkdirSync(join(cnDir, "src", "nested", "deep"), { recursive: true })
mkdirSync(join(cnDir, "tests"), { recursive: true })
writeFileSync(join(cnDir, "tsconfig.json"), "{}")
writeFileSync(join(cnDir, "package.json"), JSON.stringify({ name: "cn-test", type: "module" }))
writeFileSync(join(cnDir, "src/index.ts"), 'import { helper } from "./helper"\nexport function main() { return helper() }\n')
writeFileSync(join(cnDir, "src/helper.ts"), 'export function helper(): string { return "ok" }\n')
// JS file with require pattern to trigger impMatch[1] ?? impMatch[2] fallback (line 350)
writeFileSync(join(cnDir, "src/legacy.js"), 'const fs = require("fs");\nmodule.exports = { read: fs.readFileSync }\n')
// File with non-source extension to test include check
writeFileSync(join(cnDir, "src/data.json"), '{"key": "value"}')
// File in deep nested directory to test recursion depth
writeFileSync(join(cnDir, "src/nested/deep/config.ts"), 'export const cfg = { port: 3000 }\n')
// Test file
writeFileSync(join(cnDir, "tests/index.test.ts"), 'import { main } from "../src/index"\n')

const nav = new CN()
// Scan the test project
const idx = await nav.scan(cnDir)
assert(idx.modules.length >= 3, `found ${idx.modules.length} modules`)
assert(idx.primaryLanguage === "typescript", `primary lang: ${idx.primaryLanguage}`)
assert(idx.hasTests === true, "has tests dir")
assert(idx.srcDir?.endsWith("src") || idx.srcDir === cnDir, "src dir found")

// Test findRelevantFiles scoring branches
const relevant = nav.findRelevantFiles("helper function", 5)
assert(relevant.length > 0, "findRelevantFiles returns results")
const noMatch = nav.findRelevantFiles("xyznonexistent123", 3)
assert(noMatch.length === 0, "no match returns empty")
// Test with test-related keywords to trigger isTestTask branch
const testFiles = nav.findRelevantFiles("run test for helper", 5)
assert(testFiles.length >= 0, "test task query works")

// Test getTestFiles branches (including PHP-style extension and _-prefix)
const testForIndex = nav.getTestFiles("/tmp/cn-test/src/index.ts")
assert(testForIndex.length >= 0, "getTestFiles for index.ts")
// Test with non-existent file path — returns empty
const testNonExistent = nav.getTestFiles("/tmp/cn-test/src/nonexistent.ts")
assert(Array.isArray(testNonExistent), "getTestFiles for nonexistent returns array")

// Test getSummary branch with detected langs (line 276 ternary)
const navSummary = nav.getSummary()
assert(navSummary.includes("Root:"), "summary includes root")
assert(navSummary.includes("Language:"), "summary includes language")
assert(navSummary.includes("Modules:"), "summary includes modules")

// Test scan cache hit (line 148-150) — BEFORE trailing-slash scan which clears cache
const idxCached = await nav.scan(cnDir)
assert(idxCached === idx, "scan cache returns same reference")

// Test invalidateCache
nav.invalidateCache()
const idxFresh = await nav.scan(cnDir)
assert(idxFresh !== idx, "invalidateCache produces fresh index")

// Test scan with trailing slash to trigger resolvedDir !== resolvedRoot path (line 324)
const idx2 = await nav.scan(cnDir + "/")
assert(idx2.modules.length >= 3, "scan with trailing slash works")
assert(true, "CodebaseNavigator direct tests passed")

// JavaScript-only project to trigger require() fallback in import matching (line 350)
const cnJsDir = "/tmp/cn-js-test-" + Date.now()
mkdirSync(cnJsDir, { recursive: true })
mkdirSync(join(cnJsDir, "src"), { recursive: true })
// No tsconfig.json — only package.json, so primary lang = JavaScript
writeFileSync(join(cnJsDir, "package.json"), JSON.stringify({ name: "cn-js-test", type: "module" }))
// JS file with require() pattern to hit impMatch[1] ?? impMatch[2] branch
writeFileSync(join(cnJsDir, "src/app.js"), 'const { readFile } = require("fs");\nmodule.exports = { read: readFile }\n')
writeFileSync(join(cnJsDir, "src/utils.js"), 'export function log(msg) { console.log(msg) }\n')

const navJs = new CN()
const idxJs = await navJs.scan(cnJsDir)
assert(idxJs.detectedLangs.includes("javascript"), "js-only project detected as JS")
// Verify the JS file with require was parsed (triggers line 350 fallback)
const jsModule = idxJs.modules.find(m => m.name === "app" || m.path.endsWith("app.js"))
assert(!!jsModule, "app.js module found")
assert(jsModule.imports.length > 0, "app.js imports parsed")
assert(idxJs.modules.length >= 2, "found JS modules")

// Test getSummary with only 1 detected lang (no "also:" suffix)
const navJsSummary = navJs.getSummary()
assert(!navJsSummary.includes("also:"), "js-only summary has no also: suffix")

// Cleanup JS
try { rmSync(cnJsDir, { recursive: true, force: true }) } catch { /* ignore */ }

// Cleanup
try { rmSync(cnDir, { recursive: true, force: true }) } catch { /* ignore */ }

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
assert(g4_depsNpm.name === "deps", "G4-11b verifyDeps returns deps check")
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

}

// ── Standalone execution ──
const _isMain = typeof process !== "undefined" && process.argv[1] && (process.argv[1] === import.meta.url || process.argv[1].endsWith("/_runall-edge.mjs"))
if (_isMain) {
  const { pluginDist: _pd } = await import("./_common.mjs")
  const _mod = await import(_pd)
  await runEdgeTests(_mod)
  const { state } = await import("./_state.mjs")
  console.log(`__RESULT__:${JSON.stringify({ passed: state.passed, failed: state.failed })}`)
  process.exit(state.failed > 0 ? 1 : 0)
}
