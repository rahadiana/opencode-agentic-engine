# Product Requirements Document: WebSocket Real-Time Notifications for Monitoring Dashboard

**Status:** Draft v1.0  
**Date:** 2026-07-03  
**Author:** PM Agent  
**Document ID:** PRD-2026-07-WRN-001  

---

## 1. Executive Summary

The current monitoring dashboard (`agentic_status detail=full`) is entirely **pull-based**: users must manually call the tool to see updated metrics, anomalies, and execution progress. This creates a stale-view problem — critical events (timeouts, retry storms, budget exceeded, hallucination detections) can go unnoticed until the next manual refresh.

This feature adds a **WebSocket-based real-time notification layer** that streams dashboard events to connected clients the instant they occur. It turns the observability system from "poll and pray" to "push and know."

**Business Value:** Reduced mean-time-to-awareness (MTTA) for critical agentic system events from minutes to milliseconds, enabling proactive intervention instead of reactive debugging.

---

## 2. Target Users

| User Persona | Role | Primary Need | Tech Savviness |
|---|---|---|---|
| **Plugin Developer** | Maintainer of the agentic engine plugin | Monitor plugin health, debug failures, track evolution metrics in real-time | High — comfortable with WebSocket APIs |
| **OpenCode User running autonomous agents** | End-user running `agentic_auto` or multi-agent pipelines | Know immediately when a task fails, budget is exceeded, or a hallucination is detected | Medium — wants a UI/CLI client |
| **CI/CD Operator** | Running agentic workflows in CI pipelines | Pipe real-time events to external monitoring (Datadog, Grafana, Splunk) | High — wants JSON event stream |
| **Multi-Agent Orchestrator** | External agent system (A2A/MCP) | Subscribe to cross-session event streams from distributed plugin instances | High — programmatic consumption |

---

## 3. Key Features

### F1: WebSocket Event Server
- Start/stop a WebSocket server on a configurable port (default: 4125)
- Accept incoming WebSocket connections from clients (browsers, CLI tools, external systems)
- Support the `ws://` and `wss://` (TLS) schemes
- Graceful shutdown: drain active connections, flush pending events, then close

### F2: Event Subscription Protocol
- On connect, client sends a `subscribe` message with:
  - `eventTypes: string[]` — which event types to receive (empty = all events)
  - `filters: { sessionId?: string; severity?: string; tool?: string }` — optional filters
  - `mode: "live" | "replay" | "both"` — whether to replay history, stream live, or both
- Client can send `unsubscribe` to stop specific subscriptions without closing connection
- Server sends a `subscribed` acknowledgment with subscription ID and current event count

### F3: Real-Time Event Streaming
- Every `AgenticEvent` emitted on the internal EventBus is immediately serialized to JSON and pushed to all matching subscribers
- Events include: `step.*`, `plan.*`, `pipeline.*`, `budget.*`, `guard.*`, `task.*`, `memory.*`, `llm.response`, `file.written`, `feedback.recorded`
- Each pushed event includes envelope metadata:
  - `id` (UUID), `type`, `timestamp` (ISO-8601), `source` (plugin instance ID), `payload` (original event data)

### F4: Heartbeat / Connection Health
- Server sends periodic `heartbeat` messages every 30s to detect stale connections
- Client can respond with `pong` (optional); server closes connections silent for >2 missed heartbeats
- Client-side recommended: auto-reconnect with exponential backoff (1s, 2s, 4s, max 30s)

### F5: History Replay on Subscribe
- On first subscription (or with `mode: "replay"`), server replays recent event history from TraceLogger
- Configurable replay window: last N events (default: 100) or last T minutes (default: 5 min)
- Deduplication: same event never sent twice to the same subscriber
- Events are sent in chronological order, even across a reconnection boundary

### F6: Dashboard Integration (agentic_status)
- `agentic_status` gains a new `websocket` action to:
  - `websocket start` — start the WebSocket server
  - `websocket stop` — stop the WebSocket server
  - `websocket status` — show active connections, event throughput, uptime
- Dashboard display includes:
  - Connection count graph (over time)
  - Event throughput (events/sec)
  - Top event types being consumed

