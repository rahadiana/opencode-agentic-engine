# src/memory — Code Review & Optimization Todo

## Status: ✅ All MEDIUM (23) and LOW (22) items fixed (2026-06-19)

## Temuan per File

### `episodic-store.ts`
| Fungsi | Issue | Severity | Status |
|---|---|---|---|
| `record()` | ID `ep-${Date.now()}-${random}` rawan collision | **Medium** | ✅ `Date.now() + Math.random()` |
| `record()` | Tidak ada batas jumlah episode — memory leak | **High** | ✅ MAX 1000, evict oldest |
| `search()` | `tags.includes` substring false positive | **Low** | ✅ Tokenization + exact match |
| `extractTags()` | Semua kata >3 huruf jadi tag — noise | **Medium** | ✅ Stop word filter |
| Tidak ada | Data tidak persist ke disk otomatis | **High** | ✅ Auto-save via setInterval |
| Tidak ada | Tidak ada snapshot/restore untuk debugging | **Low** | ✅ Method `snapshot()` + `restore()` |

### `local-embedder.ts`
| Fungsi | Issue | Severity | Status |
|---|---|---|---|
| `embed()` | Cache `Map` tanpa batas — memory leak | **High** | ✅ Bounded cache max 500 |
| `defaultHttpCall()` | `resp.json()` tanpa cek `resp.ok` | **High** | ✅ Cek `resp.ok` |
| `remoteEmbed()` | Cache key `slice(0,200)` collision | **Medium** | ✅ Full hash cache key |
| `embedBatch()` | Fallback sequential per-item | **Medium** | ✅ Batch hash + cache |
| `remoteEmbed()` vs `embed()` | Fallback logic berbeda | **Low** | ✅ Log warning on fallback |
| `clearCache()` | Tidak periodik — cache stale | **Low** | ✅ TTL-based expiration |

### `multi-index-rag.ts`
| Fungsi | Issue | Severity | Status |
|---|---|---|---|
| `enrichWithVectors()` | Embedding sequential O(n) | **High** | ✅ Parallel via Promise.all |
| `searchByCategory()` | Iterasi SEMUA — O(n) | **High** | ✅ Early break |
| `importAll()` | Push tanpa dedup | **Medium** | ✅ Dedup by ID |
| `searchByCategoryAsync()` | Vector only fallback | **Low** | ✅ Partial vector fallback |
| `autoCategory()` | Hanya TF-IDF | **Medium** | ✅ Domain keywords + TF-IDF |
| `syncCategories()` | Tidak thread-safe | **Medium** | ✅ Clone-and-swap |

### `persistence.ts`
| Fungsi | Issue | Severity | Status |
|---|---|---|---|
| `writeTo()` | `catch {}` silent | **High** | ✅ `console.error` |
| `save()` | 2x I/O (global + local) | **Medium** | ✅ Scope-based (local only) |
| `writeTo()` | Blocking I/O | **Medium** | ✅ `fs.promises` async |
| `writeTo()` | No atomic write | **High** | ✅ Temp file + rename |
| `readFrom()` | Corrupt → null tanpa remediasi | **Low** | ✅ Backup ke `.corrupted/` |
| `save()` | Race condition concurrent | **Medium** | ✅ Queue per-key |

### `schema-version.ts`
| Fungsi | Issue | Severity | Status |
|---|---|---|---|
| `upgrade()` | Safety limit 100 iterasi, circular | **Medium** | ✅ Visited set cycle detection |
| Tidak ada | No migration rollback | **Medium** | ✅ `upgradeWithRollback()` |
| `registerMigration()` | Branching hanya log warning | **Low** | ✅ Throw error |
| `parseMemoryEnvelope()` | Validasi lemah schema_version | **Low** | ✅ Integer + range check |
| `createMemoryEnvelope()` | `Date.now()` timezone | **Low** | ✅ Already `toISOString()` (OK) |

### `session-store.ts`
| Fungsi | Issue | Severity | Status |
|---|---|---|---|
| Tidak ada | Session tidak persist — hilang restart | **High** | ✅ Auto-save 30s |
| `pruneExpired()` | Iterasi semua session — O(n) | **Medium** | ✅ Batch prune interval |
| `getContext()` | Return N turn tanpa summarization | **Medium** | ✅ Sliding window + summary |
| Tidak ada | Map session unbounded | **High** | ✅ Auto-prune + batch limit |
| Tidak ada | Setters/getters tidak thread-safe | **Low** | ✅ Doc: "single event loop only" |
| `removeSession()` | Tidak cleanup modelPreferences | **Low** | ✅ Already done |

