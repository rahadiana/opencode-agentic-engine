# OpenCode Agentic Engine — Tools Reference

> **25 specialized tools** for autonomous software engineering.  
> Plugin version: `0.4.0`

---

## Tool Preference Hierarchy

Use agentic_* tools **FIRST** for any software engineering task. Fall back to built-in tools only when no agentic_* tool fits.

---

## Stage I — Core Engineering Loop

### `agentic_plan`
Create a structured execution plan. Auto-decomposes feature requests using built-in templates (create/implement, fix/bug, refactor, test, deploy, migrate, doc, perf). Template-based by default (fast, 0ms). Use `llmDecompose: true` for AI-powered decomposition.

| Parameter | Type | Description |
|-----------|------|-------------|
| `goal` | string (required) | The overall goal of the task |
| `constraints` | string[] | Constraints or requirements |
| `relevantFiles` | string[] | Files relevant to this task |
| `autoDecompose` | boolean | Auto-decompose into subtasks (default: true) |
| `llmDecompose` | boolean | Use LLM for decomposition (default: false) |
| `subtasks` | object[] | Manual subtask list (optional) |

**Example:**
```
agentic_plan goal="Add user authentication with JWT"
```

---

### `agentic_execute`
Record completion of a subtask. Auto-verifies compilation on success. Includes error recovery guidance + error propagation analysis on failure. Supports user feedback for continuous learning.

| Parameter | Type | Description |
|-----------|------|-------------|
| `stepId` | string (required) | The ID of the step that was executed |
| `success` | boolean (required) | Whether the step completed successfully |
| `output` | string (required) | Summary of what was done |
| `filesModified` | string[] | List of files modified or created |
| `error` | string | Error message if the step failed |
| `autoVerify` | boolean | Auto-run compile verification (default: true when success=true) |
| `feedback` | "positive" \| "negative" | User feedback for continuous learning |

**Example:**
```
agentic_execute stepId="step-1" success=true output="Created auth.js with JWT" filesModified=["auth.js"]
```

---

### `agentic_reflect`
Analyze a failed step. Diagnoses the error category, traces error propagation across the step chain, and suggests a recovery plan.

| Parameter | Type | Description |
|-----------|------|-------------|
| `stepId` | string (required) | The ID of the failed step to analyze |
| `errorDetails` | string | Additional error context (full stack trace, test output, etc.) |
| `attemptedFix` | string | What you tried to fix the error (if any) |

**Example:**
```
agentic_reflect stepId="step-2" errorDetails="Cannot find module 'jsonwebtoken'"
```

---

### `agentic_verify`
Run full verification: compile + lint + test suite. Auto-detects language (TypeScript, Python, Go, Rust, JavaScript). Includes error analysis on failure.

| Parameter | Type | Description |
|-----------|------|-------------|
| `stepId` | string | Label for this verification |
| `projectDir` | string | Project directory (default: worktree) |

**Example:**
```
agentic_verify
```

---

### `agentic_status`
Show execution dashboard: progress bar, health, blocked steps, dependency graph, retry history, and file change summary.

| Parameter | Type | Description |
|-----------|------|-------------|
| *(none)* | | |

**Example:**
```
agentic_status
```

---

## Stage II — Codebase & Context

### `agentic_nav`
Scan the project codebase and find relevant files for a task. Use this to understand the project structure before planning, or to find which files to modify.

| Parameter | Type | Description |
|-----------|------|-------------|
| `query` | string (required) | What you're looking for |
| `maxResults` | number | Maximum number of files to return (default: 10) |
| `showSummary` | boolean | Show full project structure summary |

**Example:**
```
agentic_nav query="authentication middleware" showSummary=true
```

---

### `agentic_context`
View and compress the execution context. When approaching context limits, summarizes the conversation history into a compact form preserving key decisions, file changes, and invariants.

| Parameter | Type | Description |
|-----------|------|-------------|
| `action` | "view" \| "compress" (required) | View stats or compress context |

**Example:**
```
agentic_context action="view"
```

---

### `agentic_snapshot`
Save or restore execution snapshots. Use 'save' to checkpoint current state (plan progress, file changes, decisions). Use 'list' to see all snapshots.

