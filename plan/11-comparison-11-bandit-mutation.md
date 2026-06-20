# Comparison 11: Skill Mutation + Exploration (Bandit Strategy)

## Source
`MARKDOWN_PLAN/11 - skill mutation + exploration (bandit strategy).md` — Evolutionary selection

## Inti Konsep
- **UCB1 Bandit**: `score = skill.score + c * sqrt(log(totalSelections) / (usage + 1))`
- Exploration rate: 20% random explore
- **Mutation**: generate skill variant — tweak parameter, ubah op, simplify
- Safe mutation: validateDSL sebelum test
- Promotion: hanya jika `mutatedScore > parentScore + 0.05`
- Limits: MAX_MUTATIONS_PER_SKILL = 3, MAX_TOTAL_VARIANTS = 50
- Evaluasi mutated skill: test dengan test cases yang sama

## Yang Kita Punya
- **Skill Store** (`src/memory/skill-store.ts`): success rate, usage count.
- **Evolution** (`src/evolution/self-evolver.ts`): Stage IV self-evolution.
- **Continuous Evolution** (`src/evolution/continuous-evolution.ts`): continuous loop.

## Gap
1. **❌ UCB1 Bandit** — Kita tidak punya exploration/exploitation tradeoff. Selection kita pure score-based.
2. **❌ Skill Mutation** — Kita tidak punya mekanisme generate variant skill.
3. **❌ Exploration Rate** — Tidak ada konsep "kadang coba skill baru meski ada yang lebih baik".
4. **❌ Promotion Rule** — Tidak ada threshold `+0.05` untuk promote variant.
5. **❌ Mutation Limits** — Tidak ada guard untuk jumlah mutasi per skill.
6. **❌ A/B Testing** — Tidak ada bandingkan old vs new skill secara sistematis.

## Kesimpulan
**Bandit strategy adalah konsep advanced yang kita tidak punya sama sekali.** Kita always exploit (pilih skill terbaik), never explore (coba skill baru). Ini bisa menyebabkan stagnation. Tapi untuk tool calling effectiveness, ini kurang prioritas dibanding DSL executor.
