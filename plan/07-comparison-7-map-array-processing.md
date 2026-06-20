# Comparison 07: Map + Array Processing ke DSL

## Source
`MARKDOWN_PLAN/7 - map + array processing ke DSL.md` — Batch processing

## Inti Konsep
- Op baru: `map` — loop array dengan inner steps
- Format: `{ source, as, index_as, steps, to }`
- Sub-context per item: memory di-copy + tambah item/index
- Map memiliki inner IP + inner MAX_STEPS = 50
- Array size limit: MAX_ARRAY = 100
- Output: array of objects dengan `{ output }`
- Contoh: `increment_array([1,2,3]) → [{value:2},{value:3},{value:4}]`

## Yang Kita Punya
- **Parallel** (`src/core/parallel.ts`): dependency-based concurrency — bisa run multiple steps simultaneously.
- **Navigator** (`src/core/navigator.ts`): scan multiple files.

## Gap
1. **❌ Map Op** — Kita tidak punya operasi array processing di execution layer.
2. **❌ Sub-context** — Tidak ada konsep isolated context per iteration.
3. **❌ Array Processing** — Kita tidak punya batch/collection processing capability.
4. **❌ Index Tracking** — Tidak ada `index_as` untuk tracking iteration.
5. **❌ Size Limits** — Kita tidak punya MAX_ARRAY guard di execution.

## Kesimpulan
Array processing adalah fitur yang **tidak relevan untuk tool calling** (yang kita fokuskan), tapi penting untuk data processing. Kita bisa skip ini untuk sekarang, tapi berguna kalau nanti mau handle bulk operations.
