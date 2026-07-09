# evolution/ — Self-Evolution (Stage IV)

| File | Fungsi |
|------|--------|
| `continuous-evolution.ts` | Rolling window success rate; Gap #12 degradation detection + `onDegradation` callback |
| `self-evolver.ts` | Skill/prompt patches dari failure patterns |
| `auto-evolve.ts` | `gatherEvolutionData` + `runAutoEvolve` (dipakai tool + execute feedback path) |

## Trigger

1. Tool: `agentic_evolve` (inspect, register-role, export-skill, evolve, prompts, training export)
2. Auto: `eventBus` step.completed/failed → `continuousEvolution.feedStepResult` → `checkAutoEvolve`
3. User feedback negative di `agentic_execute` → `shouldEvolve` → `runAutoEvolve`

## Kaitan harness

ContinuousEvolution **bukan** dumb-model detector, tapi menutup loop “model jelek → adapt strategy/skills”.  
Model reliability (quarantine) ada di `core/model-registry.ts`; auto dumb harness membaca stats yang sama.
