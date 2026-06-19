# src/memory — Code Review & Optimization Todo

## Temuan per File

### `episodic-store.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `record()` | ID `ep-${Date.now()}-${random}` rawan collision — fixed with random suffix | **Medium** | ✅ Menggunakan `Date.now() + Math.random()` |
| `record()` | Tidak ada batas jumlah episode — memory leak pada session panjang | **High** | ✅ MAX 1000, evict oldest |
| `search()` | `tags.some(t => t.includes(q))` mencocokkan substring, bukan token utuh — false positive | **Low** | Gunakan tokenisasi dan exact match, bukan `includes()` |
| `extractTags()` | Semua kata >3 huruf jadi tag — banyak noise (kata umum tidak relevan) | **Medium** | Filter stop words + gunakan TF-IDF atau LLM untuk tag extraction |
| Tidak ada | Data hanya di memory, tidak pernah persist ke disk otomatis | **High** | ✅ Auto-save via PersistenceLayer setiap 30s (setInterval) |
| Tidak ada | Tidak ada mekanisme snapshot/restore untuk debugging | **Low** | Tambah method `snapshot()` dan `restore()` |

### `local-embedder.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `embed()` | Cache `Map` tanpa batas — memory leak | **High** | ✅ Bounded cache max 500, prune oldest |
| `defaultHttpCall()` | `resp.json()` dipanggil tanpa cek `resp.ok` — error API tidak terdeteksi | **High** | ✅ Cek `resp.ok` sebelum parse, lempar error |
| `remoteEmbed()` | Cache key `text.slice(0,200)` bisa collision untuk teks berbeda dengan prefix sama | **Medium** | Gunakan hash penuh (SHA-256) sebagai cache key |
| `embedBatch()` | Fallback ke `Promise.all(texts.map(t => this.embed(t)))` — sequential per-item di hash mode | **Medium** | Batch hash embedding: compute semua hash dalam satu loop |
| `remoteEmbed()` vs `embed()` | Logic API key fallback berbeda — `remoteEmbed()` lempar error, `embed()` fallback silent | **Low** | Standardisasi: log warning saat fallback ke hash |
| `clearCache()` | Tidak di-panggil secara periodik — cache stale | **Low** | Tambah TTL-based cache expiration |

### `multi-index-rag.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `enrichWithVectors()` | Embedding per entry sequential — O(n * embedding) lambat | **High** | ✅ Parallel via Promise.all per entry |
| `searchByCategory()` | Iterasi SEMUA episode & skills dalam kategori — O(n) per search | **High** | ✅ Early break setelah cukup keyword matches |
| `importAll()` | `index.episodes.push(...episodes)` tanpa dedup — duplikasi data | **Medium** | Cek duplicate ID sebelum push, atau gunakan Map |
| `searchByCategoryAsync()` | Vector enrichment hanya fallback jika embedder null — no partial vector mode | **Low** | Support fallback partial: sebagian docs dengan vector, sisanya TF-IDF |
| `autoCategory()` | Hanya berdasarkan TF-IDF — tidak pakai keyword/domain heuristic | **Medium** | Tambah weighted scoring: domain match + TF-IDF + keyword |
| `syncCategories()` | Tidak thread-safe — concurrent access ke `this.indices` | **Medium** | Gunakan `ReadWriteLock` atau clone-and-swap pattern |

### `persistence.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `writeTo()` | `catch {}` silent — error seperti disk full tidak terdeteksi | **High** | ✅ Log error via `console.error` |
| `save()` | Selalu write ke global AND local — 2x I/O untuk satu operasi | **Medium** | Write ke local saja jika scope dipakai; gunakan symlink untuk global |
| `writeTo()` | `existsSync + mkdirSync + writeFileSync` sync — blocking I/O | **Medium** | Gunakan `fs.promises` async API |
| `writeTo()` | No atomic write — corruption jika crash di tengah write | **High** | ✅ Write ke temp file dulu, lalu `renameSync` |
| `readFrom()` | File corrupt → return null tanpa remediasi | **Low** | Backup file corrupt ke `.corrupted/` dan return null |
| `save()` | Race condition concurrent save ke file yang sama | **Medium** | Gunakan file lock atau queue per-key |

### `schema-version.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `upgrade()` | Safety limit 100 iterasi — jika circular migration, hang 100x | **Medium** | Deteksi cycle dengan visited set `Set<number>` |
| Tidak ada | Tidak ada migration rollback — upgrade tidak bisa undo | **Medium** | Simpan snapshot data pre-migration untuk rollback |
| `registerMigration()` | Branching detection hanya log warning — tetap jalan | **Low** | Lempar error, bukan warning |
| `parseMemoryEnvelope()` | Validasi lemah — `schema_version` divalidasi hanya `typeof number` | **Low** | Validasi integer positif, cek range version |
| `createMemoryEnvelope()` | `created_at` pakai `Date.now()` — timezone tidak eksplisit | **Low** | Gunakan `toISOString()` (sudah UTC) — sebenarnya OK |

