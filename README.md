# OpenCode Agentic Engine

> **Plugin OpenCode** — agentic software engineering: autonomous planning, multi-agent collaboration, skill-based learning, model reliability tracking, self-evolution.

Berdasarkan paper **"The End of Software Engineering"** (arXiv:2606.05608).

## Instalasi

### Prasyarat

- **Node.js** ≥ 20
- **OpenCode** sudah terinstall di sistem

### Cara 1 — Dari Source (Rekomendasi)

```bash
# 1. Clone repo
git clone https://github.com/rahadiana/opencode-agentic-engine.git
cd opencode-agentic-engine

# 2. Install dependencies
npm install

# 3. Build + auto-register ke OpenCode
npm run build
```

Script `postbuild` otomatis menyalin plugin ke `~/.cache/opencode/packages/opencode-agentic-engine@latest/` — OpenCode akan mendeteksinya saat restart.

### Cara 2 — Via `.opencode/opencode.json`

Tambah ke file `.opencode/opencode.json` di proyek kamu:

```json
{
  "plugin": ["opencode-agentic-engine@latest"]
}
```

Pastikan plugin sudah di-*build* dan ter-copy ke cache OpenCode (lihat Cara 1).

### Cara 3 — Drop-in Lokal

Cocok untuk development atau testing tanpa registrasi global. Letakkan `dist/index.js` di:

```
.proyek-kamu/.opencode/plugins/agentic-engine/index.js
```

OpenCode auto-detect plugin dari folder `.opencode/plugins/`.

### Verifikasi

```bash
# Cek apakah plugin terdaftar
ls ~/.cache/opencode/packages/opencode-agentic-engine@latest/
```

Lalu buka OpenCode, pilih agent **"Agentic"**, dan coba:

```
agentic_status
```

### Update

```bash
git pull
npm run build
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
