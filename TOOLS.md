# OpenCode Agentic Engine — 27 Tools Reference

> **Plugin**: opencode-agentic-engine  
> **Version**: 0.4.4  
> **Total Tools**: 28 (Stage I–V + Blueprint)

---

## 📋 Stage I — Foundation (Workflow Inti)

Tools untuk planning, execution, verification, dan reflection — siklus dasar agentic software engineering.

---

### agentic_plan

Membuat structured execution plan dengan auto-decomposition LLM-first.

| Parameter | Tipe | Required | Deskripsi |
|-----------|------|----------|-----------|
| `goal` | `string` | ✅ | Tujuan utama task |
| `constraints` | `string[]` | ❌ | Constraints atau requirements |
| `relevantFiles` | `string[]` | ❌ | File-file relevan |
| `autoDecompose` | `boolean` | ❌ | Auto-decompose goal (default: `true`) |
| `llmDecompose` | `boolean` | ❌ | Pakai LLM untuk decompose (default: `true`) |
| `subtasks` | `array` | ❌ | Subtask manual (override auto-decompose) |

**Deskripsi**:  
Auto-decompose fitur request menggunakan built-in templates (create/implement, fix/bug, refactor, test, deploy, migrate, doc, perf). Panggil ini **PERTAMA** untuk task multi-step.

**Stage**: I  
**LLM-dependent**: Ya (fallback ke rule-based template)

---

### agentic_execute

Mencatat completion subtask + auto-verify + checkpoint + error propagation.

| Parameter | Tipe | Required | Deskripsi |
|-----------|------|----------|-----------|
| `stepId` | `string` | ✅ | ID step yang dieksekusi |
| `success` | `boolean` | ✅ | Apakah step sukses |
| `output` | `string` | ✅ | Ringkasan apa yang dilakukan |
| `filesModified` | `string[]` | ❌ | File yang diubah/dibuat |
| `error` | `string` | ❌ | Error message jika gagal |
| `autoVerify` | `boolean` | ❌ | Auto-run compile verifikasi (default: `true`) |
| `feedback` | `"positive" \| "negative"` | ❌ | User feedback untuk continuous learning |

**Deskripsi**:  
Auto-verifikasi kompilasi saat sukses. Error recovery guidance + error propagation analysis saat gagal. Mendukung user feedback untuk Gap #9 (continuous learning).

**Stage**: I

---

### agentic_reflect

Menganalisa step yang gagal dan menelusuri propagasi error.

| Parameter | Tipe | Required | Deskripsi |
|-----------|------|----------|-----------|
| `stepId` | `string` | ✅ | ID step gagal yang dianalisa |
| `errorDetails` | `string` | ❌ | Konteks error tambahan (stack trace, test output) |
| `attemptedFix` | `string` | ❌ | Apa yang sudah dicoba untuk fix |

**Deskripsi**:  
Mendiagnosa kategori error (import/type/compile/test/runtime), menelusuri propagasi error antar step, dan memberi saran recovery plan.

**Stage**: I

---

### agentic_verify

Full verification: compile + test suite dengan auto-detect bahasa.

| Parameter | Tipe | Required | Deskripsi |
|-----------|------|----------|-----------|
| `stepId` | `string` | ✅ | Label untuk verifikasi ini |
| `projectDir` | `string` | ❌ | Project directory (default: worktree) |

**Deskripsi**:  
Auto-detect bahasa (TypeScript, Python, Go, Rust, JavaScript). Menjalankan compile + lint + test suite. Sertakan error analysis jika gagal. Juga mendukung semantic verification jika LLM tersedia.

**Stage**: I

---

### agentic_status

Menampilkan execution dashboard: progress, blocked steps, dependency graph.

| Parameter | Tipe | Required | Deskripsi |
|-----------|------|----------|-----------|
| — | — | — | Tidak ada parameter |

**Deskripsi**:  
Menampilkan progress bar, health status, blocked steps, dependency graph, retry history, dan file change summary. Gunakan untuk memonitor progres eksekusi.

**Stage**: I

---

## 📋 Stage II — Discovery & Insight

Tools untuk eksplorasi codebase, manajemen konteks, snapshot, PR, tech debt, dan model.

---

### agentic_nav