### F7: Security & Scoping
- Optional `apiKey` authentication: clients must include `Authorization: Bearer <apiKey>` in the WebSocket upgrade request
- Event scoping: clients can only see events for sessions they own (by `sessionId` filter)
- TLS support via `key` and `cert` config options
- Rate limiting: configurable max events/sec per client (default: 1000/sec)
- Connection limit: configurable max concurrent connections (default: 50)

### F8: CLI / Headless Client (Bonus)
- A lightweight JavaScript/TypeScript client class `WebSocketDashboardClient` for programmatic use
- Methods: `connect(url, options)`, `disconnect()`, `onEvent(handler)`, `subscribe(filters)`, `unsubscribe()`
- Auto-reconnect with configurable backoff
- Exposed via `opencode-agentic-engine` package exports

---

## 4. Acceptance Criteria

### AC1: Server Lifecycle
- [ ] `agentic_status websocket start` starts a WebSocket server on the configured port
- [ ] `agentic_status websocket stop` stops the server gracefully (waits for active events to flush)
- [ ] `agentic_status websocket status` returns: port, uptime, connection count, events served, errors
- [ ] Starting on an already-bound port returns a clear error message
- [ ] Stopping when not running is a no-op (not an error)

### AC2: Event Delivery
- [ ] All 18 event types from `AgenticEvent` union are serialized and delivered
- [ ] Events are delivered within 100ms of internal EventBus emission (measured in same process)
- [ ] Events are deduplicated per subscriber (no duplicate event IDs)
- [ ] Maximum event latency under load (1000 events/sec): <500ms p99

### AC3: Subscription Protocol
- [ ] Client can subscribe to specific event types and only receives those
- [ ] Client can filter by `sessionId` and receives only matching events
- [ ] Multiple clients with different filters all receive correct event subsets
- [ ] Client receives `subscribed` acknowledgment upon successful subscription
- [ ] Client can `unsubscribe` mid-connection

### AC4: Heartbeat & Resilience
- [ ] Server sends heartbeat every 30s; client with `pong` keeps connection alive
- [ ] Client that misses 2 heartbeats in a row is disconnected
- [ ] Client-side auto-reconnect re-establishes subscription state (event types + filters)
- [ ] After reconnection, any events missed during disconnect are replayed within the replay window

### AC5: History Replay
- [ ] On first connect with `mode: "replay"`, client receives last 100 events
- [ ] Replayed events are marked with `replayed: true` in envelope
- [ ] After replay completes, client receives `replay_complete` message
- [ ] Subsequent events are streamed live with `replayed: false`

### AC6: Security
- [ ] With `apiKey` configured, unauthenticated WebSocket upgrades are rejected with 401
- [ ] With TLS configured, only `wss://` connections are accepted (no plain `ws://`)
- [ ] Rate-limited client receives 429 status and is disconnected after N warnings
- [ ] Connection limit enforcement: Nth+1 connection is rejected with 503

### AC7: Integration Tests
- [ ] Unit tests: server start/stop, subscription protocol, heartbeat, rate limiting
- [ ] Integration test: connect, subscribe, send events via EventBus, verify WebSocket receives them
- [ ] Load test: 50 simultaneous connections, 100 events/sec, verify no message loss
- [ ] Reconnection test: kill server, restart, verify client reconnects and resumes

### AC8: Non-Regression
- [ ] All existing 2727+ unit tests pass
- [ ] No new lint warnings
- [ ] Coverage gates pass (stmts ≥80%, branch ≥60%, funcs ≥70%)
- [ ] Existing SWE-bench mock and EvoClaw scores unchanged

---

## 5. Success Metrics

| Metric | Current Baseline | Target | How Measured |
|---|---|---|---|
| **MTTA (Mean Time To Awareness)** — time from critical event emission to first client notification | N/A (pull-based, polling gap unknown) | **<200ms p95** from EventBus emit to WebSocket push | Instrumented timing log in WebSocket server |
| **Event Delivery Reliability** — % of events successfully delivered to at least one subscriber (end-to-end) | N/A | **≥99.9%** (no drops under normal load) | Compare EventBus emit count vs WebSocket delivery count |
| **Connection Stability** — average connection uptime per session | N/A | **>1 hour** (reconnections only on network issues, not server-side drops) | Tracked in server connection stats |
| **Client Adoption** — number of unique clients connecting per week | 0 | **≥3 internal integrations** (CLI, dashboard widget, CI/CD pipe) | Server connection log |
| **Developer Experience** — user-reported satisfaction with real-time monitoring | N/A | **>4/5** on ease-of-integration survey | Post-launch user survey |
| **Notification Latency** — time from critical anomaly (timeout, retry_storm) detection to client notification | Seconds to minutes (poll interval) | **<500ms p99** | Anomaly detection timestamp vs WebSocket delivery timestamp |
| **Load Capacity** — sustained event throughput without degradation | N/A | **1000 events/sec** with 50 concurrent clients, no message loss | Load test harness |

