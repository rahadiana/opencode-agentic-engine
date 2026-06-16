# 📍 Model Configuration Locations - Technical Reference

**Created:** 2026-06-16  
**Plugin:** opencode-agentic-engine  
**Question:** "itu di set dimana dah?" (Where is model configuration set?)

---

## 🎯 Overview: 3 Layer Model Configuration

Model configuration ada di **3 layer**:

1. **Default Tiers** → Hard-coded di `role-registry.ts`
2. **Session Preferences** → Runtime storage di `session-store.ts`
3. **Tool Interface** → User-facing API di `index.ts` (agentic_model tool)

---

## 📂 Layer 1: Default Model Tiers (Hard-coded)

### File: `src/agents/role-registry.ts`

**Location:** Lines 44-50

```typescript
private defaultModels: Record<AgentRole, string> = {
  architect: "fast",        // analisis — cukup model cepat
  developer: "capable",     // implementasi — model paling capable
  qa: "fast",               // review — model cepat sudah cukup
  coordinator: "capable",   // koordinasi — perlu reasoning baik
  pm: "fast",               // requirement — model cepat
}
```

**Purpose:**
- ✅ Default model tier untuk setiap agent role
- ✅ Fallback jika tidak ada session preference
- ✅ Hard-coded, tidak bisa diubah runtime

**How it works:**
```typescript
// Line 529-533: Model tier adjustment based on task complexity
const base = this.defaultModels[role as AgentRole] ?? "capable"
if (complexity === "simple" && base === "capable") return "fast"
if (complexity === "complex" && base === "fast") return "capable"
return base
```

**Behavior:**
- Task "simple" + role "developer" (default: capable) → downgrade to "fast"
- Task "complex" + role "architect" (default: fast) → upgrade to "capable"
- Normal complexity → use default tier

---

### Method: `setModel(role, model)` (Lines 535-538)

```typescript
setModel(role: AgentRole, model: string): void {
  this.defaultModels[role] = model
}
```

**Purpose:** Change default tier for a role (global, affects all sessions)

**⚠️ WARNING:** This is **GLOBAL** - affects all sessions, not recommended for production use.

---

## 📂 Layer 2: Session Model Preferences (Runtime Storage)

### File: `src/memory/session-store.ts`

**Storage Structure:**
```typescript
private sessions: Map<string, SessionData> = new Map()

interface SessionData {
  // ... other fields
  modelPreferences?: Map<string, string>  // role → model mapping
}
```

---

### Method: `setModelPreference(sessionId, role, model)` (Line 106)

```typescript
setModelPreference(sessionId: string, role: string, model: string): void {
  const session = this.sessions.get(sessionId)
  if (!session) return
  
  if (!session.modelPreferences) {
    session.modelPreferences = new Map()
  }
  
  session.modelPreferences.set(role, model)
}
```

**Purpose:**
- ✅ Set model preference for specific role in specific session
- ✅ Per-session scope (tidak affect session lain)
- ✅ Overrides default tier from role-registry

**Example:**
```typescript
sessionStore.setModelPreference("ses_abc123", "developer", "claude-sonnet-4")
```

---

### Method: `getModelPreference(sessionId, role)` (Line 116)

```typescript
getModelPreference(sessionId: string, role: string): string | undefined {
  const session = this.sessions.get(sessionId)
  return session?.modelPreferences?.get(role)
}
```

**Purpose:**
- ✅ Get model preference for role in session
- ✅ Returns `undefined` if no preference set
- ✅ Used during delegation to select model

**Flow:**
```
1. User delegates task to "developer"
2. Check: getModelPreference(sessionId, "developer")
3a. Found → Use that model (e.g., "claude-sonnet-4")
3b. Not found → Use default tier from role-registry (e.g., "capable")
```

---

### Method: `getAllModelPreferences(sessionId)` (Line 122)

```typescript
getAllModelPreferences(sessionId: string): Array<{ role: string; model: string }> {
  const session = this.sessions.get(sessionId)
  if (!session?.modelPreferences) return []
  
  return Array.from(session.modelPreferences.entries()).map(([role, model]) => ({
    role,
    model,
  }))
}
```

**Purpose:**
- ✅ List all model preferences in session
- ✅ Used by `agentic_model` tool with `action: "list"`

---

### Method: `clearModelPreference(sessionId, role?)` (Line 129)

```typescript
clearModelPreference(sessionId: string, role?: string): void {
  const session = this.sessions.get(sessionId)
  if (!session?.modelPreferences) return
  
  if (role) {
    session.modelPreferences.delete(role)
  } else {
    session.modelPreferences.clear()
  }
}
```

**Purpose:**
- ✅ Clear preference for specific role (if `role` provided)
- ✅ Clear ALL preferences (if `role` omitted)

---

## 📂 Layer 3: User-Facing Tool (API Interface)

### File: `src/index.ts`

**Tool:** `agentic_model` (Lines 1801-1857)

**Location:** Line 1801

```typescript
agentic_model: tool({
  description: "Configure per-role LLM model preferences for the current session.",
  args: {
    action: tool.schema.enum(["set", "get", "list", "clear"]),
    role: tool.schema.string().optional(),
    model: tool.schema.string().optional(),
  },
  async execute(args, context) {
    // Implementation...
  },
})
```

---

### Action: "set" (Lines 1824-1836)

