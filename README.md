# OpenCode Agentic Engine

> **Plugin OpenCode** — agentic software engineering: autonomous planning, multi-agent collaboration, skill-based learning, model reliability tracking, self-evolution.

Berdasarkan paper **"The End of Software Engineering"** (arXiv:2606.05608).

## Quick Start

```bash
npm run build
```

Pilih agent **"Agentic"** di OpenCode, lalu:

```
buat aplikasi POS dengan Express, Vue 3, dan SQLite
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
