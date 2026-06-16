# Auto vs Manual Mechanisms - Critical Analysis

## Pertanyaan User (KRITIS)

> "gini nih, ini kan banyak baget tool yang di claim. bisakah tool-tool tersebut otomatis di panggil. tujuan plugin ini kan agentic, selain agentic dia juga smart. kalau cuma catat tanpa self learning buat apa plugin ini"

**Terjemahan:**
- Plugin claims banyak tools tapi masih manual call
- Apakah bisa **AUTO-CALL** tanpa user intervention?
- Plugin untuk **AGENTIC + SMART**
- Kalau cuma **catat tanpa self-learning**, untuk apa plugin ini?

**INI PERTANYAAN SANGAT TEPAT!** User menunjuk ke **core contradiction** dalam design.

---

## Current State: Auto vs Manual

### ✅ SUDAH AUTO (Self-Learning AKTIF)

| Feature | Status | Auto-Trigger | Config | File |
|---------|--------|--------------|--------|------|
| **Skill Extraction** | ✅ AUTO | After successful step | `autoSkillExtract: true` | index.ts:349 |
| **Episode Recording** | ✅ AUTO | After session complete | `memory.enabled: true` | index.ts:215 |
| **Performance Monitoring** | ✅ AUTO | Every step result | Always on | continuous-evolution.ts |
| **Degradation Detection** | ✅ AUTO | Rolling window analysis | Always on | continuous-evolution.ts:87-127 |
| **Auto-Evolution Trigger** | ✅ AUTO | When degradation detected | Always on | index.ts:795-803 |
| **Model Registry Update** | ✅ AUTO | Every LLM call | Always on | model-registry.ts:50-67 |
| **Trace Logging** | ✅ AUTO | Every tool execution | Always on | trace-logger.ts |

### ❌ MASIH MANUAL (User Harus Call Explicitly)

| Feature | Status | Manual Call | Why Not Auto? | Impact |
|---------|--------|-------------|---------------|--------|
| **Hallucination Check** | ❌ MANUAL | `@agentic_guard stepId="X"` | Not integrated in executor | Cascading errors |
| **Semantic Verification** | ⚠️ PARTIAL | Enabled via `requireSemanticCheck` | Default: false (backward compat) | Logic bugs pass |
| **Tech Debt Scoring** | ❌ MANUAL | `@agentic_score` | Performance cost | No preventive feedback |
| **Skill Application** | ⚠️ PARTIAL | Auto-loaded but not auto-applied | Needs context matching | Missed optimization |
| **Prompt Patching** | ⚠️ PARTIAL | Auto-generated but not auto-applied | Needs approval | Stale prompts |

---

## Deep Dive: Self-Learning Mechanisms

### 1. Auto-Skill Extraction (✅ FULLY AUTO)

**File:** `src/index.ts` lines 337-362

**How it works:**
```typescript
// After successful step execution
if (config.autoSkillExtract && stepState.result?.success) {
  const skill = await skillStore.extract({
    sessionId,
    stepId,
    description: stepState.description,
    output: stepState.result.output,
    successCriteria: "Step completed successfully"
  })
  
  // Auto-save to .agentic/store/skills/
  await skillStore.save(skill)
}
```

**Config:**
```json
{
  "agent": {
    "autoSkillExtract": true  // Default: TRUE
  }
}
```

**What happens:**
1. Step executes successfully ✅
2. System automatically extracts workflow pattern
3. Saves to `.agentic/store/skills/[id].json`
4. Future agents can auto-load this skill

**Status:** ✅ **FULLY AUTO** - No user intervention needed

### 2. Auto-Evolution Trigger (✅ FULLY AUTO)

**File:** `src/evolution/continuous-evolution.ts` lines 220-258

