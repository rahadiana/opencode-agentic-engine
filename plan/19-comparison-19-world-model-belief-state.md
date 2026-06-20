# Comparison 19: World Model + Belief State System

## Source
`MARKDOWN_PLAN/19 - world model + belief state system.md` — Agent's understanding of reality

## Inti Konsep
- **World Model**: `{ entities, relations, last_updated }` — representasi kondisi dunia
- **Belief State**: `{ facts, confidence, history }` — keyakinan agent + uncertainty
- **Observation → Belief Update**: tiap hasil eksekusi update belief + confidence
- **Belief-driven decision**: `if (belief.facts["data_loaded"]) skip fetch`
- **Belief Decay**: `confidence *= 0.98` periodic
- **Conflict resolution**: jika data bertentangan → `confidence *= 0.5`
- **Uncertainty threshold**: `isReliable(belief, key)` → confidence > 0.7

## Yang Kita Punya
- **Session Store** (`src/memory/session-store.ts`): conversation + plan + progress tracking.
- **Dependency Tracker** (`src/drift/dependency-tracker.ts`): file changes + error propagation.
- **Checkpoints** (`src/drift/checkpoints.ts`): risk evaluation BLOCK/REVIEW/WARNING.
- **Model Registry** (`src/core/model-registry.ts`): per-role model preferences.

## Gap
1. **❌ World Model** — Tidak ada representasi terpusat dari "state of the world" (project state, file state, etc).
2. **❌ Belief State** — Tidak ada konsep keyakinan dengan confidence score.
3. **❌ Observation Pipeline** — Tidak ada mekanisme otomatis: execution result → belief update.
4. **❌ Uncertainty Handling** — Tidak ada confidence threshold untuk decision making.
5. **❌ Belief Decay** — Tidak ada forgetting mechanism.

## Kesimpulan
**World model + belief state adalah konsep cognitive architecture yang kita tidak punya sama sekali.** Kita track file changes dan session state, tapi bukan sebagai "model of reality" dengan uncertainty. Ini advanced concept yang berguna untuk long-running agents, tapi overkill untuk tool calling improvement.
