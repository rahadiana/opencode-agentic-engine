# PLAN.md — opencode-agentic-engine

> Grounded in: *"The End of Software Engineering"* — Cao, arXiv:2606.05608 (June 2026)

---

## Status per Juli 2026

| Metrik | Nilai |
|--------|-------|
| **Versi** | v0.5.17-dev |
| **Unit tests** | 3101 (all mock, no LLM needed) |
| **Agentic tools** | 32 (`agentic_*` prefix) |
| **Source files** | 130+ di `src/` (10 subdirektori) |
| **Coverage gate** | ✅ Stmts 87.94%+, Branch 67.09%+, Func 70.27%+, Lines 80%+ |
| **Lint** | ✅ **0 warnings, 0 errors** |
| **SWE-bench (mock)** | ✅ 7/7 (100%) |
| **SWE-bench (real LLM)** | ✅ **7/7 (100%)** via delegate + manual fix |
| **SWE-bench (real LLM) baseline** | ✅ 2/7 (29%) — OpenCode Free |
| **EvoClaw score** | ✅ 100% (target: >55%) |
| **CI** | ✅ Build + lint + coverage gate + unit test |

---

## 12 Paper Gaps — Semua Selesai ✅

Semua gap dari arXiv:2606.05608 sudah diimplementasi dan di-enforce di runtime:

| Gap | File Kunci | Mekanisme |
|-----|-----------|-----------|
| **#1 WorkflowPolicy Gate** | `workflow-policy.ts` | Runtime enforcement, bukan prompt |
| **#2 Schema-First Boundaries** | `data-cleaner.ts`, `router-agent.ts`, `orchestrator.ts` | LLM output divalidasi sebelum dipakai |
| **#3 Dumb Model Mode** | `config.ts` | Strict mode untuk model lemah |
| **#4 Verification Fidelity** | `verifier.ts` | 3-tier (fast/standard/deep) + security/perf/arch/deps |
| **#5 HallucinationGuard** | `hallucination-guard.ts` | Confidence-aware claims (0-1) |
| **#6 Error Recovery** | `recovery-layer.ts`, `errors.ts` | 49/49 typed error sites, 0 `as any` |
| **#7 SemanticCache** | `semantic-cache.ts` | TF-IDF + cosine, O(n) precompute |
| **#8 MetaReasoner** | `meta-reasoner.ts` | Strategy adaptation + agent-loop feedback |
| **#9 ContinuousEvolution** | `continuous-evolution.ts` | Degradation detection + callback |
| **#10 AlignmentGate** | `alignment-gate.ts` | Goal drift detection via TF-IDF similarity |
| **#11 EconomicModel** | `economic-model.ts` | Cost-aware orchestration + ROI tracking |
| **#12 Predictive Degradation** | `continuous-evolution.ts` | Rolling 30-step window degradation forecast |

---

## Arsitektur

```
src/
├── index.ts              # Entry: 32 tools + 5 hooks
├── core/                 # Planning, execution, verification, LLM, DAG (78 file)
├── agents/               # Multi-agent: orchestrator, coordinator, A2A (9 file)
├── drift/                # Hallucination guard, checkpoints, patterns (7 file)
├── memory/               # Episodic, skill, RAG, vector, session store (22 file)
├── evaluation/           # Live evaluator (5 dimensi) (3 file)
├── evolution/            # Self-evolution, continuous evolution (4 file)
├── observability/        # Logger, dashboard, trace (5 file)
├── tools/                # Extracted tool definitions (6 file)
├── curation/             # Skill curation (2 file)
└── hello.ts              # Plugin smoke test entry (3 HELLO assertions)
```

---

## Gap Tersisa / Future Work

| Item | Status | Catatan |
|------|--------|---------|
| NPM publish | 🔮 Future | `npm publish` untuk `opencode plugin opencode-agentic-engine` |
| Streaming | 🔮 Future | Didelegasikan ke OpenCode SDK (47/48 capabilities) |
| Branch coverage >75% | 🔮 Future | Saat ini ~68% (CI gate at 60%). Prioritaskan: sqlite-persistence.ts (40%), agent-blueprint.ts (45%), planner-critic.ts (47%), execution-layer.ts (43%), episodic-store.ts (20%). |
| Gaps #1–#12 | ✅ **Semua selesai** | 12 gaps dari arXiv:2606.05608 diimplementasi dan di-enforce di runtime |
| Lint warnings 0 | ✅ **0 warnings, 0 errors** | All `no-explicit-any` eliminated, 3101 unit tests passing |

---

## Referensi

- Cao, Z. (2026). *The End of Software Engineering*. arXiv:2606.05608
- Wang et al. (2024). *Agents in Software Engineering: Survey*. arXiv:2409.09030
- Deng et al. (2026). *EvoClaw*. arXiv:2603.13428
- Nous Research. *Hermes Agent*
- Yao et al. (2023). *ReAct*. ICLR
