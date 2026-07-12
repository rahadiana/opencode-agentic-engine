# Library Slicing — opencode-agentic-engine

> Memecah monolith plugin menjadi library-library kecil yang reusable, testable, dan installable di platform lain.

## Filosofi

```
Plugin opencode-agentic-engine (monolith)
  │
  ├── @opencode/agentic-core       ← Orchestrator, Planner, Executor, AgentLoop, ToolSystem
  ├── @opencode/rag-kit            ← MultiIndexRAG, VectorStore, Embedder
  ├── @opencode/simple-budget      ← BudgetTracker (circuit breaker)
  ├── @opencode/text-sim           ← stopwords, TF-IDF, cosine similarity
  ├── @opencode/confidence-scorer  ← ConfidenceScorer, ConfidenceStore
  ├── @opencode/code-sandbox       ← CodeSandbox, CodeModuleRegistry
  ├── @opencode/hallucination-guard← HallucinationGuard
  ├── @opencode/prompt-composer    ← PromptTemplate (XML builder)
  ├── @opencode/tech-debt-analyzer ← TechDebtScorer
  ├── @opencode/simple-persistence ← StateStore
  └── @opencode/event-bus          ← EventBus
```

Setiap library:
- **Berdiri sendiri** — 0 atau minimal dependency
- **Test sendiri** — focused test suite per library
- **Version sendiri** — semver independent
- **Platform-agnostic** — bisa dipake di Node.js, browser, Deno, Bun

---

## 1. `@opencode/simple-budget` ⚡ Prioritas #1

**File:** `src/core/budget-tracker.ts`  
**Ukuran:** 456 lines  
**Dep:** 0 (pure TypeScript)

### API

```typescript
class BudgetTracker {
  constructor(config?: BudgetConfig)
  
  setLimit(scope: BudgetScope, limit: BudgetLimit): void
  getLimit(scope: BudgetScope): BudgetLimit
  getUsage(scope: BudgetScope): BudgetUsage
  
  check(scope: BudgetScope, cost: CostEstimate): BudgetDecision
  spend(scope: BudgetScope, cost: CostEstimate): void
  
  reset(scope?: BudgetScope): void
  getStatus(): BudgetStatus
}
```

### Test

```bash
# Existing: 38 test cases di test/_runall-core.mjs [budget]
# Standalone: npm test → 38+ tests
```

### Cara Ekstrak

```bash
mkdir -p packages/simple-budget/src packages/simple-budget/test
cp src/core/budget-tracker.ts packages/simple-budget/src/
# Buat package.json, tsconfig.json, test runner
```

---

## 2. `@opencode/code-sandbox` ⚡ Prioritas #2

**File:** `src/core/code-sandbox.ts`  
**Ukuran:** 593 lines  
**Dep:** `node:vm`, `node:crypto` (Node builtins)

### API

```typescript
class CodeSandbox {
  constructor(registry?: CodeModuleRegistry)
  
  execute(code: string, input: unknown, timeout?: number): SandboxExecutionResult
  runTests(code: string, testCases: TestCase[], timeout?: number): TestResult
  getRegistry(): CodeModuleRegistry
}

class CodeModuleRegistry {
  register(name: string, code: string, meta?: ModuleMeta): void
  get(name: string): CodeModule | undefined
  remove(name: string): void
  list(): CodeModule[]
  find(query: string): CodeModule[]
}

function sandboxExecute(code: string, input: unknown, timeout?: number): SandboxExecutionResult
function runSandboxTests(code: string, testCases: TestCase[], timeout?: number): TestResult
function checkBannedTokens(code: string, customTokens?: BannedToken[]): BannedTokenIssue[]
```

### Catatan Platform

- **Node.js:** ✅ `node:vm` native
- **Deno:** ⚠️ Perlu `--allow-run` atau pake WebAssembly sandbox
- **Browser:** ❌ `node:vm` tidak ada → fallback Web Worker

---

## 3. `@opencode/rag-kit` ✅ **Selesai**

**Repo:** `https://github.com/rahadiana/rag_kit`  
**Versi:** 0.1.0  
**Lisensi:** MIT  
**Test:** 167 tests, coverage 97.88% stmts / 86.92% branch

### Status

| Aspek | Keterangan |
|-------|-----------|
| **Core critical path** | ✅ Hybrid retrieval, SCIM quality, KbPO boundary, full MMKP, MDP, adaptive, feedback loop |
| **Advanced features** | ✅ Knowledge Graph, QueryDecomposer, CrossEncoderReranker, HyDE, AutoTuner, PatternLearner, ContinualLearner |
| **Plugin extension points** | ✅ `QueryCache`, `RagEventCallback`, `TokenFilter`, `PersistHook`, `autoFeedback` — interface-based, host-agnostic |
| **Adapters** | ✅ MCP stdio server, CLI, `toTools()` for any host framework |
| **Host-agnostic** | ✅ Zero import dari SDK manapun — OpenCode/Claude/Cursor agnostic |

