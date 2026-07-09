# memory/ — Memory Layer

## Subsistem

| Subsystem | File | Fungsi |
|-----------|------|--------|
| **Episodic** | `episodic-store.ts` | Cross-session memory: task episodes, TF-IDF search, significance tiers, project isolation |
| **Skill** | `skill-store.ts`, `skill-format.ts`, `skill-extractor.ts`, `skill-training.ts`, `skill-md-importer.ts`, `skill-security.ts` | Skills v1, training export, external SKILL.md import + 4-layer security |
| **RAG base** | `multi-index-rag.ts` | Category-segregated hybrid TF-IDF + vector, quality-weighted confidence |
| **Self-Improve RAG** | `rag-self-improve.ts` + 6 modul paper | **Critical path** — lihat section di bawah |
| **Vector** | `vector-store.ts`, `local-embedder.ts`, `stopwords.ts` | Vector search, embedder, stop words (58 languages via stopwords-iso) |
| **Session** | `session-store.ts` | Turns, plan, artifacts (`rag:lastUsedTitles`, `workflow:researched`, …) |
| **Second Brain** | `second-brain.ts` | Decisions (ADR), TODOs, reflection, knowledge graph (event-driven) |
| **Persistence** | `persistence.ts`, `sqlite-persistence.ts`, `schema-version.ts` | JSON + optional SQLite |
| **Query/Orch** | `memory-orchestrator.ts`, `memory-query-engine.ts`, `consolidation-scheduler.ts`, `importance-index.ts`, `execution-tracer.ts` | Multi-level query; **queryWithKnowledge → pipeline** |

## Self-Improving RAG System (CRITICAL PATH)

Berdasarkan 22 paper (ACL 2025–2026, CVPR 2026, MDPI 2026).  
**Runtime default** lewat facade — bukan library lepas.

| Modul | File | Paper | Fungsi |
|-------|------|-------|--------|
| **Pipeline (facade)** | `rag-self-improve.ts` | composition | Adaptive → KbPO → MMKP + feedback. Entry point tunggal |
| **Quality Scorer** | `rag-quality-scorer.ts` | SCIM | 5-dimensi quality + staleness + recommendation |
| **Feedback Loop** | `rag-feedback-loop.ts` | Closed-Loop RAG, PatchRAG | Step outcome → `updateEntry` write-back + quality |
| **Adaptive Retrieval** | `rag-adaptive-retrieval.ts` | SCIM, SeaKR | standard → augment → refine → decompose |
| **MDP Retrieval** | `rag-mdp-retrieval.ts` | EvoGraph-R1, SPARKLE | Deep mode: explicit `mode:"deep"` **or** auto-escalate |
| **Knowledge Boundary** | `rag-knowledge-boundary.ts` | KbPO | 4-quadrant trust (internal vs external) |
| **Context Optimizer** | `rag-context-optimizer.ts` | Self-Correcting RAG | MMKP token-budget selection |

### Wire points (composition root = `index.ts`)

```
MultiIndexRAG
  → memoryOrchestrator.setRagStore + setRAGSelfImprove(pipeline)
  → agentLoop.setRAGFeedbackCallback(pipeline.feedStepResult)

queryWithKnowledge()
  → pipeline.search({ mode: "standard" })  // default

system.transform
  → queryWithKnowledge → inject knowledge
  → artifacts: rag:lastUsedTitles, workflow:researched

agentic_execute
  → pipeline.feedStepResult(usedTitles from artifacts)
```

### Alur default

```
User Query
  → MemoryOrchestrator.queryWithKnowledge()
      → RAGSelfImprovePipeline.search()
          → Adaptive (auto-escalate)
          → KbPO calibrate
          → MMKP optimize
  → prompt <knowledge-context>
  → execute step
  → feedStepResult → quality/staleness update
```

### Konsep kunci

- Quality-weighted: `hybrid*0.6 + quality*0.3 + (1-staleness)*0.1`
- KbPO: Q1 Integrate · Q2 Trust-RAG · Q3 Trust-Self · Q4 Refuse/research
- MDP deep: `mode: "deep"` **atau** auto-escalate (`memory.ragDeepEscalate`, threshold default 0.35)
- Write-back: `MultiIndexRAG.updateEntry({ id \| title }, patch)` + `getEntrySnapshot()`
- Singleton: `getRAGSelfImprovePipeline()` / `setRAGSelfImprovePipeline()`

## Memory Levels

| Level | Retention | Contoh |
|-------|-----------|--------|
| Working | In-session | Plan, artifacts, turns |
| Episodic | Cross-session | Task outcomes, errors |
| Semantic | Long-lived | RAG knowledge, patterns |
| Procedural | Long-lived | Skills, workflows |
