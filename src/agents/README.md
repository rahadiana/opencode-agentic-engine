# src/agents — Multi-Agent System

> Modul ini mengelola eksekusi multi-agent terisolasi, koordinasi delegasi tugas, pipeline workflow, dan registrasi peran agent. Terdiri dari 4 file: runtime LLM terisolasi per role, coordinator dengan shared memory & message bus, orchestrator pipeline multi-tahap dengan validasi kontrak, dan registry untuk definisi peran bawaan & kustom.

---

## Daftar File

### 1. `agent-runtime.ts`

Mengelola runtime LLM terisolasi per pasangan (session, role). Setiap agent mendapat instance `LLMEngine` sendiri dengan session ID unik.

| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `AgentContext` (interface) | `systemPrompt`, `sessionId`, `role`, `taskDescription`, `pipelineContext?`, `pendingMessages?`, `sharedMemory?` | — | Konteks eksekusi untuk sebuah agent |
| `AgentResult` (interface) | `output`, `success`, `error?`, `modelUsed?` | — | Hasil eksekusi LLM |
| `AgentRuntime` (class) | — | — | Runtime utama; menyediakan engine LLM terisolasi per role |
| `setOpencodeClient(client)` | `client: unknown` | `void` | Set OpenCode client untuk LLM engine |
| `setModelRegistry(registry)` | `registry: ModelRegistry` | `void` | Set registry model untuk LLM engine |
| `getRoleRegistry()` | — | `RoleRegistry` | Ambil instance RoleRegistry |
| `getEngine(sessionId, role)` (private) | `sessionId: string`, `role: string` | `LLMEngine` | Dapatkan atau buat engine LLM terisolasi per (session, role) |
| `execute(ctx)` | `ctx: AgentContext` | `Promise<AgentResult>` | Jalankan LLM dengan system prompt dari role + konteks tambahan |

---

### 2. `coordinator.ts`

Koordinasi multi-agent: delegasi tugas, shared memory antar agent, message bus, dan pelacakan pipeline.

| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `AgentRole` (type) | `"architect" \| "developer" \| "qa" \| "coordinator" \| "pm" \| "analyst" \| "builder" \| "reviewer" \| "planner"` | — | Tipe role agent yang tersedia |
| `AgentTask` (interface) | `id`, `assignedTo`, `description`, `input`, `status`, `result?`, `sharedContext?`, `validatedBy?`, `pipelineRunId?`, `delegationDepth?` | — | Representasi tugas yang didelegasikan |
| `SharedMemoryEntry` (interface) | `key`, `value`, `writtenBy`, `timestamp` | — | Entri shared memory antar agent |
| `AgentMessage` (interface) | `id`, `from`, `to`, `taskId`, `type`, `payload`, `context?`, `timestamp`, `read` | — | Pesan antar agent |
| `SharedMemoryListener` (type) | `(entry: SharedMemoryEntry) => void` | — | Callback saat shared memory ditulis |
| **AgentCoordinator** (class) | — | — | Koordinator utama: delegasi, memori, pesan, pipeline |
| `constructor(skillStore?)` | `skillStore?: SkillStore` | — | Inisialisasi coordinator dengan opsi skill store |
| `setMaxDepth(depth)` | `depth: number` | `void` | Set kedalaman delegasi maksimum |
| `getMaxDepth()` | — | `number` | Ambil kedalaman delegasi saat ini |
| `onSharedMemoryWrite(listener)` | `listener: SharedMemoryListener` | `void` | Daftarkan listener untuk event write memori |
| `writeSharedMemory(key, value, agentRole)` | `key, value: string`, `agentRole: string` | `SharedMemoryEntry` | Tulis ke shared memory |
| `writeSharedMemoryBatch(entries)` | `entries: Array<{key, value, agentRole}>` | `void` | Tulis batch ke shared memory |
| `readSharedMemory(key)` | `key: string` | `SharedMemoryEntry \| undefined` | Baca dari shared memory |
| `searchSharedMemory(query)` | `query: string` | `SharedMemoryEntry[]` | Cari di shared memory berdasarkan keyword |
| `getAllSharedMemory()` | — | `SharedMemoryEntry[]` | Ambil semua entri shared memory |
| `getAgent(role)` | `role: string` | `AgentDef \| CustomAgentDef \| undefined` | Dapatkan definisi agent (built-in atau custom) |
| `registerCustomRole(def)` | `def: CustomAgentDef` | `void` | Daftarkan role agent kustom |
| `sendMessage(msg)` | `msg: Omit<AgentMessage, "id" \| "timestamp" \| "read">` | `AgentMessage` | Kirim pesan ke agent lain |
| `getMessages(agentRole, unreadOnly?)` | `agentRole: string`, `unreadOnly?: boolean` | `AgentMessage[]` | Ambil inbox pesan untuk role tertentu |
| `markRead(messageId)` | `messageId: string` | `boolean` | Tandai pesan sebagai sudah dibaca |
| `getConversation(taskId)` | `taskId: string` | `AgentMessage[]` | Ambil seluruh percakapan untuk task tertentu |
| `delegate(role, task, sessionId, parentDepth?, relevantSkills?)` | `role: string`, `task: AgentTask`, `sessionId: string`, `parentDepth?: number`, `relevantSkills?: Array` | `AgentTask` | Delegasikan tugas ke role tertentu dengan konteks + skills |
| `getTasks(sessionId)` | `sessionId: string` | `AgentTask[]` | Ambil semua tugas dalam session |
| `getTasksByRole(sessionId, role)` | `sessionId: string`, `role: string` | `AgentTask[]` | Ambil tugas per role dalam session |
| `updateTask(sessionId, taskId, status, result?)` | `sessionId, taskId: string`, `status`, `result?: string` | `boolean` | Update status dan hasil tugas |
| `getNextInPipeline(taskId, sessionId)` | `taskId: string`, `sessionId: string` | `AgentTask \| null` | Dapatkan tugas downstream berikutnya dalam pipeline |
| `setPipelineRun(sessionId, pipelineId, taskIds)` | `sessionId, pipelineId: string`, `taskIds: string[]` | `void` | Catat pipeline run untuk session |
| `getPipelineRun(sessionId)` | `sessionId: string` | `string[] \| undefined` | Ambil daftar task IDs pipeline run |
| `getSuggestedRole(description, llm?)` | `description: string`, `llm?: { suggestRole }` | `Promise<AgentRole>` | Rekomendasikan role agent terbaik berdasarkan deskripsi (LLM dulu, fallback keyword) |

