# Plan #26: Agentic Agnostic Smart Architecture

> **Tujuan**: Menerapkan 7 prinsip agentic agnostic dari riset terbaru (2026) ke opencode-agentic-engine — biar plugin ini gak cuma "tool caller" tapi smart agentic system yang vendor-agnostic, protocol-agnostic, dan self-evolving.

**Terakhir diperbarui**: 2026-06-25 (sesi 2)

---

## 📚 Referensi Riset

| # | Paper / Framework | Source | Tanggal |
|---|-------------------|--------|---------|
| 1 | **Auton Agentic AI Framework** — Cognitive Blueprint ≠ Runtime Engine | arXiv:2602.23720 | Feb 2026 |
| 2 | **DSG — Decoupled Search Grounding** — Vendor-agnostic grounding via MCP | arXiv:2606.18947 | Jun 2026 |
| 3 | **Agentic Programming (LLM-as-Code)** — Program control flow, LLM hanya reasoning | arXiv:2606.15874 | Jun 2026 |
| 4 | **STEM Agent** — Multi-protocol gateway, biologically-inspired skills | arXiv:2603.22359 | Mar 2026 |
| 5 | **Graph Harness** — DAG execution, separation planning/execution/recovery | arXiv:2604.11378 | Apr 2026 |
| 6 | **OpenSage** — Self-programming agent generation, hierarchical memory | arXiv:2602.16891 | Feb 2026 |
| 7 | **Orchard** — Open-source agentic modeling, Kubernetes-native env | arXiv:2605.15040 | May 2026 |
| 8 | **RAAS** — Agentic system architecture search with GRPO | CVPR 2026 | 2026 |
| 9 | **Omnigent** — Universal autonomous agent, circuit breaker, loop detection | GitHub | Feb 2026 |
| 10 | **AutoAgent** — Zero-code agent development, self-play customization | ACL 2026 | 2026 |
| 11 | **DeepAgent** — End-to-end deep reasoning, dynamic tool discovery | arXiv:2510.21618 | 2025 |
| 12 | **AI Agent Index 2025** — 30 systems, 6 categories, safety documentation | arXiv:2602.17753 | 2026 |
| 13 | **Agentic Software (The End of SE)** — 4-stage roadmap, AaaS paradigm | arXiv:2606.05608 | Jun 2026 |

---

## 🧠 7 Prinsip Agentic Agnostic

### 1️⃣ Vendor Agnostic — Gak Terikat Provider/Model

**Masalah**: Plugin ini pake `client.session.prompt()` yang otomatis pake model session. Gak ada routing per-task.

**Dari riset:**
- **DSG** (arXiv:2606.18947): Search grounding pisah dari reasoning. Provider routing via MCP gateway. Hasil: 91% lebih murah, 99.4% cache hit
- **Omnigent**: Multi-provider LLM routing via `LLMProvider` ABC. Task-based routing + auto fallback
- **AI Agent Index 2025**: 9/30 enterprise agents explicit support user selection across providers

**Status Implementasi:**

| Item | Status | Keterangan |
|------|--------|------------|
| Task classifier → model routing | ✅ DONE | `TOOL_COMPLEXITY` mapping + `agentic_model set tool/category` |
| Auto fallback saat model gagal | ✅ DONE | Multi-provider fallback chain di `LLMEngine.call()` |
| Cache warm (semantic + exact) | ✅ DONE | Gap #7 SemanticCache (TF-IDF + cosine) |
| Cost-aware routing | ✅ DONE | Cost weighting di selectBestModel() + recordCall(costUsd) |

**Contoh implementasi:**
```typescript
// Multi-provider auto fallback (v0.6.0)
const engine = new LLMEngine({
  fallbackModels: [
    "deepseek/deepseek-chat",
    "openai/gpt-4o",
    "anthropic/claude-sonnet-4-6"
  ],
  maxFallbackAttempts: 4
})

// Fallback chain:
// 1. Primary model (explicit/tool/category)
// 2. Config fallback models (user-configured)
// 3. Registry-ranked models (healthy > degraded)
// 4. Session default (no model override)
```

### 2️⃣ Protocol Agnostic — Multi-Protocol Gateway

**Masalah**: Plugin cuma pake OpenCode SDK (`client.session.prompt()`). Gak bisa interop dengan sistem lain.

**Dari riset:**
- **STEM Agent** (arXiv:2603.22359): 5 protocols (A2A, AG-UI, A2UI, UCP, AP2) di belakang unified gateway
- **MCP** (Model Context Protocol): Standard buat tool integration

