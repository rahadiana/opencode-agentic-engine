# AGENTS.md — OpenCode Agent Instructions

## Project: opencode-agentic-engine

Plugin OpenCode yang mengimplementasikan agentic software engineering workflow berdasarkan paper "The End of Software Engineering" (arXiv:2606.05608).

## Commands

```bash
npm run build       # tsc --emitDeclarationOnly && node esbuild.config.mjs → dist/index.js
node test/run.mjs   # 99 unit tests (mock, no LLM needed)
node test/dropin.mjs       # Simulates opencode auto-discovery
node test/load-samedir.mjs # Same-directory load + E2E workflow
node test/e2e-scenario.mjs # EvoClaw: 50-file codebase, 5 iterations
node test/swebench-harness.mjs # SWE-bench: 3 scenarios (mock mode)
OPENAI_BASE_URL=http://localhost:11434/v1 OPENAI_MODEL=qwen2.5:0.5b node test/swebench-harness.mjs # SWE-bench with LLM
./test-container.sh # Full Docker pipeline (7 layers)
```

## Architecture

```
src/
├── index.ts               # Plugin entry: registers 20 tools + hooks
├── core/
│   ├── intent-parser.ts    # Parses user intent → Plan structure
│   ├── planner.ts          # Auto-decompose (create/fix/refactor/test templates)
│   ├── executor.ts         # Step execution state, retry tracking
│   ├── verifier.ts         # Compile + test verification (execFileSync)
│   ├── error-analyzer.ts   # Categorizes errors (import/type/compile/test/runtime)
│   ├── navigator.ts        # Codebase file scanning + relevance scoring
│   ├── git.ts              # Git commit, history, PR description generation
│   ├── tech-debt-scorer.ts # Coupling/size/scope/patterns analysis
│   └── parallel.ts         # Dependency-based concurrency + conflict detection
├── agents/
│   ├── coordinator.ts      # Delegates to agent roles, auto-suggests role, message bus
│   ├── orchestrator.ts     # Multi-agent workflow pipelines + cross-validation
│   └── role-registry.ts    # Built-in + custom agent definitions (extensible)
├── drift/
│   ├── dependency-tracker.ts   # Per-session file change + error propagation
│   ├── context-compressor.ts   # Sliding window + key info extraction
│   ├── checkpoints.ts          # Risk evaluation: BLOCK/REVIEW/WARNING
│   └── hallucination-guard.ts  # File/func/import claim verification
├── memory/
│   ├── session-store.ts     # Conversation turns + plan + progress
│   ├── skill-store.ts       # Skill extraction, search, failure reporting
│   ├── skill-format.ts      # Self-describing agentic-skill/v1 schema
│   ├── episodic-store.ts    # Cross-session memory with versioned schema
│   └── schema-version.ts    # Memory schema envelope + migration system
└── observability/
    ├── trace-logger.ts      # JSONL trace writer (buffered, auto-flush)
    └── dashboard.ts         # Timeline + stats + anomaly detection
```

## 21 Tools

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
| agentic_delegate | III | Assign to architect/developer/qa/coordinator — pipeline-aware with cross-validation |
| agentic_pipeline | III | Define and run multi-agent workflow pipelines (PM→Arch→Dev→QA) |
| agentic_message | III | Inter-agent messaging: send, inbox, conversation, review requests |
| agentic_parallel | III | Dependency-based concurrency |
| agentic_skill | III | Extract/find/list reusable skills |
| agentic_episodes | III | Cross-session memory search |
| agentic_dashboard | III | Timeline + anomaly detection |
| agentic_guard | III | Hallucination detection |
| agentic_model | II | Configure per-role LLM model preferences per session |
| agentic_evolve | IV | Inspect + extend the agent system |
| agentic_auto | V | Fully autonomous agent loop (plan→execute→verify→retry in one call) |

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

All tests are LLM-free — they pass hardcoded results to `agentic_execute`.

## When Adding Features

1. Create source file in appropriate `src/` subdirectory
2. Add import + instance in `src/index.ts`
3. Add tool definition in `tools` object
4. Add to expected tool list in `test/run.mjs`, `test/dropin.mjs`, `test/load-samedir.mjs`
5. Add test cases in `test/run.mjs` (≥2: happy + error)
6. `npm run build && node test/run.mjs` — must pass
7. `./test-container.sh` — must pass all Docker layers
