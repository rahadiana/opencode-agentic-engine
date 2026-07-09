# tools/ — Agentic Tool Definitions

Satu file ≈ satu tool publik (`agentic_*`). Dirakit di `definitions.ts`.

## Layout

| File | Tool / peran |
|------|----------------|
| `definitions.ts` | `buildAllTools(ctx)` — registryTool wrapper, session guard, assemble all |
| `tool-context.ts` | `ToolContext` DI bag (semua service dari `index.ts`) |
| `types.ts` | `ToolSpec` interface |
| `plan.ts` | `agentic_plan` |
| `execute.ts` | `agentic_execute` — policy, guard, alignment, economic, **RAG feedback**, continuous evo |
| `reflect.ts` | `agentic_reflect` |
| `verify.ts` | `agentic_verify` |
| `status.ts` | `agentic_status` — incl. **Dumb-Model Harness** section (`detail=full`) |
| `nav.ts` | `agentic_nav` |
| `context.ts` | `agentic_context` |
| `snapshot.ts` | `agentic_snapshot` |
| `pullRequest.ts` | `agentic_pr` |
| `score.ts` | `agentic_score` |
| `model.ts` | `agentic_model` |
| `budget.ts` | `agentic_budget` |
| `db.ts` | `agentic_db` |
| `memo.ts` | `agentic_memo` |
| `delegate.ts` | `agentic_delegate` |
| `pipeline.ts` | `agentic_pipeline` |
| `message.ts` | `agentic_message` |
| `parallel.ts` | `agentic_parallel` |
| `skill.ts` | `agentic_skill` (+ skill-security import path) |
| `episodes.ts` | `agentic_episodes` |
| `guard.ts` | `agentic_guard` |
| `finetune.ts` | `agentic_finetune` |
| `tools.ts` | `agentic_tools` (MCP+A2A unified) |
| `evolve.ts` | `agentic_evolve` |
| `auto.ts` | `agentic_auto` (+ 5W1H research agent) |
| `fetch.ts` | `agentic_fetch` — sets `workflow:researched` |
| `debate.ts` | `agentic_debate` |
| `router.ts` | `agentic_router` |
| `clean.ts` | `agentic_clean` |
| `rag.ts` | `agentic_rag` |
| `mcp.ts` | `agentic_mcp` |
| `a2a.ts` | `agentic_a2a` |

## Wiring rules

1. Tool **tidak** instantiate service sendiri — ambil dari `ToolContext`.
2. `registryTool` di `definitions.ts` set `llmEngine.setSessionId` + `setToolContext` + catch errors.
3. Session wajib: tanpa `context.sessionID` → error bersih (bukan TypeError).
4. Harness ketat hidup di **`execute.ts`** (bukan di setiap tool):
   - `resolveDumbHarness` → WorkflowPolicy mode
   - `getRAGSelfImprovePipeline().feedStepResult` dari `rag:lastUsedTitles`

## Total

**32** tools publik dengan prefix `agentic_`.
