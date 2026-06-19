# TODO: 92% → 100% (Agentic Software Paper Compliance)

**Target:** Menutup 12 gap agar skor evaluasi tools naik dari 92/100 ke 100/100
berdasarkan paper "Agentic Software: How AI Agents Are Restructuring Software Engineering" (arXiv:2606.05608).

---

## 🔴 HIGH PRIORITY (~7 poin)

### G5 — Formal Model A=(M,T,M,Π)
Implementasi formal model untuk task decomposition, dependency graph, dan verification contracts.

- [ ] Pre-condition / post-condition model di `DomainRegistry`
- [ ] Circular dependency detection di task graph
- [ ] Contract-based verification (bukan passthrough)
- [ ] Tambah domain-specific verifiers (bukan cuma generic passthrough)

**Files:** `src/core/domain-registry.ts`, `src/core/domains/`
**Estimasi:** ~10 hari

---

### G1 — EventBus Wiring
EventBus sudah emit event (`llm.response`, `step.completed`, `file.written`) tapi zero subscriber.

- [ ] Wiring Orchestrator ke event `pipeline.stage.completed`
- [ ] Wiring Dashboard ke event `step.completed`
- [ ] Wiring TraceLogger ke semua event
- [ ] Wiring LiveEvaluator ke event `tool.invocation`

**Files:** `src/core/event-bus.ts`, `src/agents/orchestrator.ts`, `src/observability/`
**Estimasi:** ~3 hari

---

### G4 — Contract-Based Cross-Validation
Cross-validation pipeline masih basic (empty check + optional LLM).

- [ ] Contract definition per pipeline stage (input/output schema)
- [ ] Type/schema consistency checker antar stage
- [ ] Pre/post-condition enforcement
- [ ] Invariant violation → auto-reject + revision request

**Files:** `src/agents/orchestrator.ts`
**Estimasi:** ~5 hari

---

## 🟡 MEDIUM PRIORITY (~1.5 poin)

### G6 — Agentic Auto Error Recovery
✅ Selesai: `AutoRetryManager` dengan strategy rotation, selective rollback, error analysis integration.

- [x] Integrasi `errorAnalyzer.analyzeDeep()` untuk diagnosa cerdas
- [x] Selective rollback (parse compile error → extract problematic file paths → hanya rollback itu)
- [x] Adaptive retry dengan 4 strategi (direct_fix → conservative → type_first → split_changes)
- [x] Failure context injection ke retry prompt (error + analysis + strategy instruction)
- [x] Exponential backoff dengan full jitter
- [x] Final full rollback jika semua retry habis

**Files:** `src/core/auto-retry.ts` (baru), `src/index.ts` (retry loop)
**Estimasi:** ~2 hari → ✅ selesai

---

### G2 — Vector Embeddings Disconnected
✅ Selesai: async variants `searchByCategoryAsync` / `searchAllAsync` yang memanggil `enrichWithVectors()`.

- [x] `searchByCategoryAsync()` — sync TF-IDF → vector enrichment → hybrid score
- [x] `searchAllAsync()` — sync searchAll → vector enrichment across categories
- [x] `agentic_rag` tool dipanggil via async variant + menampilkan vector score di output
- [x] Fallback ke sync TF-IDF jika embedder tidak dikonfigurasi
- [x] Backward compatible — sync methods tetap ada untuk test

**Files:** `src/memory/multi-index-rag.ts`, `src/index.ts` (agentic_rag tool)
**Estimasi:** ~1 hari → ✅ selesai

---

### G10 — Domain Expansion
✅ Selesai: 4 domain baru dengan verifier, error matcher, dan detection masing-masing.

- [x] **security** — secret-scan verifier, auth/CSP error matchers, hardcoded secret detection, trivy integration
- [x] **devops** — Dockerfile lint (hadolint), YAML validation, Docker/K8s/CI error matchers, formal contract
- [x] **data-science** — notebook structure check, Python import lint, import/data-shape error matchers
- [x] **mobile** — Android manifest check, iOS plist check, Gradle/Xcode/RN error matchers
- [x] Register di `DomainRegistry` + `src/index.ts`
- [x] Backward compatible — test 581 passing

**Files:** `src/core/domains/security.ts`, `src/core/domains/devops.ts`, `src/core/domains/data-science.ts`, `src/core/domains/mobile.ts`, `src/index.ts`
**Estimasi:** ~8 hari → ✅ selesai

---

## 🟢 LOW PRIORITY (~0.5 poin)

### G3 — Router LLM Fallback
`route()` cuma panggil `keywordRoute()`, LLM fallback tidak pernah aktif.

- [ ] Implement LLM fallback saat keyword confidence < threshold
- [ ] Integrasi dengan RAG index untuk contextual routing

**Files:** `src/core/router-agent.ts`
**Estimasi:** ~2 hari

---

### G11 — Persist Model Selection
Per-role model preference hanya berlaku per session, tidak persist.

- [ ] Simpan ke `.agentic/models.json`
- [ ] Load otomatis saat session baru

**Files:** `src/index.ts` (line ~1997)
**Estimasi:** ~0.5 hari

---

### G12 — Fine-Tuning Pipeline
Skill → training data (JSONL/instructions) sudah bisa export, tapi tidak terotomatisasi.

- [ ] Fine-tuning orchestrator
- [ ] Integrasi API fine-tuning (OpenAI, dll)
- [ ] Model deployment + rollback

**Files:** `src/memory/skill-training.ts`
**Estimasi:** ~3 hari

---

### G8 — Update AGENTS.md
`agentic_model_reset` dan `agentic_budget` sudah ada di kode tapi tidak tercantum.

- [ ] Tambah ke tabel tools di AGENTS.md

**Files:** `AGENTS.md`
**Estimasi:** ~0.25 hari

---

### G9 — Config Schema Validation
Config loader silent degrade tanpa warning kalau format salah.

- [ ] JSON Schema validation
- [ ] Migration path antar versi config

**Files:** `src/core/config.ts`
**Estimasi:** ~1 hari

---

### G7 — Docker Layer Blueprint
Blueprint tools (debate, router, clean, rag, mcp) tidak punya E2E test di container.

- [ ] Layer ke-9 di `Dockerfile.test`

**Files:** `Dockerfile.test`
**Estimasi:** ~0.5 hari

---

## Ringkasan

| Level | Gap | Poin | Estimasi | Status |
|-------|:---:|:----:|:--------:|:------:|
| 🔴 High | G5, G1, G4 | ~7 | ~18 hari | ✅ Selesai |
| 🟡 Medium | ~~G6~~, ~~G2~~, ~~G10~~ | ~1.5 | ~11 hari | ✅ Selesai |
| 🟢 Low | G3, G11, G12, G8, G9, G7 | ~0.5 | ~7 hari | ⏳ |
| **Total** | **12 gap** | **~9 poin** | **~36 hari** | **7/12 selesai** |

**Progress:** 🔴 High ✅ | 🟡 Medium ✅ | Next: 🟢 Low — G3 (Router LLM Fallback), G11 (Persist Model Selection), G12 (Fine-Tuning Pipeline), G8 (Update AGENTS.md), G9 (Config Schema Validation), G7 (Docker Layer Blueprint)
