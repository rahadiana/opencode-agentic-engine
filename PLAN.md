# PLAN.md — Agentic Plugin for OpenCode
> Grounded in: *"The End of Software Engineering"* — Cao, arXiv:2606.05608 (June 2026)

---

## Vision

Membangun plugin OpenCode yang mewujudkan **Stage II → Stage III** dari roadmap paper ini:
dari agent yang *mengerjakan satu task secara otonom* menuju *koordinasi multi-agent* yang bisa mengelola lifecycle software secara penuh.

Paper mendefinisikan tujuan akhir sebagai **"Agent → Result"** — menghilangkan perantara statis antara intent manusia dan outcome. Plugin ini adalah langkah konkret ke sana, dimulai dari dalam tool yang sudah dipakai developer sehari-hari: OpenCode.

---

## Fondasi Teori (dari Paper)

### Model Formal Agent (Definition 2.2)
Plugin dibangun di atas model: **A = (M, T, M, Π)**

| Komponen | Definisi | Implementasi di Plugin |
|---|---|---|
| **M** | LLM sebagai reasoning engine | Provider LLM yang dikonfigurasi di OpenCode |
| **T** | Set tools yang bisa dieksekusi | OpenCode tool calls + custom MCP tools |
| **M** (Memory) | Short-term context + long-term vector store | Session context + persistent skill store |
| **Π** | Planning mechanism | Intent decomposer → task queue |

Loop eksekusi: `at ← M(st, M), st+1 ← exec(at)` — agent menghasilkan action berdasarkan state, mengeksekusi, lalu state diupdate.

### Gap yang Ingin Ditutup (dari EvoClaw Benchmark)
Paper menunjukkan performance drop dari **>80% pada isolated tasks → 38% pada continuous evolution**. Penyebabnya:
1. **Context drift** — agent kehilangan pemahaman system-wide seiring kodebase berkembang
2. **Error propagation** — error awal cascades ke commit berikutnya
3. **Technical debt blindness** — agent tidak model long-term cost
4. **Verification fidelity** — test lulus tapi semantic error masih ada

**Plugin ini dirancang spesifik untuk menyerang keempat masalah ini.**

---

## Arsitektur Plugin

```
opencode/
└── plugin-agentic/
    ├── src/
    │   ├── core/
    │   │   ├── intent-parser.ts       # Perception module (Wang et al. Fig. 1)
    │   │   ├── planner.ts             # Π — dekomposisi task ke subtasks
    │   │   ├── executor.ts            # Loop: at ← M(st, M)
    │   │   └── verifier.ts            # Verification fidelity layer
    │   ├── memory/
    │   │   ├── session-store.ts       # Short-term: context window mgmt
    │   │   ├── skill-store.ts         # Long-term: reusable skills (à la Hermes)
    │   │   └── episodic-store.ts      # Cross-session memory (FTS5-backed)
    │   ├── agents/
    │   │   ├── architect-agent.ts     # Stage III: roles spesialisasi
    │   │   ├── developer-agent.ts
    │   │   ├── qa-agent.ts
    │   │   └── coordinator.ts         # Orchestration layer
    │   ├── drift/
    │   │   ├── context-compressor.ts  # Solusi untuk context drift
    │   │   └── dependency-tracker.ts  # Solusi untuk error propagation
    │   └── observability/
    │       ├── trace-logger.ts        # Reasoning chain tracer
    │       └── hallucination-guard.ts # Semantic verification
    ├── package.json
    └── opencode.plugin.ts             # Entry point — OpenCode plugin API
```

---

## Roadmap Implementasi

Mengikuti **four-stage roadmap** dari paper (Tabel 3, Section 6), adaptasi ke konteks plugin:

---

### Stage I — Tool-Augmented *(Target: Minggu 1–2)*
> *"Agents serve as assistants within human-led workflows"*

Tujuan: plugin bisa jalan, terkoneksi ke OpenCode, mengeksekusi task sederhana.

