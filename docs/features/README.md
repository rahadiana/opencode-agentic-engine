# Features Overview

32 tools dikelompokkan dalam 5 Stage + Blueprint.

---

## Stage I — Foundation

Tools inti untuk planning, execution, verification, dan error recovery.

| Tool | Fungsi |
|------|--------|
| [`agentic_plan`](tools.md#agentic_plan) | Breakdown goal → subtasks. 13 template rules + LLM fallback |
| [`agentic_execute`](tools.md#agentic_execute) | Tandai step selesai + auto-verify compile |
| [`agentic_verify`](tools.md#agentic_verify) | Multi-dimensi verification (compile/lint/test/security/perf/arch/deps) |
| [`agentic_reflect`](tools.md#agentic_reflect) | Analisis error: kategori + propagasi + recovery plan |
| [`agentic_status`](tools.md#agentic_status) | Dashboard eksekusi: progress, blocked, health |

## Stage II — Intelligence

Codebase navigation, context management, quality scoring, budget control.

| Tool | Fungsi |
|------|--------|
| [`agentic_nav`](tools.md#agentic_nav) | Scan codebase, cari file relevan per keyword |
| [`agentic_context`](tools.md#agentic_context) | View/compress context window |
| [`agentic_snapshot`](tools.md#agentic_snapshot) | Checkpoint execution state |
| [`agentic_pr`](tools.md#agentic_pr) | Generate & create PR description |
| [`agentic_score`](tools.md#agentic_score) | Tech debt analysis |
| [`agentic_model`](tools.md#agentic_model) | Per-role/tool/category model preferences |
| [`agentic_budget`](tools.md#agentic_budget) | Circuit breaker: token/steps/time/cost |
| [`agentic_db`](tools.md#agentic_db) | SQLite persistence/query backend |
| [`agentic_memo`](tools.md#agentic_memo) | Second Brain (decisions, TODOs, graph) |

## Stage III — Orchestration

Multi-agent coordination, memory, observability.

| Tool | Fungsi |
|------|--------|
| [`agentic_delegate`](tools.md#agentic_delegate) | Assign task ke specialist agent |
| [`agentic_pipeline`](tools.md#agentic_pipeline) | Multi-agent workflow pipeline |
| [`agentic_message`](tools.md#agentic_message) | Inter-agent messaging |
| [`agentic_parallel`](tools.md#agentic_parallel) | Dependency-based concurrency |
| [`agentic_skill`](tools.md#agentic_skill) | Skill extraction & search |
| [`agentic_episodes`](tools.md#agentic_episodes) | Cross-session memory |
| [`agentic_guard`](tools.md#agentic_guard) | Hallucination guard |
| [`agentic_finetune`](tools.md#agentic_finetune) | Fine-tuning pipeline |

## Stage IV — Evolution

Self-improvement dan agent lifecycle management.

| Tool | Fungsi |
|------|--------|
| [`agentic_evolve`](tools.md#agentic_evolve) | Self-evolution, role management, prompt versioning |

## Stage V — Autonomous

One-call autonomous engineering.

| Tool | Fungsi |
|------|--------|
| [`agentic_auto`](tools.md#agentic_auto) | Plan → Execute → Verify → Retry → Score → Learn |

## Blueprint (Prototype)

Tools eksperimental untuk debate, routing, RAG, dan protocol interop.

| Tool | Fungsi |
|------|--------|
| [`agentic_debate`](tools.md#agentic_debate) | Executor ↔ Critic multi-round debate |
| [`agentic_router`](tools.md#agentic_router) | Intent classifier |
| [`agentic_clean`](tools.md#agentic_clean) | Strip debate artifacts, reformat |
| [`agentic_rag`](tools.md#agentic_rag) | Multi-index RAG search |
| [`agentic_mcp`](tools.md#agentic_mcp) | MCP client (external tools/APIs) |
| [`agentic_a2a`](tools.md#agentic_a2a) | A2A agent-to-agent protocol |
| [`agentic_tools`](tools.md#agentic_tools) | Unified tool discovery (MCP + A2A) |
