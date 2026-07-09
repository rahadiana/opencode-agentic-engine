# evaluation/ — Live Evaluation

| File | Fungsi |
|------|--------|
| `live-evaluator.ts` | 5-dimensi real-time scoring dari tool hooks / events |

## Dimensi

| Dimensi | Bobot | Target |
|---------|-------|--------|
| `taskSuccess` | 40% | >80% step success |
| `errorRecovery` | 20% | >70% recovered errors |
| `contextStability` | 15% | >80% focused navigation |
| `multiAgent` | 15% | >90% delegation success |
| `skillReuse` | 10% | >50% skill found |

Feed dari EventBus (`step.completed` / `step.failed` / delegation) di `index.ts`.  
Skor di dashboard: `agentic_status detail="full"`.
