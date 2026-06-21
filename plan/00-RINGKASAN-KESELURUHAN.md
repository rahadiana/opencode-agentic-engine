# RINGKASAN PERBANDINGAN KESELURUHAN

## opencode-agentic-engine (Kita) vs rahadiana/autonomous-agent (Mereka)

Tanggal: 20 Juni 2026
Total file MARKDOWN_PLAN: 24
Total source code dibaca: 6 file
Total perbandingan: 25 file

---

## 1. Perbedaan Filosofis Paling Dasar

| Aspek | Kita | Mereka |
|-------|------|--------|
| **Paradigma** | Prompt Engineering → LLM panggil tools | DSL-First → Interpreter deterministic |
| **Role LLM** | Di SEMUA tahap (plan, execute, verify) | Hanya di GENERATE skill/test/evaluate |
| **Execution** | LLM baca plan → decide tool → call | Interpreter jalanin op-by-op |
| **Predictability** | Medium (tergantung LLM) | High (deterministic) |
| **Safety** | Via OpenCode platform | Via VM sandbox + whitelist ops |
| **Testing** | Post-execution verification | Pre-execution + Post-execution |

## 2. Apa yang Kita UNGGUL (harus dipertahankan)

1. **29 Tool Ecosystem** — specialized untuk software engineering
2. **Multi-dimensional Verification** — compile, test, security, perf, arch, deps
3. **RAG + Vector + Episodic Memory** — infrastruktur memory lengkap
4. **Multi-Agent Pipeline** — PM → Arch → Dev → QA dengan cross-validation
5. **Event Bus + Tool Hooks** — observable execution
6. **744 Unit Tests** — coverage tinggi
7. **Plugin Architecture** — langsung terintegrasi OpenCode
8. **Hallucination Guard** — verifikasi klaim file/fungsi/import
9. **Tech Debt Scoring** — code quality analysis
10. **Self-Evolution (Stage IV)** — prompt evolution

## 3. Apa yang MEREKA UNGGUL (bisa kita adopsi)

### PRIORITAS TINGGI (dampak besar, effort sedang)

| # | Konsep | File | Dampak |
|---|--------|------|--------|
| 1 | **DSL Executor** | `03-executor-validator-test` | Tool calling deterministic |
| 2 | **Schema Validation** | `03-executor-validator-test` | Input/output type safety |
| 3 | **Skill JSON Executable** | `01-introduction` | Skill bisa dieksekusi langsung |
| 4 | **Capability-based Lookup** | `02-start-planning` | Exact match skill discovery |
| 5 | **Reinforcement Learning** | `10-skill-memory-learning` | Skill quality improvement |

### PRIORITAS SEDANG (dampak sedang, effort sedang)

| # | Konsep | File | Dampak |
|---|--------|------|--------|
| 6 | **Tree Search Planner** | `12-tree-search-planner` | Plan quality improvement |
| 7 | **Self-Reflection Loop** | `13-llm-planner-critic` | Plan refinement before exec |
| 8 | **Hierarchical Planning** | `14-hierarchical-planner` | Complex task decomposition |
| 9 | **Episodic Plan Reuse** | `15-episodic-memory-reuse` | Faster planning |
| 10 | **Blackboard Architecture** | `17-blackboard-shared-memory` | Flexible agent coordination |

### PRIORITAS RENDAH (dampak kecil untuk tool calling)

| # | Konsep | File |
|---|--------|------|
| 11 | MCP dalam DSL | `04-mcp_call-dsl` |
| 12 | Conditional/Branching | `05-conditional-branching` |
| 13 | Call Skill Composition | `06-call_skill-composition` |
| 14 | Map/Array Processing | `07-map-array-processing` |
| 15 | Filter/Reduce/Aggregator | `08-filter-reduce-aggregator` |
| 16 | Embedding Vector Search | `09-embedding-vector-search` |
| 17 | Bandit Mutation | `11-bandit-mutation` |
| 18 | Attention Scheduler | `18-attention-priority-scheduler` |
| 19 | World Model Belief | `19-world-model-belief-state` |
| 20 | Imagination Engine | `20-internal-simulation-imagination` |
| 21 | Goal Curiosity | `21-autonomous-goal-curiosity` |
| 22 | Meta-Reasoning | `22-meta-reasoning-self-improvement` |
| 23 | Self-Modifying | `23-self-modifying-architecture` |
| 24 | Code Generation Sandbox | `24-code-generation-sandbox` |

## 4. Rekomendasi Implementasi (Urutan)

