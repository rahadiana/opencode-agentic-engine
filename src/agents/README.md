# agents/ — Multi-Agent Coordination

| File | Fungsi |
|------|--------|
| `agent-runtime.ts` | Sub-process / isolated LLMEngine per (sessionId, role), LRU max 10 |
| `orchestrator.ts` | Multi-agent pipelines + cross-validation antar stage |
| `coordinator.ts` | Delegasi role, auto-suggest, message bus / blackboard |
| `role-registry.ts` | Built-in + custom roles, prompt versioning |
| `a2a-client.ts` | A2A client — discover / delegate / ping |
| `a2a-server.ts` | A2A server — Agent Card, accept tasks |
| `a2a-types.ts` | Protocol types (Google A2A-oriented) |

## Agent Roles

| Role | Typical tools |
|------|----------------|
| **architect** | read, agentic_nav, agentic_plan, agentic_score |
| **developer** | read, edit, write, bash, grep, glob, agentic_skill |
| **qa** | read, agentic_verify, agentic_debate, agentic_guard |
| **coordinator** | read, agentic_message, agentic_pipeline, agentic_status |
| **pm** | read, agentic_plan, agentic_status, agentic_pr |

## A2A Protocol

Discover remote agents, delegate tasks, ping. Cross-framework interop.

## Catatan

- `AttentionScheduler` (`core/attention-scheduler.ts`) **belum** default wire ke path ini — multi-agent harian lewat orchestrator/delegate/parallel.
- Sub-agent injection di `index.ts` (`detectSubAgentRole` / `buildSubAgentInjection`) membatasi tool list per role/pipeline stage.