**How it works:**
```typescript
checkEvolutionTriggers(sessionId: string): EvolutionTrigger | null {
  const trend = this.getTrend()
  
  // Trigger 1: Performance degradation
  if (trend.degradationDetected && trend.rolling.successRate < 0.5) {
    return {
      reason: `Auto-evolution triggered by performance degradation: ${(trend.rolling.successRate * 100).toFixed(0)}% success rate`,
      type: "degradation",
      metrics: { recentRate: trend.rolling.successRate, ... }
    }
  }
  
  // Trigger 2: Milestone (every 50 steps)
  const successCount = this.results.filter(r => r.success).length
  if (successCount > 0 && successCount % 50 === 0) {
    return {
      reason: `Milestone reached: ${successCount} successful steps`,
      type: "milestone",
      metrics: { ... }
    }
  }
  
  return null
}
```

**Integration:** `src/index.ts` lines 795-803

```typescript
// Auto-check after every agentic_execute
const trigger = continuousEvolution.checkEvolutionTriggers(sessionID)
if (trigger) {
  try {
    const analysis = await selfEvolver.evolve(sessionID, trigger.metrics)
    response += `🔄 **Auto-evolution triggered:** ${trigger.reason}\n`
    response += `Recommendations: ${analysis.recommendations.join(", ")}\n`
  } catch (e) {
    response += `⚠️ Auto-evolution encountered an error\n`
  }
}
```

**What happens:**
1. Performance drops below 50% success rate → AUTO-TRIGGER ✅
2. Milestone reached (50 steps) → AUTO-TRIGGER ✅
3. System runs self-evolution analysis
4. Generates recommendations
5. Auto-applies safe patches (if enabled)

**Status:** ✅ **FULLY AUTO** - Triggers without user intervention

### 3. Hallucination Check (❌ MANUAL - MAJOR GAP)

**File:** `src/index.ts` lines 2115-2174

**How it works NOW:**
```typescript
agentic_guard: tool({
  description: "Verify truthfulness of claims",
  args: { stepId: string },
  async execute(args, context) {
    const check = hallucinationGuard.check(output, files)
    
    if (!check.passed) {
      modelRegistry.recordHallucination(model)
    }
    
    return { output: report }
  }
})
```

**User MUST call:**
```typescript
@agentic_guard stepId="step-1"
```

**WHY NOT AUTO?**
- Not integrated into `executeStep()` flow
- No config option to enable auto-check
- Performance concern (regex extraction on every step)

**SHOULD BE AUTO:**
```typescript
// In executor.ts
async executeStep(sessionID: string, stepId: string, config: AgentConfig) {
  const result = await this.runStep(sessionID, stepId)
  
  // ✅ AUTO-CHECK (proposed)
  if (config.autoHallucinationCheck !== false) {
    const check = hallucinationGuard.check(result.output, files)
    
    if (!check.passed) {
      const failRate = check.claims.filter(c => !c.verified).length / check.claims.length
      
      if (failRate >= config.hallucinationThreshold) {
        throw new Error(`BLOCKED: Hallucination rate ${failRate} exceeds threshold`)
      }
      
      result.warnings.push(`⚠️ Hallucination detected: ${check.summary}`)
    }
  }
  
  return result
}
```

**Status:** ❌ **MANUAL ONLY** - Major gap in self-learning

---

## The Core Problem: "Catat Tanpa Self-Learning"

User's criticism is **100% VALID**. Here's the breakdown:

### What Plugin CLAIMS (from README.md)

```markdown
# opencode-agentic-engine

Plugin OpenCode yang mengimplementasikan **agentic software engineering workflow**
berdasarkan paper "The End of Software Engineering"

✅ Self-evolving agents
✅ Continuous learning
✅ Auto-skill extraction
✅ Cross-session memory
✅ Performance monitoring
```

### What Plugin ACTUALLY DOES

**Self-Learning Features (7/12 AUTO):**

1. ✅ **Skill Extraction** - AUTO (config: `autoSkillExtract: true`)
2. ✅ **Episode Recording** - AUTO (config: `memory.enabled: true`)
3. ✅ **Performance Monitoring** - AUTO (always on)
4. ✅ **Degradation Detection** - AUTO (always on)
5. ✅ **Auto-Evolution Trigger** - AUTO (degradation + milestone)
6. ✅ **Model Registry** - AUTO (every LLM call)
7. ✅ **Trace Logging** - AUTO (every tool execution)

