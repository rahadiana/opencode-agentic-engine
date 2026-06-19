# src/drift — Deteksi Drift & Analisis Risiko untuk Agentic Workflow

> Modul ini menangani deteksi penyimpangan (drift) dalam eksekusi agentic: evaluasi risiko checkpoint, kompresi konteks, pelacakan dependensi antar-file, verifikasi klaim terhadap halusinasi LLM, dan penemuan pola lintas-sesi untuk perbaikan berkelanjutan.

---

## Daftar File

### 1. `checkpoints.ts`
Sistem checkpoint berbasis risiko. Mengevaluasi setiap langkah eksekusi dan menghasilkan checkpoint dengan tipe `warning` / `review` / `block`. Checkpoint tipe `block` dapat menghentikan eksekusi sampai diakui (acknowledge).

| Fungsi | Parameter | Return | Deskripsi |
|---|---|---|---|
| `CheckpointSystem.enableBlockEnforcement` | `enabled: boolean` | `void` | Mengaktifkan/mematikan pemberlakuan blokade. |
| `CheckpointSystem.isBlocked` | — | `{ blocked: boolean; reason?: string }` | Mengecek apakah ada blocker yang belum diakui. |
| `CheckpointSystem.evaluate` | `stepId: string`, `action: string`, `filesModified: string[]` | `Checkpoint[]` | Evaluasi risiko: hapus file, perubahan massal, perubahan API/interface, config/secret, path sistem, test-only, schema/migration. |
| `CheckpointSystem.acknowledge` | `stepId: string`, `checkpointId: string` | `boolean` | Menandai satu checkpoint sebagai diakui. |
| `CheckpointSystem.acknowledgeAll` | `stepId: string` | `number` | Menandai semua checkpoint di step sebagai diakui. Mengembalikan jumlah. |
| `CheckpointSystem.getUnacknowledged` | — | `Checkpoint[]` | Mengembalikan semua checkpoint yang belum diakui. |
| `CheckpointSystem.hasBlockers` | — | `boolean` | Cek apakah ada checkpoint tipe `block` yang belum diakui. |

---

### 2. `context-compressor.ts`
Kompresi konteks percakapan agentic untuk menghindari overflow token window. Mendukung kompresi berbasis aturan (regex) dan LLM (via `LLMEngine.summarizeContext`).

| Fungsi | Parameter | Return | Deskripsi |
|---|---|---|---|
| `ContextCompressor.setLLM` | `llm: LLMEngine` | `void` | Set instance LLM untuk kompresi berbasis AI. |
| `ContextCompressor.compress` | `planSummary: string`, `turns: Array<{role, content}>`, `decisions: string[]`, `fileChanges: string[]` | `ContextSummary` | Kompres konteks dengan ekstraksi berbasis regex (keputusan, file, invariant, open items). |
| `ContextCompressor.compressWithLLM` | `planGoal: string`, `turns: Array<{role, content}>`, `decisions: string[]`, `fileChanges: string[]` | `Promise<ContextSummary>` | Kompres konteks via LLM, fallback ke `compress()` jika gagal. |
| `ContextCompressor.shouldCompress` | `turnCount: number`, `currentTokensEstimate: number`, `maxTokens?: number` | `boolean` | Menentukan apakah kompresi diperlukan berdasarkan jumlah turn atau perkiraan token. |
| `ContextCompressor.compressToPrompt` | `summary: ContextSummary` | `string` | Format ContextSummary menjadi string prompt terkompresi (markdown). |
| *(private)* `ContextCompressor.extractKeyInfo` | `turns: Array<{role, content}>` | `{ decisions, fileChanges, invariants, openItems }` | Ekstrak keputusan, file, invariant, dan open items dari turn via regex. |
| *(private)* `ContextCompressor.estimateTokens` | `planSummary, decisions, fileChanges` | `number` | Estimasi jumlah token (karakter/4). |

---

