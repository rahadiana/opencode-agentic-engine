# Comparison 13: LLM Planner + Critic (Self-Reflection Loop)

## Source
`MARKDOWN_PLAN/13 - LLM planner + critic (self-reflection loop) .md` — LLM-driven planning + critique

## Inti Konsep
- **LLM Planner**: generate candidate plans (max 4, max 5 steps per plan)
- **Critic**: evaluate plans — score 0.0-1.0, issues, suggestions
- **Loop**: refine plans based on critic feedback, max 3 iterations
- **Accept threshold**: score ≥ 0.85
- **Fallback**: best available setelah max iter
- Integration dengan tree search: expand plans via beam search
- JSON kontrak ketat untuk input/output

## Yang Kita Punya
- **Debate Loop** (`src/core/debate-loop.ts`): executor ↔ critic debate.
- **Planner** (`src/core/planner.ts`): auto-decompose via LLM.
- **Verifier** (`src/core/verifier.ts`): compile + test verification.
- **Agent Loop** (`src/core/agent-loop.ts`): plan → execute → verify → retry.

## Gap
1. **⚠️ Critic Loop** — Kita punya debate loop (executor ↔ critic), tapi tidak terintegrasi dengan planner sebagai self-reflection cycle.
2. **❌ Refine Plans** — Tidak ada mekanisme refine plan berdasarkan critic feedback.
3. **❌ Multiple Candidate Plans** — Planner kita generate 1 plan; mereka generate 2-4.
4. **❌ Accept Threshold** — Tidak ada score threshold untuk "plan is good enough".
5. **❌ Fallback** — Tidak ada best-available fallback jika refinement gagal.
6. **⚠️ Structured JSON Contract** — Planner kita return Step[]; mereka return `{ plans: [{ id, steps[], rationale }] }`.

## Kesimpulan
**Kita punya debate loop tapi tidak self-reflection planning loop.** Debate kita antara executor ↔ critic untuk analisis hasil; reflection loop mereka antara planner ↔ critic untuk improve plan SEBELUM eksekusi. Kita perlu integrate critic feedback ke planning phase.

**Yang bisa kita adopsi:** refine loop + multiple candidate plans + accept threshold.