**Code:**
```typescript
if (args.action === "set") {
  if (!args.role) return { output: "Provide a `role`" }
  if (!args.model) return { output: "Provide a `model`" }
  
  const roleLower = args.role.toLowerCase()
  if (!VALID_ROLES.includes(roleLower)) {
    return { output: `Invalid role "${args.role}"` }
  }
  
  // Store in session
  sessionStore.setModelPreference(context.sessionID, roleLower, args.model)
  
  // Also register in model registry
  modelRegistry.addModel(args.model)
  modelRegistry.registerAlias(roleLower, [args.model])
  
  return { output: `✅ Model preference set: ${roleLower} → ${args.model}` }
}
```

**What it does:**
1. Validate role and model provided
2. Call `sessionStore.setModelPreference()` → saves to Layer 2
3. Register model in `ModelRegistry` for tracking
4. Return success message

**User example:**
```typescript
agentic_model({
  action: "set",
  role: "developer",
  model: "claude-sonnet-4-20250514"
})
```

---

### Action: "get" (Lines 1838-1845)

**Code:**
```typescript
if (args.action === "get") {
  if (!args.role) return { output: "Provide a `role`" }
  
  const model = sessionStore.getModelPreference(context.sessionID, args.role)
  
  if (!model) {
    return { output: `No preference set for role "${args.role}"` }
  }
  
  return { output: `**${args.role}** → \`${model}\`` }
}
```

**What it does:**
1. Call `sessionStore.getModelPreference()` → reads from Layer 2
2. Return model if found, or "no preference" message

---

### Action: "list" (Lines 1811-1822)

**Code:**
```typescript
if (args.action === "list") {
  const prefs = sessionStore.getAllModelPreferences(context.sessionID)
  
  if (prefs.length === 0) {
    return { output: "No model preferences configured" }
  }
  
  let output = "## 🎯 Session Model Preferences\n\n"
  output += "| Role | Model |\n"
  output += "|------|-------|\n"
  output += prefs.map(p => `| **${p.role}** | \`${p.model}\` |`).join("\n")
  
  return { output }
}
```

**What it does:**
1. Call `sessionStore.getAllModelPreferences()` → reads all from Layer 2
2. Format as markdown table
3. Return formatted output

---

### Action: "clear" (Lines 1847-1853)

**Code:**
```typescript
if (args.action === "clear") {
  sessionStore.clearModelPreference(context.sessionID, args.role)
  
  if (args.role) {
    return { output: `Cleared preference for role "${args.role}"` }
  }
  
  return { output: "Cleared all preferences" }
}
```

**What it does:**
1. Call `sessionStore.clearModelPreference()` → clears from Layer 2
2. Clear specific role or all roles

---

## 🔄 Complete Flow: Setting a Model Preference

```
USER ACTION:
-----------
agentic_model({ action: "set", role: "developer", model: "claude-sonnet-4" })

EXECUTION FLOW:
--------------
1. src/index.ts (Line 1824)
   → agentic_model tool receives request
   
2. src/index.ts (Line 1831)
   → sessionStore.setModelPreference(sessionID, "developer", "claude-sonnet-4")
   
3. src/memory/session-store.ts (Line 106)
   → Store in Map: sessions.get(sessionID).modelPreferences.set("developer", "claude-sonnet-4")
   
4. src/core/model-registry.ts
   → modelRegistry.addModel("claude-sonnet-4")
   → modelRegistry.registerAlias("developer", ["claude-sonnet-4"])

RESULT:
-------
✅ Model preference saved for current session
✅ Future delegations to "developer" will use "claude-sonnet-4"
✅ Other sessions NOT affected (session-scoped)
```

---

## 🔍 Complete Flow: Using Model During Delegation

```
USER ACTION:
-----------
agentic_delegate({ role: "developer", task: "Implement auth system" })

EXECUTION FLOW:
--------------
1. Check session preference
   → model = sessionStore.getModelPreference(sessionID, "developer")
   
2a. IF preference found (e.g., "claude-sonnet-4")
    → Use that model directly
    
2b. IF NO preference found
    → model = roleRegistry.suggestModel("developer", taskComplexity)
    → Returns default tier: "capable"
    
3. Resolve tier to actual model
   → "capable" → ["gpt-4o", "claude-sonnet-4", "gemini-1.5-pro"]
   → Select based on availability
   
4. Execute task with selected model
```

---

## 📊 Summary: 3-Layer Architecture

| Layer | File | Purpose | Scope |
|-------|------|---------|-------|
| **1. Default Tiers** | `role-registry.ts:44-50` | Hard-coded defaults | Global (all sessions) |
| **2. Session Prefs** | `session-store.ts:106-129` | Runtime preferences | Per-session |
| **3. Tool API** | `index.ts:1801-1857` | User interface | Per-session |

**Priority Order:**
1. Session preference (Layer 2) - **HIGHEST PRIORITY**
2. Default tier (Layer 1) - Fallback if no session preference
3. Model resolution - Tier → actual model name

---

## 💡 Key Takeaways

**Default configuration:**
- ✅ File: `src/agents/role-registry.ts` lines 44-50
- ✅ Can be changed via `setModel()` but NOT recommended (global)

**Session configuration:**
- ✅ File: `src/memory/session-store.ts` lines 106-129
- ✅ Per-session storage via `Map<role, model>`
- ✅ Accessed via `agentic_model` tool

**User interface:**
- ✅ File: `src/index.ts` lines 1801-1857
- ✅ Tool: `agentic_model` with 4 actions (set/get/list/clear)

**Best practice:**
- ✅ Use `agentic_model` tool for per-session overrides
- ❌ Don't modify `defaultModels` directly (global side effects)

---

**Generated:** 2026-06-16T09:40:28Z  
**Total Lines:** 298 (CHUNKED WRITE PROTOCOL compliant ✅)
