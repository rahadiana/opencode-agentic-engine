# TODO — Make Agentic Engine Robust with Weak Models

Goal: make `opencode-agentic-engine` stay useful even when the underlying LLM is weak, forgetful, or bad at following prompts. Principle: **LLM boleh bodoh, harness harus pintar** — move intelligence from prompt text into deterministic runtime policy, schema validation, evidence gates, and recovery.

## Current Context

- Project is OpenCode-native, not meant to be runtime-agnostic across other coding tools.
- Latest relevant commits:
  - `c60ef7f feat: harden agentic system prompt rules`
  - `32077db feat: sync execute confidence with verification evidence`
- Generated system prompt now includes:
  - `Instruction Hierarchy`
  - `binding system policy`
  - `Mandatory Agentic Workflow`
  - `MUST use agentic_*`
  - `domain-agnostic` reasoning rule
- Runtime still depends too much on prompt compliance. Next work should enforce important rules in code.

## References Used

- OpenCode Agents docs: https://opencode.ai/docs/agents/
  - Agent config uses `permission`; legacy `tools` is deprecated.
  - Plugin currently registers agent via config hook and injects prompt via `experimental.chat.system.transform`.
- OpenCode config schema reference: https://opencode.ai/config.json
- Existing implementation files to inspect first:
  - `src/core/agent-loop.ts`
  - `src/core/executor.ts`
  - `src/core/confidence-scorer.ts`
  - `src/core/verifier.ts`
  - `src/core/dsl-executor.ts`
  - `src/core/dsl-validator.ts`
  - `src/core/schema-validator.ts` if present / related schema validation code
  - `src/index.ts` for tool handlers and `experimental.chat.system.transform`
  - `test/run.mjs`
  - `test/realtest.mjs`

## Main Design Direction

Do **not** solve this by only adding more prompt text. Weak models ignore long prompts. Instead:

1. Treat LLM output as untrusted.
2. Force structured workflow in runtime.
3. Validate every internal LLM output with schema.
4. Use deterministic fallback when LLM output is invalid.
5. Require evidence before marking work complete.
6. Break big reasoning into small decisions.

## P0 — Runtime WorkflowPolicy Gate

Status: **started** in `49a2b03..HEAD` follow-up work. A minimal `src/core/workflow-policy.ts` now exists and is integrated into `agentic_execute` as an advisory runtime gate plus a hard block when `success: true` conflicts with failed `verificationEvidence`. Plan/navigation/reflection/verification state is recorded in session artifacts. Config now supports `agent.workflowPolicyMode: "advisory" | "strict"` with advisory as the default. Strict mode blocks unsafe final completion without evidence and retry-success without reflection.

Implement a small deterministic policy module, likely `src/core/workflow-policy.ts`.

Purpose: turn prompt rules into runtime rules.

Suggested policy checks:

- Multi-step or risky task should have a plan before file edits. ✅ advisory warning in `agentic_execute`
- Failed step should require reflection before retrying the same approach. ✅ advisory warns; strict mode blocks
- Final completion should require either: ✅ advisory warns; strict mode blocks
  - `agentic_verify` passed, or
  - explicit `verificationEvidence` on `agentic_execute`.
- If confidence score is below threshold, final status should warn/block completion. ✅ warning support in policy
- If no research/navigation was performed for a codebase task, warn before implementation. ✅ advisory warning in `agentic_execute`
- Never accept failed evidence as success. ✅ hard block in `agentic_execute`

Keep first version small. Do not build a giant framework.

Potential API:

```ts
export interface WorkflowPolicyInput {
  action: "execute" | "finalize" | "retry"
  stepId?: string
  filesModified?: string[]
  success?: boolean
  hasPlan?: boolean
  hasResearch?: boolean
  hasReflection?: boolean
  hasVerificationEvidence?: boolean
  confidence?: number
}

export interface WorkflowPolicyDecision {
  allowed: boolean
  severity: "allow" | "warn" | "block"
  code: string
  message: string
}
```

Integration candidates:

- Start with `agentic_execute` in `src/index.ts` because it is already the tool that records completion.
- Later integrate into `AgentLoop` for autonomous execution.

