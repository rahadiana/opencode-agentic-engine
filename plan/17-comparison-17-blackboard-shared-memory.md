# Comparison 17: Blackboard System + Shared Memory Antar Agent

## Source
`MARKDOWN_PLAN/17 - blackboard system + shared memory antar agent.md` — Event-driven agent coordination

## Inti Konsep
- **BlackboardStore**: shared in-memory state dengan `get()` / `set()` / `update()` / `subscribe()`
- **Event-driven**: agents subscribe → react ke state changes → update state
- Agents: Planner (react ke `status === "planning"`), Executor (`"executing"`), Critic (`"critic"`), Memory (optional)
- **Loop**: planning → executing → critic → (done OR back to planning)
- Guard: MAX_CYCLES = 5, validate state, lock per phase
- Production upgrade: Redis pub/sub, event bus (NATS/Kafka)

## Yang Kita Punya
- **Event Bus** (`src/core/event-bus.ts`): pub/sub event bus for tool hooks.
- **Coordinator** (`src/agents/coordinator.ts`): message bus antar agent.
- **Orchestrator** (`src/agents/orchestrator.ts`): multi-agent pipelines.
- **Session Store** (`src/memory/session-store.ts`): conversation + plan + progress.
- **Event Taxonomy** (`src/core/event-taxonomy.ts`): event type schema.

## Gap
1. **⚠️ Event-Driven vs Pipeline** — Kita pakai pipeline (PM → Arch → Dev → QA linear). Mereka pakai event-driven (agents react to state). Pipeline lebih predictable; blackboard lebih flexible.
2. **❌ Shared State** — Kita tidak punya shared state object yang bisa di-read/write semua agent. State kita distributed: session store, event bus, masing-masing independent.
3. **❌ Subscribe/Notify** — Kita punya event bus TAPI untuk tool hooks, bukan untuk agent coordination.
4. **❌ Retry Loop** — Kita punya retry per step, bukan per phase. Blackboard mereka bisa loop planning ↔ critic.
5. **❌ Phase Lock** — Tidak ada `status` flag yang dicek sebelum agent jalan.

## Kesimpulan
**Event bus kita oriented ke tool hooks (before/after tool call).** Blackboard mereka oriented ke agent coordination. Dua pendekatan berbeda untuk use case berbeda. Tapi konsep shared state + subscribe/notify bisa kita adopsi untuk multi-agent coordination yang lebih flexible.
