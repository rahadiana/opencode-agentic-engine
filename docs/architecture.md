# Architecture

## Directory Structure

```
src/
├── index.ts              # Plugin entry: 34 tools + 5 hooks
├── README.md             # Dokumentasi fungsi per folder (AI context)
│
├── core/                 # Inti engine: planning, execution, verification
│   ├── agent-loop.ts     # Autonomous loop: plan → execute → verify → retry
│   ├── planner.ts        # Auto-decompose goal ke subtasks
│   ├── executor.ts       # Step execution state, retry tracking
│   ├── verifier.ts       # Multi-dimensi verification (3-tier)
│   ├── llm.ts            # LLM integration via OpenCode SDK
│   ├── prompt-builder.ts # Dynamic system prompt construction
│   ├── prompt-template.ts # XML-based prompt templates
│   ├── debate-loop.ts    # Executor ↔ Critic multi-round debate
│   ├── semantic-cache.ts # Gap #7: TF-IDF + cosine similarity cache
│   ├── error-recovery.ts # Gap #5: Error recovery strategies
│   ├── alignment-gate.ts # Gap #10: Goal drift detection
│   ├── economic-model.ts # Gap #11: ROI tracking
│   ├── event-bus.ts      # Pub/sub event bus
│   ├── navigator.ts      # Codebase file scanning
│   ├── dag-engine.ts     # DAG-based execution engine
│   ├── budget-tracker.ts # Token/steps/time/cost budget
│   └── domains/          # Domain-specific generators
│
├── agents/               # Multi-agent coordination
│   ├── coordinator.ts    # Delegasi ke agent roles
│   ├── orchestrator.ts   # Multi-agent workflow pipelines
│   ├── agent-runtime.ts  # Agent sub-process spawner
│   ├── a2a-client.ts     # A2A protocol client
│   ├── a2a-server.ts     # A2A protocol server
│   └── role-registry.ts  # Agent role definitions
│
├── memory/               # Cross-session & in-session memory
│   ├── session-store.ts  # Conversation turns + plan
│   ├── episodic-store.ts # Cross-session memory
│   ├── skill-store.ts    # Skill extraction & search
│   ├── second-brain.ts   # Active memory: decisions, TODOs
│   ├── multi-index-rag.ts # TF-IDF + vector RAG
│   ├── vector-store.ts   # Vector similarity search
│   ├── memory-orchestrator.ts # Multi-level coordination
│   └── stopwords.ts      # Shared tokenize/TF-IDF utilities
│
├── drift/                # Error detection & recovery
│   ├── hallucination-guard.ts  # File/func/import claim verification
│   ├── context-compressor.ts   # Sliding window compression
│   ├── dependency-tracker.ts   # File change propagation
│   └── pattern-discovery.ts    # Error pattern discovery
│
├── evaluation/
│   └── live-evaluator.ts # 5-dimensi real-time scoring
│
├── evolution/
│   ├── self-evolver.ts   # Agent prompt evolution
│   └── continuous-evolution.ts # Evolution loop
│
└── observability/
    ├── logger.ts         # Structured logger
    ├── dashboard.ts      # Timeline + stats + anomalies
    └── trace-logger.ts   # JSONL trace writer
```

## Key Design Patterns

### 1. Knowledge-First Architecture

```
LLM Call
  → system.transform hook
    → RouterAgent.extractKeywords()
    → MultiIndexRAG.searchWithConfidence()
    → Second Brain injection (decisions, TODOs, reflection)
    → buildAgenticSystemInstructions()
      → <identity> "reasoning engine"
      → <knowledge-context> RAG results
      → <instructions> tools + workflow
      → <guardrails> constraints
    → if no high-confidence knowledge:
      → append "MANDATORY RESEARCH REQUIRED"
```

### 2. Gap-Driven Development

Setiap Gap dari paper "The End of Software Engineering" diimplementasi sebagai modul independen:

| Gap | Modul | Deskripsi |
|-----|-------|-----------|
| #4 | `verifier.ts` | Multi-dimensi verification |
| #5 | `error-recovery.ts` | Self-healing error recovery |
| #7 | `semantic-cache.ts` | Semantic caching LLM responses |
| #8 | `meta-reasoner.ts` | Strategy adaptation |
| #9 | Continuous learning via feedback | |
| #10 | `alignment-gate.ts` | Goal drift detection |
| #11 | `economic-model.ts` | ROI tracking |

### 3. Event-Driven Architecture

```
EventBus (pub/sub)
  ├── plan.created      → Second Brain auto-track
  ├── step.completed    → Auto-verify, alignment check, economic record
  ├── step.failed       → Error recovery, auto-retry
  ├── plan.completed    → Skill extraction, memory consolidation
  ├── tool.called       → Dashboard tracking
  ├── llm.called        → Model reliability tracking
  └── feedback.recorded → Gap #9 adaptation
```

### 4. Model Resolution

```
agentic_model set category=deep model="9router/StrongReason"
    ↓
agentic_verify handler → verifier.verifyAllDeep() → llmEngine.call()
    ↓
call() → toolName = 'agentic_verify'
    → Priority 1: req.model? → undefined
    → Priority 2: per-tool override → undefined
    → Priority 3: category=deep → "9router/StrongReason"
    → OpenCode SDK → panggil 9router/StrongReason
```

## Data Flow — Agentic Loop

```
agentic_auto / agentic_plan
  │
  ▼
Planner.decompose()
  → subtasks dengan dependencies
  ▼
AgentLoop.execute()
  ├── Step 1: agentic_execute
  │   ├── AlignmentGate.check()      ← Gap #10
  │   ├── EconomicModel.record()     ← Gap #11
  │   └── Auto-verify compile
  │
  ├── Step 2: (jika gagal)
  │   ├── agentic_reflect
  │   │   └── ErrorRecovery.getRecoveryPlan()  ← Gap #5
  │   └── Retry
  │
  ├── Step 3: agentic_execute
  └── ...
  │
  ▼
agentic_verify (deep tier)
  ├── Compile check
  ├── Lint check
  ├── Test suite
  ├── Security scan (Gap #4)
  ├── Performance check (Gap #4)
  ├── Architecture check (Gap #4)
  └── Deps audit (Gap #4)
  │
  ▼
Done / Report
```