Memindai codebase dan mencari file relevan untuk suatu task.

| Parameter | Tipe | Required | Deskripsi |
|-----------|------|----------|-----------|
| `query` | `string` | ✅ | Task description, module name, atau keyword |
| `maxResults` | `number` | ❌ | Maksimum file yang dikembalikan (default: 10) |
| `showSummary` | `boolean` | ❌ | Tampilkan ringkasan project structure |

**Deskripsi**:  
Menggunakan relevance scoring untuk menemukan file yang paling relevan dengan suatu task. Ideal untuk memahami struktur project sebelum planning.

**Stage**: II

---

### agentic_context

View dan compress execution context.

| Parameter | Tipe | Required | Deskripsi |
|-----------|------|----------|-----------|
| `action` | `"view" \| "compress"` | ✅ | `view` → statistik konteks; `compress` → ringkasan kompak |

**Deskripsi**:  
Saat mendekati batas konteks, tool ini meringkas riwayat percakapan ke bentuk kompak dengan mempertahankan keputusan kunci, perubahan file, dan invariant.

**Stage**: II

---

### agentic_snapshot

Menyimpan dan me-restore execution snapshots (checkpoint).

| Parameter | Tipe | Required | Deskripsi |
|-----------|------|----------|-----------|
| `action` | `"save" \| "list"` | ✅ | `save` → checkpoint; `list` → lihat semua snapshot |
| `label` | `string` | ❌ | Label untuk snapshot (opsional) |

**Deskripsi**:  
Simpan state progres plan, perubahan file, dan keputusan sebagai checkpoint. Bisa di-restore nanti.

**Stage**: II

---

### agentic_pr

Generate PR description dari execution plan dan hasil step.

| Parameter | Tipe | Required | Deskripsi |
|-----------|------|----------|-----------|
| `title` | `string` | ❌ | Override judul PR (default: goal plan) |
| `action` | `"generate" \| "create"` | ❌ | `generate` → return body PR (default); `create` → buka PR via `gh` CLI |
| `baseBranch` | `string` | ❌ | Base branch untuk PR (default: `main`) |

**Deskripsi**:  
Generate PR description dari execution plan, semua step results, dan files changed. Bisa langsung create PR via GitHub CLI.

**Stage**: II

---

### agentic_score

Menganalisa technical debt dari changeset.

| Parameter | Tipe | Required | Deskripsi |
|-----------|------|----------|-----------|
| `files` | `string[]` | ❌ | File spesifik yang di-score (default: semua modified files) |

**Deskripsi**:  
Menganalisa coupling, file size, scope, dan code patterns. Gunakan sebelum menyelesaikan task untuk memastikan code quality.

**Stage**: II

---

### agentic_model

Konfigurasi preferensi model LLM per role.

| Parameter | Tipe | Required | Deskripsi |
|-----------|------|----------|-----------|
| `action` | `"set" \| "get" \| "list" \| "clear"` | ✅ | Operasi pada preferensi model |
| `role` | `string` | ❌ | Agent role (architect, developer, qa, coordinator, pm) |
| `model` | `string` | ❌ | Nama model (e.g., `"gpt-4o"`, `"claude-sonnet-4-20250514"`) |

**Deskripsi**:  
Konfigurasi model LLM yang berbeda untuk setiap agent role dalam sesi yang sama. Persisten per session, tidak lintas session.

**Stage**: II

---

### agentic_model_reset

Reset statistik model untuk recovery dari degraded performance.

| Parameter | Tipe | Required | Deskripsi |
|-----------|------|----------|-----------|
| `action` | `"reset" \| "reset-stale" \| "reset-all"` | ✅ | `reset` → model tertentu; `reset-stale` → auto; `reset-all` → emergency |
| `model` | `string` | ❌ | Nama model (required untuk `reset`) |
| `staleDays` | `number` | ❌ | Threshold hari untuk stale detection (default: 7) |

**Deskripsi**:  
Recovery dari performance degradation dengan mereset statistik model. Berguna saat model mengalami timeout, retry storms, atau silent failures.

**Stage**: II

---

### agentic_budget

Budget enforcement tool (PDP layer). Set limits per scope (session/task) and configure behavior (hard-stop / warn / request-approval).

