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

### 33 Tools

| Tool | Stage | Description | Teknik Kunci |
|---|---|---|---|
| `agentic_plan` | I | Create structured execution plan. Auto-decompose via templates + LLM fallback | Template decomposition, cycle detection (Kahn's), LLM auto-decompose |
| `agentic_execute` | I | Record subtask completion. Auto-verify compile, hallucination guard, skill extraction | File writing chokepoint, auto-guard, auto-skill, budget tracking |
| `agentic_reflect` | I | Analyze failed step: error category + propagation trace | Import graph traversal, transitive dependents, multi-category error matching |
| `agentic_verify` | I | Full verification: compile+lint+test+security+perf+arch+deps (Gap #4). 3-tier: fast/standard/deep | Multi-language exec, semantic LLM verification, 4 security dimensions |
| `agentic_status` | I | Execution dashboard: progress, blocked steps, retry history | ExecutionState snapshot, topological dependency viz |
| `agentic_nav` | II | Scan codebase for relevant files. Multi-language (TS/JS/Python/PHP/Go/Rust/Java) | LanguageConfig, relevance scoring, import/export indexing |
| `agentic_context` | II | View & compress execution context | Rule-based extraction + LLM compression, token estimation |
| `agentic_snapshot` | II | Save/restore/list execution checkpoints | Full state serialization, restore resets execution state |
| `agentic_pr` | II | Generate PR description, optionally create via `gh` CLI | Plan→Step→Files pipeline, git integration |
| `agentic_score` | II | Technical debt: coupling, file size, scope, patterns | Coupling analysis, file entropy, pattern detection |
| `agentic_model` | II | Per-role/per-tool/per-category LLM model preferences. Persisted to `.agentic/models.json` | ModelRegistry alias, 3-level resolution |
| `agentic_model_reset` | II | Reset model stats: single/stale/all modes | Quarantine, stale detection (7d), consecutive failure tracking |
| `agentic_budget` | II | Circuit breaker: tokens, steps, time, cost. Multi-scope (session/task) | PDP/PEP, 4-axis tracking, model price ledger |
| `agentic_delegate` | III | Assign task to specialist (architect/developer/qa/coordinator/pm). Pipeline-aware | Shared memory injection, skill context, delegation depth control |
| `agentic_pipeline` | III | Define & run multi-agent pipelines (PM→Arch→Dev→QA). Cross-validation | PipelineContract, invariant checking, LLM cross-validation |
| `agentic_message` | III | Inter-agent messaging: send, inbox, conversation, review | Message bus with pruning (max 500), conversation threading |
| `agentic_parallel` | III | Dependency-based concurrency + conflict detection | Kahn's algorithm, Promise.allSettled, same-file conflict |
| `agentic_skill` | III | Extract/find/list/clear reusable skills. `agentic-skill/v1` format | Auto-extraction, sliding window success rate, TF-IDF search |
| `agentic_episodes` | III | Cross-session memory search | TF-IDF + recency + success bonus, schema versioning |
| `agentic_dashboard` | III | Observability dashboard: timeline, stats, anomaly detection, model reliability | 4 anomaly types, p50/p95/p99, peak concurrency |
| `agentic_guard` | III | Manual hallucination guard re-run (auto-runs on execute) | 4 claim types, path traversal protection, multi-language |
| `agentic_finetune` | III | End-to-end fine-tuning: prepare→save→upload→create→monitor | OpenAI API, hyperparameter config, polling |
| `agentic_evolve` | IV | Inspect & extend agent system: register roles, manage prompts, export skills | Versioned prompt history, rollback, EvolutionReport |
| `agentic_auto` | V | Fully autonomous: plan→execute→verify→retry→score→learn in one call | Full pipeline orchestration, auto-retry, post-processing async |
| `agentic_debate` | 🏗 | Executor ↔ Critic debate via sub-agent spawn. Multi-round with fallback | Sub-agent via AgentRuntime, Levenshtein loop detection, `[NO_LLM]` fallback |
| `agentic_router` | 🏗 | Lightweight intent classifier. Keyword-based + LLM fallback | Keyword matching + LLM fallback, configurable categories |
| `agentic_clean` | 🏗 | Strip artifacts, reformat markdown/json, validate against schema | Regex + LLM reformatting, schema validation |
| `agentic_rag` | 🏗 | Multi-index RAG: store/search in category-segregated indexes | Per-category indexes, hybrid TF-IDF + vector search |
| `agentic_mcp` | 🏗 | MCP client: connect to external servers (stdio/HTTP), discover & call tools | JSON-RPC protocol, tool discovery, connection lifecycle |
| `agentic_a2a` | 🏗 | Agent-to-Agent protocol: discover, delegate, serve Agent Card | Google A2A standard, JSON-RPC task delegation, HTTP transport |
| `agentic_db` | 🏗 | SQLite backend: query, save/load, list, stats, tables | Raw SQL, key-value namespace, JSON schema |
| `agentic_mcp_server` | 🏗 | Start/stop MCP server exposing plugin tools via standard MCP protocol | MCP stdio transport, tool discovery, lifecycle management |
| `agentic_tools` | 🏗 | Unified tool discovery across MCP + A2A. Search, call, list, stats | Multi-protocol routing, cross-protocol search |

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
├── index.ts                 # Plugin entry: registers 33 tools + 6 hooks
├── core/                    # Inti engine (70+ file)
│   ├── planner*.ts          # Planner, critic, tree-search, data, utils — auto-decompose
│   ├── planning-layer.ts    # Orchestrates planning subsystem
│   ├── agent-loop.ts        # Autonomous loop: plan → execute → verify → retry
│   ├── execution-layer.ts   # Exec subsystem orchestrator
│   ├── executor.ts          # Step execution, retry tracking
│   ├── recovery-layer.ts    # Error recovery orchestrator
│   ├── auto-retry.ts        # Exponential backoff + strategy rotation
│   ├── verifier.ts          # Gap #4: 3-tier (fast/standard/deep), 4 security dimensions
│   ├── semantic-cache.ts    # Gap #7: TF-IDF + cosine similarity LLM cache
│   ├── llm.ts               # LLM engine via OpenCode SDK
│   ├── model-registry.ts    # Per-role model prefs + reliability tracking
│   ├── prompt-builder.ts    # Dynamic prompt construction
│   ├── prompt-template.ts   # XML-based prompt templates
│   ├── code-sandbox.ts      # Sandboxed code execution (VM)
│   ├── domain-registry.ts   # Domain packs + generators (code/devops/mobile/...)
│   ├── dsl-*.ts             # DSL executor/types/validator
│   ├── dag-engine.ts        # DAG execution engine
│   ├── event-bus.ts         # Pub/sub event system
│   ├── debate-loop.ts       # Sub-agent debate (executor ↔ critic)
│   ├── navigator.ts         # Multi-language codebase scanner
│   ├── git.ts               # Git integration
│   ├── tech-debt-scorer.ts  # Coupling/size/scope/patterns analysis
│   ├── parallel.ts          # Dependency-based concurrency
│   ├── tool-router.ts       # Tool routing
│   ├── mcp-client.ts        # MCP client
│   ├── mcp-server.ts        # MCP server
│   └── ...                  # 40+ file lainnya (formal-model, world-model, dll)
├── agents/                  # Multi-agent (7 file)
│   ├── coordinator.ts       # Delegation, auto-suggest role, message bus
│   ├── orchestrator.ts      # Workflow pipelines + cross-validation
│   ├── role-registry.ts     # Built-in + custom roles, versioned prompts
│   ├── agent-runtime.ts     # Sub-process spawner, isolated LLM per role
│   ├── a2a-client.ts        # A2A protocol client
│   ├── a2a-server.ts        # A2A protocol server
│   └── a2a-types.ts         # A2A types
├── drift/                   # Error detection & recovery (5 file)
│   ├── checkpoints.ts       # Risk eval: BLOCK/REVIEW/WARNING
│   ├── context-compressor.ts
│   ├── dependency-tracker.ts
│   ├── hallucination-guard.ts
│   └── pattern-discovery.ts
├── memory/                  # Persistence & memory (19 file)
│   ├── episodic-store.ts    # Cross-session memory
│   ├── skill-store.ts       # Skill extraction/search/clear
│   ├── multi-index-rag.ts   # Hybrid TF-IDF + vector RAG
│   ├── session-store.ts     # Conversation turns + plan
│   ├── vector-store.ts      # TF-IDF vector search
│   ├── sqlite-persistence.ts
│   ├── memory-orchestrator.ts
│   ├── consolidation-scheduler.ts
│   └── ...                  # 11 file lainnya
├── evaluation/
│   └── live-evaluator.ts    # 5-dimensi real-time scoring
├── evolution/
│   ├── self-evolver.ts       # Skill patch, role suggestion
│   └── continuous-evolution.ts # Rolling window performance monitoring
└── observability/
    ├── trace-logger.ts       # JSONL buffered writer
    ├── dashboard.ts          # Timeline, anomaly, model reliability
    └── logger.ts             # Structured logger
```

> **Note:** Domain packs (`core/domains/`) mendefinisikan tool set, verifier, error matchers, dan decomposition rules per domain. Prompt agent di-generate dinamis via `prompt-builder.ts` sesuai domain aktif. `navigator.ts` mendukung 8 bahasa (TS, JS, Python, PHP, Go, Rust, Java, Generic) dengan auto-deteksi dari project files.

## Engineering Techniques

Berikut teknik-teknik engineering yang digunakan di setiap modul, berdasarkan studi kode sumber:

### `core/` — Inti Engine (44 file)

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

### `agents/` — Multi-Agent System (6 file)

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
| **A2A Server** | Agent-to-Agent HTTP server | Google A2A standard — Agent Card discovery, JSON-RPC task delegation |
| **A2A Client** | Remote agent communication | Discover and delegate tasks to remote A2A-compatible agents |

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

### `memory/` — Memory & Skill System (13 file)

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
# Unit tests (1779 tests, mock-based, no LLM needed)
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

# Docker pipeline (7 layers, 1779 unit + E2E tests)
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
- Model otomatis terdegradasi jika `consecutiveFailures >= 5`
- Stats persist lintas session

## Logging

Semua aktivitas dicatat ke `.agentic/trace.jsonl`:
- Timeline setiap tool call
- Step execution + error propagation
- Retry history & anomaly detection

## License

MIT