**Status Implementasi:**

| Item | Status | Keterangan |
|------|--------|------------|
| MCP client: list/connect/call | ✅ DONE | `agentic_mcp` tool |
| A2A protocol: agent interop | ✅ DONE | A2AServer + A2AClient + Agent Card |
| Dynamic tool registry | ⚠️ PARTIAL | MCP discover ada, runtime add/remove belum |
| Protocol adapter pattern | ✅ DONE | `ProtocolAdapter` class — unified search, call, list, stats |
| Session bridging | ❌ BELUM | Belum ada cross-platform session |

### 3️⃣ Model Agnostic — Cognitive Blueprint ≠ Runtime

**Masalah**: Agent definition nyatu sama kode. Gak ada "agent spec" yang portable.

**Dari riset:**
- **Auton** (arXiv:2602.23720): Cognitive Blueprint = declarative spec (YAML/JSON), language-agnostic. Runtime Engine = platform-specific
- Analogi Kubernetes: spec → deploy ke mana aja

**Status Implementasi:**

| Item | Status | Keterangan |
|------|--------|------------|
| AgentBlueprint interface | ✅ DONE | `src/core/agent-blueprint.ts` |
| Blueprint parser: YAML/JSON → runtime | ✅ DONE | `AgentBlueprint.parse()` |
| Blueprint registry: versionable | ✅ DONE | `RoleRegistry` dengan prompt versioning |
| Multi-env deployment | ⚠️ PARTIAL | Plugin + CLI, MCP server belum |

### 4️⃣ Control Agnostic — Program Control Flow, LLM Hanya Reasoning

**Masalah**: Sekarang LLM yang orkestrasi semuanya (via agent loop). Ini architectural mistake menurut paper.

**Dari riset:**
- **LLM-as-Code** (arXiv:2606.15874): "LLM should NOT be the orchestrator; the program should control the flow"
- **Graph Harness** (arXiv:2604.11378): Loop-based execution → DAG-based execution. 3 layers independent: planning, execution, recovery
- **Omnigent**: Circuit breaker + hash-based loop detection + rate limiting

**Status Implementasi:**

| Item | Status | Keterangan |
|------|--------|------------|
| DAG-based execution | ✅ DONE | `DAGEngine` — Kahn's sort, parallel, circuit breaker |
| PlanningLayer/ExecutionLayer/RecoveryLayer | ✅ DONE | 3-layer terpisah (v0.6.0) |
| Immutable plan | ✅ DONE | `createPlanVersion()` — replan creates new version, v1 preserved immutably (v0.6.0) |
| Strict escalation chain | ✅ DONE | Auto-chaining retry→replan→escalate per node with max depth (v0.6.0) |
| Circuit breaker + loop detection | ✅ DONE | Hash-based + max steps + token budget |
| Legacy while(true) fallback | ⚠️ PARTIAL | `runLoopBatched()` masih ada sebagai backward compat |

### 5️⃣ Tool Agnostic — MCP-First Tool Integration

**Masalah**: Tool definitions hardcoded di plugin. Setiap tool butuh implementasi manual.

**Dari riset:**
- **STEM Agent**: MCP sebagai satu-satunya jalan tools. Gak ada tool binding langsung
- **DeepAgent** (arXiv:2510.21618): Dynamic tool discovery — tools gak di-pre-fetch, dicari pas perlu
- **Auton**: MCP sebagai standard tool integration

**Status Implementasi:**

| Item | Status | Keterangan |
|------|--------|------------|
| MCP client: connect/call | ✅ DONE | `agentic_mcp` tool |
| Dynamic tool discovery | ✅ DONE | `listTools()` via MCP |
| MCP-first (all tools via MCP) | ❌ BELUM | Masih ada 30 tools hardcoded |
| Tool sandbox | ⚠️ PARTIAL | CodeSandbox ada untuk code execution |
| Tool versioning | ❌ BELUM | Belum ada versioning system |

### 6️⃣ Memory Agnostic — Hierarchical + Consolidation

**Masalah**: Memory sekarang flat — session store + episodic store. Gak ada consolidation.

**Dari riset:**
- **Auton**: Hierarchical memory consolidation inspired by biological episodic memory
- **STEM Agent**: 4-type memory (episodic, semantic, procedural, working) + consolidation
- **OpenSage**: Graph-based hierarchical memory

**Status Implementasi:**

