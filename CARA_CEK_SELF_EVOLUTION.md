# 🔮 Cara Cek Self-Evolution

Self-evolution adalah fitur **Stage IV** dari plugin ini yang memungkinkan sistem untuk belajar dan improve dari pengalaman.

---

## 🎯 Apa itu Self-Evolution?

Self-evolution mencakup 4 komponen utama:

1. **Skill Extraction** - Auto-extract reusable skills dari task yang berhasil
2. **Prompt Auto-Patching** - Auto-update agent prompts berdasarkan error patterns
3. **Role Discovery** - Auto-suggest agent roles baru dari usage patterns
4. **Continuous Evolution** - Real-time monitoring + degradation detection

---

## 📋 Cara Cek #1: Via Tool `agentic_evolve`

### Inspect System State

```bash
# Di OpenCode, panggil:
@agentic_evolve action="inspect"
```

**Output yang diharapkan:**
```
🧬 Agent System Inspection
Registered Roles: architect, developer, qa, coordinator, pm
Custom Roles: 0
Skills: 15
Episodes: 42
Model Registry: gpt-4o, gpt-4o-mini
```

### Run Self-Evolution

```bash
@agentic_evolve action="evolve"
```

**Output yang diharapkan:**
```
### 🔮 Auto-Evolution Complete
**Score:** 75/100
**Sessions:** 5 | **Steps:** 42 | **Success Rate:** 85%
**Roles Registered:** code-reviewer
**Skills Patched:** error-recovery-v2
**Prompts Patched:** 2
```

---

## 📋 Cara Cek #2: Via Dashboard

```bash
@agentic_dashboard
```

**Cek bagian "Auto-Evolution":**
- Skill extraction count
- Prompt patch count
- Role suggestion count
- Performance trends

---

## 📋 Cara Cek #3: Via File System

### 1. Cek Skill Storage

```bash
ls -la .agentic/data/skills/
```

**File yang diharapkan:**
- `skill-001.json` - Skill definitions
- `skill-002.json` - Auto-extracted skills
- dll

**Format skill:**
```json
{
  "$schema": "agentic-skill/v1",
  "meta": {
    "id": "skill-001",
    "name": "error-recovery",
    "version": 2
  },
  "workflow": {
    "steps": [
      {
        "order": 1,
        "action": "analyze",
        "description": "Categorize error type"
      }
    ]
  },
  "quality": {
    "usageCount": 15,
    "successRate": 0.87
  }
}
```

### 2. Cek Episode Storage

```bash
ls -la .agentic/data/episodes/
```

**File yang diharapkan:**
- `episode-ses_123.json` - Per-session learning data

### 3. Cek Prompt History

```bash
ls -la .agentic/data/prompts/
```

**File yang diharapkan:**
- `state.json` - Versioned prompt history

---

## 📋 Cara Cek #4: Via Test Suite

### Run Evolution Tests

```bash
cd /home/runner/opencode-agentic-engine
npm test 2>&1 | grep -A 10 "Auto-Evolution"
```

**Output yang diharapkan:**
```
[82] Auto-Evolution — self-evolution triggers
  PASS: execute works before evolution test
  PASS: status output
  PASS: auto-evolution auto run produces output
  PASS: auto-evolution tests passed
```

### Run Skill Training Tests

```bash
npm test 2>&1 | grep -A 20 "Skill → Training Data"
```

**Output yang diharapkan:**
```
[83] Skill → Training Data conversion
  PASS: training example has instruction
  PASS: training example has response
  PASS: OpenAI format produces 1 line per example
  ...
  PASS: Skill Training Data conversion tests passed
```

---

## 📋 Cara Cek #5: Monitoring Real-Time

### Continuous Evolution dengan Degradation Detection

Plugin ini otomatis monitor performance dan trigger evolution ketika:

1. **Success rate drops** > 10% dalam rolling window
2. **Anomaly spike** > 30% error rate
3. **Milestone** setiap 50 steps

### Cek Trend

```bash
@agentic_status
```

