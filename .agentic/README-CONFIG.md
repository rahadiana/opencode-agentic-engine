# Konfigurasi Plugin — opencode-agentic-engine

Semua file konfigurasi, state, dan data runtime disimpan di folder `.agentic/`.

```
.agentic/
│
├── config.json              ← [EDIT] Konfigurasi utama plugin
├── models.json              ← [EDIT] Model preferences per role/tool/category
├── knowledge.json           ← [AUTO] RAG knowledge base (cross-session)
├── trace.jsonl              ← [AUTO] Execution trace log (JSONL)
│
└── store/                   ← [AUTO] Internal plugin storage
    ├── models/
    │   └── registry.json    ← Statistik reliability per model
    │
    ├── episodes/
    │   └── ses_*.json       ← Cross-session memory
    │
    ├── evolution/
    │   └── trend.json       ← Self-evolution trends
    │
    ├── evaluation/
    │   └── live.json        ← Live evaluation data
    │
    ├── decisions/
    │   └── global.json      ← ADR (Architecture Decision Records)
    │
    └── prompts/
        └── state.json       ← Prompt evolution state
```

---

## 1. `.agentic/config.json` — Main Config

**Dibuat:** Auto-create saat plugin pertama kali di-load
**Dibaca:** Setiap tool call (via `getConfig()`)
**Diedit:** Manual atau via `agentic_budget`

```jsonc
{
  "$schema": "v1",
  "embedding": null,             // null (TF-IDF) | "model-name" (string) | { model, endpoint, apiKey }
  "memory": {
    "enabled": true,             // Aktifkan cross-session memory
    "mode": "balanced",          // "lightweight" | "balanced" | "full" (full = pakai embedding)
    "maxEntries": 1000,          // Max memory entries
    "compressThreshold": 500,    // Threshold kompresi context
    "forgetAfterDays": 30,       // Hapus memory setelah N hari
    "stopWordsLanguages": ["ind", "eng"],
    "search": {
      "keywordWeight": 0.3,      // Bobot keyword search
      "vectorWeight": 0.7        // Bobot vector search
    },
    "ragDeepEscalate": true,     // Auto-escalate ke deep RAG kalau confidence rendah
    "ragDeepEscalateThreshold": 0.35
  },
  "agent": {
    "maxDelegationDepth": 3,
    "autoSkillExtract": true,
    "defaultRole": "developer",
    "requireSemanticCheck": true,  // Wajib semantic verification
    "autoHallucinationCheck": true,
    "blockOnHallucination": false,
    "hallucinationThreshold": 0.3,
    "hardBlockReliability": 0.2,
    "softBlockReliability": 0.4,
    "minSampleSize": 5,
    "workflowPolicyMode": "advisory", // "advisory" | "strict" | "enforced"
    "dumbModelMode": "auto",
    "deepVerification": {
      "security": true,
      "performance": true,
      "architecture": true,
      "deps": true
    },
    "toolGuardrails": {
      "enabled": true,
      "exactRepeatWarn": 2,
      "exactRepeatBlock": 5,
      "sameStepFailWarn": 3,
      "sameStepFailBlock": 8,
      "idempotentNoProgressBlock": 3,
      "hardStop": false
    }
  },
  "rag": {
    "remoteUrl": null,           // URL untuk remote RAG sync (null = disabled)
    "remoteApiKey": null,
    "remoteBatchIntervalMs": 5000,
    "remoteSyncMode": "full"
  },
  "storage": {
    "traceRetentionDays": 7,
    "skillMaxCount": 200
  },
  "fineTuning": null,            // Konfigurasi fine-tuning (null = disabled)
  "curator": {
    "enabled": true,
    "staleAfterDays": 30,
    "archiveAfterDays": 90,
    "maxSkillsInPrompt": 3,
    "injectThreshold": 0.15,
    "consolidationEnabled": false
  }
}
```

---

## 2. `.agentic/models.json` — Model Preferences

**Dibuat:** Auto-create saat plugin pertama di-load
**Diedit:** Via `agentic_model set` command

```jsonc
{
  "$schema": "v1",
  "tools": {
    "agentic_nav": "",         // Isi "provider/model" untuk override
    "agentic_plan": "",
    "agentic_verify": "",
    // ... semua 31 agentic tools
  },
  "categories": {
    "quick": "9router/FlashCombo",       // Complexity category
    "unspecified-low": "",
    "unspecified-high": "9router/StrongReason",
    "deep": "9router/StrongReason"
  }
  // Opsional: "developer": "deepseek/deepseek-chat" (per-role)
}
```

**Priority 3-level:**
1. Per-tool override (tools.agentic_plan)
2. Category fallback (categories.deep)
3. Engine default (session model)

---

## 3. `.agentic/knowledge.json` — RAG Knowledge Base

**Dibuat:** Auto via cross-session knowledge artifact
**Dibaca:** Setiap system.transform hook (sebelum LLM call)
**Format:**
```jsonc
{
  "schema_version": 1,
  "last_updated": "2026-06-19T19:45:00Z",
  "sessions": [
    {
      "session_id": "ses_xxx",
      "date": "2026-06-19",
      "total_commits": 15,
      "commit_range": "abc123 → def456",
      "summary": "Apa yang dikerjakan",
      "achievements": [...],
      "decisions": [...],
      "config_patterns": [...]
    }
  ]
}
```

---

## 4. `.agentic/trace.jsonl` — Execution Trace

**Dibuat:** Auto setiap tool call
**Format:** JSONL (1 JSON object per line)
```jsonl
{"step":"tool","input":"{...}","output":"...","toolUsed":"agentic_nav","success":true,"durationMs":1234,"level":"info","timestamp":"2026-06-22T11:48:42.802Z"}
```

**Retensi:** 7 hari (configurable via storage.traceRetentionDays)

---

## 5. `.agentic/store/` — Internal State

| Path | Isi | Diedit via |
|------|-----|------------|
| `store/models/registry.json` | Reliability/hallucination/latency per model | `agentic_model action="reset"` |
| `store/episodes/@<project>/ses_*.json` | Cross-session memory | `agentic_episodes search` |
| `store/evolution/@<project>/trend.json` | Self-evolution metrics | `agentic_evolve` |
| `store/evaluation/@<project>/live.json` | 5-dimensi live scoring | Agent loop |
| `store/prompts/state.json` | Prompt version history | `agentic_evolve edit-prompt` |

---

## Catatan

- **[EDIT]** = bisa diedit manual
- **[AUTO]** = generated otomatis oleh plugin
- Semua file di `store/` adalah internal — jangan diedit manual
- `trace.jsonl` bisa besar — dirotasi otomatis setiap 7 hari
