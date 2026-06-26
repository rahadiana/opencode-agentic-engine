# Research Notes: opencode-agentic-engine vs arXiv Best Practices

## Context
Plugin OpenCode yang mengimplementasikan agentic software engineering workflow — domain-agnostic, autonomous planning, multi-agent collaboration, skill-based learning, model reliability tracking, dan self-evolution.

Berdasarkan paper **arXiv:2606.05608** — "The End of Software Engineering".

## Key Files
- `src/index.ts`: 4921 lines, 30 tool({}) registrations
- `src/core/formal-model.ts`: Formal model A=(M,T,M,Π)
- `src/core/llm.ts`: LLMEngine with 4 providers + response cache (TTL 30s, exact match)
- `src/agents/orchestrator.ts`: Pipeline orchestration (PM→Arch→Dev→QA), 806 lines
- `src/agents/coordinator.ts`: Multi-agent coordination, shared memory, message bus
- `src/agents/role-registry.ts`: 9 built-in roles, versioned prompt history
- `src/core/prompt-template.ts`: Knowledge-first architecture (identity/knowledge/instructions/guardrails)
- `src/core/planner.ts`: Template-based decomposition (13 templates)
- `src/core/agent-loop.ts`: Agent loop with batch execution, conflict detection, observer pattern
- `src/core/auto-retry.ts`: 4 retry strategy rotation
- `src/core/model-registry.ts`: Per-role model config, reliability tracking, quarantine
- `src/drift/hallucination-guard.ts`: 4 claim types verification
- `src/memory/episodic-store.ts`: Cross-session memory
- `src/memory/skill-store.ts`: Auto-extraction, sliding window success rate
- `src/evolution/self-evolver.ts`: Skill patch generation, role suggestion
- `src/evolution/continuous-evolution.ts`: Self-evolution pipeline
- `test/run.mjs`: 1779+ unit tests

## Plugin Stats
- `@ts-expect-error` / `@ts-ignore`: 0
- `as any`: 90% reduced from baseline, mostly in protocol adapters
- 1 external dependency: `stopwords-iso`
- ESLint: `typescript-eslint/recommended` with `no-explicit-any: warn`
- TypeScript: `strict: true`, `noUnusedLocals`, `noUnusedParameters`
- Build: esbuild minify+sourcemap+treeshake+keepNames

## Codebase Rating: A-/A
Re-evaluated after deep read. Initial assessment was too harsh. This is genuinely very best practice.

## Paper References

