# OpenCode Agentic Engine

> Plugin OpenCode yang mengimplementasikan **agentic software engineering** — autonomous planning, multi-agent collaboration, skill-based learning, model reliability tracking, dan self-evolution.

Berdasarkan paper **"The End of Software Engineering"** (arXiv:2606.05608).

---

## 📚 Dokumentasi

| Section | Deskripsi |
|---------|-----------|
| [Getting Started](getting-started.md) | Instalasi, setup, first run |
| [Features](features/README.md) | Semua fitur per Stage (I–V) |
| [Tools Reference](features/tools.md) | 32 tools — fungsi, usage, hint |
| [Guide: Workflow](guide/workflow.md) | Plan → Execute → Verify + WorkflowPolicy / dumb harness |
| [Guide: Multi-Agent](guide/multi-agent.md) | Delegasi, pipeline, messaging |
| [Guide: Memory & Skills](guide/memory.md) | Cross-session, skills, Self-Improving RAG |
| [Guide: Protocols](guide/protocols.md) | MCP, A2A integration |
| [Guide: Evolution](guide/evolution.md) | Self-evolution, fine-tuning |
| [Configuration](config.md) | `.agentic/config.json`, models, **dumbModelMode auto** |
| [Architecture](architecture.md) | Knowledge-first + RAG pipeline + dumb harness |
| [Troubleshooting](troubleshooting.md) | FAQ, error handling |

---

## Ringkasan

| Stage | Fokus | Tools |
|-------|-------|-------|
| **I — Foundation** | Plan → Execute → Verify → Retry | `plan`, `execute`, `verify`, `reflect`, `status` |
| **II — Intelligence** | Codebase nav, context, scoring, budget | `nav`, `context`, `snapshot`, `pr`, `score`, `model`, `budget` |
| **III — Orchestration** | Multi-agent, memory, observability | `delegate`, `pipeline`, `message`, `parallel`, `skill`, `episodes`, `dashboard`, `guard`, `finetune` |
| **IV — Evolution** | Self-improvement, role management | `evolve` |
| **V — Autonomous** | One-call full cycle | `auto` |
| **Blueprint** | Debate, router, RAG, MCP, A2A | `debate`, `router`, `clean`, `rag`, `mcp`, `mcp_server`, `a2a`, `tools`, `memo` |

### Key Concepts

- **Knowledge-First**: LLM = reasoning engine, BUKAN knowledge base. Semua pengetahuan dari RAG/web/arXiv.
- **Self-Improving RAG (critical path)**: Adaptive → KbPO → MMKP inject + feedback di execute (`rag-self-improve.ts`).
- **Dumb-Model Harness**: `dumbModelMode: "auto"` — model free/mini/flash → WorkflowPolicy strict. Cek: `agentic_status detail=full`.
- **Ponytail Architecture**: Minimum code, reuse existing, no speculative abstraction.
- **Gap-Driven Development**: Setiap fitur tackle gap dari paper (Gap #4 verification, #5 error recovery, #7 semantic cache, #10 alignment, #11 economic model).