#### P0 — ✅ Completed
- [x] **Scaffold plugin** menggunakan OpenCode Plugin API
  - Entry point `src/index.ts` — register plugin with OpenCode tool API
  - 16 tools registered: plan, nav, execute, reflect, verify, status, context, snapshot, pr, score, delegate, parallel, skill, episodes, dashboard, guard
- [x] **Intent Parser** (Perception Module)
  - Parse user prompt → structured `TaskIntent { goal, constraints, context }`
  - Handle ambiguity via validation rules
- [x] **Basic Executor**
  - Step execution with file tracking, error propagation, retry logic (max 3x)
  - Auto-verify compile + tests on successful execution
- [x] **Session Memory** (Short-term)
  - Conversation turns, plan storage, artifact tracking
  - Progress tracking via ExecutorSnapshot

#### P1 — ✅ Completed
- [x] **Self-correction loop**
  - Compile verification after each step
  - 3x retry with error context, propagation analysis on failure
- [x] **OpenCode tool bindings**
  - Uses OpenCode's built-in file system + bash tools
  - Model-agnostic: no hardcoded LLM provider
- [x] **Basic observability**
  - Trace logging to `.agentic/trace.jsonl` (JSONL format)
  - Buffered writes with auto-flush every 5s or 10 entries

#### Acceptance Criteria Stage I
- Plugin bisa dimuat oleh OpenCode tanpa crash
- Bisa mengerjakan task "tambahkan unit test untuk file X" secara otonom end-to-end
- Self-correction berhasil recover dari minimal satu jenis error (compile error)

---

### Stage II — Single-Task Autonomous *(Target: Minggu 3–5)*
> *"Agents begin to own complete tasks from specification to deployment"*
> Referensi: Devin, OpenHands — agent navigasi codebase, implement feature, submit PR

Tujuan: agent bisa mengerjakan feature request dari awal hingga PR-ready, tanpa intervensi.

#### P0 — ✅ Completed
- [x] **Planner (Π)**
  - Dekomposisi feature request → ordered task list
  - 4 auto-decompose templates: create/implement, fix/bug, refactor, test
  - Manual subtask override supported
- [x] **Codebase navigator**
  - Index struktur repo, scan files by keyword or export
  - File relevance scoring with context hints
- [x] **Dependency tracker** (solusi untuk *error propagation*)
  - Per-session file change tracking
  - Error propagation path analysis: identifies likely culprit + affected steps

#### P1 — ✅ Completed
- [x] **Context compressor** (solusi untuk *context drift*)
  - Sliding window + key information extraction
  - Preserves: architectural decisions, modified files, known invariants
- [x] **Verification layer**
  - compile + test verification per step
  - `verifyRelated`: compile + targeted tests for changed files only
- [x] **Git integration**
  - Auto-commit logical steps with descriptive messages
  - PR description generation from plan + execution log

#### P2 — ✅ Completed
- [x] **Technical debt scorer** (solusi untuk *technical debt awareness*)
  - 4 metrik: coupling analysis, size complexity, scope risk, bad patterns
  - Overall score 0-100%
- [x] **Human checkpoint system**
  - Risk evaluation on every execute: BLOCK / REVIEW / WARNING
  - Triggers on: delete operations, config changes, large modifications

#### Acceptance Criteria Stage II
- Bisa mengerjakan task setara SWE-bench Verified (resolve GitHub issue nyata)
- Context window tidak "meledak" untuk codebase dengan >50 file
- Git history setelah eksekusi agent dapat di-review dan make sense

---

### Stage III — Multi-Agent Coordination *(Target: Minggu 6–10)*
> *"Specialized agents coordinate as teams, mirroring human engineering organizations"*
> Referensi: LangChain pilot — 93% reduction dalam root-cause identification time

Tujuan: agent berjalan sebagai tim dengan role berbeda, bisa paralel, punya shared memory.