| Parameter | Type | Description |
|-----------|------|-------------|
| `action` | "save" \| "list" (required) | Save checkpoint or list snapshots |
| `label` | string | Optional label for the snapshot |

**Example:**
```
agentic_snapshot action="save" label="after-auth"
```

---

### `agentic_pr`
Generate a pull request description from the execution plan, all step results, and files changed. Use `action: 'create'` to actually open a PR via GitHub CLI (`gh`).

| Parameter | Type | Description |
|-----------|------|-------------|
| `action` | "generate" \| "create" | Generate PR body or create PR (default: generate) |
| `title` | string | Override the PR title |
| `baseBranch` | string | Base branch for PR creation (default: main) |

**Example:**
```
agentic_pr action="generate"
```

---

### `agentic_score`
Score the current changeset for technical debt. Analyzes coupling, file size, scope, and code patterns. Use before completing to ensure code quality.

| Parameter | Type | Description |
|-----------|------|-------------|
| `files` | string[] | Specific files to score (defaults to all modified files) |

**Example:**
```
agentic_score files=["src/auth.ts", "src/server.ts"]
```

---

### `agentic_model`
Configure per-role LLM model preferences for the current session. Use 'set' to assign a model to an agent role. Use 'get' to see current assignment. Use 'list' to view all preferences. Use 'clear' to remove a preference.

| Parameter | Type | Description |
|-----------|------|-------------|
| `action` | "set" \| "get" \| "list" \| "clear" (required) | Action to perform |
| `role` | string | Agent role (architect, developer, qa, coordinator, pm) |
| `model` | string | Model name (e.g. 'gpt-4o', 'claude-sonnet-4-20250514') |

**Example:**
```
agentic_model action="set" role="developer" model="gpt-4o"
```

---

### `agentic_model_reset`
Reset model statistics to recover from degraded performance. Use 'reset' to clear stats for a specific model. Use 'reset-stale' to auto-reset models not used in 7+ days. Use 'reset-all' for emergency recovery.

| Parameter | Type | Description |
|-----------|------|-------------|
| `action` | "reset" \| "reset-stale" \| "reset-all" (required) | Action to perform |
| `model` | string | Model name (required for 'reset' action) |
| `staleDays` | number | Days threshold for stale detection (default: 7) |

**Example:**
```
agentic_model_reset action="reset" model="gpt-4o"
```

---

## Stage III — Multi-Agent & Memory

### `agentic_delegate`
Assign a task to a specialized agent role (architect/developer/qa/coordinator/pm). Supports pipeline-aware delegation with cross-validation between stages and inter-agent messaging.

| Parameter | Type | Description |
|-----------|------|-------------|
| `taskId` | string (required) | Unique ID for this delegated task |
| `description` | string (required) | What this agent should do |
| `role` | "architect" \| "developer" \| "qa" \| "coordinator" \| "pm" | Target role (auto-detected if omitted) |
| `context` | string | Additional context or instructions |
| `pipelineRunId` | string | Pipeline run ID to associate with a stage |
| `result` | string | Task result (set when completing a task) |
| `status` | "pending" \| "running" \| "done" \| "failed" | Set the task status |
| `requestReview` | boolean | Request review from downstream role |

**Example:**
```
agentic_delegate taskId="auth-1" description="Design JWT authentication flow" role="architect"
```

---

### `agentic_pipeline`
Define and run multi-agent workflow pipelines. Chain PM → Architect → Developer → QA for complete feature development. Includes cross-validation between stages.

| Parameter | Type | Description |
|-----------|------|-------------|
| `action` | "define" \| "list" \| "run" \| "status" \| "suggest" (required) | Action to perform |
| `pipelineId` | string | Pipeline ID |
| `stages` | object[] | Pipeline stages (for define) |
| `name` | string | Pipeline name (for define) |
| `description` | string | Task description (for suggest) |

**Example:**
```
agentic_pipeline action="suggest" description="Build a REST API with auth"
```

---

### `agentic_message`
Inter-agent messaging system. Send messages between agent roles, request reviews, check inbox, and view conversation threads. Part of the multi-agent coordination framework.

