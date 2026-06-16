# Rekomendasi Fix: Critical Gaps

**Tanggal:** 16 Juni 2026  
**Referensi:** ANALISIS_GAP_PAPER.md

---

## Priority 1: Fix Semantic Verification Blocking (CRITICAL)

### Problem
Gap #4 dari paper ("tests pass but semantic error") TIDAK tertutup karena:
- `verifyAllDeep()` ada tapi tidak pernah dipanggil
- Auto-verify hanya pakai `verifyAll()` atau `verifyRelated()` (tanpa semantic check)
- Semantic check hanya warning, tidak blocking

### Solution

#### Step 1: Ubah Auto-Verify Flow di `src/index.ts`

**Current (line 643-648):**
```typescript
verifyResult = changedFiles.length > 0
  ? verifier.verifyRelated(args.stepId, projectDir, changedFiles)
  : verifier.verifyAll(args.stepId, projectDir)
```

**Fixed:**
```typescript
// Extract intent from session
const session = sessionStore.getOrCreate(context.sessionID)
const intent = session.plan?.intent.goal ?? args.output

verifyResult = (changedFiles.length > 0 && verifier.hasLLM() && intent)
  ? await verifier.verifyAllDeep(args.stepId, projectDir, intent, changedFiles)
  : verifier.verifyAll(args.stepId, projectDir)
```

**Changes:**
1. Call `verifyAllDeep()` instead of `verifyRelated()` when conditions met
2. Pass `intent` parameter (extracted from session plan)
3. Make it `await` because `verifyAllDeep()` is async

#### Step 2: Remove Redundant Semantic Check (lines 652-664)

**Current:** Semantic check dipanggil LAGI setelah `verifyResult`

**Fixed:** DELETE lines 652-664 karena semantic check sudah included di `verifyAllDeep()`

**Result:**
- Semantic verification jadi bagian dari `verifyResult.passed`
- Jika semantic fails, `verifyResult.passed = false`
- Step akan dianggap FAILED, trigger retry logic

#### Step 3: Add Config untuk Semantic Enforcement

**File:** `src/core/config.ts`

```typescript
export interface AgenticConfig {
  // ... existing config ...
  verification: {
    requireSemanticCheck: boolean  // Default: true
    semanticCheckMode: "blocking" | "warning" | "disabled"  // Default: "blocking"
  }
}
```

**Usage in verifier.ts:**
```typescript
async verifyAllDeep(stepId: string, projectDir: string, intent?: string, changedFiles?: string[]): Promise<VerificationResult> {
  const checks: CheckResult[] = [...]
  
  // Semantic check enforcement
  const config = getConfig()
  if (config.verification.requireSemanticCheck && !this.llm) {
    // FAIL if semantic check required but no LLM
    checks.push({
      name: "semantic",
      passed: false,
      output: "Semantic verification required but no LLM configured. Set verification.requireSemanticCheck=false to bypass."
    })
  } else if (this.llm && intent && changedFiles && changedFiles.length > 0) {
    const semantic = await this.verifySemantic(stepId, intent, changedFiles, projectDir)
    checks.push(semantic)
  }
  
  const errors = checks.filter(c => !c.passed).map(c => c.output)
  return { passed: errors.length === 0, stepId, checks, errors }
}
```

---

## Priority 2: Fix Silent Error Handling (HIGH)

### Problem
10 empty catch blocks di `src/core/llm.ts` - errors swallowed without logging

### Solution

#### Add Error Logging Helper

```typescript
// Add to src/core/llm.ts top
import { traceLogger } from "../observability/trace-logger.js"

function logParseError(context: string, error: unknown): void {
  traceLogger.log({
    step: "llm-parse-error",
    input: context,
    output: error instanceof Error ? error.message : String(error),
    toolUsed: "llm",
    success: false,
    durationMs: 0,
  })
}
```

#### Replace Silent Catch Blocks

**Before (line 164):**
```typescript
try { 
  const arr = JSON.parse(codeBlock[1]); 
  if (Array.isArray(arr)) return arr 
} catch {}
```

**After:**
```typescript
try { 
  const arr = JSON.parse(codeBlock[1]); 
  if (Array.isArray(arr)) return arr 
} catch (e) {
  logParseError("codeBlock array parse", e)
}
```

**Apply to all 10 catch blocks in llm.ts.**

---

## Priority 3: Modularize index.ts (CRITICAL)

### Problem
2893 lines in single file = God Object anti-pattern

### Solution: Split into Tool Modules

**New structure:**
```
src/
├── index.ts (100 lines - tool registry only)
└── tools/
    ├── agentic-plan.ts
    ├── agentic-execute.ts
    ├── agentic-verify.ts
    ├── agentic-reflect.ts
    ├── agentic-nav.ts
    ├── agentic-delegate.ts
    ├── agentic-parallel.ts
    ├── agentic-skill.ts
    ├── agentic-guard.ts
    ├── agentic-evolve.ts
    └── agentic-auto.ts
```