| Parameter | Tipe | Required | Deskripsi |
|-----------|------|----------|-----------|
| `action` | `"set" \| "get" \| "status" \| "reset"` | ✅ | Operation to perform |
| `scope` | `"session" \| "task"` | ❌ | Budget scope (default: `"session"`) |
| `maxTokens` | `number` | ❌ | Max total tokens (input+output+reasoning+cache) |
| `maxSteps` | `number` | ❌ | Max subtask steps |
| `maxTimeMs` | `number` | ❌ | Max wall-clock time in ms |
| `maxCostUsd` | `number` | ❌ | Max total cost in USD |
| `onExceeded` | `"hard-stop" \| "warn" \| "request-approval"` | ❌ | Behavior when limit exceeded (default: `"hard-stop"`) |
| `modelPrices` | `Record<string, {input:number, output:number}>` | ❌ | Ad-hoc model price overrides |

**Deskripsi**:  
Tracks tokens, steps, time, and cost per session/task. PEP check runs synchronously before every `agentic_execute`, `bash_tool`, and `agentic_mcp` call. Supports fail-fast order (steps → time → tokens → cost). Approval pause excludes waiting time from `elapsedMs`.

**Stage**: II  
**LLM-dependent**: Tidak

---

## 📋 Stage III — Multi-Agent & Memory

Tools untuk multi-agent coordination, pipeline, messaging, skill management, dan memory.

---

### agentic_delegate

Assign task ke specialized agent role dengan pipeline-aware cross-validation.

| Parameter | Tipe | Required | Deskripsi |
|-----------|------|----------|-----------|
| `taskId` | `string` | ✅ | Unique ID untuk task |
| `description` | `string` | ✅ | Apa yang harus dilakukan agent |
| `role` | `"architect" \| "developer" \| "qa" \| "coordinator" \| "pm"` | ❌ | Role target (auto-detect jika kosong) |
| `context` | `string` | ❌ | Konteks tambahan |
| `pipelineRunId` | `string` | ❌ | Pipeline run ID untuk asosiasi |
| `result` | `string` | ❌ | Hasil task (set saat complete) |
| `status` | `"pending" \| "running" \| "done" \| "failed"` | ❌ | Status task |
| `requestReview` | `boolean` | ❌ | Minta review dari downstream role |

**Deskripsi**:  
Mendukung pipeline-aware delegation dengan cross-validation antar stage dan inter-agent messaging. Auto-detect role berdasarkan deskripsi task.

**Stage**: III

---

### agentic_pipeline

Define dan run multi-agent workflow pipelines.

| Parameter | Tipe | Required | Deskripsi |
|-----------|------|----------|-----------|
| `action` | `"define" \| "list" \| "run" \| "status" \| "suggest"` | ✅ | Operasi pipeline |
| `pipelineId` | `string` | ❌ | Pipeline ID (untuk define/run/status) |
| `stages` | `array` | ❌ | Stage definitions (role + description + validationCriteria) |
| `name` | `string` | ❌ | Nama pipeline (untuk define) |
| `description` | `string` | ❌ | Deskripsi task (untuk suggest) |

**Deskripsi**:  
Chain PM → Architect → Developer → QA untuk complete feature development. Include cross-validation antara stages. Bisa auto-suggest pipeline berdasarkan task description.

**Stage**: III

---

### agentic_message

Inter-agent messaging system.

| Parameter | Tipe | Required | Deskripsi |
|-----------|------|----------|-----------|
| `action` | `"send" \| "inbox" \| "conversation" \| "mark-read"` | ✅ | Operasi pesan |
| `to` | `string` | ❌ | Recipient role (untuk send) |
| `taskId` | `string` | ❌ | Task ID terkait |
| `message` | `string` | ❌ | Isi pesan (untuk send) |
| `type` | `"result" \| "review_request" \| "review_response" \| "clarification" \| "approval" \| "revision"` | ❌ | Tipe pesan |
| `messageId` | `string` | ❌ | Message ID (untuk mark-read) |

**Deskripsi**:  
Kirim pesan antar agent roles, request reviews, cek inbox, dan lihat conversation threads. Bagian dari multi-agent coordination framework.

**Stage**: III

---

### agentic_parallel

