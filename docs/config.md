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
  "embedding": null,
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
    "stopWordsLanguages": ["ind", "eng"],
    "ragDeepEscalate": true,
    "ragDeepEscalateThreshold": 0.35
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
    "workflowPolicyMode": "advisory",
    "dumbModelMode": "auto",
    "deepVerification": {
      "security": true,
      "performance": true,
      "architecture": true,
      "deps": true
    }
  },
  "storage": {
    "traceRetentionDays": 7,
    "skillMaxCount": 200
  },
  "rag": {
    "remoteUrl": null,
    "remoteApiKey": null,
    "remoteBatchIntervalMs": 5000,
    "remoteSyncMode": "full"
  }
}
```

### Field Reference

| Key | Type | Default | Deskripsi |
|-----|------|---------|-----------|
| `$schema` | string | `"v1"` | Schema version |
| `embedding` | object\|null | `null` | Embedding config (`model`, `endpoint`, `apiKey`). `null` = TF-IDF only |
| `memory.enabled` | boolean | `true` | Enable cross-session memory |
| `memory.mode` | enum | `"lightweight"` | `"lightweight"` / `"full"` (full butuh embedding) |
| `memory.maxEntries` | number | `1000` | Max memory entries |
| `memory.forgetAfterDays` | number | `30` | Auto-forget setelah N hari |
| `memory.search.keywordWeight` | number | `0.3` | Bobot keyword TF-IDF |
| `memory.search.vectorWeight` | number | `0.7` | Bobot vector similarity |
| `memory.compressThreshold` | number | `500` | Auto-compress threshold |
| `memory.stopWordsLanguages` | string[] | `["ind","eng"]` | Stop words languages |
| `memory.ragDeepEscalate` | boolean | `true` | Auto-escalate standard RAG → MDP deep saat confidence rendah |
| `memory.ragDeepEscalateThreshold` | number | `0.35` | Ambang avgScore (0–1); `0` = never auto deep. Explicit `mode:"deep"` tetap bisa |
| `rag.remoteUrl` | string\|null | `null` | URL endpoint untuk remote RAG sync. `null`/undefined = no remote sync |
| `rag.remoteApiKey` | string\|null | `null` | Optional API key (dikirim sebagai `Authorization: Bearer <key>`) |
| `rag.remoteBatchIntervalMs` | number | `5000` | Debounce interval (ms). Data dikumpulkan dulu selama N ms sebelum dikirim. `0` = kirim langsung tiap perubahan |
| `rag.remoteSyncMode` | enum | `"full"` | `"full"` = export semua data RAG, `"changes"` = delta only (future) |
| `agent.maxDelegationDepth` | number | `3` | Max delegation chain depth |
| `agent.defaultRole` | string | `"developer"` | Default agent role |
| `agent.requireSemanticCheck` | boolean | `false` | Wajib semantic check |
| `agent.blockOnHallucination` | boolean | `false` | Block jika hallucination (selalu on saat dumb harness active) |
| `agent.autoSkillExtract` | boolean | `true` | Auto-extract skill dari task sukses |
| `agent.autoHallucinationCheck` | boolean | `true` | Auto-cek hallucination di `agentic_execute` |
| `agent.hallucinationThreshold` | number | `0.3` | Threshold hallucination score (diperketat ke ≤0.2 di dumb mode) |
| `agent.hardBlockReliability` | number | `0.2` | Reliability threshold hard block model |
| `agent.softBlockReliability` | number | `0.4` | Soft threshold + signal untuk auto dumb-mode |
| `agent.minSampleSize` | number | `5` | Min sample stats sebelum reliability decisions |
| `agent.workflowPolicyMode` | `"advisory"\|"strict"` | `"advisory"` | Policy gate: warn vs block. Override ke `strict` saat dumb harness active |
| `agent.dumbModelMode` | `boolean\|"auto"` | `"auto"` | **Dumb-model harness** — lihat section di bawah |
| `agent.deepVerification.*` | boolean | `true` | Toggle security / performance / architecture / deps |
| `storage.traceRetentionDays` | number | `7` | Retensi trace file |
| `storage.skillMaxCount` | number | `200` | Max skills |

---

## Dumb-Model Harness (`agent.dumbModelMode`)

Prinsip: **LLM boleh bodoh, harness harus pintar.**

| Nilai | Efek |
|-------|------|
| `"auto"` (**default**) | Deteksi model lemah → strict harness otomatis |
| `true` | Selalu strict (model apapun) |
| `false` | Jangan force; ikut `workflowPolicyMode` + `blockOnHallucination` |

### Auto detection

ON jika salah satu:

1. **Nama model** mengandung sinyal lemah: `mini`, `free`, `flash`, `nano`, `tiny`, `lite`, `small`, `haiku`, `0.5b`–`8b`, `gpt-4o-mini`, `mimo-v2.5-free`, `FlashCombo`, …
2. **ModelRegistry stats** (setelah `minSampleSize`): status `unstable`/`degraded`, reliability &lt; `softBlockReliability`, atau hallucination rate tinggi

Strong names (`sonnet`, `opus`, `r1`, `gpt-4o` non-mini, …) tidak dipaksa ON hanya karena nama.

### Saat harness ACTIVE

- `WorkflowPolicy` → **strict** (bisa **block** execute tanpa research/plan evidence)
- Hallucination → **block** (threshold diperketat)
- Notice di system prompt + output `agentic_execute`
- Status di `agentic_status detail=full`

```bash
# Cek status harness
agentic_status detail=full
# → 🛡️ Dumb-Model Harness
#   Status: ACTIVE (auto-name)
#   Model: opencode/mimo-v2.5-free
#   WorkflowPolicy: strict
```

## Hybrid store (local vs global)

| Root | Path |
|------|------|
| Local project | `<worktree>/.agentic/store` |
| Global user | `~/.config/opencode/agentic-store` |

Namespaces: **local** = rag, episodes, evolution, evaluation, session, decisions, todos, reflections, graph · **global** = skills, models · **both** = prompts.

See `docs/guide/memory.md` for full table. Runtime: `agentic_status detail=full` → **Store Roots**.

### Contoh config

```json
{
  "agent": {
    "dumbModelMode": "auto",
    "workflowPolicyMode": "advisory",
    "autoHallucinationCheck": true
  }
}
```

Paksa selalu ketat (CI / model sangat lemah):

```json
{ "agent": { "dumbModelMode": true } }
```

Matikan auto (hanya advisory):

```json
{ "agent": { "dumbModelMode": false, "workflowPolicyMode": "advisory" } }
```

Implementasi: `src/core/dumb-model.ts` (`resolveDumbHarness`).

---

## Self-Improving RAG (critical path)

Tidak ada flag terpisah di config untuk mematikan pipeline default. Retrieval knowledge selalu lewat:

```
Adaptive Retrieval → KbPO Boundary → MMKP Context Optimizer
  → inject di system.transform
  → feedback di agentic_execute / AgentLoop
