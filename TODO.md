# TODO — opencode-agentic-engine

> Last updated: 2026-07-09 (v0.5.20-dev)  
> High + Medium workstream complete (with residual lint polish).

---

## ✅ Completed

### Ecosystem + paper gaps (prior)
- [x] 12 paper gaps + 22 RAG papers
- [x] RAGSelfImprove critical path + auto dumb harness
- [x] H2 updateEntry write-back + H3 hybrid docs + M1 deep escalate + M2 audit + H1 push

### This session — H4 + M4
- [x] **H4** `agentic_auto` SWE reliability harness:
  - `extractPathHints` / `mergeTargetFiles` — goal path targeting
  - Wire `relevantFiles` into plan context (was always `[]`)
  - Prefer fast path when explicit file paths in goal
  - Larger primary-file context + TARGET FILES prompt
  - Final verify-before-done + success requires compile when files written
  - Fix dumbModelMode `"auto"` truthy bug → `resolveDumbHarness` + `workflowModeForDumb`
  - Tests: `_runall-auto-h4.mjs` (15) + SWE mock 7/7
- [x] **M4** lint hygiene batch:
  - ToolContext unused destructure → `key: _key` across tools
  - Slim `definitions.ts` barrel (remove dead imports)
  - Warnings: ~1820 → **~86** (0 errors)
- [x] Unit tests **3373** pass; build OK; push when credentials OK

---

## 🔴 High Priority

### H1. Git push ✅ (earlier) — re-push this batch
- [ ] Push H4/M4 commits to origin after commit

### H4. agentic_auto SWE reliability ✅ (harness)
- [x] Path hints + file targeting
- [x] Research/plan/verify artifacts + final compile gate
- [x] Dumb harness mode resolution fix
- [ ] Optional: re-run **real LLM** SWE-bench to measure 2/7 → ? (needs network/LLM)

---

## 🟡 Medium Priority

### M4. Branch coverage + lint ✅ (lint major)
- [x] Unused-ctx lint mass reduce (~1820 → ~86)
- [ ] Branch coverage >75% still open (CI gate 60% OK)
- [ ] Remaining ~86 warnings: mostly `no-explicit-any` + a few unused in core/index

### M1–M3, M5 ✅ (prior session)

---

## 🟢 Low Priority

- [ ] `npm run test:coverage:ci` + `./test-container.sh` full verify
- [ ] NPM publish
- [ ] Streaming (OpenCode SDK)
- [ ] Real-LLM SWE baseline re-measure after H4

---

## 📊 Metrics

| Metric | Value |
|--------|-------|
| Version | 0.5.20-dev |
| Unit tests | **3373** ✅ |
| SWE-bench mock | **7/7** ✅ |
| Lint errors | 0 |
| Lint warnings | **~86** (was ~1820) |
| RAG self-improve | 100/100 |
| Auto H4 suite | 15/15 |

---

## Notes

- H4 improves **harness** (targeting + verify + policy mode). Real free-model score still needs a live SWE run to quantify.
- Prefer not re-implementing paper gaps.
