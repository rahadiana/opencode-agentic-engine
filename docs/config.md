# Configuration

## File Location

```
.project/.agentic/config.json        → Plugin configuration (per project)
.project/.agentic/models.json        → Model preferences per role/tool/category
~/.config/opencode/models-stats.json → Global model statistics
```

## Config Schema

File: `.agentic/config.json`

```json
{
  "$schema": "v1",
  "embedding": {
    "model": "text-embedding-3-small",
    "endpoint": "https://api.openai.com/v1/embeddings",
    "apiKey": null
  },
  "memory": {
    "enabled": true,
    "mode": "lightweight",
    "maxEntries": 1000,
    "forgetAfterDays": 30,
    "search": {
      "keywordWeight": 0.3,
      "vectorWeight": 0.7
    },
    "compressThreshold": 500,
    "stopWordsLanguages": ["ind", "eng"]
  },
  "agent": {
    "maxDelegationDepth": 3,
    "defaultRole": "developer",
    "requireSemanticCheck": false,
    "blockOnHallucination": false,
    "minSampleSize": 5,
    "autoSkillExtract": true,
    "autoHallucinationCheck": true,
    "hallucinationThreshold": 0.3,
    "hardBlockReliability": 0.2,
    "softBlockReliability": 0.4,
    "deepVerification": {
      "security": true,
      "perf": true,
      "arch": true,
      "deps": true
    }
  },
  "storage": {
    "traceRetentionDays": 7,
    "skillMaxCount": 200
  }
}
```

### Field Reference

| Key | Type | Default | Deskripsi |
|-----|------|---------|-----------|
| `$schema` | string | "v1" | Schema version |
| `embedding.model` | string | null | Embedding model name |
| `embedding.endpoint` | string | null | Embedding API endpoint |
| `embedding.apiKey` | string | null | Embedding API key |
| `memory.enabled` | boolean | true | Enable cross-session memory |
| `memory.mode` | enum | "lightweight" | "lightweight" / "full" |
| `memory.maxEntries` | number | 1000 | Max memory entries |
| `memory.forgetAfterDays` | number | 30 | Auto-forget setelah N hari |
| `memory.search.keywordWeight` | number | 0.3 | Bobot keyword TF-IDF |
| `memory.search.vectorWeight` | number | 0.7 | Bobot vector similarity |
| `memory.compressThreshold` | number | 500 | Auto-compress threshold (tokens) |
| `memory.stopWordsLanguages` | string[] | ["ind","eng"] | Stop words languages |
| `agent.maxDelegationDepth` | number | 3 | Max delegation chain depth |
| `agent.defaultRole` | string | "developer" | Default agent role |
| `agent.requireSemanticCheck` | boolean | false | Wajib semantic check |
| `agent.blockOnHallucination` | boolean | false | Block jika hallucination |
| `agent.autoSkillExtract` | boolean | true | Auto-extract skill dari task sukses |
| `agent.autoHallucinationCheck` | boolean | true | Auto-cek hallucination |
| `agent.hallucinationThreshold` | number | 0.3 | Threshold hallucination score |
| `agent.hardBlockReliability` | number | 0.2 | Reliability threshold hard block |
| `agent.softBlockReliability` | number | 0.4 | Reliability threshold soft block |
| `agent.deepVerification.*` | boolean | true | Per-dimension toggle |
| `storage.traceRetentionDays` | number | 7 | Retensi trace file |
| `storage.skillMaxCount` | number | 200 | Max skills |

## Model Preferences

File: `.agentic/models.json`

```json
{
  "developer": "deepseek/deepseek-chat",
  "tools": {
    "agentic_plan": "gpt-4o",
    "agentic_verify": "claude-sonnet-4-6"
  },
  "categories": {
    "quick": "9router/FlashCombo",
    "deep": "9router/StrongReason"
  }
}
```

Set via tool:

```
agentic_model set role=developer model="deepseek/deepseek-chat"
agentic_model set tool=agentic_plan model="gpt-4o"
agentic_model set category=deep model="9router/StrongReason"
agentic_model list
```

### Model Statistics (Global)

File: `~/.config/opencode/models-stats.json`

Tracked per model: reliability, hallucination rate, latency, calls, consecutive failures.

Auto-quarantine jika:
- Consecutive failures >= 5
- Hallucination rate > 50%