| Item | Status | Keterangan |
|------|--------|------------|
| 4-level memory | ✅ DONE | Working, Episodic, Semantic, Procedural di `MemoryOrchestrator` |
| Consolidation scheduler | ✅ DONE | `ConsolidationScheduler` — periodic pruning + dedup |
| Importance-based forgetting | ⚠️ PARTIAL | Episodic decay ada, working/procedural belum |
| Cross-level query | ⚠️ PARTIAL | Query ada tapi working memory query kosong |
| Working memory query | ✅ DONE | `sessionToEntries()` — plan goals + recent turns |
| Procedural memory depth | ⚠️ PARTIAL | Store ada tapi execution tracking belum |

### 7️⃣ Evolution Agnostic — Self-Evolving dari In-Context sampai RL

**Masalah**: Evolusi sekarang manual (agentic_evolve, agentic_finetune). Gak otomatis.

**Dari riset:**
- **Auton**: 3-level evolution — in-context → supervised fine-tuning → reinforcement learning
- **AutoAgent**: Self-play agent customization — natural language → XML schema → iteratif improvement
- **OpenSage**: Self-programming — AI bikin sub-agent + tools sendiri
- **RAAS** (CVPR 2026): GRPO-based architecture search — otomatis nyari workflow optimal

**Status Implementasi:**

| Item | Status | Keterangan |
|------|--------|------------|
| In-context skill extraction | ✅ DONE | `agentic_skill extract` |
| Skill maturation lifecycle | ✅ DONE | raw → validated → compiled → evolved |
| Fine-tuning pipeline | ✅ DONE | `agentic_finetune` — prepare/upload/create-job |
| Auto-trigger evolution | ✅ DONE | EventBus per-step wiring + `cumulativeResults` counter (milestone fix) |
| Feedback loop (user rating → policy) | ⚠️ PARTIAL | User feedback tracking ada, policy update belum |
| RL from execution outcomes | ❌ BELUM | Belum ada RL pipeline |
| Architecture search (RAAS-style) | ❌ BELUM | Belum ada workflow optimization |

---

## 🛡️ Safety & Verification

### Phase 4C — Safety by Design

| Item | Status | Keterangan |
|------|--------|------------|
| ConstraintManifold | ✅ DONE | `src/core/constraint-manifold.ts` |
| File safety (delete, protected paths) | ✅ DONE | Blocks .env, .ssh, /etc, dangerous commands |
| Concurrent modification tracking | ✅ DONE | `beginModification()` / `endModification()` |
| Circuit breaker (consecutive violations) | ✅ DONE | Configurable threshold |
| Category toggling | ✅ DONE | `setCategoryEnabled()` |
| Snapshot for dashboard | ✅ DONE | `snapshot()` method |
| Dashboard integration | ✅ DONE | `DashboardContext.constraintMetrics` |

### Gap #4 — Multi-Dimensional Verification

| Dimension | Status | Keterangan |
|-----------|--------|------------|
| Compile | ✅ DONE | `tsc --noEmit` |
| Lint | ✅ DONE | ESLint |
| Test | ✅ DONE | Jest/Vitest |
| Security | ✅ DONE | `verifySecurity()` — SQL injection, XSS, path traversal |
| Performance | ✅ DONE | `verifyPerformance()` — N+1 queries, missing indexes |
| Architecture | ✅ DONE | `verifyArchitecture()` — circular dependencies |
| Dependencies | ✅ DONE | `verifyDeps()` — npm audit |

---

## 🗺️ Roadmap Implementasi

### Phase 1 — Foundation ✅
- [x] Gap #4: Multi-dimensional verification (security, perf, arch, deps)
- [x] Gap #7: Semantic cache (TF-IDF + cosine similarity)
- [x] P0-P3 hardening: error classes, timeout aborts, type safety
- [x] Chat mode fix: temp child session instead of hanging
- [x] **Blueprint interface**: declarative agent spec (`agent-blueprint.ts`)
- [x] **DAG-based execution**: refactor agent loop (`dag-engine.ts`)

### Phase 2 — Control & Memory
- [x] ~~Separation: PlanningLayer, ExecutionLayer, RecoveryLayer~~
- [x] ~~Immutable plan enforcement — replan creates new version via createPlanVersion()~~
- [x] ~~Circuit breaker~~ → hash-based loop detection + rate limiting
- [x] ~~Hierarchical memory~~ → working → episodic → semantic → procedural
- [x] ~~Consolidation scheduler~~ → pruning + dedup otomatis
- [x] ~~Working memory query (level 1)~~ → `sessionToEntries()`
- [x] ~~Procedural memory depth — execution tracking, trace pattern extraction, pruning~~

