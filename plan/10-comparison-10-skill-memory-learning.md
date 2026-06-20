# Comparison 10: Skill Memory + Learning (Decay, Reinforcement, Versioning)

## Source
`MARKDOWN_PLAN/10 - skill memory + learning (decay, reinforcement, versioning).md` — Evolutionary skill system

## Inti Konsep
- **Reinforcement**: update score tiap execution — `score = (skill.score * 0.7) + (successRate * 0.3)`
- **Decay**: periodic job — `score *= exp(-0.05 * daysIdle)` — skill jarang dipakai menurun
- **Versioning**: setiap improvement → versi baru dengan `parent_id`
- **Selection**: ambil versi dengan score tertinggi
- **Pruning**: hapus skill dengan score < 0.3 DAN usage < 3
- **Combined Score**: `(similarity * 0.6) + (skill.score * 0.3) + (freshness * 0.1)`

## Yang Kita Punya
- **Skill Store** (`src/memory/skill-store.ts`): success rate, usage count, sliding window.
- **Schema Version** (`src/memory/schema-version.ts`): versioned memory envelope.
- **Session Store** (`src/memory/session-store.ts`): conversation tracking.
- **Episodic Store** (`src/memory/episodic-store.ts`): cross-session memory.
- **Dashboard** (`src/observability/dashboard.ts`): stats tracking.

## Gap
1. **❌ Reinforcement Formula** — Kita punya success rate tracking, tapi tidak ada formula update score yang eksplisit. Score kita hanya `successCount / usageCount`.
2. **❌ Decay Mechanism** — Kita tidak punya periodic decay untuk skill yang jarang dipakai. Skill "mati" tetap hidup selamanya.
3. **❌ Skill Versioning** — Kita tidak punya versioning dengan lineage (parent_id). Skill di-overwrite.
4. **❌ Freshness Score** — Tidak ada `freshness = exp(-0.1 * days)` dalam ranking.
5. **❌ Pruning** — Tidak ada cleanup otomatis untuk skill jelek.
6. **❌ Combined Score** — Tidak ada formula multi-faktor untuk skill selection.

## Kesimpulan
**Kita punya data mentahnya (success rate, usage count) tapi tidak punya sistem learning yang mengintegrasikannya.** Mereka punya reinforcement + decay + versioning + pruning — sistem learning loop yang lengkap. Kita perlu adopt formula mereka.

**Yang bisa kita adopsi:** reinforcement update formula, decay mechanism, versioning dengan parent_id, pruning.
