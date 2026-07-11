# TODO — opencode-agentic-engine

> Last updated: 2026-07-11 (v0.5.8)  
> Zero lint, branch coverage +358, Docker CI verified, NPM publish tagged.

---

## ✅ Completed

### Ecosystem + paper gaps (prior)
- [x] 12 paper gaps + 22 RAG papers
- [x] RAGSelfImprove critical path + auto dumb harness
- [x] H2 updateEntry write-back + H3 hybrid docs + M1 deep escalate + M2 audit + H1 push

### v0.5.7 — Lint Zero + Branch Coverage + Doc Drift
- [x] **Zero lint warnings**: 87→0 (100%)
  - 35 unused imports dihapus dari `src/index.ts`
  - 19 dead vars diprefix `_` di RAG files + core
  - 18 `no-explicit-any` diganti `unknown`/type imports
- [x] **Branch coverage +176 tests**: data-cleaner 100%, prompt-builder 81.88%, 12 tool files
- [x] **Doc drift fix**: AGENTS.md, README.md, PLAN.md sync ke actual state
- [x] **Git push**: 22 files committed & pushed (`87c9681`)

### v0.5.8 — Docker CI + NPM Publish + Tool Fixes
- [x] **Branch coverage +330 tests** (total 3718): llm.ts, verifier.ts, agent-blueprint.ts, auto-retry.ts
- [x] **Container test verified**: Docker 28.0.4, 9-layer pipeline, 3 Docker test failures fixed
- [x] **NPM publish setup**: v0.5.8 tag pushed, CHANGELOG.md created
- [x] **Compact tool brief `buildCompactToolBrief()`**: sub-agent sekarang lihat semua 32 tools + deskripsi (bukan cuma "all agentic tools (etc.)")
- [x] **Debate [NO_LLM] fix**: `_chatMode` leak + per-call timeout bug fixed
- [x] **Skill store dedup**: `searchByTitle()` + skip duplikasi di `agentic_rag store`
- [x] **Refactor index.ts**: ekstrak `exports.ts` (148 line) + `helpers.ts` (86 line) — index.ts 1734→1503 line

---

## 🔴 High Priority

### H1. NPM publish — butuh NPM_TOKEN
- [x] v0.5.8 tag pushed → auto-trigger GitHub Actions
- [ ] **Blocker**: tambah `NPM_TOKEN` di GitHub → Settings → Secrets → Actions

---

## 🟡 Medium Priority

### M1. Branch coverage >75%
- [ ] CI gate 60% OK, target 75%. Tersisa ~150-200 test untuk tools/ (62%) + index.ts (51%)

### M2. Refactor index.ts lanjutan
- [ ] Ekstrak `system.transform` hook (~240 line) ke `src/core/system-transform.ts`
- [ ] Ekstrak tool definitions wiring (~700 line) ke `src/tools/`

### M3. Streaming
- [ ] Delegated ke OpenCode SDK — capability 48/48

---

## 🟢 Low Priority

- [ ] `./test-container.sh` full verify (Docker pipeline sudah diverifikasi)
- [ ] Perbaiki Dockerfile: `agentic-agent-prompt.md` (sudah dibuat)

---

## 📊 Metrics

| Metric | Value |
|--------|-------|
| Version | **0.5.8** |
| Unit tests | **3718** ✅ |
| SWE-bench mock | **7/7** ✅ |
| Lint | **0 errors, 0 warnings** 🎯 |
| Branch coverage | Stmts 90.78%, Branch 70.02%, Funcs 76.79% |
| Container test | ✅ Docker 28.0.4 verified |
| NPM publish | ⏳ Tag pushed, butuh NPM_TOKEN |
| Index.ts size | 1503 line (was 1734) |

---

## Notes

- H4 (v0.5.7) improves **harness** (targeting + verify + policy mode).
- Compact tool brief (`buildCompactToolBrief`) sudah di-export dan dipasang di parent + sub-agent prompt.
- Prefer not re-implementing paper gaps.
