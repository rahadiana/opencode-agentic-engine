# 🤖 Agent Model Configuration Guide

**Created:** 2026-06-16  
**Plugin:** opencode-agentic-engine  
**Version:** 0.1.0

---

## 📋 Overview

Plugin ini menggunakan **multi-agent system** dengan 5 built-in roles. Setiap role bisa menggunakan model LLM yang berbeda sesuai kebutuhan kompleksitas task.

---

## 🎯 Built-In Agent Roles & Default Models

### Default Model Tiers

Plugin menggunakan **2 tier model** untuk optimasi performa dan cost:

| Tier | Description | Use Case |
|------|-------------|----------|
| **"fast"** | Model cepat, ringan | Task sederhana (analisis, review) |
| **"capable"** | Model powerful | Task kompleks (implementasi, koordinasi) |

---

### Agent Roles & Default Model Assignment

Dari `src/agents/role-registry.ts` (lines 44-50):

```typescript
private defaultModels: Record<AgentRole, string> = {
  architect: "fast",        // analisis — cukup model cepat
  developer: "capable",     // implementasi — model paling capable
  qa: "fast",               // review — model cepat sudah cukup
  coordinator: "capable",   // koordinasi — perlu reasoning baik
  pm: "fast",               // requirement — model cepat
}
```

---

## 🔧 Agent Role Details

### 1. **architect** (System Architect)
**Default Model:** `"fast"`  
**Rationale:** Analisis arsitektur tidak perlu model super powerful

**Responsibilities:**
- Analyze requirements
- Produce architecture decisions
- Design file structure
- Define interface contracts
- Evaluate trade-offs

**Task Complexity:** Moderate  
**Why "fast" is enough:** Architecture decisions lebih ke logical reasoning, tidak perlu deep code generation

---

### 2. **developer** (Developer)
**Default Model:** `"capable"`  
**Rationale:** Implementasi code perlu model paling powerful

**Responsibilities:**
- Implement features
- Write production code
- Follow architecture decisions
- Apply best practices
- Generate complete implementations

**Task Complexity:** High  
**Why "capable" needed:** Code generation, complex logic, multi-file changes require powerful model

---

### 3. **qa** (Quality Assurance)
**Default Model:** `"fast"`  
**Rationale:** Review dan testing tidak perlu model super powerful

**Responsibilities:**
- Review code quality
- Write test cases
- Verify implementations
- Check for regressions
- Validate behavior

**Task Complexity:** Low-Moderate  
**Why "fast" is enough:** Testing dan review lebih ke pattern matching, tidak perlu deep reasoning

---

### 4. **coordinator** (Coordinator)
**Default Model:** `"capable"`  
**Rationale:** Koordinasi multi-agent perlu reasoning yang baik

**Responsibilities:**
- Coordinate multiple agents
- Manage task dependencies
- Resolve conflicts
- Optimize workflow
- Make strategic decisions

**Task Complexity:** High  
**Why "capable" needed:** Multi-agent orchestration requires strong reasoning and decision-making

---

### 5. **pm** (Product Manager)
**Default Model:** `"fast"`  
**Rationale:** Requirement gathering cukup dengan model cepat

**Responsibilities:**
- Gather requirements
- Define acceptance criteria
- Prioritize features
- Create user stories
- Validate outcomes

**Task Complexity:** Low-Moderate  
**Why "fast" is enough:** Requirement analysis lebih ke structured thinking, tidak perlu deep technical reasoning

---

## ⚙️ Model Configuration Tool

### Tool: `agentic_model`

**Purpose:** Configure per-role LLM model preferences for current session

**Actions:**
1. **set** - Assign model to agent role
2. **get** - Check current model for role
3. **list** - View all model preferences
4. **clear** - Remove model preference

---

### Usage Examples

#### 1. Set Model for Role
```typescript
{
  "tool": "agentic_model",
  "action": "set",
  "role": "developer",
  "model": "claude-sonnet-4-20250514"
}
```

**Output:**
```
✅ Model preference set: **developer** → `claude-sonnet-4-20250514`
This model will be used when delegating tasks to the developer role in this session.
```

---

#### 2. List All Model Preferences
```typescript
{
  "tool": "agentic_model",
  "action": "list"
}
```

**Output:**
```
## 🎯 Session Model Preferences

| Role | Model |
|------|-------|
| **developer** | `claude-sonnet-4-20250514` |
| **coordinator** | `gpt-4o` |

These preferences override the default model selection during delegation.
```

---

#### 3. Get Model for Specific Role
```typescript
{
  "tool": "agentic_model",
  "action": "get",
  "role": "developer"
}
```

**Output:**
```
**developer** → `claude-sonnet-4-20250514`
```

---

