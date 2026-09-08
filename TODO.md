# TODO — opencode-agentic-engine

> **Codebase audit 2026-07-28**: 51 kelemahan teridentifikasi (11 critical, 30 medium, 10 minor)  
> Coverage: Stmts ~90%, Branch ~70%, Funcs ~77% | Tests: 3718+ | Lint: 0 warnings

---

## 🔴 Critical (11)

### C1. `src/index.ts` — fungsi `createEngine()` 1611 baris
Terlalu besar, branch coverage ~51%, 70+ dependency di-cast `as unknown as ToolContext`, 50+ silent catch blocks.
- [ ] Ekstrak system.transform hook (~240 line) ke `src/core/system-transform.ts`
- [ ] Ekstrak tool definitions wiring (~700 line) ke `src/tools/`
- [ ] Ekstrak event wiring + disposal logic ke modul terpisah
- [x] **Parsial (P1)**: `detectSubAgentRole` + `buildSubAgentInjection` → `src/core/subagent-detect.ts` (-56 baris); RAG cache ke engine-scope.

### C2. `src/core/verifier.ts` — `runPipAudit()` module name typo
- [x] **Fix**: `pip_auth` → `pip_audit`. Ditambah `--format json` untuk output terstruktur, parsing JSON untuk count vuln, fallback `passed: false` (bukan silent pass) jika error.

### C3. `src/core/verifier.ts` — `runCargoAudit()` selalu return passed
- [x] **Fix**: `cargo audit --json` untuk structured output. Parse JSON vulnerabilities array. Jika tidak bisa parse, fallback `passed: false` (bukan silent pass).

### C4. `src/core/verifier.ts` — `runNpmAudit()` hanya parsing stderr
- [x] **Fix**: Fallback catch block sekarang return `passed: false` dengan pesan "unable to parse — manual review recommended" jika JSON parsing gagal.

### C5. `src/core/llm.ts` — Race condition knowledge injection
- [x] **Fix**: `_injectContext()` sekarang `async`, di-await di `call()` dengan Promise.race timeout 2 detik. Knowledge tersedia SEBELUM LLM call, bukan sesudahnya. Graceful degradation jika RAG timeout.

### C6. `src/core/llm.ts` — DJB2 hash collisions
- [x] **Verifikasi**: Cache hanya 1000 entries dengan TTL 30 detik. Probabilitas collision ≈ 0.01%. DJB2 sengaja dipilih karena cepat. Bukan bug praktis.

### C7. `src/index.ts` — Fire-and-forget async tanpa error handling
- [x] **Verifikasi model discovery** (baris 417-468): Ada catch block yang fallback ke env vars. Discovery selesai dalam ms, sebelum tool dipanggil. Bukan bug praktis.
- [x] **AutoUpdatePlugin**: kini `.catch(e => log.warn(...))` — tak ada lagi unhandled rejection (P1).
- [x] **runAutoEvolve**: ternyata SUDAH ada `.catch` + log (P1 verifikasi) — bukan bug.

### C8. `src/index.ts` — `detectSubAgentRole()` menggunakan `systemText.includes()` fragil
- [x] **Verifikasi**: Memang fragil secara desain, tapi ada 4 level fallback (built-in → custom → pipeline → debate). Kegagalan level 1 masih tertangani oleh level berikutnya. Bukan bug kritis.

### C9. `src/core/workflow-policy.ts` — `verificationEvidenceFailed()` tidak pernah dipanggil
- [x] **Verifikasi**: Fungsi ini ternyata **dipakai** di `execute.ts:165,177,653`. Bukan dead code. TODO.md dikoreksi.

### C10. `src/index.ts` — Dumb-harness notice bisa silent fail
- [x] **Verifikasi**: `applyDumbHarnessToAgentLoop()` bisa throw (panggil configLoader), jadi try-catch adalah defensive programming yang valid. Bukan bug.

### C11. `src/index.ts` — RAG cache in-memory di dalam system.transform hook
- [x] **Fix (P0)**: `_ragCache` pindah ke engine-scope + LRU-promote on hit + evict expired-then-oldest (max 50).

---

## 🟠 Medium (30)

### Verifier (`src/core/verifier.ts`)
- [ ] **M1**: `verifyLint()` hardcode ESLint — tidak support biome/oxlint/deno lint (baris 666-700)
- [x] **M2 (P0)**: `verifyTests()` kini detect jest/vitest/mocha/ava.
- [x] **M3 (P0)**: `verifyRelated()` kini benar-benar run related-tests via pattern; fallback ALL dengan reason eksplisit.
- [ ] **M4**: `readChangedFiles()` silent skip file yang tidak bisa dibaca — security vuln di file itu tidak ter-review (baris 143-150)
- [ ] **M5**: `parseLLMCheck()` return false positives saat LLM output unparseable (baris 457-469)
- [ ] **M6**: `formatVerificationChecklist()` static method — hanya dipanggil di test, tidak di runtime production. Bisa dihapus atau dijadikan internal.

