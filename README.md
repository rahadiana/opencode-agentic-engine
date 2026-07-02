# OpenCode Agentic Engine

> **Plugin OpenCode** — agentic software engineering: autonomous planning, multi-agent collaboration, skill-based learning, model reliability tracking, self-evolution.

Berdasarkan paper **"The End of Software Engineering"** (arXiv:2606.05608).

## Instalasi

Plugin tersedia di npm registry sebagai `opencode-agentic-engine`.

### Cara 1 — Via OpenCode CLI (Rekomendasi) 🎯

```bash
# Install global — tersedia di semua project
opencode plugin opencode-agentic-engine@latest --global

# Atau install lokal — hanya untuk project ini
opencode plugin opencode-agentic-engine@latest
```

Perintah ini otomatis:
- Mengunduh package dari npm
- Mendaftarkan plugin di config OpenCode (`~/.config/opencode/opencode.jsonc` untuk global, atau `opencode.json` lokal)
- Plugin siap dipakai saat OpenCode di-restart

### Cara 2 — Via Config (opencode.json)

Tambahin ke file `.opencode/opencode.json` di proyek kamu:

```json
{
  "plugin": ["opencode-agentic-engine"]
}
```

OpenCode akan auto-install dari npm saat startup berikutnya.

### Cara 3 — Build dari Source (Developer)

Buat yang mau kontribusi / modifikasi sendiri:

```bash
git clone https://github.com/rahadiana/opencode-agentic-engine.git
cd opencode-agentic-engine
npm install
npm run build
```

Script `postbuild` otomatis nyalin hasil build ke `~/.cache/opencode/packages/opencode-agentic-engine@latest/`.

### Verifikasi

Buka OpenCode, pilih agent **"Agentic"**, lalu coba:

```
agentic_status
```

### Update

```bash
# Cara 1 & 2 (npm) — cukup restart OpenCode, dia auto-update
# Cara 3 (source) — git pull && npm run build
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
agentic_status detail="full"
```

## Dokumentasi Lengkap → [`docs/`](./docs/)

| Section | Link |
|---------|------|
| Getting Started | [docs/getting-started.md](./docs/getting-started.md) |
| 31 Tools Reference | [docs/features/tools.md](./docs/features/tools.md) |
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
node test/run.mjs        # 2686 unit tests (mock, no LLM)
node test/e2e-llm.mjs    # LLM E2E: 19 tests
./test-container.sh      # Full Docker pipeline (7 layers)
```

## License

MIT