**Missing Auto Features (5/12 MANUAL):**

8. ❌ **Hallucination Check** - MANUAL (`@agentic_guard`)
9. ❌ **Semantic Verification** - MANUAL (opt-in via config)
10. ❌ **Tech Debt Scoring** - MANUAL (`@agentic_score`)
11. ❌ **Skill Application** - PARTIAL (auto-load but not auto-apply)
12. ❌ **Prompt Patching** - PARTIAL (auto-generate but not auto-apply)

**Score: 7/12 (58%) AUTO - CLAIMS 100% AGENTIC**

---

## User's Criticism: "Kalau Cuma Catat, Untuk Apa?"

### What Plugin CLAIMS to do:

> "Self-evolving agents with continuous learning"

### What Plugin ACTUALLY does:

> "Records data + auto-evolves performance monitoring, BUT:
> - Does NOT auto-check hallucination (manual tool)
> - Does NOT auto-verify semantic correctness (opt-in)
> - Does NOT auto-apply learned skills (context-aware but manual)
> - Does NOT auto-patch prompts (generates patches but needs approval)"

**Conclusion:** User is **100% CORRECT** - plugin has strong **recording** but weak **autonomous action**.

---

## The Gap: Recording ≠ Self-Learning

### True Self-Learning Requires:

1. **Perception** - Detect patterns/errors/degradation ✅ DONE
2. **Recording** - Store experiences for future reference ✅ DONE
3. **Analysis** - Extract insights from recorded data ✅ DONE
4. **Decision** - Determine when to intervene ⚠️ PARTIAL
5. **Action** - Automatically apply learned improvements ❌ MISSING

**Current State:**
- Steps 1-3: ✅ COMPLETE
- Step 4: ⚠️ PARTIAL (degradation triggers evolution, but only generates recommendations)
- Step 5: ❌ MISSING (recommendations not auto-applied)

**Example Flow:**

**Current (Manual):**
```
1. Agent makes claim: "Created file X" ✅
2. HallucinationGuard has detection logic ✅
3. Data recorded in model registry ✅
4. User must call @agentic_guard ❌
5. User reads report ❌
6. User decides whether to continue ❌
```

**Should Be (Auto):**
```
1. Agent makes claim: "Created file X" ✅
2. Auto-check runs after step execution ✅
3. Hallucination detected (file doesn't exist) ✅
4. Step BLOCKED automatically ✅
5. Model downgraded in registry ✅
6. Next step uses more reliable model ✅
```

---

## Solution: Close the Action Loop

### Priority 1: Auto-Hallucination Check (2 days)

**Status:** Detection ✅, Recording ✅, **Action ❌**

**Add:**
```typescript
// src/core/config.ts
export interface AgentConfig {
  autoHallucinationCheck: boolean    // Default: true
  hallucinationThreshold: number     // Default: 0.3 (30%)
  blockOnHallucination: boolean      // Default: false (conservative)
}
```

**Integrate:**
```typescript
// src/core/executor.ts - executeStep()
if (config.autoHallucinationCheck) {
  const check = hallucinationGuard.check(result.output, files)
  
  if (!check.passed && config.blockOnHallucination) {
    const failRate = unverifiedCount / totalClaims
    
    if (failRate >= config.hallucinationThreshold) {
      throw new Error(`BLOCKED: Hallucination rate ${failRate * 100}%`)
    }
  }
}
```

**Impact:** Closes action loop - auto-detect + auto-block

### Priority 2: Auto-Skill Application (1 day)

**Status:** Extraction ✅, Storage ✅, **Application ❌**

**Current:** Skills are auto-extracted and stored, but agents must manually discover and apply them.