---

## 6. Dependencies

| Dependency | Type | Details |
|---|---|---|
| **Existing EventBus** (`src/core/event-bus.ts`) | Internal | Events must be emitted to EventBus before they can be pushed to WebSocket. Already instrumented across all producers. |
| **Existing TraceLogger** (`src/observability/trace-logger.ts`) | Internal | Source of replay events. Must provide `getRecent(limit, minutes)` API for history replay. |
| **Existing Event Taxonomy** (`src/core/event-taxonomy.ts`) | Internal | Defines the 18 event types. WebSocket protocol mirrors this taxonomy. |
| **Existing Dashboard** (`src/observability/dashboard.ts`) | Internal | `agentic_status` dashboard integration shows WebSocket server status. |
| **Node.js `ws` package** | External | WebSocket server implementation (or use native `WebSocket` in Node.js 22+) |
| **Existing MCP/A2A server patterns** (`src/core/mcp-server.ts`, `src/agents/a2a-server.ts`) | Reference | HTTP server lifecycle, JSON-RPC handling, graceful shutdown patterns to follow |
| **OpenCode tool registration** (`src/index.ts`) | Integration Point | New `agentic_status websocket` sub-actions registered in the tool definition |

---

## 7. Scope Boundary

### ✅ In Scope
- WebSocket server start/stop/status lifecycle
- Event subscription protocol (type, filter, replay mode)
- Real-time push of all 18 AgenticEvent types
- Heartbeat/connection health management
- History replay on connect/reconnect
- Dashboard integration showing server metrics
- Configurable: port, TLS, authentication, rate limits
- Lightweight CLI client class

### ❌ Out of Scope (Future)
- **Persistent queue** (e.g., Redis/Kafka) for guaranteed delivery across server restarts — start with in-memory buffer
- **Web UI dashboard** — this is infrastructure for real-time delivery, not a UI framework; clients (browsers, terminals, external tools) build their own UI
- **Push notifications to mobile/email/Slack** — the WebSocket server emits raw JSON; external relay services (e.g., webhook → Slack) can be built on top
- **Historical query API** beyond the replay window — use the existing TraceLogger file-based storage for long-term queries
- **Multi-instance clustering** — single process only; horizontal scaling via load balancer can be added later
- **gRPC/SSE alternatives** — WebSocket is the initial transport; SSE and gRPC-streaming can be evaluated in v2
- **End-user UI** — CLI client is included, but no React/Vue dashboard is provided

---

## 8. Technical Approach (Architect's Overview)

### Architecture
```
┌──────────────┐    EventBus.emit()    ┌──────────────────────┐
│  Producers    │ ────────────────────▶ │   EventBus (in-proc)  │
│ (executor,    │                      │   pub/sub engine      │
│  planner,     │                      └──────┬───────────────┘
│  guard, etc.) │                             │ onAny subscriber
└──────────────┘                               ▼
                                     ┌──────────────────────┐
                                     │  WebSocketBridge      │
                                     │  (EventBus subscriber) │
                                     │                      │
                                     │  ┌────────────────┐  │
                                     │  │  Message Queue  │  │
                                     │  │  (per-conn)     │  │
                                     │  └────────────────┘  │
                                     └──────────┬───────────┘
                                                │ ws.send()
                                     ┌──────────▼───────────┐
                                     │  WebSocket Connections │
                                     │  (client1, client2, …)│
                                     └──────────────────────┘
```

### Key Design Decisions
1. **Bridge pattern**: `WebSocketBridge` subscribes to EventBus `onAny` and fans out to all WebSocket clients. Minimal latency (same process).
2. **Per-connection message queue**: Each client gets a bounded queue to prevent slow consumers from blocking fast ones.
3. **Replay from TraceLogger**: On subscribe with replay mode, the bridge reads from the JSONL trace file (or in-memory circular buffer in TraceLogger).
4. **Follow existing patterns**: Server lifecycle mirrors `MCPServer.start()`/`stop()` patterns. Tool registration follows `agentic_*` conventions.

