# AGENTS.md — OpenCode Agent Instructions

## Project: opencode-agentic-engine

Plugin OpenCode yang mengimplementasikan agentic software engineering workflow berdasarkan paper "The End of Software Engineering" (arXiv:2606.05608).

## Commands

```bash
npm run build       # tsc --emitDeclarationOnly && node esbuild.config.mjs → dist/index.js
                    # postbuild: auto-copy ke ~/.cache/opencode/packages/ (jika ada)
node test/run.mjs   # 489 unit tests (mock, no LLM needed)
node test/dropin.mjs       # Simulates opencode auto-discovery
node test/load-samedir.mjs # Same-directory load + E2E workflow
node test/e2e-scenario.mjs # EvoClaw: 50-file codebase, 5 iterations
node test/swebench-harness.mjs # SWE-bench: 7 scenarios (auto: OpenCode Free)
LLM_OFF=true node test/swebench-harness.mjs # SWE-bench mock mode (no LLM)
node test/e2e-llm.mjs       # LLM E2E: 19 tests (auto: OpenCode Free)
./test-container.sh # Full Docker pipeline (7 layers)
```

## Architecture

```
src/
├── index.ts                   # Plugin entry: registers 21 tools + hooks
├── README.md                  # → Dokumentasi fungsi per folder untuk AI context
│
├── core/                      # Inti engine: planning, execution, verification
│   ├── README.md              # Dokumentasi 29 file + 6 domain
│   ├── agent-loop.ts          # Autonomous loop: plan → execute → verify → retry
│   ├── auto-retry.ts          # Exponential backoff + jitter retry logic
│   ├── budget-tracker.ts      # Token/steps/time/cost budget enforcement
│   ├── config.ts              # Plugin config, env vars, defaults
│   ├── data-cleaner.ts        # Strip debate artifacts, format output
│   ├── debate-loop.ts         # Executor ↔ Critic AI debate for analysis
│   ├── domain-registry.ts     # Domain-specific code generation (code/data/devops/..)
│   ├── error-analyzer.ts      # Categorizes errors (import/type/compile/test/runtime)
│   ├── event-bus.ts           # Pub/sub event bus for tool hooks
│   ├── event-taxonomy.ts      # Event type taxonomy schema
│   ├── execution-helpers.ts   # Shared execution primitives
│   ├── executor.ts            # Step execution state, retry tracking
│   ├── fine-tuning.ts         # Convert skills → training data pipeline
│   ├── formal-model.ts        # Formal verification model
│   ├── git.ts                 # Git commit, history, PR description generation
│   ├── id-chain.ts            # Chain-of-thought ID generation
│   ├── intent-parser.ts       # Parses user intent → Plan structure
│   ├── llm.ts                 # LLM integration (OpenAI-compatible API)
│   ├── mcp-client.ts          # MCP client for external tools/APIs
│   ├── model-registry.ts      # Per-role LLM model preferences
│   ├── navigator.ts           # Codebase file scanning + relevance scoring
│   ├── parallel.ts            # Dependency-based concurrency + conflict detection
│   ├── planner.ts             # Auto-decompose (create/fix/refactor/test templates)
│   ├── prompt-builder.ts      # Dynamic prompt construction
│   ├── prompt-template.ts     # XML-based prompt templates (head/body/footer)
│   ├── router-agent.ts        # Intent classification + routing
│   ├── task-classifier.ts     # Task type classification
│   ├── tech-debt-scorer.ts    # Coupling/size/scope/patterns analysis
│   └── verifier.ts            # Compile + test verification (execFileSync)
│   └── domains/               # Domain-specific generators
│       ├── code.ts, data-science.ts, devops.ts
│       ├── generic.ts, mobile.ts, security.ts
│
├── agents/                    # Multi-agent coordination
│   ├── README.md              # Dokumentasi 4 file
│   ├── agent-runtime.ts       # Agent sub-process spawner
│   ├── coordinator.ts         # Delegates to agent roles, auto-suggests role, msg bus
│   ├── orchestrator.ts        # Multi-agent workflow pipelines + cross-validation
│   └── role-registry.ts       # Built-in + custom agent definitions (extensible)
│
├── drift/                     # Error detection & recovery
│   ├── README.md              # Dokumentasi 5 file
│   ├── checkpoints.ts         # Risk evaluation: BLOCK/REVIEW/WARNING
│   ├── context-compressor.ts  # Sliding window + key info extraction
│   ├── dependency-tracker.ts  # Per-session file change + error propagation
│   ├── hallucination-guard.ts # File/func/import claim verification
│   └── pattern-discovery.ts   # Error pattern discovery
│
├── memory/                    # Cross-session & in-session memory
│   ├── README.md              # Dokumentasi 10 file
│   ├── episodic-store.ts      # Cross-session memory with versioned schema
│   ├── local-embedder.ts      # Local text embedding (API-based)
│   ├── multi-index-rag.ts     # Multi-index RAG with category segregation
│   ├── persistence.ts         # File-based JSON persistence
│   ├── schema-version.ts      # Memory schema envelope + migration system
│   ├── session-store.ts       # Conversation turns + plan + progress
│   ├── skill-format.ts        # Self-describing agentic-skill/v1 schema
│   ├── skill-store.ts         # Skill extraction, search, failure reporting
│   ├── skill-training.ts      # Convert skill → training data (JSONL/instructions)
│   └── vector-store.ts        # Vector similarity search
│
├── evaluation/
│   ├── README.md              # Dokumentasi 1 file
│   └── live-evaluator.ts      # 5-dimensi real-time scoring dari tool hooks
│
├── evolution/                 # Self-evolution system (Stage IV)
│   ├── README.md              # Dokumentasi 2 file
│   ├── continuous-evolution.ts # Continuous evolution loop
│   └── self-evolver.ts        # Agent prompt evolution
│
└── observability/
    ├── README.md              # Dokumentasi 2 file
    ├── dashboard.ts           # Timeline + stats + anomaly detection
    └── trace-logger.ts        # JSONL trace writer (buffered, auto-flush)
```