**Should Be:**
```typescript
// src/agents/coordinator.ts - delegate()
async delegate(role: string, task: string, context: DelegationContext) {
  // Auto-search for relevant skills
  const relevantSkills = await skillStore.search(task, { limit: 3 })
  
  // Auto-inject into agent context
  const enhancedContext = {
    ...context,
    learnedSkills: relevantSkills.map(s => ({
      description: s.description,
      steps: s.steps,
      successRate: s.successRate
    }))
  }
  
  // Agent automatically considers learned skills
  return await agent.execute(task, enhancedContext)
}
```

**Impact:** Agents automatically benefit from past successful workflows.

### Priority 3: Auto-Prompt Patching (0.5 days)

**Status:** Generation ✅, **Application ❌**

**Current:** Prompt patches auto-generated but require manual approval.

**Should Be:**
```typescript
// src/evolution/self-evolver.ts - evolve()
async evolve(sessionID: string) {
  const patches = this.generatePromptPatches(errorPatterns)
  
  // Auto-apply safe patches (low risk)
  for (const patch of patches) {
    if (patch.riskLevel === "low" && patch.confidence >= 0.8) {
      await promptStore.applyPatch(patch.role, patch.instruction)
      logger.log(`Auto-applied prompt patch: ${patch.description}`)
    }
  }
  
  return analysis
}
```

**Impact:** Agent prompts continuously improve without manual intervention.

---

## Summary: Closing the Self-Learning Loop

### Current State (58% AUTO)
```
Perception → Recording → Analysis → [MANUAL DECISION] → [MANUAL ACTION]
   ✅           ✅           ✅              ❌                  ❌
```

### Target State (100% AUTO)
```
Perception → Recording → Analysis → Auto-Decision → Auto-Action
   ✅           ✅           ✅           ✅              ✅
```

### Implementation Roadmap (3.5 days)

| Priority | Feature | Effort | Impact |
|----------|---------|--------|--------|
| **P1** | Auto-hallucination check + blocking | 2 days | Prevents cascading errors |
| **P2** | Auto-skill application | 1 day | Leverages learned workflows |
| **P3** | Auto-prompt patching | 0.5 days | Continuous prompt improvement |
| **TOTAL** | | **3.5 days** | **100% autonomous loop** |

---

## Kesimpulan

### User's Question: "Kalau cuma catat tanpa self learning buat apa plugin ini?"

**JAWABAN:**

Plugin ini **SUDAH punya self-learning**, tapi **BELUM SEPENUHNYA AUTONOMOUS**:

✅ **Yang SUDAH AUTO (7/12):**
- Skill extraction → auto-save after success
- Episode recording → auto-save after session
- Performance monitoring → always running
- Degradation detection → automatic alerts
- Evolution trigger → auto-runs when degraded
- Model registry → auto-updates reliability
- Trace logging → auto-records all executions

❌ **Yang MASIH MANUAL (5/12):**
- Hallucination check → user must call `@agentic_guard`
- Semantic verification → opt-in config (default: false)
- Tech debt scoring → user must call `@agentic_score`
- Skill application → auto-load but not auto-apply
- Prompt patching → auto-generate but not auto-apply

**Score: 58% AUTO vs 100% CLAIMED**

### The Core Gap

**Recording ≠ Self-Learning**

Plugin is excellent at **collecting data** but weak at **autonomous action**.

True self-learning requires:
1. Perception ✅
2. Recording ✅
3. Analysis ✅
4. Decision ⚠️ PARTIAL
5. **Action ❌ MISSING**

### Solution (3.5 days)

Close the action loop:
1. Auto-hallucination check with blocking (2 days)
2. Auto-skill application in context (1 day)
3. Auto-prompt patching for safe changes (0.5 days)

After implementation: **100% autonomous self-learning loop** ✅

---

**Dibuat:** 2026-06-16  
**Analisis oleh:** Kiro (opencode-agentic-engine)  
**User feedback:** "kalau cuma catat tanpa self learning buat apa plugin ini" - **100% VALID CRITICISM**  
**Status:** Gap identified, solution designed, implementation roadmap ready