### Already Fetched
| Paper | Source | Key Content |
|-------|--------|-------------|
| arXiv:2606.05608 | Codebase base paper | "The End of Software Engineering" — 4-stage roadmap (Tool-Augmented → Single-Task → Multi-Agent → Self-Evolving). Formal model A=(M,T,M,Π). |
| arXiv:2512.08769 | webfetch | "A Practical Guide for Designing, Developing, and Deploying Production-Grade Agentic AI Workflows" — 9 best practices |
| arXiv:2605.22634 | webfetch | "Contractual Skills: A GovernSpec Design Framework" — Skill design pattern |
| arXiv:2602.14878 | Referenced in code comments (index.ts:176-177) | MCP 6-component rubric: Purpose + Guidelines + Limitations + Parameters + Length + Examples |
| arXiv:2604.26275 | webfetch | Bhati '26: "Agentic AI in the SDLC" — 6-layer reference architecture. SWE-bench rose from 1.96% (2023) to 78.4% (Apr 2026). 5 open problems. |
| arXiv:2603.11445 | webfetch | Zhang '26: "VMAO: Verified Multi-Agent Orchestration" — Plan-Execute-Verify-Replan framework |
| arXiv:2502.13767 | webfetch | Roychoudhury '25: "Programming with Trust" → CACM 2026. Trust is barrier, not capability. |
| arXiv:2508.17343 | webfetch | Roychoudhury '25: "Agentic AI for Software" — Intent inference via program analysis |
| arXiv:2510.17109 | websearch | VeriMAP: Verification-aware planning — verification functions at plan time |
| Self-Harness (arXiv Jun '26) | websearch | Agents improve own harness (weakness mining → proposal → validation) |
| AFLOW (ICLR 2025) | websearch | Auto-generate agentic workflows via search over interconnected LLM nodes |
| ControlA | websearch | Framework-agnostic reliability mechanisms for agentic workflows |

### Best Practices from arXiv:2512.08769 — 9 Practices

| # | Practice | Plugin | Status |
|---|----------|--------|--------|
| 1 | Tool Calls Over MCP | All 30 tools use `tool({})` from OpenCode SDK | ✅ Exact match |
| 2 | Direct Function Calls Over Tool Calls | `execution-helpers.ts` has `writeFiles()`, `parseFileEntries()` as pure functions | ✅ Exact match |
| 3 | Avoid Overloading Agents With Many Tools | 9 agent roles with context-appropriate tool subsets | ✅ Exact match |
| 4 | Single-Responsibility Agents | 9 roles + 6 domain packs, each with distinct prompts/tools | ✅ Exact match |
| 5 | Store Prompts Externally | Prompts hardcoded in `role-registry.ts` (177 lines) | ⚠️ Trade-off: bundled esbuild plugin |
| 6 | Responsible AI Agents | `model-registry.ts` (quarantine), `HallucinationGuard`, `ContinuousEvolution` | ✅ Exceeds paper |
| 7 | Separation of Workflow/MCP | `mcp-client.ts` standalone, core workflow is MCP-independent | ✅ Exact match |
| 8 | Containerized Deployment | `Dockerfile.test`, docker-compose, cloudflared | ✅ Exact match |
| 9 | KISS Principle | 1 external dep (`stopwords-iso`) | ✅ Exact match |

### 4-Stage Roadmap (arXiv:2606.05608)

| Stage | Paper Definition | Plugin | Status |
|-------|-----------------|--------|--------|
| I: Tool-Augmented (2023-2025) | Code completion, single-issue fixes | 30 tools, plan/execute/verify | ✅ |
| II: Single-Task Autonomous (2025-2027) | End-to-end feature building | `agentic_auto`, `agentic_plan` auto-decompose | ✅ |
| III: Multi-Agent Teams (2026-2029) | Coordinated swarms, shared memory | `agentic_delegate/pipeline/message/parallel` + coordinator/orchestrator | ✅ |
| IV: Self-Evolving (2028+) | Autonomous discovery, learning | `self-evolver.ts`, `continuous-evolution.ts`, `agentic_evolve` | ✅ |

### Formal Model A=(M,T,M,Π)

```
Paper:  A = (M, T, M, Π)
Plugin: formal-model.ts — FormalModel A=(M,T,M,Π)
        llm.ts — LLMEngine (M)
        index.ts — 30 tool definitions (T)
        episodic-store.ts + skill-store.ts + session-store.ts — Memory (M)
        planner.ts — Template + LLM decomposition (Π)
```

## GAPS Identified from Research

### ✅ Gap 1: Replan Loop (VMAO — arXiv:2603.11445)
**Current**: Plan → Execute → Verify (linear, fail → retry with same plan)
**Paper**: Plan → Execute → Verify → **Replan** (verifier output feeds back to planner for restructuring)

VeriMAP (arXiv:2510.17109) also relevant: verification functions created at plan time as executable Python code.

**Question**: Is retry strategy rotation (direct_fix → conservative → type_first → split_changes) sufficient, or do we need explicit replan phase?

### Gap 2: Confidence Scoring per Output (Roychoudhury '25 — arXiv:2502.13767)
**Current**: Binary pass/fail via `hallucination-guard.ts`
**Paper**: Trust is the barrier, not capability. Need:
- Confidence score per output
- Provenance tracking (which LLM call changed which file based on what reasoning)
- Explainability (why solution A vs B)

**Reference**: This paper was accepted to CACM 2026 — industry-validated.

### Gap 3: Intent Inference via Program Analysis (arXiv:2508.17343)
**Current**: LLM → write code → verify
**AutoCodeRover pattern**: Program analysis FIRST → infer intent from AST, code search, fault localization → THEN generate patch
- Works on **program representations**, not just text
- Integrated into SonarQube (production, not academic)
- SpecRover extends with explicit unit-level intent inference

**Question**: Should plugin add program analysis (AST traversal, dependency graph beyond imports) for intent inference?

### Gap 4: Self-Harness (arXiv Jun '26)
**Current**: `self-evolver.ts` improves prompts & skills only
**Paper**: Agent does Weakness Mining → Harness Proposal → Validation → **modifies own operational code** (not just prompts, but logic, tool definitions, workflow structure)
- MiniMax M2.5 improved from 40.5% ↔ 61.9% (+52.6%)
- GLM-5 from 42.9% ↔ 57.1% (+33.1%)

### Gap 5: Proof-Oriented Programming
**Current**: `formal-model.ts` for pipeline contracts only
**Paper**: Generate code WITH formal specs (F*, Dafny, Verus) for automatic verification

### Gap 6: Agent-Computer Interface (ACI) Design Emphasis
**Current**: Good ACI with 30 tools
**Paper (Bhati '26 + SWE-agent)**: ACI design quality matters as much as model capability. SWE-agent's ACI lifted resolution from 2% to 12.5% with same model.

### ✅ Gap 7: Semantic Caching (not from papers, from prior discussion)
**Current**: `llm.ts` has exact-match response cache (TTL 30s)
**Could**: Add similarity-based cache using existing `local-embedder.ts` + `vector-store.ts`
- Hit for "refactor executor.ts" ≈ "refactor src/core/executor.ts"
- Best for research/explanation queries, not code generation (non-deterministic)

## Archived Practices (Urusan OpenCode Platform, Not Plugin)
- Prompt caching → provider-side (KV cache)
- cache_control headers → OpenCode platform's LLM transport layer

## ✅ Implemented (Gap 1 — Adaptive Replan Loop)

**Files changed:**
- `src/core/executor.ts` — `replanStep()`: hapus failed step, inject new subtasks, update deps
- `src/core/verifier.ts` — `verifyCriteria()`: LLM check against `verificationCriteria` from planner templates (non-blocking)
- `src/core/auto-retry.ts` — `getPreservedFiles()`: complement of `getFilesToRollback()` for partial success tracking
- `src/core/agent-loop.ts` — `tryReplan()`: adaptive replan phase when retry exhausted → split step into smaller subtasks. Guarded against infinite recursion via `replannedSteps` Set + depth check.

**Flow:**
```
Before: Plan → Execute → Verify → Retry same step × N → mark failed
After:  Plan → Execute → Verify → Retry × N → Replan (split step) → Execute subtasks baru → ... → done
```

**Key design decisions:**
- Criteria check is **non-blocking**: criteria failure logged via observer, doesn't fail the step
- Replan is **depth-1 only**: replanned steps won't be replanned again (blocked via `replannedSteps` Set)
- Partial preservation via `getPreservedFiles()` + retry prompt already includes `successfullyWrittenFiles`
- `replanned` flag in return type: `runLoop` skips failedSteps for replanned steps, new subtasks continue execution

## Remaining Priority

1. **Confidence scoring** per output — trust barrier is real
2. **Verification functions at plan time** — make verify predictive not reactive
3. **Intent inference via program analysis** — fundamental approach change
4. **Self-harness** — interesting but early-stage
5. **Proof-oriented coding** — heavy, still academic
6. **Semantic caching** — nice-to-have, 20-40% LLM call reduction