```

MDP multi-turn = mode `deep` (opt-in API), bukan default chat.

Lihat: [Memory guide](guide/memory.md), `src/memory/rag-self-improve.ts`.

---

## Remote RAG Sync (`rag`)

Sinkronisasi data RAG ke server eksternal secara otomatis. 

Cara kerja:
1. Setiap kali ada perubahan data RAG (store/search/update), data di-persist ke file lokal (`stateStore`)
2. Jika `rag.remoteUrl` dikonfigurasi, data juga dikirim ke endpoint tersebut via HTTP POST
3. Dikirim dalam bentuk **debounced** (default: kumpulin 5 detik dulu) biar gak spam HTTP tiap perubahan kecil
4. Format body: JSON array dari semua data RAG per kategori `{ category: { episodes, skills, tfidfDocs } }`

```json
{
  "rag": {
    "remoteUrl": "https://rag-server.example.com/sync",
    "remoteApiKey": "sk-my-secret-key",
    "remoteBatchIntervalMs": 3000,
    "remoteSyncMode": "full"
  }
}
```

Header yang dikirim:
```
Content-Type: application/json
Authorization: Bearer <remoteApiKey>   (jika dikonfigurasi)
```

> **Catatan:** Saat ini hanya **one-way sync** (plugin → remote). Two-way sync (query dari remote) belum diimplementasi. Untuk query ke remote RAG, gunakan `agentic_mcp` untuk connect ke MCP server eksternal.

---

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
Stats ini juga dipakai **auto dumb-model** detection.
