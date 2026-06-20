# Comparison 22: Meta-Reasoning + Self-Improvement Strategy Layer

## Source
`MARKDOWN_PLAN/22 - meta-reasoning + self-improvement strategy layer.md` — Learning how to learn

## Inti Konsep
- **Meta-Reasoner**: amati cara agent berpikir, nilai kualitas strategi
- **Strategy Config**: `{ exploration_rate, beam_width, max_depth, reuse_threshold, curiosity_weight }`
- **Performance Analysis**: success rate, avg critic score, avg retries (last 5)
- **Strategy Adaptation**: jika gagal → naikkan exploration; jika retry banyak → naikkan beam
- **Meta Loop**: agent `meta_reasoner` priority 5, jalan saat `status === "done"`
- **Strategy Memory**: simpan strategi + performa historis
- **Rollback**: jika performa turun, revert ke strategi sebelumnya

## Yang Kita Punya
- **Self Evolver** (`src/evolution/self-evolver.ts`): agent prompt evolution (Stage IV).
- **Continuous Evolution** (`src/evolution/continuous-evolution.ts`): continuous evolution loop.
- **Fine Tuning** (`src/core/fine-tuning.ts`): convert skills → training data.
- **Dashboard** (`src/observability/dashboard.ts`): timeline + stats + anomaly detection.
- **Pattern Discovery** (`src/drift/pattern-discovery.ts`): error pattern discovery.

## Gap
1. **❌ Strategy Config** — Kita tidak punya centralized config yang bisa di-adapt oleh agent sendiri.
2. **❌ Performance Analysis** — Dashboard kita untuk observability (human read), bukan untuk agent self-analysis.
3. **❌ Strategy Adaptation** — Self-evolver kita untuk prompt evolution, bukan untuk strategy params.
4. **❌ Meta Loop** — Tidak ada agent yang mengamati dan mengoptimalkan agent lain.
5. **❌ Strategy Rollback** — Tidak ada mekanisme revert strategi jika performa turun.

## Kesimpulan
**Kita punya self-evolution (Stage IV) tapi dengan approach berbeda.** Evolusi kita berbasis prompt evolution (ubah system prompt agent); evolusi mereka berbasis parameter strategy (ubah exploration rate, beam width, dll). Dua approach komplementer.

**Yang bisa kita adopsi:** parameterized strategy config + performance-based auto-tuning.