| Parameter | Type | Description |
|-----------|------|-------------|
| `action` | "send" \| "inbox" \| "conversation" \| "mark-read" (required) | Action to perform |
| `to` | string | Recipient role (for send) |
| `taskId` | string | Task ID this message relates to |
| `message` | string | Message content (for send) |
| `type` | "result" \| "review_request" \| "review_response" \| "clarification" \| "approval" \| "revision" | Message type |
| `messageId` | string | Message ID to mark as read |

**Example:**
```
agentic_message action="inbox"
```

---

### `agentic_parallel`
Analyze or execute steps concurrently. Use `analyze` to see parallelism opportunities, or `execute` to run ready steps in parallel with Promise.all. Supports LLM-driven execution and sub-process OpenCode spawn.

| Parameter | Type | Description |
|-----------|------|-------------|
| `action` | "analyze" \| "execute" | Show parallelism plan or execute (default: analyze) |
| `opencodePath` | string | Path to `opencode` binary for sub-process spawn |
| `abortOnFailure` | boolean | Stop all tasks if one fails (default: false) |

**Example:**
```
agentic_parallel action="analyze"
```

---

### `agentic_skill`
Manage reusable skills extracted from successful task completions. Use 'extract' to create a skill from a completed step. Use 'find' to search existing skills.

| Parameter | Type | Description |
|-----------|------|-------------|
| `action` | "extract" \| "find" \| "list" (required) | Action to perform |
| `query` | string | Search query or extraction target (stepId) |

**Example:**
```
agentic_skill find="express middleware"
```

---

### `agentic_episodes`
Browse cross-session memory. Search past tasks and their outcomes to learn from previous sessions. Use before planning similar tasks to avoid repeating mistakes.

| Parameter | Type | Description |
|-----------|------|-------------|
| `action` | "search" \| "recent" \| "stats" (required) | Action to perform |
| `query` | string | Search query (for 'search') |

**Example:**
```
agentic_episodes action="search" query="authentication setup"
```

---

### `agentic_dashboard`
Generate an observability dashboard from execution traces. Shows timeline, statistics, tool usage, anomaly detection, and model reliability (timeouts, retry storms, silent failures).

| Parameter | Type | Description |
|-----------|------|-------------|
| *(none)* | | |

**Example:**
```
agentic_dashboard
```

---

### `agentic_guard`
Verify the truthfulness of claims made in step outputs. Checks that files referenced actually exist, functions claimed exist in code, and imports are valid. Use to catch LLM hallucinations before they corrupt the codebase.

| Parameter | Type | Description |
|-----------|------|-------------|
| `stepId` | string (required) | The step ID whose output to verify |

**Example:**
```
agentic_guard stepId="step-1"
```

---

## Stage IV — Self-Evolution

### `agentic_evolve`
Inspect and extend the agent system itself. Register custom agent roles, define versioned memory schemas, and export skills in self-describing format for other agents to consume.

| Parameter | Type | Description |
|-----------|------|-------------|
| `action` | "inspect" \| "register-role" \| "export-skill" \| "memory-schema" \| "evolve" \| "read-prompt" \| "edit-prompt" \| "prompt-history" \| "rollback-prompt" \| "export-training-data" (required) | Action to perform |
| `name` | string | Role name or skill name |
| `prompt` | string | Agent prompt template or new instruction |
| `tools` | string[] | Tools available to custom role |
| `skillId` | string | Skill ID to export or inspect |
| `role` | string | Agent role |
| `version` | number | Version number (for rollback) |
| `description` | string | Description for prompt change |
| `format` | "openai" \| "instructions" | Output format for training data |
| `minSuccessRate` | number | Minimum skill success rate (default: 0.5) |

**Example:**
```
agentic_evolve action="inspect"
```

---

## Blueprint Architecture

### `agentic_debate`
Debate loop between two agents (executor ↔ critic) for thorough analysis. Produces cleaner, more accurate results than a single LLM call. Best for complex analysis, data validation, and reviews.

| Parameter | Type | Description |
|-----------|------|-------------|
| `task` | string (required) | The task or question to analyze |
| `context` | string | Additional context |
| `maxRounds` | number | Maximum debate rounds (default: 3, max: 5) |
| `format` | "markdown" \| "json" | Output format (default: json) |