---

### 3. `orchestrator.ts`

Mendefinisikan dan mengeksekusi pipeline multi-tahap (PM → Architect → Developer → QA) dengan validasi kontak antar-tahap dan LLM cross-validation.

| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `PipelineStage` (interface) | `role`, `description`, `validationCriteria?`, `model?` | — | Satu tahap dalam pipeline |
| `WorkflowPipeline` (interface) | `id`, `name`, `stages`, `createdAt` | — | Definisi pipeline workflow |
| `CrossValidationResult` (interface) | `stage`, `targetStage`, `issues[]`, `passed`, `summary` | — | Hasil validasi silang antar tahap |
| `SchemaFieldType` (type) | `"string" \| "string[]" \| "number" \| "boolean" \| "json" \| "code"` | — | Tipe field untuk schema kontrak |
| `SchemaField` (interface) | `name`, `type`, `required`, `description`, `pattern?` | — | Definisi field dalam schema I/O |
| `StageContract` (interface) | `role`, `description`, `inputSchema`, `outputSchema`, `preConditions`, `postConditions` | — | Kontrak formal I/O untuk satu tahap |
| `PipelineContract` (interface) | `pipelineId`, `stageContracts[]`, `crossStageInvariants[]` | — | Kontrak agregat untuk seluruh pipeline |
| `SchemaValidationResult` (interface) | `field`, `passed`, `severity`, `detail` | — | Hasil validasi satu field schema |
| **Orchestrator** (class) | — | — | Orchestrator pipeline multi-agent |
| `setLLMEngine(engine)` | `engine: LLMEngine` | `void` | Set LLM engine untuk semantic validation |
| `definePipeline(pipeline)` | `pipeline: WorkflowPipeline` | `void` | Daftarkan pipeline baru |
| `getPipeline(id)` | `id: string` | `WorkflowPipeline \| undefined` | Ambil pipeline by ID |
| `listPipelines()` | — | `WorkflowPipeline[]` | Daftar semua pipeline |
| `startRun(runId, pipelineId)` | `runId, pipelineId: string` | `boolean` | Mulai eksekusi pipeline |
| `getCurrentStage(runId)` | `runId: string` | `PipelineStage \| null` | Ambil stage yang sedang berjalan |
| `advanceStage(runId, output, issues)` | `runId: string`, `output: string`, `issues: string[]` | `PipelineStage \| null` | Lanjut ke stage berikutnya |
| `getStageResult(runId, role)` | `runId, role: string` | `{ output, issues, validatedBy } \| undefined` | Ambil hasil satu stage |
| `getAllStageResults(runId)` | `runId: string` | `Map<...>` | Ambil semua hasil stage |
| `validateSchema(output, schema)` | `output: string`, `schema: SchemaField[]` | `SchemaValidationResult[]` | Validasi output terhadap output schema |
| `checkInvariants(invariants, allStageResults)` | `invariants: Condition[]`, `allStageResults: Map` | `SchemaValidationResult[]` | Periksa invariant lintas stage (error, dependency, compile) |
| `crossValidate(targetRole, output, allStageResults)` | `targetRole, output: string`, `allStageResults: Map` | `Promise<CrossValidationResult>` | Validasi silang formal: schema + invariant + LLM semantic check |
| `buildContextForRole(role, runId, sharedMemory)` | `role, runId: string`, `sharedMemory: SharedMemoryEntry[]` | `string` | Bangun konteks pipeline untuk role tertentu |
| `executePipeline(params)` | `params: { pipeline, runId, goal, constraints?, projectDir, codebaseSummary, filesBlock, memoryContexts, skillContexts, coordinator, sessionID, budgetTracker?, eventBus?, hallucinationGuard?, skillStore?, configLoader? }` | `Promise<{ results, allFiles, pipelineReview, hasNoLLM, budgetExceeded, verifyNote, completedStageCount }>` | Eksekusi pipeline penuh: semua stage via LLM, write files, QA review, cross-validation, completion recording |
| `getSuggestedPipeline(description)` | `description: string` | `string` | Rekomendasikan pipeline ID berdasarkan keyword deskripsi |
| `getBuiltInPipelines()` | — | `WorkflowPipeline[]` | Kembalikan 4 pipeline bawaan: feature-dev, fix-verify, refactor-review, deploy-check |
| `getPipelineContract(pipelineId)` | `pipelineId: string` | `PipelineContract \| null` | Ambil kontrak formal untuk pipeline (dengan input/output schema, pre/post conditions, invariants) |

