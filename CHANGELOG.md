# Changelog

## v0.5.10 (2026-07-28)
- fix: model-registry default reliability 0→0.5 untuk model untested — cegah false positive block (741b044)
- fix: update test expectations for balanced mode + neutral confidence score (741b044)

## v0.5.9 (2026-07-28)
- fix: confidence scorer neutral default, model registry untested status, config validation transparency (d9dc8d6)
- fix: auto-detect local embedder & fallback ke TF-IDF kalau gak ada (099252d)
- fix: default config sekarang include semua field (null bukan undefined) (7ad6b7c)
- fix: validasi config sekarang kenali semua field — stop false warnings (140ff16)
- docs: update config docs — default values & missing fields (3e0a87c)

## v0.5.8 (2026-07-21)
- fix: Docker container test pipeline verified + 3 test fixes (b7b9f42)
- fix: yamlToJson indent calculation in BlueprintParser (2fe5796)
- test: +330 branch coverage tests (llm, verifier, blueprint — total 3718) (2fe5796)
- docs: CHANGELOG.md created for auto-release notes (b7b9f42)
- feat: Container test pipeline — Docker 28.0.4, 9-layer verified
- feat: NPM publish workflow ready — tag v0.5.8 triggers auto-publish
- fix: config.json dan models.json lengkapi sesuai skema AGENTS.md
- fix: dockerfile-lint false positive — hadolint skip jadi transparan
- fix: npm audit — 3 high severity vulnerabilities fixed (brace-expansion, shell-quote)
- fix: better-sqlite3 native binding rebuild agar test jalan lancar

## v0.5.7 (2026-07-11)
- docs: sync test count 3568, lint 0, coverage updates (8361f41)
- chore: lint zero warnings, doc drift fix, +176 branch coverage tests (87c9681)
- release: v0.5.7 (df1eb8c)
- docs: SWE-bench mock vs real runbook (swebench.md) (90c316c)
- fix(swebench): real HTTP LLM client for free-model eval (2a0925f)
- feat(auto): H4 SWE targeting + verify-before-done; M4 lint hygiene (9114830)
- feat: RAG updateEntry write-back, deep escalate, hybrid store docs (4a7ce2f)
- docs: Sync dumb-model harness + Self-Improving RAG critical path (824ed4d)
- feat: Auto dumb-model harness (name + stats → strict) (50e8b6d)
- feat: Wire Self-Improving RAG as critical-path ecosystem (5781907)
- feat: Complete addyosmani integration (080f948)
- feat: Skill Security System — 4-layer defense (06bcf3e)
- feat: Integrasi addyosmani/agent-skills (e28ee6c)
- v0.5.20-dev: Self-Improving RAG + 5W1H Research Framework (c627f8a)
- v0.5.19-dev: CI hardening + branch coverage + docs sync (fa6756b)
- fix: resolve all TypeScript errors across 12 tool files — zero TS errors (d7b3c7a)
- feat: RAG updateEntry write-back, deep escalate, hybrid store docs (4a7ce2f)
- v0.5.18-dev — Parallel test runner: 90s→35s (2.6× speedup) (d373392)
- v0.5.18-dev — Clean stale TODOs + verify 9 stress scenarios (b641f78)
- P1: Split index.ts 7221->1635 lines, extract tools + auto-evolve (5feb3c5)
- P1: Extract llm.ts.call() god method into 5 focused helpers (11ff210)
- P0/P1 reliability hardening: silent catches + globalThis cleanup (c24713c)
- v0.5.22-dev: Efficiency refactoring — split index.ts, domain helpers, RAG cache (bd4dac5)
- v0.5.21-dev: Best practice hardening (76be435)
- v0.5.20-dev: Coverage hardening + SWE-bench 7/7 + all issues resolved (2add018)
- v0.5.19-dev: Paralel deep review — semua 8 issue selesai (0704e4f)
- v0.5.18-dev: Deep review fixes — 8 issues resolved (e41a5cd)
- v0.5.17-dev: GitIntegration full coverage + stress test drift fix (45b9271)

## v0.5.6 (2026-07-07)
- CI hardening: zero TS/lint errors, 3568 tests, all green (multiple PRs)
- Branch coverage hardening across 12 tool files
- Parallel test runner optimization: 90s→35s (2.6× speedup)

## v0.5.5 (2026-07-01)
- Typed errors migration: 48/49 throw sites migrated
- Gap #5: HallucinationGuard confidence scoring (0-1)
- Gap #8: MetaReasoner → AgentLoop feedback
- Gap #9: ContinuousEvolution degradation callback
- Performance: SemanticCache O(n²)→O(n), StateStore write-behind queue (2s flush)
- Memory pruning: MetaReasoner MAX_VERSIONS=100 cap

## v0.5.4 (2026-06-28)
- Ponytail refactor (src/index.ts): -189 lines net
- Second Brain events: plan.created, step.completed, step.failed
- Gap #9 feedback events: feedback.recorded

## v0.5.3 (2026-06-24)
- P0 (Reliability): Promise.race timeout fixes across agent-loop, debate-loop, agent-runtime
- P0 (Errors): Custom error classes: AgenticError, TimeoutError, SessionNotFoundError
- P1 (Observability): console.warn to all silent catch blocks
- P2 (Types): 88% reduction in `as any` casts (25→3)
- P2 (Knowledge-First): bootstrap-knowledge.ts — seeds RAG with 10 entries
- 2727+ unit tests

## v0.5.2 (2026-06-20)
- SemanticCache: TF-IDF + cosine similarity
- Gap #7: LLM response cache, benchmarked at 0.78 threshold
- HallucinationGuard: confidence-aware claims

## v0.5.1 (2026-06-15)
- MetaReasoner: strategy adaptation with agent-loop feedback
- ContinuousEvolution: degradation detection + callback
- AlignmentGate: goal drift detection via TF-IDF similarity (Gap #10)
- EconomicModel: cost-aware orchestration + ROI tracking (Gap #11)

## v0.5.0 (2026-06-10)
- Self-Improving RAG: 6 new modules from 22 research papers
- RAGQualityScorer: 5-dimensi quality (SCIM, MDPI 2026)
- RAGFeedbackLoop: Closed-loop execution feedback (ITM Web 2026)
- RAGAdaptiveRetrieval: 4-mode search with auto-escalate
- MDPRetrievalAgent: MDP action space (EvoGraph-R1, CVPR 2026)
- KnowledgeBoundaryCalibrator: 4-quadrant taxonomy (KbPO, ACL 2026)
- RAGContextOptimizer: MMKP-inspired token-budget selection (ACL 2026)
- WorkflowPolicy Gate: runtime enforcement
- Schema-First Boundaries: LLM output validation
- Dumb Model Mode: strict mode for weak models
- Procedural Skills: step-by-step checklist in RAG
- Test Coverage: 3568+ tests in parallel (~27s)
- 12 paper gaps (arXiv:2606.05608) all covered
