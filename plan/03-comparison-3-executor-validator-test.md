# Comparison 03: Executor + Validator + Test System

## Source
`MARKDOWN_PLAN/3 - executor + validator + test system.md` — DSL-based executor

## Inti Konsep
- **DSL Executor** (bukan JS bebas): instruction-based dengan ops `get`, `set`, `add`, `subtract`, `multiply`, `divide`, `concat`
- Context-based: `{ input, output, memory }` — memory sebagai register sementara
- Path resolution: `getPath(ctx, "input.a")` dan `setPath(ctx, "output.result", value)`
- resolveValue: bisa ambil dari memory atau literal
- validateDSL: whitelist ops, step count limit (max 50)
- **TIDAK** pakai `eval` atau `new Function` — pure interpreter

## Yang Kita Punya
- **Executor** (`src/core/executor.ts`): step execution dengan retry tracking, stateful, tapi step berupa deskripsi teks.
- **Verifier** (`src/core/verifier.ts`): compile + test + security + perf + arch + deps.
- **Config** (`src/core/config.ts`): timeout, max retries.

## Gap
1. **❌ DSL Interpreter** — Kita tidak punya interpreter. Step description cuma teks yang diproses LLM.
2. **❌ Memory Register** — Kita tidak punya konsep memory register untuk passing data antar step dalam skill.
3. **❌ Ops Whitelist** — Kita tidak punya kumpulan operasi deterministic yang terbatas dan terverifikasi.
4. **❌ Sandbox Execution** — Kita tidak punya VM sandbox untuk code execution.
5. **❌ DSL Validation** — Kita tidak punya validateDSL() yang ngecek struktur logic sebelum run.

## Kesimpulan
**Ini perbedaan paling fundamental.** Mereka punya DSL interpreter yang deterministic — kita punya LLM-driven execution yang flexible tapi rentan hallucination. Untuk tool calling, DSL approach lebih predictable.
