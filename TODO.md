# TODO — opencode-agentic-engine

> Last updated: 2026-07-09 (v0.5.20-dev session)  
> Scope: High + Medium improvements after paper gaps + RAG critical-path + dumb harness.

---

## ✅ Completed (historical)

### v0.5.17-dev — Refactor baseline
- [x] Document sync: version, test count, gaps 10-12, tools 31→32
- [x] 114 bare `catch {}` → logged warnings (21 files)
- [x] ESLint config: `caughtErrorsIgnorePattern: "^_"` → 0 lint errors
- [x] `shared-instances.ts` — 18→0 globalThis references
- [x] God method extraction: `llm.ts.call()`, `auto-evolve.ts`
- [x] Tool extraction (batch 1): execute, auto, evolve, rag, delegate, model, finetune + status/clean/snapshot/budget

### v0.5.20-dev — Ecosystem solid
- [x] `RAGSelfImprovePipeline` — Adaptive→KbPO→MMKP as **default critical path**
- [x] Wired into `MemoryOrchestrator.queryWithKnowledge`, `system.transform`, `agentic_execute`, `AgentLoop` feedback
- [x] Session tracks `rag:lastUsedTitles` + `workflow:researched` for closed-loop feedback
- [x] Parallel runner includes `_runall-rag-selfimprove.mjs` (now **100** tests)
- [x] **Auto dumb-model harness** — `dumbModelMode: "auto"` (default)
- [x] Docs sync: `docs/*`, `AGENTS.md`, `PLAN.md`, `src/**/README.md`
- [x] 12 paper gaps (arXiv:2606.05608) + 22 RAG papers implemented

### v0.5.20-dev — High/Medium batch (this session)
- [x] **H2** `MultiIndexRAG.updateEntry` + `getEntrySnapshot` + feedback write-back via public API
- [x] **H3** Hybrid local/global docs (`docs/guide/memory.md`, `docs/config.md`) + `agentic_status` Store Roots
- [x] **M1** MDP auto deep-escalate (`memory.ragDeepEscalate` + threshold, default 0.35)
- [x] **M2** FormalModel/AttentionScheduler audit documented (DependencyGraph+ContractVerifier wired; AttentionScheduler opt-in)
- [x] **M3** Tool extraction — already complete (`src/tools/*` per tool; `definitions.ts` thin barrel)
- [x] **M5** PLAN.md Future Work + metrics drift sync
- [x] Tests: 3358 pass (was 3342), rag-selfimprove 100/100

---

## 🔴 High Priority

### H1. Git push (operational) ✅
- [x] Pushed to `origin/main` (`0b505ea..4a7ce2f`, 5 commits including this batch)

### H2. RAG quality write-back ✅
- [x] `MultiIndexRAG.updateEntry(selector, patch)`
- [x] `getEntrySnapshot(selector)`
- [x] `RAGFeedbackLoop` → `updateEntry` (version bump + notifyPersist)
- [x] Tests UE-1..4 + feedback round-trip

### H3. Hybrid local/global context docs ✅
- [x] Namespace table in `docs/guide/memory.md`
- [x] Config section in `docs/config.md`
- [x] `NAMESPACE_SCOPE` exported; `getStoreRoots()` / `getNamespaceScopes()`
- [x] `agentic_status detail=full` → Store Roots + ragDeepEscalate knobs

### H4. `agentic_auto` real-LLM reliability (SWE path)
- [ ] Diagnose free-model auto ~2/7 vs delegate+manual 7/7 (still open)
- [ ] Harden: research gate, file targeting, verify-before-done
- [ ] Re-run SWE mock (must stay 7/7) + document real-LLM baseline
- [ ] Prefer harness fixes over model-specific hacks

**Notes (partial diagnosis):**
- Weak free models hit WorkflowPolicy **strict** under dumb harness (research-missing blocks) — correct safety, but auto loop must seed `workflow:researched` + plan evidence earlier.
- Delegate path succeeds because human/agent targets exact files; auto path is broader.
- Next: ensure `agentic_auto` pre-marks research when `agentic_nav`/RAG returns hits; tighten goal→file mapping before LLM implement.

---

## 🟡 Medium Priority

### M1. MDP / deep retrieval auto-escalate ✅
- [x] Auto deep when adaptive confidence low
- [x] Config: `memory.ragDeepEscalate` (default true), `memory.ragDeepEscalateThreshold` (0.35)
- [x] Wired in `queryWithKnowledge` via ConfigLoader
- [x] Tests SIP-ESC-1..3

### M2. FormalModel + AttentionScheduler wiring audit ✅
- [x] Documented in `src/core/README.md` + `src/agents/README.md`
- [x] Decision: do **not** force AttentionScheduler into default multi-agent path

### M3. Tool extraction ✅ (already done)
- [x] All major tools live under `src/tools/*.ts`; `definitions.ts` is barrel/`buildAllTools`

### M4. Branch coverage + lint hygiene
- [ ] Raise branch coverage toward >75% on critical modules
- [ ] Clean unused-ctx lint warnings (batch)
- [ ] Keep TODO/PLAN metrics aligned

### M5. Docs drift sync ✅
- [x] PLAN.md Future Work updated
- [x] Metrics baseline below

---

## 🟢 Low Priority (later)

- [ ] Verify full CI: `npm run test:coverage:ci`, `./test-container.sh`
- [ ] Phase 4 Smart Agentic Analysis final report
- [ ] NPM publish (`opencode plugin opencode-agentic-engine`)
- [ ] Streaming — stay delegated to OpenCode SDK unless API changes

---

## 📋 Session checklist

| Order | Item | Status |
|-------|------|--------|
| 0 | Rewrite TODO.md | ✅ |
| 1 | H2 RAG `updateEntry` + feedback write-back | ✅ |
| 2 | H3 Hybrid local/global docs + status roots | ✅ |
| 3 | M1 MDP auto-escalate | ✅ |
| 4 | M2 FormalModel/AttentionScheduler audit | ✅ |
| 5 | M3 Tool extraction | ✅ (pre-done) |
| 6 | M5 Docs/PLAN drift | ✅ |
| 7 | H4 agentic_auto SWE hardening | ⏳ partial notes only |
| 8 | M4 coverage/lint | ⏳ |
| 9 | H1 git push | ✅ `4a7ce2f` on origin |

---

## 📊 Metrics (current baseline)

| Metric | Value |
|--------|-------|
| Version | 0.5.20-dev |
| Unit tests | **3,358** ✅ (was 3,342) |
| RAG self-improve suite | **100/100** |
| Agentic tools | 32 |
| Lint errors | 0 |
| Lint warnings | unused-ctx remain (M4) |
| SWE-bench mock | 7/7 ✅ |
| SWE-bench real (auto free) | ~2/7 — see H4 |
| Coverage gate | stmts 80% / branch 60% / func 70% / lines 80% |
| RAG self-improve critical path | ✅ + updateEntry write-back + deep escalate |
| Dumb-model harness | ✅ auto |
| Branch vs origin | synced (push ✅) |

---

## Notes

- Paper gaps #1–#12 and 22 RAG papers are **done** — do not re-implement.
- Prefer real tests over speculative refactors.
- Language: English for code; Indonesian OK for user-facing notes in this file.
