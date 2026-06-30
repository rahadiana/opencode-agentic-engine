# Tools Reference — 31 Agentic Tools

Semua tool menggunakan prefix `agentic_`. Daftar lengkap fungsi, parameter, dan contoh penggunaan.

---

## 🔍 Research & Navigation

### `agentic_nav`
Scan codebase untuk cari file relevan. Multi-language (TS/JS/Python/Go/Rust/PHP/Java).

**Parameters:**
| Parameter | Type | Default | Deskripsi |
|-----------|------|---------|-----------|
| `query` | string | — | Keyword/task description |
| `maxResults` | number | 10 | Max file return |
| `showSummary` | boolean | false | Tampilkan struktur project |

**Contoh:**
```
agentic_nav query="cari fungsi calculateTotal di module keuangan"
agentic_nav query="api route handler" maxResults=5
```

### `agentic_skill`
Extract, search, and reuse skills dari task sukses.

**Parameters:**
| Parameter | Type | Default | Deskripsi |
|-----------|------|---------|-----------|
| `action` | enum | — | extract/find/list/capability/clear |
| `query` | string | — | Search query / stepId / capability |

**Contoh:**
```
agentic_skill find query="refactor function to async"
agentic_skill extract query="step-3"   → extract skill dari step sukses
agentic_skill list
```

### `agentic_episodes`
Cari task serupa dari session sebelumnya (cross-session memory).

**Parameters:**
| Parameter | Type | Default | Deskripsi |
|-----------|------|---------|-----------|
| `action` | enum | — | search/recent/stats |
| `query` | string | — | Search query |
| `levels` | string[] | all | Memory levels |
| `minImportance` | number | 0 | Minimum importance threshold |

### `agentic_router`
Intent classifier. Keyword-based (fast) + LLM fallback.

**Parameters:**
| Parameter | Type | Default | Deskripsi |
|-----------|------|---------|-----------|
| `input` | string | — | User input to classify |
| `categories` | array | — | Custom categories |

### `agentic_rag`
Multi-index RAG dengan category segregation. Hybrid TF-IDF + vector search.

**Parameters:**
| Parameter | Type | Default | Deskripsi |
|-----------|------|---------|-----------|
| `action` | enum | — | search/store/stats/categories/list/clear |
| `query` | string | — | Search query |
| `category` | string | — | Category scope |

### `agentic_db`
SQLite database backend. Query, save, load, list, stats.

**Parameters:**
| Parameter | Type | Default | Deskripsi |
|-----------|------|---------|-----------|
| `action` | enum | — | query/save/load/list/stats/tables/migrate |
| `sql` | string | — | Raw SQL query |
| `namespace` | string | — | Namespace for save/load |

### `agentic_context`
View dan compress context window saat mendekati limit.

**Parameters:**
| Parameter | Type | Default | Deskripsi |
|-----------|------|---------|-----------|
| `action` | enum | — | view/compress |

### `agentic_tools`
Unified tool discovery di semua protocol (MCP + A2A).

**Parameters:**
| Parameter | Type | Default | Deskripsi |
|-----------|------|---------|-----------|
| `action` | enum | — | search/call/list/stats |
| `query` | string | — | Search keyword |
| `method` | string | — | Tool name to call |

---

## 📋 Planning & Decomposition

### `agentic_plan`
Breakdown goal ke subtasks terstruktur. 13 template rules + LLM auto-decompose.

**Parameters:**
| Parameter | Type | Default | Deskripsi |
|-----------|------|---------|-----------|
| `goal` | string | — | Goal/task description |
| `constraints` | string[] | — | Constraints |
| `relevantFiles` | string[] | — | Files relevant |
| `autoDecompose` | boolean | true | Auto-generate steps |
| `llmDecompose` | boolean | true | LLM-powered decomposition |
| `criticRefine` | boolean | false | PlannerCritic self-reflection |
| `subtasks` | array | — | Manual subtask definitions |

**Contoh:**
```
agentic_plan goal="Tambah fitur dark mode di komponen Header"
agentic_plan goal="Fix memory leak di websocket handler" constraints=["jangan ubah API", "test coverage >80%"]
```

### `agentic_parallel`
Dependency-based concurrency analysis + execution.

**Parameters:**
| Parameter | Type | Default | Deskripsi |
|-----------|------|---------|-----------|
| `action` | enum | — | analyze/execute |
| `abortOnFailure` | boolean | false | Stop all if one fails |

### `agentic_pipeline`
Define dan run multi-agent workflow pipeline.

