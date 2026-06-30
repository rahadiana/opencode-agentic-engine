# opencode-agentic-engine — Source

Plugin OpenCode yang mengimplementasikan agentic software engineering workflow.

## Struktur

| Direktori | Fungsi |
|-----------|--------|
| `core/` | Inti engine: planning, execution, verification, LLM, DSL, planner, domain generators |
| `agents/` | Multi-agent coordination: runtime, orchestrator, coordinator, role registry, A2A |
| `drift/` | Error detection & recovery: checkpoints, hallucination guard, context compression |
| `memory/` | Cross-session & in-session memory: episodic store, RAG, skill store, vector store |
| `evaluation/` | Real-time scoring dari tool hooks (5 dimensi) |
| `evolution/` | Self-evolution: continuous evolution, prompt improvement |
| `observability/` | Logger, dashboard, trace logger |

## Entry Point

`index.ts` — registers 31 `agentic_` tools + OpenCode hooks. Semua tool publik pakai prefix `agentic_`.