## 29 Tools

| Tool | Stage | Description |
|---|---|---|
| agentic_plan | I | Plan + auto-decompose (LLM-first) |
| agentic_execute | I | Execute step + auto-verify + checkpoint |
| agentic_reflect | I | Error analysis + propagation tracing |
| agentic_verify | I | Compile + test verification |
| agentic_status | I | Dashboard + blocked steps |
| agentic_nav | II | Codebase scan + file search |
| agentic_context | II | Context view + compress |
| agentic_snapshot | II | Save/list execution checkpoints |
| agentic_pr | II | Generate PR + description |
| agentic_score | II | Tech debt analysis |
| agentic_model | II | Configure per-role LLM model preferences per session |
| agentic_model_reset | II | Reset model statistics to recover from degraded performance |
| agentic_budget | II | Set/view/reset resource budget limits (tokens, steps, time, cost) |
| agentic_delegate | III | Assign to architect/developer/qa/coordinator — pipeline-aware with cross-validation |
| agentic_pipeline | III | Define and run multi-agent workflow pipelines (PM→Arch→Dev→QA) |
| agentic_message | III | Inter-agent messaging: send, inbox, conversation, review requests |
| agentic_parallel | III | Dependency-based concurrency |
| agentic_skill | III | Extract/find/list reusable skills |
| agentic_episodes | III | Cross-session memory search |
| agentic_dashboard | III | Timeline + anomaly detection |
| agentic_guard | III | Hallucination detection |
| agentic_evolve | IV | Inspect + extend the agent system |
| agentic_auto | V | Fully autonomous loop: plan → execute → verify → retry in one call |
| agentic_debate | Blueprint | Executor ↔ Critic AI debate for analysis |
| agentic_router | Blueprint | Intent classification + routing |
| agentic_clean | Blueprint | Strip debate artifacts + format output |
| agentic_rag | Blueprint | Multi-index RAG with category segregation |
| agentic_mcp | Blueprint | MCP client for external tools/APIs |
| agentic_finetune | III | End-to-end fine-tuning pipeline: prepare, upload, create/monitor jobs |

## Conventions

- **Language**: English for code, Indonesian for communication
- **Imports**: ESM with `.js` extensions (TypeScript convention for Node)
- **New tools**: Add to `src/index.ts` in the `tools` object, then add test in `test/run.mjs`
- **New modules**: Follow existing directory structure (core/agents/drift/memory/observability)
- **Testing**: Every tool must have at least 2 test cases (happy path + error path)
- **Docker**: Every new feature adds a Docker layer in `Dockerfile.test`
- **Shell safety**: Use `execFileSync` not `execSync` — prevent injection
- **Session scoping**: All state tracked per `sessionID`, never cross-session leak

## Test Patterns

1. **Unit tests** (`test/run.mjs`): Mock context, test tool registration + behavior
2. **Drop-in** (`test/dropin.mjs`): Verify plugin auto-discovery
3. **LLM E2E** (`test/e2e-llm.mjs`): Tests LLM-dependent features (auto-decompose, delegation, auto-loop). Skips gracefully if no LLM endpoint available.
4. **EvoClaw** (`test/e2e-scenario.mjs`): 50-file codebase, 5 iterations, 3-agent parallel

All unit tests (`test/run.mjs`) are LLM-free — they pass hardcoded results to `agentic_execute`.
LLM-dependent tests (`e2e-llm.mjs`, `swebench-harness.mjs`) auto-detect OpenCode Free (no API key needed).

## When Adding Features

1. Create source file in appropriate `src/` subdirectory
2. Add import + instance in `src/index.ts`
3. Add tool definition in `tools` object
4. Add to expected tool list in `test/run.mjs`, `test/dropin.mjs`, `test/load-samedir.mjs`
5. Add test cases in `test/run.mjs` (≥2: happy + error)
6. `npm run build && node test/run.mjs` — must pass
7. `./test-container.sh` — must pass all Docker layers