### Phase 3 — Provider & Protocol
- [x] ~~Task-based model routing~~ → TOOL_COMPLEXITY + agentic_model tool
- [x] ~~Multi-provider dengan auto fallback~~ → fallback chain di LLMEngine
- [x] ~~MCP-first infrastructure: DynamicToolRegistry + MCPServer + agentic_mcp_server tool~~
- [ ] Migrate 30 built-in tools to DynamicToolRegistry
- [x] ~~A2A protocol~~ → A2AServer + A2AClient
- [x] ~~Protocol gateway: unified API, multiple backend~~ → `ProtocolAdapter` class

### Phase 4 — Evolution & Safety
- [x] ~~Constraint manifold~~ → ConstraintManifold (Phase 4C)
- [x] Auto-trigger evolution (in-context → SFT → RL)
- [ ] Feedback loop: user rating → policy update
- [x] ~~Skill maturation lifecycle~~ → raw → validated → compiled → evolved
- [ ] Formal verification: POMDP-based execution model

---

## 📊 Status Summary

### ✅ SUDAH SELESAI (25 item)

| # | Fitur | File | Versi |
|---|-------|------|-------|
| 1 | Gap #4: Multi-dimensional verification | `verifier.ts` | v0.4.7 |
| 2 | Gap #7: Semantic cache | `semantic-cache.ts` | v0.4.8 |
| 3 | P0-P3 Reliability hardening | Multiple | v0.5.3 |
| 4 | Chat mode fix | `llm.ts` | v0.5.2 |
| 5 | Agent Blueprint | `agent-blueprint.ts` | v0.5.0 |
| 6 | DAG Engine | `dag-engine.ts` | v0.5.0 |
| 7 | Hierarchical Memory | `memory-orchestrator.ts` | v0.5.0 |
| 8 | A2A Protocol | `a2a-server.ts`, `a2a-client.ts` | v0.5.0 |
| 9 | MCP Client | `mcp-client.ts` | v0.5.0 |
| 10 | World Model | `world-model.ts` | v0.5.0 |
| 11 | Simulation Engine | `simulation-engine.ts` | v0.5.0 |
| 12 | Meta-Reasoner | `meta-reasoner.ts` | v0.5.0 |
| 13 | ConstraintManifold | `constraint-manifold.ts` | v0.6.0 |
| 14 | Multi-Provider Auto Fallback | `llm.ts` | v0.6.0 |
| 15 | **Confidence scoring signal wiring** | `execution-helpers.ts`, `agent-loop.ts` | v0.6.0 |
| 16 | **Cost-aware routing** (weighting) | `model-registry.ts`, `llm.ts` | v0.6.0 |
| 17 | **Working memory query** | `memory-orchestrator.ts` | v0.6.0 |
| 18 | **Graph Harness 3-layer separation** | `planning-layer.ts`, `execution-layer.ts`, `recovery-layer.ts` | v0.6.0 |
| 19 | **Immutable plan enforcement** | `planning-layer.ts` `createPlanVersion()` | v0.6.0 |
| 20 | **Strict escalation chain** | `agent-loop.ts` recovery while-loop | v0.6.0 |
| 21 | **Cost-aware auto-switch (enhanced)** | `llm.ts` budget-aware + tracking + all categories | v0.6.0 |
| 22 | **Procedural memory depth** | `memory-orchestrator.ts` trace query + pattern extraction + pruning | v0.6.0 |
| 23 | **Auto-trigger evolution** | `continuous-evolution.ts`, `index.ts` EventBus wiring | v0.6.0 |
| 24 | **ProtocolAdapter (unified gateway)** | `protocol-adapter.ts` | v0.6.0 |
| 25 | **MCP-first infrastructure** | `dynamic-tool-registry.ts`, `mcp-server.ts`, `agentic_mcp_server` tool | v0.6.0 |

### ⚠️ PARTIAL (0 item)

*(Semua PARTIAL item dari sesi sebelumnya sudah selesai)*

### ❌ BELUM (5 item)

| # | Fitur | Keterangan |
|---|-------|------------|
| 1 | Session bridging | Cross-platform session (VS Code ↔ CLI) |
| 2 | Migrate 30 tools to DynamicToolRegistry | Infrastruktur (DynamicToolRegistry + MCPServer) ✅, migrasi 30 tool definitions belum |
| 3 | Tool versioning | Belum ada versioning system |
| 4 | RL pipeline | Reinforcement learning dari execution outcomes |
| 5 | POMDP verification | Formal verification model |

---

## 📊 Perbandingan: Sekarang vs Target