### Phase 1: DSL Executor + Schema Validation (NOW)
- Bikin `src/core/dsl-executor.ts` — interpreter untuk `op: "get" | "set" | "add" | "mcp_call" | "compare" | "if"`
- Bikin `src/core/skill-schema.ts` — `input_schema` + `output_schema` validation
- Update `SkillDefinition` di skill-format.ts — tambah `logic`, `input_schema`, `output_schema`

### Phase 2: Skill Registry + Reinforcement (Next)
- Bikin capability-based exact match lookup
- Implementasi reinforcement formula: `score = (old * 0.7) + (successRate * 0.3)`
- Implementasi decay + pruning

### Phase 3: Planner Enhancement (Future)
- Integrasi tree search ke planner
- Self-reflection loop: generate → critic → refine

## 5. Matriks Coverage

| Domain | Kita | Mereka | Gap |
|--------|------|--------|-----|
| **Execution Engine** | LLM-driven | DSL Interpreter | KRITIS |
| **Skill System** | Descriptive | Executable JSON | BESAR |
| **Planning** | LLM + Templates | Tree Search + LLM | SEDANG |
| **Verification** | Multi-dimension | Schema + Test | SETARA |
| **Memory** | RAG + Vector + Episodic | Episodic + Vector | KITA UNGGUL |
| **Multi-Agent** | Pipeline + Roles | Blackboard + Pub/Sub | SETARA |
| **Learning** | Skill extraction | Reinforcement + Decay | MEREKA UNGGUL |
| **Safety** | Platform-level | VM Sandbox | SETARA |
| **Tools** | 29 specialized | 6 generic | KITA UNGGUL |
| **Self-Evolution** | Prompt evolution | Strategy + Structure | SETARA |

---

**Kesimpulan Akhir:**
Kita perlu adopsi **DSL Executor + Schema Validation** dari mereka untuk solve masalah tool calling effectiveness. Ini adalah foundational gap yang bikin tool calling kita kurang efektif — LLM harus "nulis ulang" instruksi di setiap langkah, sementara mereka punya interpreter deterministic yang tinggal jalanin op.

---

## 6. Status Implementasi (21 Juni 2026)

### ✅ Sudah Diimplementasikan (23 dari 25 komparasi)

| # | Konsep | File | Tests | Keterangan |
|---|--------|------|-------|------------|
| 1 | **Self-Improvement Loop** | `src/core/skill-improver.ts` | 12 (SKI-1a–7a) | Generate→test→evaluate→improve→store, scoring correctness×0.4 + schema×0.2 + reusability×0.2 + efficiency×0.2 |
| 2 | **Skill Executable JSON** | `src/memory/skill-format.ts` | — | SkillDefinition dengan logic, input_schema, output_schema |
| 3 | **DSL Executor** | `src/core/dsl-executor.ts` | 50 (DSL-1a–45b) | get/set/add/mcp_call/compare/if/jump/call_skill/sum/avg/count/min/max |
| 4 | **Schema Validation** | `src/core/skill-schema.ts` | 40 (SCHEMA-1a–14c) | parseOrThrow, JSON Schema generation, type inference |
| 5 | **MCP dalam DSL** | `src/core/dsl-executor.ts` | — | mcp_call op untuk integrasi external tools |
| 6 | **Jump Op** | `src/core/dsl-executor.ts` | 14 (DSL-39–45) | IP-based while loop, MAX_EXECUTION_STEPS=200, bounds validation |
| 7 | **Call Skill Composition** | `src/core/dsl-executor.ts` | — | call_skill op, atomic + composite skill execution |
| 8 | **Filter/Reduce/Aggregator** | `src/core/dsl-executor.ts` | — | sum/avg/count/min/max ops |
| 9 | **Capability-based Lookup** | `src/memory/skill-store.ts` | — | exact match + keyword skill discovery |
| 10 | **Reinforcement Learning** | `src/memory/skill-store.ts` | 13 (B1a–B5a) | UCB1 bandit mutation, evaluateMutation, findWithBandit |
| 11 | **Embedding Vector Search** | `src/memory/vector-store.ts` | 12 (VS-1a–6b) | TF-IDF sparse retrieval, vector-enhanced skill search |
| 12 | **Tree Search Planner** | `src/core/planner-tree-search.ts` | 45 (TS-1a–17b) | Beam search plan exploration, diversity bonus, early stopping |
| 13 | **Self-Reflection Loop** | `src/core/planner-critic.ts` | — | PlannerCritic: LLM-based critique + refine |
| 14 | **Hierarchical Planning** | `src/core/planner.ts` | 18 (HP-1a–10c) | Context passing, retryPhase, criticizeSubgoal |
| 15 | **Episodic Plan Reuse** | `src/memory/episodic-store.ts` | — | Cross-session memory retrieval |
| 16+17 | **Blackboard Architecture** | `src/agents/coordinator.ts` | 16 (BBC-1a–6a) | Phase status, phase lock, critique loop with retry |
| 18 | **Attention Scheduler** | `src/core/attention-scheduler.ts` | 23 (AS-1a–9a) | Focus slice attention, dynamic priority, starvation prevention |
| 19 | **World Model Belief** | `src/core/world-model.ts` | 25 (WM-1a–9b) | Entities/relations, belief with confidence, decay, conflict resolution |
| 20 | **Imagination Engine** | `src/core/simulation-engine.ts` | 13 (SE-1a–6a) | Pre-execution simulation, imagination scoring, cycle detection, cache |
| 22 | **Meta-Reasoning** | `src/core/meta-reasoner.ts` | 18 (MR-1a–8b) | Strategy config auto-tuning, performance analysis, versioned rollback |
| 24 | **Code Generation Sandbox** | `src/core/code-sandbox.ts` | 51 (SANDBOX-1a–20b) | VM sandbox, banned tokens, module registry, test pipeline |