---

### 4. `role-registry.ts`

Registry untuk mendefinisikan, mendaftarkan, dan mengelola peran agent (built-in dan kustom) beserta system prompt, tools, model, dan riwayat perubahan prompt.

| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `AgentDef` (interface) | `role`, `name`, `prompt`, `tools[]`, `model?` | — | Definisi agent bawaan |
| `CustomAgentDef` (interface) | `role`, `name`, `prompt`, `tools[]`, `model?` | — | Definisi agent kustom |
| `CustomRole` (type) | `string` | — | Alias untuk string role kustom |
| `TaskComplexity` (type) | `"simple" \| "moderate" \| "complex"` | — | Tingkat kompleksitas untuk rekomendasi model |
| `PromptSource` (type) | `"auto-evolve" \| "agent-self" \| "manual" \| "initial"` | — | Sumber perubahan prompt |
| `PromptEntry` (interface) | `version`, `prompt`, `timestamp`, `source`, `description?` | — | Satu entri riwayat perubahan prompt |
| `PromptState` (interface) | `currentVersion`, `history[]` | — | State riwayat prompt untuk satu role |
| **RoleRegistry** (class) | — | — | Registry peran agent dengan versioned prompt history |
| `constructor(initialPrompts?)` | `initialPrompts?: Array<{role, history[]}>` | — | Inisialisasi dengan prompt awal, register semua role bawaan |
| `registerGenericRoles()` (private) | — | `void` | Daftarkan 5 role generik: analyst, builder, reviewer, coordinator, planner |
| `registerCodeRoles()` (private) | — | `void` | Daftarkan 4 role engineering: architect, developer, qa, pm |
| `registerCustom(def)` | `def: CustomAgentDef` | `void` | Daftarkan role agent kustom |
| `updatePrompt(role, newPrompt, source?, description?)` | `role, newPrompt: string`, `source?: PromptSource`, `description?: string` | `boolean` | Update system prompt role dengan version tracking |
| `getPrompt(role)` | `role: string` | `string \| undefined` | Ambil prompt aktif untuk role |
| `getPromptHistory(role)` | `role: string` | `PromptEntry[]` | Ambil riwayat perubahan prompt |
| `getPromptState(role)` | `role: string` | `PromptState \| undefined` | Ambil state prompt lengkap (current + history) |
| `getAllPromptStates()` | — | `Array<{role, history[]}>` | Ambil semua state prompt (untuk persistensi) |
| `rollbackPrompt(role, version)` | `role: string`, `version: number` | `boolean` | Rollback prompt role ke versi tertentu |
| `getBuiltIn(role)` | `role: AgentRole` | `AgentDef \| undefined` | Ambil definisi agent bawaan |
| `getCustom(role)` | `role: CustomRole` | `CustomAgentDef \| undefined` | Ambil definisi agent kustom |
| `getAllBuiltIn()` | — | `AgentDef[]` | Daftar semua agent bawaan |
| `getAllCustom()` | — | `CustomAgentDef[]` | Daftar semua agent kustom |
| `listRoles()` | — | `string[]` | Daftar semua nama role (built-in + custom) |
| `suggestModel(role, complexity?)` | `role: string`, `complexity?: TaskComplexity` | `string` | Rekomendasikan model (`"fast"` / `"capable"`) berdasarkan role + kompleksitas |
| `setModel(role, model)` | `role, model: string` | `void` | Set model khusus untuk role tertentu |