Analisa atau eksekusi steps secara concurrent.

| Parameter | Tipe | Required | Deskripsi |
|-----------|------|----------|-----------|
| `action` | `"analyze" \| "execute"` | ❌ | `analyze` → parallelism plan; `execute` → run concurrent (default: analyze) |
| `opencodePath` | `string` | ❌ | Path ke `opencode` binary untuk sub-process spawn |
| `abortOnFailure` | `boolean` | ❌ | Stop all tasks jika satu gagal (default: `false`) |

**Deskripsi**:  
Mendukung dependency-based concurrency dengan conflict detection. Bisa menjalankan step yang siap secara paralel via `Promise.all`.

**Stage**: III

---

### agentic_skill

Manajemen reusable skills yang diekstrak dari task completion.

| Parameter | Tipe | Required | Deskripsi |
|-----------|------|----------|-----------|
| `action` | `"extract" \| "find" \| "list"` | ✅ | Operasi skill |
| `query` | `string` | ❌ | Search query atau stepId target ekstraksi |

**Deskripsi**:  
Skills diekstrak dari step yang sukses dan bisa digunakan ulang untuk task serupa. Format self-describing `agentic-skill/v1`. Juga bisa dikonversi ke training data untuk fine-tuning.

**Stage**: III

---

### agentic_episodes

Cross-session memory browser.

| Parameter | Tipe | Required | Deskripsi |
|-----------|------|----------|-----------|
| `action` | `"search" \| "recent" \| "stats"` | ✅ | Operasi memori episodik |
| `query` | `string` | ❌ | Search query (untuk `search` action) |

**Deskripsi**:  
Search past tasks dan outcomes untuk belajar dari sesi sebelumnya. Gunakan sebelum planning task serupa untuk menghindari pengulangan kesalahan. Mendukung versioned schema.

**Stage**: III

---

### agentic_dashboard

Observability dashboard dari execution traces.

| Parameter | Tipe | Required | Deskripsi |
|-----------|------|----------|-----------|
| — | — | — | Tidak ada parameter |

**Deskripsi**:  
Menampilkan timeline, statistics, tool usage, anomaly detection, dan model reliability (timeouts, retry storms, silent failures). Data dari JSONL trace logger.

**Stage**: III

---

### agentic_guard

Manual re-run hallucination guard. **Auto-check sudah berjalan otomatis** di dalam `agentic_execute` (jika `autoHallucinationCheck: true` di config). Tool ini hanya diperlukan untuk: (a) re-check step lama setelah file berubah, (b) audit step yang dijalankan saat auto-check disabled, atau (c) breakdown detail per-claim.

| Parameter | Tipe | Required | Deskripsi |
|-----------|------|----------|-----------|
| `stepId` | `string` | ✅ | Step ID yang output-nya akan diverifikasi |

**Deskripsi**:  
Cek bahwa file yang direferensikan benar-benar ada, fungsi yang diklaim ada di kode, dan imports valid. Mencegah LLM hallucinations sebelum merusak codebase.

⚠️ **Jangan panggil redundan** — auto-check sudah berjalan otomatis di `agentic_execute` pada setiap step sukses.

**Stage**: III

---

## 📋 Stage IV — Evolution

Tool untuk meng-inspect dan meng-extend agent system itu sendiri.

---

### agentic_evolve

Inspect, extend, dan evolve agent system.

| Parameter | Tipe | Required | Deskripsi |
|-----------|------|----------|-----------|
| `action` | Berbagai nilai (lihat tabel) | ✅ | Operasi evolusi system |
| `name` | `string` | ❌ | Role/skill name |
| `prompt` | `string` | ❌ | Agent prompt template |
| `tools` | `string[]` | ❌ | Tools available untuk custom role |
| `skillId` | `string` | ❌ | Skill ID |
| `role` | `string` | ❌ | Agent role |
| `version` | `number` | ❌ | Version number (untuk rollback) |
| `format` | `"openai" \| "instructions"` | ❌ | Format training data |
| `minSuccessRate` | `number` | ❌ | Minimum success rate (default: 0.5) |

**Action values**:

