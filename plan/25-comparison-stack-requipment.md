# Comparison 25: Stack Requipment — Tech Stack Comparison

## Source
`MARKDOWN_PLAN/stack-requipment.md` — Full tech stack architecture

## Inti Konsep
- **Backend**: Node.js + Fastify/Express
- **DB**: SQLite → PostgreSQL (production)
- **ORM**: Sequelize
- **Validation**: Ajv (JSON schema validator)
- **Vector Storage**: manual (cosine similarity) → Qdrant/Weaviate
- **Sandbox**: Node VM → child_process → container (Docker/Firecracker)
- **Multi-agent**: in-process → Redis Pub/Sub → NATS
- **LLM**: OpenAI API
- **Monitoring**: Prometheus + Grafana (production)
- **Priority**: step-by-step (jangan bangun semua sekaligus)

## Yang Kita Punya
- **Backend**: Plugin OpenCode (TypeScript, ESM)
- **DB**: File-based JSON (persistence.ts), JSONL (trace-logger.ts)
- **Validation**: Built-in validation di tool definitions
- **Vector**: Built-in vector store (src/memory/vector-store.ts)
- **Embedding**: Local embedder (src/memory/local-embedder.ts)
- **LLM**: OpenAI-compatible API (src/core/llm.ts)
- **Config**: Plugin config (src/core/config.ts)
- **Build**: TypeScript + esbuild
- **Testing**: 744 unit tests (mock, no LLM)

## Perbedaan Fundamental Stack

| Layer | Mereka | Kita |
|-------|--------|------|
| **Platform** | Standalone Node.js server (Express/Fastify) | Plugin untuk OpenCode IDE |
| **Database** | SQLite + Sequelize (relational) | JSON files + JSONL (file-based) |
| **Sandbox** | VM/child_process/Docker | Tidak ada sandbox |
| **Validation** | Ajv (JSON schema) | TypeScript types + tool() validation |
| **Vector** | Manual cosine → Qdrant | Built-in vector store + TF-IDF |
| **LLM** | OpenAI API | OpenAI-compatible API |
| **MCP** | Wrapper pattern (Map-based) | MCP Client (stdio/HTTP) |
| **Multi-agent** | In-process agents → Redis/NATS | Sub-process spawn + message bus |
| **State** | Blackboard (in-memory → Redis) | Session store + event bus |
| **Build** | Node.js native | TSC + esbuild |
| **Testing** | Manual test | 744 unit tests (mocked) |

## Kelebihan Kita
1. **Plugin architecture** — terintegrasi langsung dengan OpenCode IDE
2. **29 tools siap pakai** — langsung bisa dipanggil
3. **744 unit tests** — coverage tinggi
4. **Multi-dimensional verification** — security, perf, arch, deps
5. **RAG + Vector** — built-in
6. **Event bus** — tool hooks infrastructure

## Kelebihan Mereka
1. **DSL interpreter** — deterministic execution
2. **Sandbox** — safe code execution
3. **JSON schema validation** — runtime type checking
4. **SQLite/Sequelize** — relational data integrity
5. **Priority-based implementation** — step by step guide
6. **Blackboard architecture** — flexible agent coordination

## Kesimpulan
Dua arsitektur dengan **tradeoff berbeda**: mereka standalone server untuk generic autonomous agent; kita plugin IDE untuk software engineering agent. Stack mereka lebih cocok untuk generic AI agent platform; stack kita lebih cocok untuk coding assistant terintegrasi.
