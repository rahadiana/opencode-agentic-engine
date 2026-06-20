# Comparison 02: Start Planning — System Prompt & Flow

## Source
`MARKDOWN_PLAN/2 - start planning.md` — System prompt + pipeline concrete

## Inti Konsep
- System prompt ketat: "ALWAYS create reusable skills, NEVER produce direct answers"
- Capability matcher deterministic (lowercase trim exact match)
- Executor menggunakan `vm.createContext` + sandbox
- Validator menggunakan Ajv (JSON schema)
- Test builder auto-generate test cases
- Evaluator scoring: correctness 0.7 + latency 0.2 + simplicity 0.1
- Backend flow: extract capability → find skill → execute atau generate → test → loop 3x → store

## Yang Kita Punya
- **System Prompt Builder** (`src/core/prompt-builder.ts`): dynamic prompt dengan knowledge-first, identity sebagai reasoning engine.
- **Hallucination Guard** (`src/drift/hallucination-guard.ts`): verifikasi klaim file/fungsi/import.
- **Executor** (`src/core/executor.ts`): step execution dengan state tracking.
- **Model Registry** (`src/core/model-registry.ts`): per-role LLM model preferences.

## Gap
1. **❌ Sandbox Execution** — Kita tidak punya sandbox. Semua tool call via OpenCode API yang trusted, tapi kita tidak bisa run user-generated code dengan aman.
2. **❌ Schema Validator Runtime** — Kita tidak punya JSON schema validation di skill execution.
3. **❌ Auto Test Generator** — Kita tidak generate test cases otomatis dari skill definition.
4. **❌ Capability Matcher Deterministic** — Kita pakai TF-IDF + keyword fuzzy, bukan exact match.
5. **❌ Scoring Function** — Kita tidak punya scoring function untuk evaluate hasil eksekusi skill.

## Kesimpulan
Kita lebih fokus ke **prompt engineering** untuk tool calling; mereka fokus ke **deterministic execution pipeline**. Approach mereka lebih reliable untuk production.
