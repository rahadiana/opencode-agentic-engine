# TODO — opencode-agentic-engine

## ✅ Completed (v0.5.17-dev)

### Docs & Lint
- [x] Document sync: version, test count, gaps 10-12, tools 31→32
- [x] 114 bare `catch {}` → logged warnings (21 files)
- [x] ESLint config: `caughtErrorsIgnorePattern: "^_"` → 0 lint errors

### globalThis Cleanup
- [x] Created `src/core/shared-instances.ts` — 18→0 globalThis references
- [x] Added shared instances: DslExecutor, SchemaValidator, ConsolidationScheduler, SchemaVersion, BlueprintParser, BlueprintResolver

### God Method Extraction
- [x] `llm.ts.call()`: 385→139 lines, 5 private helpers
- [x] `gatherEvolutionData` + `runAutoEvolve` → `src/evolution/auto-evolve.ts`

### Tool Extraction (definitions.ts → individual files)
- [x] `agentic_execute` (636 lines) → `src/tools/execute.ts`
- [x] `agentic_auto` (545 lines) → `src/tools/auto.ts`
- [x] `agentic_evolve` (455 lines) → `src/tools/evolve.ts`
- [x] `agentic_rag` (401 lines) → `src/tools/rag.ts`
- [x] `agentic_delegate` (322 lines) → `src/tools/delegate.ts`
- [x] `agentic_model` (351 lines) → `src/tools/model.ts`
- [x] `agentic_finetune` (337 lines) → `src/tools/finetune.ts`
- [x] Previously standalone: status, clean, snapshot, budget

## 🔜 Pending

### Medium Priority
- [ ] Clean up 335 lint warnings — prefix unused ctx vars with `_`
- [ ] Split `definitions.ts` further — extract remaining ~15 tools:
  - agentic_plan, agentic_nav, agentic_reflect, agentic_verify
  - agentic_context, agentic_pipeline, agentic_pr, agentic_score
  - agentic_message, agentic_skill, agentic_episodes, agentic_parallel
  - agentic_guard, agentic_debate, agentic_router
  - agentic_mcp, agentic_a2a, agentic_tools, agentic_db
  - agentic_memo, agentic_fetch

### Low Priority
- [ ] Verify CI pipeline: `npm run test:coverage:ci`, `test-container.sh`
- [ ] Phase 4 Smart Agentic Analysis final report

## 📊 Metrics (current)

| Metric | Value |
|--------|-------|
| index.ts | 1,645 lines |
| definitions.ts | 2,575 lines (was 5,691) |
| Total src/tools/ | 14 files |
| Unit tests | 3,101 ✅ |
| Lint errors | 0 |
| Lint warnings | 335 |
| SWE-bench mock | 7/7 ✅ |
| Build | ✅ |