### Architecture

```
src/
├── types/          Shared contracts
├── ingest/         Load text / file / directory
├── chunk/          Recursive + Section chunker
├── embed/          LocalEmbedder + ContinualLearner
├── store/          HybridStore (TF-IDF + dense) + KnowledgeGraph
├── retrieve/       searchWithConfidence + QueryDecomposer + HyDE + Reranker
├── quality/        SCIM scorer: dimensions, staleness, decay
├── boundary/       KbPO 4-quadrant + noise detection
├── context/        Full MMKP token-budget optimizer
├── agentic/        Adaptive, MDP, graders, AutoTuner, AgenticLoop
├── feedback/       Closed-loop write-back + PatternLearner
├── persist/        JSON snapshot persistence
└── adapters/       toTools, MCP, CLI
```

### Extension Points (untuk integrasi ke plugin)

| Interface | Config Key | Plugin implements | Di rag_kit |
|-----------|-----------|------------------|------------|
| `QueryCache` | `cache` | TTL + prefix match cache (`system.transform`) | Opsional |
| `RagEventCallback` | `onEvent` | `EventBus.emit()` → observability pipeline | Opsional |
| `TokenFilter` | `tokenFilter` | Auto-wired via `@opencode/text-sim` (58 bahasa) ✅ | **Default** |
| `PersistHook` | `persistHooks` | `StateStore` write-behind queue | Opsional |

> **Catatan:** `TokenFilter` sudah auto-wired oleh rag_kit via `@opencode/text-sim`. Plugin tidak perlu provide manual stopwords filter lagi — cukup install `stopwords-iso` untuk 58 bahasa.

### Cara Integrasi ke Plugin

```typescript
import { createRagKit } from "rag-kit"

// Adapter di plugin: src/memory/rag-kit-adapter.ts
// TokenFilter sudah auto-wired dari @opencode/text-sim — tidak perlu manual
const rag = createRagKit({
  cache: new AgenticRagCache(),       // QueryCache (opsional)
  onEvent: (e) => eventBus.emit(e),   // RagEventCallback (opsional)
  persistHooks: [new StateStoreHook(stateStore)], // PersistHook (opsional)
  agentic: { autoFeedback: true },
})
```

### Untuk Plugin Sekarang

Internal `MultiIndexRAG` + `RAGSelfImprovePipeline` masih jadi default.  
`rag_kit` bisa diaktifkan via config toggle (`"rag.kit": true`) — lihat `src/memory/rag-kit-adapter.ts` (Fase 1).

---

## 4. `@opencode/text-sim` ✅ **Selesai**

**Repo:** `https://github.com/rahadiana/text-sim`  
**Versi:** 0.1.0  
**Lisensi:** MIT  
**Test:** 40 tests, 0 runtime dependencies

### Status

| Aspek | Keterangan |
|-------|-----------|
| **Core primitives** | ✅ `tokenize()`, `tokenizeRaw()`, `STOP_WORDS`, `isStopWord()`, `filterStopWords()` |
| **TF-IDF** | ✅ `computeTf()`, `computeIdf()`, `computeTfIdf()`, `computeTfIdfEntries()` |
| **Similarity** | ✅ `cosineSimilarity()`, `jaccardSimilarity()`, `euclideanDistance()` |
| **Multilingual** | ✅ 58 bahasa via `stopwords-iso` (opsional) |
| **Zero dependency** | ✅ Runtime: 0 deps |
| **Tree-shakeable** | ✅ 4 entry points |

### File

```
src/
├── index.ts          # Re-export semua
├── types.ts          # Shared types (TokenizeOptions, TfIdfEntry, StopWordStats)
├── stopwords.ts      # STOP_WORDS, isStopWord, filterStopWords, getStopWordStats
├── tokenize.ts       # tokenize(), tokenizeRaw()
└── tfidf.ts          # computeTf, computeIdf, cosineSimilarity, jaccard, euclidean

test/
└── run.mjs           # 40 tests, plain assertions
```

### Perubahan dari Plugin

1. **ESM native** — `createRequire` dari `node:module`
2. **Logger dihapus** — ganti `createLogger()` → `console.warn`/`console.debug`
3. **`tokenize()` API** — positional params → `TokenizeOptions` object
4. **Fungsi baru** — `tokenizeRaw()`, `computeIdf()`, `computeTfIdf()`, `computeTfIdfEntries()`, `jaccardSimilarity()`, `euclideanDistance()`

### Integrasi