#### P0 — ✅ Completed
- [x] **Agent roles**
  - `ArchitectAgent` — terima requirement, output: architecture decision + file structure
  - `DeveloperAgent` — terima task spec, output: implementasi + unit tests
  - `QAAgent` — terima implementasi, output: test results + bug report
  - `CoordinatorAgent` — orchestrate ketiga agent di atas, auto-suggest role
- [x] **Shared memory layer**
  - State yang semua agent bisa baca: current plan, files changed, decisions made
  - Session-scoped via SessionStore + ExecutorSnapshot

#### P1 — ✅ Completed
- [x] **Parallel execution**
  - Dependency graph untuk deteksi task independen
  - Conflict detection: dua task yang menyentuh file sama
  - Phase-based parallelism suggestions
- [x] **Skill store**
  - Auto-extract pattern setelah task sukses
  - Skill = `{ name, trigger_pattern, steps, success_rate }`
  - Search/find/list + failure reporting
- [x] **Episodic memory**
  - Cross-session recording: goal, steps, files, success
  - Full-text search keyword + recent + stats
  - Auto-record on task completion via hook

#### P2 — ✅ Completed
- [x] **Observability dashboard**
  - Timeline + statistics + tool usage
  - Anomaly detection: timeouts, retry storms, silent failures
- [x] **Hallucination guard**
  - File existence claims, function/export claims, import validity
  - Path resolution against worktree with traversal guard
  - Unverified claims flagged for manual review

#### Acceptance Criteria Stage III
- Tim 3 agent bisa mengerjakan feature yang membutuhkan perubahan di >5 file secara paralel
- Skill store berisi minimal 10 reusable patterns setelah 20 session
- Performance pada EvoClaw-style continuous tasks: target >55% (vs baseline 38%)

---

### Stage IV — Self-Evolving (Future / Research) *(2027+)*
> *"Agents gain the ability to improve their own architectures"*

Ini adalah aspirasi jangka panjang dari paper. Tidak masuk scope implementasi sekarang, tapi desain plugin harus **tidak menghalangi** ini terjadi.

Design constraints yang harus dijaga dari sekarang:
- Plugin system harus extensible — agent roles bisa ditambah tanpa ubah core
- Memory schema harus versioned — upgrade tanpa kehilangan episodic history
- Skill store format harus self-describing — skill bisa diinspeksi dan dimodifikasi oleh agent lain

---

## Gap Analysis: Jujur Tentang Apa yang Sudah / Belum Ada

| Kapabilitas | Status | Catatan |
|---|---|---|
| Plugin scaffold | ✅ Selesai | `dist/index.js` load via `opencode.json` |
| Intent parser | ✅ Selesai | `TaskIntent { goal, constraints, context }` |
| Basic executor | ✅ Selesai | Loop eksekusi + retry + propagation |
| Session memory | ✅ Selesai | Turns + plan + artifacts |
| Planner (Π) | ✅ Selesai | Auto-decompose 4 template (create/fix/refactor/test) |
| Context compressor | ✅ Selesai | Sliding window + key info extraction |
| Multi-agent coordinator | ✅ Selesai | 4 roles: architect/developer/qa/coordinator |
| Skill store | ✅ Selesai | Extract/find/list + failure reporting |
| Observability dashboard | ✅ Selesai | Timeline + stats + anomaly detection |
| Hallucination guard | ✅ Selesai | File/func/import verification |
| Parallel executor | ✅ Selesai | Dependency-based concurrency |
| Git integration | ✅ Selesai | Commit + PR generation |
| Episodic memory | ✅ Selesai | Cross-session search/recent/stats |
| Tech debt scorer | ✅ Selesai | 4 metrik: coupling/size/scope/patterns |
| Stage II SWE-bench test | ⬜ Belum | Butuh evaluasi dengan GitHub issues nyata |
| Stage III EvoClaw test | ⬜ Belum | Butuh continuous evolution scenario test |
| Stage IV Self-Evolving | 🔮 Future | Design constraints dijaga (lihat bawah) |

---

## Metrik Keberhasilan

