# Library Slicing — opencode-agentic-engine

> Memecah monolith plugin menjadi library-library kecil yang reusable, testable, dan installable di platform lain.

## Filosofi

```
Plugin opencode-agentic-engine (monolith)
  │
  ├── @opencode/agentic-core       ← Orchestrator, Planner, Executor, AgentLoop, ToolSystem 🔵 (retain in plugin)
  ├── @opencode/rag-kit            ← MultiIndexRAG, VectorStore, Embedder ✅
  ├── @opencode/simple-budget      ← BudgetTracker (circuit breaker) ✅
  ├── @opencode/text-sim           ← stopwords, TF-IDF, cosine similarity ✅
  ├── @opencode/confidence-scorer  ← ConfidenceScorer, ConfidenceStore ✅
  ├── @opencode/code-sandbox       ← CodeSandbox, CodeModuleRegistry ✅
  ├── @opencode/hallucination-guard← HallucinationGuard ✅
  ├── @opencode/prompt-composer    ← PromptTemplate (XML builder) ✅
  ├── @opencode/tech-debt-analyzer ← TechDebtScorer ✅
  ├── @opencode/simple-persistence ← StateStore ✅
  └── @opencode/event-bus          ← EventBus ✅
```

Setiap library:
- **Berdiri sendiri** — 0 atau minimal dependency
- **Test sendiri** — focused test suite per library
- **Version sendiri** — semver independent
- **Platform-agnostic** — bisa dipake di Node.js, browser, Deno, Bun

---


## Status: ✅ All Extracted

| # | Library | Repo | Tests | Deps |
|---|---------|------|-------|------|
| 1 | `@opencode/simple-budget` | [github](https://github.com/rahadiana/simple-budget) | 9 | 0 |
| 2 | `@opencode/code-sandbox` | [github](https://github.com/rahadiana/code-sandbox) | 9 | 0 (vm) |
| 3 | `@opencode/rag-kit` | [github](https://github.com/rahadiana/rag_kit) | 167 | zod, mcp |
| 4 | `@opencode/text-sim` | [github](https://github.com/rahadiana/text-sim) | 40 | 0 |
| 5 | `@opencode/confidence-scorer` | [github](https://github.com/rahadiana/confidence-scorer) | 19 | 0 |
| 6 | `@opencode/hallucination-guard` | [github](https://github.com/rahadiana/hallucination-guard) | 3 | 0 (fs) |
| 7 | `@opencode/prompt-composer` | [github](https://github.com/rahadiana/prompt-composer) | 7 | 0 |
| 8 | `@opencode/tech-debt-analyzer` | [github](https://github.com/rahadiana/tech-debt-analyzer) | 6 | 0 |
| 9 | `@opencode/simple-persistence` | [github](https://github.com/rahadiana/simple-persistence) | 6 | 0 (fs) |
| 10 | `@opencode/event-bus` | [github](https://github.com/rahadiana/event-bus) | 10 | 0 |

**Total:** 10 libraries extracted, 276+ tests, 0 external runtime dependencies.

`@opencode/agentic-core` tetap di plugin — ini inti orchestrator yang spesifik ke OpenCode.

---

## Strategi Ekstraksi

### Phase 1 — Mudah (0 dep) ✅

```
simple-budget     456 line  → ✅ event-bus
confidence-scorer  498 line  → ✅ confidence-scorer
prompt-composer    210 line  → ✅ prompt-composer
tech-debt-analyzer 153 line  → ✅ tech-debt-analyzer
event-bus           91 line  → ✅ event-bus
                     ─────
                  1.408 line total
```

**Cara:** copy file → tambah `package.json` + `tsconfig.json` + test → publish.

### Phase 2 — Butuh bundling (2-4 file) ✅

```
code-sandbox       593 line  → ✅ code-sandbox
hallucination-guard 268 line  → ✅ hallucination-guard
rag-kit           1.842 line  → ✅ rag_kit
                     ─────
                  2.703 line total
```

### Phase 3 — Butuh decoupling ✅

```
text-sim           207 line  → ✅ text-sim
simple-persistence  389 line  → ✅ simple-persistence
                     ─────
                    596 line total
```

---

## Manfaat

| Sebelum (monolith) | Sesudah (library) |
|--------------------|-------------------|
| `src/index.ts` 1.503 line | `index.ts` ~200 line (import + wiring) |
| 1 `package.json` | 1 root + 10 library `package.json` |
| 1 test suite (3718 tests) | 10 focused test suites |
| Semua rilis bareng | Versioning independent per library |
| Cuma bisa di OpenCode | Install di mana aja (Node/Deno/Bun) |
| Satu error bikin semua kena | Isolated, error cuma di 1 library |

---

## Resiko & Mitigasi

| Resiko | Mitigasi |
|--------|----------|
| **Circular dependency** | Library tidak boleh saling import — DAG murni |
| **API breaking change** | Semver + migration guide |
| **Test duplication** | Shared test helpers, masing-masing punya fokus sendiri |
| **Monorepo complexity** | Gunakan npm workspaces — 1 `npm install` buat semua |
| **Overhead maintenance** | 10 repo > 1 repo? Gunakan monorepo (`packages/`) |