```bash
npm install @opencode/text-sim
# Optional: npm install stopwords-iso
```

```typescript
import { tokenize, computeTf, cosineSimilarity } from "@opencode/text-sim"
```

Bisa dijadikan optional dependency `rag_kit` untuk stopwords 58 bahasa + TF-IDF standalone.

---

## 5. `@opencode/confidence-scorer` ✅ **Selesai**

**Repo:** `https://github.com/rahadiana/confidence-scorer`  
**Versi:** 0.1.0  
**Lisensi:** MIT  
**Test:** 19 tests, 0 runtime dependencies

**3 entry points:** `index` (all), `scorer`, `store`

```typescript
import { ConfidenceScorer, ConfidenceStore } from "@opencode/confidence-scorer"

const scorer = new ConfidenceScorer()
const score = scorer.score({
  stepId: "step-1",
  compileResult: { passed: true },
  testResult: { passed: true, total: 42, passedCount: 42 },
})
console.log(score.overall)  // 0-1
```

---

## 6. `@opencode/hallucination-guard` 🟡 Prioritas #6

**File:** `src/drift/hallucination-guard.ts`  
**Ukuran:** 268 lines  
**Dep:** `node:fs`, `node:path`

### API

```typescript
class HallucinationGuard {
  constructor(worktree: string)
  
  check(executionOutput: string, modifiedFiles: string[]): HallucinationCheck
  extractFileClaims(text: string): string[]
  extractFunctionClaims(text: string): FunctionClaim[]
  extractImportClaims(text: string): string[]
}
```

### Catatan Platform

- Bergantung ke file system (verifikasi file/fungsi beneran ada)
- Bisa diadaptasi untuk browser dengan `virtualFs` parameter

---

## 7. `@opencode/prompt-composer` 🔵 Prioritas #7

**File:** `src/core/prompt-template.ts`  
**Ukuran:** 210 lines  
**Dep:** 0 (pure TypeScript)

### API

```typescript
class PromptTemplate {
  title(value: string): this
  identity(content: string, when?: boolean): this
  instructions(content: string, when?: boolean): this
  guardrails(content: string, when?: boolean): this
  knowledge(content: string, when?: boolean): this
  injectKnowledge(entries: KnowledgeEntry[], when?: boolean): this
  
  render(): string
  renderWithFrontmatter(description: string): string
}
```

---

## 8. `@opencode/tech-debt-analyzer` 🔵 Prioritas #8

**File:** `src/core/tech-debt-scorer.ts`  
**Ukuran:** 153 lines  
**Dep:** 0 (pure TypeScript)

### API

```typescript
class TechDebtScorer {
  score(files: string[], projectDir: string, allFiles?: string[]): TechDebtResult
  analyzeFile(filePath: string): FileAnalysis
}
```

---

## 9. `@opencode/simple-persistence` 🔵 Prioritas #9

**File:** `src/core/state-store.ts`  
**Ukuran:** 389 lines  
**Dep:** `node:fs`, `node:path`, `node:os` + logger (replacable)

### API

```typescript
class StateStore {
  constructor(config?: StoreConfig)
  
  get<T>(namespace: string, key: string): T | undefined
  set<T>(namespace: string, key: string, value: T): void
  delete(namespace: string, key: string): boolean
  list(namespace: string): string[]
  clear(namespace?: string): void
  
  getAll<T>(namespace: string): T[]
  flush(): void  // sync ke disk
}
```

---

## 10. `@opencode/event-bus` 🔵 Prioritas #10

**File:** `src/core/event-bus.ts`  
**Ukuran:** 91 lines  
**Dep:** 1 type import (replacable)

### API

```typescript
class EventBus {
  on(type: string, handler: EventHandler): void
  off(type: string, handler: EventHandler): void
  emit(event: AgenticEvent): void
  onAny(handler: (event: AgenticEvent) => void): void
  clear(): void
}
```

---

## Strategi Ekstraksi

### Phase 1 — Mudah (0 dep)

```
simple-budget     456 line  → 1 file
confidence-scorer  498 line  → 1 file
prompt-composer    210 line  → 1 file
tech-debt-analyzer 153 line  → 1 file
event-bus           91 line  → 1 file
                     ─────
                  1.408 line total
```

**Cara:** copy file → tambah `package.json` + `tsconfig.json` + test → publish.

### Phase 2 — Butuh bundling (2-4 file)

```
code-sandbox       593 line  → 1 file + types
hallucination-guard 268 line  → 1 file
rag-kit           1.842 line  → 4 files
                     ─────
                  2.703 line total
```

### Phase 3 — Butuh decoupling

```
text-sim           207 line  → extract dari rag-kit
simple-persistence  389 line  → replace logger dep
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
