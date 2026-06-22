# src/core — Agentic Engine Core

> Modul inti dari agentic engine. Berisi implementasi agent loop, planning, execution, verification, error analysis, budget tracking, model registry, formal model, event system, dan domain-specific packs.

---

## Daftar File

### 1. `agent-loop.ts`
Agent loop otonom — menjalankan iterasi plan → execute → verify → retry sampai selesai atau max iterations. Mendukung batch processing dengan conflict detection untuk parallel safe execution.

| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `AgentLoop` | `(llm: LLMEngine, config?: Partial<AgentLoopConfig>)` | `AgentLoop` | Kelas utama loop eksekusi agent |
| `AgentLoop.addObserver` | `(observer: LoopObserver)` | `void` | Mendaftarkan observer untuk hooks lifecycle |
| `AgentLoop.runLoop` | `(sessionId, executor, verifier, errorAnalyzer, depTracker, projectDir, stepExecutor, fixExecutor?)` | `Promise<LoopResult>` | Menjalankan loop utama hingga selesai |

---

### 2. `auto-retry.ts`
Strategi retry otomatis dengan 4 mode rotasi (direct_fix, conservative, type_first, split_changes). Exponential backoff dengan full jitter, selective rollback file bermasalah, dan failure context injection.

| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `AutoRetryManager` | `(config?: Partial<AutoRetryConfig>)` | `AutoRetryManager` | Manager retry dengan strategy rotation |
| `canRetry` | — | `boolean` | Apakah masih bisa retry |
| `getCurrentAttempt` | — | `number` | Nomor attempt saat ini |
| `getAttempts` | — | `RetryAttempt[]` | Semua attempt yang sudah dilakukan |
| `getLastAttempt` | — | `RetryAttempt \| null` | Attempt terakhir |
| `getConfig` | — | `AutoRetryConfig` | Config saat ini |
| `getStrategyForAttempt` | `(attempt: number)` | `RetryStrategy` | Strategy untuk attempt tertentu |
| `getBackoffDelay` | `(attempt: number)` | `number` | Exponential backoff dengan full jitter |
| `recordAttempt` | `(error, analysis, rolledBackFiles)` | `void` | Catat attempt yang gagal |
| `getFilesToRollback` | `(analysis, allModified, compileError)` | `string[]` | Selective rollback file bermasalah |
| `buildRetryPrompt` | `(originalGoal, lastError, analysis, strategy, successfullyWrittenFiles)` | `string` | Bangun retry prompt dengan failure context |
| `reset` | — | `void` | Reset state untuk session baru |
| `getRetrySummary` | — | `string` | Buat summary retry |

---

### 3. `budget-tracker.ts`
Sirkuit pemutus berbasis resource (token, steps, time, cost). PDP: set limits per scope (session/task). PEP: synchronous check sebelum eksekusi. Empat sumbu tracking + per-model ledger.

| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `BudgetTracker` | `(modelPrices?: Record<string, ModelPriceEntry>)` | `BudgetTracker` | Pelacak budget multi-sumbu |
| `setLimits` | `(scope, limits, behavior?)` | `void` | Set budget limits per scope (merge field) |
| `clearLimits` | `(scope)` | `void` | Hapus limits untuk scope |
| `getLimits` | `(scope)` | `Required<BudgetLimits>` | Dapatkan limits |
| `recordTokens` | `(modelId, inputTokens?, outputTokens?, reasoningTokens?, cacheReadTokens?, cacheWriteTokens?)` | `void` | Catat pemakaian token |
| `recordStep` | — | `void` | Catat satu subtask step selesai |
| `pauseApproval` | — | `void` | Tandai mulai menunggu approval |
| `resumeApproval` | — | `void` | Tandai approval selesai |
| `reset` | `(scope)` | `void` | Reset semua counter |
| `check` | `(scope)` | `BudgetExceededEvent \| null` | Cek apakah budget terlampaui |
| `getState` | `(scopes: BudgetScope[])` | `BudgetState[]` | Dapatkan state lengkap |
| `setModelPrices` | `(prices)` | `void` | Override model prices runtime |

---

### 4. `config.ts`
Loader dan validator konfigurasi `.agentic/config.json`. JSON Schema-like validation, file watching otomatis, merge dengan default config.

| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `validateConfig` | `(raw: unknown)` | `{ valid, config, issues }` | Validasi konfigurasi terhadap schema |
| `ConfigLoader` | `(worktree: string)` | `ConfigLoader` | Loader konfigurasi dengan file watching |
| `load` | — | `AgenticConfigSchema` | Load config dari file, auto-create default |
| `getValidationIssues` | — | `ValidationIssue[]` | Validasi current config |
| `save` | `(config)` | `void` | Simpan config ke file |
| `get` | — | `AgenticConfigSchema` | Dapatkan current config |
| `update` | `(partial)` | `AgenticConfigSchema` | Update specific keys dan persist |
| `startWatch` | — | `void` | Watch config file untuk perubahan |
| `stopWatch` | — | `void` | Stop watching dan clear listeners |
| `onChange` | `(listener)` | `() => void` | Listen config changes (returns unsubscribe) |
| `hasEmbedding` | — | `boolean` | Cek apakah embedding dikonfigurasi |
| `effectiveMemoryMode` | — | `"lightweight" \| "full"` | Mode memory efektif |

---

### 5. `data-cleaner.ts`
Membersihkan dan merapikan output raw text — menghapus debate artifacts, reformat markdown/json, kompresi debate history, validasi struktur dengan LLM.

| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `DataCleaner` | `(llmEngine?: LLMEngine)` | `DataCleaner` | Pembersih data dengan LLM + regex |
| `setLLM` | `(llm)` | `void` | Set LLM engine |
| `clean` | `(config: CleanConfig)` | `Promise<CleanResult>` | Bersihkan raw text |
| `compressDebate` | `(rounds, finalOutput)` | `string` | Kompres debate history ke summary |
| `validate` | `(text, expectedStructure)` | `Promise<{ valid, issues }>` | Validasi text terhadap struktur |

---

### 6. `debate-loop.ts`
Executor ↔ Critic debate loop. Multi-round: executor produces draft → critic reviews → revisi hingga approved atau max rounds. Termasuk loop detection (output identik).

| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `DebateLoop` | `(llmEngine: LLMEngine)` | `DebateLoop` | Kelas debate multi-round |
| `execute` | `(config: DebateConfig)` | `Promise<DebateResult>` | Jalankan debate loop |
| `formatDebateResult` | `(result: DebateResult)` | `string` | Format hasil debate ke markdown |

---

### 7. `domain-registry.ts`
Registry domain dengan auto-detection, verifier dan error matcher per domain. Mendukung domain switching, plugin domain pack, dan formal contract per domain.

| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `DomainRegistry` | — | `DomainRegistry` | Registry domain multi-domain |
| `register` | `(pack: DomainPack)` | `void` | Daftarkan domain pack |
| `unregister` | `(name)` | `void` | Hapus domain |
| `detect` | `(input)` | `DomainPack \| null` | Deteksi domain terbaik dari input |
| `activate` | `(name)` | `boolean` | Aktifkan domain tertentu |
| `activateFor` | `(input)` | `DomainPack \| null` | Auto-detect dan activate domain |
| `getCurrentDomain` | — | `DomainName \| null` | Domain aktif saat ini |
| `getCurrentPack` | — | `DomainPack \| null` | Pack domain aktif |
| `getVerifiers` | — | `VerifierStrategy[]` | Dapatkan verifiers domain aktif |
| `getErrorMatchers` | — | `ErrorMatcher[]` | Dapatkan error matchers domain aktif |
| `getAll` | — | `DomainPack[]` | Semua domain terdaftar |
| `get` | `(name)` | `DomainPack \| undefined` | Dapatkan domain by name |
| `hasDomain` | `(name)` | `boolean` | Cek apakah domain terdaftar |

---

### 8. `error-analyzer.ts`
Menganalisis error message dengan dua mode: rule-based (domain matchers + built-in heuristics) dan LLM-based (deep analyze). Mengkategorikan error ke import/type/compile/test/runtime/unknown.

| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `ErrorAnalyzer` | — | `ErrorAnalyzer` | Penganalisis error multi-level |
| `setLLM` | `(llm)` | `void` | Set LLM untuk deep analysis |
| `hasLLM` | — | `boolean` | Cek apakah LLM tersedia |
| `setDomainRegistry` | `(registry)` | `void` | Set domain registry |
| `analyze` | `(errorMessage, modifiedFiles)` | `ErrorAnalysis` | Analisis error cepat (rule-based) |
| `analyzeDeep` | `(errorMessage, modifiedFiles)` | `Promise<ErrorAnalysis>` | Analisis error mendalam (LLM fallback) |