| Dimensi | Sekarang | Target (Agnostic Smart) |
|---------|----------|------------------------|
| **LLM Provider** | Multi-provider fallback ✅ | Optimal per-task routing |
| **Control Flow** | 3-layer Graph Harness ✅ | 3-layer terpisah |
| **Agent Spec** | Blueprint interface ✅ | Multi-env deployment |
| **Memory** | 4-level + procedural depth ✅ | + Working query + Procedural depth |
| **Tools** | DynamicToolRegistry + MCPServer ✅ | MCP-first + dynamic discovery |
| **Protocol** | Unified gateway ✅ | Unified gateway |
| **Evolution** | Auto-trigger ✅ | Full auto (in-context → SFT → RL) |
| **Safety** | ConstraintManifold ✅ | + POMDP verification |
| **Context** | DAG-structured ✅ | + Bounded by depth |

---

## 🔬 Metrics Target

| Metrik | Sekarang | Target |
|--------|----------|--------|
| Task success rate | ~70% | >80% |
| Error recovery | 100% | >90% (tapi task sukses naik) |
| Latency overhead | Medium (DAG) | -60% (DAG parallel execution) |
| Model utilization | Multi-provider fallback ✅ | N model, optimal per-task |
| Memory efficiency | Hierarchical ✅ | Sub-linear growth (consolidation) |
| Time to evolve | Semi-auto ⚠️ | Auto-triggered |

---

## 📝 Commit History

| Tanggal | Commit | Deskripsi |
|---------|--------|-----------|
| 2026-06-20 | `v0.4.7` | Gap #4 verification fidelity + trace dedup |
| 2026-06-20 | `v0.4.8` | Gap #7 semantic cache |
| 2026-06-24 | `v0.5.3` | P0-P3 reliability hardening |
| 2026-06-25 | `7df6472` | ConstraintManifold (Phase 4C) + Skill Lifecycle (Phase 4A) |
| 2026-06-25 | `6035995` | Graph Harness 3-layer: PlanningLayer, ExecutionLayer, RecoveryLayer + Immutable plan enforcement (createPlanVersion) + Export layers + 47 PL/EL/RL tests |
| 2026-06-25 | `982d664` | Multi-provider auto fallback for LLM calls (Phase 3B) |
| 2026-06-25 | `43e1ce4` | Auto-trigger evolution: EventBus per-step wiring + cumulativeResults milestone fix |
| 2026-06-25 | `6fa84a3` | ProtocolAdapter: unified MCP+A2A gateway + ProtocolAdapter a2aClient null-safety fix |
| 2026-06-25 | `6fa84a3` | MCP-first infrastructure: DynamicToolRegistry + MCPServer + agentic_mcp_server tool + 96 tests |

---

## 🎯 Next Steps (Rekomendasi)

Prioritas berdasarkan dampak vs effort:

### 🔴 Priority 1 — High Impact, Medium Effort

| Item | Alasan |
|------|--------|
| **MCP-first tools** (30 hardcoded → MCP-based) | Paling transformatif: semua tool bisa dynamic register/unregister, third-party bisa add tools tanpa plugin update. Core arsitektur berubah. |
| **Session bridging** (VS Code ↔ CLI) | Cross-platform session = memory + plan persist lintas env. Gap besar buat enterprise adoption. |

### 🟡 Priority 2 — Medium Impact, Low/Medium Effort

| Item | Alasan |
|------|--------|
| **Tool versioning** | Version pinning + migration path buat breaking changes. Prasyarat buat MCP-first. |
| **Feedback loop** (user rating → policy update) | Rating sudah ada di `agentic_execute`, tinggal wiring ke policy auto-update. Effort kecil. |

### 🟢 Priority 3 — High Impact, High Effort

| Item | Alasan |
|------|--------|
| **RL pipeline** | Dari execution outcomes → reward model → policy gradient. Prasyarat: butuh banyak data (ribuan episode). |
| **POMDP verification** | Formal model buat execution verification. Butuh riset matematis. |

### 📋 Rekomendasi Immediate

1. **✅ MCP-first infrastructure** (DynamicToolRegistry + MCPServer + agentic_mcp_server) — SELESAI.
2. **Migrate 30 built-in tools to DynamicToolRegistry** — langkah selanjutnya. Setiap tool perlu didaftarkan ke registry agar bisa di-discover via MCP. Butuh bantuan auto-converter dari Zod schema → JSON Schema.
3. Setelah migrasi 30 tool selesai, lanjut **Session bridging** (memory persist lintas env).
4. Barengan: **Feedback loop** (low effort, high UX impact).