| Action | Fungsi |
|--------|--------|
| `inspect` | Lihat status system (roles, schema version) |
| `register-role` | Daftarkan custom agent role baru |
| `export-skill` | Export skill dalam self-describing format |
| `memory-schema` | Lihat memory schema |
| `evolve` | Jalankan self-evolution (analisa error → prompt patches) |
| `read-prompt` | Baca prompt agent tertentu |
| `edit-prompt` | Edit/append prompt agent |
| `prompt-history` | Lihat riwayat versi prompt |
| `rollback-prompt` | Rollback prompt ke versi tertentu |
| `export-training-data` | Export skills sebagai training data |

**Deskripsi**:  
Stage IV tool — meng-inspect dan meng-extend agent system. Bisa register custom agent roles, define versioned memory schemas, export skills, dan mengelola prompt versioning.

**Stage**: IV

---

## 📋 Stage V — Autonomous

Tool untuk loop otonom penuh.

---

### agentic_auto

Fully autonomous engineering orchestrator.

| Parameter | Tipe | Required | Deskripsi |
|-----------|------|----------|-----------|
| `goal` | `string` | ✅ | Tujuan / task description |
| `constraints` | `string[]` | ❌ | Constraints |
| `thorough` | `boolean` | ❌ | Tambah memory + skills + guard + tech-debt (default: `true`) |
| `maxSteps` | `number` | ❌ | Maksimum steps (default: auto) |

**Deskripsi**:  
Satu panggilan menangani: memory + skills → architecture → code → guard check → verify → score → learn. End-to-end autonomous loop: plan → execute → verify → retry dalam satu call.

**Stage**: V

---

## 🧪 Blueprint — Experimental Tools

Tools yang masih dalam tahap pengembangan/eksperimental.

---

### agentic_debate

Debate loop antara dua agent (executor ↔ critic).

| Parameter | Tipe | Required | Deskripsi |
|-----------|------|----------|-----------|
| `task` | `string` | ✅ | Task/question untuk dianalisa |
| `context` | `string` | ❌ | Konteks tambahan |
| `maxRounds` | `number` | ❌ | Maksimum debate rounds (default: 3, max: 5) |
| `format` | `"markdown" \| "json"` | ❌ | Output format (default: `json`) |

**Deskripsi**:  
Menghasilkan hasil yang lebih bersih dan akurat daripada single LLM call. Terbaik untuk complex analysis, data validation, dan reviews.

---

### agentic_router

Lightweight intent classifier.

| Parameter | Tipe | Required | Deskripsi |
|-----------|------|----------|-----------|
| `input` | `string` | ✅ | User input / query untuk diklasifikasi |
| `categories` | `array` | ❌ | Custom categories (override defaults) |

**Deskripsi**:  
Route user input ke kategori pengetahuan, RAG index, dan tools yang tepat. Gunakan sebelum searching memory untuk membatasi hasil ke domain yang relevan.

---

### agentic_clean

Membersihkan teks mentah dengan stripping debate artifacts.

| Parameter | Tipe | Required | Deskripsi |
|-----------|------|----------|-----------|
| `text` | `string` | ✅ | Raw text untuk dibersihkan |
| `format` | `"markdown" \| "json" \| "text"` | ❌ | Output format (default: `json`) |
| `schema` | `string` | ❌ | Expected JSON schema |
| `stripDebate` | `boolean` | ❌ | Strip debate/review artifacts (default: `true`) |

**Deskripsi**:  
Gunakan setelah debate atau multi-step analysis untuk mendapatkan output yang bersih dan terformat.

---

### agentic_rag

Multi-index RAG dengan category segregation.

| Parameter | Tipe | Required | Deskripsi |
|-----------|------|----------|-----------|
| `action` | `"search" \| "store" \| "stats" \| "categories"` | ✅ | Operasi RAG |
| `query` | `string` | ❌ | Search query |
| `category` | `string` | ❌ | Kategori (kosongkan untuk all) |
| `title` | `string` | ❌ | Title untuk stored entry |
| `content` | `string` | ❌ | Content untuk di-store |
| `type` | `"episode" \| "skill"` | ❌ | Tipe konten |

**Deskripsi**:  
Mencegah cross-category context pollution. Gunakan dengan `agentic_router` untuk membatasi pencarian ke domain yang relevan.

---

### agentic_mcp

MCP (Model Context Protocol) client.

