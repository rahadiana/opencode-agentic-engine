# 📂 Lokasi Data Self-Learning

## 🎯 Struktur Direktori

```
[PROJECT_ROOT]/
└── .agentic/                    ← Folder utama plugin
    ├── config.json              ← Konfigurasi (hot-reload)
    ├── trace.jsonl              ← Execution logs
    └── store/                   ← Data persistence
        ├── models/              ← Model reliability stats
        │   └── registry.json
        ├── prompts/             ← Prompt version history
        │   └── state.json
        ├── skills/              ← Extracted skills (on-demand)
        │   └── [skill-id].json
        └── episodes/            ← Cross-session memory (on-demand)
            └── [session-id].json
```

---

## 📁 Lokasi File

### 1. Config - `.agentic/config.json`

**Path:** `[PROJECT]/agentic/config.json`

**Contoh:**
```json
{
  "$schema": "v1",
  "memory": {
    "enabled": true,
    "maxEntries": 1000,
    "forgetAfterDays": 30
  },
  "agent": {
    "autoSkillExtract": true
  },
  "storage": {
    "traceRetentionDays": 7,
    "skillMaxCount": 200
  }
}
```

**Hot-reload:** ✅ Changes apply immediately

---

### 2. Trace Logs - `.agentic/trace.jsonl`

**Path:** `[PROJECT]/.agentic/trace.jsonl`

**Format:** JSON Lines (1 object per line)

**Sample:**
```jsonl
{"step":"tool","toolUsed":"agentic_plan","success":true,"timestamp":"2026-06-16T07:30:00.000Z"}
{"step":"tool","toolUsed":"agentic_execute","success":true,"timestamp":"2026-06-16T07:30:03.000Z"}
```

**Retention:** 7 days (configurable)

---

### 3. Model Stats - `.agentic/store/models/registry.json`

**Path:** `[PROJECT]/.agentic/store/models/registry.json`

**Format:**
```json
{
  "data": {
    "gpt-4o": {
      "totalCalls": 42,
      "successfulCalls": 39,
      "reliability": 0.93
    }
  }
}
```

**Self-Learning:** Track model performance over time

---

### 4. Prompt History - `.agentic/store/prompts/state.json`

**Path:** `[PROJECT]/.agentic/store/prompts/state.json`

**Format:**
```json
{
  "data": [
    {
      "role": "developer",
      "history": [
        {
          "version": 1,
          "prompt": "You are a software developer...",
          "source": "system"
        },
        {
          "version": 2,
          "prompt": "...Always verify imports...",
          "source": "auto-evolve"
        }
      ]
    }
  ]
}
```

**Self-Learning:** Prompt auto-patching dengan versioning

---

### 5. Skills - `.agentic/store/skills/[id].json`

**Path:** `[PROJECT]/.agentic/store/skills/skill-*.json`

**Format:**
```json
{
  "data": {
    "$schema": "agentic-skill/v1",
    "meta": {
      "id": "skill-001",
      "name": "refactor-module",
      "tags": ["refactor", "typescript"]
    },
    "workflow": {
      "steps": [
        {"order": 1, "action": "analyze", "description": "..."}
      ]
    },
    "quality": {
      "usageCount": 5,
      "successRate": 0.8
    }
  }
}
```

**Self-Learning:** Reusable workflows dari task berhasil

**Created:** On-demand saat skill di-extract

---

### 6. Episodes - `.agentic/store/episodes/[session-id].json`

**Path:** `[PROJECT]/.agentic/store/episodes/ses_*.json`

**Format:**
```json
{
  "data": {
    "sessionId": "ses_abc123",
    "planGoal": "Refactor auth module",
    "outcome": "success",
    "decisions": ["Use JWT", "Add rate limiting"],
    "filesChanged": ["src/auth/login.ts"],
    "tags": ["auth", "security"]
  }
}
```

**Self-Learning:** Past experiences untuk future decisions

**Created:** On-demand saat episode di-record

---

