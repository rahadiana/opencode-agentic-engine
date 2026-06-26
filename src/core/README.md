# core/ — Inti Engine

## Domain

| Subdomain | File | Fungsi |
|-----------|------|--------|
| **Planning** | `planner.ts`, `planner-data.ts`, `planner-utils.ts`, `planner-critic.ts`, `planner-tree-search.ts`, `planning-layer.ts`, `intent-parser.ts`, `task-classifier.ts`, `router-agent.ts` | Auto-decompose goal ke subtasks, intent classification, tree search |
| **Execution** | `agent-loop.ts`, `executor.ts`, `execution-helpers.ts`, `execution-layer.ts`, `recovery-layer.ts`, `auto-retry.ts`, `budget-tracker.ts`, `parallel.ts` | Autonomous loop, retry with backoff, budget enforcement, dependency-based concurrency |
| **Verification** | `verifier.ts`, `error-analyzer.ts`, `errors.ts` | Multi-dimensi (compile/lint/test/security/perf/arch/deps), error categorization |
| **LLM** | `llm.ts`, `llm-types.ts`, `model-registry.ts`, `semantic-cache.ts`, `prompt-builder.ts`, `prompt-template.ts` | LLM integration via OpenCode SDK, model resolution, TF-IDF semantic cache |
| **Debate** | `debate-loop.ts`, `data-cleaner.ts` | Executor ↔ Critic multi-round debate, artifact stripping |
| **Memory/Knowledge** | `bootstrap-knowledge.ts`, `session-reader.ts` | Seeds RAG, session state reader |
| **Code Gen** | `code-sandbox.ts`, `domain-registry.ts`, `domains/` (code/data-science/devops/generic/mobile/security) | Safe code execution via VM sandbox, domain-specific generators |
| **DSL** | `dsl-executor.ts`, `dsl-types.ts`, `dsl-validator.ts` | Domain-specific language for workflow definition |
| **Tool System** | `tool-router.ts`, `dynamic-tool-registry.ts`, `mcp-client.ts`, `mcp-server.ts`, `protocol-adapter.ts` | Tool routing, MCP client/server, protocol adaptation |
| **Agent Blueprint** | `agent-blueprint.ts`, `workflow-engine.ts` | Agent blueprint system, workflow engine |
| **Advanced** | `attention-scheduler.ts`, `code-intent-analyzer.ts`, `confidence-scorer.ts`, `constraint-manifold.ts`, `dag-engine.ts`, `dag-helpers.ts`, `event-bus.ts`, `event-taxonomy.ts`, `fine-tuning.ts`, `formal-model.ts`, `git.ts`, `id-chain.ts`, `meta-reasoner.ts`, `navigator.ts`, `session-reader.ts`, `simulation-engine.ts`, `skill-improver.ts`, `skill-schema.ts`, `state-store.ts`, `tech-debt-scorer.ts`, `world-model.ts` | DAG execution engine, formal verification, fine-tuning pipeline, meta-reasoning, codebase navigation, simulation engine, tech debt analysis, world model |
| **Config** | `config.ts` | Plugin config, env vars, defaults |

## Key Dependencies

- `llm.ts` → single path for all LLM calls via OpenCode SDK
- `planner.ts` → decomposes goals → `agent-loop.ts` executes
- `verifier.ts` → Gap #4: 3-tier (fast/standard/deep)
- `semantic-cache.ts` → Gap #7: TF-IDF + cosine similarity cache
