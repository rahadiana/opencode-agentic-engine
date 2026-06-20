# OpenCode Agentic Engine

> **Plugin OpenCode** yang mengimplementasikan *agentic software engineering* workflow — domain-agnostic, autonomous planning, multi-agent collaboration, skill-based learning, model reliability tracking, dan self-evolution.

Berdasarkan konsep dari paper **"The End of Software Engineering"** (arXiv:2606.05608).

## Fitur

| Stage | Fitur | Deskripsi |
|---|---|---|
| **I** | Agentic Workflow | Plan → Execute → Verify → Retry dalam satu siklus otomatis |
| **II** | Codebase Intelligence | Navigasi kode, error propagation analysis, tech debt scoring |
| **III** | Multi-Agent | Delegasi ke arsitek/developer/QA, pipeline lintas-role, message bus |
| **IV** | Self-Evolution | Skill extraction & reuse, cross-session memory, auto-improvement |
| **V** | Autonomous Mode | `agentic_auto` — satu perintah, dari rencana sampai deploy |
| — | **Config** | `.agentic/config.json` — pengaturan plugin terpusat |
| — | **Model Registry** | Auto-discover model dari provider, tracking reliability & hallucination rate |
| — | **Dashboard** | Timeline, anomaly detection, model reliability stats |

### 29 Tools

