# Memory & Skills

## Memory Architecture

4-level memory system:

```
Level 1: Working Memory (In-session)
  → SessionStore: turns, plan, progress
  → Second Brain: keputusan, TODOs, reflection

Level 2: Episodic Memory (Cross-session)
  → EpisodicStore: task outcomes, success/failure
  → TF-IDF search + recency bonus

Level 3: Semantic Memory (Patterns)
  → MultiIndexRAG: categorized knowledge
  → Hybrid TF-IDF + vector search
  → Self-Improving RAG pipeline (critical path):
      Adaptive → KbPO → MMKP → inject
      execute feedback → quality/staleness update

Level 4: Procedural Memory (Skills)
  → SkillStore: reusable task patterns
  → agentic-skill/v1 format
```

## Self-Improving RAG (default critical path)

Modul paper (SCIM, KbPO, Closed-Loop RAG, MMKP, …) digabung di `RAGSelfImprovePipeline`
(`src/memory/rag-self-improve.ts`) dan di-wire ke:

| Titik | Peran |
|-------|--------|
| `MemoryOrchestrator.queryWithKnowledge` | Default search path |
| `system.transform` | Inject knowledge + track `rag:lastUsedTitles` |
| `agentic_execute` / AgentLoop | Closed-loop `feedStepResult` → quality update |

```
Query → Adaptive (auto-escalate) → KbPO calibrate → MMKP budget select
     → knowledge-context in prompt
Step outcome → FeedbackLoop → entry quality ↑/↓ + staleness
```

- **Default:** mode `standard` (cepat, selalu on)
- **Deep / MDP multi-turn:** opt-in (`mode: "deep"`), bukan default chat
- **Manual store/search:** tetap lewat `agentic_rag`

## Second Brain (`agentic_memo`)

Active memory: keputusan, TODOs, reflection, knowledge graph.

```
# Simpan keputusan arsitektur (ADR)
agentic_memo action="decision" title="Pake JWT instead of session"
  context="Better for microservices, stateless"

# Todo tracking
agentic_memo action="todo" text="Refactor auth middleware"
agentic_memo action="todo-done" text="Refactor auth middleware"

# Reflection
agentic_memo action="reflect"
  → Analisis: apa yang berhasil, apa yang gagal

# Knowledge graph
agentic_memo action="graph"
  → Lihat relasi antar komponen
```

## Cross-Session Memory (`agentic_episodes`)

Cari task serupa dari session sebelumnya:

```
agentic_episodes search query="websocket memory leak"
  → Return task serupa: goal, success rate, file yang diubah

agentic_episodes recent
  → 10 task terakhir

agentic_episodes stats
  → Statistik memory: total entries, by category
```

Scoring: TF-IDF similarity × recency (7d half-life) × success bonus.

## Skills (`agentic_skill`)

Reusable patterns dari task sukses. Format `agentic-skill/v1`:

```yaml
# Contoh skill
agentic-skill/v1:
  meta:
    name: "refactor-callback-to-async"
    description: "Refactor callback pattern ke async/await"
  trigger:
    pattern: "refactor.*callback.*async"
  steps:
    - "Ganti function callback ke async function"
    - "Ganti .then().catch() ke try/catch"
    - "Update test"
```

## Fine-Tuning (`agentic_finetune`)

Convert skills → training data → upload OpenAI → monitor job:

```
# Full pipeline
agentic_finetune action="full-pipeline" model="gpt-4o-mini-2024-07-18"
  source="combined" minQuality=0.5

# Step by step
agentic_finetune action="prepare" source="skills" format="openai"
agentic_finetune action="save" outputPath="./training-data.jsonl"
agentic_finetune action="upload" model="gpt-4o-mini-2024-07-18"
agentic_finetune action="create-job" suffix="agentic-swe-v1"
agentic_finetune action="status" jobId="ftjob-xxx"
```

## RAG Knowledge (`agentic_rag`)

Multi-index RAG dengan category segregation:

```
# Search
agentic_rag search query="cara setup websocket di nodejs"

# Store knowledge
agentic_rag store category="typescript" title="WebSocket pattern"
  content="Gunakan ws library, handle connection lifecycle..."

# Stats
agentic_rag stats
```

Confidence scoring:
| Score | Label | Action |
|-------|-------|--------|
| ≥0.8 | HIGH | Trust as-is |
| ≥0.6 | MEDIUM | Verify before use |
| ≥0.3 | LOW | External verification needed |
| <0.3 | UNKNOWN | Treat as not found |