**Cari bagian "Performance Trend":**
```
Rolling window (20 steps): 75% success
Direction: degrading ⚠️
Anomaly count: 3
Degradation detected: YES

Recommendations:
- Review error patterns in recent failures
- Consider running evolution analysis
```

---

## 📋 Cara Cek #6: Export Training Data

Self-evolution bisa export skills ke training data format:

```bash
@agentic_evolve action="export-training-data" format="openai" minSuccessRate=0.7
```

**Output:**
```
Exported 12 skills to training data (OpenAI JSONL format)
Total examples: 12
Format: openai
Skills included: error-recovery, test-generation, refactor-split, ...
```

**File location:**
`.agentic/data/training-data.jsonl`

**Format (OpenAI JSONL):**
```jsonl
{"messages":[{"role":"system","content":"You are..."},{"role":"user","content":"Task:..."},{"role":"assistant","content":"Steps:..."}]}
{"messages":[...]}
```

---

## 🧪 Cara Test Self-Evolution Secara Manual

### Scenario 1: Skill Auto-Extraction

1. **Jalankan task yang berhasil:**
```bash
@agentic_plan goal="refactor module X"
@agentic_execute stepId="step-1" success=true output="Refactored successfully"
```

2. **Extract skill:**
```bash
@agentic_skill action="extract" query="step-1"
```

3. **Verify:**
```bash
@agentic_skill action="list"
```

### Scenario 2: Prompt Auto-Patching

1. **Simulate errors:**
```bash
# Jalankan beberapa task yang fail dengan error category sama
@agentic_execute stepId="step-1" success=false error="ImportError: module not found"
@agentic_execute stepId="step-2" success=false error="ImportError: package missing"
```

2. **Run evolution:**
```bash
@agentic_evolve action="evolve"
```

3. **Check prompt patches:**
```bash
@agentic_evolve action="read-prompt" role="developer"
```

**Output harus include auto-patched instruction:**
```
## Auto-Patched Instruction (from import errors)
Always verify imports exist before using them.
Use try-except for dynamic imports.
```

### Scenario 3: Role Discovery

1. **Use delegation extensively:**
```bash
@agentic_delegate role="architect" description="Design system"
@agentic_delegate role="architect" description="Review architecture"
@agentic_delegate role="architect" description="Create design doc"
```

2. **Run evolution:**
```bash
@agentic_evolve action="evolve"
```

3. **Check role suggestions:**

Output harus include new role suggestions jika pattern terdeteksi.

---

## 📊 Metrics Self-Evolution

### Key Metrics to Monitor:

| Metric | What It Means | How to Check |
|--------|---------------|--------------|
| **Improvement Score** | 0-100, higher = more evolving | `@agentic_evolve action="evolve"` |
| **Skill Count** | Total extracted skills | `@agentic_skill action="list"` |
| **Success Rate** | Overall task completion % | `@agentic_status` |
| **Degradation Detected** | Performance dropping? | `@agentic_status` |
| **Prompt Patches Applied** | Auto-improvements to prompts | `@agentic_evolve action="evolve"` |

---

## 🔍 Debugging Self-Evolution

### Evolution Not Triggering?

**Check:**
1. Minimal data requirement: ≥10 steps completed
2. Error patterns: perlu ≥3 similar errors untuk prompt patch
3. Skill extraction: perlu success + output + filesModified

### Skills Not Extracted?

**Debug:**
```bash
# Check if steps have required fields
@agentic_status
```

Look for steps with:
- ✅ success: true
- ✅ output: non-empty
- ✅ filesModified: at least 1 file

### Prompt Patches Not Applying?

**Check:**
```bash
@agentic_evolve action="prompt-history" role="developer"
```

Verify version increments after evolution runs.

---

## 💡 Tips

1. **Run evolution after every 50 steps** untuk best results
2. **Monitor degradation trends** - jangan tunggu sampai critical
3. **Review extracted skills** - kadang perlu manual cleanup
4. **Export training data** secara berkala untuk fine-tuning
5. **Use @agentic_dashboard** untuk overview lengkap

---

**Next:** Lihat `COMPATIBILITY_REPORT.md` untuk detail teknis implementasi.
