# Comparison 24: System Generate Code Real (bukan DSL) + Sandbox VM

## Source
`MARKDOWN_PLAN/24 - system generate code real (bukan DSL) + sandbox VM.md` — Real code generation

## Inti Konsep
- **LLM generate real JavaScript module** (bukan DSL instructions)
- **Strict format**: `{ name, language, entry, code, input_schema, output_schema }`
- **Static validation**: cek banned tokens (`require(`, `process.`, `fs.`, `eval(`, `Function(`)
- **Sandbox VM**: `vm.createContext` + `vm.Script` + timeout 100ms
- **Pure function**: satu entrypoint `handler(input)`, no global/network/fs access
- **Test runner**: test dengan test cases, hitung pass rate
- **Acceptance**: `score > currentScore + 0.05`
- **Fallback**: jika code execution gagal → fallback ke DSL
- **Registry**: CodeModule model — disimpan di DB seperti skill

## Yang Kita Punya
- **Verifier** (`src/core/verifier.ts`): compile + test multi-dimensi.
- **Formal Model** (`src/core/formal-model.ts`): formal verification.
- **Domain Registry** (`src/core/domain-registry.ts`): domain-specific code generation.
- **Hallucination Guard** (`src/drift/hallucination-guard.ts`): verifikasi klaim kode.

## Gap
1. **❌ Code Generation Pipeline** — Domain registry kita generate code patterns, tapi bukan full module generation dengan sandbox test.
2. **❌ Sandbox VM** — Kita tidak punya sandbox untuk eksekusi kode yang aman.
3. **❌ Static Code Validation** — Tidak ada banned tokens checker.
4. **❌ Fallback Chain** — Tidak ada mekanisme "coba real code dulu → fallback ke DSL".
5. **❌ Code Module Registry** — Tidak ada CodeModel di DB.
6. **❌ A/B Test Code vs DSL** — Tidak ada comparison scoring.

## Kesimpulan
**Ini adalah "ultimate level" — agent bisa nulis kode nyata dan execute di sandbox.** Kita punya domain registry untuk generate kode spesifik domain, tapi bukan full sandboxed code generation. Ini relevan untuk tool calling karena kita bisa generate tools baru on-the-fly.
