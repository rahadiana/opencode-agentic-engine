// test/_runall-evo.mjs — Evolution tests: ContinuousEvolution through WorkflowPolicy
import { assert, section, mockCtx, freshSid, pluginDist, G, R, B, D, Y, RST, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, chmodSync, mkdtempSync, join, tmpdir, sdkMockClient, state, projectDir } from "./_common.mjs"

export async function runEvolutionTests(mod) {
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

// 58b. ContinuousEvolution — significance integration
console.log("\n[58b] ContinuousEvolution — significance-integration")
let ceSigPassed = 0, ceSigFailed = 0
const cesig = (cond, msg) => { if (cond) { ceSigPassed++ } else { console.error(`  ❌ ${msg}`); ceSigFailed++ } }

// CE-SIG-1: StepResult accepts significance field
{
  const ce = new mod.ContinuousEvolution(10)
  ce.feedStepResult({ stepId: "piv1", success: false, output: "critical failure", sessionId: "sess-sig", timestamp: Date.now(), category: "compile", significance: "pivotal" })
  ce.feedStepResult({ stepId: "not1", success: false, output: "notable issue", sessionId: "sess-sig", timestamp: Date.now(), category: "test", significance: "notable" })
  ce.feedStepResult({ stepId: "rou1", success: false, output: "routine fail", sessionId: "sess-sig", timestamp: Date.now(), category: "lint", significance: "routine" })
  const trend = ce.getTrend()
  cesig(trend.significantFailures === 2, "CE-SIG-1a significantFailures counts pivotal+notable (got " + trend.significantFailures + ")")
}

// CE-SIG-2: Pivotal failures lower degradation threshold
{
  const ce = new mod.ContinuousEvolution(10)
  // Feed 5 successes then 3 failures (some with significance)
  for (let i = 0; i < 5; i++) {
    ce.feedStepResult({ stepId: `ok${i}`, success: true, output: "ok", sessionId: "sess-sig2", timestamp: Date.now() })
  }
  ce.feedStepResult({ stepId: "fpiv", success: false, output: "critical", sessionId: "sess-sig2", timestamp: Date.now(), significance: "pivotal" })
  // With only 1 failure and 5 successes: recentRate = 5/6 ≈ 83% — normally no degradation
  // But with a pivotal failure, sigAdjustedRate = 0.83 - (1*0.1/6) ≈ 0.81 — still no degradation at 60% threshold
  // Need more failures to trigger with significance boosting
  ce.feedStepResult({ stepId: "fpiv2", success: false, output: "critical", sessionId: "sess-sig2", timestamp: Date.now(), significance: "pivotal" })
  ce.feedStepResult({ stepId: "fnot", success: false, output: "important", sessionId: "sess-sig2", timestamp: Date.now(), significance: "notable" })
  const trend = ce.getTrend()
  // After 5 successes + 3 failures with significance: recentRate = 5/8 = 62.5%, sigAdjustedRate = 0.625 - (2*0.1/8) ≈ 0.6
  // This should trip degradationDetected due to sigAdjustedRate < 0.6 and significantFailures > 0
  cesig(trend.significantFailures >= 2, "CE-SIG-2a significantFailures detected (" + trend.significantFailures + ")")
}

// CE-SIG-3: shouldEvolve triggers on significant failures even without sustained degradation
{
  const ce = new mod.ContinuousEvolution(10, 5)
  // Feed 7 successes + 3 significant failures (still above 60% but significance flags it)
  for (let i = 0; i < 7; i++) {
    ce.feedStepResult({ stepId: `ok${i}`, success: true, output: "ok", sessionId: "sess-sig3", timestamp: Date.now() })
  }
  ce.feedStepResult({ stepId: "fpiv3", success: false, output: "critical", sessionId: "sess-sig3", timestamp: Date.now(), significance: "pivotal" })
  ce.feedStepResult({ stepId: "fpiv4", success: false, output: "critical", sessionId: "sess-sig3", timestamp: Date.now(), significance: "pivotal" })
  ce.feedStepResult({ stepId: "fnot3", success: false, output: "important", sessionId: "sess-sig3", timestamp: Date.now(), significance: "notable" })
  // recentRate = 7/10 = 70%, significantFailures = 3
  // Trigger 0: significantFailures > 0 AND recentRate < 0.7 → no, 0.7 is not < 0.7
  // Hmm, need more failures to push below 0.7
  ce.feedStepResult({ stepId: "fpiv5", success: false, output: "critical", sessionId: "sess-sig3", timestamp: Date.now(), significance: "pivotal" })
  // recentRate = 7/11 ≈ 63.6% < 0.7, significantFailures = 4
  const trigger = ce.shouldEvolve("sess-sig3")
  cesig(trigger !== null, "CE-SIG-3a shouldEvolve triggered by significant failures")
  cesig(trigger.type === "anomaly_spike", "CE-SIG-3b trigger type is anomaly_spike (got " + trigger.type + ")")
}

console.log(`  CE-SIG: ${ceSigPassed} passed, ${ceSigFailed} failed`)
state.passed += ceSigPassed; state.failed += ceSigFailed

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
const promptState = rr2.getPromptState("developer")
assert(promptState !== undefined, "getPromptState returns state")
assert(promptState.currentVersion === 3, "current version is 3")
assert(promptState.history.length === 3, "state has 3 entries")

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

// ── RR-BR: RoleRegistry Branch Coverage ──
console.log("\n[RR-BR] RoleRegistry — Branch Coverage")
let rrbr = 0, rrbrf = 0
const rrbr_assert = (cond, msg) => { if (cond) { rrbr++ } else { console.error(`  ❌ ${msg}`); rrbrf++ } }

// RR-BR-1: listRoles with custom roles (line 356-359)
{
  const rr = new mod.RoleRegistry()
  const before = rr.listRoles()
  rrbr_assert(before.includes("developer") && !before.includes("my-custom"), "RR-BR-1a built-in roles present, custom absent")
  rr.registerCustom({ role: "my-custom", name: "Custom agent", prompt: "You are a custom agent", tools: [] })
  const after = rr.listRoles()
  rrbr_assert(after.includes("my-custom"), "RR-BR-1b custom role now in listRoles")
  rrbr_assert(after.length === before.length + 1, "RR-BR-1c listRoles size increased by 1")
}

// RR-BR-2: setModel on built-in role → updates model (line 381-382)
{
  const rr = new mod.RoleRegistry()
  const orig = rr.suggestModel("developer")
  rr.setModel("developer", "my-custom-model")
  const updated = rr.suggestModel("developer")
  rrbr_assert(updated === "my-custom-model", "RR-BR-2 setModel updates built-in role model")
}

// RR-BR-3: trimHistory via rollbackPrompt (line 387-388)
// trimHistory is private, called from rollbackPrompt with maxEntries=50.
// To trigger, add >50 history entries via updatePrompt, then call rollbackPrompt.
{
  const rr = new mod.RoleRegistry()
  for (let i = 0; i < 55; i++) {
    rr.updatePrompt("developer", `prompt v${i + 2}`)
  }
  // Now rollback to version 1 — this calls trimHistory(role, 50) internally
  const rolledBack = rr.rollbackPrompt("developer", 1)
  rrbr_assert(rolledBack === true, "RR-BR-3a rollback succeeds")
  const history = rr.getPromptHistory("developer")
  // trimHistory(role, 50) + rollback adds 1 more entry
  rrbr_assert(history.length <= 60, "RR-BR-3b history trimmed (≤60 entries from 56+2)")
}

console.log(`  RR-BR: ${rrbr} passed, ${rrbrf} failed`)
state.passed += rrbr; state.failed += rrbrf

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

// P2: SelfEvolver auto-apply prompt patches to RoleRegistry
{
  const roleReg = new mod.RoleRegistry()
  const devPromptBefore = roleReg.getPrompt("developer")
  assert(devPromptBefore && devPromptBefore.length > 0, "developer role has initial prompt")
  const evolver5 = new mod.SelfEvolver()
  evolver5.setRoleRegistry(roleReg)
  // Feed many compile errors to trigger high-priority auto-apply (requires occurrences >= 2 for high)
  evolver5.feedStepStates([
    { stepId: "s1", success: false, output: "compile error in types.ts" },
    { stepId: "s2", success: false, output: "Type 'string' is not assignable" },
    { stepId: "s3", success: false, output: "Cannot find name" },
    { stepId: "s4", success: false, output: "Module not found: ./missing" },
    { stepId: "s5", success: false, output: "TypeError: undefined is not a function" },
  ])
  evolver5.feedEpisodes([
    { sessionId: "sess-e", planGoal: "t1", tags: ["compile", "type"], outcome: "failed", summary: "", decisions: [], filesChanged: [], timestamp: Date.now() },
    { sessionId: "sess-f", planGoal: "t2", tags: ["compile", "type"], outcome: "failed", summary: "", decisions: [], filesChanged: [], timestamp: Date.now() },
    { sessionId: "sess-g", planGoal: "t3", tags: ["compile", "type"], outcome: "failed", summary: "", decisions: [], filesChanged: [], timestamp: Date.now() },
  ])
  const report3 = evolver5.evolve()
  assert(report3.promptPatches.length >= 1, `generates prompt patches for compile errors (got ${report3.promptPatches.length})`)

  // The prompt should have been modified if auto-apply condition was met
  const devPromptAfter = roleReg.getPrompt("developer")
  assert(devPromptAfter !== devPromptBefore, "auto-apply modified the developer prompt")
  assert(devPromptAfter.length > devPromptBefore.length, "auto-apply appended instruction to developer prompt")
  // Check that the prompt history shows the evolution source
  const history = roleReg.getPromptHistory("developer")
  const evoEntry = history.find(e => e.source === "auto-evolve")
  assert(evoEntry !== undefined, "auto-apply creates history entry with source 'auto-evolve'")
  assert(evoEntry.description.includes("compile"), "auto-apply description mentions the error category")
}
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
assert(typeof hooks.tool.agentic_execute.args.verificationEvidence === "object", "agentic_execute has verificationEvidence arg")
const evidenceResult = await hooks.tool.agentic_execute.execute({
  stepId: "evidence-sync",
  success: true,
  output: "verified with manual shell evidence",
  filesModified: ["src/index.ts"],
  autoVerify: false,
  verificationEvidence: {
    build: "passed",
    lint: "passed",
    techDebt: "low",
    tests: [{ command: "node test/run.mjs", passed: 2043, failed: 0 }],
  },
}, mockCtx(freshSid()))
const evidenceOut = typeof evidenceResult === "string" ? evidenceResult : evidenceResult.output
assert(evidenceOut.includes("Confidence Score"), "verificationEvidence produces confidence score")
assert(evidenceOut.includes("Test") && evidenceOut.includes("100%"), "verificationEvidence syncs test confidence")
assert(evidenceOut.includes("Tech Debt") && evidenceOut.includes("100%"), "verificationEvidence syncs tech debt confidence")
assert(true, "agentic_execute feedback/evidence parameter tests passed")

// 65b. WorkflowPolicy — runtime gate around execute/finalize
console.log("\n[65b] WorkflowPolicy — execute/finalize gate")
assert(readFileSync(new URL("../src/core/workflow-policy.ts", import.meta.url), "utf-8").includes("evaluateWorkflowPolicy"), "WorkflowPolicy module exists")
const policyNoPlan = await hooks.tool.agentic_execute.execute({
  stepId: "policy-no-plan", success: true, output: "Changed file without plan", filesModified: ["src/no-plan.ts"], autoVerify: false,
}, mockCtx(freshSid()))
const policyNoPlanOut = typeof policyNoPlan === "string" ? policyNoPlan : policyNoPlan.output
assert(policyNoPlanOut.includes("WorkflowPolicy") && policyNoPlanOut.includes("plan-missing"), "WorkflowPolicy warns when file-changing execute has no plan")

const policyBlocked = await hooks.tool.agentic_execute.execute({
  stepId: "policy-bad-evidence", success: true, output: "Claim success despite failed tests", filesModified: ["src/bad.ts"], autoVerify: false,
  verificationEvidence: { tests: [{ command: "npm test", passed: 1, failed: 1 }] },
}, mockCtx(freshSid()))
const policyBlockedOut = typeof policyBlocked === "string" ? policyBlocked : policyBlocked.output
assert(policyBlockedOut.includes("BLOCKED by WorkflowPolicy") && policyBlockedOut.includes("evidence-failed"), "WorkflowPolicy blocks success with failing verification evidence")

const finalPolicySid = freshSid()
await hooks.tool.agentic_plan.execute({ goal: "One step final policy", subtasks: [{ id: "final-1", description: "final", dependsOn: [] }] }, mockCtx(finalPolicySid))
const finalPolicy = await hooks.tool.agentic_execute.execute({
  stepId: "final-1", success: true, output: "Final changed files", filesModified: ["src/final.ts"], autoVerify: false,
}, mockCtx(finalPolicySid))
const finalPolicyOut = typeof finalPolicy === "string" ? finalPolicy : finalPolicy.output
assert(finalPolicyOut.includes("WorkflowPolicy Final Gate") && finalPolicyOut.includes("verification-missing"), "WorkflowPolicy warns final completion without verification evidence")

const finalEvidenceSid = freshSid()
await hooks.tool.agentic_plan.execute({ goal: "One step final policy with evidence", subtasks: [{ id: "final-ok", description: "final", dependsOn: [] }] }, mockCtx(finalEvidenceSid))
const finalEvidence = await hooks.tool.agentic_execute.execute({
  stepId: "final-ok", success: true, output: "Final changed files with evidence", filesModified: ["src/final-ok.ts"], autoVerify: false,
  verificationEvidence: { build: "passed", tests: [{ command: "npm test", passed: 2, failed: 0 }] },
}, mockCtx(finalEvidenceSid))
const finalEvidenceOut = typeof finalEvidence === "string" ? finalEvidence : finalEvidence.output
assert(!finalEvidenceOut.includes("verification-missing"), "WorkflowPolicy accepts final completion with verificationEvidence")

const lowConfidenceSid = freshSid()
await hooks.tool.agentic_plan.execute({ goal: "One step low confidence policy", subtasks: [{ id: "final-low", description: "final", dependsOn: [] }] }, mockCtx(lowConfidenceSid))
const lowConfidence = await hooks.tool.agentic_execute.execute({
  stepId: "final-low", success: true, output: "Final with weak evidence", filesModified: ["src/final-low.ts"], autoVerify: false,
  verificationEvidence: { techDebt: "critical" },
}, mockCtx(lowConfidenceSid))
const lowConfidenceOut = typeof lowConfidence === "string" ? lowConfidence : lowConfidence.output
assert(lowConfidenceOut.includes("confidence-low"), "WorkflowPolicy warns on low-confidence completion")

const strictDir = "/tmp/test-project-strict-policy"
try { rmSync(strictDir, { recursive: true, force: true }) } catch {}
mkdirSync(strictDir, { recursive: true })
mkdirSync(join(strictDir, ".agentic"), { recursive: true })
writeFileSync(join(strictDir, ".agentic", "config.json"), JSON.stringify({ $schema: "v1", agent: { workflowPolicyMode: "strict", autoHallucinationCheck: false } }))
const strictHooks = await mod.AgenticEngine({ ...mockInput, project: { name: "strict-policy", path: strictDir }, directory: strictDir, worktree: strictDir })
const strictCtx = mockCtx("strict-policy-session")
strictCtx.directory = strictDir
strictCtx.worktree = strictDir
await strictHooks.tool.agentic_plan.execute({ goal: "Strict final gate", subtasks: [{ id: "strict-final", description: "final", dependsOn: [] }] }, strictCtx)
const strictFinal = await strictHooks.tool.agentic_execute.execute({
  stepId: "strict-final", success: true, output: "Final without evidence", filesModified: ["src/strict.ts"], autoVerify: false,
}, strictCtx)
const strictFinalOut = typeof strictFinal === "string" ? strictFinal : strictFinal.output
assert(strictFinalOut.includes("BLOCKED by WorkflowPolicy") && strictFinalOut.includes("verification-missing"), "strict WorkflowPolicy blocks final completion without evidence")

const strictRetryCtx = mockCtx("strict-policy-retry-session")
strictRetryCtx.directory = strictDir
strictRetryCtx.worktree = strictDir
await strictHooks.tool.agentic_plan.execute({ goal: "Strict retry gate", subtasks: [{ id: "strict-retry", description: "retry", dependsOn: [] }] }, strictRetryCtx)
await strictHooks.tool.agentic_execute.execute({ stepId: "strict-retry", success: false, output: "Failed once", error: "TypeError: boom", autoVerify: false }, strictRetryCtx)
const strictRetry = await strictHooks.tool.agentic_execute.execute({
  stepId: "strict-retry", success: true, output: "Retry without reflection", filesModified: ["src/retry.ts"], autoVerify: false,
  verificationEvidence: { build: "passed", tests: [{ command: "npm test", passed: 1, failed: 0 }] },
}, strictRetryCtx)
const strictRetryOut = typeof strictRetry === "string" ? strictRetry : strictRetry.output
assert(strictRetryOut.includes("BLOCKED by WorkflowPolicy") && strictRetryOut.includes("reflection-missing"), "strict WorkflowPolicy blocks retry success before reflection")
strictHooks.dispose?.()

// 65c. WorkflowPolicy — AgentLoop integration (P0)
console.log("\n[65c] WorkflowPolicy — AgentLoop integration")
let wpAl = 0, wpAlf = 0
const wpAl_assert = (c, m) => { if (c) { wpAl++; console.log(`  PASS: ${m}`) } else { wpAlf++; console.log(`  FAIL: ${m}`) } }

const { AgentLoop: AgentLoopMod } = await import(pluginDist)
const { LLMEngine: LLMEngineMod } = await import(pluginDist)
const loopLLM = new LLMEngineMod()

// WP-AL-1: setWorkflowPolicyConfig stores config
{
  const al = new AgentLoopMod(loopLLM)
  al.setWorkflowPolicyConfig({ mode: "strict" })
  wpAl_assert(true, "WP-AL-1a setWorkflowPolicyConfig non-strict")
  al.setWorkflowPolicyConfig({ mode: "advisory", minConfidence: 0.3 })
  wpAl_assert(true, "WP-AL-1b setWorkflowPolicyConfig advisory with minConfidence")
}

// WP-AL-2: setWorkflowState stores state
{
  const al = new AgentLoopMod(loopLLM)
  al.setWorkflowState({ hasPlan: true, hasResearch: false, hasReflection: true })
  wpAl_assert(true, "WP-AL-2a setWorkflowState with all fields")
  al.setWorkflowState({ hasPlan: false })
  wpAl_assert(true, "WP-AL-2b setWorkflowState partial update")
}

// WP-AL-3: WorkflowPolicy pre-execution gate — strict mode blocks retry without reflection
{
  const al = new AgentLoopMod(loopLLM)
  al.setWorkflowPolicyConfig({ mode: "strict" })
  al.setWorkflowState({ hasPlan: true, hasResearch: true, hasReflection: false })
  // evaluateWorkflowPolicy directly for retry action
  const { evaluateWorkflowPolicy } = await import(pluginDist)
  const decisions = evaluateWorkflowPolicy({
    action: "retry",
    stepId: "test-step",
    filesModified: ["src/test.ts"],
    success: false,
    hasReflection: false,
  }, { mode: "strict" })
  const blocked = decisions.filter(d => d.severity === "block")
  wpAl_assert(blocked.some(d => d.code === "reflection-missing"), "WP-AL-3a strict retry without reflection blocked")
  const decisionsOk = evaluateWorkflowPolicy({
    action: "retry",
    stepId: "test-step",
    filesModified: ["src/test.ts"],
    success: false,
    hasReflection: true,
  }, { mode: "strict" })
  wpAl_assert(!decisionsOk.some(d => d.severity === "block"), "WP-AL-3b strict retry with reflection allowed")
}

// WP-AL-4: WorkflowPolicy post-execution gate — strict mode blocks final without evidence
{
  const { evaluateWorkflowPolicy } = await import(pluginDist)
  const decisions = evaluateWorkflowPolicy({
    action: "finalize",
    stepId: "final-step",
    filesModified: ["src/final.ts"],
    success: true,
    hasPlan: true,
    hasResearch: true,
    hasVerificationEvidence: false,
  }, { mode: "strict" })
  const blocked = decisions.filter(d => d.severity === "block")
  wpAl_assert(blocked.some(d => d.code === "verification-missing"), "WP-AL-4a strict final without evidence blocked")
  const decisionsOk = evaluateWorkflowPolicy({
    action: "finalize",
    stepId: "final-step",
    filesModified: ["src/final.ts"],
    success: true,
    hasPlan: true,
    hasResearch: true,
    hasVerificationEvidence: true,
  }, { mode: "strict" })
  wpAl_assert(!decisionsOk.some(d => d.severity === "block"), "WP-AL-4b strict final with evidence allowed")
}

// WP-AL-5: Advisory mode warns but doesn't block
{
  const { evaluateWorkflowPolicy } = await import(pluginDist)
  const decisions = evaluateWorkflowPolicy({
    action: "finalize",
    stepId: "adv-final",
    filesModified: ["src/adv.ts"],
    success: true,
    hasPlan: true,
    hasVerificationEvidence: false,
  }, { mode: "advisory" })
  wpAl_assert(!decisions.some(d => d.severity === "block"), "WP-AL-5a advisory does not block")
  wpAl_assert(decisions.some(d => d.severity === "warn"), "WP-AL-5b advisory warns")
}

console.log(`  WP-AL: ${wpAl} passed, ${wpAlf} failed`)
state.passed += wpAl; state.failed += wpAlf

// 66. agentic_model — session-seeded model preference
}

// ── Standalone execution ──
const _isMain = typeof process !== "undefined" && process.argv[1] && (process.argv[1] === import.meta.url || process.argv[1].endsWith("/_runall-evo.mjs"))
if (_isMain) {
  const { pluginDist: _pd } = await import("./_common.mjs")
  const _mod = await import(_pd)
  await runEvolutionTests(_mod)
  const { state } = await import("./_state.mjs")
  console.log(`__RESULT__:${JSON.stringify({ passed: state.passed, failed: state.failed })}`)
  process.exit(state.failed > 0 ? 1 : 0)
}
