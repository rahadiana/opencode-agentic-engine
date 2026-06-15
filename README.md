# OpenCode Agentic Engine

> **Plugin OpenCode** yang mengimplementasikan *agentic software engineering* workflow — autonomous planning, multi-agent collaboration, skill-based learning, dan self-evolution.

Berdasarkan konsep dari paper **"The End of Software Engineering"** (arXiv:2606.05608).

## Fitur

| Stage | Fitur | Deskripsi |
|---|---|---|
| **I** | Agentic Workflow | Plan → Execute → Verify → Retry dalam satu siklus otomatis |
| **II** | Codebase Intelligence | Navigasi kode, error propagation analysis, tech debt scoring |
| **III** | Multi-Agent | Delegasi ke arsitek/developer/QA, pipeline lintas-role, message bus |
| **IV** | Self-Evolution | Skill extraction & reuse, cross-session memory, auto-improvement |
| **V** | Autonomous Mode | `agentic_auto` — satu perintah, dari rencana sampai deploy |

### 20 Tools

`agentic_plan` `agentic_execute` `agentic_reflect` `agentic_verify` `agentic_status` `agentic_nav` `agentic_context` `agentic_snapshot` `agentic_pr` `agentic_score` `agentic_delegate` `agentic_pipeline` `agentic_message` `agentic_skill` `agentic_episodes` `agentic_parallel` `agentic_dashboard` `agentic_guard` `agentic_evolve` `agentic_auto`

## Quick Start

### Instalasi Plugin

```bash
# Di project OpenCode, simpan file ke:
.opencode/plugins/agentic-engine.js

# Pastikan .opencode/package.json:
{"name":"project","type":"module"}
```

OpenCode auto-load plugin dari folder `.opencode/plugins/` — tidak perlu konfigurasi tambahan.

### Docker Deployment

```bash
cp .env.example .env
# Isi .env dengan API key LLM dan kredensial lainnya

docker compose up -d
```

Akses web di `http://localhost:4096` atau via tunnel URL dari cloudflared.

## Cara Pakai

### Autonomous Mode (Rekomendasi)

Cukup ketik perintah di agent "Agentic":

```
buat aplikasi POS dengan Express, Vue 3, dan SQLite
```

Plugin akan otomatis: plan → implementasi → verify → retry → extract skill.

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

## Provider LLM

Kompatibel dengan provider OpenAI-compatible. Contoh konfigurasi di `.env`:

```env
LLM_API_KEY=sk-your-key
LLM_BASE_URL=https://your-provider/v1
LLM_MODEL=your-model
```

Atau via `opencode.json`:

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

## Arsitektur

```
src/
├── index.ts               # Entry: registrasi 20 tools + hooks
├── core/                  # Engine inti
│   ├── intent-parser.ts   # Parse intent → Plan
│   ├── planner.ts         # Auto-decompose task
│   ├── executor.ts        # Eksekusi step + retry
│   ├── verifier.ts        # Compile + test verification
│   └── navigator.ts       # Codebase scanner
├── agents/                # Multi-agent system
│   ├── coordinator.ts     # Delegasi, shared memory, message bus
│   ├── orchestrator.ts    # Pipeline workflow
│   └── role-registry.ts   # Definisi role (architect/dev/qa/pm)
├── drift/                 # Context & safety
│   ├── dependency-tracker.ts
│   ├── context-compressor.ts
│   └── hallucination-guard.ts
├── memory/                # Persistent memory
│   ├── skill-store.ts     # Skill extraction & search
│   ├── episodic-store.ts  # Cross-session memory
│   └── vector-store.ts    # Sparse retrieval (TF-IDF)
└── observability/
    ├── trace-logger.ts    # JSONL tracing
    └── dashboard.ts       # Timeline & stats
```

## Testing

```bash
# Unit tests (99 test, mock, tanpa LLM)
node test/run.mjs

# E2E workflow test
node test/load-samedir.mjs

# Multi-iterasi EvoClaw
node test/e2e-scenario.mjs

# Real LLM E2E (perlu API key)
node test/e2e-real.mjs

# Docker pipeline (7 layer)
./test-container.sh
```

## License

MIT