### LLM Engine (`src/core/llm.ts`)
- [ ] **M7**: `llm.ts:750-761` — delete `req.model` side-effect. Jika method dipanggil lagi dengan req yang sama, model preference hilang.
- [ ] **M8**: `_promptWithProgressTracking` polling setiap 10s — ~60+ API calls/menit untuk progress tracking. Empty catch jika polling gagal (baris 1102-1161)
- [ ] **M9**: `LLMError` cuma punya message — tidak ada model name, provider, status code, retry info (errors.ts:43-47)
- [ ] **M10**: `TempSession` tidak pernah di-dispose di normal flow — kebocoran session (llm.ts:1252-1259)

### Agent Loop (`src/core/agent-loop.ts`)
- [ ] **M11**: `runLoopBatched()` dead code 55 baris (baris 1021)
- [ ] **M12**: Confidence scoring pakai `compileResult` yang sebenarnya `result.success`, `modelReliability` hardcode 0.5 (baris 508-537)
- [ ] **M13**: Event `plan.completed` selalu `totalDurationMs: 0` — timeline analysis impossible (baris 814-825)
- [ ] **M14**: RAG feedback `.catch(() => {})` kosong — error dari feedback loop ditelan total (baris 685-694)

### DAG Engine (`src/core/dag-engine.ts`)
- [x] **M15 (P1)**: `notifyRecovery` untuk SEMUA failed nodes.
- [x] **M16 (P1)**: `inDegree` hanya hitung dep yang dikenal — missing dep = external, bukan cycle.
- [x] **M17 (P1)**: abort tandai pending/running → skipped (state konsisten; runner wajib respect signal — JS tak bisa force-kill promise).

### Memory & RAG (`src/memory/`)
- [x] **M18 (P2)**: `importAll()` + `isIndexData()` — bucket korup di-skip dengan warn, field defensif.
- [ ] **M19**: `RAG Feedback Loop` fire-and-forget — tidak ada jaminan feedback tersimpan sebelum next search
- [ ] **M20**: RAG cache eviction O(n) — iterasi semua entries tiap search. Dengan 1000+ entries jadi lambat
- [ ] **M21**: `EpisodicStore.significance` tidak terpakai di pruning — pivotal entries tidak di-protect secara khusus
- [ ] **M22**: RAG Adaptive Retrieval scoring quality tanpa fallback — jika quality scores default semua 0.7, adaptive mode tidak berguna

### Config (`src/core/config.ts`)
- [ ] **M23**: Polling fallback dead code — `if (this.watcher) return` selalu true setelah `watch()` (baris 646-689)
- [ ] **M24**: Validasi warning untuk string embedding yang valid — misleading (baris 135-150)
- [x] **M25 (P1)**: `save()` atomic via tmp + rename. (+ config pull-sync `remotePullEnabled`/`remotePullIntervalMs`, P2)

### Agents (`src/agents/`)
- [x] **M26 (P1)**: listeners dipindah ke luar lock (snapshot di dalam, notify setelah release) — vektor deadlock reentrant tertutup.
- [ ] **M27**: A2A Client/server error handling minimal — semua error RPC di catch generic + stringify
- [ ] **M28**: Orchestrator pipeline stages hardcoded — PM→Architect→Developer→QA tidak bisa di-extend

### Drift (`src/drift/`)
- [ ] **M29**: `HallucinationGuard.resolveSafe()` path traversal risk — symlinks bisa bypass guard (baris 127-142)
- [ ] **M30**: `KNOWN_NPM_PACKAGES` outdated — hanya ~20 packages, modern packages (next, drizzle, hono, trpc) tidak ada

### Evolution (`src/evolution/`)
- [x] **M31 (P1 verifikasi)**: `shouldEvolve` sudah hysteresis 2 mnt + cap + min 10 datapoints; check sinkron murah tanpa LLM — bukan bug praktis.
- [ ] **M32**: `SelfEvolver` JSON.parse/stringify deep copy lossy — drop undefined, Date, RegExp, Map, Set, BigInt
- [ ] **M33**: `ContinuousEvolution.trendCache` hanya satu entry — cache invalid jika dipanggil dengan session berbeda

### Tools (`src/tools/`)
- [ ] **M34**: Destructuring 40+ params di setiap tool file — pola copy-paste massive, banyak unused (prefix `_`). Contoh: delegate.ts punya 60 baris destructuring.
- [ ] **M35**: Tool error handling via try-catch + string return — caller harus regex parse untuk deteksi error
- [ ] **M36**: `agentic_auto.ts` terlalu panjang (799 baris) — banyak logika duplikat dengan agent-loop.ts

### Observability (`src/observability/`)
- [x] **M37 (P3 verifikasi)**: buffer SUDAH bounded — `shift()` saat penuh (backpressure, trace-logger.ts:157-162) — bukan bug.
- [ ] **M38**: Dashboard metrics hanya in-memory — semua hilang saat plugin reload. Tidak ada persistensi
- [ ] **M39**: Logger `globalLogClient` bisa null — jika `setGlobalLogClient()` belum dipanggil, log ke console bukan SDK

