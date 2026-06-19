# src/agents — Code Review & Optimization Todo

## Ringkasan
Total file: 4 | Total fungsi dianalisis: 25

---

## Temuan per File

### `agent-runtime.ts` (110 baris)
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `AgentRuntime.engines` (Map) | **Memory leak permanen**: Map `engines` tidak pernah dibersihkan. Setiap kombinasi `(sessionId, role)` membuat engine baru dan tidak pernah di-`delete`. Seiring waktu, memori membengkak tanpa batas. | **HIGH** | Tambahkan method `disposeSession(sessionId)` atau `cleanup()` yang menghapus engine yang tidak terpakai dari Map. Bisa juga pakai `WeakRef` atau TTL-based eviction. |
| `AgentRuntime.getEngine()` | **No eviction policy**: Engine di-cache selamanya, tidak ada batas maksimum. Jika ribuan session berjalan, semua engine tetap hidup. | **HIGH** | Implementasi `Map.size` cap atau LRU eviction. Set `maxEngines` di constructor. |
| `AgentRuntime.setOpencodeClient()` | **Tipe `unknown` tanpa validasi**: `opencodeClient` disimpan sebagai `unknown` dan tidak pernah divalidasi sebelum dipakai oleh `LLMEngine`. Jika client invalid, error baru ketahuan di runtime. | **MED** | Validasi bahwa object memiliki method yang dibutuhkan sebelum disimpan. |
| `AgentRuntime.execute()` | **Catch-all error handling**: Semua error (termasuk `TypeError`, `RangeError`) ditangkap generik jadi `{ success: false, error: message }`. Masking error spesifik menyulitkan debugging. | **MED** | Kategorikan error: bedakan `LLM timeout`, `rate limit`, `invalid response`. Propagasi error spesifik. |
| `AgentRuntime.execute()` | **No timeout pada LLM call**: `engine.call()` bisa menggantung selamanya jika LLM provider tidak merespons. | **HIGH** | Tambahkan `AbortController` / `Promise.race` dengan timeout (default 60 detik). |
| `AgentRuntime` (keseluruhan) | **Tidak ada method destroy**: Tidak ada cara untuk melepas resource ketika session dihapus. Semua engine tetap di Map sampai process mati. | **MED** | Implementasi `dispose()` / `Symbol.dispose` untuk cleanup eksplisit. |

### `coordinator.ts` (263 baris)
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `AgentCoordinator.writeSharedMemory()` | **Race condition pada shared memory**: Di skenario paralel (via `agentic_parallel`), dua agent bisa `writeSharedMemory` ke key yang sama secara simultan. Last-write-wins tanpa deteksi konflik — menyebabkan **split-brain state**. | **HIGH** | Implementasi atomic write: `propose → validate → commit` pattern dengan optimistic locking (version tag per entry). Baca best practice dari Network-AI. |
| `AgentCoordinator.writeSharedMemoryBatch()` | **Tidak atomic**: Jika batch 10 entry dan entry ke-5 gagal, entry 1-4 sudah terlanjur ditulis. Tidak ada rollback. | **HIGH** | Bungkus dalam Map batch: validasi dulu semua key, baru commit. Atau gunakan transaction pattern. |
| `AgentCoordinator.onSharedMemoryWrite()` | **Listener leak**: Listener didaftarkan via `onSharedMemoryWrite()` tapi tidak ada method `removeListener()` untuk mencabutnya. Listener menumpuk dan tidak bisa di-GC karena Map `memoryListeners` hold reference. | **MED** | Tambahkan `offSharedMemoryWrite()` yang mengembalikan fungsi unsubscribe. Contoh: `const unsub = coord.onSharedMemoryWrite(fn)`. |
| `AgentCoordinator.messages` (Map) | **Unbounded growth**: Semua pesan disimpan di Map tanpa pernah dihapus. Botol saos messages terus bertambah. | **MED** | Tambahkan TTL (time-to-live) atau `maxMessagesPerRole` cap. Hapus pesan yang sudah `read` lebih dari N hari. |
| `AgentCoordinator.tasks` (Map per session) | **Unbounded growth**: Task history per session tidak pernah dibersihkan. Akumulasi seumur hidup. | **MED** | Batasi `maxTasksPerSession` atau hapus task `done` setelah N jam. |
| `sendMessage()` | **ID collision risk**: ID format `msg-{Date.now()}-{random(8)}`. Di concurrency tinggi (queue/worker), bisa collision. | **LOW** | Ganti ke `crypto.randomUUID()` untuk jaminan unik. |
| `getNextInPipeline()` | **Fragile ordering**: Mengandalkan indeks array sebagai pengganti dependency graph. Jika ada task yang di-reorder, logika pipeline rusak. | **MED** | Implementasi explicit `dependsOn` array di task, bukan indeks urutan. |
| `getSuggestedRole()` | **LLM error silent catch**: Jika `llm.suggestRole()` throw, error ditelan (catch {}). Developer tidak tahu kalau LLM gagal. | **LOW** | Minimal log warning saat LLM fallback ke keyword. |
| `searchSharedMemory()` | **Case-insensitive search naif**: `String.toLowerCase()` untuk semua entry — tidak scale untuk banyak data. | **LOW** | Pertimbangkan gunakan `fuse.js` atau indexing untuk search. |