### ⬜ Belum Diimplementasikan (2 komparasi)

| # | Konsep | Alasan Ditinggalkan | Dokumentasi Lengkap |
|---|--------|---------------------|---------------------|
| 21 | **Autonomous Goal Curiosity** | **Stage V concept — terlalu advanced untuk tool calling improvement saat ini** | Lihat `plan/21-comparison-21-autonomous-goal-curiosity.md` |
| 23 | **Self-Modifying Architecture** | **Terlalu berisiko — bisa destabilkan plugin dengan mengubah struktur sistem sendiri** | Lihat `plan/23-comparison-23-self-modifying-architecture.md` |

### 📋 Dokumentasi Detail — Komparasi yang Ditinggalkan

#### COMP 21: Autonomous Goal Generation + Curiosity System

**Source:** `plan/21-comparison-21-autonomous-goal-curiosity.md`

**Inti Konsep:**
- **Curiosity Engine**: Hitung curiosity dari 3 sumber — uncertainty (belief rendah), novelty (entity baru), prediction error
- **Goal Generator**: Jika curiosity > threshold → generate goals untuk explore gaps pengetahuan
- **Goal Queue**: Priority-sorted queue dengan source "external" (dari user) atau "curiosity" (dari agent sendiri)
- **Goal Manager Agent**: Agent khusus priority 4 yang jalan tiap cycle untuk manage goals
- **Safety**: MAX_GOALS = 20, CURIOSITY_THRESHOLD = 2, deduplication, decay

**Yang Kita Punya (bisa jadi foundation):**
| Komponen | File | Relevance |
|----------|------|-----------|
| Router Agent | `src/core/router-agent.ts` | Intent classification — bisa untuk detect "knowledge gaps" |
| Intent Parser | `src/core/intent-parser.ts` | Parse user intent → Plan structure |
| Task Classifier | `src/core/task-classifier.ts` | Task type classification |
| Self Evolver | `src/evolution/self-evolver.ts` | Agent prompt evolution — bisa diperluas untuk goal generation |
| WorldModel | `src/core/world-model.ts` | Belief state dengan confidence — foundation untuk curiosity scoring |
| AttentionScheduler | `src/core/attention-scheduler.ts` | Priority-based scheduling — goal queue bisa integrasi di sini |

**Gap Analysis:**
1. **❌ Curiosity Engine** — Tidak ada mekanisme "rasa ingin tahu" yang mendorong eksplorasi
2. **❌ Autonomous Goal Generation** — Semua goal datang dari user. Agent tidak punya inisiatif sendiri
3. **❌ Goal Queue** — Tidak ada priority queue untuk multiple goals
4. **❌ Intrinsic Motivation** — Tidak ada sistem reward internal untuk exploration
5. **❌ Goal Manager Agent** — Tidak ada agent khusus yang manage goals

**Keputusan: SKIP — Stage V (Fully Autonomous)**
- Alasan: Ini adalah fitur Stage V yang membutuhkan agent bisa generate goals sendiri tanpa input user
- Dampak jika diimplementasi sekarang: Berisiko tinggi karena agent bisa memulai aksi yang tidak diminta user
- Untuk implementasi future: Integrasi dengan WorldModel (confidence → curiosity), AttentionScheduler (goal queue priority), dan Coordinator (goal manager agent)
- Referensi: Curiosity-driven exploration in RL (Pathak et al., 2017), Intrinsic Motivation in AI

---

#### COMP 23: Self-Modifying Architecture

**Source:** `plan/23-comparison-23-self-modifying-architecture.md`