Mengadopsi framework evaluasi dari paper:

| Stage | Metrik Utama | Target |
|---|---|---|
| I | Plugin load tanpa error + complete 1 task | 100% load, 1 task selesai |
| II | SWE-bench-style isolated task success rate | >60% |
| III | EvoClaw-style continuous evolution score | >55% (vs paper's 38%) |
| III | Time to root-cause vs manual | <50% dari waktu manual |

---

## Prinsip Desain (dari Paper Section 4.3 & 7.1)

1. **Intent-first, code-second** — Plugin menerima *apa* yang diinginkan, bukan *bagaimana*. Jangan expose implementation details ke user.

2. **Human in the loop, agent in the driver's seat** — Agent eksekusi, manusia approve di checkpoint kritis. Bukan sebaliknya.

3. **Code is ephemeral, outcomes are durable** — Semua kode yang di-generate adalah instrumen. Yang disimpan adalah skill, decision, dan episodic memory — bukan raw code snippets.

4. **Observability is not optional** — Setiap reasoning step harus bisa di-trace. Jika agent tidak bisa menjelaskan kenapa ia membuat keputusan X, keputusan itu tidak boleh dieksekusi.

5. **Fail loudly, recover gracefully** — Error tidak disembunyikan. Agent selalu lapor apa yang gagal, kenapa, dan apa yang dicoba untuk recover. Batas retry selalu eksplisit.

---

## Dev TODO (Post-Audit)

### 🔴 P0 — Critical Path
- [ ] **SWE-bench evaluation** — GitHub issue nyata, ukur % solved. Butuh `OPENAI_API_KEY`
- [ ] **EvoClaw continuous test** — 50-file codebase, 5 iterasi, ukur performance drop
- [ ] **NPM publish** — `npm publish` biar install via `opencode plugin opencode-agentic-engine`

### 🟡 P1 — Perbaikan Langsung
- [ ] **Docker pipeline** — `test-container.sh` layer 6-7: EvoClaw test proper
- [ ] **E2E test real LLM** — `test/e2e-scenario.mjs` tambah mode `if (process.env.OPENAI_API_KEY)`
- [ ] **Agent prompt spesifik** — `role-registry.ts` tambah few-shot contoh konkret per role
- [ ] **Session-seeded model preference** — `model-registry.ts` biarkan user pilih model per agent role

### 🟢 P2 — Polishing
- [ ] **Skill persist** — `skill-store.ts` sambungkan ke `PersistenceLayer` (sekarang in-memory)
- [ ] **ErrorAnalyzer LLM fallback** — `error-analyzer.ts` tambah LLM untuk kasus ambiguity
- [ ] **Config hot-reload propagate** — `config.ts` watcher sudah ada, tapi belum ke semua module
- [ ] **`agentic_evolve` auto-execute** — `self-evolver.ts` action items yang bisa jalan sendiri
- [ ] **Test coverage** — `test/run.mjs` tambah edge cases (tiap tool minimal 5 test)

### 🔵 Stage IV — Self-Evolving (Future)
- [ ] Agent modifikasi prompt sendiri
- [ ] Skill store → training data fine-tune
- [ ] Cross-session pattern discovery otomatis

---

## Referensi

- Cao, Z. (2026). *The End of Software Engineering: How AI Agents Are Fundamentally Restructuring the Software Paradigm*. arXiv:2606.05608
- Wang et al. (2024). *Agents in Software Engineering: Survey, Landscape, and Vision*. arXiv:2409.09030
- Deng et al. (2026). *EvoClaw: Evaluating AI Agents on Continuous Software Evolution*. arXiv:2603.13428
- Kumar & Ramagopal (2026). *Agentic Engineering: How Swarms of AI Agents Are Redefining Software Engineering*. LangChain Blog
- Nous Research (2025–2026). *Hermes Agent: The Self-Improving AI Agent*. GitHub
- Yao et al. (2023). *ReAct: Synergizing Reasoning and Acting in Language Models*. ICLR