### `orchestrator.ts` (707 baris)
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `Orchestrator.activeRuns` (Map) | **Memory leak permanen**: Setiap pipeline run disimpan di `activeRuns` selamanya. Tidak ada mekanisme cleanup setelah run selesai. | **HIGH** | Tambahkan method `cleanupRun(runId)` yang dipanggil otomatis setelah `executePipeline` selesai. Atau gunakan TTL. |
| `Orchestrator.pipelines` (Map) | **Tidak ada persistence**: Semua pipeline definition hilang setelah restart. Pipeline harus didefinisikan ulang tiap kali. | **MED** | Serialisasi pipelines ke file JSON. Load saat startup. |
| `Orchestrator.executePipeline()` | **Fungsi terlalu besar (129 baris)**: Melanggar SRP (Single Responsibility). Sulit di-test dan dipelihara. Semua logika ada di satu method. | **HIGH** | Refactor jadi method terpisah: `executeStage()`, `handleDeveloperOutput()`, `handleQAOutput()`, `recordStageCompletion()`. |
| `Orchestrator.executePipeline()` | **No timeout pada LLM call**: `this.llmEngine!.call()` tidak punya timeout. Jika LLM hang, pipeline menggantung selamanya. | **HIGH** | Tambahkan timeout per-stage (30-120 detik). Via `AbortSignal` atau `Promise.race`. |
| `crossValidate()` (LLM path) | **Silent catch**: Error dari `llmEngine.call()` di line 269 ditelan tanpa log. Validasi lintas-stage bisa gagal tanpa diketahui. | **MED** | Log error minimal `console.warn` saat LLM cross-validation gagal. |
| `checkInvariants()` | **String matching rapuh**: Mencocokkan `inv.expr` dengan string literal seperti `"no errors"`, `"compile passes"`. Sangat mudah broken jika format berubah. | **HIGH** | Ganti dengan enum atau typed condition evaluator. Jangan parse string secara hardcoded. |
| `executePipeline()` | **Partial-save only in comment**: Komentar di line 411-412 bilang "partial-save" tapi tidak menyimpan apapun. Hanya break dari loop. | **MED** | Simpan hasil stage yang sudah sukses ke file/disk sebelum break. |
| `buildContextForRole()` | **Hardcoded emoji**: ✅▶⏳ dipakai langsung di string. Tidak sesuai untuk environment yang tidak support Unicode atau plain-text. | **LOW** | Ganti dengan teks alternatif: `[DONE]`, `[ACTIVE]`, `[PENDING]`. |
| `executePipeline()` | **Prompts hardcoded di method**: System prompt untuk setiap role ditulis sebagai `Record<string,string>` hardcoded (line 355-361). Tidak bisa dikustomisasi tanpa edit source. | **MED** | Ambil prompt dari `RoleRegistry` atau dari config eksternal. |
| `validateSchema()` | **Parsing JSON dua kali**: `JSON.parse(output)` di setiap iterasi field. Jika ada 10 field, parsing 10x. | **LOW** | Parse sekali di awal, reuse hasilnya. |

### `role-registry.ts` (373 baris)
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `RoleRegistry.setModel()` | **Mutasi object built-in langsung**: `def.model = model` memodifikasi object yang ada di Map secara mutable. Jika ada referensi lain ke object tersebut, mereka juga berubah. | **MED** | Gunakan immutable update: `this.builtIn.set(role, { ...def, model })` |
| `registerCustom()` | **Tidak ada validasi input**: `CustomAgentDef` tidak divalidasi — bisa diisi `role: ""`, `name: ""`, `prompt: ""` tanpa error. | **MED** | Tambahkan validasi bahwa semua field string tidak kosong. |
| `addHistoryEntry()` | **Race condition version**: Jika `addHistoryEntry` dipanggil 2x di millisecond yang sama, `version` inkremen secara terpisah tapi bisa sama jika ada concurrency issues. | **LOW** | Gunakan increment atomik atau timestamp-based versioning. |
| `rollbackPrompt()` | **History unbounded**: Setiap rollback menambah entry baru. Rollback berkali-kali = history membengkak tanpa batas. | **LOW** | Batasi `maxHistoryEntries` per role (default: 50). |
| `defaultModels` | **Hardcoded tanpa tipe ketat**: `Record<string, string>` memungkinkan typo seperti `"analyst"` vs `"analist"` tanpa peringatan. | **LOW** | Gunakan tipe `Partial<Record<AgentRole, string>>` untuk validasi compile-time. |
| `suggestModel()` | **Mutable fallback**: Jika `complexity` diubah, `defaultModels` bisa override logic. Tapi tidak ada yang akan notice karena tidak ada logging. | **LOW** | Tambahkan log/debug output saat model suggestion berubah. |