---

### 9. `event-bus.ts`
Lightweight Event Bus — generalisasi pola listener. Siapapun bisa emit, siapapun bisa subscribe (termasuk wildcard `*`). Menyimpan history event untuk debugging.

| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `EventBus` | — | `EventBus` | Event bus sistem |
| `on` | `(type, handler)` | `() => void` | Subscribe ke satu event type (returns unsubscribe) |
| `onAny` | `(handler)` | `() => void` | Subscribe ke semua event (wildcard) |
| `emit` | `(event: AgenticEvent)` | `void` | Emit event (sync, non-blocking) |
| `getHistory` | `(type?, limit?)` | `AgenticEvent[]` | History event terbaru |
| `clear` | — | `void` | Hapus semua subscriber dan history |

---

### 10. `event-taxonomy.ts`
Taksonomi event terpusat — unified schema untuk seluruh event system. Namespace terbagi: step.*, plan.*, pipeline.*, budget.*, guard.*, task.*, llm.*, file.*, memory.*. Termasuk producer map dan consumer map.

| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| *Type definitions* | — | — | Interface untuk setiap event type |
| `EVENT_PRODUCER_MAP` | — | `Record<string, string[]>` | Mapping event type → producer |
| `EVENT_CONSUMER_MAP` | — | `Record<string, string[]>` | Mapping event type → consumer |

---

### 11. `execution-helpers.ts`
Shared primitives untuk agentic_execute dan executePipeline: file writing (chokepoint tunggal dengan event emission), parsing JSON output LLM, dan completion recording (guard + skill extract + budget).

| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `writeFiles` | `(files, projectDir, sessionID, eventBus?, source?)` | `string[]` | Write files + emit file.written events |
| `parseFileEntries` | `(raw: string)` | `FileWriteEntry[]` | Parse JSON output LLM ke file entries |
| `recordCompletion` | `(record, deps)` | `Promise<CompletionResult>` | Blocking completion record (guard + skill + budget) |

---

### 12. `executor.ts`
Manajemen state eksekusi: inisialisasi plan, tracking completed/failed steps, dependency resolution (ready/blocked steps), retry per-category, pre/post-condition verification via formal contract.

| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `Executor` | — | `Executor` | State manager eksekusi plan |
| `setDomainRegistry` | `(registry)` | `void` | Set domain registry |
| `setBudgetTracker` | `(tracker)` | `void` | Set budget tracker |
| `verifyPreConditions` | `(stepId, description, projectDir?)` | `Promise<{ passed, summary } \| null>` | Verifikasi pre-conditions formal |
| `verifyPostConditions` | `(stepId, description, filesModified, output, errorOutput?, projectDir?)` | `Promise<{ passed, summary } \| null>` | Verifikasi post-conditions formal |
| `setRetryPolicy` | `(category, maxRetries)` | `void` | Set retry limit per error category |
| `getMaxRetries` | `(category?)` | `number` | Dapatkan max retries |
| `getRetryPolicies` | — | `Array<{ category, maxRetries }>` | Semua retry policies |
| `initExecution` | `(sessionId, plan)` | `ExecutionState` | Inisialisasi eksekusi plan |
| `getNextStep` | `(sessionId)` | `Subtask \| null` | Step berikutnya yang ready |
| `getReadySteps` | `(sessionId)` | `Subtask[]` | Semua step yang ready |
| `getBlockedSteps` | `(sessionId)` | `Array<{ id, description, blockedBy }>` | Step yang masih terblokir |
| `recordResult` | `(sessionId, result)` | `void` | Catat hasil eksekusi step |
| `recordFixAttempt` | `(sessionId, stepId, fix, success)` | `void` | Catat attempt fix |
| `canRetry` | `(sessionId, stepId, category?)` | `boolean` | Cek apakah step bisa di-retry |
| `getRetryCount` | `(sessionId, stepId)` | `number` | Hitungan retry step |
| `getCompletedSteps` | `(sessionId)` | `string[]` | Step yang sudah selesai |
| `getStepState` | `(sessionId, stepId)` | `StepState \| undefined` | State detail step |
| `isComplete` | `(sessionId)` | `boolean` | Apakah semua step selesai |
| `isHealthy` | `(sessionId)` | `boolean` | Apakah tidak ada failed steps |
| `getProgress` | `(sessionId)` | `{ completed, total, failed, blocked }` | Progress eksekusi |
| `getAllFilesModified` | `(sessionId)` | `string[]` | Semua file yang dimodifikasi |
| `removeSession` | `(sessionId)` | `void` | Hapus session state |

