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

### 20 Tools

`agentic_plan` `agentic_execute` `agentic_reflect` `agentic_verify` `agentic_status` `agentic_nav` `agentic_context` `agentic_snapshot` `agentic_pr` `agentic_score` `agentic_delegate` `agentic_pipeline` `agentic_message` `agentic_skill` `agentic_episodes` `agentic_parallel` `agentic_dashboard` `agentic_guard` `agentic_evolve` `agentic_auto`

## Quick Start

### Drop-in Instalasi

```bash
# Cukup copy satu file ke project OpenCode:
curl -L https://github.com/rahadiana/opencode-agentic-engine/releases/latest/download/index.js \
  -o .opencode/plugins/agentic-engine.js

# Pastikan .opencode/package.json:
{"name":"project","type":"module"}
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
├── index.ts               # Entry: registrasi 20 tools + hooks
├── core/                  # Engine inti
│   ├── config.ts          # Config loader + file watcher
│   ├── intent-parser.ts   # Parse intent → Plan
│   ├── planner.ts         # Auto-decompose task
│   ├── executor.ts        # Eksekusi step + retry + error propagation
│   ├── verifier.ts        # Compile + test verification
│   ├── navigator.ts       # Codebase scanner + relevance scoring
│   ├── llm.ts             # LLM engine + model registry integration
│   ├── model-registry.ts  # Tracking model reliability & hallucination
│   ├── git.ts             # Git commit + PR generation
│   ├── tech-debt-scorer.ts# Coupling/size/pattern analysis
│   └── parallel.ts        # Dependency-based concurrency
├── agents/                # Multi-agent system
│   ├── coordinator.ts     # Delegasi, shared memory, message bus
│   ├── orchestrator.ts    # Pipeline workflow + cross-validation
│   └── role-registry.ts   # Definisi role + model suggestion
├── drift/                 # Context & safety
│   ├── dependency-tracker.ts
│   ├── context-compressor.ts
│   └── hallucination-guard.ts
├── memory/                # Persistent memory
│   ├── skill-store.ts     # Skill extraction & search
│   ├── skill-format.ts    # Self-describing skill schema
│   ├── episodic-store.ts  # Cross-session memory
│   ├── session-store.ts   # Conversation turns
│   ├── vector-store.ts    # Sparse retrieval (TF-IDF)
│   ├── persistence.ts     # Model stats persistence
│   └── schema-version.ts  # Memory schema migration
├── evolution/
│   └── self-evolver.ts    # Auto-improvement analysis
└── observability/
    ├── trace-logger.ts    # JSONL tracing (buffered, auto-flush)
    └── dashboard.ts       # Timeline, stats, anomaly detection
```

## Testing

```bash
# Unit tests (150+ tests, mock-based, tanpa LLM)
node test/run.mjs

# E2E workflow test (load plugin + full round-trip)
node test/load-samedir.mjs

# Multi-iterasi EvoClaw (50-file codebase, 3 agent parallel)
node test/e2e-scenario.mjs

# Real LLM E2E (perlu API key)
node test/e2e-real.mjs

# Docker pipeline (7 layer, 150 unit + 36 E2E)
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

## License

MIT
