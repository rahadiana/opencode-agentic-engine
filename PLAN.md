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

#### P0 — Harus ada sebelum apapun bisa ditest
- [ ] **Scaffold plugin** menggunakan OpenCode Plugin API
  - Entry point `opencode.plugin.ts` register dengan `definePlugin()`
  - Tool call sederhana: `run_task(prompt: string) → string`
- [ ] **Intent Parser** (Perception Module)
  - Parse user prompt → structured `TaskIntent { goal, constraints, context }`
  - Handle ambiguity: jika intent tidak cukup jelas, tanya clarifying question
- [ ] **Basic Executor**
  - Jalankan satu LLM call dengan tool use (baca file, tulis file, run bash)
  - Return hasil ke OpenCode conversation
- [ ] **Session Memory** (Short-term)
  - Simpan conversation turns dalam session
  - Pass context yang relevan ke setiap LLM call

#### P1 — Baru berguna kalau P0 selesai
- [ ] **Self-correction loop**
  - Setelah eksekusi, verifikasi hasil: apakah file yang diubah masih bisa compile?
  - Jika gagal, retry dengan error message sebagai context tambahan (max 3x)
- [ ] **OpenCode tool bindings**
  - Akses ke file system tools yang sudah ada di OpenCode
  - Akses ke bash execution
- [ ] **Basic observability**
  - Log setiap reasoning step ke file `.agentic/trace.jsonl`
  - Format: `{ timestamp, step, input, output, tool_used, success }`

#### Acceptance Criteria Stage I
- Plugin bisa dimuat oleh OpenCode tanpa crash
- Bisa mengerjakan task "tambahkan unit test untuk file X" secara otonom end-to-end
- Self-correction berhasil recover dari minimal satu jenis error (compile error)

---

### Stage II — Single-Task Autonomous *(Target: Minggu 3–5)*
> *"Agents begin to own complete tasks from specification to deployment"*
> Referensi: Devin, OpenHands — agent navigasi codebase, implement feature, submit PR

Tujuan: agent bisa mengerjakan feature request dari awal hingga PR-ready, tanpa intervensi.

#### P0
- [ ] **Planner (Π)**
  - Dekomposisi feature request → ordered task list
  - Output: `Plan { steps: Step[], dependencies: Dep[], estimated_cost: number }`
  - Tampilkan plan ke user untuk approval sebelum eksekusi
- [ ] **Codebase navigator**
  - Index struktur repo saat plugin load
  - Bisa menjawab: "file mana yang relevan untuk task ini?"
  - Gunakan embedding lokal (lightweight, tidak butuh API call)
- [ ] **Dependency tracker** (solusi untuk *error propagation*)
  - Track file apa yang diubah di setiap step
  - Jika step N gagal, identifikasi apakah penyebabnya ada di step N-1..N-k

#### P1
- [ ] **Context compressor** (solusi untuk *context drift*)
  - Ketika context window mendekati limit, compress history jadi summary
  - Summary harus mempertahankan: keputusan arsitektur, file yang diubah, invariants yang diketahui
  - Algoritma: sliding window + LLM summarization per N steps
- [ ] **Verification layer**
  - Setelah setiap step: jalankan test yang relevan
  - Sebelum "done": jalankan full test suite
  - Flag jika ada test baru lulus tapi behaviour berubah (semantic check)
- [ ] **Git integration**
  - Auto-commit setiap logical step dengan pesan deskriptif
  - Bisa generate PR description dari plan + execution log

#### P2
- [ ] **Technical debt scorer** (solusi untuk *technical debt awareness*)
  - Setelah implementasi, estimasi maintainability cost dari perubahan
  - Flag jika ada shortcut yang diambil: "Solusi ini bekerja tapi menambah coupling di X"
- [ ] **Human checkpoint system**
  - Papar "agent-in-the-driver's-seat, human-in-the-loop" dari paper (Section 7.1)
  - Pause otomatis di decision points berisiko tinggi (hapus file, ubah API contract)
  - Beri konteks yang cukup agar human bisa approve/reject dalam <30 detik

#### Acceptance Criteria Stage II
- Bisa mengerjakan task setara SWE-bench Verified (resolve GitHub issue nyata)
- Context window tidak "meledak" untuk codebase dengan >50 file
- Git history setelah eksekusi agent dapat di-review dan make sense