**Example:**
```
agentic_debate task="Is this API design RESTful?" context="GET /users/{id}/posts"
```

---

### `agentic_router`
Lightweight intent classifier that routes user input to the right knowledge category, RAG index, and tools. Use before searching memory to scope results to relevant domain.

| Parameter | Type | Description |
|-----------|------|-------------|
| `input` | string (required) | User input or query to classify |
| `categories` | object[] | Optional custom categories |

**Example:**
```
agentic_router input="How do I set up CI/CD?"
```

---

### `agentic_clean`
Clean raw text by stripping debate artifacts, reformatting to markdown/json, and optionally validating against a schema. Use after debate or any multi-step analysis to get clean output.

| Parameter | Type | Description |
|-----------|------|-------------|
| `text` | string (required) | Raw text to clean |
| `format` | "markdown" \| "json" \| "text" | Output format (default: json) |
| `schema` | string | Expected JSON schema description |
| `stripDebate` | boolean | Strip debate artifacts (default: true) |

**Example:**
```
agentic_clean text="Raw output with artifacts..." format="json"
```

---

### `agentic_rag`
Multi-index RAG: search or store knowledge in category-segregated indices. Prevents cross-category context pollution. Use with agentic_router to scope searches to relevant domains.

| Parameter | Type | Description |
|-----------|------|-------------|
| `action` | "search" \| "store" \| "stats" \| "categories" (required) | Action to perform |
| `query` | string | Search query |
| `category` | string | Category to search within |
| `title` | string | Title for stored entry |
| `content` | string | Content to store |
| `type` | "episode" \| "skill" | Type of content to store (default: episode) |

**Example:**
```
agentic_rag action="search" query="authentication patterns" category="backend"
```

---

### `agentic_mcp`
MCP (Model Context Protocol) client. Connect to external servers (databases, APIs, tools) via stdio or HTTP, discover available tools, and call them. Lets agents interact with the real world.

| Parameter | Type | Description |
|-----------|------|-------------|
| `action` | "connect" \| "list" \| "call" \| "disconnect" \| "disconnect-all" (required) | Action to perform |
| `transport` | "stdio" \| "http" \| "https" | Transport type |
| `command` | string | Executable path (for stdio) |
| `args` | string[] | Command arguments |
| `url` | string | Server URL (for http/https) |
| `name` | string | Server name for identification |
| `headers` | string | JSON string of extra HTTP headers |
| `server` | string | Server name to call/disconnect |
| `tool` | string | Tool name to call on the server |
| `params` | string | JSON string of tool arguments |

**Example:**
```
agentic_mcp action="connect" transport="stdio" command="npx" args=["-y", "@modelcontextprotocol/server-filesystem"] name="filesystem"
```

---

## Standard Workflow

```bash
# 1. Plan
agentic_plan goal="Add user authentication"

# 2. Execute each step
agentic_execute stepId="step-1" success=true output="Created auth.js" filesModified=["auth.js"]
agentic_execute stepId="step-2" success=true output="Created middleware" filesModified=["middleware.js"]

# 3. Verify
agentic_verify

# 4. If failed, analyze
agentic_reflect stepId="step-2" errorDetails="..."

# 5. Check progress
agentic_status
```

---

## Tool Count: 25

| Stage | Tools |
|-------|-------|
| I — Core Loop | `agentic_plan`, `agentic_execute`, `agentic_reflect`, `agentic_verify`, `agentic_status` |
| II — Codebase | `agentic_nav`, `agentic_context`, `agentic_snapshot`, `agentic_pr`, `agentic_score`, `agentic_model`, `agentic_model_reset` |
| III — Multi-Agent | `agentic_delegate`, `agentic_pipeline`, `agentic_message`, `agentic_parallel`, `agentic_skill`, `agentic_episodes`, `agentic_dashboard`, `agentic_guard` |
| IV — Evolution | `agentic_evolve` |
| Blueprint | `agentic_debate`, `agentic_router`, `agentic_clean`, `agentic_rag`, `agentic_mcp` |
