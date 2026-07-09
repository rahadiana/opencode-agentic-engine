# memory/ — Memory Layer

## Subsistem

| Subsystem | File | Fungsi |
|-----------|------|--------|
| **Episodic** | `episodic-store.ts` | Cross-session memory: task episodes, TF-IDF search, project-scoped isolation, schema versioning, decay/forgetting |
| **Skill** | `skill-store.ts`, `skill-format.ts`, `skill-extractor.ts`, `skill-training.ts` | Reusable skills (agentic-skill/v1 schema), sliding window success rate, TF-IDF search, training data pipeline |
| **RAG** | `multi-index-rag.ts` | Category-segregated hybrid search (TF-IDF + vector), confidence scoring, **quality-weighted scoring** (SCIM), **episode metadata update API** |
| **Vector** | `vector-store.ts`, `local-embedder.ts`, `stopwords.ts` | Vector similarity search, API-based embedding, Indonesian stop words |
| **Session** | `session-store.ts` | Conversation turns + plan + progress |
| **Persistence** | `persistence.ts`, `sqlite-persistence.ts`, `schema-version.ts` | File-based JSON + SQLite persistence, schema migration |
| **Query/Orch** | `memory-query-engine.ts`, `memory-orchestrator.ts`, `consolidation-scheduler.ts`, `importance-index.ts`, `execution-tracer.ts` | Multi-level query, memory orchestration, consolidation, importance scoring, execution tracing |

## Self-Improving RAG System (CRITICAL PATH)

Berdasarkan 22 paper dari ACL 2025–2026, CVPR 2026, dan arXiv 2024–2026.
**Sudah di-wire ke runtime default** lewat `RAGSelfImprovePipeline` (bukan library lepas).

| Modul | File | Paper Reference | Fungsi |
|-------|------|----------------|--------|
| **Pipeline (facade)** | `rag-self-improve.ts` | All 22 papers (composition) | **Critical path** — Adaptive → KbPO → MMKP + feedback. Dipakai `MemoryOrchestrator.queryWithKnowledge`, `system.transform`, `agentic_execute`, `AgentLoop` |
| **Quality Scorer** | `rag-quality-scorer.ts` | SCIM (MDPI, 2026) | 5-dimensi quality + staleness decay + recommendation |
| **Feedback Loop** | `rag-feedback-loop.ts` | Closed-Loop RAG, PatchRAG | Step outcome → quality update |
| **Adaptive Retrieval** | `rag-adaptive-retrieval.ts` | SCIM, SeaKR | standard → augment → refine → decompose |
| **MDP Retrieval** | `rag-mdp-retrieval.ts` | EvoGraph-R1, SPARKLE | Deep mode multi-turn (opt-in `mode: "deep"`) |
| **Knowledge Boundary** | `rag-knowledge-boundary.ts` | KbPO | 4-quadrant trust calibration |
| **Context Optimizer** | `rag-context-optimizer.ts` | Self-Correcting RAG | MMKP token-budget selection |

### Alur Self-Improving RAG (runtime default)

```
User Query
  → MemoryOrchestrator.queryWithKnowledge()
      → RAGSelfImprovePipeline.search()
          → Adaptive Retrieval (auto-escalate)
          → KbPO Boundary calibrate
          → MMKP Context Optimizer
  → system.transform injects knowledge + tracks usedTitles
  → Agent Execution (manual tools OR agentic_auto)
  → agentic_execute / AgentLoop
      → RAGSelfImprovePipeline.feedStepResult()
          → quality/staleness update (Closed-Loop)
```

### Konsep Kunci

- **Quality-weighted search**: `finalScore = hybridScore * 0.6 + qualityScore * 0.3 + (1 - staleness) * 0.1`
- **5 quality dimensions**: relevance (0.25), factuality (0.25), completeness (0.20), consistency (0.20), fluency (0.10)
- **4 KbPO quadrants**: Q1=Integrate, Q2=Trust-RAG, Q3=Trust-Self, Q4=Refuse
- **MDP actions**: RETRIEVE (internal), WEBSEARCH (eksternal), GRAPHEDIT (update), DECOMPOSE (split), ANSWER (terminate)
- **Staleness**: age-based + verification-based + usage-based decay

## Memory Levels

| Level | Retention | Contoh |
|-------|-----------|--------|
| Working | In-session | Current plan, active context |
| Episodic | Cross-session | Task outcomes, errors |
| Semantic | Permanent | Patterns, rules |
| Procedural | Permanent | Skills, workflows |