---

## Ringkisan Prioritas

### 🔴 HIGH (0 temuan — ALL FIXED ✅)
1. ~~`agent-runtime.ts` — Memory leak di `engines` Map (tidak pernah dibersihkan)~~ ✅ Fixed: `dispose()` + cleanup
2. ~~`agent-runtime.ts` — Tidak ada eviction policy untuk engine cache~~ ✅ Fixed: LRU eviction (max 10)
3. ~~`agent-runtime.ts` — Tidak ada timeout pada LLM call~~ ✅ Fixed: AbortController 120s
4. ~~`coordinator.ts` — Race condition di shared memory (split-brain risk)~~ ✅ Fixed: Promise-based mutex
5. ~~`coordinator.ts` — `writeSharedMemoryBatch()` tidak atomic~~ ✅ Fixed: temp array + atomic commit
6. ~~`orchestrator.ts` — Memory leak di `activeRuns` Map~~ ✅ Fixed: `cleanupStaleRuns()` max 50
7. ~~`orchestrator.ts` — `executePipeline()` terlalu besar (129 baris, violation SRP)~~ ✅ Fixed: extracted `checkBudget()`, `executeStage()`, `handleStageOutput()`, `recordStageCompletion()`
8. ~~`orchestrator.ts` — Tidak ada timeout pada LLM call di pipeline~~ ✅ Fixed: Promise.race 120s per stage
9. ~~`orchestrator.ts` — `checkInvariants()` string matching sangat rapuh~~ ✅ Fixed: `InvariantKind` enum + regex `classifyInvariant()`

### 🟡 MED (9 temuan)
1. `agent-runtime.ts` — `opencodeClient` tanpa validasi (tipe `unknown`)
2. `agent-runtime.ts` — Catch-all error handling masking error spesifik
3. `agent-runtime.ts` — Tidak ada `dispose()` method
4. `coordinator.ts` — Listener leak (`onSharedMemoryWrite` tanpa `remove`)
5. `coordinator.ts` — `messages` Map unbounded growth
6. `coordinator.ts` — `tasks` Map unbounded growth
7. `orchestrator.ts` — Pipeline definitions tidak di-persist
8. `orchestrator.ts` — LLM cross-validation error silent catch
9. `orchestrator.ts` — Prompts hardcoded di method, tidak bisa dikustom

### 🟢 LOW (7 temuan)
1. `coordinator.ts` — ID collision risk (`Date.now()` + `Math.random()`)
2. `coordinator.ts` — `getNextInPipeline()` fragile ordering
3. `coordinator.ts` — `searchSharedMemory()` case-insensitive naif
4. `orchestrator.ts` — Emoji hardcoded di `buildContextForRole()`
5. `orchestrator.ts` — JSON.parse di loop (`validateSchema()`)
6. `role-registry.ts` — `setModel()` mutasi object mutable
7. `role-registry.ts` — Tidak ada validasi di `registerCustom()`

---

## Referensi Best Practice
- Node.js `child_process` — gunakan `spawn()` untuk streaming, `execFileSync()` untuk blocking, selalu handle `error` + `close` event, set timeout via `AbortSignal`, dan pastikan pipe buffer tidak overflow (Node.js docs v26.3).
- Multi-agent race condition — shared memory tanpa mutex menyebabkan **split-brain state**. Implementasi pattern `propose → validate → commit` untuk atomic writes (Network-AI / Helix Agents).
- TypeScript Map memory leak — setiap `Map.set()` tanpa `Map.delete()` yang berpasangan adalah potensi leak. Gunakan `WeakRef` atau dispose pattern untuk object dengan lifecycle panjang.
- Event listener cleanup — setiap `emitter.on()` harus punya `emitter.off()` berpasangan. `MaxListenersExceededWarning` adalah indikator leak (Node.js docs).
