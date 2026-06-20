# Comparison 16: Multi-Agent System (Planner, Executor, Critic Terpisah)

## Source
`MARKDOWN_PLAN/16 - multi-agent system (planner, executor, critic terpisah).md` — Separate agent roles

> **Note:** File ini 404 saat fetch (URL encoding issue). Konten direkonstruksi dari referensi di file lain (terutama file 13, 17).

## Inti Konsep (dari cross-reference)
- Tiga agent terpisah: **Planner**, **Executor**, **Critic**
- Masing-masing punya tanggung jawab spesifik
- Communication via **Blackboard** (shared state)
- Bisa running paralel atau sequential
- Setiap agent bisa di-run dengan model LLM berbeda

## Yang Kita Punya
- **Orchestrator** (`src/agents/orchestrator.ts`): multi-agent workflow pipelines — PM → Arch → Dev → QA.
- **Coordinator** (`src/agents/coordinator.ts`): delegate to agent roles, message bus.
- **Role Registry** (`src/agents/role-registry.ts`): 5 built-in roles + extensible.
- **Agent Runtime** (`src/agents/agent-runtime.ts`): sub-process spawner.
- **Agentic_delegate** tool: assign task ke agent role.
- **Agentic_pipeline** tool: define + run multi-agent pipeline.
- **Agentic_message** tool: inter-agent messaging.

## Gap
1. **⚠️ Role Mapping** — Kita punya 5 roles (PM, Architect, Developer, QA, Coordinator). Mereka punya 3 (Planner, Executor, Critic). Roles kita lebih banyak TAPI lebih spesifik ke software engineering workflow.
2. **❌ Blackboard Communication** — Kita pakai message bus + pipeline. Mereka pakai shared state blackboard. Blackboard lebih flexible untuk complex coordination.
3. **⚠️ Agent Independence** — Kita support sub-process spawn; mereka semua in-process.
4. **❌ Critic as Separate Agent** — Kita punya QA role yang mirip critic, tapi QA fokus ke verification hasil, bukan critique planning.

## Kesimpulan
**Kita unggul di tooling untuk multi-agent (pipeline, delegation, messaging).** Tapi arsitektur kita pipeline-based (linear), bukan blackboard-based (event-driven). Pipeline lebih predictable; blackboard lebih flexible untuk iterative refinement.