| Tool | Stage | Description | Teknik Kunci |
|---|---|---|---|
| `agentic_plan` | I | Create structured execution plan. Auto-decompose via templates (create/fix/refactor/test/deploy/migrate/doc/perf/security/docker/CI) + LLM fallback | Template-based decomposition, scoring-based rule matching, cycle detection (Kahn's), LLM auto-decompose |
| `agentic_execute` | I | Record subtask completion. Auto-verify compile on success, error recovery guidance + propagation tracing, user feedback for continuous learning | File writing chokepoint, hallucination guard auto-check, skill auto-extract, budget step tracking |
| `agentic_reflect` | I | Analyze failed step: diagnose error category, trace error propagation across step chain via dependency graph, suggest recovery plan | Import graph traversal, transitive dependents analysis, multi-category error matching |
| `agentic_verify` | I | Full verification: compile + lint + test + semantic + security + performance + architecture + dependency audit (Gap #4). 3-tier system: fast/standard/deep | Multi-language execFileSync, compile cache, semantic LLM verification, domain verifier strategies |
| `agentic_status` | I | Execution dashboard: progress bar, health, blocked steps, dependency graph, retry history, file change summary | ExecutionState snapshot, topological dependency visualization |
| `agentic_nav` | II | Scan codebase for task-relevant files. Multi-language scanner (TS/JS/Python/PHP/Go/Rust/Java/generic) | LanguageConfig per bahasa, relevance scoring, import/export indexing |
| `agentic_context` | II | View & compress execution context. Summarizes conversation history preserving decisions, file changes, invariants | Rule-based extraction + LLM compression fallback, token estimation |
| `agentic_snapshot` | II | Save/restore/list execution checkpoints. Checkpoints store plan progress, file changes, decisions | Full state serialization, restore resets execution state |
| `agentic_pr` | II | Generate PR description from plan + step results + files changed. Optionally create actual PR via GitHub CLI (`gh`) | Plan→Step→Files summary pipeline, git integration |
| `agentic_score` | II | Technical debt analysis: coupling, file size, scope, code patterns (`any` type, TODO, casts) | Coupling analysis, file entropy, pattern detection |
| `agentic_model` | II | Configure per-role LLM model preferences per session. Persisted to `.agentic/models.json` | ModelRegistry alias resolution, per-task-type scoring |
| `agentic_model_reset` | II | Reset model statistics to recover from degraded performance. Single/stale/all modes | Quarantine system, stale detection (7d), consecutive failure tracking |
| `agentic_budget` | II | Circuit breaker for resource limits: tokens, steps, time, cost. Multi-scope (session/task) with per-model ledger | PDP/PEP pattern, 4-axis tracking, model price ledger |
| `agentic_delegate` | III | Assign task to specialist role (architect/developer/qa/coordinator/pm). Pipeline-aware with cross-validation + inter-agent messaging | Shared memory injection, skill context enrichment, delegation depth control |
| `agentic_pipeline` | III | Define & run multi-agent pipelines (PM→Arch→Dev→QA). Cross-validation between stages with formal contracts | PipelineContract (I/O schema), invariant checking, LLM cross-validation |
| `agentic_message` | III | Inter-agent messaging: send, inbox, conversation threads, review requests. 6 message types | Message bus with pruning (max 500/role), conversation threading |
| `agentic_parallel` | III | Dependency-based concurrency: analyze parallelism, execute ready steps concurrently with conflict detection | Kahn's algorithm phasing, Promise.allSettled, same-file conflict detection |
| `agentic_skill` | III | Extract/find/list reusable skills from successful task completions. Self-describing `agentic-skill/v1` format | Auto-extraction (success+completion+action markers), sliding window success rate |
| `agentic_episodes` | III | Cross-session memory search. Search past task outcomes to avoid repeating mistakes | TF-IDF relevance scoring, recency + success bonus, schema versioning |
| `agentic_dashboard` | III | Observability dashboard: timeline, statistics, tool usage, anomaly detection (timeout, retry storm, loop, silent failure), model reliability | 4 anomaly types, latency p50/p95/p99, peak concurrency via interval overlap |
| `agentic_guard` | III | Manual re-run of hallucination guard. Auto-runs inside agentic_execute; standalone for re-audit or detailed per-claim breakdown | 4 claim types verification, path traversal protection, multi-language function detection |
| `agentic_finetune` | III | End-to-end fine-tuning pipeline: prepare dataset → save → upload to OpenAI → create & monitor job | OpenAI API integration, hyperparameter config (epochs, batch, LR), polling |
| `agentic_evolve` | IV | Inspect & extend the agent system: register custom roles, versioned memory schemas, export skills, run self-evolution, prompt management | Versioned prompt history, rollback support, EvolutionReport generation |
| `agentic_auto` | V | Fully autonomous orchestrator: one call handles memory + skills → architecture → code → guard check → verify → score → learn | Full pipeline orchestration, auto-retry with strategy rotation, post-processing async |
| `agentic_debate` | 🏗 Blueprint | Executor ↔ Critic debate loop for thorough analysis. Multi-round: draft → review → revise until approved | Loop detection (identical output), configurable rounds (max 5) |
| `agentic_router` | 🏗 Blueprint | Lightweight intent classifier. Keyword-based routing (zero LLM cost) with LLM fallback for low-confidence | Keyword matching + LLM fallback, configurable categories |
| `agentic_clean` | 🏗 Blueprint | Strip debate artifacts, reformat to markdown/json, validate against schema. Post-processing for debate/analysis output | Regex stripping, LLM-based reformatting, schema validation |
| `agentic_rag` | 🏗 Blueprint | Multi-index RAG: store/search knowledge in category-segregated indices. Hybrid search (TF-IDF + Vector) | Per-category indexes, auto-category, vector enrichment via cosine similarity |
| `agentic_mcp` | 🏗 Blueprint | MCP client: connect to external servers (DB, APIs) via stdio or HTTP(S). Auto-discover tools via `tools/list`, call via JSON-RPC | JSON-RPC protocol, tool discovery, connection lifecycle management |

## Quick Start

### Via OpenCode CLI (Rekomendasi)

```bash
# Install global (tersedia di semua project):
opencode plugin opencode-agentic-engine@latest --global

# Atau install lokal (hanya untuk project ini):
opencode plugin opencode-agentic-engine@latest
```

Perintah ini otomatis:
1. Mengunduh package dari npm
2. Mendaftarkan plugin di config OpenCode (`~/.config/opencode/opencode.jsonc` untuk global, atau `opencode.json` lokal)
3. Plugin siap dipakai saat OpenCode di-restart

### Via Config (`opencode.json`)

```json
{
  "plugin": ["opencode-agentic-engine"]
}
```

OpenCode akan auto-install dari npm saat startup berikutnya.

### Drop-in (tanpa npm)

```bash
# Cukup copy satu file ke project OpenCode:
curl -L https://github.com/rahadiana/opencode-agentic-engine/releases/latest/download/index.js \
  -o .opencode/plugins/agentic-engine.js
```

OpenCode auto-load plugin dari folder `.opencode/plugins/` — tidak perlu konfigurasi tambahan.

Plugin akan auto-create `.agentic/config.json` dengan default saat pertama startup.

### Docker Deployment (dengan cloudflared tunnel)

```bash
cp .env.example .env
# Isi .env dengan API key LLM dan kredensial lainnya

docker compose up -d
```

Akses web di `http://localhost:4096` atau via tunnel URL dari cloudflared.

## Cara Pakai

### Autonomous Mode (Rekomendasi)

Cukup ketik perintah di agent **"Agentic"**:

```
buat aplikasi POS dengan Express, Vue 3, dan SQLite
```

Plugin akan otomatis: plan → implementasi → verify → retry → extract skill. Tanpa interupsi untuk konfirmasi izin (global permission allow-all).

### Manual Mode

Panggil tools langsung untuk kontrol lebih:

```
@agentic_auto goal="refactor src/core/executor.ts agar lebih modular"
```

Atau pipeline multi-agent:

```
@agentic_delegate role="architect" description="Desain arsitektur sistem billing"
@agentic_delegate role="developer" description="Implementasi sesuai desain arsitek"
@agentic_delegate role="qa" description="Review dan test hasil implementasi"
```

## Provider & Model

Plugin auto-mendeteksi semua model dari provider yang terdaftar di OpenCode via `client.config.providers()`. Tidak perlu konfigurasi manual — model muncul otomatis di dashboard dan status.

### Alias Model (Opsional)

Di `.env`, bisa set preferensi untuk dua kategori:

```env
FAST_MODEL=gpt-4o-mini      # Model cepat (default: auto-discovered)
CAPABLE_MODEL=gpt-4o         # Model kuat (default: auto-discovered)
```

### Embedding untuk Vector Search

```json
{
  "embedding": null
  // null → lightweight mode (TF-IDF, tanpa external dependency)
}
```

Atau dengan endpoint embedding khusus:

```json
{
  "embedding": {
    "model": "text-embedding-3-small",
    "endpoint": null,
    "apiKey": null
  }
}
```

- `endpoint: null` → pakai base URL dari provider yang sama
- `endpoint: "https://..."` → endpoint embedding khusus (Ollama, dll)
- `apiKey: null` → pakai key dari provider utama

### Provider OpenCode

Kompatibel dengan provider OpenAI-compatible. Konfigurasi di `opencode.json`:

```json
{
  "provider": {
    "custom-llm": {
      "name": "Provider Saya",
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "...", "apiKey": "..." },
      "models": { "model-name": {} }
    }
  }
}
```

## Konfigurasi Plugin (`.agentic/config.json`)

Auto-created saat pertama startup. Semua field opsional — default dipakai jika tidak di-set.

```json
{
  "$schema": "v1",
  "embedding": null,
  "memory": {
    "enabled": true,
    "mode": "lightweight",
    "maxEntries": 1000,
    "compressThreshold": 500,
    "forgetAfterDays": 30,
    "search": {
      "keywordWeight": 0.3,
      "vectorWeight": 0.7
    }
  },
  "agent": {
    "maxDelegationDepth": 3,
    "autoSkillExtract": true,
    "defaultRole": "developer"
  },
  "storage": {
    "traceRetentionDays": 7,
    "skillMaxCount": 200
  }
}
```

File ini di-watch — perubahan langsung diterapkan tanpa restart plugin.

## Arsitektur

```
src/
├── index.ts                 # Plugin entry: registers 29 tools + hooks
├── core/
│   ├── domain-registry.ts   # Domain pack system: tools, verifiers, error matchers
│   ├── domains/             # Built-in domain packs (generic, code)
│   │   ├── generic.ts
│   │   └── code.ts
│   ├── planner.ts           # Domain-aware auto-decompose (generic + code templates)
│   ├── executor.ts          # Step execution, domain-aware error categorization
│   ├── verifier.ts          # Compile + test + Gap #4: multi-dimensional (security, perf, arch, deps) with 3-tier system
│   ├── semantic-cache.ts    # Gap #7: TF-IDF + cosine similarity LLM response cache
│   ├── error-analyzer.ts    # Error categorization
│   ├── navigator.ts         # Multi-language codebase scanning (TS/JS/Py/PHP/Go/Rust/Java)
│   ├── prompt-builder.ts    # Dynamic agent prompt per active domain
│   ├── intent-parser.ts     # Parses user intent → Plan structure
│   ├── git.ts               # Git commit, history, PR description generation
│   ├── tech-debt-scorer.ts  # Coupling/size/scope/patterns analysis
│   └── parallel.ts          # Dependency-based concurrency + conflict detection
├── agents/                  # Multi-agent system
│   ├── coordinator.ts       # Delegates to agent roles, auto-suggests role, message bus
│   ├── orchestrator.ts      # Multi-agent workflow pipelines + cross-validation
│   └── role-registry.ts     # Built-in + custom agent definitions (extensible)
├── drift/                   # Context & safety
│   ├── dependency-tracker.ts     # Per-session file change + error propagation
│   ├── context-compressor.ts     # Sliding window + key info extraction
│   ├── checkpoints.ts            # Risk evaluation: BLOCK/REVIEW/WARNING
│   └── hallucination-guard.ts    # File/func/import claim verification
├── memory/                  # Persistent memory
│   ├── session-store.ts     # Conversation turns + plan + progress
│   ├── skill-store.ts       # Skill extraction, search, failure reporting
│   ├── skill-format.ts      # Self-describing agentic-skill/v1 schema
│   ├── episodic-store.ts    # Cross-session memory with versioned schema
│   ├── schema-version.ts    # Memory schema envelope + migration system
│   ├── skill-training.ts    # Skill → training data conversion (JSONL/instructions)
│   ├── vector-store.ts      # Sparse retrieval (TF-IDF)
│   ├── local-embedder.ts    # Local embedding for vector search
│   └── persistence.ts       # Model stats persistence
├── evaluation/
│   └── live-evaluator.ts    # 5-dimensi real-time scoring dari tool hooks
├── evolution/
│   ├── self-evolver.ts       # Auto-improvement analysis
│   └── continuous-evolution.ts # Continuous self-evolution pipeline
└── observability/
    ├── trace-logger.ts       # JSONL trace writer (buffered, auto-flush, dedup guard)
    └── dashboard.ts          # Timeline + stats + anomaly detection + model reliability
```

> **Note:** Domain packs (`core/domains/`) mendefinisikan tool set, verifier, error matchers, dan decomposition rules per domain. Prompt agent di-generate dinamis via `prompt-builder.ts` sesuai domain aktif. `navigator.ts` mendukung 8 bahasa (TS, JS, Python, PHP, Go, Rust, Java, Generic) dengan auto-deteksi dari project files.

## Engineering Techniques

Berikut teknik-teknik engineering yang digunakan di setiap modul, berdasarkan studi kode sumber:

### `core/` — Inti Engine (29 file)

| Kategori | Teknik | Detail |
|----------|--------|--------|
| **Planning** | Template-based decomposition | 13 template (create, fix, refactor, test, deploy, migrate, doc, perf, security, docker, CI/CD, research, generic) dengan scoring-based rule selection + cycle detection otomatis |
| **Planning** | LLM decomposition fallback | `decomposeWithLLM()` — panggil LLM untuk generate structured plan jika template tidak cocok |
| **Planning** | Multi-strategy scoring | Pattern match (2pt) + keyword match (1pt) + keyword density (0.5pt/kw) + domain bonus (1pt) |
| **Execution** | Dependency-based scheduling | `getReadySteps()` — topological order via Kahn's algorithm, hanya step dengan semua dependensi terpenuhi yang siap |
| **Execution** | Per-category retry policy | Retry limit berbeda per error category: import/type/compile/test/runtime/unknown dengan regex pattern matching |
| **Verification** | Formal contract (G5) | `FormalModel A=(M,T,M,Π)` — Pre/post-condition + invariant checking dengan pluggable `ConditionEvaluator` |
| **Verification** | Multi-language auto-detection | 6 bahasa (TS, JS, Python, Go, Rust, unknown) — deteksi via file marker (`tsconfig.json`, `Cargo.toml`, dll) |
| **Verification** | Semantic LLM verification | `verifySemantic()` — LLM memeriksa kesesuaian implementasi terhadap intent/goal |
| **Agent Loop** | Batch execution + conflict detection | `batchSteps()` — kelompokkan step non-konflik file → eksekusi parallel via `Promise.allSettled` |
| **Agent Loop** | Anti-stuck loop detection | Rolling window 60 detik dengan hash — break jika 5+ panggilan identik dalam 60s |
| **Agent Loop** | Circuit breaker (budget) | Cek BudgetTracker sebelum setiap iterasi & retry — stop jika exceeded |
| **Agent Loop** | Auto-retry with timeout | `Promise.race` step vs 120s timeout + ErrorAnalyzer untuk repair suggestion |
| **Agent Loop** | Observer pattern | `LoopObserver` — hooks untuk onStepStart, onStepComplete, onLoopComplete |
| **Auto-Retry** | Strategy rotation | 4 mode bergilir: direct_fix → conservative → type_first → split_changes |
| **Auto-Retry** | Exponential backoff + full jitter | `getBackoffDelay()` — baseDelay × 2^attempt, capped, lalu `Math.random() * maxDelay` |
| **Auto-Retry** | Selective rollback | Parse compile error untuk extract file paths via 4 metode — hanya rollback file bermasalah |
| **Auto-Retry** | Failure context injection | `buildRetryPrompt()` — sertakan error analysis + strategy instructions ke retry prompt |
| **LLM** | Multi-provider | 4 provider: OpenAI, Anthropic, Local (Ollama), OpenCode SDK — auto-detect dari env vars |
| **LLM** | Response caching | TTL 30 detik, bounded cache (1000 entries) — evict oldest 20% |
| **LLM** | JSON extraction fallback chain | 3 level: JSON.parse → ```json codeblock → regex match `{...key...}` |
| **LLM** | Memory context injection | Auto-inject 3 relevant episodes + 3 relevant skills ke setiap LLM call |
| **LLM** | Token usage → BudgetTracker | Setiap LLM call record tokens + cost estimation → feed ke BudgetTracker |
| **Event System** | Pub/sub EventBus | `on/onAny/emit` — unsubscribe function pattern, async-safe, sequential |
| **Event System** | Event taxonomy | 9 namespace: step.*, plan.*, pipeline.*, budget.*, guard.*, task.*, llm.*, file.*, memory.* |
| **Domain** | Domain Registry | Auto-detect domain, activate/deactivate, per-domain error matchers + verifier strategies |
| **Domain** | 6 domain packs | code (SE), data-science (ML), devops (infra), generic (fallback), mobile (Android/iOS), security (vuln) |

### `agents/` — Multi-Agent System (4 file)

| Kategori | Teknik | Detail |
|----------|--------|--------|
| **Runtime** | Isolated LLM per (session, role) | Setiap role mendapat instance LLMEngine sendiri dengan session ID unik |
| **Coordinator** | Shared memory with mutex | `writeSharedMemory()` dengan async mutex (queue-based) — atomic batch writes |
| **Coordinator** | Message bus | 6 message types: result, review_request, review_response, clarification, approval, revision |
| **Coordinator** | Task delegation with context | Auto-inject shared memory + relevant skills ke task description |
| **Coordinator** | Role suggestion | LLM first → keyword fallback untuk menentukan role terbaik |
| **Orchestrator** | Formal pipeline contracts | `PipelineContract` — Input/output schema per stage, pre/post-conditions, cross-stage invariants |
| **Orchestrator** | Schema validation | `validateSchema()` — cek field required dalam output JSON tiap stage |
| **Orchestrator** | LLM cross-validation (G4) | Schema checks + invariant checks + LLM semantic validation antar-stage |
| **Orchestrator** | 4 built-in pipelines | feature-dev (PM→Arch→Dev→QA), fix-verify, refactor-review, deploy-check |
| **Role Registry** | Versioned prompt history | Setiap role punya riwayat perubahan prompt dengan version tracking |
| **Role Registry** | Rollback support | `rollbackPrompt(role, version)` — revert ke versi prompt sebelumnya |
| **Role Registry** | 9 built-in roles | 5 engineering (architect, developer, qa, pm, coordinator) + 4 generic (analyst, builder, reviewer, planner) |

### `drift/` — Error Detection & Recovery (5 file)

| Kategori | Teknik | Detail |
|----------|--------|--------|
| **Checkpoints** | Risk-based checkpointing | 3 tipe: warning, review, block — block dapat hentikan eksekusi |
| **Checkpoints** | Risk evaluation | Deteksi: file deletion, mass changes, API changes, config/secret, system path, test-only, schema/migration |
| **Context** | Rule-based extraction | Ekstrak decisions, fileChanges, invariants, openItems via regex dari conversation |
| **Context** | LLM compression fallback | Jika context melebihi threshold, gunakan LLM untuk summarization |
| **Dependencies** | Import graph | Parse ESM/CommonJS/dynamic imports — build directed graph file-level |
| **Dependencies** | Error propagation analysis | `analyzeErrorPropagation()` — traverse dependents transitif untuk akar error |
| **Hallucination Guard** | Multi-claim verification | 4 tipe: file_exists, function_exists, import_valid, api_signature |
| **Hallucination Guard** | Path traversal protection | `resolveSafe()` — semua path harus di dalam worktree |
| **Hallucination Guard** | Multi-language function detection | Regex pattern per bahasa: TS/JS, Python, Go, Rust |
| **Pattern Discovery** | Cross-session pattern analysis | Analisis error patterns, file changes, session outcomes, skill effectiveness |
| **Pattern Discovery** | Trend computation | Bandingkan first-half vs second-half success rate untuk deteksi improving/degrading |

### `memory/` — Memory & Skill System (10 file)

| Kategori | Teknik | Detail |
|----------|--------|--------|
| **Episodic Store** | Cross-session memory | Record episode dengan tags, decisions, filesChanged — relevance scoring dengan TF + recency + success bonus |
| **Episodic Store** | Schema versioning | Envelope-based serialization dengan migrasi berantai |
| **Skill Store** | Auto-extraction | Deteksi pola extractable: success markers + completion markers + action words |
| **Skill Store** | Sliding window success rate | 20-window untuk hitung success rate akurat |
| **Skill Store** | TF-IDF skill search | Relevance scoring: token overlap + recency bonus + success rate bonus |
| **Skill Store** | Multi-lingual action verbs | English + Indonesian action verbs untuk step extraction |
| **RAG** | Multi-index RAG | Per-category indexes dengan hybrid search (TF-IDF + Vector) |
| **RAG** | Auto-category | Pilih kategori terbaik untuk query secara otomatis |
| **Vector Store** | TF-IDF tanpa dependensi | Inverted index per kategori, incremental indexing, title/keyword bonus |
| **Session Store** | TTL-based pruning | Auto-hapus sesi expired berdasarkan forgetAfterDays |
| **Training Data** | Skill → fine-tuning | Konversi skill & episode ke OpenAI JSONL atau instructions JSON |

### `evaluation/` — Live Evaluation (1 file)

| Kategori | Teknik | Detail |
|----------|--------|--------|
| **Weighted scoring** | 5 dimensi | taskSuccess (40%) + errorRecovery (20%) + contextStability (15%) + multiAgent (15%) + skillReuse (10%) |
| **Dual metrics** | SWE-bench & EvoClaw | Task success rate (SWE-bench style) + composite weighted score (EvoClaw style) |
| **Auto-tips** | Actionable feedback | Jika score < 80, generate tips spesifik per dimensi yang kurang |
| **Confidence interval** | Statistical rigor | Mean + stddev untuk setiap dimensi evaluasi |

### `evolution/` — Self-Evolution (2 file)

| Kategori | Teknik | Detail |
|----------|--------|--------|
| **Continuous Evolution** | Rolling window performance | 30-step sliding window — deteksi degrading/improving/stable |
| **Forecast (Gap #12)** | Predictive degradation | Bucket-based trend analysis + exponential smoothing untuk prediksi future success rate |
| **Seasonality** | Week-over-week | Deteksi cyclical patterns dengan perbandingan mingguan |
| **Hysteresis** | Cooldown protection | 2 menit cooldown + min 10 data points sebelum auto-evolve |
| **Self Evolver** | Skill patch generation | Analisis skill < 80% success rate → suggest fixes (rollback, retry, split, validate) |
| **Self Evolver** | Role suggestion | Deteksi pola kegagalan → suggest new agent roles |
| **Self Evolver** | Prompt patching | Map error categories → prompt instructions untuk role tertentu |

### `observability/` — Observability (2 file)

| Kategori | Teknik | Detail |
|----------|--------|--------|
| **Trace Logger** | JSONL buffered writer | Buffer 10 entries + auto-flush 5 detik — atomic file write |
| **Trace Logger** | Retention pruning | Auto-hapus trace tua berdasarkan retentionDays |
| **Dashboard** | 4 anomaly types | timeout (>30s), retry_storm (3+ failures), loop (sama dalam 5 step), silent_failure |
| **Dashboard** | Latency percentiles | p50/p95/p99 |
| **Dashboard** | Peak concurrency | Interval-based overlap detection |

### Design Patterns Used

| Pattern | Location |
|---------|----------|
| **Dependency Injection** | LLMEngine → Executor/Verifier/ErrorAnalyzer via setter methods |
| **Observer/Observable** | EventBus, AgentLoop.addObserver, DegradationCallback |
| **Strategy Pattern** | RetryStrategy rotation, DomainRegistry verifier strategies |
| **Chain of Responsibility** | JSON parsing fallback chain, condition evaluator chain, error analysis fallback |
| **State Machine** | ExecutionState (completed/failed/blocked), PipelineStage lifecycle |
| **Builder** | PromptTemplate XML composition (identity/instructions/guardrails) |
| **Circuit Breaker** | BudgetTracker multi-axis (tokens, steps, time, cost) |
| **Singleton** | Semua services di index.ts (Executor, Verifier, dll — lazy init) |
| **Template Method** | 13 planner templates dengan scoring-based selection |
| **Facade** | AgentLoop (orchestrates executor + verifier + errorAnalyzer) |
| **Mutex** | Coordinator shared memory — async queue-based mutex |

### ID Chain Architecture

```
sessionID ⊃ pipelineRunId ⊃ taskId ⊃ stepId
                                           
   ↓              ↓              ↓          ↓
[session]   [pipeline-run]    [task]     [step]
```

Format canonical: `run-{sessionID}-{pipelineId}`. Setiap level di-track dengan namespace terpisah untuk isolation dan dependency resolution.

## Testing

```bash
# Unit tests (544 tests, mock-based, no LLM needed)
node test/run.mjs

# Simulates opencode auto-discovery
node test/dropin.mjs

# Same-directory load + E2E workflow
node test/load-samedir.mjs

# EvoClaw: 50-file codebase, 5 iterations, 3-agent parallel
node test/e2e-scenario.mjs

# SWE-bench: 7 scenarios (auto: OpenCode Free)
node test/swebench-harness.mjs

# LLM E2E: 19 tests (auto: OpenCode Free)
node test/e2e-llm.mjs

# SWE-bench mock mode (no LLM)
LLM_OFF=true node test/swebench-harness.mjs

# Docker pipeline (7 layers, 544 unit + E2E tests)
./test-container.sh
```

## Model Reliability Dashboard

Plugin melacak keandalan model secara otomatis:

```
agentic_dashboard → Model Reliability
✅ gpt-4o — reliability: 95%, hallucinations: 1.2%, calls: 342
⚠️ gpt-4o-mini — reliability: 82%, hallucinations: 5.1%, calls: 891
```

- Setiap panggilan LLM dicatat (success/fail)
- HallucinationGuard mendeteksi klaim palsu
- Model otomatis terdegradasi jika `consecutiveFailures >= 3`
- Stats persist lintas session

## Logging

Semua aktivitas dicatat ke `.agentic/trace.jsonl`:
- Timeline setiap tool call
- Step execution + error propagation
- Retry history & anomaly detection

## Recent Updates

### v0.5.1 — Gap #4 Verification Fidelity + Gap #7 Semantic Cache (2026-06-20)

**Gap #4 — Multi-Dimensional Verification:**
- `verifier.ts` — `verifySecurity()`, `verifyPerformance()`, `verifyArchitecture()`, `verifyDeps()`
- `verifyAllDeep()` 3-tier system: fast (compile), standard (compile+lint+test), deep (all + security/perf/arch/deps)
- `DeepVerificationConfig` per-dimension toggle
- Agent loop: intermediate → standard, final → deep

**Gap #7 — Semantic Cache:**
- `semantic-cache.ts` — TF-IDF + cosine similarity LLM response cache
- LLMEngine integration: semantic lookup before exact-match cache
- `enableSemanticCache()` / `disableSemanticCache()` / `getSemanticCacheStats()`

**Other:**
- Trace dedup guard (false positive loop anomaly resolved)
- Model Reliability section in dashboard
- COLLABORATION_SCENARIOS.md + TOOLS.md updated
- **744 unit tests** (was 663)

### v0.4.6 — Comprehensive Engineering Documentation (2026-06-20)

### 📚 v0.4.6 — Comprehensive Engineering Documentation

- **Engineering Techniques section**: Dokumentasi lengkap 50+ teknik engineering per modul — algoritma, design patterns, dan pendekatan implementasi
- **Design Patterns catalog**: 11 design patterns yang digunakan (DI, Observer, Strategy, Chain of Responsibility, State Machine, Builder, Circuit Breaker, Singleton, Template Method, Facade, Mutex)
- **ID Chain documentation**: Visualisasi arsitektur `sessionID ⊃ pipelineRunId ⊃ taskId ⊃ stepId`

### 🚀 v0.4.5 — 2026-06-19

### 🚀 v0.4.4 — Domain-Agnostic + Sub-Agent Integration

**Domain-agnostic architecture:**
- **Domain packs**: `domain-registry.ts` + `core/domains/{generic,code}.ts` — setiap domain mendefinisikan tool set, verifier, error matchers, dan decomposition rules sendiri
- **Planner**: 4 generic templates (research/create/review/improve) untuk non-code tasks; code templates tetap backward-compatible dengan filtering via `activeDomain`
- **Executor**: `detectErrorCategory()` pakai domain error matchers dulu, fallback generic heuristic (timeout/error/unknown). Retry policies agnostik (3 entries: runtime=3, error=3, unknown=3)
- **Navigator**: **Multi-language** — 8 `LanguageConfig` bawaan (typescript, javascript, python, php, go, rust, java, generic). Auto-detect project language dari project files
- **Prompt builder** (`prompt-builder.ts`): Generate agent prompt dinamis per domain — auto-regenerate pada domain switch

**Sub-agents otomatis di main workflow:**
- **Domain packs**: `code.ts` + `generic.ts` — tambah `agentic_pipeline`, `agentic_message`, `agentic_parallel` ke tool list agent
- **`agentic_plan`**: deteksi pipeline cocok (feature-dev/fix-verify/refactor-review) & tampilkan saran di output
- **`agentic_execute`**: setelah 2× retry gagal, otomatis suggest `agentic_delegate` ke specialist (qa/developer/architect)
- **`agentic_parallel`**: delegate-based runner — register tiap step via `coordinator.delegate()` + enrich context dari shared memory
- **`agentic_auto`**: complex task jalankan pipeline delegation (developer → QA → cross-validation), bukan monolithic LLM call
- **555 unit tests** (was 544) — 11 test baru untuk sub-agent integration

### 🚀 v0.4.3 — Speed & Persistence Optimization

**LLM Call Optimization (Phase 3):**
- LLM returns JSON `{"files":[...]}` instead of markdown FILE: blocks — 40% fewer output tokens, instant parsing, enables `jsonMode: true`
- `maxTokens` reduced: 1024 simple / 2048 complex (was 2048/4096)
- File preview 150 chars (was 300), codebase summary 100 chars (was 200)
- System prompt compacted to 3 lines (JSON schema style)
- Architecture-first thinking: minimal prompt, faster generation

**Persistence Overhaul:**
- **Hybrid global+local storage**: Global `~/.config/opencode/agentic-store/` shared across all projects + local `.agentic/store/` overrides
- `ContinuousEvolution` and `LiveEvaluator` now persist via `toJSON()`/`fromJSON()` — no more data loss on restart
- Cross-project learning enabled: episodes, skills, evolution trends survive project switches

**Other Improvements:**
- `agentic_model_reset` tool added — reset single, stale, or all model stats
- `agentic_auto` post-processing is now fire-and-forget (non-blocking) — guard check, episode record, skill extract, tech-debt scoring run async after returning result
- Debate retry removed (was slowing things down 2-4× on compile failures)
- HallucinationGuard integrated into `agentic_auto` pipeline

### v0.4.0 — Blueprint Layers + Hybrid RAG

**5 Blueprint Layers Complete ✅**

| Layer | File | Tool | Status |
|-------|------|------|--------|
| L1 — MCP Client | `src/core/mcp-client.ts` | `agentic_mcp` | ✅ |
| L2 — Debate Loop | `src/core/debate-loop.ts` | `agentic_debate` | ✅ |
| L3 — Data Cleaner | `src/core/data-cleaner.ts` | `agentic_clean` | ✅ |
| L4 — Multi-Index RAG | `src/memory/multi-index-rag.ts` | `agentic_rag` | ✅ |
| L5 — Router Agent | `src/core/router-agent.ts` | `agentic_router` | ✅ |

**TF-IDF + Vector Hybrid Search:**
- VectorStore: TF-IDF sparse retrieval, Unicode tokenization, zero external deps
- LocalEmbedder: Vector embeddings via OpenAI-compatible endpoint
- MultiIndexRAG: `lightweight` (TF-IDF only) or `full` (hybrid) mode
- Configurable weights: `keywordWeight: 0.3`, `vectorWeight: 0.7`

### Stats

- **29 tools** (was 21) — 5 stages + 5 blueprints
- **744 unit tests** — mock-based, no LLM needed
- **v0.5.1** — latest release

## License

MIT