**Inti Konsep:**
- Agent bisa **mengubah struktur dirinya sendiri** — skill logic, strategy config, planner params
- **TAPI tidak boleh** mengubah: core executor, sandbox security, validation layer (safety boundaries)
- **Modifier Agent**: Generate proposal perubahan dengan format `{ target, action, payload, reason, expected_improvement }`
- **Validator**: Strict validation sebelum apply — validateDSL, bounds checking
- **Sandbox Test**: Test modification dulu sebelum apply (A/B test dengan新旧 comparison)
- **Acceptance Rule**: Hanya jika `newScore > oldScore + 0.05`
- **Versioning**: Setiap perubahan = system version baru, bisa rollback kapan saja
- **Safety**: MAX_MODIFICATIONS_PER_CYCLE = 1, cooldown 5 cycles, kill switch

**Yang Kita Punya (bisa jadi foundation):**
| Komponen | File | Relevance |
|----------|------|-----------|
| Self Evolver | `src/evolution/self-evolver.ts` | Prompt evolution — bisa diperluas untuk structural modification |
| ContinuousEvolution | `src/evolution/continuous-evolution.ts` | Continuous loop — trigger untuk self-modification cycle |
| Skill Training | `src/memory/skill-training.ts` | Export skill → training data |
| Agentic_evolve Tool | `src/index.ts` (agentic_evolve tool) | Inspect + extend agent system |
| CodeSandbox | `src/core/code-sandbox.ts` | Sandbox execution — foundation untuk test modification sebelum apply |
| SimulationEngine | `src/core/simulation-engine.ts` | Pre-execution simulation — bisa untuk A/B test |
| MetaReasoner | `src/core/meta-reasoner.ts` | Strategy versioning + rollback — pattern yang sama |

**Gap Analysis:**
1. **❌ Structural Modification** — Self-evolver kita cuma bisa ubah prompt, bukan struktur sistem (skill logic, strategy config, etc.)
2. **❌ Modifier Agent** — Tidak ada agent yang generate proposal perubahan dengan format terstruktur
3. **❌ Sandbox Test** — Tidak ada mekanisme test perubahan sebelum apply ke production
4. **❌ System Versioning** — Tidak ada versioning untuk seluruh system state (config, skills, prompts)
5. **❌ Rollback Mechanism** — MetaReasoner punya strategy rollback, tapi belum untuk system-level
6. **❌ Kill Switch** — Tidak ada safety mechanism untuk auto-revert jika perubahan gagal

**Keputusan: SKIP — Stage V (Self-Modifying)**
- Alasan: Ini adalah level paling advanced. Agent bisa mengubah kodenya sendiri — risiko stabilitas sangat tinggi
- Dampak jika diimplementasi sekarang: Bisa merusak plugin yang sudah stabil (1061+ tests). Safety mechanism-nya kompleks
- Untuk implementasi future: Mulai dari read-only self-inspection dulu, lalu sandboxed modification, baru production modification
- Prasyarat: CodeSandbox sudah ada (comparison 24), SimulationEngine untuk pre-test sudah ada (comparison 20)
- Referensi: Self-modifying code patterns, EvolveR (ICLR 2026), ReMA multi-agent meta-thinking

---

## 7. Coverage Matriks Lengkap (21 Juni 2026)

| Domain | Kita | Mereka | Status |
|--------|------|--------|--------|
| **Execution Engine** | LLM-driven + DSL Interpreter | DSL Interpreter | ✅ SETARA (kita punya keduanya) |
| **Skill System** | Descriptive + Executable JSON | Executable JSON | ✅ SETARA |
| **Planning** | LLM + Tree Search + Hierarchical | Tree Search + LLM | ✅ KITA UNGGUL |
| **Verification** | Multi-dimension (compile, test, security, perf, arch, deps) | Schema + Test | ✅ KITA UNGGUL |
| **Memory** | RAG + Vector + Episodic + World Model | Episodic + Vector | ✅ KITA UNGGUL |
| **Multi-Agent** | Pipeline + Roles + Blackboard + Scheduler | Blackboard + Pub/Sub | ✅ KITA UNGGUL |
| **Learning** | Skill extraction + Bandit + Self-Improvement | Reinforcement + Decay | ✅ KITA UNGGUL |
| **Safety** | Platform-level + VM Sandbox | VM Sandbox | ✅ SETARA |
| **Tools** | 29 specialized | 6 generic | ✅ KITA UNGGUL |
| **Self-Evolution** | Prompt evolution + Meta-Reasoning + Strategy | Strategy + Structure | ✅ KITA UNGGUL |

**Total Tests:** 1117 passed, 0 failed
**Total Source Files:** 52 file di src/
**Total New Modules:** 11 file baru (dsl-executor, skill-schema, code-sandbox, planner-tree-search, skill-improver, attention-scheduler, world-model, simulation-engine, meta-reasoner, + 2 enhancement)
