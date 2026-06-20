# Comparison 05: Conditional + Branching ke DSL

## Source
`MARKDOWN_PLAN/5 - conditional + branching ke DSL.md` — Control flow dalam DSL

## Inti Konsep
- Ops baru: `compare`, `if`, `jump`
- **Instruction Pointer (IP)** — eksekusi tidak linear for-loop, tapi pakai pointer yang bisa lompat
- `compare`: `{ a, b, operator, to }` dengan operator `==`, `!=`, `>`, `<`, `>=`, `<=`
- `if`: `{ condition, true_jump, false_jump }` — lompat ke index step tertentu
- `jump`: `{ to }` — unconditional jump
- **MAX_STEPS** = 100 guard anti infinite loop
- validateDSL: validasi jump bounds

## Yang Kita Punya
- **Agent Loop** (`src/core/agent-loop.ts`): sequential plan → execute → verify → retry. Ada branching via retry logic.
- **Error Analyzer** (`src/core/error-analyzer.ts`): categorize errors, trace propagation.
- **Debate Loop** (`src/core/debate-loop.ts`): executor ↔ critic AI debate.

## Gap
1. **❌ Instruction Pointer** — Kita tidak punya IP-based execution. Semua linear sequential.
2. **❌ Conditional Ops** — Kita tidak punya `compare`/`if`/`jump` di execution flow. Branching cuma lewat LLM decision.
3. **❌ Jump Mechanism** — Tidak ada konsep lompat antar step.
4. **❌ Step Limit Guard** — Kita punya budget tracker (token/time), tapi bukan step counter.
5. **❌ DSL-level Validation** — validateDSL untuk jump bounds tidak ada.

## Kesimpulan
**Branching di kita = LLM decide; branching di mereka = DSL instruction pointer.** Ini perbedaan besar. IP-based execution lebih predictable dan testable, tapi LLM branching lebih flexible. Untuk production system yang butuh reliability, IP-based lebih unggul.
