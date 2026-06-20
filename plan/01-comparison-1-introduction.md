# Comparison 01: Introduction — Visi Sistem

## Source
`MARKDOWN_PLAN/1- introduction.md` — Visi keseluruhan autonomous skill-building agent

## Inti Konsep
- Agent berbasis **skill** yang reusable
- Pipeline: detect capability → execute skill → jika tidak ada → generate → test → evaluate → store
- Output **strict JSON**, no text outside JSON
- Self-improvement loop dengan scoring (correctness 0.4, schema 0.2, reusability 0.2, efficiency 0.2)
- Skill JSON schema: `{ name, capability, description, input_schema, output_schema, logic, uses_mcp, mcp_tools }`

## Yang Kita Punya
- **Agent Loop** (`src/core/agent-loop.ts`): plan → execute → verify → retry. Mirip pipeline mereka.
- **Skill Store** (`src/memory/skill-store.ts`): skill dengan format `agentic-skill/v1`, trigger by pattern/keywords, quality tracking.
- **Verifier** (`src/core/verifier.ts`): multi-dimensi (compile, test, security, perf, arch, deps).
- **Planner** (`src/core/planner.ts`): auto-decompose task templates.
- **Skill Training** (`src/memory/skill-training.ts`): convert skill → training data.

## Gap / Yang Kita Belum Punya
1. **❌ Skill JSON Schema** — Skill kita berupa deskripsi procedural (steps dengan action/description), BUKAN executable logic. Tidak ada `input_schema`, `output_schema`, atau `logic` yang bisa dieksekusi.
2. **❌ Skill Executor** — Kita tidak punya runtime yang bisa menjalankan skill secara deterministic. Skill hanya panduan teks untuk LLM.
3. **❌ Self-Improvement Loop** — Kita tidak punya loop: generate → test → evaluate → improve → store. Skill kita diekstrak dari percakapan, bukan dari test.
4. **❌ Capability-based Lookup** — Kita pakai keyword matching, bukan capability string exact match.
5. **❌ Test Harness Built-in** — Kita tidak auto-generate test cases untuk skill.

## Kesimpulan
**Kita punya infrastruktur agent loop yang lebih mature, tapi approach-nya fundamentally berbeda.** Mereka bikin executable deterministic skill; kita bikin descriptive skill yang diproses LLM ulang. Untuk tool calling effectiveness, approach mereka lebih unggul karena execution deterministic.
