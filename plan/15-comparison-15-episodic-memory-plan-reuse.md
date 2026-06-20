# Comparison 15: Episodic Memory + Plan Reuse System

## Source
`MARKDOWN_PLAN/15 - episodic memory + plan reuse system.md` — Experience-based planning

## Inti Konsep
- **Episodic Memory**: tabel Episode — `{ goal, embedding, plan, result, success, score }`
- **Vector search** episodic memory: cosine similarity untuk cari episode mirip
- **Reuse threshold**: ≥ 0.8 + episode.success = true
- **Plan adaptation**: inject input baru, jangan copy blind
- **Memory decay**: `score *= exp(-0.03 * ageDays)` — episodic memory juga decay
- **Pruning**: hapus episode score < 0.3 DAN usage < 2
- **Failure awareness**: jangan reuse episode gagal

## Yang Kita Punya
- **Episodic Store** (`src/memory/episodic-store.ts`): cross-session memory dengan versioned schema.
- **Session Store** (`src/memory/session-store.ts`): conversation turns + plan + progress.
- **Multi-Index RAG** (`src/memory/multi-index-rag.ts`): category-segregated RAG.
- **Persistence** (`src/memory/persistence.ts`): file-based JSON persistence.
- **Vector Store** (`src/memory/vector-store.ts`): vector similarity search.

## Gap
1. **⚠️ Episodic Memory** — Kita punya episodic store TAPI menggunakan sliding window, bukan vector search + decay. Store kita simpan conversation + results, bukan `{ goal, plan, result }` explicitly.
2. **❌ Plan Reuse** — Kita tidak punya mekanisme "cari episode mirip → reuse plan".
3. **❌ Plan Adaptation** — Tidak ada adaptPlan() untuk inject input baru ke plan lama.
4. **❌ Episode Decay** — Tidak ada decay untuk episode lama.
5. **❌ Episode Pruning** — Tidak ada cleanup periodic.
6. **⚠️ Failure Awareness** — Kita punya error tracking, tapi tidak untuk filtering reuse.

## Kesimpulan
**Kita punya infrastruktur memory yang lebih kompleks (RAG, vector, episodic, session) TAPI tidak terintegrasi dengan planner untuk plan reuse.** Mereka pendekatan lebih sederhana tapi efektif: episode → search → reuse OR plan from scratch.

**Yang bisa kita adopsi:** reuse threshold + plan adaptation + episode decay + failure-aware filtering.
