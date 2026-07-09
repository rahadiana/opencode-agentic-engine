# drift/ — Error Detection & Recovery

| File | Fungsi |
|------|--------|
| `checkpoints.ts` | Risk evaluation: BLOCK / REVIEW / WARNING (deletion, mass change, secrets, …) |
| `context-compressor.ts` | Sliding window + key info extraction |
| `dependency-tracker.ts` | Per-session file change + error propagation across steps |
| `hallucination-guard.ts` | Claim verification (file/func/import/api) + confidence 0–1; auto di `agentic_execute` |
| `pattern-discovery.ts` | Recurring error patterns dari riwayat |

## Flow

```
agentic_execute
  → WorkflowPolicy (core) — boleh BLOCK dulu (research-missing, …)
  → record result
  → HallucinationGuard (jika autoHallucinationCheck)
      → dumb harness ON → threshold lebih ketat + blockOnHallucination effective
  → checkpoints.evaluate
  → dependencyTracker.recordChange / analyzeErrorPropagation
  → patternDiscovery (via AgentLoop / events)
```

## Catatan

- Guard **auto** di execute (`config.agent.autoHallucinationCheck`, default true).
- `agentic_guard` = re-check manual, bukan pengganti auto-check.
- Checkpoint types beda dari WorkflowPolicy: checkpoint = risk UX; policy = workflow gate.
