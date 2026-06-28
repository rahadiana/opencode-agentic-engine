# Self-Evolution

Stage IV: sistem bisa memperbaiki dirinya sendiri.

## Evolve Tool (`agentic_evolve`)

### Inspect System

```
agentic_evolve action="inspect"
  → Current state: roles, skills, model stats
```

### Register Custom Role

```
agentic_evolve action="register-role" name="security-auditor"
  prompt="You are a security expert. Focus on OWASP Top 10."
  tools='["agentic_nav", "agentic_verify"]'
```

Atau pakai Blueprint spec:

```
agentic_evolve action="register-role" name="database-admin"
  spec="""
agent:
  identity: 'You are a DBA. Optimize queries, design schemas.'
  model_tiers:
    default: capable
  tools: [agentic_db, agentic_nav, agentic_verify]
"""
```

### Manage Prompts

```
# Lihat prompt saat ini
agentic_evolve action="read-prompt" role="developer"

# Edit prompt (append instruction)
agentic_evolve action="edit-prompt" role="developer"
  description="Tambah constraint: always check memory first"
  prompt="Sebelum implementasi, selalu cek agentic_episodes untuk task serupa"

# History
agentic_evolve action="prompt-history" role="developer"

# Rollback
agentic_evolve action="rollback-prompt" role="developer" version=2
```

### Export Skill

```
agentic_evolve action="export-skill" skillId="skill-xxx"
  → Output: skill dalam format agentic-skill/v1
```

### Export Training Data

Untuk fine-tuning model external:

```
agentic_evolve action="export-training-data" format="openai" minSuccessRate=0.5
  → Output: training data dalam format OpenAI JSONL
```

## Evolution Cycle

```
Collect → Analyze → Improve → Validate
   │         │         │          │
   ▼         ▼         ▼          ▼
 Skill    Pattern    Prompt     Test
 Store    Detect     Tweak      Pass?
```

1. **Collect**: Skill extraction dari task sukses (`agentic_skill extract`)
2. **Analyze**: Pattern discovery dari error history (`pattern-discovery.ts`)
3. **Improve**: Prompt tweaking, role adjustment
4. **Validate**: Pastikan perubahan tidak regresi

## Gap #9 — Continuous Learning

Feedback loop dari user via `agentic_execute`:

```
agentic_execute stepId="step-1" success=true feedback="positive"
  → Skill confidence naik

agentic_execute stepId="step-2" success=true feedback="negative"
  → Skill confidence turun, adaptasi strategy
```

Auto-skill extraction: jika `autoSkillExtract: true` di config, skill otomatis terekstrak dari task sukses.
