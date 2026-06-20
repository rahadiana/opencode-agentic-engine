# Comparison 14: Hierarchical Planner (Macro → Micro Decomposition)

## Source
`MARKDOWN_PLAN/14 - hierarchical planner (macro → micro decomposition).md` — Two-level planning

## Inti Konsep
- **Macro Planner** (LLM): pecah goal jadi sub-goals dengan dependencies
- **Micro Planner** (LLM + tree search): tiap sub-goal → executable steps
- **Topological sort** berdasarkan `depends_on`
- **Context passing**: output sub-goal → input sub-goal berikutnya
- **Error recovery**: retry micro planner jika sub-goal gagal
- **Critic integration**: per sub-goal ada kritik sebelum eksekusi
- Guard: max 5 sub-goals, max 5 steps per sub-goal

## Yang Kita Punya
- **Planner** (`src/core/planner.ts`): auto-decompose task templates.
- **Orchestrator** (`src/agents/orchestrator.ts`): multi-agent pipeline (PM → Arch → Dev → QA).
- **Coordinator** (`src/agents/coordinator.ts`): delegate to agent roles.
- **Parallel** (`src/core/parallel.ts`): dependency-based concurrent execution.

## Gap
1. **⚠️ Hierarchical Decomposition** — Planner kita flat (semua step satu level). Mereka punya macro → micro.
2. **❌ Dependency Resolution** — Kita punya `dependsOn` di plan steps tapi tidak topological sort.
3. **❌ Context Passing** — Tidak ada mekanisme otomatis passing output antar sub-goal.
4. **❌ Per-subgoal Error Recovery** — Kita retry step, bukan re-plan sub-goal.
5. **❌ Per-subgoal Critic** — Critic kita global, bukan per sub-goal.

## Kesimpulan
**Kita punya multi-agent pipeline (PM→Arch→Dev→QA) yang mirip hierarchical planning secara konsep.** Tapi pipeline kita adalah agent roles, bukan planning levels. Hierarchical planner mereka lebih cocok untuk task decomposition; pipeline kita lebih cocok untuk multi-perspective review.

**Yang bisa kita adopsi:** macro → micro decomposition + topological dependency sort + context passing.
