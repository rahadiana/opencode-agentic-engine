# Comparison 06: Call Skill + Skill Composition

## Source
`MARKDOWN_PLAN/6 - call_skill + skill composition.md` — Nested skill execution

## Inti Konsep
- Op baru: `call_skill` — panggil skill lain dari dalam DSL
- Skill dipanggil via **capability string**, bukan nama — lookup di registry
- Depth limit (MAX_DEPTH = 3) anti infinite recursion
- Input resolution dari parent context
- Output normalization: semua skill harus return `{ result }`
- Skill level 1 (atomic) → skill level 2 (composition)
- Contoh: `sum_three_numbers` panggil `math.add` dua kali

## Yang Kita Punya
- **Skill Store** (`src/memory/skill-store.ts`): find skill by keyword/pattern.
- **Skill Training** (`src/memory/skill-training.ts`): export skill ke training data.
- **Orchestrator** (`src/agents/orchestrator.ts`): multi-agent pipeline.
- **Parallel** (`src/core/parallel.ts`): dependency-based concurrency.

## Gap
1. **❌ Skill Chaining di Runtime** — Kita tidak punya mekanisme satu skill panggil skill lain saat eksekusi.
2. **❌ Depth Limit** — Tidak ada anti-recursion guard.
3. **❌ Output Normalization** — Tidak ada standardisasi output skill (`{ result }`).
4. **❌ Registry Lookup** — Skill lookup kita keyword-based, bukan capability exact match.
5. **❌ Atomic vs Composite** — Tidak ada perbedaan level skill.

## Kesimpulan
**Skill composition adalah konsep yang kita tidak punya sama sekali.** Skill kita isolated — tidak bisa saling memanggil. Ini membatasi kemampuan reuse dan scaling. Mereka punya hierarchical skill system di mana atomic skill jadi building block untuk composite skill.
