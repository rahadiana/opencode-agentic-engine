# Agentic Workflow

Siklus inti: **Research → Plan → Implement → Verify → Retry**

```
User Input (goal/task)
  │
  ▼
┌──────────────────────────┐
│  1. RESEARCH              │
│  ─────────────────────── │
│  • agentic_nav           │
│  • agentic_skill find    │
│  • agentic_episodes      │
│  • webfetch              │
│  • read (file I/O)       │
└──────────┬───────────────┘
           ▼
┌──────────────────────────┐
│  2. PLAN                  │
│  ─────────────────────── │
│  • agentic_plan           │
│    → breakdown goal       │
│    → subtasks + deps      │
└──────────┬───────────────┘
           ▼
┌──────────────────────────┐
│  3. IMPLEMENT             │
│  ─────────────────────── │
│  • agentic_execute        │
│    (auto-verify compile)  │
│  • edit / write           │
│  • agentic_delegate       │
│    (sub-task kompleks)    │
└──────────┬───────────────┘
           ▼
┌──────────────────────────┐
│  4. VERIFY                │
│  ─────────────────────── │
│  • agentic_verify         │
│    (deep tier: compile +   │
│     lint + test + security│
│     + perf + arch + deps) │
│  • agentic_guard          │
│    (hallucination check)  │
└──────────┬───────────────┘
           │
     ┌─────┴─────┐
     ▼           ▼
   PASS        FAIL
     │           │
     ▼           ▼
  Report     agentic_reflect
  (status,     → error analysis
   score,      → propagation trace
   pr)         → retry
```

## Siklus Lengkap (Manual)

```bash
# 1. Research
agentic_nav query="cari file yang pake websocket"

# 2. Plan
agentic_plan goal="Fix memory leak di websocket handler"

# 3. Execute tiap step
agentic_execute stepId="step-1" success=true output="..."
agentic_execute stepId="step-2" success=true output="..."

# 4. Verify final
agentic_verify tier="deep"

# 5. Report
agentic_status
```

## WorkflowPolicy + Dumb-Model Harness

Policy di-enforce di **runtime** (`agentic_execute`, `AgentLoop`), bukan hanya di prompt.

| Mode | Kapan | Perilaku |
|------|-------|----------|
| `advisory` | Default jika model dianggap capable | Warning, jarang hard-block |
| `strict` | `dumbModelMode: true` **atau** auto deteksi model lemah | Bisa **block** step (mis. `research-missing`) |

Default config: `dumbModelMode: "auto"` — model free/mini/flash otomatis strict.

```bash
# Cek apakah harness aktif
agentic_status detail=full
# → 🛡️ Dumb-Model Harness: ACTIVE | off

# Execute tanpa research (dengan free model) → sering diblokir:
agentic_execute stepId="..." success=true filesModified=["src/x.ts"] ...
# → 🛑 BLOCKED by WorkflowPolicy: research-missing
# Perbaiki: agentic_nav atau agentic_fetch dulu
```

Alur aman untuk model lemah:

```
agentic_nav / agentic_fetch  →  agentic_plan  →  implement  →  agentic_execute  →  agentic_verify
```

Lihat: [config.md — Dumb-Model Harness](../config.md#dumb-model-harness-agentdumbmodelmode).

## Auto Mode (Satu Langsung)

```bash
agentic_auto goal="Fix memory leak di websocket handler"
```

Ini otomatis: research → plan → execute tiap step → verify → retry jika gagal → score.

## Knowledge-First Protocol

Setiap LLM call mendapat auto-injection:

```
<identity>
  "You are a reasoning engine, NOT a knowledge base."
  "Assume ALL internal knowledge may be outdated."
</identity>

<knowledge-context>
  ╔══════════════════════════════════════╗
  ║ KNOWLEDGE CONTEXT — Reference Data   ║
  ║ from RAG / Web / arXiv               ║
  ╚══════════════════════════════════════╝
  <source url="..." confidence="0.85">
    (knowledge content)
  </source>
</knowledge-context>

<instructions>
  Research → Plan → Implement → Verify
</instructions>

<guardrails>
  If knowledge context empty/low → webfetch!
</guardrails>
```

Jika RAG tidak menemukan high-confidence knowledge, auto-appended:

```
⚠️ MANDATORY RESEARCH REQUIRED
No high-confidence knowledge was found. Use webfetch to research before implementing.
```

## Error Recovery (Gap #5)

Saat step gagal, `agentic_reflect` otomatis:
1. Kategorikan error (import/type/compile/test/runtime)
2. Lacak propagasi ke step dependen
3. Generate recovery plan dengan action rotation

Recovery actions per category:
| Category | Actions |
|----------|---------|
| import | retry_different → retry_same → rollback_file → escalate |
| type | retry_different → retry_same → rollback_file → escalate |
| compile | retry_different → retry_same → rollback_file → escalate |
| test | retry_same → split_step → rollback_file → escalate |
| runtime | retry_different → rollback_file → rollback_all → escalate |

Circuit breaker: 5 consecutive failures → auto-escalate.

## Alignment Check (Gap #10)

Setiap `agentic_execute` sukses auto-check:
- **Goal drift**: TF-IDF similarity dengan original intent
- **Constraint violation**: keyword preservation score
- **Scope creep**: jumlah file berubah vs threshold

## Economics Tracking (Gap #11)

Setiap execute auto-record:
- Cost per step (berdasarkan model + token usage)
- ROI per task/role
- Role recommendation (keyword-based heuristic)
