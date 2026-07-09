# opencode-agentic-engine — Source

Plugin OpenCode yang mengimplementasikan agentic software engineering workflow.

Prinsip: **LLM boleh bodoh, harness harus pintar** — policy, RAG, guard, verify di runtime.

## Struktur

| Direktori | Fungsi |
|-----------|--------|
| `core/` | Inti engine: planning, execution, verification, LLM, policy, dumb-model harness, DAG |
| `tools/` | Definisi 32 tool `agentic_*` (1 file ≈ 1 tool) + `definitions.ts` assembler |
| `agents/` | Multi-agent: runtime, orchestrator, coordinator, role registry, A2A |
| `drift/` | Error detection & recovery: checkpoints, hallucination guard, context compression |
| `memory/` | Episodic, skill, MultiIndexRAG + **Self-Improving RAG critical path** |
| `evaluation/` | Real-time scoring dari tool hooks (5 dimensi) |
| `evolution/` | Self-evolution: continuous evolution, prompt improvement |
| `observability/` | Logger, dashboard, trace logger |
| `curation/` | Skill quality lifecycle (curator) |

## Entry Point

`index.ts` — registers **32** `agentic_` tools + OpenCode hooks:

- `experimental.chat.system.transform` — knowledge-first inject (RAG self-improve) + dumb-harness notice
- `tool.execute.after` — live eval / feedback hooks
- `dispose` — flush state

Semua tool publik pakai prefix `agentic_`.

## Critical-path wiring (jangan dipecah)

```
system.transform
  → MemoryOrchestrator.queryWithKnowledge()
      → RAGSelfImprovePipeline (Adaptive → KbPO → MMKP)
  → track rag:lastUsedTitles + workflow:researched
  → resolveDumbHarness(model) → optional strict notice

agentic_execute / AgentLoop
  → WorkflowPolicy (strict jika dumb harness ON)
  → HallucinationGuard / AlignmentGate / EconomicModel
  → RAGSelfImprovePipeline.feedStepResult()
  → ContinuousEvolution + EventBus
```

| Modul kunci | Path |
|-------------|------|
| Dumb-model harness | `core/dumb-model.ts` |
| Workflow policy | `core/workflow-policy.ts` |
| RAG facade | `memory/rag-self-improve.ts` |
| Tool assembly | `tools/definitions.ts` → `buildAllTools(ctx)` |

## Docs user-facing

Lihat `docs/` (config, architecture, workflow, memory) untuk panduan pemakaian.
README per subfolder di bawah ini untuk konteks AI/developer saat edit kode.