### Files to Create/Modify
| File | Action | Description |
|---|---|---|
| `src/observability/websocket-server.ts` | **Create** | WebSocket server: start/stop, connection management, heartbeat, auth |
| `src/observability/websocket-bridge.ts` | **Create** | EventBus → WebSocket bridge: subscription matching, per-conn queue, rate limiting |
| `src/observability/ws-client.ts` | **Create** | Lightweight TypeScript client class for programmatic consumption |
| `src/observability/README.md` | **Modify** | Add WebSocket server to documentation table |
| `src/core/event-taxonomy.ts` | **Modify** | Add `ws.*` event types for server lifecycle events (connection, disconnect, error) |
| `src/index.ts` | **Modify** | Add `agentic_status websocket` sub-actions; wire up WebSocketBridge to EventBus |
| `src/observability/dashboard.ts` | **Modify** | Add WebSocket metrics (connections, throughput) to dashboard output |
| `test/_b_websocket.mjs` | **Create** | Test suite: server lifecycle, subscription protocol, event delivery |

---

## 9. Release Criteria

| Gate | Requirement |
|---|---|
| **Code Quality** | All AC1–AC8 pass, 0 lint warnings, 2727+ existing tests pass |
| **Coverage** | New files ≥80% stmts, overall coverage gate passes |
| **Performance** | 1000 events/sec with 50 connections, p99 latency <500ms |
| **Security** | No regressions in code-sandbox checks; auth tested with valid/invalid keys |
| **Documentation** | README updated, new config options documented in AGENTS.md |
| **Backward Compatibility** | `agentic_status` with no arguments continues to work identically |

---

## 10. Timeline (Estimate)

| Phase | Duration | Deliverable |
|---|---|---|
| **P0: Core Server** | 2 days | `WebSocketServer` start/stop/status, connection lifecycle, heartbeat |
| **P1: Bridge + Subscription** | 2 days | `WebSocketBridge` EventBus subscription, per-conn queue, event type filtering |
| **P2: Replay + History** | 1 day | TraceLogger `getRecent()` API, replay on subscribe, dedup |
| **P3: Security + Config** | 1 day | Auth (apiKey), TLS, rate limiting, config wiring |
| **P4: Integration + Dashboard** | 1 day | `agentic_status websocket` sub-actions, dashboard display, index.ts wiring |
| **P5: Client Library** | 1 day | `WebSocketDashboardClient` class with auto-reconnect |
| **P6: Tests + Hardening** | 2 days | Unit tests, integration tests, load test, lint/coverage gates |
| **Total** | **10 days** | |

---

## 11. Appendices

### A. Event Envelope Format
```typescript
interface WsEventEnvelope {
  id: string           // UUID v4
  type: string         // e.g., "step.completed", "budget.limit.exceeded"
  timestamp: string    // ISO-8601
  source: string       // plugin instance ID
  replayed: boolean    // true if this is from history replay
  payload: unknown     // original AgenticEvent payload
}
```

### B. Subscription Message Format
```typescript
// Client → Server
interface WsSubscribeMessage {
  type: "subscribe"
  eventTypes?: string[]     // empty = all
  filters?: {
    sessionId?: string
    severity?: "critical" | "warning" | "info"
    tool?: string
  }
  mode?: "live" | "replay" | "both"  // default: "both"
}

// Server → Client (acknowledgment)
interface WsSubscribedAck {
  type: "subscribed"
  subscriptionId: string
  eventCount: number        // total subscribed event types
  replayCount: number       // events to be replayed
}

// Server → Client (end of replay)
interface WsReplayComplete {
  type: "replay_complete"
  count: number
}
```

### C. Existing Event Types to Expose (from `AgenticEvent` union)
All 18 event types are candidates, but especially valuable for real-time monitoring:
- `step.completed`, `step.failed`, `step.retrying` — execution progress
- `budget.limit.exceeded`, `budget.threshold.warning` — cost control
- `guard.check.completed` — hallucination detection
- `pipeline.stage.completed`, `pipeline.completed` — pipeline progress
- `plan.completed` — autonomous loop results
- `llm.response` — (optional, high volume) model performance
- `feedback.recorded` — user satisfaction signals
