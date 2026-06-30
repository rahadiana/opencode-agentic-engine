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

Status: **started**. First minimal hardening slice covers `ParallelExecutor.llmStepRunner`: LLM JSON output is now parsed and validated with existing `SchemaValidator` before file writes. Malformed shapes, wrong field types, absolute paths, and `..` traversal paths return safe failure instead of writing files or reporting success. Regression tests cover valid payload and malformed payload behavior.

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

Add config flag only after P0/P1 exist.

Possible config:

```json
{
  "agent": {
    "dumbModelMode": true
  }
}
```

Behavior:

- Shorter prompts.
- More JSON-only internal calls.
- Stricter workflow gates.
- More deterministic fallback.
- Lower trust in model-generated claims.

Do not implement this first. It is mostly a switch over stronger primitives from P0/P1.

## P3 — Procedural Skill Injection

Make memory useful for weak models by injecting checklists, not just facts.

Examples:

- “How to add a new `agentic_` tool” checklist.
- “How to update OpenCode plugin tests” checklist.
- “How to verify prompt injection changes” checklist.
- “How to recover TypeScript build failures” checklist.

Goal: weak model follows a checklist instead of inventing process.

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
