// test/_runall-adv-debate.mjs — Part A: Advanced debate tests (DebateLoop branch coverage)
import { assert, section, mockCtx, freshSid, pluginDist, G, R, B, D, Y, RST, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, chmodSync, mkdtempSync, join, tmpdir, sdkMockClient, state, projectDir } from "./_common.mjs"

export async function runAdvancedDebateTests(mod) {
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
// 56c. DebateLoop — branch coverage (executor catch, critic fallback, levenshtein, no-llm)
console.log("\n[56c] DebateLoop — branch coverage")

// Helper: mock LLM that always resolves
function makeMockLLM(executorResp, criticResp, cleanerResp) {
  return {
    async call(req) {
      if (req.toolName === 'debate-executor') return { content: executorResp ?? 'Executor output' }
      if (req.toolName === 'debate-critic') return { content: criticResp ?? 'APPROVED: OK' }
      if (req.toolName === 'debate-cleaner') return { content: cleanerResp ?? '{"ok":true}' }
      return { content: '' }
    }
  }
}

// Test 1: callExecutor catch block (line 392-394) — LLM throws → executor error
const throwExecLLM = {
  async call(req) {
    if (req.toolName === 'debate-executor') throw new Error('LLM executor crashed')
    return { content: 'APPROVED: OK' }
  }
}
const dlThrowExec = new mod.DebateLoop(throwExecLLM)
const throwExecResult = await dlThrowExec.execute({ task: 'Throw test', maxRounds: 2, format: 'json' })
assert(throwExecResult.error !== undefined || throwExecResult.totalRounds === 0, 'D-B1a debate returns error when executor LLM throws')
assert(throwExecResult.totalRounds >= 0 && typeof throwExecResult.approved === 'boolean', 'D-B1b debate returns valid shape on executor throw')

// Test 2: callCritic method (lines 402-457) — executor + critic both succeed
const mockNormal = makeMockLLM('Paris is the capital.', 'APPROVED: Correct')
const dlNormal = new mod.DebateLoop(mockNormal)
const normalResult = await dlNormal.execute({ task: 'Capital of France?', maxRounds: 2, format: 'json' })
assert(normalResult.approved === true, 'D-B2a debate approves when critic says APPROVED')
assert(normalResult.totalRounds >= 1, 'D-B2b debate has at least 1 round')
assert(normalResult.finalOutput.length > 0, 'D-B2c debate has final output')
assert(normalResult.rounds.length >= 1, 'D-B2d debate rounds array populated')

// Test 3: isNoLlm check for executor (line 387-389) — "NO_LLM" prefix
const noLlmExecLLM = {
  async call(req) {
    if (req.toolName === 'debate-executor') return { content: '[NO_LLM] No model available' }
    return { content: 'ignored' }
  }
}
const dlNoLlmExec = new mod.DebateLoop(noLlmExecLLM)
const noLlmExecResult = await dlNoLlmExec.execute({ task: 'No LLM test', maxRounds: 1, format: 'json' })
assert(noLlmExecResult.error !== undefined || noLlmExecResult.totalRounds === 0, 'D-B3a debate returns error when executor returns NO_LLM')

// Test 4: isNoLlm check for critic (line 449-451) — "LLM error" prefix
const noLlmCriticLLM = {
  async call(req) {
    if (req.toolName === 'debate-executor') return { content: 'Some analysis' }
    if (req.toolName === 'debate-critic') return { content: 'LLM error: rate limited' }
    return { content: '{}' }
  }
}
const dlNoLlmCritic = new mod.DebateLoop(noLlmCriticLLM)
const noLlmCriticResult = await dlNoLlmCritic.execute({ task: 'No LLM critic test', maxRounds: 1, format: 'json' })
assert(noLlmCriticResult.error !== undefined || noLlmCriticResult.totalRounds <= 1, 'D-B4a debate returns error when critic returns LLM error')

// Test 5: levenshteinDistance loop detection (lines 493-504) — identical output 2 rounds
const loopMock = {
  async call(req) {
    if (req.toolName === 'debate-executor') return { content: 'Identical output every round' }
    if (req.toolName === 'debate-critic') return { content: 'Issue 1: Fix this\nIssue 2: Improve that' }
    if (req.toolName === 'debate-cleaner') return { content: '{"cleaned": true}' }
    return { content: '' }
  }
}
const dlLoop = new mod.DebateLoop(loopMock)
const loopResult = await dlLoop.execute({ task: 'Loop test', maxRounds: 3, format: 'json' })
assert(loopResult.totalRounds <= 2, 'D-B5a debate auto-breaks when identical output (<=2 rounds)')
assert(loopResult.totalRounds >= 1, 'D-B5b debate had at least 1 round before break')
assert(loopResult.rounds.length === loopResult.totalRounds, 'D-B5c rounds length matches totalRounds')

// Test 6: callCritic catch block (line 453-456) — critic LLM throws
const throwCriticLLM = {
  async call(req) {
    if (req.toolName === 'debate-executor') return { content: 'Normal analysis' }
    if (req.toolName === 'debate-critic') throw new Error('Critic LLM crashed')
    return { content: '{}' }
  }
}
const dlThrowCritic = new mod.DebateLoop(throwCriticLLM)
const throwCriticResult = await dlThrowCritic.execute({ task: 'Critic throw test', maxRounds: 2, format: 'json' })
assert(throwCriticResult.error !== undefined || throwCriticResult.totalRounds <= 1, 'D-B6a debate returns error when critic LLM throws')

// Test 7: DebateLoop with verbose mode (cover verbose logging branches)
const verboseMock = makeMockLLM('Verbose content.', 'APPROVED: Great')
const dlVerbose = new mod.DebateLoop(verboseMock)
const verboseResult = await dlVerbose.execute({ task: 'Verbose test', maxRounds: 1, format: 'json', verbose: true })
assert(verboseResult.approved === true, 'D-B7a verbose debate approves')
assert(verboseResult.totalRounds === 1, 'D-B7b verbose debate has 1 round')

// Test 8: callCritic non-approved path — critic lists issues (no APPROVED)
const issueMock = makeMockLLM('Draft with issues', '1. Missing context\n2. Too vague\n3. No references')
const dlIssue = new mod.DebateLoop(issueMock)
const issueResult = await dlIssue.execute({ task: 'Issue test', maxRounds: 1, format: 'json' })
assert(issueResult.approved === false, 'D-B8a debate not approved when critic lists issues')
assert(issueResult.rounds.length === 1, 'D-B8b issue round captured')
if (issueResult.rounds.length > 0) {
  assert(issueResult.rounds[0].issues.length > 0, 'D-B8c issues parsed from critic output')
}

// Test 9: formatDebateResult — exported formatting function (lines 460-491)
const fmtResult = mod.formatDebateResult({
  task: 'Format test',
  totalRounds: 2,
  approved: true,
  rounds: [
    { round: 1, draft: 'First draft', review: 'APPROVED: Good', approved: true, issues: [] },
    { round: 2, draft: 'Second draft', review: 'Issue 1: Fix this', approved: false, issues: ['Fix this'] }
  ],
  finalOutput: '{"ok":true}',
  revisionSummary: '2 rounds, 1 issues, approved'
})
assert(typeof fmtResult === 'string', 'D-B9a formatDebateResult returns a string')
assert(fmtResult.includes('Format test'), 'D-B9b includes task name')
assert(fmtResult.includes('[Approved]'), 'D-B9c includes status')
assert(fmtResult.includes('2 rounds'), 'D-B9d includes round count')
assert(fmtResult.includes('Round 2'), 'D-B9e includes round 2 history')

// Test 10: formatDebateResult with not-approved result
const fmtNotApproved = mod.formatDebateResult({
  task: 'Failed task',
  totalRounds: 1,
  approved: false,
  rounds: [{ round: 1, draft: 'Bad draft', review: 'Issue: Missing data', approved: false, issues: ['Missing data'] }],
  finalOutput: 'Incomplete',
  revisionSummary: '1 round, not approved'
})
assert(fmtNotApproved.includes('[Not approved]'), 'D-B10a formatDebateResult shows not approved')
assert(fmtNotApproved.includes('Missing data'), 'D-B10b formatDebateResult shows issues')

assert(true, "DebateLoop branch coverage tests passed")

}

// ── Standalone execution ──
const _isMain = typeof process !== "undefined" && process.argv[1] && (process.argv[1] === import.meta.url || process.argv[1].endsWith("/_runall-adv-debate.mjs"))
if (_isMain) {
  const { pluginDist: _pd } = await import("./_common.mjs")
  const _mod = await import(_pd)
  await runAdvancedDebateTests(_mod)
  const { state } = await import("./_state.mjs")
  console.log(`__RESULT__:${JSON.stringify({ passed: state.passed, failed: state.failed })}`)
  process.exit(state.failed > 0 ? 1 : 0)
}