## 🔍 Cara Cek Data

### Via Command Line:

```bash
# Struktur
ls -la .agentic/
ls -la .agentic/store/

# Config
cat .agentic/config.json

# Logs (last 10)
tail -10 .agentic/trace.jsonl

# Model stats
cat .agentic/store/models/registry.json | jq

# Prompt history
cat .agentic/store/prompts/state.json | jq

# Skills
ls -la .agentic/store/skills/

# Episodes
ls -la .agentic/store/episodes/
```

### Via OpenCode Tools:

```bash
@agentic_evolve action="inspect"          # Show all data locations
@agentic_skill action="list"              # List skills
@agentic_episodes action="search" query="x"  # Search episodes
@agentic_dashboard                        # Data summary
```

---

## 📊 Data Size & Retention

| Data Type | Size | Retention | Configurable |
|-----------|------|-----------|--------------|
| Config | ~500 B | Forever | ✅ |
| Trace logs | 100KB-1MB | 7 days | ✅ `traceRetentionDays` |
| Model stats | 1-5 KB | Forever | ❌ |
| Prompts | 10-50 KB | Forever | ❌ |
| Skills | 2-10 KB each | Max 200 | ✅ `skillMaxCount` |
| Episodes | 1-5 KB each | 30 days | ✅ `forgetAfterDays` |

---

## 🧹 Cleanup

### Auto-Cleanup:
- ✅ Trace logs pruned after `traceRetentionDays`
- ✅ Episodes expired after `forgetAfterDays`
- ✅ Skills limited to `skillMaxCount`

### Manual Cleanup:
```bash
rm -rf .agentic/                    # Nuclear option
rm .agentic/trace.jsonl             # Logs only
rm -rf .agentic/store/skills/       # Skills only
rm -rf .agentic/store/episodes/     # Episodes only
```

---

## 🔐 Privacy

**TIDAK disimpan:**
- ❌ API keys, passwords, secrets
- ❌ Personal data

**Yang disimpan:**
- ✅ File paths (relative)
- ✅ Tool usage stats
- ✅ Error messages (sanitized)
- ✅ Success/failure metrics

**Gitignore:**
```gitignore
.agentic/
```

---

## 🚀 Backup & Transfer

### Backup:
```bash
tar -czf agentic-backup-$(date +%Y%m%d).tar.gz .agentic/
```

### Restore:
```bash
tar -xzf agentic-backup-20260616.tar.gz
```

### Transfer Skills:
```bash
cp -r project-a/.agentic/store/skills/ /tmp/shared/
cp -r /tmp/shared/* project-b/.agentic/store/skills/
```

---

## 📝 Real Example

Dari plugin `opencode-agentic-engine`:

```bash
$ ls -la .agentic/
-rw-rw-r-- 1 runner runner   508 config.json
drwxrwxr-x 4 runner runner  4096 store/
-rw-rw-r-- 1 runner runner 60762 trace.jsonl

$ ls -la .agentic/store/
drwxrwxr-x 2 runner runner 4096 models/
drwxrwxr-x 2 runner runner 4096 prompts/
```

**Observed after 489 test runs:**
- ✅ Config: 508 bytes
- ✅ Trace: 60 KB
- ✅ Model stats: Present
- ✅ Prompts: 12 KB
- ⏳ Skills: Not yet (no extraction in tests)
- ⏳ Episodes: Not yet (no recording in tests)

---

## ✅ Quick Reference

```
.agentic/
├── config.json                   ← Settings (hot-reload)
├── trace.jsonl                   ← Logs (7 days)
└── store/
    ├── models/registry.json      ← Reliability (forever)
    ├── prompts/state.json        ← Versions (forever)
    ├── skills/[id].json          ← Workflows (max 200)
    └── episodes/[id].json        ← Experiences (30 days)
```

**Access:** File system, OpenCode tools, or programmatic via API

---

**Updated:** 2026-06-16  
**Plugin:** opencode-agentic-engine v0.1.0  
**Schema:** v1