| Parameter | Tipe | Required | Deskripsi |
|-----------|------|----------|-----------|
| `action` | `"connect" \| "list" \| "call" \| "disconnect" \| "disconnect-all"` | ✅ | Operasi MCP |
| `transport` | `"stdio" \| "http" \| "https"` | ❌ | Tipe transport |
| `command` | `string` | ❌ | Executable path (stdio) |
| `url` | `string` | ❌ | Server URL (http/https) |
| `name` | `string` | ❌ | Server name |
| `headers` | `string` | ❌ | Extra HTTP headers (JSON string) |
| `server` | `string` | ❌ | Server name untuk call/disconnect |
| `tool` | `string` | ❌ | Tool name untuk dipanggil |
| `params` | `string` | ❌ | Tool arguments (JSON string) |

**Deskripsi**:  
Konek ke external servers (databases, APIs, tools) via stdio atau HTTP. Temukan available tools dan panggil mereka. Memungkinkan agent berinteraksi dengan dunia nyata.

---

## 📂 Klasifikasi per Stage

```
Stage I    Foundation     [5 tools]  plan, execute, reflect, verify, status
Stage II   Discovery      [7 tools]  nav, context, snapshot, pr, score, model, model_reset
Stage III  Multi-Agent    [9 tools]  delegate, pipeline, message, parallel, skill,
                                      episodes, dashboard, guard, model_reset
Stage IV   Evolution      [1 tool]   evolve (10 sub-actions)
Stage V    Autonomous     [1 tool]   auto
Blueprint  Experimental   [5 tools]  debate, router, clean, rag, mcp
───────────────────────────────────────────────────
Total                    [28 tools]  (27 named + model_reset sebagai tool terpisah)
```

---

## 🔗 Tool Chaining Patterns

### Pattern 1: Standard Workflow (Stage I)
```
agentic_plan → [agentic_execute × N] → agentic_verify → agentic_status
```

### Pattern 2: Full Multi-Agent Pipeline (Stage III)
```
agentic_pipeline define
  → agentic_pipeline run
    → agentic_delegate (PM) → agentic_message
      → agentic_delegate (Architect) → agentic_message
        → agentic_delegate (Developer) → agentic_message
          → agentic_delegate (QA) → agentic_message
```

### Pattern 3: Autonomous Loop (Stage V)
```
agentic_auto
  (internal: plan → execute → verify → retry → score → learn)
```

### Pattern 4: Research-Before-Coding
```
agentic_nav → agentic_episodes search → agentic_skill find → agentic_plan → ...
```

### Pattern 5: Quality Gate
```
... → agentic_guard → agentic_verify → agentic_score → agentic_pr
```

### Pattern 6: Debate + Clean
```
agentic_debate → agentic_clean → agentic_rag store
```

---

## 📝 Catatan Penting

1. **Session scoping**: Semua state di-track per `sessionID`, tidak pernah cross-session leak.
2. **LLM auto-detect**: OpenCode Free auto-terdeteksi (tidak perlu API key).
3. **Preferensi Model**: `agentic_model` bisa set model berbeda per role dalam satu sesi.
4. **Skill Extraction**: Skills otomatis diekstrak dari step sukses (jika `autoSkillExtract: true` di global config — parameter ini ada di `agent` section `opencode.json`, bukan parameter tool). Sudah ter-wire di `agentic_execute`.
5. **Guard otomatis di `agentic_execute`**: Setiap step sukses auto-dicek halusinasinya (jika `autoHallucinationCheck: true` di config). `agentic_guard` standalone hanya untuk re-run manual / audit — jangan panggil redundan.
6. **ID Hierarchy**: Semua ID bersarang secara konseptual: `sessionID` ⊃ `pipelineRunId` ⊃ `taskId` ⊃ `stepId`. Setiap tool menerima `sessionID` otomatis dari konteks. `agentic_pipeline run` sekarang internal-orchestrator (seperti `agentic_auto`) — tidak perlu manual chain per stage.
7. **Docker**: Setiap fitur baru harus nambah Docker layer di `Dockerfile.test`.

---

> Dokumentasi ini auto-generated dari source code `src/index.ts`.  
> Update dengan: `npm run build && node -e "..."` untuk regenerate.
