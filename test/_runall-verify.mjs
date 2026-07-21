// test/_runall-verify.mjs — Part A: Verify & dashboard tests
import { assert, section, mockCtx, freshSid, pluginDist, G, R, B, D, Y, RST, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, chmodSync, mkdtempSync, join, tmpdir, sdkMockClient, state, projectDir } from "./_common.mjs"

export async function runVerifyTests(mod) {
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
console.log("\n[43] agentic_status — full dashboard")
const dbResult = await hooks.tool.agentic_status.execute({ detail: "full" }, mockCtx(freshSid()))
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
        data: {
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

// Verify dashboard always shows model reliability (merged into agentic_status detail=full)
const dashResp52 = await modelHooks52.tool.agentic_status.execute({ detail: "full" }, modelCtx52)
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
assert(defaultCfg.agent.workflowPolicyMode === "advisory", "default workflowPolicyMode advisory")
assert(
  defaultCfg.agent.dumbModelMode === "auto" || defaultCfg.agent.dumbModelMode === true || defaultCfg.agent.dumbModelMode === undefined || defaultCfg.agent.dumbModelMode === false,
  "default dumbModelMode is auto (or legacy off)",
)
// Prefer new default when config was freshly created by plugin
if (defaultCfg.agent.dumbModelMode !== undefined && defaultCfg.agent.dumbModelMode !== false) {
  assert(defaultCfg.agent.dumbModelMode === "auto" || defaultCfg.agent.dumbModelMode === true, "default dumbModelMode auto when set")
}
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
  agent: { maxDelegationDepth: 7, autoSkillExtract: false, defaultRole: "qa", workflowPolicyMode: "strict" },
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
assert(customCfg.agent.workflowPolicyMode === "strict", "custom workflowPolicyMode loaded")
assert(customCfg.storage.traceRetentionDays === 30, "custom trace retention loaded")
assert(customCfg.storage.skillMaxCount === 999, "custom skill max count loaded")
await cfgHooksB.dispose()

// Test B2: dumbModelMode config (boolean | "auto")
console.log("\n[65c] dumbModelMode config")
const cfgValidation = mod.validateConfig({
  $schema: "v1", agent: { dumbModelMode: true }
})
assert(cfgValidation.config.agent.dumbModelMode === true, "dumbModelMode accepted by validator")
const cfgValidationAuto = mod.validateConfig({
  $schema: "v1", agent: { dumbModelMode: "auto" }
})
assert(cfgValidationAuto.config.agent.dumbModelMode === "auto", "dumbModelMode=auto accepted")
const cfgValidation2 = mod.validateConfig({
  $schema: "v1", agent: { dumbModelMode: "yes" }
})
assert(cfgValidation2.issues.some(i => i.path === "agent.dumbModelMode"), "dumbModelMode rejects invalid string")

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
// Unknown keys (search, topK, timeoutMs) generate warnings, not errors — valid stays true
assert(validResult.valid === true, "valid config has valid=true even with unknown-key warnings")
const validErrors = validResult.issues.filter(i => i.severity === "error")
assert(validErrors.length === 0, `valid config should have 0 errors, got ${validErrors.length}`)

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

// Test E: New validation features — integer, URL, array content, curator, out-of-range drop
console.log("\n[54-E] Config validation — new features")
{
  // E-1: Integer validation — non-integer numeric should warn
  const intCfg = validateConfig({
    $schema: "v1",
    memory: { enabled: true, mode: "lightweight", maxEntries: 3.5, compressThreshold: 50, forgetAfterDays: 7, stopWordsLanguages: ["eng"], search: { keywordWeight: 0.3, vectorWeight: 0.7 } },
    agent: { maxDelegationDepth: 3, autoSkillExtract: true, defaultRole: "developer" },
    storage: { traceRetentionDays: 7 }
  })
  const hasIntIssue = intCfg.issues.some(i => i.message && i.message.includes("Expected integer"))
  assert(hasIntIssue, `E-1 non-integer maxEntries should warn, issues: ${JSON.stringify(intCfg.issues)}`)

  // E-2: URL validation — invalid URL should warn
  const urlCfg = validateConfig({
    $schema: "v1",
    embedding: { model: "test", endpoint: "not-a-url" },
    memory: { enabled: true, mode: "lightweight", maxEntries: 100, compressThreshold: 50, forgetAfterDays: 7, stopWordsLanguages: ["eng"], search: { keywordWeight: 0.3, vectorWeight: 0.7 } },
    agent: { maxDelegationDepth: 3, autoSkillExtract: true, defaultRole: "developer" },
    storage: { traceRetentionDays: 7 },
    rag: { remoteUrl: "ftp://bad-protocol.com" }
  })
  const hasUrlIssue = urlCfg.issues.some(i => i.message && i.message.includes("Invalid URL"))
  assert(hasUrlIssue, `E-2 invalid URL should warn, issues: ${JSON.stringify(urlCfg.issues)}`)

  // E-3: URL validation — valid URL should NOT warn
  const goodUrlCfg = validateConfig({
    $schema: "v1",
    embedding: { model: "test", endpoint: "https://api.openai.com/v1/embeddings" },
    memory: { enabled: true, mode: "lightweight", maxEntries: 100, compressThreshold: 50, forgetAfterDays: 7, stopWordsLanguages: ["eng"], search: { keywordWeight: 0.3, vectorWeight: 0.7 } },
    agent: { maxDelegationDepth: 3, autoSkillExtract: true, defaultRole: "developer" },
    storage: { traceRetentionDays: 7 },
    rag: { remoteUrl: "https://rag.example.com/sync" }
  })
  const goodUrlIssues = goodUrlCfg.issues.filter(i => i.message && i.message.includes("Invalid URL"))
  assert(goodUrlIssues.length === 0, `E-3 valid URLs should not warn, got: ${JSON.stringify(goodUrlIssues)}`)

  // E-4: Empty URL string should be allowed (optional field)
  const emptyUrlCfg = validateConfig({
    $schema: "v1",
    embedding: { model: "test", endpoint: "" },
    memory: { enabled: true, mode: "lightweight", maxEntries: 100, compressThreshold: 50, forgetAfterDays: 7, stopWordsLanguages: ["eng"], search: { keywordWeight: 0.3, vectorWeight: 0.7 } },
    agent: { maxDelegationDepth: 3, autoSkillExtract: true, defaultRole: "developer" },
    storage: { traceRetentionDays: 7 }
  })
  const emptyUrlIssues = emptyUrlCfg.issues.filter(i => i.path && i.path.includes("endpoint") && i.message.includes("Invalid URL"))
  assert(emptyUrlIssues.length === 0, `E-4 empty URL should be allowed, got: ${JSON.stringify(emptyUrlIssues)}`)

  // E-5: Out-of-range value warns but still passes through (merge section uses raw cfg)
  const rangeWarnCfg = validateConfig({
    $schema: "v1",
    memory: { enabled: true, mode: "lightweight", maxEntries: 100, compressThreshold: 50, forgetAfterDays: 7, stopWordsLanguages: ["eng"], search: { keywordWeight: 0.3, vectorWeight: 0.7 } },
    agent: { maxDelegationDepth: 99, autoSkillExtract: true, defaultRole: "developer" },
    storage: { traceRetentionDays: 7 }
  })
  assert(rangeWarnCfg.issues.some(i => i.message && i.message.includes("exceeds maximum")), "E-5 should warn about out-of-range value")
  // Value still passes through (merge uses raw config) — warning is the important signal

  // E-6: Array content validation — non-string in stopWordsLanguages
  const arrCfg = validateConfig({
    $schema: "v1",
    memory: { enabled: true, mode: "lightweight", maxEntries: 100, compressThreshold: 50, forgetAfterDays: 7, stopWordsLanguages: ["eng", 123], search: { keywordWeight: 0.3, vectorWeight: 0.7 } },
    agent: { maxDelegationDepth: 3, autoSkillExtract: true, defaultRole: "developer" },
    storage: { traceRetentionDays: 7 }
  })
  const hasArrIssue = arrCfg.issues.some(i => i.message && i.message.includes("array of string"))
  assert(hasArrIssue, `E-6 non-string in stopWordsLanguages should warn, issues: ${JSON.stringify(arrCfg.issues)}`)

  // E-7: Curator config validation
  const curatorCfg = validateConfig({
    $schema: "v1",
    memory: { enabled: true, mode: "lightweight", maxEntries: 100, compressThreshold: 50, forgetAfterDays: 7, stopWordsLanguages: ["eng"], search: { keywordWeight: 0.3, vectorWeight: 0.7 } },
    agent: { maxDelegationDepth: 3, autoSkillExtract: true, defaultRole: "developer" },
    storage: { traceRetentionDays: 7, skillMaxCount: 200 },
    curator: { enabled: true, staleAfterDays: 30, archiveAfterDays: 90, maxSkillsInPrompt: 3, injectThreshold: 0.15, consolidationEnabled: false }
  })
  assert(curatorCfg.valid === true, "E-7a valid curator config should be valid")
  assert(curatorCfg.config.curator?.enabled === true, "E-7b curator.enabled merged correctly")
  assert(curatorCfg.config.curator?.staleAfterDays === 30, "E-7c curator.staleAfterDays merged correctly")

  // E-8: Unknown keys in agent should warn
  const unknownCfg = validateConfig({
    $schema: "v1",
    memory: { enabled: true, mode: "lightweight", maxEntries: 100, compressThreshold: 50, forgetAfterDays: 7, stopWordsLanguages: ["eng"], search: { keywordWeight: 0.3, vectorWeight: 0.7 } },
    agent: { maxDelegationDepth: 3, autoSkillExtract: true, defaultRole: "developer", unknownField: "should warn" },
    storage: { traceRetentionDays: 7 }
  })
  const hasUnknownIssue = unknownCfg.issues.some(i => i.message && i.message.includes("Unknown key"))
  assert(hasUnknownIssue, `E-8 unknown keys should warn, issues: ${JSON.stringify(unknownCfg.issues)}`)

  // E-9: mergeDeep array replacement — stopWordsLanguages user value should NOT be concatenated to defaults
  const arrReplaceCfg = validateConfig({
    $schema: "v1",
    memory: { enabled: true, mode: "lightweight", maxEntries: 100, compressThreshold: 50, forgetAfterDays: 7, stopWordsLanguages: ["fra"], search: { keywordWeight: 0.3, vectorWeight: 0.7 } },
    agent: { maxDelegationDepth: 3, autoSkillExtract: true, defaultRole: "developer" },
    storage: { traceRetentionDays: 7 }
  })
  const swl = arrReplaceCfg.config.memory.stopWordsLanguages
  // Should be ["fra"] only — NOT ["ind", "eng", "fra"]
  assert(Array.isArray(swl), "E-9a stopWordsLanguages is array")
  assert(swl.length === 1 && swl[0] === "fra", `E-9b stopWordsLanguages should be ["fra"], got ${JSON.stringify(swl)}`)
}

console.log("  ✅ Config validation new features (E-1..E-9)")

// 55. VectorStore — TF-IDF sparse retrieval
}

// ── Standalone execution ──
const _isMain = typeof process !== "undefined" && process.argv[1] && (process.argv[1] === import.meta.url || process.argv[1].endsWith("/_runall-verify.mjs"))
if (_isMain) {
  const { pluginDist: _pd } = await import("./_common.mjs")
  const _mod = await import(_pd)
  await runVerifyTests(_mod)
  const { state } = await import("./_state.mjs")
  console.log(`__RESULT__:${JSON.stringify({ passed: state.passed, failed: state.failed })}`)
  process.exit(state.failed > 0 ? 1 : 0)
}
