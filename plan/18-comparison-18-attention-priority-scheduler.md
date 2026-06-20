# Comparison 18: Attention + Priority Scheduler di Blackboard

## Source
`MARKDOWN_PLAN/18 - attention + priority scheduler di blackboard.md` — Focused agent execution

## Inti Konsep
- **Attention**: agent hanya baca "focus slice" dari blackboard, bukan seluruh state
- `setAttention(bb, ["goal", "memory"])` — planner fokus ke goal + memory
- **Priority Scheduler**: agents registered dengan priority score
- **Dynamic priority**: urgency boost (critique low), stagnation boost (cycle > 2)
- **Scheduler loop**: sort runnable agents by priority → execute highest → repeat
- **Starvation prevention**: cooldown setelah run
- MAX_CYCLES = 10

## Yang Kita Punya
- **Context Compressor** (`src/drift/context-compressor.ts`): sliding window + key info extraction.
- **Agent Runtime** (`src/agents/agent-runtime.ts`): sub-process spawner.
- **Orchestrator** (`src/agents/orchestrator.ts`): pipeline stage management.

## Gap
1. **❌ Attention Mechanism** — Tidak ada konsep "agent fokus ke subset state". Context compressor kita untuk token limit, bukan untuk attention.
2. **❌ Priority Scheduler** — Pipeline kita deterministic (stage 1 → 2 → 3). Tidak ada dynamic priority.
3. **❌ Runnable Agents** — Tidak ada mekanisme `canRun(state)` untuk menentukan agent mana yang eligible.
4. **❌ Dynamic Priority** — Tidak ada urgency/stagnation boost.
5. **❌ Starvation Prevention** — Tidak ada cooldown mekanisme.

## Kesimpulan
**Attention + priority scheduler adalah konsep advanced yang kita tidak punya.** Ini berguna untuk sistem dengan banyak agent yang perlu koordinasi kompleks. Untuk sekarang (tool calling effectiveness), ini kurang prioritas.