### `skill-format.ts`
| Fungsi | Issue | Severity | Status |
|---|---|---|---|
| `createSkillDefinition()` | `author` hardcoded "agent" | **Medium** | ✅ Parameter `author?` |
| `inferRollback()` | "add test" terdeteksi "create" | **Low** | ✅ Specific keywords first |
| `serializeSkill()` | `JSON.stringify` no replacer | **Low** | ✅ Replacer for BigInt/undefined |
| `inspectSkill()` | No markdown injection handle | **Low** | ✅ `escapeMd()` function |

### `skill-store.ts`
| Fungsi | Issue | Severity | Status |
|---|---|---|---|
| `extract()` | Heuristic false positive | **High** | ✅ Steps >= 2 validation |
| `extractName()` | Regex terlalu broad | **Medium** | ✅ Specific patterns |
| `extractSteps()` | Only numbered list | **Medium** | ✅ Markdown list support |
| `inferToolForStep()` | Always undefined | **Low** | ✅ Actual inference |
| `inferTools()` | Always [] | **Low** | ✅ Actual inference |
| `importFromEnvelope()` | Caller must parse | **Medium** | ✅ Accepts `unknown` |

### `skill-training.ts`
| Fungsi | Issue | Severity | Status |
|---|---|---|---|
| `saveTrainingDataToFile()` | `writeFileSync` blocking | **Medium** | ✅ `fs.promises.writeFile` async |
| `exportOpenAIJSONL()` | System prompt hardcoded | **Low** | ✅ Parameter `systemPrompt?` |
| `prepareFineTuningDataset()` | `qualityFilter` misleading | **Low** | ✅ Separate skill/episode filters |
| `episodesToTrainingData()` | filter + map 2 pass | **Low** | ✅ `reduce` single pass |
| Tidak ada | No OpenAI JSONL validation | **Medium** | ✅ `validateOpenAIJSONL()` |
| `trainingDatasetSummary()` | Emoji "📊" | **Low** | ✅ ASCII only |

### `vector-store.ts`
| Fungsi | Issue | Severity | Status |
|---|---|---|---|
| `remove()` | O(terms) — iterasi semua term | **Medium** | ✅ Only stored doc tokens |
| `search()` | O(n) loop docs | **High** | ✅ Inverted index O(1) |
| `search()` | Empty query return `[]` | **Medium** | ✅ Fallback to recent docs |
| `searchAll()` | Tokenize ulang per kategori | **Low** | ✅ Tokenize once via `searchWithTokens` |
| Tidak ada | No length normalization | **Medium** | ✅ Cosine normalization |
| Tidak ada | No n-gram support | **Low** | ✅ Bigram tokenization |

## Ringkisan Prioritas

### High (✅ fixed 10/10)
1. ~~**Memory leaks**: `local-embedder.ts` cache, `episodic-store.ts` unbounded array, `session-store.ts` unbounded sessions~~ ✅
2. ~~**Silent failures**: `persistence.ts` catch {}, `local-embedder.ts` resp.ok~~ ✅
3. ~~**Scalability**: `vector-store.ts` search O(n), `multi-index-rag.ts` enrichWithVectors sequential~~ ✅
4. ~~**Data loss**: `episodic-store.ts` no persist, `session-store.ts` no persist~~ ✅

### Medium (✅ fixed 23/23)
1. ~~**Migration**: `schema-version.ts` no rollback, circular detection~~ ✅
2. ~~**Skill extraction**: `skill-store.ts` false positives, regex longgar~~ ✅
3. ~~**Deduplication**: `multi-index-rag.ts` importAll, `episodic-store.ts` ID collision~~ ✅
4. ~~**Error handling**: Better logging, atomic writes, file corruption remediation~~ ✅

### Low (✅ fixed 22/22)
1. ~~**Optimization**: n-gram support, bigram tokenization, batch operations~~ ✅
2. ~~**Features**: Memory summarization, LRU eviction, metadata indexing~~ ✅
3. ~~**Code quality**: Parameter overrides, standard naming, emoji removal~~ ✅
