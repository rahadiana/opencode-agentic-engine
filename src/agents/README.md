# agents/ — Multi-Agent Coordination

| File | Fungsi |
|------|--------|
| `agent-runtime.ts` | Sub-process spawner untuk agent roles. Isolated LLMEngine per (sessionId, role), LRU eviction (max 10) |
| `orchestrator.ts` | Multi-agent workflow pipelines + cross-validation antar stage |
| `coordinator.ts` | Delegasi ke agent roles, auto-suggest role, message bus |
| `role-registry.ts` | Built-in + custom agent definitions (extensible) |
| `a2a-client.ts` | A2A (Agent-to-Agent) protocol client — Google A2A standard |
| `a2a-server.ts` | A2A protocol server — serve Agent Card, accept remote tasks |
| `a2a-types.ts` | A2A protocol types/interfaces |

## Agent Roles

| Role | Tools |
|------|-------|
| **architect** | read, agentic_nav, agentic_plan, agentic_score |
| **developer** | read, edit, write, bash, grep, glob |
| **qa** | read, agentic_verify, agentic_debate, agentic_guard |
| **coordinator** | read, agentic_message, agentic_pipeline, agentic_status |
| **pm** | read, agentic_plan, agentic_status, agentic_pr |

## A2A Protocol

Discover remote agents, delegate tasks, ping. Google A2A standard untuk cross-framework interop.