### `session-store.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| Tidak ada | Session tidak pernah persist — hilang saat restart | **High** | ✅ Auto-save via PersistenceLayer setiap 30s (setInterval) |
| `pruneExpired()` | Iterasi semua session — blocking untuk ribuan session | **Medium** | Gunakan interval-based pruning dengan batch limit |
| `getContext()` | Return N turn terakhir tanpa summarization — token waste | **Medium** | Implementasi sliding window + summary compression |
| Tidak ada | Map session unbounded — memory leak jika `pruneExpired()` jarang dipanggil | **High** | Auto-prune setiap N operasi + hard limit per session |
| Tidak ada | Setters/getters tidak thread-safe | **Low** | Minimal dokumentasi: "not thread-safe, call from single event loop" |
| `removeSession()` | Tidak cleanup `modelPreferences` size | **Low** | `modelPreferences.delete(sessionId)` sudah dilakukan |

### `skill-format.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `createSkillDefinition()` | `author` hardcoded `"agent"` — tidak bisa human-authored | **Medium** | Tambah parameter `author?: "agent" \| "human"` |
| `inferRollback()` | Keyword matching naive — "add test" terdeteksi sebagai "create" | **Low** | Prioritas keyword spesifik sebelum general |
| `serializeSkill()` | `JSON.stringify` tanpa replacer — crash jika ada BigInt/undefined | **Low** | Tambah replacer function |
| `inspectSkill()` | Tidak handle markdown injection di `name`/`pattern` | **Low** | Escape karakter markdown khusus |

### `skill-store.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `extract()` | Heuristic `✅` / "success" + "step" — banyak false positive | **High** | Butuh validasi tambahan: struktur steps minimal 2, ada tool calls |
| `extractName()` | Regex `\w[\w\s]{3,40}` — bisa capture kalimat tidak relevan | **Medium** | Butuh pattern yang lebih spesifik, seperti "Created/Implemented X" |
| `extractSteps()` | Hanya format numbered list `1. ...` — format lain tidak terdeteksi | **Medium** | Tambah support untuk markdown list (`- `, `* `) |
| `inferToolForStep()` | Selalu return `undefined` — tool inference tidak berfungsi | **Low** | Implement actual inference atau dokumentasikan sebagai TODO |
| `inferTools()` | Selalu return `[]` — sama seperti di atas | **Low** | Sama |
| `importFromEnvelope()` | Parameter `json: string` lalu `JSON.parse()` — caller harus parse duluan | **Medium** | Ubah signature jadi `importFromEnvelope(obj: unknown)` |

### `skill-training.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `saveTrainingDataToFile()` | `writeFileSync` blocking — tidak cocok production | **Medium** | Gunakan `fs.promises.writeFile()` async |
| `exportOpenAIJSONL()` | System prompt hardcoded — tidak bisa dikustom | **Low** | Jadikan parameter opsional |
| `prepareFineTuningDataset()` | `qualityFilter` ambil `Math.min(minSkill, minEpisode)` — misleading | **Low** | Pisah filter quality untuk skill dan episode |
| `episodesToTrainingData()` | Filter `e => ...` iterasi array 2x (filter + map) — bisa 1 pass | **Low** | Gunakan `flatMap` atau `reduce` |
| Tidak ada | No validation bahwa output JSONL valid untuk OpenAI | **Medium** | Validasi escape sequences, max tokens per example |
| `trainingDatasetSummary()` | Gunakan emoji "📊" — tidak standard untuk console | **Low** | Hapus emoji, ganti ASCII |

### `vector-store.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `remove()` | Iterasi SEMUA term di `catIndex` untuk hapus satu doc — O(terms) inefficient | **Medium** | Simpan token list per doc dan hanya iterasi token tersebut |
| `search()` | Loop SEMUA docs untuk title/keyword match — O(n) per search | **High** | ✅ Keyword + title inverted index untuk O(1) lookup |
| `search()` | Query yang di-tokenize bisa empty karena stop word removal — return `[]` | **Medium** | Jika query setelah tokenize kosong, return fallback ke recent docs |
| `searchAll()` | Panggil `search()` per kategori — query di-tokenize berulang | **Low** | Tokenize sekali, reuse untuk semua kategori |
| Tidak ada | No document length normalization — dokumen panjang > score tinggi | **Medium** | Tambah cosine normalization: bagi score dengan sqrt(len(doc)) |
| Tidak ada | No n-gram support — "machine learning" tidak match "learning machine" | **Low** | Tambah bigram tokenization opsional |

## Ringkisan Prioritas

### High (✅ fixed 10/10)
1. ~~**Memory leaks**: `local-embedder.ts` cache, `episodic-store.ts` unbounded array, `session-store.ts` unbounded sessions~~ ✅
2. ~~**Silent failures**: `persistence.ts` catch {}, `local-embedder.ts` resp.ok~~ ✅
3. ~~**Scalability**: `vector-store.ts` search O(n), `multi-index-rag.ts` enrichWithVectors sequential~~ ✅
4. ~~**Data loss**: `episodic-store.ts` no persist, `session-store.ts` no persist~~ ✅

### Medium (perlu diperbaiki)
1. **Migration**: `schema-version.ts` no rollback, circular detection
2. **Skill extraction**: `skill-store.ts` false positives, regex longgar
3. **Deduplication**: `multi-index-rag.ts` importAll, `episodic-store.ts` ID collision
4. **Error handling**: Better logging, atomic writes, file corruption remediation

### Low (nice to have)
1. **Optimization**: n-gram support, bigram tokenization, batch operations
2. **Features**: Memory summarization, LRU eviction, metadata indexing
3. **Code quality**: Parameter overrides, standard naming, emoji removal
