# Comparison 08: Filter + Reduce + Aggregator DSL

## Source
`MARKDOWN_PLAN/8 - filter + reduce + aggregator DSL.md` — Data processing pipeline

## Inti Konsep
- Ops baru: `filter`, `reduce`, `sum`, `avg`, `count`, `min`, `max`
- `filter`: inner steps + `condition` untuk keep/reject item
- `reduce`: accumulator pattern dengan `initial` value
- Aggregator ops: shortcut untuk reduce umum
- Semua punya size limits: MAX_ARRAY = 100, MAX_INNER_STEPS = 50
- Pipeline: map → filter → reduce → output

## Yang Kita Punya
- **Model Registry** (`src/core/model-registry.ts`): model selection.
- **Budget Tracker** (`src/core/budget-tracker.ts`): cost/token tracking.
- **Dashboard** (`src/observability/dashboard.ts`): stats dan analytics.

## Gap
1. **❌ Filter Op** — Tidak ada operasi seleksi data.
2. **❌ Reduce Op** — Tidak ada operasi agregasi.
3. **❌ Aggregator Shortcuts** — Tidak ada sum/avg/count/min/max.
4. **❌ Data Pipeline** — Tidak ada konsep pipeline data processing.
5. **❌ Condition-based Selection** — Tidak ada filter condition.

## Kesimpulan
**Data processing ops tidak relevan untuk tool calling engineering agent.** Mereka bangun generic autonomous agent; kita bangun software engineering agent. Tapi concept filter/reduce bisa diadaptasi untuk tool selection logic — misalnya filter tools by relevance, reduce ke top-K.
