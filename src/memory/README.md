# memory/ — Memory Layer

## Subsistem

| Subsystem | File | Fungsi |
|-----------|------|--------|
| **Episodic** | `episodic-store.ts` | Cross-session memory: task episodes, TF-IDF search, project-scoped isolation, schema versioning, decay/forgetting |
| **Skill** | `skill-store.ts`, `skill-format.ts`, `skill-extractor.ts`, `skill-training.ts` | Reusable skills (agentic-skill/v1 schema), sliding window success rate, TF-IDF search, training data pipeline |
| **RAG** | `multi-index-rag.ts` | Category-segregated hybrid search (TF-IDF + vector), confidence scoring |
| **Vector** | `vector-store.ts`, `local-embedder.ts`, `stopwords.ts` | Vector similarity search, API-based embedding, Indonesian stop words |
| **Session** | `session-store.ts` | Conversation turns + plan + progress |
| **Persistence** | `persistence.ts`, `sqlite-persistence.ts`, `schema-version.ts` | File-based JSON + SQLite persistence, schema migration |
| **Query/Orch** | `memory-query-engine.ts`, `memory-orchestrator.ts`, `consolidation-scheduler.ts`, `importance-index.ts`, `execution-tracer.ts` | Multi-level query, memory orchestration, consolidation, importance scoring, execution tracing |

## Memory Levels

| Level | Retention | Contoh |
|-------|-----------|--------|
| Working | In-session | Current plan, active context |
| Episodic | Cross-session | Task outcomes, errors |
| Semantic | Permanent | Patterns, rules |
| Procedural | Permanent | Skills, workflows |
