# `src/memory` — Modul Sistem Memori & Persistent Storage

> Menyediakan sistem penyimpanan memori lintas-sesi, ekstraksi skill, pencarian RAG, embedding vektor lokal, serta konversi skill ke training data untuk fine-tuning.

---

## Daftar File

### 1. `episodic-store.ts`
Merekam episode tugas (plan → outcome) per sesi/proyek. Mendukung pencarian teks, ekspor/impor dengan envelope versi, dan migrasi skema.

| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `Episode` (interface) | — | — | Data model episode: `id`, `sessionId`, `planGoal`, `summary`, `outcome`, `decisions`, `filesChanged?`, `domain?`, `timestamp`, `tags` |
| `EpisodeEnvelope` (interface) | — | — | Envelope serialisasi: `schema_version`, `type`, `data`, `created_at` |
| `EpisodicStore.record` | `sessionId, planGoal, outcome, decisions, filesChanged?, domain?, projectId?` | `Episode` | Merekam episode baru |
| `EpisodicStore.getByProject` | `projectId, limit=100` | `Episode[]` | Ambil episode per proyek, diurutkan terbaru |
| `EpisodicStore.search` | `query` | `Episode[]` | Cari episode berdasarkan teks (planGoal, tags, decisions, domain, files) |
| `EpisodicStore.getRecent` | `limit=10` | `Episode[]` | Episode terbaru |
| `EpisodicStore.getBySession` | `sessionId` | `Episode[]` | Episode milik sesi tertentu |
| `EpisodicStore.getStats` | — | `{total, successful, partial, failed}` | Statistik episode |
| `EpisodicStore.exportEpisode` | `id` | `EpisodeEnvelope \| null` | Ekspor episode dengan envelope |
| `EpisodicStore.importEpisode` | `envelope: EpisodeEnvelope` | `boolean` | Impor episode dari envelope (dengan upgrade skema) |
| `EpisodicStore.exportAll` | — | `EpisodeEnvelope[]` | Ekspor semua episode |
| `EpisodicStore.getMigrator` | — | `MemorySchemaVersion` | Akses migrator skema |

### 2. `local-embedder.ts`
Embedding vektor lokal via LLM provider (OpenAI-compatible) atau fallback hash-based. Mendukung single & batch embedding + cosine similarity.

| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `EmbedderConfig` (interface) | — | — | Konfigurasi: `model?`, `endpoint?`, `apiKey?`, `dimension?` |
| `EmbeddingResult` (interface) | — | — | Hasil embedding: `vector`, `model`, `dimensions` |
| `LocalEmbedder.constructor` | `config?`, `httpCall?` | — | Inisialisasi embedder dengan konfigurasi |
| `LocalEmbedder.embed` | `text: string` | `Promise<EmbeddingResult>` | Embed satu teks (remote atau hash fallback) |
| `LocalEmbedder.embedBatch` | `texts: string[]` | `Promise<EmbeddingResult[]>` | Embed banyak teks (batch remote atau individual) |
| `LocalEmbedder.cosineSimilarity` | `a: number[], b: number[]` | `number` | Hitung cosine similarity dua vektor |
| `LocalEmbedder.clearCache` | — | `void` | Bersihkan cache embedding |

### 3. `multi-index-rag.ts`
Multi-index RAG dengan hybrid search (TF-IDF + Vector). Mengelola indeks per kategori, episode & skill, auto-category, dan enrichment vektor.

| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `IndexEntry` (interface) | — | — | Entri indeks: `category`, `episode?`, `skill?`, `timestamp`, `keywords`, `title`, `tfidfScore?`, `vectorScore?`, `hybridScore?` |
| `IndexSearchResult` (interface) | — | — | Hasil pencarian: `entries`, `category`, `totalInCategory`, `query` |
| `RAGConfig` (interface) | — | — | Konfigurasi: `keywordWeight`, `vectorWeight`, `embedding` |
| `RAGStats` (interface) | — | — | Statistik: `categories`, `totalEpisodes`, `totalSkills`, `totalTfidfDocs`, `perCategory` |
| `MultiIndexRAG.constructor` | `categories?`, `config?` | — | Inisialisasi dengan kategori default/konfigurasi |
| `MultiIndexRAG.mode` (getter) | — | `string` | Mode pencarian saat ini (hybrid / TF-IDF) |
| `MultiIndexRAG.setPersistenceCallback` | `cb: (entry) => void` | `void` | Daftarkan callback persistensi |
| `MultiIndexRAG.addCategory` | `category: string` | `void` | Tambah kategori baru |
| `MultiIndexRAG.syncCategories` | `categories: string[]` | `void` | Sinkronisasi daftar kategori |
| `MultiIndexRAG.indexEpisode` | `category, episode` | `void` | Index episode ke kategori + TF-IDF |
| `MultiIndexRAG.indexSkill` | `category, skill` | `void` | Index skill ke kategori + TF-IDF |
| `MultiIndexRAG.searchByCategory` | `query, category, limit=10` | `IndexSearchResult` | Cari dalam satu kategori (TF-IDF + keyword) |
| `MultiIndexRAG.searchAll` | `query, limit=10` | `IndexSearchResult[]` | Cari di semua kategori |
| `MultiIndexRAG.searchByCategoryAsync` | `query, category, limit=10` | `Promise<IndexSearchResult>` | Cari async dengan enrichment vektor |
| `MultiIndexRAG.searchAllAsync` | `query, limit=10` | `Promise<IndexSearchResult[]>` | Cari semua async dengan enrichment vektor |
| `MultiIndexRAG.autoCategory` | `query: string` | `string` | Pilih kategori terbaik untuk query |
| `MultiIndexRAG.getStats` | — | `RAGStats` | Statistik semua indeks |
| `MultiIndexRAG.exportAll` | — | `Record<string, ...>` | Ekspor semua data untuk persistensi |
| `MultiIndexRAG.importAll` | `data` | `void` | Impor data dari persistensi |
| `enrichWithVectors` | `embedder, results, query` | `Promise<IndexSearchResult[]>` | Perkaya hasil dengan skor vektor |

### 4. `persistence.ts`
Hybrid global + local persistence layer. Global di `~/.config/opencode/agentic-store/`, lokal di `.agentic/store/`. Mendukung scoping per proyek.

| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `PersistentState<T>` (interface) | — | — | State persisted: `key`, `data`, `updatedAt` |
| `PersistenceLayer.constructor` | `worktree: string` | — | Inisialisasi dengan direktori proyek |
| `PersistenceLayer.save` | `namespace, key, data, scope?` | `void` | Simpan data ke global + lokal |
| `PersistenceLayer.load` | `namespace, key, scope?` | `T \| null` | Muat data (lokal override global) |
| `PersistenceLayer.loadAll` | `namespace, scope?` | `PersistentState<T>[]` | Muat semua data dengan override lokal |
| `PersistenceLayer.delete` | `namespace, key, scope?` | `boolean` | Hapus data dari global & lokal |
| `PersistenceLayer.listKeys` | `namespace, scope?` | `string[]` | Daftar semua key dalam namespace |
| `PersistenceLayer.listScopes` | `namespace` | `string[]` | Daftar semua scope prefix |

### 5. `schema-version.ts`
Sistem migrasi skema memory dengan envelope versioning. Mendukung migrasi berantai, deteksi branching, dan validasi envelope.

| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `MEMORY_SCHEMA_VERSION` (const) | — | `1` | Versi skema terkini |
| `SchemaMigration` (interface) | — | — | Definisi migrasi: `from`, `to`, `description`, `apply` |
| `MemorySchemaVersion.registerMigration` | `migration: SchemaMigration` | `void` | Daftarkan migrasi baru (cegah branching) |
| `MemorySchemaVersion.upgrade` | `data, currentVersion` | `T` | Upgrade data melalui rantai migrasi |
| `MemorySchemaVersion.getMigrations` | — | `SchemaMigration[]` | Daftar semua migrasi |
| `MemorySchemaVersion.currentVersion` (static) | — | `number` | Versi skema saat ini |
| `createMemoryEnvelope` | `data, type` | `{schema_version, type, data, created_at}` | Buat envelope dengan versi skema |
| `parseMemoryEnvelope` | `envelope: unknown` | `{version, type, data, createdAt} \| null` | Parse dan validasi envelope |

### 6. `session-store.ts`
Menyimpan state sesi: percakapan (conversation turns), plan, artifacts, progress eksekusi, dan preferensi model per-role.

| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `ConversationTurn` (interface) | — | — | Satu turn percakapan: `role`, `content`, `timestamp`, `metadata?` |
| `SessionState` (interface) | — | — | State sesi: `sessionId`, `turns`, `plan?`, `artifacts`, `currentTaskType?`, `currentDomain?` |
| `ExecutorSnapshot` (interface) | — | — | Snapshot eksekutor: `completedSteps`, `stepStates` |
| `SessionStore.setForgetAfterDays` | `days: number` | `void` | Atur TTL kedaluwarsa sesi |
| `SessionStore.pruneExpired` | — | `number` | Hapus sesi yang kedaluwarsa |
| `SessionStore.getOrCreate` | `sessionId` | `SessionState` | Ambil atau buat sesi baru |
| `SessionStore.updateProgress` | `sessionId, snapshot` | `void` | Update progress eksekusi |
| `SessionStore.addTurn` | `sessionId, turn` | `void` | Tambah turn percakapan |
| `SessionStore.getContext` | `sessionId, maxTurns=20` | `ConversationTurn[]` | Ambil konteks percakapan terbaru |
| `SessionStore.getContextSummary` | `sessionId` | `string` | Ringkasan sesi (turns, progress, plan) |
| `SessionStore.removeSession` | `sessionId` | `void` | Hapus sesi dan semua datanya |
| `SessionStore.setModelPreference` | `sessionId, role, model` | `void` | Set preferensi model per role |
| `SessionStore.getModelPreference` | `sessionId, role` | `string \| undefined` | Ambil preferensi model per role |
| `SessionStore.getAllModelPreferences` | `sessionId` | `{role, model}[]` | Semua preferensi model dalam sesi |
| `SessionStore.clearModelPreference` | `sessionId, role?` | `void` | Hapus preferensi model |

### 7. `skill-format.ts`
Format baku skill dengan skema `agentic-skill/v1`. Menyediakan fungsi create, serialize, deserialize, inspect, dan infer rollback otomatis.

| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `SkillMeta` (interface) | — | — | Metadata: `format`, `id`, `name`, `version`, `author`, `agentRole?` |
| `SkillDefinition` (interface) | — | — | Skill lengkap: `meta`, `trigger`, `workflow`, `quality`, `audit` |
| `SkillStep` (interface) | — | — | Langkah workflow: `order`, `action`, `description`, `tool?`, `expectedOutput`, `rollback?` |
| `createSkillDefinition` | `name, triggerPattern, keywords, steps, triggerContext?` | `SkillDefinition` | Buat definisi skill baru |
| `serializeSkill` | `skill: SkillDefinition` | `string` | Serialisasi skill ke JSON |
| `deserializeSkill` | `json: string` | `SkillDefinition \| null` | Deserialisasi JSON ke skill |
| `inspectSkill` | `skill: SkillDefinition` | `string` | Generate representasi human-readable skill |

### 8. `skill-store.ts`
Mengelola koleksi skill: ekstraksi otomatis dari output agen, pencarian, pencatatan kegagalan, dan ekspor/impor envelope.

| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `SkillRecord` (interface) | — | — | Record skill: `definition`, `usageCount`, `successRate`, `lastUsed` |
| `SkillStore.extract` | `turn, contextTags?` | `Promise<SkillRecord \| null>` | Ekstrak skill dari output agent |
| `SkillStore.find` | `query: string` | `SkillRecord[]` | Cari skill berdasarkan nama/pattern/keyword |
| `SkillStore.getAll` | — | `SkillRecord[]` | Semua skill, diurutkan terbaru |
| `SkillStore.getById` | `id: string` | `SkillRecord \| undefined` | Ambil skill by ID |
| `SkillStore.reportFailure` | `skillId: string` | `boolean` | Laporkan kegagalan skill (update success rate) |
| `SkillStore.exportEnvelope` | `skillId: string` | `string \| null` | Ekspor skill dalam envelope JSON |
| `SkillStore.importFromEnvelope` | `json: string` | `boolean` | Impor skill dari envelope JSON |

### 9. `skill-training.ts`
Konversi skill & episode ke training data untuk fine-tuning. Mendukung format OpenAI JSONL dan instructions JSON.

| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `TrainingExample` (interface) | — | — | Contoh training: `instruction`, `response`, `skillName`, `quality` |
| `TrainingDataset` (interface) | — | — | Dataset: `format`, `totalExamples`, `qualityFilter`, `data` |
| `skillToTrainingExample` | `skill: SkillRecord` | `TrainingExample` | Konversi skill ke contoh training |
| `exportOpenAIJSONL` | `examples: TrainingExample[]` | `string` | Ekspor ke format OpenAI JSONL |
| `exportInstructionsJSON` | `examples: TrainingExample[]` | `string` | Ekspor ke format instructions JSON |
| `trainingDatasetSummary` | `examples: TrainingExample[]` | `string` | Ringkasan kualitas dataset |
| `episodeToTrainingExample` | `episode: Episode` | `TrainingExample` | Konversi episode ke contoh training |
| `episodesToTrainingData` | `episodes, format?, minQuality?` | `TrainingDataset` | Konversi banyak episode ke dataset |
| `prepareFineTuningDataset` | `skills, episodes, format?, minSkillSuccessRate?, minEpisodeQuality?` | `TrainingDataset` | Gabung skill + episode untuk fine-tuning |
| `saveTrainingDataToFile` | `dataset, outputPath` | `string` | Simpan dataset ke file |
| `skillsToTrainingData` | `skills, format?, minSuccessRate?` | `TrainingDataset` | Konversi banyak skill ke dataset |

### 10. `vector-store.ts`
Sparse Vector Store (TF-IDF) tanpa dependensi eksternal. Inverted index per kategori, incremental indexing, title/keyword bonus, dan scoring TF-IDF murni.

| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `TfIdfDoc` (interface) | — | — | Dokumen: `id`, `category`, `title`, `content`, `keywords`, `metadata?` |
| `ScoredResult` (interface) | — | — | Hasil scoring: `doc`, `score`, `matchFields` |
| `VectorStore.index` | `doc: TfIdfDoc` | `void` | Index dokumen (idempotent, re-index replace) |
| `VectorStore.remove` | `id: string` | `void` | Hapus dokumen dari indeks |
| `VectorStore.search` | `query, category, limit=10` | `ScoredResult[]` | Cari dalam kategori dengan TF-IDF |
| `VectorStore.searchAll` | `query, limit=10` | `ScoredResult[]` | Cari di semua kategori |
| `VectorStore.exportAll` | — | `TfIdfDoc[]` | Ekspor semua dokumen |
| `VectorStore.importAll` | `docs: TfIdfDoc[]` | `void` | Impor dokumen (re-index semua) |
| `VectorStore.size` (getter) | — | `number` | Total dokumen terindex |
| `VectorStore.categories` (getter) | — | `string[]` | Daftar kategori |
| `VectorStore.docCountOf` | `category: string` | `number` | Jumlah dokumen per kategori |
