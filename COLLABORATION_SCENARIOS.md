# 🤝 Collaboration Scenarios — OpenCode Agentic Engine

> Panduan lengkap tool chaining patterns, multi-agent workflows, dan collaboration scenarios
> untuk 27 agentic_* tools. Referensi utama untuk autonomous software engineering.

---

## Daftar Isi

1. [Fundamental Tool Chains](#1-fundamental-tool-chains)
2. [Multi-Agent Collaboration](#2-multi-agent-collaboration)
3. [Learning & Memory](#3-learning--memory)
4. [Fine-Tuning Pipeline](#4-fine-tuning-pipeline)
5. [Observability & Evaluation](#5-observability--evaluation)
6. [Error Recovery Patterns](#6-error-recovery-patterns)
7. [Parallel Execution](#7-parallel-execution)
8. [Self-Evolution](#8-self-evolution)
9. [Complete Workflow Templates](#9-complete-workflow-templates)
10. [Tool Reference Matrix](#10-tool-reference-matrix)

---

## 1. Fundamental Tool Chains

### 1.1 Basic Plan → Execute → Verify

```
agentic_plan  →  agentic_execute  →  agentic_verify
```

**Use case**: Setiap task baru. Minimal viable chain.

```
Step 1: agentic_plan        — Decompose goal into subtasks
Step 2: agentic_execute     — Implement each subtask
Step 3: agentic_verify      — Compile + test verification
```

**Pattern**:
```json
// agentic_plan
{ "goal": "Add JWT middleware", "autoDecompose": true, "llmDecompose": true }

// agentic_execute (per step)
{ "stepId": "step-1", "success": true, "output": "...", "filesModified": ["src/middleware/jwt.ts"] }

// agentic_verify
{ "stepId": "verify-1" }
```

### 1.2 Research → Plan → Execute

```
agentic_nav  →  agentic_episodes  →  agentic_skill find  →  agentic_plan  →  agentic_execute
```

**Use case**: Task yang membutuhkan pemahaman codebase dulu.

```
Step 1: agentic_nav           — Scan codebase for relevant files
Step 2: agentic_episodes      — Search past similar tasks
Step 3: agentic_skill find    — Find proven patterns
Step 4: agentic_plan          — Plan with context
Step 5: agentic_execute       — Execute
```

**Pattern**:
```json
// agentic_nav
{ "query": "authentication middleware", "maxResults": 15 }

// agentic_episodes
{ "action": "search", "query": "JWT auth implementation" }

// agentic_skill find
{ "action": "find", "query": "middleware pattern" }
```

### 1.3 Plan → Execute → Reflect → Retry

```
agentic_plan  →  agentic_execute (fail)  →  agentic_reflect  →  agentic_execute (retry)
```

**Use case**: Error recovery. Chain standar untuk handle failure.

```
Step 1: agentic_plan        — Plan subtasks
Step 2: agentic_execute     — Execute (fails)
Step 3: agentic_reflect     — Analyze error + propagation
Step 4: agentic_execute     — Retry with fix
Step 5: agentic_verify      — Verify fix
```

**Pattern**:
```json
// agentic_reflect
{ "stepId": "step-2", "errorDetails": "TypeError: ..." }

// agentic_execute retry
{ "stepId": "step-2", "success": true, "output": "Fixed type error...", "filesModified": ["src/utils.ts"] }
```

### 1.4 Execute → Score → PR

```
agentic_execute  →  agentic_score  →  agentic_pr
```

**Use case**: Akhir sesi — generate PR dengan tech debt analysis.

```
Step 1: agentic_execute     — Complete all steps
Step 2: agentic_score       — Analyze tech debt
Step 3: agentic_pr          — Generate PR description
```

**Pattern**:
```json
// agentic_score
{ "files": ["src/middleware/jwt.ts", "src/utils/auth.ts"] }

// agentic_pr
{ "title": "Add JWT authentication middleware", "action": "generate" }
```

### 1.5 Execute → Skill Extract → Learn

```
agentic_execute (success)  →  agentic_skill  →  agentic_evolve
```

**Use case**: Continuous learning — simpan pola sukses sebagai skill.

```
Step 1: agentic_execute     — Complete with success
Step 2: agentic_skill       — Extract skill from step output
Step 3: agentic_evolve      — View extracted skill / export training data
```

**Pattern**:
```json
// agentic_skill extract
{ "action": "extract", "query": "step-1" }

// agentic_skill find
{ "action": "find", "query": "authentication" }

// agentic_evolve export training data
{ "action": "export-training-data", "format": "openai", "minSuccessRate": 0.5 }
```

---

## 2. Multi-Agent Collaboration

### 2.1 Delegate to Single Agent

```
agentic_delegate  →  agentic_message  →  agentic_delegate (result)
```

**Use case**: Assign task ke specific role (architect/developer/qa).

```
Step 1: agentic_delegate     — Assign task to developer
Step 2: agentic_message      — Check inbox for result
Step 3: agentic_delegate     — Mark done/failed with result
```

**Pattern**:
```json
// Assign to developer
{ "taskId": "dev-1", "role": "developer", "description": "Implement divide function in utils.ts" }

// Check result
{ "action": "inbox" }

// Mark as done
{ "taskId": "dev-1", "role": "developer", "description": "...", "status": "done", "result": "Implemented" }

// Request review from QA
{ "taskId": "dev-1", "role": "developer", "description": "...", "requestReview": true }
```

### 2.2 Pipeline: PM → Architect → Developer → QA

```
agentic_pipeline define  →  agentic_pipeline run  →  agentic_pipeline status
```

**Use case**: Full feature development dengan cross-validation antar stage.

```
Step 1: agentic_pipeline define  — Define 4-stage pipeline
Step 2: agentic_pipeline run     — Execute pipeline
Step 3: agentic_pipeline status  — Monitor progress
```

**Pattern**:
```json
// Define
{
  "action": "define",
  "pipelineId": "feature-auth",
  "name": "JWT Authentication",
  "stages": [
    { "role": "pm", "description": "Define acceptance criteria for JWT auth",
      "validationCriteria": ["Clear spec", "Edge cases defined"] },
    { "role": "architect", "description": "Design auth middleware architecture",
      "validationCriteria": ["Interface contracts defined", "Trade-offs documented"] },
    { "role": "developer", "description": "Implement JWT middleware + tests",
      "validationCriteria": ["All tests pass", "No regression"] },
    { "role": "qa", "description": "Review implementation for security",
      "validationCriteria": ["Security review passed", "Edge cases handled"] }
  ]
}

// Run
{ "action": "run", "pipelineId": "feature-auth" }

// Status
{ "action": "status" }
```

### 2.3 Agent Messaging + Review

```
agentic_delegate  →  agentic_message send  →  agentic_message inbox  →  agentic_message conversation
```

**Use case**: Inter-agent coordination dengan review requests.

```
Step 1: agentic_delegate       — Assign task + requestReview
Step 2: agentic_message send   — Send review request to QA
Step 3: agentic_message inbox  — Check QA response
Step 4: agentic_message conv   — View full thread
```

**Pattern**:
```json
// Send message
{ "action": "send", "to": "qa", "taskId": "dev-1",
  "message": "Please review the JWT middleware implementation",
  "type": "review_request" }

// Check inbox
{ "action": "inbox" }

// View conversation
{ "action": "conversation", "taskId": "dev-1" }

// Mark read
{ "action": "mark-read", "messageId": "msg-123" }
```

### 2.4 Auto-Suggest Pipeline

```
agentic_pipeline suggest  →  agentic_pipeline define  →  agentic_pipeline run
```

**Use case**: Auto-detect pipeline stages from task description.

```
Step 1: agentic_pipeline suggest  — Auto-suggest pipeline from goal
Step 2: agentic_pipeline define   — Customize suggested pipeline
Step 3: agentic_pipeline run      — Execute
```

**Pattern**:
```json
// Suggest
{ "action": "suggest", "description": "Add Redis caching layer with TTL eviction" }

// Pipeline suggestion output:
// {"name":"caching-layer","stages":[
//   {"role":"pm","description":"Define caching requirements"},
//   {"role":"architect","description":"Design cache invalidation strategy"},
//   {"role":"developer","description":"Implement CacheService"},
//   {"role":"qa","description":"Benchmark and verify correctness"}
// ]}
```

### 2.5 Parallel Delegation Model

```
agentic_plan  →  agentic_parallel analyze  →  agentic_delegate (parallel)  →  agentic_execute (parallel)
```

**Use case**: Mengeksekusi subtasks independen secara paralel.

```
Step 1: agentic_plan              — Plan with dependencies
Step 2: agentic_parallel analyze  — Identify parallel-ready tasks
Step 3: agentic_delegate x N      — Delegate parallel tasks
Step 4: agentic_execute           — Execute with auto-parallel
```

**Pattern**:
```json
// agentic_parallel analyze
{ "action": "analyze" }

// Output: parallel plan with sorted tasks
{
  "batches": [
    ["step-1"],           // batch 0: no deps
    ["step-2", "step-3"], // batch 1: parallel after step-1
    ["step-4"]            // batch 2: depends on step-2 + step-3
  ]
}
```

---

## 3. Learning & Memory

### 3.1 Skill Lifecycle

```
agentic_skill extract  →  agentic_skill find  →  agentic_skill list
```

**Use case**: Extract reusable patterns from success → reuse later.

```
Step 1: agentic_skill extract   — Extract skill from step output
Step 2: agentic_skill find      — Search skills by keyword
Step 3: agentic_skill list      — View all skills sorted by success rate
```

**Pattern**:
```json
// Extract from completed step
{ "action": "extract", "query": "step-f6" }

// Find relevant skill
{ "action": "find", "query": "feature flags middleware" }

// List all
{ "action": "list" }
```

### 3.2 Episodic Memory

```
agentic_episodes search  →  agentic_episodes recent  →  agentic_episodes stats
```

**Use case**: Cross-session memory — learn from past success/failure.

```
Step 1: agentic_episodes search  — Search past tasks
Step 2: agentic_episodes recent  — View latest sessions
Step 3: agentic_episodes stats   — Memory statistics
```

**Pattern**:
```json
{ "action": "search", "query": "caching redis" }
{ "action": "recent" }
{ "action": "stats" }
```

### 3.3 Multi-Index RAG

```
agentic_router  →  agentic_rag search  →  agentic_rag store (after completion)
```

**Use case**: Knowledge retrieval dengan category segregation.

```
Step 1: agentic_router       — Classify intent + route to category
Step 2: agentic_rag search   — Search relevant knowledge
Step 3: agentic_rag store    — Store new knowledge after task done
```

**Pattern**:
```json
// Classify intent
{ "input": "How to implement Redis caching with TTL?" }

// Search in relevant categories
{ "action": "search", "query": "Redis TTL caching", "category": "backend" }

// Store new episode
{ "action": "store", "title": "Redis Cache Implementation", 
  "content": "Use CacheService with TTL...", "type": "episode" }

// View all categories
{ "action": "categories" }
```

### 3.4 Snapshot Checkpoints

```
agentic_snapshot save  →  ...execute steps...  →  agentic_snapshot restore
```

**Use case**: Save state before risky operation, restore if needed.

```
Step 1: agentic_snapshot save     — Save checkpoint "before-refactor"
Step 2: agentic_execute           — Try refactor (fails)
Step 3: agentic_snapshot restore  — Rollback to checkpoint
```

**Pattern**:
```json
{ "action": "save", "label": "before-auth-refactor" }
{ "action": "list" }
{ "action": "restore", "label": "before-auth-refactor" }
```

---

## 4. Fine-Tuning Pipeline

### 4.1 From Skills to Training Data

```
agentic_skill list  →  agentic_evolve export-training-data  →  agentic_finetune
```

**Use case**: Convert extracted skills into fine-tuning dataset.

```
Step 1: agentic_skill list               — Review available skills
Step 2: agentic_evolve export-training   — Export as OpenAI JSONL
Step 3: agentic_finetune prepare         — Verify dataset quality
Step 4: agentic_finetune upload          — Upload to OpenAI
Step 5: agentic_finetune create-job      — Start fine-tuning
```

**Pattern**:
```json
// Export training data
{ "action": "export-training-data", "format": "openai", "minSuccessRate": 0.7 }

// Or via agentic_finetune full pipeline
{ "action": "full-pipeline", "format": "openai", "minQuality": 0.7,
  "model": "gpt-4o-mini-2024-07-18", "suffix": "opencode-v1", "epochs": 3 }

// Check job status
{ "action": "status", "jobId": "ftjob-abc123" }

// List all jobs
{ "action": "list" }

// Cancel job
{ "action": "cancel", "jobId": "ftjob-abc123" }
```

### 4.2 Combined Dataset (Skills + Episodes)

```
agentic_finetune full-pipeline
```

**Use case**: Prepare combined dataset dari skills + episodes.

```json
{ "action": "full-pipeline", "source": "combined", "format": "openai",
  "minQuality": 0.5, "outputPath": "/tmp/training-data.jsonl" }
```

### 4.3 Export Instructions Format

```
agentic_evolve export-training-data  →  (use for local training)
```

**Use case**: Export dalam format instructions untuk local fine-tuning.

```json
{ "action": "export-training-data", "format": "instructions", "minSuccessRate": 0.8 }
```

---

## 5. Observability & Evaluation

### 5.1 Real-Time Dashboard

```
agentic_dashboard  →  agentic_status
```

**Use case**: Monitor execution health, detect anomalies.

```
Step 1: agentic_dashboard    — Timeline + stats + anomaly detection
Step 2: agentic_status       — Execution dashboard + blocked steps
```

**Pattern**:
```json
// Dashboard
{}

// Status
{}
```

### 5.2 Context Management

```
agentic_context view  →  agentic_context compress
```

**Use case**: Monitor context usage, compress when nearing limits.

```
Step 1: agentic_context view      — Check context stats (tokens, messages)
Step 2: agentic_context compress  — Generate compressed context prompt
```

**Pattern**:
```json
{ "action": "view" }
{ "action": "compress" }
```

### 5.3 Hallucination Guard

```
agentic_guard (manual re-check)
```

**Use case**: Verify file/function/import claims after execution.
> NOTE: Guard auto-runs on every `agentic_execute` success. Only manual if auto-check was disabled.

```json
{ "stepId": "step-1" }
```

### 5.4 Live Evaluation

```
agentic_auto  →  (evaluation happens automatically)
```

**Use case**: 5-dimensi real-time scoring (taskSuccess, errorRecovery, contextStability, multiAgent, skillReuse).
Terintegrasi otomatis dengan `agentic_execute`, `agentic_delegate`, dan `agentic_nav`.

---

## 6. Error Recovery Patterns

### 6.1 Failed Execution → Reflect → Retry

```
agentic_execute (fail)  →  agentic_reflect  →  agentic_execute (retry)  →  agentic_verify
```

**Pattern**:
```json
// Execute fails
{ "stepId": "step-1", "success": false, "output": "...",
  "error": "TypeError: Cannot read property 'expiresAt' of undefined" }

// Reflect analyzes error
{ "stepId": "step-1" }

// Retry with fix
{ "stepId": "step-1", "success": true, "output": "Fixed: added null check...",
  "filesModified": ["src/models/SessionModel.ts"] }

// Verify
{ "stepId": "verify-1" }
```

### 6.2 Budget Overrun Recovery

```
agentic_budget status  →  agentic_budget set  →  agentic_snapshot restore
```

**Pattern**:
```json
// Check budget
{ "action": "status" }

// Reset limits
{ "action": "reset", "scope": "task" }

// Set new limits
{ "action": "set", "maxSteps": 10, "maxTokens": 50000 }

// Restore from checkpoint
{ "action": "restore", "label": "before-expensive-operation" }
```

### 6.3 Model Degradation Recovery

```
agentic_model_reset  →  agentic_model list
```

**Pattern**:
```json
// Reset stale models
{ "action": "reset-stale", "staleDays": 7 }

// Or emergency reset all
{ "action": "reset-all" }
```

---

## 7. Parallel Execution

### 7.1 Dependency-Based Concurrency

```
agentic_plan  →  agentic_parallel analyze  →  agentic_parallel execute
```

**Pattern**:
```json
// Plan with dependencies
{ "goal": "Refactor validation", "subtasks": [
  { "id": "v1", "description": "Create validation.ts" },
  { "id": "v2", "description": "Refactor middleware", "dependsOn": ["v1"] },
  { "id": "v3", "description": "Update controllers", "dependsOn": ["v1"] },
  { "id": "v4", "description": "Remove duplicates", "dependsOn": ["v2", "v3"] }
]}

// Analyze parallelism
{ "action": "analyze" }
// → v2 and v3 are parallel-ready after v1

// Execute parallel phase
{ "action": "execute", "abortOnFailure": false }
```

### 7.2 Parallel Delegate Pattern

```
agentic_plan  →  agentic_delegate (batch)  →  agentic_status
```

**Pattern**:
```json
// Delegate multiple tasks in parallel to different roles
agentic_delegate: { "taskId": "arch-1", "role": "architect", "description": "Design API contracts" }
agentic_delegate: { "taskId": "dev-1", "role": "developer", "description": "Implement core logic" }
agentic_delegate: { "taskId": "qa-1", "role": "qa", "description": "Plan test strategy" }

// Check status after delegation
agentic_status: {}
```

---

## 8. Self-Evolution

### 8.1 Inspect System

```
agentic_evolve inspect
```

**Pattern**:
```json
{ "action": "inspect" }
// → Current schema version, registered roles, tools, event types
```

### 8.2 Register Custom Agent Role

```
agentic_evolve register-role
```

**Pattern**:
```json
{ "action": "register-role", "name": "security-auditor",
  "prompt": "You are a security auditor. Review code for OWASP Top 10...",
  "tools": ["read", "grep", "agentic_verify", "agentic_delegate"] }
```

### 8.3 Prompt Evolution

```
agentic_evolve read-prompt  →  agentic_evolve edit-prompt  →  agentic_evolve prompt-history
```

**Pattern**:
```json
// Read current prompt
{ "action": "read-prompt", "role": "developer" }

// Edit prompt (append instruction)
{ "action": "edit-prompt", "role": "developer", 
  "prompt": "Always add error boundaries to all async functions",
  "description": "Add error boundary requirement" }

// View history
{ "action": "prompt-history", "role": "developer" }

// Rollback
{ "action": "rollback-prompt", "role": "developer", "version": 2 }
```

### 8.4 Export Skill as Self-Describing Format

```
agentic_evolve export-skill
```

**Pattern**:
```json
{ "action": "export-skill", "skillId": "skill-abc-123" }
// → Self-describing agentic-skill/v1 JSON
```

---

## 9. Complete Workflow Templates

### 9.1 Feature Development (Single Agent)

```
1. agentic_nav           — "authentication system files"
2. agentic_episodes      — "auth middleware patterns"
3. agentic_skill find    — "JWT middleware"
4. agentic_plan          — goal: "Add JWT middleware with refresh tokens"
5. agentic_execute       — per subtask
6. agentic_verify        — compile + tests
7. agentic_score         — tech debt analysis
8. agentic_skill extract — save as reusable skill
9. agentic_pr            — generate PR
```

### 9.2 Feature Development (Multi-Agent Pipeline)

```
1. agentic_pipeline suggest  — "Add Redis caching layer"
2. agentic_pipeline define   — customize stages
3. agentic_pipeline run      — auto-executes all stages:
   a. PM:    Define caching requirements
   b. Arch:  Design cache invalidation strategy
   c. Dev:   Implement CacheService + tests
   d. QA:    Review + benchmark
4. agentic_pipeline status   — check completion
5. agentic_verify            — final verification
6. agentic_skill extract     — extract caching pattern
7. agentic_pr                — generate PR with all cross-validation results
```

### 9.3 Bug Fix (Error Recovery)

```
1. agentic_nav           — "bug report: session expiry"
2. agentic_plan          — fix race condition
3. agentic_snapshot save — checkpoint before fix
4. agentic_execute       — try fix (might fail)
5. agentic_reflect       — analyze error + propagation
6. agentic_execute retry — apply fix
7. agentic_verify        — all tests pass
8. agentic_score         — check for tech debt
9. agentic_episodes      — (auto-recorded) learn from fix
```

### 9.4 Code Review Session

```
1. agentic_plan          — goal: "Review PR #42"
2. agentic_guard         — check claims in each step
3. agentic_debate        — executor vs critic deep analysis
4. agentic_clean         — format debate output
5. agentic_score         — tech debt of changes
6. agentic_pr            — generate review summary
7. agentic_message       — send review result to developer
```

### 9.5 Learning & Fine-Tuning Session

```
1. agentic_skill extract   — Extract skills from successful tasks
2. agentic_evolve export   — Export as training data
3. agentic_finetune upload — Upload to OpenAI
4. agentic_finetune create — Start fine-tuning job
5. agentic_finetune status — Monitor job progress
6. agentic_model set       — Assign fine-tuned model to role
```

### 9.6 Emergency Recovery

```
1. agentic_status          — identify blocked steps
2. agentic_budget status   — check remaining budget
3. agentic_context compress — free up context space
4. agentic_model_reset     — recover from degraded model
5. agentic_snapshot restore — rollback to last good state
6. agentic_reflect         — analyze what went wrong
7. agentic_auto            — resume with learnings
```

### 9.7 Autonomous Loop (Stage V)

```
agentic_auto (single call replaces all of the above)
```

```json
{ "goal": "Add rate limiting middleware using Redis",
  "constraints": ["TypeScript", "Express", "ioredis"],
  "thorough": true,
  "maxSteps": 8 }
```

`agentic_auto` handles: memory → skills → architecture → code → guard → verify → score → learn

---

## 10. Tool Reference Matrix

### Chaining Compatibility

| Tool | Can chain after | Triggers auto | Produces output for |
|------|----------------|---------------|-------------------|
| `agentic_plan` | nav, episodes, skill | event: plan.created | execute, delegate, pipeline |
| `agentic_execute` | plan, reflect, delegate | event: step.completed, guard.check.completed, skill.extracted | verify, skill, score, pr |
| `agentic_reflect` | execute (fail) | event: step.failed | execute (retry) |
| `agentic_verify` | execute | - | pr, score |
| `agentic_nav` | - | - | plan |
| `agentic_context` | any | - | compress context |
| `agentic_snapshot` | any (save), after fail (restore) | - | plan |
| `agentic_pr` | execute, verify | - | PR on GitHub |
| `agentic_score` | execute | - | pr, quality report |
| `agentic_delegate` | plan, pipeline | event: task.delegated | message, pipeline |
| `agentic_pipeline` | plan, delegate | event: pipeline.stage.completed | status, pr |
| `agentic_message` | delegate | event: task.completed | delegate (review) |
| `agentic_parallel` | plan | - | execute (parallel) |
| `agentic_skill` | execute (success) | - | evolve, find |
| `agentic_episodes` | any | - | plan, context |
| `agentic_model` | any | - | llm engine |
| `agentic_budget` | any | event: budget.limit.exceeded | execute (block) |
| `agentic_dashboard` | any | - | observability |
| `agentic_guard` | execute | - | audit report |
| `agentic_evolve` | any | - | system evolution |
| `agentic_auto` | - | - | everything |
| `agentic_debate` | complex analysis | - | clean output |
| `agentic_router` | classification | - | rag search |
| `agentic_clean` | debate, analysis | - | formatted output |
| `agentic_rag` | router, store | - | plan, context |
| `agentic_mcp` | any | - | external tools |
| `agentic_finetune` | skill, episodes | - | fine-tuned model |
| `agentic_model_reset` | any | - | model degradation recovery |

### Role → Tool Access Matrix

| Agent Role | Primary Tools | Best For |
|-----------|--------------|----------|
| **pm** | plan, nav, delegate, episodes, read | Requirements, specs, acceptance criteria |
| **architect** | read, grep, glob, nav, score, delegate, skill | Architecture decisions, interface contracts |
| **developer** | read, edit, write, bash, glob, grep, skill | Implementation, tests, refactoring |
| **qa** | read, glob, grep, bash, verify, skill | Code review, security, edge cases |
| **coordinator** | plan, delegate, status, skill | Orchestration, tracking, delegation |
| **analyst** | read, plan, nav, episodes | Requirements analysis |
| **builder** | read, edit, write, bash, glob, grep, skill | Creating artifacts from plan |
| **reviewer** | read, glob, grep, verify, skill | Quality review |

---

## Quick Reference Card

```
┌─────────────────────────────────────────────────────────┐
│                    CHAIN QUICK REFERENCE                 │
├─────────────────────────────────────────────────────────┤
│ NEW FEATURE (single):                                   │
│   plan → execute → verify → score → skill → pr          │
│                                                         │
│ NEW FEATURE (multi-agent):                              │
│   pipeline(suggest) → pipeline(define) → pipeline(run)  │
│     → verify → skill → pr                               │
│                                                         │
│ BUG FIX:                                                │
│   nav → plan → execute → reflect → execute → verify     │
│                                                         │
│ CODE REVIEW:                                            │
│   plan → guard → debate → clean → score → pr            │
│                                                         │
│ FINE-TUNE:                                              │
│   skill(list) → evolve(export) → finetune(full)         │
│                                                         │
│ RECOVERY:                                               │
│   status → budget → context(compress) → snapshot(restore)│
│                                                         │
│ AUTO (ALL-IN-ONE):                                      │
│   auto({goal, constraints, thorough: true})              │
└─────────────────────────────────────────────────────────┘
```
