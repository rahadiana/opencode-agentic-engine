# Plan #26: Agentic Agnostic Smart Architecture

> **Tujuan**: Menerapkan 7 prinsip agentic agnostic dari riset terbaru (2026) ke opencode-agentic-engine — biar plugin ini gak cuma "tool caller" tapi smart agentic system yang vendor-agnostic, protocol-agnostic, dan self-evolving.

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

**Target implementasi:**
```typescript
// Task-based model routing
llmEngine.call({
  task: 'reasoning'  // → route ke model kuat (claude-sonnet)
})
llmEngine.call({
  task: 'classification'  // → route ke model kecil/cepat
})
```

- [ ] Buat task classifier → pilih model optimal per task type
- [ ] Implementasi auto fallback kalo model utama gagal
- [ ] Cache warm: DSG-style semantic + exact cache (udah ada Gap #7)
- [ ] Cost-aware routing: track token cost per model, auto-switch

### 2️⃣ Protocol Agnostic — Multi-Protocol Gateway

**Masalah**: Plugin cuma pake OpenCode SDK (`client.session.prompt()`). Gak bisa interop dengan sistem lain.

**Dari riset:**
- **STEM Agent** (arXiv:2603.22359): 5 protocols (A2A, AG-UI, A2UI, UCP, AP2) di belakang unified gateway
- **MCP** (Model Context Protocol): Standard buat tool integration

**Target implementasi:**
- [ ] MCP client improvements: lebih dari sekedar list/connect
- [ ] A2A (Agent-to-Agent) protocol support: agent dari framework lain bisa komunikasi
- [ ] Protocol adapter pattern: 1 interface, banyak protocol backend
- [ ] Session bridging: session lintas platform

### 3️⃣ Model Agnostic — Cognitive Blueprint ≠ Runtime

**Masalah**: Agent definition nyatu sama kode. Gak ada "agent spec" yang portable.

**Dari riset:**
- **Auton** (arXiv:2602.23720): Cognitive Blueprint = declarative spec (YAML/JSON), language-agnostic. Runtime Engine = platform-specific
- Analogi Kubernetes: spec → deploy ke mana aja

**Target implementasi:**
```yaml
# agent-blueprint.yaml
agent:
  name: code-reviewer
  identity: "You are a strict code reviewer"
  capabilities:
    - analyze_code
    - suggest_fixes
    - security_audit
  memory:
    type: hierarchical
    retention: 30d
  safety:
    loop_detection: true
    max_steps: 25
    circuit_breaker: true
  models:
    reasoning: claude-sonnet-4
    quick: gpt-4o-mini
```

- [ ] Buat `AgentBlueprint` interface — declarative agent spec
- [ ] Blueprint parser: YAML/JSON → runtime config
- [ ] Blueprint registry: versionable, auditable
- [ ] Multi-env deployment: OpenCode plugin, standalone CLI, MCP server

### 4️⃣ Control Agnostic — Program Control Flow, LLM Hanya Reasoning

**Masalah**: Sekarang LLM yang orkestrasi semuanya (via agent loop). Ini architectural mistake menurut paper.

**Dari riset:**
- **LLM-as-Code** (arXiv:2606.15874): "LLM should NOT be the orchestrator; the program should control the flow"
- **Graph Harness** (arXiv:2604.11378): Loop-based execution → DAG-based execution. 3 layers independent: planning, execution, recovery
- **Omnigent**: Circuit breaker + hash-based loop detection + rate limiting

**Target implementasi:**
```
Current (LLM orchestrates):
  agent_loop → LLM decides next step → LLM calls tool → LLM decides again

Target (Code orchestrates):
  Plan (DAG) → Executor runs DAG → LLM called only per node → Recovery on failure
```

**Struktur DAG:**
```typescript
interface DAGNode {
  id: string
  type: 'plan' | 'execute' | 'verify' | 'reflect'
  llmRequired: boolean  // false = deterministic (e.g. compile check)
  deps: string[]
  config: {
    model?: string       // per-node model override
    timeout: number
    retryStrategy: 'none' | 'linear' | 'exponential'
  }
}

interface DAGPlan {
  nodes: DAGNode[]
  metadata: {
    maxParallel: number
    circuitBreaker: boolean
    recoveryStrategy: 'restart-node' | 'restart-plan' | 'escalate'
  }
}
```

- [ ] Refactor agent-loop.ts → DAG-based, bukan while(true) loop
- [ ] Pisaahin PlanningLayer, ExecutionLayer, RecoveryLayer
- [ ] Immutable plan: plan gak berubah selama eksekusi (kecuali explicit re-plan)
- [ ] Strict escalation: recovery → restart node → restart plan → human escalation
- [ ] Circuit breaker: hash-based loop detection + max steps + token budget

### 5️⃣ Tool Agnostic — MCP-First Tool Integration

**Masalah**: Tool definitions hardcoded di plugin. Setiap tool butuh implementasi manual.

**Dari riset:**
- **STEM Agent**: MCP sebagai satu-satunya jalan tools. Gak ada tool binding langsung
- **DeepAgent** (arXiv:2510.21618): Dynamic tool discovery — tools gak di-pre-fetch, dicari pas perlu
- **Auton**: MCP sebagai standard tool integration

**Target implementasi:**
- [ ] MCP-first: semua tool internal juga lewat MCP (bukan handler langsung)
- [ ] Dynamic tool registry: tools bisa ditambah/dikurang runtime via MCP
- [ ] Tool discovery: cari tool based on task description
- [ ] Tool sandbox: eksekusi tool di isolated environment
- [ ] Tool versioning: tools punya version + migration path

### 6️⃣ Memory Agnostic — Hierarchical + Consolidation

**Masalah**: Memory sekarang flat — session store + episodic store. Gak ada consolidation.

**Dari riset:**
- **Auton**: Hierarchical memory consolidation inspired by biological episodic memory
- **STEM Agent**: 4-type memory (episodic, semantic, procedural, working) + consolidation (episodic pruning, semantic deduplication, pattern extraction)
- **OpenSage**: Graph-based hierarchical memory

**Target implementasi:**
```
Hierarchical Memory:
  Level 1: Working Memory (current session — transient)
    ↓ consolidation (episodic pruning)
  Level 2: Episodic Memory (past sessions — time-bound)
    ↓ consolidation (pattern extraction, dedup)
  Level 3: Semantic Memory (skills, knowledge — persistent)
    ↓ consolidation (RL / fine-tuning)
  Level 4: Procedural Memory (agent skills — compiled)
```

- [ ] Refactor memory: working → episodic → semantic → procedural
- [ ] Consolidation scheduler: periodic pruning + dedup + pattern extraction
- [ ] Forgetting mechanism: importance-based, bukan cuma TTL
- [ ] Memory query: search di semua level, ranked by relevance + recency

### 7️⃣ Evolution Agnostic — Self-Evolving dari In-Context sampai RL

**Masalah**: Evolusi sekarang manual (agentic_evolve, agentic_finetune). Gak otomatis.

**Dari riset:**
- **Auton**: 3-level evolution — in-context → supervised fine-tuning → reinforcement learning
- **AutoAgent**: Self-play agent customization — natural language → XML schema → iteratif improvement
- **OpenSage**: Self-programming — AI bikin sub-agent + tools sendiri
- **RAAS** (CVPR 2026): GRPO-based architecture search — otomatis nyari workflow optimal

**Target implementasi:**
```
Evolution Ladder:
  Level 1: In-Context (skill extraction — udah ada)
    ↓ auto-trigger after N successful repetitions
  Level 2: Skill Compilation (skill → reusable module — partial)
    ↓ auto-trigger after confidence > 0.8
  Level 3: Fine-Tuning (skill → training data → fine-tune — udah ada agentic_finetune)
    ↓ auto-trigger per batch
  Level 4: RL from Feedback (user feedback → reward → policy update)
    ↓ auto-trigger per session
  Level 5: Architecture Search (RAAS-style — GRPO optimization)
    ↓ periodic
```

- [ ] Auto-trigger evolution: gak manual lagi
- [ ] Feedback loop: user rating → reward signal → policy update
- [ ] Skill maturation lifecycle: raw → validated → compiled → evolved
- [ ] Architecture search: coba multiple workflow patterns, pilih best

---

## 🗺️ Roadmap Implementasi

### Phase 1 — Foundation (Sekarang)
- [x] Gap #4: Multi-dimensional verification (security, perf, arch, deps)
- [x] Gap #7: Semantic cache (TF-IDF + cosine similarity)
- [x] P0-P3 hardening: error classes, timeout aborts, type safety
- [x] Chat mode fix: temp child session instead of hanging
- [ ] **Blueprint interface**: declarative agent spec
- [ ] **DAG-based execution**: refactor agent loop

### Phase 2 — Control & Memory
- [ ] Separation: PlanningLayer, ExecutionLayer, RecoveryLayer
- [ ] Immutable plan: DAG yang gak berubah runtime
- [ ] Circuit breaker: loop detection + rate limiting
- [ ] Hierarchical memory: working → episodic → semantic → procedural
- [ ] Consolidation scheduler: pruning + dedup otomatis

### Phase 3 — Provider & Protocol
- [ ] Task-based model routing (DSG-style)
- [ ] Multi-provider dengan auto fallback
- [ ] MCP-first: semua tool lewat MCP
- [ ] A2A protocol: interop dengan agent framework lain
- [ ] Protocol gateway: unified API, multiple backend

### Phase 4 — Evolution & Safety
- [ ] Auto-trigger evolution (in-context → SFT → RL)
- [ ] Feedback loop: user rating → policy update
- [ ] Skill maturation lifecycle
- [ ] Constraint manifold: safety enforcement by design
- [ ] Formal verification: POMDP-based execution model

---

## 📊 Perbandingan: Sekarang vs Target

| Dimensi | Sekarang | Target (Agnostic Smart) |
|---------|----------|------------------------|
| **LLM Provider** | Single (session default) | Multi-provider routing + fallback |
| **Control Flow** | LLM-driven loop (while true) | Code-driven DAG |
| **Agent Spec** | Hardcoded in plugin | Declarative blueprint (YAML/JSON) |
| **Memory** | Flat (session + episodic) | Hierarchical (4-level, consolidation) |
| **Tools** | Hardcoded handlers | MCP-first, dynamic discovery |
| **Protocol** | OpenCode SDK only | Multi-protocol gateway |
| **Evolution** | Manual | Auto (in-context → SFT → RL) |
| **Safety** | Post-hoc filtering | By-design (constraint manifold) |
| **Context** | Sliding window | DAG-structured, bounded by depth |

---

## 🔬 Metrics Target

| Metrik | Sekarang | Target |
|--------|----------|--------|
| Task success rate | 42% | >80% |
| Error recovery | 100% | >90% (tapi task sukses naik) |
| Latency overhead | High (LLM loop) | -60% (DAG parallel execution) |
| Model utilization | 1 model | N model, optimal per-task |
| Memory efficiency | Flat | Sub-linear growth (consolidation) |
| Time to evolve | Manual | Auto-triggered |