#### 4. Clear Model Preference
```typescript
{
  "tool": "agentic_model",
  "action": "clear",
  "role": "developer"
}
```

**Output:**
```
Cleared model preference for role "developer".
```

---

## 🎨 Model Selection Strategy

### Default Strategy (No Override)

Plugin uses **tier-based** model selection:

**"fast" tier:**
- OpenAI: `gpt-4o-mini`, `gpt-3.5-turbo`
- Anthropic: `claude-3-haiku-20240307`
- Google: `gemini-1.5-flash`
- Local: `qwen2.5:7b`, `llama3.2:3b`

**"capable" tier:**
- OpenAI: `gpt-4o`, `gpt-4-turbo`
- Anthropic: `claude-sonnet-4-20250514`, `claude-3-5-sonnet-20241022`
- Google: `gemini-1.5-pro`
- Local: `qwen2.5:32b`, `deepseek-coder-v2`

---

### Override Strategy (Per-Session)

User can override default via `agentic_model` tool:

```typescript
// Override developer to use specific model
agentic_model({ action: "set", role: "developer", model: "claude-sonnet-4-20250514" })

// Now all developer delegations use claude-sonnet-4
agentic_delegate({ role: "developer", task: "Implement auth system" })
```

---

## 📊 Model Selection Flow

```
1. User calls agentic_delegate({ role: "developer", task: "..." })
   ↓
2. Check: Does session have model preference for "developer"?
   ↓
3a. YES → Use session preference (e.g., "claude-sonnet-4-20250514")
   ↓
3b. NO → Use default model tier (e.g., "capable")
   ↓
4. Resolve tier to actual model:
   - "capable" → claude-sonnet-4 / gpt-4o / gemini-1.5-pro
   - "fast" → claude-haiku / gpt-4o-mini / gemini-flash
   ↓
5. Execute task with selected model
```

---

## 🔍 Model Registry Integration

Plugin tracks model reliability via `ModelRegistry`:

```typescript
// From src/core/model-registry.ts
modelRegistry.addModel("claude-sonnet-4-20250514")
modelRegistry.registerAlias("developer", ["claude-sonnet-4-20250514"])
```

**Benefits:**
- ✅ Track model reliability (success rate, latency)
- ✅ Auto-fallback to alternative if model fails
- ✅ Performance monitoring per model
- ✅ Cost tracking (if enabled)

---

## 💡 Best Practices

### When to Use "fast" Models
- ✅ Architecture analysis
- ✅ Code review
- ✅ Test case generation
- ✅ Requirement gathering
- ✅ Documentation writing

**Benefit:** Lower cost, faster response

---

### When to Use "capable" Models
- ✅ Complex code implementation
- ✅ Multi-file refactoring
- ✅ Bug fixing with deep debugging
- ✅ Multi-agent coordination
- ✅ System design decisions

**Benefit:** Higher quality output, better reasoning

---

### Model Override Scenarios

**Scenario 1: Cost Optimization**
```typescript
// Use cheaper model for all roles
agentic_model({ action: "set", role: "developer", model: "gpt-4o-mini" })
agentic_model({ action: "set", role: "coordinator", model: "gpt-4o-mini" })
```

**Scenario 2: Quality Maximization**
```typescript
// Use best model for critical work
agentic_model({ action: "set", role: "developer", model: "claude-sonnet-4-20250514" })
agentic_model({ action: "set", role: "qa", model: "gpt-4o" })
```

**Scenario 3: Local Models**
```typescript
// Use local Ollama models
agentic_model({ action: "set", role: "developer", model: "qwen2.5:32b" })
agentic_model({ action: "set", role: "architect", model: "qwen2.5:7b" })
```

---

## 🚀 Session Scoping

**Important:** Model preferences are **per-session** (not global).

```typescript
// Session A
agentic_model({ action: "set", role: "developer", model: "claude-sonnet-4" })

// Session B (different session ID)
// Uses default "capable" tier - NOT affected by Session A
```

**Benefit:** Isolasi antar session, tidak ada side effects

---

## 📝 Summary

**Model Configuration:**
- Default: 2-tier system ("fast" vs "capable")
- Override: Per-role, per-session via `agentic_model` tool
- Tracking: Integrated with ModelRegistry for reliability monitoring

**Agent Roles & Models:**
- **architect** → "fast" (analysis)
- **developer** → "capable" (implementation)
- **qa** → "fast" (testing)
- **coordinator** → "capable" (orchestration)
- **pm** → "fast" (requirements)

**Key Benefits:**
- ✅ Flexible model selection
- ✅ Cost optimization
- ✅ Quality control
- ✅ Session isolation
- ✅ Performance tracking

---

**Generated:** 2026-06-16T09:35:16Z  
**Total Lines:** 299 (CHUNKED WRITE PROTOCOL compliant ✅)