**Parameters:**
| Parameter | Type | Default | Deskripsi |
|-----------|------|---------|-----------|
| `action` | enum | — | define/list/run/status/suggest |
| `pipelineId` | string | — | Pipeline ID |
| `stages` | array | — | Stage definitions (role, description, validation) |

**Contoh:**
```
agentic_pipeline suggest description="Buat fitur registrasi user"
agentic_pipeline define pipelineId="reg-1" stages=[...]
agentic_pipeline run pipelineId="reg-1"
```

---

## ⚡ Execution & Implementation

### `agentic_execute`
Tandai step selesai dengan auto-verify compile + hallucination check + skill extraction.

**Parameters:**
| Parameter | Type | Default | Deskripsi |
|-----------|------|---------|-----------|
| `stepId` | string | — | Step ID |
| `success` | boolean | — | Success status |
| `output` | string | — | Summary of what was done |
| `filesModified` | string[] | — | Files changed |
| `error` | string | — | Error message (if failed) |
| `autoVerify` | boolean | true | Auto-run compile check |
| `feedback` | enum | — | positive/negative |

### `agentic_delegate`
Assign task ke specialist agent (architect/developer/qa/coordinator/pm).

**Parameters:**
| Parameter | Type | Default | Deskripsi |
|-----------|------|---------|-----------|
| `taskId` | string | — | Unique task ID |
| `description` | string | — | Task description |
| `role` | enum | auto-detect | Target role |
| `context` | string | — | Additional context |

### `agentic_snapshot`
Checkpoint execution state. Save sebelum risky refactoring.

**Parameters:**
| Parameter | Type | Default | Deskripsi |
|-----------|------|---------|-----------|
| `action` | enum | — | save/list/restore |
| `label` | string | — | Label for save/restore |

### `agentic_status`
Dashboard eksekusi: progress bar, health, blocked steps.

**Parameters:** none

### `agentic_auto`
One-call autonomous loop: plan → execute → verify → retry. Plus memory + skills + guard + tech-debt.

**Parameters:**
| Parameter | Type | Default | Deskripsi |
|-----------|------|---------|-----------|
| `goal` | string | — | Task description |
| `constraints` | string[] | — | Constraints |
| `thorough` | boolean | true | Post-processing (guard, score) |
| `maxSteps` | number | auto | Max steps |

**Contoh:**
```
agentic_auto goal="Refactor semua fungsi callback di src/utils/ pake async/await"
```

---

## ✅ Quality & Verification

### `agentic_verify`
Multi-dimensi verification. 3-tier system.

**Parameters:**
| Parameter | Type | Default | Deskripsi |
|-----------|------|---------|-----------|
| `stepId` | string | — | Label |
| `projectDir` | string | worktree | Project directory |
| `tier` | enum | deep | fast/standard/deep |

**Tiers:**
| Tier | Checks |
|------|--------|
| `fast` | Compile only |
| `standard` | Compile + lint + test |
| `deep` | All + security + perf + arch + deps |