### 3. `dependency-tracker.ts`
Pelacak dependensi tingkat file untuk analisis propagasi error dan dampak perubahan. Mendukung parsing import ESM/CommonJS/dynamic, resolusi path relatif, dan graf dependensi transitif.

| Fungsi | Parameter | Return | Deskripsi |
|---|---|---|---|
| `DependencyTracker.parseImports` | `content: string` | `string[]` | Parse semua statement import/require dari konten file. |
| `DependencyTracker.resolveImportPath` | `sourceFile: string`, `specifier: string` | `string[]` | Resolve path relatif ke kandidat file (dengan/tanpa ekstensi, index). |
| `DependencyTracker.scanFiles` | `files: Record<string, string>`, `projectDir: string` | `void` | Scan batch file dan bangun graf dependensi tingkat file. |
| `DependencyTracker.getFileDependents` | `filePath: string` | `string[]` | Dapatkan file yang langsung meng-import file tertentu. |
| `DependencyTracker.updateFile` | `absPath: string`, `content: string`, `projectDir: string` | `void` | Update graf dependensi inkremental untuk satu file. |
| `DependencyTracker.getFileImports` | `filePath: string` | `string[]` | Dapatkan file yang di-import oleh file tertentu. |
| `DependencyTracker.recordChange` | `sessionId: string`, `stepId: string`, `files: string[]` | `void` | Catat perubahan file per step dalam session. |
| `DependencyTracker.addDependency` | `from: string`, `to: string`, `relation: 'imports' \| 'extends' \| 'type-ref'` | `void` | Tambah edge dependensi manual. |
| `DependencyTracker.getDependencies` | `module: string` | `DependencyEdge[]` | Dapatkan edge dependensi dari suatu modul. |
| `DependencyTracker.getDependents` | `module: string` | `DependencyEdge[]` | Dapatkan edge yang bergantung pada modul. |
| `DependencyTracker.analyzeImpact` | `sessionId: string`, `changedFiles: string[]` | `ImpactAnalysis[]` | Analisis dampak perubahan: file terpengaruh, step terpengaruh, level risiko. |
| `DependencyTracker.getFilesChangedByStep` | `sessionId: string`, `stepId: string` | `string[]` | Dapatkan file yang diubah di step tertentu. |
| `DependencyTracker.getFilesChangedByPreviousSteps` | `sessionId: string`, `currentStepId: string`, `planSteps: string[]` | `string[]` | Dapatkan file yang diubah di semua step sebelum step tertentu. |
| `DependencyTracker.analyzeErrorPropagation` | `sessionId: string`, `failingStepId: string`, `error: string`, `planSteps: string[]` | `PropagationAnalysis` | Analisis propagasi error: kode terduga, confidence, path propagasi, saran. |
| `DependencyTracker.clear` | `sessionId?: string` | `void` | Hapus semua data, atau per session tertentu. |
| *(private)* `DependencyTracker.getTransitiveDependents` | `file: string`, `visited?: Set<string>` | `string[]` | Traverse dependen transitif (A import B import C). |

---

### 4. `hallucination-guard.ts`
Guard untuk memverifikasi klaim dalam output eksekusi agentic. Mendeteksi halusinasi LLM dengan mengecek eksistensi file, fungsi, import, dan signature API terhadap filesystem nyata.