---

### 13. `fine-tuning.ts`
Client OpenAI Fine-Tuning API. Upload file, create job, polling status, cancel, dan full pipeline (upload → create → wait). Mendukung parameter hyperparameter (epochs, batch size, learning rate).

| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `FineTuningClient` | `(config: FineTuningConfig)` | `FineTuningClient` | Client API fine-tuning OpenAI |
| `isConfigured` | — | `boolean` | Cek API key |
| `uploadFile` | `(filePath)` | `Promise<FineTuningFile>` | Upload training file |
| `createJob` | `(trainingFileId, options?)` | `Promise<FineTuningJob>` | Buat fine-tuning job |
| `getJobStatus` | `(jobId)` | `Promise<FineTuningJob>` | Status job |
| `listJobs` | `(limit?)` | `Promise<FineTuningJob[]>` | List jobs |
| `cancelJob` | `(jobId)` | `Promise<FineTuningJob>` | Cancel job |
| `waitForJob` | `(jobId, pollIntervalMs?, timeoutMs?)` | `Promise<FineTuningJob>` | Polling sampai selesai |
| `fullPipeline` | `(filePath, options?)` | `Promise<{ file, job, result }>` | Full pipeline: upload → create → wait |

---

### 14. `formal-model.ts`
Formal Model A=(M,T,M,Π) — Contract-based verification untuk multi-agent systems. Implementasi FormalContract (pre/post/invariant), DependencyGraph (Kahn's algorithm untuk cycle detection + topological sort), ContractVerifier, dan FormalModel aggregate.

| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `DependencyGraph` | `(edges?)` | `DependencyGraph` | Graph dependency dengan cycle detection |
| `addEdge` | `(from, to)` | `void` | Tambah edge dependency |
| `detectCycle` | `(vertices)` | `CycleResult` | Deteksi cycle dengan Kahn's algorithm |
| `topologicalSort` | `(vertices)` | `TopoSortResult` | Topological sort |
| `getEdges` | — | `DependencyEdge[]` | Semua edges |
| `wouldCreateCycle` | `(from, to, allVertices)` | `boolean` | Cek apakah adding edge akan buat cycle |
| `ContractVerifier` | `(evaluator?)` | `ContractVerifier` | Verifikasi pre/post-condition |
| `setEvaluator` | `(evaluator)` | `void` | Set custom evaluator |
| `verify` | `(contract, context)` | `Promise<ContractVerificationResult>` | Verifikasi penuh |
| `verifyPreConditions` | `(contract, context)` | `Promise<{ passed, results, summary }>` | Pre-conditions saja |
| `verifyPostConditions` | `(contract, context)` | `Promise<{ passed, results, summary }>` | Post-conditions saja |
| `FormalModel` | — | `FormalModel` | Aggregate A=(M,T,M,Π) |
| `registerContract` | `(key, contract)` | `void` | Daftarkan formal contract |
| `getContract` | `(key)` | `FormalContract \| undefined` | Dapatkan contract |
| `getAllContracts` | — | `Map<string, FormalContract>` | Semua contracts |
| `unregisterContract` | `(key)` | `boolean` | Hapus contract |
| `verifyContract` | `(key, context)` | `Promise<ContractVerificationResult \| null>` | Verifikasi specific contract |
| `detectCycle` | `(subtasks)` | `CycleResult` | Deteksi cycle di subtasks |
| `snapshot` | — | `FormalModelSnapshot` | Snapshot state model |
| `createGenericContract` | — | `FormalContract` | Default generic contract |
| `createCodeContract` | — | `FormalContract` | Software engineering contract |

---

### 15. `git.ts`
Integrasi Git: stage, commit, push, branch, history, diff, dan PR creation via GitHub CLI. Generate PR description dari plan steps dan files changed.

| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `GitIntegration` | `(cwd: string)` | `GitIntegration` | Wrapper Git operations |
| `isAvailable` | — | `boolean` | Cek apakah git repo |
| `stage` | `(files)` | `boolean` | Stage files |
| `commit` | `(message, files)` | `CommitInfo \| null` | Commit dengan files |
| `getHistory` | `(count?)` | `CommitInfo[]` | Riwayat commit |
| `getCurrentBranch` | — | `string` | Branch saat ini |
| `push` | `(branch?)` | `boolean` | Push ke origin |
| `createBranch` | `(name)` | `boolean` | Buat branch baru |
| `createPR` | `(title, body, base?)` | `PRCreationResult \| null` | Buat PR via gh CLI |
| `getDiff` | `(base?)` | `string` | Diff dari base branch |
| `generatePRDescription` | `(goal, steps, filesChanged)` | `PRDescription` | Generate PR description |

---

### 16. `id-chain.ts`
Unified identifier hierarchy: sessionID ⊃ pipelineRunId ⊃ taskId ⊃ stepId. Format canonical untuk pipelineRunId dan parser.

| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `makePipelineRunId` | `(sessionID, pipelineId)` | `string` | Buat pipelineRunId canonical |
| `parsePipelineRunId` | `(runId)` | `{ sessionID, pipelineId } \| null` | Parse pipelineRunId |

---

### 17. `intent-parser.ts`
Parser intent: membuat Plan dari TaskIntent, menghitung kompleksitas, validasi circular dependencies, dan deteksi unknown step references.

| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `IntentParser` | — | `IntentParser` | Parser intent ke plan |
| `createPlan` | `(intent: TaskIntent)` | `Plan` | Buat plan dari intent |
| `validatePlan` | `(plan: Plan)` | `string[]` | Validasi plan (deps, cycle) |

---

### 18. `llm.ts`
LLM Engine — multi-provider (OpenAI, Anthropic, Local/Ollama, OpenCode). Response caching, memory context injection, task decomposition, context summarization, error analysis, code review, role suggestion, skill extraction. Token usage → BudgetTracker. Event emission → EventBus.

| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `LLMEngine` | `(config?: Partial<LLMConfig>)` | `LLMEngine` | Multi-provider LLM client |
| `setMemoryStores` | `(stores)` | `void` | Set memory stores untuk context injection |
| `getMemoryContext` | `(query)` | `string` | Dapatkan memory context string |
| `setOpencodeClient` | `(client)` | `void` | Set OpenCode client (native SDK) |
| `setSessionId` | `(sessionId)` | `void` | Set session ID |
| `setModelRegistry` | `(registry)` | `void` | Set model registry |
| `setBudgetTracker` | `(tracker)` | `void` | Set budget tracker |
| `setEventBus` | `(bus)` | `void` | Set event bus |
| `setSessionStore` | `(store)` | `void` | Set session store |
| `updateConfig` | `(config)` | `void` | Update config runtime |
| `getCurrentModel` | — | `string` | Model yang digunakan |
| `call` | `(req: LLMRequest)` | `Promise<LLMResponse>` | Panggil LLM (dengan cache + budget + event) |
| `decomposeTask` | `(goal, context)` | `Promise<string[]>` | Decompose goal ke subtasks |
| `summarizeContext` | `(planGoal, turns)` | `Promise<string>` | Kompres conversation |
| `analyzeError` | `(errorText, modifiedFiles)` | `Promise<{ category, rootCause, fix }>` | Analisis error dengan LLM |
| `generatePlan` | `(goal, constraints, codebaseSummary)` | `Promise<{ steps, complexity }>` | Generate plan dengan LLM |
| `reviewCode` | `(goal, files)` | `Promise<string[]>` | Review code |
| `suggestRole` | `(description)` | `Promise<string \| null>` | Sarankan agent role |
| `suggestSkillSteps` | `(taskDescription, successOutput)` | `Promise<{ steps }>` | Extract skill steps |

---

### 19. `mcp-client.ts`
MCP (Model Context Protocol) client — koneksi ke external tools via stdio atau HTTP(S). Auto-discovers tools via `tools/list`, call tools via `tools/call` JSON-RPC.

| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `MCPClient` | — | `MCPClient` | MCP protocol client |
| `connect` | `(config: MCPConfig)` | `Promise<MCPConnection>` | Connect ke MCP server |
| `listConnections` | — | `MCPConnection[]` | List semua koneksi + tools |
| `callTool` | `(serverName, toolName, args?)` | `Promise<MCPCallResult>` | Call tool di server |
| `disconnect` | `(serverName)` | `boolean` | Disconnect dari server |
| `disconnectAll` | — | `void` | Disconnect semua server |

---

### 20. `model-registry.ts`
Registry model LLM dengan tracking reliability, hallucination rate, latency, consecutive failures, quarantine, per-task-type stats. Auto-block model tidak reliable, select best model dengan fallback.

| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `ModelRegistry` | — | `ModelRegistry` | Registry dan scoring model |
| `registerAlias` | `(alias, models)` | `void` | Register alias model |
| `addModel` | `(name)` | `void` | Tambah model ke tracking |
| `recordCall` | `(model, success, latencyMs, taskType?)` | `void` | Catat hasil LLM call |
| `recordHallucination` | `(model)` | `void` | Catat hallucination |
| `getScore` | `(model)` | `ModelScore \| null` | Dapatkan score model |
| `getScoreByTaskType` | `(model, taskType)` | `ModelScore \| null` | Score per task type |
| `getAllScores` | — | `ModelScore[]` | Semua model scores |
| `resolveAlias` | `(alias)` | `string[]` | Resolve alias ke model list |
| `suggestWithFallback` | `(role, preferredModels?)` | `string[]` | Model suggestion dengan fallback |
| `isBlocked` | `(model, config)` | `{ blocked, reason, severity }` | Cek apakah model diblokir |
| `selectBestModel` | `(taskType, availableModels, blockingConfig?)` | `string` | Pilih model terbaik |
| `selectWithFallback` | `(taskType, availableModels, blockingConfig)` | `{ model, tier, warnings }` | Select dengan fallback tier |
| `resetModel` | `(model)` | `void` | Reset stats model |
| `resetStaleModels` | `(staleDays?)` | `string[]` | Reset model yang sudah lama |
| `enterQuarantine` | `(model, durationMinutes?)` | `void` | Karantina model |
| `getSummary` | — | `string` | Summary semua model |
| `toJSON` | — | `Record<string, ModelStats>` | Export stats ke JSON |
| `fromJSON` | `(data)` | `void` | Import stats dari JSON |

---

### 21. `navigator.ts`
Codebase scanner multi-language (TypeScript, JavaScript, Python, PHP, Go, Rust, Java, generic). Mendeteksi project language, men-scan source/test files, indexing imports/exports, relevance scoring untuk task.

| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `CodebaseNavigator` | — | `CodebaseNavigator` | Scanner codebase multi-bahasa |
| `setLanguages` | `(langs: LanguageConfig[])` | `void` | Set konfigurasi bahasa |
| `scan` | `(root: string)` | `Promise<ProjectIndex>` | Scan seluruh project |
| `findRelevantFiles` | `(taskDescription, maxFiles?)` | `string[]` | Cari file relevan ke task |
| `getTestFiles` | `(sourceFile)` | `string[]` | Dapatkan test files untuk source |
| `getSummary` | — | `string` | Summary project structure |

---

### 22. `parallel.ts`
Parallel execution engine: dependency-based phasing (Kahn's algorithm), concurrent execution via Promise.all, conflict detection (same file modified), LLM-driven step runner, dan sub-process OpenCode spawn.

| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `ParallelExecutor` | — | `ParallelExecutor` | Eksekutor parallel dengan dependency phasing |
| `analyzeParallelism` | `(subtasks)` | `ParallelPlan` | Analisis parallelism opportunities |
| `executePhase` | `(phase, runner, abortOnFailure?)` | `Promise<ParallelExecutionResult[]>` | Eksekusi satu phase |
| `executeAll` | `(plan, runner, abortOnFailure?)` | `Promise<ParallelExecutionResult[]>` | Eksekusi semua phases |
| `suggestParallelTasks` | `(subtasks, currentlyCompleted)` | `Array<{ taskId, parallelGroup }>` | Sarankan parallel grouping |
| `detectConflicts` | `(parallelTasks, modifiedFiles)` | `Array<{ taskA, taskB, conflictingFile }>` | Deteksi konflik file |
| `llmStepRunner` | `(opts)` | `StepRunner` | Buat step runner berbasis LLM |
| `executePlanConcurrently` | `(plan, stepRunner, abortOnFailure?)` | `Promise<{ results, durationMs }>` | Eksekusi plan concurrent |
| `executeWithSubprocessSpawn` | `(step, opencodePath, projectDir, sessionId)` | `Promise<ParallelExecutionResult>` | Eksekusi step via sub-process OpenCode |

---

### 23. `planner.ts`
Auto-decomposition task planner. Template-based (create, fix, refactor, test, deploy, migrate, doc, perf, security, docker, ci/cd) + LLM fallback. Termasuk cycle detection dengan auto-fix.

| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `Planner` | — | `Planner` | Planner dengan template decomposition |
| `decompose` | `(goal, relevantFiles, activeDomain?)` | `{ intent, autoGenerated }` | Decompose goal ke subtasks (template) |
| `registerRule` | `(rule: DecompositionRule)` | `void` | Daftarkan custom decomposition rule |
| `getRules` | — | `DecompositionRule[]` | Semua rules |
| `decomposeWithLLM` | `(llm, goal, codebaseSummary)` | `Promise<TaskIntent>` | Decompose dengan LLM |
| `suggestSubtask` | `(id, description, dependsOn?)` | `Subtask` | Buat subtask object |

---

### 24. `prompt-builder.ts`
Builder untuk agent prompt dengan format XML (identity/instructions/guardrails). Menghasilkan prompt lengkap dengan YAML frontmatter atau system instructions murni. Domain-aware — tools, workflow, dan rules disesuaikan per domain.

| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `buildAgentPrompt` | `(domain, allTools)` | `string` | Build prompt lengkap dengan frontmatter |
| `buildAgenticSystemInstructions` | `(domain, allTools)` | `string` | Build system instructions tanpa frontmatter |
| `buildGenericAgentPrompt` | `(allTools)` | `string` | Build generic prompt (tanpa domain specifik) |

---

### 25. `prompt-template.ts`
XML-based prompt composition template. Tiga section: `<identity>` (HEAD — who), `<instructions>` (BODY — what), `<guardrails>` (FOOTER — constraints). Conditional rendering, clone, clear, YAML frontmatter.

| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `PromptTemplate` | — | `PromptTemplate` | Template prompt XML |
| `title` | `(value)` | `this` | Set heading |
| `identity` | `(content, when?)` | `this` | Tambah section identity |
| `instructions` | `(content, when?)` | `this` | Tambah section instructions |
| `guardrails` | `(content, when?)` | `this` | Tambah section guardrails |
| `identityAll` | `(items, when?)` | `this` | Bulk add identity |
| `instructionsAll` | `(items, when?)` | `this` | Bulk add instructions |
| `guardrailsAll` | `(items, when?)` | `this` | Bulk add guardrails |
| `render` | — | `string` | Render full prompt |
| `renderWithFrontmatter` | `(description)` | `string` | Render dengan YAML frontmatter |
| `clear` | — | `void` | Reset semua section |
| `clone` | — | `PromptTemplate` | Deep copy template |

---

### 26. `router-agent.ts`
Intent classifier / router. Keyword-based routing (cepat, tanpa LLM) dengan fallback LLM jika confidence rendah. Predefined categories: automotive, financial, personal, tech, general. Mendukung custom categories.

| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `RouterAgent` | `(llmEngine?, categories?)` | `RouterAgent` | Intent router |
| `setCategories` | `(categories)` | `void` | Set categories |
| `getCategories` | — | `RouteCategory[]` | Dapatkan categories |
| `setLLM` | `(llm)` | `void` | Set LLM engine |
| `hasLLM` | — | `boolean` | Cek LLM tersedia |
| `route` | `(input)` | `Promise<RouteMatch>` | Routing dengan LLM sebagai primary classifier |
| `extractKeywords` | `(input)` | `{keywords, category}` | Ekstrak keyword untuk RAG search |
| `createCategory` | `(id, name, keywords, description, tools?)` | `RouteCategory` | Buat custom category |

---

### 27. `task-classifier.ts`
Klasifikasi task type dari deskripsi (CODING, REASONING, TESTING, DOCUMENTATION, DEBUGGING). Digunakan untuk capability-aware model selection.

| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `detectTaskType` | `(description: string)` | `TaskType` | Deteksi task type dari keyword |
| `getTaskTypeLabel` | `(type: TaskType)` | `string` | Human-readable label |

---

### 28. `tech-debt-scorer.ts`
Scoring technical debt dari changeset: coupling analysis (file count + import count), file size (lines), scope (directories + test coverage), dan code patterns (any type, TODO, `as unknown as` cast).

| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `TechDebtScorer` | — | `TechDebtScorer` | Scorer technical debt |
| `score` | `(planGoal, filesChanged, fileContents)` | `DebtScore` | Score changeset (overall + breakdown) |

---

### 29. `verifier.ts`
Verifikasi multi-language (TypeScript, JavaScript, Python, Go, Rust). Compile checking, lint checking, test running, semantic verification dengan LLM. Domain verifier strategies + compile cache.

| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `Verifier` | — | `Verifier` | Verifier multi-bahasa |
| `setLLM` | `(llm)` | `void` | Set LLM untuk semantic verification |
| `hasLLM` | — | `boolean` | Cek LLM |
| `setDomainRegistry` | `(registry)` | `void` | Set domain registry |
| `clearCompileCache` | — | `void` | Reset compile cache |
| `verifySemantic` | `(stepId, intent, changedFiles, projectDir)` | `Promise<CheckResult>` | Semantic verification via LLM |
| `verifyFast` | `(stepId, projectDir, changedFiles?)` | `VerificationResult` | Fast compile-only (dengan cache) |
| `verifyAllDeep` | `(stepId, projectDir, intent?, changedFiles?, requireSemanticCheck?)` | `Promise<VerificationResult>` | Full verification (domain + compile + lint + test + semantic) |
| `detectLanguage` | `(projectDir)` | `SupportedLanguage` | Deteksi bahasa project |
| `getLanguage` | — | `SupportedLanguage` | Bahasa terdeteksi |
| `verifyCompile` | `(projectDir)` | `CheckResult` | Compile check |
| `verifyTests` | `(projectDir, testPattern?)` | `CheckResult` | Test runner |
| `verifyLint` | `(projectDir)` | `CheckResult` | Lint check |
| `verifyAll` | `(stepId, projectDir)` | `VerificationResult` | Full verify (compile + lint + test) |
| `verifyRelated` | `(stepId, projectDir, changedFiles)` | `VerificationResult` | Verify dengan related test files |

---

## Subfolder: `src/core/domains/`

### `code.ts`
Domain software engineering — compile, lint, test untuk TypeScript, JavaScript, Python, Go, Rust. Error matchers: import, type, compile, test, runtime. Formal contract dengan compile + test gates.

| Export | Deskripsi |
|---|---|
| `codeDomain: DomainPack` | Domain pack untuk software engineering |

### `data-science.ts`
Domain data science & ML — notebook validation, Python import checking, data shape error matching. Formal contract generic.

| Export | Deskripsi |
|---|---|
| `dataScienceDomain: DomainPack` | Domain pack untuk data science / ML |

### `devops.ts`
Domain DevOps & infrastructure — Dockerfile lint, YAML validation, error matchers untuk Docker/K8s/CI. Formal contract dengan post-conditions Dockerfile dan YAML.

| Export | Deskripsi |
|---|---|
| `devopsDomain: DomainPack` | Domain pack untuk DevOps |

### `generic.ts`
Domain default (domain-agnostic). Semantic verifier sederhana, generic error matcher, 5 role definitions (analyst, builder, reviewer, coordinator, planner).

| Export | Deskripsi |
|---|---|
| `genericDomain: DomainPack` | Domain pack default/fallback |

### `mobile.ts`
Domain mobile development — Android Manifest check, iOS Info.plist check, error matchers untuk Gradle, Xcode, React Native.

| Export | Deskripsi |
|---|---|
| `mobileDomain: DomainPack` | Domain pack untuk mobile development |

### `security.ts`
Domain security — secret scanning (API keys, tokens, private keys), Trivy integration, error matchers untuk auth dan CSP.

| Export | Deskripsi |
|---|---|
| `securityDomain: DomainPack` | Domain pack untuk security engineering |
