# core/ — Inti Engine

## Domain

| Subdomain | File | Fungsi |
|-----------|------|--------|
| **Planning** | `planner.ts`, `planner-data.ts`, `planner-utils.ts`, `planner-critic.ts`, `planner-tree-search.ts`, `planning-layer.ts`, `intent-parser.ts`, `task-classifier.ts`, `router-agent.ts` | Auto-decompose goal ke subtasks, intent classification, tree search, lifecycle phase |
| **Execution** | `agent-loop.ts`, `executor.ts`, `execution-helpers.ts`, `execution-layer.ts`, `recovery-layer.ts`, `auto-retry.ts`, `budget-tracker.ts`, `parallel.ts` | Autonomous loop, retry with backoff, budget enforcement, dependency-based concurrency |
| **Verification** | `verifier.ts`, `error-analyzer.ts`, `errors.ts` | Multi-dimensi (compile/lint/test/security/perf/arch/deps), typed errors |
| **Policy / Harness** | `workflow-policy.ts`, `dumb-model.ts`, `alignment-gate.ts`, `economic-model.ts`, `constraint-manifold.ts`, `confidence-scorer.ts`, `tool-guardrails.ts` | Runtime gates (bukan prompt). Dumb-model auto/strict. Goal drift. ROI. Safety |
| **LLM** | `llm.ts`, `llm-types.ts`, `model-registry.ts`, `semantic-cache.ts`, `prompt-builder.ts`, `prompt-template.ts` | LLM via OpenCode SDK only; model 3-level resolve; TF-IDF cache |
| **Debate** | `debate-loop.ts`, `data-cleaner.ts` | Executor ↔ Critic multi-round debate, artifact stripping |
| **Memory/Knowledge** | `bootstrap-knowledge.ts`, `session-reader.ts`, `tech-knowledge-registry.ts`, `5w1h-framework.ts` | Seeds RAG, session reader, tech registry, 5W1H research agent |
| **Code Gen** | `code-sandbox.ts`, `domain-registry.ts`, `domains/` (code/data-science/devops/generic/mobile/security) | Safe code execution via VM sandbox, domain-specific generators |
| **DSL** | `dsl-executor.ts`, `dsl-types.ts`, `dsl-validator.ts` | Domain-specific language for workflow definition |
| **Tool System** | `tool-router.ts`, `tool-catalog.ts`, `dynamic-tool-registry.ts`, `mcp-client.ts`, `mcp-server.ts`, `protocol-adapter.ts`, `tool-usage-tracker.ts` | Tool routing, MCP client/server, protocol adaptation |
| **Agent Blueprint** | `agent-blueprint.ts`, `workflow-engine.ts` | Agent blueprint system, workflow engine |
| **Advanced** | `attention-scheduler.ts`, `code-intent-analyzer.ts`, `dag-engine.ts`, `dag-helpers.ts`, `event-bus.ts`, `event-taxonomy.ts`, `fine-tuning.ts`, `formal-model.ts`, `git.ts`, `id-chain.ts`, `meta-reasoner.ts`, `navigator.ts`, `simulation-engine.ts`, `skill-improver.ts`, `skill-schema.ts`, `state-store.ts`, `tech-debt-scorer.ts`, `world-model.ts` | DAG, formal contracts, fine-tuning, meta-reasoning, nav, simulation, world model |

### FormalModel + AttentionScheduler (wiring audit M2)

| Component | Used where | Critical-path default? |
|-----------|------------|------------------------|
| `DependencyGraph` | `planner.ts` cycle detection | ✅ Yes (plan) |
| `ContractVerifier` | `executor.ts` pre/post contracts | ✅ Yes (execute path) |
| `FormalModel` aggregate A=(M,T,M,Π) | Types + exports; not a single runtime singleton | Partial — pieces wired, not full A gate |
| `AttentionScheduler` | Unit tests + export; multi-agent uses orchestrator/delegate/parallel | ❌ **Opt-in / experimental** — not default wire |

Do **not** force AttentionScheduler into every multi-agent run (extra scheduling layer without clear ROI). Prefer orchestrator phases + parallel.
| **Config / shared** | `config.ts`, `shared-instances.ts`, `project-context.ts`, `rate-limit.ts`, `plugin-updater.ts`, `lru-cache.ts` | Plugin config (incl. `dumbModelMode`), DI singletons, project detect |

## Dumb-Model Harness (`dumb-model.ts`)

```
resolveDumbHarness({ dumbModelMode, model, modelRegistry })
  true     → always strict
  false    → never force
  "auto"   → weak name (mini/free/flash/…) OR bad ModelRegistry stats

workflowModeForDumb() → "strict" | configured advisory
formatDumbHarnessNotice() → prompt injection
```

Wired dari: `index.ts` (AgentLoop + system.transform), `tools/execute.ts`, `tools/status.ts`.  
Default config: `agent.dumbModelMode: "auto"`.

## WorkflowPolicy (`workflow-policy.ts`)

Runtime gate di `agentic_execute` + `AgentLoop` (pre/post).  
Strict mode dapat **block** (mis. `research-missing`) — bukan hanya warn.

## Key Dependencies

- `llm.ts` → single path for all LLM calls via OpenCode SDK
- `planner.ts` → decomposes goals → `agent-loop.ts` executes
- `verifier.ts` → Gap #4: 3-tier (fast/standard/deep)
- `semantic-cache.ts` → Gap #7: TF-IDF + cosine similarity cache
- `dumb-model.ts` + `workflow-policy.ts` → Gap #1/#3 harness for weak models
- `model-registry.ts` → reliability stats (also feeds auto dumb detection)
