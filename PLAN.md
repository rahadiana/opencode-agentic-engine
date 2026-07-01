# PLAN.md — opencode-agentic-engine

> Grounded in: *"The End of Software Engineering"* — Cao, arXiv:2606.05608 (June 2026)

---

## Status per Juli 2026

| Metrik | Nilai |
|--------|-------|
| **Versi** | v0.5.7-dev |
| **Unit tests** | 2314 (all mock, no LLM needed) |
| **Agentic tools** | 31 (`agentic_*` prefix) |
| **Source files** | 80+ di `src/` (7 subdirektori) |
| **Coverage gate** | ✅ Stmts 86.88%, Branch 67.12%, Func 74.86%, Lines 86.88% |
| **dag-engine.ts branch** | ✅ 89.87% (up from 70.4%) |
| **execution-helpers.ts branch** | ✅ 100% (up from 12.5%) |
| **Lint** | ✅ 0 errors, 56 warnings |
| **SWE-bench (mock)** | ✅ 7/7 (100%) |
| **EvoClaw score** | ✅ 99% (target: >55%) |
| **CI** | Build + lint + coverage gate + unit test |

---

## 9 Paper Gaps — Semua Selesai ✅

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

---

## Arsitektur

```
src/
├── index.ts              # Entry: 31 tools + 5 hooks
├── core/                 # Planning, execution, verification, LLM, DAG
├── agents/               # Multi-agent: orchestrator, coordinator, A2A
├── drift/                # Hallucination guard, checkpoints, patterns
├── memory/               # Episodic, skill, RAG, vector, session store
├── evaluation/           # Live evaluator (5 dimensi)
├── evolution/            # Self-evolution, continuous evolution
└── observability/        # Logger, dashboard, trace
```

---

## Gap Tersisa / Future Work

| Item | Status | Catatan |
|------|--------|---------|
| NPM publish | 🔮 Future | `npm publish` untuk `opencode plugin opencode-agentic-engine` |
| Streaming | 🔮 Future | Didelegasikan ke OpenCode SDK (47/48 capabilities) |
| SWE-bench real LLM eval | 🔮 Future | Butuh model capable (harness sudah siap) |
| Branch coverage >75% | 🔮 Future | Saat ini 67.12%; execution-helpers.ts 100%, dag-engine.ts 89.87%, debate-loop.ts 76.59%, verifier.ts 70.58% |
| Lint warnings 0 | 🔮 Future | 62 `no-explicit-any` warnings tersisa |

---

## Referensi

- Cao, Z. (2026). *The End of Software Engineering*. arXiv:2606.05608
- Wang et al. (2024). *Agents in Software Engineering: Survey*. arXiv:2409.09030
- Deng et al. (2026). *EvoClaw*. arXiv:2603.13428
- Nous Research. *Hermes Agent*
- Yao et al. (2023). *ReAct*. ICLR
