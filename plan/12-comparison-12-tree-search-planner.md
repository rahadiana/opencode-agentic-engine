# Comparison 12: Planner Tree Search + Multi-step Reasoning

## Source
`MARKDOWN_PLAN/12 - planner tree search + multi-step reasoning engine.md` — Search-based planning

## Inti Konsep
- **Tree search dengan Beam Search**: BEAM_WIDTH = 3, MAX_DEPTH = 4
- State-based: `{ goal, steps[], current_output, score, depth }`
- Expansion: cari top-K capability → buat kandidat plan baru
- Scoring: `1/(steps+1)` (short plan bias) + diversity bonus
- Partial simulation: dry-run step untuk scoring lebih akurat
- Early stop: jika score > 0.9
- BFS fallback: beam search cegah combinatorial explosion

## Yang Kita Punya
- **Planner** (`src/core/planner.ts`): auto-decompose task via LLM + templates (create/fix/refactor/test).
- **Agent Loop** (`src/core/agent-loop.ts`): sequential plan → execute.
- **Router Agent** (`src/core/router-agent.ts`): intent classification + routing.

## Gap
1. **❌ Tree Search** — Planner kita LLM-only. Tidak ada search/exploration of multiple plans.
2. **❌ Beam Search** — Tidak ada beam width / branching factor control.
3. **❌ State-based Planning** — Tidak ada `PlanStep[]` state yang di-expand.
4. **❌ Scoring Function** — Tidak ada scoring plan selain "apakah LLM bilang ini plan bagus".
5. **❌ Partial Simulation** — Tidak ada dry-run untuk evaluasi plan sebelum eksekusi.
6. **❌ Early Stop** — Tidak ada threshold-based early termination.
7. **❌ Diversity Bonus** — Tidak ada mekanisme encourage plan diversity.

## Kesimpulan
**Perbedaan approach: LLM-only planning vs search-based planning.** Kita fully rely on LLM untuk generate plan; mereka kombinasi LLM + tree search. Search-based planning lebih mahal compute tapi lebih reliable. Ini bisa jadi improvement besar untuk plan quality.
