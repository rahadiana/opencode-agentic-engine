# evolution/ — Self-Evolution (Stage IV)

| File | Fungsi |
|------|--------|
| `continuous-evolution.ts` | Monitoring rolling 30-step window. Gap #12 predictive degradation detection |
| `self-evolver.ts` | Analisis skill <80% success rate → generate patches (add_rollback, add_step, add_verify, add_guard, tighten_i_o, add_fallback). Suggest agent roles dari failure patterns |

## Trigger

Via `agentic_evolve` tool: inspect, register-role, export-skill, evolve, manage prompts.