**Each tool file exports:**
```typescript
// Example: src/tools/agentic-execute.ts
import { tool } from "@opencode-ai/plugin"
import { z } from "zod"

export const agenticExecuteTool = tool({
  id: "agentic_execute",
  name: "agentic_execute",
  description: "...",
  schema: z.object({...}),
  execute: async (args, context) => {
    // Tool implementation
  }
})
```

**New index.ts becomes:**
```typescript
import { agenticPlanTool } from "./tools/agentic-plan.js"
import { agenticExecuteTool } from "./tools/agentic-execute.js"
// ... import all tools ...

export const server: PluginModule["server"] = async (input, options) => {
  return {
    tool: [
      agenticPlanTool,
      agenticExecuteTool,
      // ... register all tools ...
    ],
    dispose: async () => { /* cleanup */ }
  }
}
```

**Benefits:**
- Each tool file 150-250 lines (manageable)
- Easy to test individual tools
- Follows Single Responsibility Principle
- Matches paper's modular architecture (Figure 2)

---

## Priority 4: Add Integration Tests for Semantic Verification

### Problem
489 tests pass tapi tidak ada test untuk "semantic check blocks step success"

### Solution: Add E2E Test Scenario

**File:** `test/semantic-verification.mjs`

```typescript
import assert from "node:assert"

// Test 1: Semantic check blocks step with wrong logic
async function testSemanticBlocksStep() {
  const plugin = await loadPlugin()
  const context = createMockContext()
  
  // Setup: Create plan with clear intent
  await plugin.tool.agentic_plan({
    goal: "Add pagination to /users endpoint with correct offset calculation"
  }, context)
  
  // Execute step with WRONG implementation (off-by-one error)
  const executeResult = await plugin.tool.agentic_execute({
    stepId: "impl-pagination",
    success: true,
    output: "Implemented pagination",
    filesModified: ["src/api/users.ts"],
    autoVerify: true
  }, context)
  
  // Assertion: Step should FAIL because semantic check detects wrong logic
  assert(executeResult.includes("❌ Verification failed"), "Semantic error should fail step")
  assert(executeResult.includes("semantic"), "Should mention semantic verification")
}

// Test 2: Semantic check passes when logic is correct
async function testSemanticPassesCorrectLogic() {
  // Similar setup but with CORRECT implementation
  // Assert: Step should PASS
}

// Test 3: Config enforcement - requireSemanticCheck=true blocks if no LLM
async function testSemanticEnforcement() {
  // Setup: No LLM configured, requireSemanticCheck=true
  // Assert: Step should FAIL with "semantic verification required" message
}
```

**Run:**
```bash
node test/semantic-verification.mjs
```

---

## Implementation Roadmap

### Week 1 - Critical Fixes
- [ ] Day 1-2: Fix semantic verification blocking (Priority 1)
- [ ] Day 3-4: Add error logging to llm.ts (Priority 2)
- [ ] Day 5: Write integration tests (Priority 4)

### Week 2 - Refactoring
- [ ] Day 1-3: Split index.ts into tool modules (Priority 3)
- [ ] Day 4-5: Update test suite to match new structure

### Week 3 - Validation
- [ ] Run full test suite (all 489 tests must pass)
- [ ] Run new semantic verification tests
- [ ] Run EvoClaw benchmark (expect improvement from 38%)
- [ ] Update documentation (AGENTS.md, README.md)

---

## Expected Outcomes

### Before Fix
- Gap #4: Tests pass but semantic errors slip through ❌
- 489 tests pass but validate wrong behavior ⚠️
- index.ts 2893 lines (unmaintainable) 🔴

### After Fix
- Gap #4: Semantic verification blocks errors ✅
- Integration tests catch semantic issues ✅
- Modular architecture (each tool <250 lines) ✅
- Error observability (no silent failures) ✅

### Performance Impact
- **EvoClaw benchmark:** Expected 38% → 55%+ (closing Gap #4)
- **Code maintainability:** 2893 lines → 11 files × ~200 lines
- **Test coverage:** 489 basic tests → 492 tests (+ 3 semantic E2E)

---

## Risk Analysis

### Low Risk Changes
- Adding error logging (no behavior change)
- Adding config options (backward compatible with defaults)

### Medium Risk Changes
- Changing auto-verify flow (could break existing workflows)
- **Mitigation:** Add config flag `verification.semanticCheckMode` with default "warning" for gradual rollout

### High Risk Changes
- Splitting index.ts (major refactor)
- **Mitigation:** Do in separate branch, run full test suite after each tool extraction

---

## Conclusion

**User was right to not trust tests.** Tests passing 489/489 while critical gaps exist proves that:
1. Test coverage ≠ correctness validation
2. Tests can validate wrong behavior (default-pass semantic check)
3. Integration tests > unit tests for catching system-level gaps

**Paper's Gap #4 (verification fidelity) is NOT closed** in current implementation despite having `verifySemantic()` code. The fix requires **integration work**, not just writing more code.

This aligns with paper's conclusion: "The gap between tool-augmented agents and fully autonomous SE agents lies not in capabilities but in **integration and orchestration**."
