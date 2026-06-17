# OpenCode Agentic Engine

> **Plugin OpenCode** yang mengimplementasikan *agentic software engineering* workflow — autonomous planning, multi-agent collaboration, skill-based learning, model reliability tracking, dan self-evolution.

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

### 27 Tools

| Tool | Stage | Description |
|---|---|---|
| `agentic_plan` | I | Plan + auto-decompose (LLM-first) |
| `agentic_execute` | I | Execute step + auto-verify + checkpoint |
| `agentic_reflect` | I | Error analysis + propagation tracing |
| `agentic_verify` | I | Compile + test verification |
| `agentic_status` | I | Dashboard + blocked steps |
| `agentic_nav` | II | Codebase scan + file search |
| `agentic_context` | II | Context view + compress |
| `agentic_snapshot` | II | Save/list execution checkpoints |
| `agentic_pr` | II | Generate PR + description |
| `agentic_score` | II | Tech debt analysis |
| `agentic_model` | II | Configure per-role LLM model preferences per session |
| `agentic_model_reset` | II | Reset model stats — single, stale (>7d), or emergency all |
| `agentic_delegate` | III | Assign to architect/developer/qa/coordinator — pipeline-aware with cross-validation |
| `agentic_pipeline` | III | Define and run multi-agent workflow pipelines (PM→Arch→Dev→QA) |
| `agentic_message` | III | Inter-agent messaging: send, inbox, conversation, review requests |
| `agentic_parallel` | III | Dependency-based concurrency |
| `agentic_skill` | III | Extract/find/list reusable skills |
| `agentic_episodes` | III | Cross-session memory search |
| `agentic_dashboard` | III | Timeline + anomaly detection |
| `agentic_guard` | III | Hallucination detection |
| `agentic_evolve` | IV | Inspect + extend the agent system |
| `agentic_auto` | V | Fully autonomous agent loop (plan→execute→verify→retry in one call) |
| `agentic_debate` | 🏗 Blueprint | Debate loop — Agent A (executor) ↔ Agent B (critic) |
| `agentic_router` | 🏗 Blueprint | Keyword-first intent classifier, zero LLM cost for clear intents |
| `agentic_clean` | 🏗 Blueprint | Strip debate artifacts, reformat to markdown/json, validate schema |
| `agentic_rag` | 🏗 Blueprint | Multi-index RAG: TF-IDF + vector hybrid search per category |
| `agentic_mcp` | 🏗 Blueprint | MCP Client — connect to DB/APIs via stdio or HTTP(S) |

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
├── index.ts               # Plugin entry: registers 26 tools + hooks
├── core/                  # Core engine
│   ├── intent-parser.ts   # Parses user intent → Plan structure
│   ├── planner.ts         # Auto-decompose (create/fix/refactor/test templates)
│   ├── executor.ts        # Step execution state, retry tracking
│   ├── verifier.ts        # Compile + test verification (execFileSync)
│   ├── error-analyzer.ts  # Categorizes errors (import/type/compile/test/runtime)
│   ├── navigator.ts       # Codebase file scanning + relevance scoring
│   ├── git.ts             # Git commit, history, PR description generation
│   ├── tech-debt-scorer.ts# Coupling/size/scope/patterns analysis
│   └── parallel.ts        # Dependency-based concurrency + conflict detection
├── agents/                # Multi-agent system
│   ├── coordinator.ts     # Delegates to agent roles, auto-suggests role, message bus
│   ├── orchestrator.ts    # Multi-agent workflow pipelines + cross-validation
│   └── role-registry.ts   # Built-in + custom agent definitions (extensible)
├── drift/                 # Context & safety
│   ├── dependency-tracker.ts   # Per-session file change + error propagation
│   ├── context-compressor.ts   # Sliding window + key info extraction
│   ├── checkpoints.ts          # Risk evaluation: BLOCK/REVIEW/WARNING
│   └── hallucination-guard.ts  # File/func/import claim verification
├── memory/                # Persistent memory
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
│   └── live-evaluator.ts   # 5-dimensi real-time scoring dari tool hooks
├── evolution/
│   ├── self-evolver.ts     # Auto-improvement analysis
│   └── continuous-evolution.ts # Continuous self-evolution pipeline
└── observability/
    ├── trace-logger.ts     # JSONL trace writer (buffered, auto-flush)
    └── dashboard.ts        # Timeline + stats + anomaly detection
```

> **Note:** Selain diagram di atas, `memory/skill-training.ts` menyediakan konversi skill → training data (JSONL/instructions) dan `evaluation/live-evaluator.ts` menyediakan 5-dimensi real-time scoring dari tool hooks.

## Testing

```bash
# Unit tests (548 tests, mock-based, no LLM needed)
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

# Docker pipeline (7 layers, 548 unit + E2E tests)
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

## Recent Updates (v0.4.3 — 2026-06-17)

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

- **27 tools** (was 21) — Blueprint layers + model reset + auto orchestrator
- **489+ unit tests** — mock-based, no LLM needed
- **v0.4.3** — latest on npm

## License

MIT