### `agentic_reflect`
Analisis error: kategori + propagation + recovery plan (termasuk Gap #5 ErrorRecovery).

**Parameters:**
| Parameter | Type | Default | Deskripsi |
|-----------|------|---------|-----------|
| `stepId` | string | — | Failed step ID |
| `errorDetails` | string | — | Stack trace / test output |
| `attemptedFix` | string | — | What was tried |

### `agentic_guard`
Manual hallucination guard. Auto-run di `agentic_execute`.

**Parameters:**
| Parameter | Type | Default | Deskripsi |
|-----------|------|---------|-----------|
| `stepId` | string | — | Step ID to verify |

### `agentic_score`
Technical debt analysis: coupling, file size, patterns.

**Parameters:**
| Parameter | Type | Default | Deskripsi |
|-----------|------|---------|-----------|
| `files` | string[] | all | Files to score |

### `agentic_debate`
Executor ↔ Critic multi-round debate. Otomatis fallback pattern.

**Parameters:**
| Parameter | Type | Default | Deskripsi |
|-----------|------|---------|-----------|
| `task` | string | — | Task/analysis question |
| `context` | string | — | Data/files context |
| `maxRounds` | number | 3 | Max rounds (max 5) |
| `format` | enum | json | markdown/json |
| `verbose` | boolean | false | Show real-time transcript |

---

## 🧠 Memory & Learning

### `agentic_evolve`
Self-evolution: inspect system, register custom roles, manage prompts, export training data.

**Parameters:**
| Parameter | Type | Default | Deskripsi |
|-----------|------|---------|-----------|
| `action` | enum | — | inspect/register-role/export-skill/evolve/read-prompt/edit-prompt/prompt-history/rollback-prompt/export-training-data |
| `name` | string | — | Role/skill name |
| `prompt` | string | — | Agent prompt |
| `spec` | string | — | Blueprint YAML/JSON |

### `agentic_finetune`
Convert skills → training data → upload OpenAI → monitor job.

**Parameters:**
| Parameter | Type | Default | Deskripsi |
|-----------|------|---------|-----------|
| `action` | enum | — | prepare/save/upload/create-job/status/list/cancel/full-pipeline |
| `source` | enum | combined | skills/episodes/combined |
| `format` | enum | openai | openai/instructions |
| `model` | string | — | Base model (e.g. gpt-4o-mini) |

### `agentic_model`
Set per-role/per-tool/per-category LLM model preferences.

**Parameters:**
| Parameter | Type | Default | Deskripsi |
|-----------|------|---------|-----------|
| `action` | enum | — | set/get/list/clear/reset/reset-stale/reset-all |
| `role` | string | — | Agent role |
| `tool` | string | — | Tool name |
| `category` | enum | — | quick/unspecified-low/unspecified-high/deep |
| `model` | string | — | Model name |

### `agentic_memo`
Second Brain: ADR decisions, TODOs, reflection, knowledge graph.

**Parameters:**
| Parameter | Type | Default | Deskripsi |
|-----------|------|---------|-----------|
| `action` | enum | — | decision/todo/todo-done/list/reflect/graph |

---

## 📤 Communication & Output

### `agentic_pr`
Generate PR description + create via GitHub CLI.

**Parameters:**
| Parameter | Type | Default | Deskripsi |
|-----------|------|---------|-----------|
| `action` | enum | generate | generate/create |
| `title` | string | — | PR title override |
| `baseBranch` | string | main | Base branch |

### `agentic_clean`
Strip debate artifacts, reformat markdown/json.

**Parameters:**
| Parameter | Type | Default | Deskripsi |
|-----------|------|---------|-----------|
| `text` | string | — | Raw text |
| `format` | enum | json | markdown/json/text |
| `schema` | string | — | Expected schema |
| `stripDebate` | boolean | true | Strip artifacts |

### `agentic_message`
Inter-agent messaging: send, inbox, conversation, review.

**Parameters:**
| Parameter | Type | Default | Deskripsi |
|-----------|------|---------|-----------|
| `action` | enum | — | send/inbox/conversation/mark-read |
| `to` | string | — | Recipient role |
| `message` | string | — | Content |
| `type` | enum | — | result/review_request/review_response/clarification/approval/revision |

### `agentic_mcp`
MCP client: connect ke external servers, discover & call tools.

**Parameters:**
| Parameter | Type | Default | Deskripsi |
|-----------|------|---------|-----------|
| `action` | enum | — | connect/list/call/disconnect/server-start/server-stop/server-status/server-restart |
| `transport` | enum | — | stdio/http |
| `command` | string | — | Executable path |
| `url` | string | — | Server URL |

### `agentic_a2a`
A2A (Agent-to-Agent) protocol: discover remote agents, delegate tasks, serve Agent Card.

**Parameters:**
| Parameter | Type | Default | Deskripsi |
|-----------|------|---------|-----------|
| `action` | enum | — | serve/stop/discover/delegate/list/ping/stats |
| `url` | string | — | Remote agent URL |
| `taskDescription` | string | — | Task to delegate |

### `agentic_budget`
Circuit breaker: token/steps/time/cost limits per scope.

**Parameters:**
| Parameter | Type | Default | Deskripsi |
|-----------|------|---------|-----------|
| `action` | enum | — | set/get/status/reset |
| `scope` | enum | session | session/task |
| `maxTokens` | number | — | Token limit |
| `maxSteps` | number | — | Steps limit |
| `maxTimeMs` | number | — | Time limit |
| `maxCostUsd` | number | — | Cost limit |
| `onExceeded` | enum | hard-stop | hard-stop/request-approval/warn |

---

## Model Resolution

3-level priority untuk menentukan model LLM:

```
1. Per-call explicit (req.model)
     ↓
2. Per-tool override (agentic_model set tool=...)
     ↓
3. Category by complexity (agentic_model set category=deep)
     ↓
4. Per-role (agentic_model set role=developer)
     ↓
5. Engine default (session model)
```

**Format model string:**
| Format | Contoh | providerID | modelID |
|--------|--------|-----------|---------|
| `"providerID/modelID"` | `"deepseek/deepseek-chat"` | deepseek | deepseek-chat |
| `"modelID"` | `"gpt-4o"` | opencode (auto) | gpt-4o |
