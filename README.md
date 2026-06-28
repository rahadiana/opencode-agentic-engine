# OpenCode Agentic Engine

> **Plugin OpenCode** — agentic software engineering: autonomous planning, multi-agent collaboration, skill-based learning, model reliability tracking, self-evolution.

Berdasarkan paper **"The End of Software Engineering"** (arXiv:2606.05608).

## Instalasi

### Prasyarat

- **OpenCode** sudah terinstall di sistem
- Plugin sudah dipublikasikan di npm registry sebagai `opencode-agentic-engine`

### Cara 1 — Lewat OpenCode (Termudah) 🎯

Tambahin ke file `.opencode/opencode.json` di proyek kamu:

```json
{
  "plugin": ["opencode-agentic-engine@latest"]
}
```

Simpan, restart OpenCode — selesai. OpenCode otomatis download dari npm registry.

Atau kalau OpenCode-mu ada CLI, bisa juga:

```bash
opencode plugin add opencode-agentic-engine@latest
```

### Cara 2 — Build dari Source (Developer)

Buat yang mau kontribusi / modifikasi sendiri:

```bash
# 1. Clone repo
git clone https://github.com/rahadiana/opencode-agentic-engine.git
cd opencode-agentic-engine

# 2. Install dependencies
npm install

# 3. Build + auto-register ke OpenCode
npm run build
```

Script `postbuild` otomatis nyalin hasil build ke `~/.cache/opencode/packages/opencode-agentic-engine@latest/`.

### Cara 3 — Drop-in Lokal (Testing)

Buat development tanpa registrasi global, taruh `dist/index.js` di:

```
.proyek-kamu/.opencode/plugins/agentic-engine/index.js
```

OpenCode auto-detect plugin dari folder `.opencode/plugins/`.

### Verifikasi

Buka OpenCode, pilih agent **"Agentic"**, lalu coba:

```
agentic_status
```

Atau cek dari terminal:

```bash
ls ~/.cache/opencode/packages/opencode-agentic-engine@latest/
```

### Update

```bash
# Kalau pake Cara 1 (npm) — tinggal restart OpenCode, dia auto-update
# Kalau pake Cara 2 (source) — git pull && npm run build
```

## Quick Start

Setelah terinstall, pilih agent **"Agentic"** di OpenCode, lalu:

```
buat aplikasi POS dengan Express, Vue 3, dan SQLite
```

Atau coba tool langsung:

```
agentic_nav query="src/" showSummary=true
agentic_plan goal="Buat fitur login"
agentic_dashboard
```

## Dokumentasi Lengkap → [`docs/`](./docs/)

| Section | Link |
|---------|------|
| Getting Started | [docs/getting-started.md](./docs/getting-started.md) |
| 34 Tools Reference | [docs/features/tools.md](./docs/features/tools.md) |
| Workflow Guide | [docs/guide/workflow.md](./docs/guide/workflow.md) |
| Multi-Agent | [docs/guide/multi-agent.md](./docs/guide/multi-agent.md) |
| Memory & Skills | [docs/guide/memory.md](./docs/guide/memory.md) |
| MCP & A2A Protocols | [docs/guide/protocols.md](./docs/guide/protocols.md) |
| Self-Evolution | [docs/guide/evolution.md](./docs/guide/evolution.md) |
| Architecture | [docs/architecture.md](./docs/architecture.md) |
| Configuration | [docs/config.md](./docs/config.md) |
| Troubleshooting | [docs/troubleshooting.md](./docs/troubleshooting.md) |

## Testing

```bash
node test/run.mjs        # 1854 unit tests (mock, no LLM)
node test/e2e-llm.mjs    # LLM E2E: 19 tests
./test-container.sh      # Full Docker pipeline (7 layers)
```

## License

MIT
