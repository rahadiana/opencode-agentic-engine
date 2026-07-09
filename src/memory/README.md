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

## Self-Improving RAG System (NEW)

Berdasarkan 22 paper dari ACL 2025–2026, CVPR 2026, dan arXiv 2024–2026.
Implementasi closed-loop knowledge quality improvement.

| Modul | File | Paper Reference | Fungsi |
|-------|------|----------------|--------|
| **Quality Scorer** | `rag-quality-scorer.ts` | SCIM (MDPI, 2026) | 5-dimensi quality (relevance, completeness, consistency, factuality, fluency) + staleness decay + recommendation engine |
| **Feedback Loop** | `rag-feedback-loop.ts` | Closed-Loop RAG (ITM Web, 2026), PatchRAG (ACL Findings, 2026) | Step execution result → RAG quality update. Feed success/failure back ke entry scores |
| **Adaptive Retrieval** | `rag-adaptive-retrieval.ts` | SCIM (2026), SeaKR (ACL, 2025) | 4-mode search: standard → augment (completeness) → refine (consistency) → decompose. Auto-escalate berdasarkan deficits |
| **MDP Retrieval** | `rag-mdp-retrieval.ts` | EvoGraph-R1 (CVPR, 2026), SPARKLE (ACL, 2026), RouteRAG (2026) | Markov Decision Process: RETRIEVE, WEBSEARCH, GRAPHEDIT, DECOMPOSE, ANSWER action space |
| **Knowledge Boundary** | `rag-knowledge-boundary.ts` | KbPO (ACL, 2026) | 4-quadrant taxonomy: internal vs external confidence. Integrate / Trust-RAG / Trust-Self / Refuse |
| **Context Optimizer** | `rag-context-optimizer.ts` | Self-Correcting RAG (ACL Findings, 2026) | MMKP-inspired token-budget-aware selection. Memaksimalkan information density di bawah budget |

### Alur Self-Improving RAG

```
User Query → KnowledgeBoundary (KbPO) → MDP Retrieval (EvoGraph-R1)
  → Context Optimizer (MMKP) → Agent Execution
  → Feedback Loop (Closed-Loop RAG) → Quality update → Staleness check
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
