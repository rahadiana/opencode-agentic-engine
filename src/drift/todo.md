# src/drift — Code Review & Optimization Todo

## Temuan per File

### `checkpoints.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `evaluate()` | Parameter `action` menggunakan `includes()` sederhana — "delete unused export" akan false-positive trigger API contract check | **HIGH** | Gunakan NLP ringan atau keyword negasi; pastikan kata kerja benar-benar terkait konteks, bukan substring kebetulan |
| `evaluate()` | `highRiskPatterns` pakai `file.includes(risky)` — path `/documents/etcetera/config.yaml` akan ke-block padahal valid | **MEDIUM** | Gunakan `path.resolve()` + segment matching; bandingkan path canonical, bukan substring |
| `getUnacknowledged()` | Mengembalikan SEMUA checkpoint dari SEMUA step tanpa filter — bisa overflow context | **LOW** | Tambahkan parameter `stepId` opsional untuk scope filtering |
| `evaluate()` | Hanya evaluasi berdasarkan nama file & action string — tidak baca konten file asli | **MEDIUM** | Integrasikan dengan content-aware analysis (misal: deteksi perubahan API signature via AST parsing) |
| Tidak ada | Tidak ada checkpoint expiry — warning dari 10 step lalu tetap muncul | **LOW** | Tambahkan TTL mechanism: checkpoint otomatis acknowledge setelah N langkah |
| Web best practice | Tools seperti `digraph-js`/`statik` gunakan Tarjan's algorithm untuk cycle detection — checkpoint bisa adopsi graph traversal | **MEDIUM** | Implementasi cycle/tree traversal untuk deteksi dependensi checkpoint, bukan linear search |

### `context-compressor.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `extractKeyInfo()` | Regex `(?:decided\|chose\|opted\|will use\|using\|selected\|picked)` sangat fragile — "using" dalam konteks "using a debugger" akan false positive | **HIGH** | Gunakan LLM-as-judge untuk ekstraksi decision yang akurat; alternatif: regex dengan keyword windowing |
| `extractKeyInfo()` | Match file paths via `src/...` prefix — tidak bisa deteksi path di root project | **HIGH** | Tambahkan pola path absolut dan path tanpa prefix direktori |
| `estimateTokens()` | `text.length / 4` tidak akurat untuk kode (banyak simbol, whitespace, dll) | **MEDIUM** | Gunakan `tiktoken` atau library tokenizer sesuai model yang dipakai |
| `compressToPrompt()` | Tidak ada token-budget-aware truncation — `allDecisions.slice(-10)` bisa blow context | **MEDIUM** | Prioritaskan item berdasarkan recency/relevance, potong jika estimasi > threshold |
| `shouldCompress()` | `maxTokens = 100_000` hardcode default, tidak baca dari model config | **MEDIUM** | Ambil dari `model-registry.ts` atau parameter constructor |
| `compress()` | Tidak ada deduplikasi semantik — "decided to use React" dan "using React" masuk sebagai 2 decision terpisah | **LOW** | Implementasi fuzzy dedup (Levenshtein atau embedding similarity) |
| Web best practice | "Anchored iterative summarization" (Factory eval 36K sessions) lebih unggul dari regenerate-from-scratch | **MEDIUM** | Implementasi incremental summarization: merge summary baru ke persistent state, bukan re-regen dari nol |
| Web best practice | "Context rot" penyebab 65% failure agent — perlu dual compression (gateway 85% + agent 50%) seperti Hermes Agent | **MEDIUM** | Tambahkan safety net compression di level gateway sebelum masuk agent loop |
| Web best practice | ACON (failure-driven guideline optimization) reduce memory 26-54% dengan 95%+ accuracy | **LOW** | Implementasi feedback loop: jika compressed context cause failure, adjust prompt compression |

### `dependency-tracker.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `parseImports()` | Regex tidak handle multi-line imports, type-only imports (`import type { X }`), atau dynamic import dengan template literal | **HIGH** | Gunakan parser TypeScript AST (`ts-morph`) untuk import resolution yang akurat |
| `resolveImportPath()` | Tidak handle package.json `exports` field, `node:` prefix, atau `@scope/package` | **HIGH** | Tambahkan resolution berdasarkan `exports` map + node core module detection |
| `scanFiles()` | `existsSync` untuk SETIAP kandidat path — synchronous blocking I/O di loop, slow untuk 1000+ file | **HIGH** | Gunakan asynchronous `fs.access` dengan Promise.all untuk parallel checking, atau batch via `fs.realpathSync` |
| `getFileDependents()` | Fuzzy matching (`endsWith`, `includes`) rawan false positive — `src/util.ts` bisa match `src/sub/util.ts` | **HIGH** | Gunakan canonical path comparison via `path.relative` + exact match |
| `analyzeErrorPropagation()` | `error.toLowerCase().includes(file.toLowerCase())` — sangat fragile, error message format tidak konsisten | **HIGH** | Parse stack trace secara struktural (line:column extraction), bukan substring search |
| Tidak ada | Tidak ada circular dependency detection — A → B → C → A tidak terdeteksi | **MEDIUM** | Implementasi Tarjan's SCC algorithm O(V+E) untuk cycle detection |
| `updateFile()` | Hapus edges lalu re-scan, tapi tidak handle file yang sudah di-delete | **MEDIUM** | Cek `existsSync` sebelum clean up; hapus edges untuk file yang sudah tidak ada |
| `analyzeImpact()` | Tidak ada weighting berdasarkan recency — file yang diubah 10 step lalu sama bobotnya dengan 1 step lalu | **LOW** | Tambahkan time-decay weighting; perubahan lebih baru punya bobot lebih tinggi |
| Web best practice | Industry standard: Tarjan's algorithm untuk SCC, topological sort untuk build ordering | **MEDIUM** | Implementasi lengkap graph algorithms (Kahn's algorithm, DFS-based cycle detection, topological sort) |
| Web best practice | Queryable dependency graph via graph library (graphlib/digraph-js) lebih scalable | **LOW** | Migrasi dari manual Map ke dedicated graph library untuk traversal & query |