Tests:

- Add unit tests in `test/run.mjs`:
  - allows simple execute with no files modified,
  - warns/blocks final success without verification evidence, ✅
  - allows final success with `verificationEvidence`, ✅
  - requires reflect before retry after failure, ✅ strict-mode regression covered
  - low confidence completion produces warning. ✅ direct policy regression covered

## P1 — Schema-First LLM Boundary Audit

Status: **complete** for all structured JSON boundaries. Eight slices hardened every `llmEngine.call()` site that parses structured JSON output. Remaining call sites are freeform text (debate executor/critic/cleaner, DataCleaner.clean) or already safe via try/catch with template fallback (PR description). Summary of all slices:

1. `ParallelExecutor.llmStepRunner` — SchemaValidator on file-write JSON payloads
2. `Orchestrator.runSemanticValidation` — cross-validation JSON schema gate
3. `RouterAgent.route` — intent classifier JSON with keyword fallback
4. `PlannerCritic` — candidate plans, critic scores, refinements validated
5. `DataCleaner.validate` — fail-closed on malformed validation output
6. Delegate step runner — reuses `parseLLMStepImplementation` from parallel.ts
7. `SecondBrain.reflect` — `parseReflectionPayload` type validation
8. `writeFiles` — path traversal guard (`resolve`+`relative`) at the shared chokepoint

Audit every `llmEngine.call(...)`.

Goal: no internal LLM output should be trusted unless parsed and validated.

Checklist:

- Search for `llmEngine.call`.
- For each call, document expected output shape.
- If parsing fails, return safe failure or deterministic fallback.
- Never treat garbage LLM output as passed/success.
- Reuse existing schema validation code if possible; avoid new dependency.

Important precedent:

- `verifier.ts` already had a fix where garbage LLM output must return `passed: false`, not `passed: true`.

Tests:

- Mock malformed LLM output.
- Assert result is safe failure or fallback, never silent success.

## P2 — Dumb Model Mode

Status: **complete**. Config flag `agent.dumbModelMode: boolean` added. When `true`:

- `workflowPolicyMode` forced to `"strict"` (blocks unsafe completion/retry without evidence/reflection)
- `hallucinationThreshold` capped at `0.2` (lower = stricter)
- `blockOnHallucination` forced `true` (hallucinatory steps become failures)
- Existing P0/P1 schema validators and path traversal guards apply regardless of mode

Config example:

```json
{
  "agent": {
    "dumbModelMode": true
  }
}
```

Default: `false` (no behavioral change for existing users).

## P3 — Procedural Skill Injection

Status: **complete**. Four procedural checklists added to `bootstrap-knowledge.ts` and auto-seeded into RAG on plugin init:

1. "How to add a new `agentic_` tool" — 10-step checklist
2. "How to update OpenCode plugin tests" — 8-step checklist
3. "How to verify prompt injection changes" — 8-step checklist
4. "How to recover TypeScript build failures" — 8-step checklist

Each checklist uses STEP 1/2/3... format so weak models can follow sequentially. Checklists are tagged with `checklist`, `procedure`, `step-by-step` for RAG discoverability.

## Verification Commands

Run at minimum:

```bash
npm run build
node test/run.mjs
node test/realtest.mjs
```

Optional diagnostics:

```bash
node test/check-plugin.mjs
```

Note: `test/check-plugin.mjs` may warn that plugin is not installed under `.opencode/plugins/...`; that is setup diagnostic, not necessarily failure.

## Operational Notes

- `npm run build` copies `dist` into OpenCode cache when present.
- After build, restart/re-enter OpenCode before validating live runtime behavior.
- Do not commit `.agentic/project-context.json`; build/tests may auto-update it.
- Before committing, check:

```bash
git status --short
git diff --stat
```

## Suggested First Task for Next Agent

Implement **P0 Runtime WorkflowPolicy Gate** minimally:

1. Add `src/core/workflow-policy.ts`.
2. Add tests in `test/run.mjs`.
3. Integrate first into `agentic_execute` only.
4. Run build + tests.
5. If clean, commit and push.