---

### Stage III — Multi-Agent Coordination *(Target: Minggu 6–10)*
> *"Specialized agents coordinate as teams, mirroring human engineering organizations"*
> Referensi: LangChain pilot — 93% reduction dalam root-cause identification time

Tujuan: agent berjalan sebagai tim dengan role berbeda, bisa paralel, punya shared memory.

#### P0
- [ ] **Agent roles** (berdasarkan Tabel 2 paper)
  - `ArchitectAgent` — terima requirement, output: architecture decision + file structure
  - `DeveloperAgent` — terima task spec, output: implementasi + unit tests
  - `QAAgent` — terima implementasi, output: test results + bug report
  - `CoordinatorAgent` — orchestrate ketiga agent di atas
- [ ] **Shared memory layer**
  - State yang semua agent bisa baca: current plan, files changed, decisions made
  - Immutable append-only log — tidak ada agent yang bisa overwrite history
  - Format: `SharedContext { plan, changelog: Entry[], decisions: Decision[] }`

#### P1
- [ ] **Parallel execution**
  - Task independen bisa dijalankan secara concurrent
  - Dependency graph untuk deteksi task mana yang bisa paralel
  - Conflict resolution jika dua agent mencoba edit file yang sama
- [ ] **Skill store** (dari Hermes Agent, Section 5.1)
  - Setelah agent berhasil menyelesaikan task, extract pattern sebagai "skill"
  - Skill = `{ name, trigger_pattern, steps: Step[], success_rate: number }`
  - Skill dipakai lagi jika task serupa muncul
  - Skill auto-patch jika dipakai dan gagal (self-improvement loop)
- [ ] **Episodic memory** (FTS5-backed, referensi Hermes)
  - Simpan conversation + outcome lintas session
  - Full-text search untuk retrieve pengalaman relevan
  - LLM summarization untuk compress episodic memory yang lama

#### P2
- [ ] **Observability dashboard** (Section 7.1: "Invest in observability infrastructure")
  - Visualisasi reasoning chain per agent
  - Timeline: agent mana yang mengerjakan apa, kapan, berapa lama
  - Anomaly detection: agent yang "diam" terlalu lama, loop tak berujung
- [ ] **Hallucination guard** (Section 7.2: "Verification in open-ended settings")
  - Deteksi ketika agent membuat klaim tentang kode yang tidak ada
  - Cross-validate dengan actual file contents sebelum eksekusi
  - Flag confident-wrong assertions vs admitted uncertainty

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

## Gap Analysis: Jujur Tentang Apa yang Belum Ada

| Kapabilitas | Status | Blocker |
|---|---|---|
| Plugin scaffold | ❌ Belum | Perlu baca OpenCode Plugin API docs |
| Intent parser | ❌ Belum | — |
| Basic executor | ❌ Belum | — |
| Session memory | ❌ Belum | — |
| Planner (Π) | ❌ Belum | Butuh intent parser selesai dulu |
| Context compressor | ❌ Belum | Butuh profil context window usage dulu |
| Multi-agent coordinator | ❌ Belum | Butuh Stage II stabil dulu |
| Skill store | ❌ Belum | Butuh data dari 10+ successful runs |
| Observability dashboard | ❌ Belum | Butuh trace logger Stage I dulu |

> **Prinsip**: Tidak ada ✅ palsu di sini. Setiap item pindah ke ✅ hanya jika ada test yang membuktikannya, bukan karena kodenya ada.

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

## Referensi

- Cao, Z. (2026). *The End of Software Engineering: How AI Agents Are Fundamentally Restructuring the Software Paradigm*. arXiv:2606.05608
- Wang et al. (2024). *Agents in Software Engineering: Survey, Landscape, and Vision*. arXiv:2409.09030
- Deng et al. (2026). *EvoClaw: Evaluating AI Agents on Continuous Software Evolution*. arXiv:2603.13428
- Kumar & Ramagopal (2026). *Agentic Engineering: How Swarms of AI Agents Are Redefining Software Engineering*. LangChain Blog
- Nous Research (2025–2026). *Hermes Agent: The Self-Improving AI Agent*. GitHub
- Yao et al. (2023). *ReAct: Synergizing Reasoning and Acting in Language Models*. ICLR
