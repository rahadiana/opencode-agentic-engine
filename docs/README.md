# OpenCode Agentic Engine

> Plugin OpenCode yang mengimplementasikan **agentic software engineering** — autonomous planning, multi-agent collaboration, skill-based learning, model reliability tracking, dan self-evolution.

Berdasarkan paper **"The End of Software Engineering"** (arXiv:2606.05608).

---

## 📚 Dokumentasi

| Section | Deskripsi |
|---------|-----------|
| [Getting Started](getting-started.md) | Instalasi, setup, first run |
| [Features](features/README.md) | Semua fitur per Stage (I–V) |
| [Tools Reference](features/tools.md) | 31 tools — fungsi, usage, hint |
| [Guide: Workflow](guide/workflow.md) | Plan → Execute → Verify → Retry |
| [Guide: Multi-Agent](guide/multi-agent.md) | Delegasi, pipeline, messaging |
| [Guide: Memory & Skills](guide/memory.md) | Cross-session, skill extraction |
| [Guide: Protocols](guide/protocols.md) | MCP, A2A integration |
| [Guide: Evolution](guide/evolution.md) | Self-evolution, fine-tuning |
| [Configuration](config.md) | `.agentic/config.json`, models |
| [Architecture](architecture.md) | Internal design per layer |
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
- **Ponytail Architecture**: Minimum code, reuse existing, no speculative abstraction.
- **Gap-Driven Development**: Setiap fitur tackle gap dari paper (Gap #4 verification, #5 error recovery, #7 semantic cache, #10 alignment, #11 economic model).