### `hallucination-guard.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `verifyApiSignature()` | Regex `${escaped}\\s*[=(:]` terlalu broad — match variable assignment `const foo = bar` sebagai fungsi `foo` | **HIGH** | Gunakan parser AST (TypeScript compiler API) untuk validasi signature yang presisi |
| `extractFunctionClaims()` | Regex `(?:added\|implemented\|created\|modified)\s+(\w+)` — kata "file" di "implemented the file" dianggap function name | **HIGH** | Filter stop-words; validasi bahwa `\w+` adalah camelCase/PascalCase (likely function name) |
| `functionExists()` | Duplikasi logic dengan `verifyApiSignature()` — 90% baris identik | **MEDIUM** | Refactor: extract shared method `findInFile(pattern: string): boolean` |
| `resolveSafe()` | Cek path prefix string tanpa resolve symlink — `/link/worktree` dan `/real/worktree` dianggap beda | **MEDIUM** | Gunakan `fs.realpathSync` untuk canonical path comparison |
| `extractImportClaims()` | Regex `/import.*?['"](.+?)['"]/g` — bisa capture import dari komentar atau string literal dalam kode | **MEDIUM** | Filter non-code lines; skip komentar dan string literal |
| `check()` | Hanya cek claims yang EXACT match regex — tidak bisa detect API call yang tidak disebut eksplisit | **LOW** | Integrasikan dengan LLM-as-judge untuk semantic hallucination detection |
| Web best practice | Sampling-based consensus verification (HalluCodeDetector) capai AUROC=0.76 — jauh lebih baik dari regex | **MEDIUM** | Implementasi multi-sample consensus: generate 3 versi, bandingkan API call patterns |
| Web best practice | HalluGuard ICLR 2026 bedakan data-driven vs reasoning-driven hallucination via NTK-based detection | **LOW** | Tambahkan detection untuk reasoning-driven hallucination (inconsistency across multi-step) |
| Web best practice | Multi-evidence retrieval (MEGA-RAG) reduce hallucination 40%+ via cross-encoder reranker | **LOW** | Integrasikan RAG-based verification: cek klaim terhadap actual kodebase + imports real |

### `pattern-discovery.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `analyzeErrors()` | `inferCategory()` dari plan goal — kata "undefined" di goal trigger "runtime" padahal mungkin bug domain | **MEDIUM** | Jangan infer error dari plan goal; hanya dari `stepResult` yang actual fail |
| `analyzeErrors()` | Tidak ada deduplikasi session — `stepResults` dan episodes bisa overlap untuk session yang sama | **MEDIUM** | Track sessionId yang sudah diproses; skip duplicate |
| `computeTrend()` | Split-half dengan jumlah episode minimal 4 — terlalu noise; 2 data point per half meaningless | **MEDIUM** | Gunakan exponentially weighted moving average (EWMA) dengan minimal 8 data points untuk trend yang meaningful |
| `analyzeSessionOutcomes()` | Threshold `sessionIds.length < 3` return empty — terlalu agresif skip untuk small dataset | **LOW** | Turunkan threshold ke 2 atau gunakan Bayesian smoothing untuk small sample |
| `suggestErrorFix()` | Return hardcoded string — tidak adaptive sama sekali | **LOW** | Ambil suggestions dari skill memory yang pernah berhasil fix error kategori tersebut |
| Tidak ada | Tidak ada statistical significance testing — bisa flag "degrading" padahal cuma random variance | **MEDIUM** | Tambahkan p-value atau confidence interval untuk setiap pattern yang dilaporkan |
| `analyzeFiles()` | `coChangeMatrix` O(n²) memory — untuk 10K file bisa 100M entries | **LOW** | Gunakan sparse matrix representation atau limit analysis ke top-N files by change frequency |
| `groupByTags()` | Tidak handle `ep.tags` undefined/null — potential crash | **MEDIUM** | Guard dengan `ep.tags ?? []` |
| Web best practice | Time-series decomposition lebih akurat untuk trend detection daripada split-half | **MEDIUM** | Implementasi seasonal-trend decomposition (STL) atau rolling window regression |
| Web best practice | Anomaly detection di agent systems pakai rolling window + z-score, bukan static threshold | **LOW** | Tambahkan z-score based anomaly detection untuk file hot spot dan error rate spikes |

## Ringkasan Prioritas

| Severity | Jumlah | Action |
|---|---|---|
| **HIGH** | 10 | Perbaiki segera — rawan bug, false positive, atau security issue |
| **MEDIUM** | 16 | Jadwalkan perbaikan — impact signifikan pada reliability/akurasi |
| **LOW** | 9 | Nice to have — optimization & best practice alignment |

## Rekomendasi Lintas File

1. **Gunakan TypeScript Compiler API / ts-morph** untuk parsing import, function signature, dan API verification — jauh lebih akurat daripada regex
2. **Implementasi canonical path resolution** (`fs.realpathSync`) di semua file yang handle filesystem path
3. **Refactor shared logic** — `functionExists` dan `verifyApiSignature` hampir identik
4. **Tambahkan time-decay weighting** di pattern-discovery dan dependency-tracker untuk recency-aware analysis
5. **Integrasikan LLM-as-judge** untuk semantic verification yang lebih canggih daripada regex pattern matching