| Fungsi | Parameter | Return | Deskripsi |
|---|---|---|---|
| `HallucinationGuard.constructor` | `worktree: string` | — | Inisialisasi dengan path worktree sebagai batas aman resolusi path. |
| `HallucinationGuard.check` | `executionOutput: string`, `modifiedFiles: string[]` | `HallucinationCheck` | Verifikasi semua klaim (file, fungsi, import, API signature) dari output eksekusi. |
| *(private)* `HallucinationGuard.resolveSafe` | `claim: string` | `string \| null` | Resolve path klaim dengan batasan worktree (path traversal protection). |
| *(private)* `HallucinationGuard.extractFileClaims` | `output: string` | `string[]` | Ekstrak klaim file dari pola "created/wrote/generated/saved ..." dan "in/at/to ...". |
| *(private)* `HallucinationGuard.extractFunctionClaims` | `output: string` | `Array<{function, file}>` | Ekstrak klaim fungsi dari pola "added/implemented/created/modified <func> in <file>". |
| *(private)* `HallucinationGuard.extractImportClaims` | `output: string` | `string[]` | Ekstrak klaim import/require. |
| *(private)* `HallucinationGuard.extractApiSignatureClaims` | `output: string`, `modifiedFiles: string[]` | `Array<{method, file}>` | Ekstrak klaim API/method signature dari berbagai pola natural language. |
| *(private)* `HallucinationGuard.verifyApiSignature` | `methodName: string`, `relativePath: string`, `absolutePath: string` | `boolean` | Verifikasi signature method di file (support TS/JS, Python, Go, Rust). |
| *(private)* `HallucinationGuard.functionExists` | `funcName: string`, `file: string`, `knownFiles: string[]` | `boolean` | Cek apakah fungsi ada di file dengan pola deklarasi (function/const/export/etc). |

---

### 5. `pattern-discovery.ts`
Analisis pola lintas-sesi untuk agent self-evolving. Menganalisis episode memori, riwayat error, perubahan file, dan efektivitas skill untuk menghasilkan rekomendasi tindakan.

| Fungsi | Parameter | Return | Deskripsi |
|---|---|---|---|
| `PatternDiscovery.analyze` | `episodes: Episode[]`, `stepResults?: StepResult[]`, `skills?: Array<{name, successRate, usageCount}>`, `options?: {minSessions?, hotSpotThreshold?}` | `PatternReport` | Generate laporan pola komprehensif dari data session. |
| *(private)* `PatternDiscovery.analyzeErrors` | `episodes, stepResults, sessionIds, minSessions` | `ErrorPattern[]` | Analisis error per kategori: hitung frekuensi, afinitas session, saran perbaikan. |
| *(private)* `PatternDiscovery.analyzeFiles` | `episodes, sessionIds, hotSpotThreshold` | `FilePattern[]` | Analisis perubahan file: frekuensi, co-change matrix, deteksi hot spot. |
| *(private)* `PatternDiscovery.analyzeSessionOutcomes` | `episodes, sessionIds` | `SessionOutcomePattern[]` | Analisis outcome session: high-churn, tag-based, refactor/migration patterns. |
| *(private)* `PatternDiscovery.analyzeSkills` | `skills: Array<{name, successRate, usageCount}>` | `SkillEffectiveness[]` | Evaluasi efektivitas skill: status (healthy/needs_review/underperforming/highly_effective) dan tren. |
| *(private)* `PatternDiscovery.generateRecommendations` | `context: {errorPatterns, filePatterns, sessionPatterns, skillEffectiveness, episodes, sessionIds}` | `Recommendation[]` | Generate rekomendasi prioritas berdasarkan semua pola yang terdeteksi. |
| *(private)* `PatternDiscovery.inferCategory` | `text: string` | `string \| null` | Infer kategori error dari teks (import/type/compile/test/runtime). |
| *(private)* `PatternDiscovery.suggestErrorFix` | `category: string` | `string` | Saran perbaikan berdasarkan kategori error. |
| *(private)* `PatternDiscovery.suggestFileAction` | `filePath, sessionCount, totalSessions, coChangeCount` | `string` | Saran tindakan berdasarkan pola perubahan file. |
| *(private)* `PatternDiscovery.countOutcomes` | `episodes: Episode[]` | `{total, success, partial, failed}` | Hitung distribusi outcome episode. |
| *(private)* `PatternDiscovery.groupByTags` | `episodes, sessionIds` | `Map<string, Episode[]>` | Kelompokkan episode berdasarkan tag. |
| *(private)* `PatternDiscovery.computeTrend` | `episodes: Episode[]` | `"improving" \| "degrading" \| "stable"` | Hitung tren dari perbandingan first-half vs second-half success rate. |
