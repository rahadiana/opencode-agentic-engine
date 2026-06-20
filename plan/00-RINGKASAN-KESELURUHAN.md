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