### Evaluation & Curation
- [ ] **M40**: `LiveEvaluator` metrics hanya di-save saat dispose — jika plugin crash, semua metrics hilang
- [ ] **M41**: `SkillCurator` config load sekali di awal — tidak hot-reload saat config berubah

### Router & State (`src/core/router-agent.ts`, `state-store.ts`, `semantic-cache.ts`)
- [ ] **M42**: `RouterAgent` LLM dipanggil untuk SETIAP query — bahkan query trivial "find my notes" trigger LLM call. Tidak ada pre-filter.
- [x] **M43 (P0)**: `StateStore.get()` LRU-promote (delete+re-insert).
- [x] **M44 (P3)**: `tokenize()` NFKD + strip diacritics — "café" ≡ "cafe" (terverifikasi via SemanticCache).

---

## 🟢 Minor (10)

- [ ] **m1**: `package.json` dependency `stopwords-iso` tidak dipakai langsung — stopwords di-copy manual di semantic-cache.ts dan stopwords.ts
- [x] **m2 (P3)**: `process.env?.` → `process.env` (prompt-builder.ts, state-store.ts).
- [ ] **m3**: `tsconfig.json` `noUnusedLocals: false` — melemahkan strict checking, dead variables tidak terdeteksi
- [ ] **m4**: Prettier tidak dijalankan di CI — DITUNDA (P3): `format:check` gagal di 171 file; butuh commit formatting khusus, di luar scope sesi ini.
- [ ] **m5**: Dockerfile 9 layer tanpa layer caching optimization — bisa multi-stage build
- [ ] **m6**: README.md test count sering ketinggalan update — doc drift yang diakui di AGENTS.md
- [ ] **m7**: `src/core/domains/` 6 domain tapi cuma generic yang aktif — `activate("generic")` hardcode di index.ts:244
- [ ] **m8**: `eslint.config.js` menggunakan `no-useless-escape` rule — bisa memicu false positive
- [x] **m9 (P3 verifikasi)**: `dist/` SUDAH di `.gitignore` baris 8 — bukan bug.
- [ ] **m10**: AgenticError base class tidak abstract — DITUNDA (P3): 11 call-site `new AgenticError(code)` (TRACE_*/A2A_*/MCP_*) tak punya subclass; abstract butuh taksonomi baru — churn > manfaat.

---

## ✅ Completed (sebelum audit ini)

### v0.5.7 — Lint Zero + Branch Coverage + Doc Drift
- [x] **Zero lint warnings**: 87→0 (100%)
- [x] **Branch coverage +176 tests**: data-cleaner 100%, prompt-builder 81.88%, 12 tool files
- [x] **Doc drift fix**: AGENTS.md, README.md, PLAN.md sync ke actual state

### v0.5.8 — Docker CI + NPM Publish + Tool Fixes
- [x] **Branch coverage +330 tests** (total 3718): llm.ts, verifier.ts, agent-blueprint.ts, auto-retry.ts
- [x] **Compact tool brief `buildCompactToolBrief()`**: sub-agent lihat semua 32 tools + deskripsi
- [x] **Debate [NO_LLM] fix**: `_chatMode` leak + per-call timeout bug fixed
- [x] **Skill store dedup**: `searchByTitle()` + skip duplikasi di `agentic_rag store`
- [x] **Refactor index.ts**: ekstrak `exports.ts` + `helpers.ts` — index.ts 1734→1503 line

### Paper Gaps
- [x] 12 paper gaps + 22 RAG papers
- [x] RAGSelfImprove critical path + auto dumb harness
- [x] All 6 Self-Improving RAG modules: QualityScorer, FeedbackLoop, AdaptiveRetrieval, MDPRetrieval, KnowledgeBoundary, ContextOptimizer

---

## 📊 Metrics

| Metric | Value |
|--------|-------|
| Version | **0.5.10** |
| Unit tests | **3718+** ✅ |
| SWE-bench mock | **7/7** ✅ |
| Lint | **0 errors, 0 warnings** 🎯 |
| Coverage stmts | **~90%** |
| Coverage branch | **~70%** |
| Coverage funcs | **~77%** |
| Weaknesses found | **51** (11C · 30M · 10m) |
| Tools | **32 agentic tools** |

---

## Catatan

- Audit dilakukan 2026-07-28: baca seluruh modul (82 core + 31 memory + 9 agents + 7 drift + 5 evolution + 36 tools + 5 observability + index.ts 1611 baris)
- 3 critical security blind spots: pip_audit typo, cargo audit silent pass, npm audit stderr-only parsing
- Pattern dominan: 50+ silent catch blocks, fire-and-forget async tanpa await, boilerplate destructuring 40+ params per tool file
- Rekomendasi utama: refactor index.ts → 3-4 file terpisah, fix race condition di knowledge injection, ganti FIFO eviction dengan LRU
