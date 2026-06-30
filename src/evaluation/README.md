# evaluation/ — Live Evaluation

| File | Fungsi |
|------|--------|
| `live-evaluator.ts` | 5-dimensi real-time scoring dari tool hooks |

## Dimensi

| Dimensi | Bobot | Target |
|---------|-------|--------|
| `taskSuccess` | 40% | >80% step success |
| `errorRecovery` | 20% | >70% recovered errors |
| `contextStability` | 15% | >80% focused navigation |
| `multiAgent` | 15% | >90% delegation success |
| `skillReuse` | 10% | >50% skill found |

Skor ditampilkan di dashboard via `agentic_status detail="full"`.
