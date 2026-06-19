# src/core — Code Review & Optimization Todo

## Ringkasan
Total file: 35 (29 core + 6 domains) | Total fungsi/class dianalisis: ~145 exported symbols

## Temuan per File

### `agent-loop.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `batchSteps` | Infinite loop risk: jika semua step conflict satu sama lain, `used` tidak pernah advance dan loop `for (const step of steps)` berulang tanpa progres | HIGH | Gunakan Set untuk track yang sudah diproses, break kalau tidak ada yang bisa di-batch |
| `executeBatch` | `Promise.all(batch.map(...))` — satu promise reject langsung reject semua. Seharusnya `allSettled` + handling partial failure | MEDIUM | Ganti ke `Promise.allSettled` agar error satu step tidak membatalkan yang lain |
| `executeStepWithRetry` | Tidak ada timeout/jangka waktu maksimum untuk eksekusi step — bisa hang forever jika stepExecutor menggantung | MEDIUM | Tambahkan `AbortSignal.timeout()` wrapper di sekitar stepExecutor |
| `attemptRepair` | Empty catch block (`catch { }`) dan empty try-catch di `fixExecutor?.(...).catch(() => false)` — error swallowed total | LOW | Minimal log warning, better: track error count untuk observability |
| `hasConflict` | Perbandingan filesModified berdasarkan array string — false negative jika file ditulis dengan path relatif vs absolut berbeda | LOW | Normalize path sebelum compare |

### `auto-retry.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `getBackoffDelay` | Full jitter (`Math.random() * maxDelay`) sudah best practice, tapi tidak ada minimum delay — bisa delay 0ms | LOW | Tambahkan `max(baseDelay, Math.random() * maxDelay)` |
| `recordAttempt` | Array `this.attempts` grow unbounded per instance — memory leak di long-running session | MEDIUM | Tambahkan cap (misal max 50) atau trim dari depan |
| `getFilesToRollback` | Regex `/(?:src\/|lib\/|test\/)[\w./-]+\.(?:ts|js|...)/g` — hardcoded path prefix, tidak cocok untuk project tanpa src/ | MEDIUM | Path detection harus relatif ke project root, bukan hardcoded |

### `budget-tracker.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `check()` | Race condition: synchronous check, tapi accumulator update terpisah. Jika `recordTokens` dan `check` dipanggil concurrent, state tidak konsisten | MEDIUM | Gunakan mekanisme lock atau atomic update per scope |
| `lookupPrice` | Fallback ke gpt-4o prices tanpa log — user tidak sadar model mereka dihitung dengan harga salah | MEDIUM | Log warning saat fallback digunakan |
| `calculateCost` | `_reasoningTokens` parameter tidak dipakai — reasoning tokens seharusnya dihitung dengan harga output (sesuai komentar "best practice") | LOW | Gunakan parameter, jangan prefix underscore |
| `recordTokens` | Floating-point cost accumulation — error akumulasi bisa signifikan setelah ribuan call | LOW | Gunakan integer (micro-cents) untuk presisi |
| `setLimits` | Merge field-per-field, tapi `behavior` di-set terpisah — bisa inconsistency antara limits dan behavior | LOW | Gabungkan behavior ke dalam object limit |

### `config.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `startWatch` | SetInterval (polling 5s) tidak pernah di-clear jika watcher error — memory leak | MEDIUM | Pastikan selalu cleanup via `stopWatch()` atau try-finally |
| `startWatch` | Polling fallback tetap jalan meski fs.watch berhasil — duplikasi reload | MEDIUM | Matikan polling jika watcher primary sukses |
| `validateConfig` | `validateObject` — `as Record<string, unknown>` menghilangkan type safety | LOW | Gunakan generic atau zod/zod-like validation |
| `load()` | Catch block terlalu luas — semua error (parse, filesystem, etc) dianggap config corrupt | LOW | Bedakan antara ENOENT (auto-create) vs parse error (log) |
| `mergeDeep` | Rekursif untuk object, tapi tidak handle array — bisa corrupt jika ada field array di config | MEDIUM | Tambahkan penanganan array merge (concatenate atau replace) |

### `data-cleaner.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `clean()` | Potensi catastrophic backtracking di regex patterns seperti `stripDebateMarkers` | MEDIUM | Batasi input length sebelum regex, gunakan Re2 atau pattern sederhana |
| `validate()` | Selalu return `{ valid: true, issues: [] }` jika LLM tidak available atau parse gagal — false sense of security | HIGH | Return `{ valid: false, issues: ["Validation unavailable"] }` saat LLM null |
| `stripDebateMarkers` | Regex case-insensitive multi-line bisa overlap — satu line terhapus oleh multiple pattern | LOW | Gabungkan pattern jadi satu pass |
| `tryParseJSON` | Mengganti `\n` di JSON string saat parsing dari code fence | LOW | Jangan modifikasi content, parse langsung saja |

### `debate-loop.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `execute()` | Tidak ada timeout untuk LLM calls — jika LLM menggantung, debate loop hang forever | HIGH | Tambahkan AbortSignal.timeout(60000) wrapper di setiap `llmEngine.call()` |
| `execute()` | Issue extraction heuristic: lines yang mulai dengan `-` atau mengandung kata "issue"/"problem" — sangat fragil | MEDIUM | Gunakan LLM untuk extract issues, atau pattern yang lebih presisi |
| `execute()` | Temperature escalation (`0.3 + (round-1) * 0.1`) — bisa menghasilkan output makin random, bukan makin baik | MEDIUM | Alternatif: tetap temperature rendah tapi tambahkan "be more creative" di prompt |
| `execute()` | Duplicate detection cek `draft === prevDraft` — compare string exact, padahal perubahan minor (1 char) tidak terdeteksi | LOW | Gunakan Levenshtein distance atau ratio similarity |
| `formatDebateResult` | Emoji hardcoded — tergantung font support | LOW | Gunakan teks biasa dengan fallback |

### `domain-registry.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `detect()` | Selalu pilih score tertinggi — tidak ada threshold minimum untuk aktivasi domain | MEDIUM | Tambahkan minimum confidence score sebelum auto-activate |
| `activateFor()` | Setelah aktivasi, tidak mengembalikan hasil aktivasi (sukses/gagal) secara eksplisit | LOW | Return boolean lebih jelas |
| `unregister()` | Tidak cleanup custom error matchers atau verifiers dari domain lain yang mungkin mereferensi | LOW | Pastikan proper cleanup |

### `error-analyzer.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `analyzeDeep()` | LLM JSON parsing via regex `\{[\s\S]*\}` — bisa salah match dengan nested braces di string | MEDIUM | Gunakan parser JSON yang proper, iterasi parse bertahap |
| `fallbackAnalyze()` | Heuristic berdasarkan `msg.includes("type")` sangat general — false positive tinggi | MEDIUM | Tambahkan pattern yang lebih spesifik |
| `analyze()` | Domain matchers di-iterasi, tapi hanya first match yang dipakai — tidak agregasi | LOW | Bisa kumpulkan multiple matcher results |

### `event-bus.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `emit()` | Async subscriber di fire-and-forget via `.catch()` — error tidak propagate ke caller | MEDIUM | Tambahkan callback onError opsional, atau emit error event |
| `emit()` | Subscriber dieksekusi secara synchronous sequential — slow subscriber bisa block event lain | MEDIUM | Pertimbangkan setImmediate atau microtask queue |
| `getHistory` | `maxHistory` hardcoded 200 — tidak ada batas atas | LOW | Buat configurable atau berdasarkan memory pressure |
| `on()` | Return unsubscribe function yang aman, tapi subscriber sendiri tidak punya ID — sulit debug | LOW | Tambahkan opsi named subscriber |

### `event-taxonomy.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| (Type definitions only) | Tidak ada runtime validation bahwa event yang di-emit sesuai schema — type hanya compile-time | MEDIUM | Tambahkan schema validation di EventBus.emit untuk development mode |
| `EVENT_PRODUCER_MAP` / `EVENT_CONSUMER_MAP` | Dokumentasi hardcoded di source — mudah out of sync dengan implementasi | LOW | Auto-generate dari decorator/annotation |

### `execution-helpers.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `writeFiles()` | Silent catch `catch { }` — file gagal nulis tanpa feedback | MEDIUM | Log error, kumpulkan failed files, return sebagai partial failure |
| `writeFiles()` | `as any` untuk emit event — type safety hilang | MEDIUM | Buat helper function typed untuk event emission |
| `parseFileEntries()` | Catch-all fallback ke generic code block (`src/generated.ts`) — potensi file tidak terduga | MEDIUM | Hanya fallback jika confidence tinggi (ada pattern FILE: atau JSON) |
| `recordCompletion()` | `deps.eventBus?.emit({...} as any)` — type cast ke any, kehilangan compile-time checking | MEDIUM | Type assertion yang tepat |

### `executor.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `recordResult()` | `this.budgetTracker?.recordStep()` dipanggil di sini DAN di `recordCompletion()` — **double counting step** | **HIGH** | Hanya panggil di SATU tempat. Hapus dari recordResult() |
| `recordResult()` | Jika step gagal: `stepState.retryCount++` — retry count naik sebelum error analysis. Jika nanti analyze return "unknown", retry count sudah ke-increment | MEDIUM | Retry count hanya increment setelah analysis |
| `detectErrorCategory()` | Keyword matching sangat basic — "timeout", "error", "fail" — false positive tinggi | MEDIUM | Gunakan domain-specific matchers yang sudah ada |
| `getReadySteps()` | O(n) scan setiap kali — untuk plan besar (100+ steps) bisa lambat | LOW | Maintain indeks dependencies graph yang sudah di-topological sort |
| `ContractVerifier` di instance field | `new ContractVerifier()` dibuat langsung — tidak bisa di-inject mock untuk testing | LOW | Jadikan optional constructor parameter |

### `fine-tuning.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `waitForJob()` | `while(true)` loop — tidak ada timeout untuk individual `getJobStatus()` | MEDIUM | Tambahkan per-call timeout menggunakan AbortSignal |
| `waitForJob()` | Polling setiap 10s — untuk fine-tuning yang bisa 1 jam, ini 360 API calls | LOW | Exponential backoff polling: 10s → 30s → 60s |
| `uploadFile()` | `readFileSync` load entire file ke memory — file training bisa GB-size | MEDIUM | Gunakan stream atau readFile terbatas |
| `createJob()` | Body construction dengan spread rawan type error — `hyperparameters` field overwrite | MEDIUM | Bangun object secara eksplisit |
| Semua API calls | **Tidak ada retry logic** untuk API calls — fine-tuning API terkenal sering rate limit | MEDIUM | Tambahkan exponential backoff retry |
| `parseJobResponse()` | `data.error as { message?: string }?.message` — unsafe cast | LOW | Validasi tipe sebelum akses |

### `formal-model.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `defaultConditionEvaluator()` | Heuristic string-based: `expr.includes("compile") && expr.includes("pass")` — false positive tinggi | MEDIUM | Gunakan regex pattern yang lebih ketat atau plugin evaluator |
| `detectCycle()` | DFS dengan `stack.indexOf(node)` — O(n) search setiap node, total O(n²) | LOW | Gunakan Map untuk track indeks node |
| `topologicalSort()` | Duplikasi logic dengan `detectCycle()` — Kahn's algorithm di-run 2x | MEDIUM | Refactor: `detectCycle` bisa return topo order parsial |
| `verify()` | Async keyword di function signature tapi implementasi synchronous — misleading | LOW | Hapus async jika tidak perlu, atau gunakan async untuk LLM evaluator |
| `wouldCreateCycle()` | Create new `DependencyGraph` setiap call — O(V+E) alokasi | LOW | Implementasi cycle detection incremental |

### `git.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| Semua fungsi | `execFileSync` di setiap git operation — blocking event loop. Untuk git operations yang bisa >1s | LOW | (By design synchronous, tapi jika ada UI, perlu async) |
| `getHistory()` | Parser delimiter `|||` — jika commit message mengandung `|||`, parsing broken | MEDIUM | Gunakan `--format=...%x00` null delimiter |
| `createPR()` | `gh pr create` output parsing — regex khusus github.com, tidak support GitHub Enterprise | MEDIUM | Deteksi URL pattern yang lebih general |
| `generatePRDescription()` | `title.slice(0, 69) + "..."` — hardcoded 72 chars | LOW | Jadikan configurable |

### `id-chain.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `parsePipelineRunId()` | Regex `run-([^-]+)-(.+)$` — jika sessionID mengandung dash, parsing salah | MEDIUM | Gunakan delimiter yang tidak mungkin ada di sessionID, atau length-based |
| (IDChain interface) | Tidak ada validasi format ID — bisa kosong, terlalu panjang, atau karakter ilegal | LOW | Tambahkan factory function dengan format validation |

### `intent-parser.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `validatePlan()` | DFS circular detection — recursion bisa stack overflow untuk plan >10k steps | LOW | Gunakan iterative DFS + explicit stack |
| `createPlan()` | Complexity hanya berdasarkan subtask count — tidak consider dependency complexity | LOW | Pertimbangkan depth/width dependency graph |

### `llm.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `getCacheKey()` | Hanya 200 chars systemPrompt + 500 chars userPrompt — hash collision risk tinggi | MEDIUM | Gunakan hash (e.g., MD5/SHA256) dari full content |
| `responseCache` | `Map<string, ...>` tanpa batas size — memory leak di session panjang dengan banyak unique prompts | **HIGH** | Gunakan LRU cache dengan max entries (e.g., 100) |
| `callAnthropic()` | Body untuk Anthropic API: `system` field + jsonMode instruction digabung — format tidak sesuai spek Anthropic (system harus string, bukan concat) | MEDIUM | Sesuai API spec: `system` terpisah, tambah instruction di user prompt |
| `callOpenCode()` | `client.session.prompt()` dipanggil tanpa timeout wrapper — bisa hang jika OpenCode tidak responsif | **HIGH** | Tambahkan AbortSignal.timeout(30000) wrapper |
| `httpCall()` | `setTimeout(() => controller.abort(), 60000)` kemudian `clearTimeout(timeout)` — jika fetch selesai tepat di batas waktu, race condition abort vs response | MEDIUM | Gunakan `AbortSignal.timeout(60000)` langsung, tidak perlu manual setTimeout |
| `httpCall()` | `d.choices?.[0]` akses — tidak handle kasus choices array kosong | MEDIUM | Validasi `choices.length > 0` |
| `fallbackResponse()` | Untuk `jsonMode`, return `{"_no_llm": true}` — ini JSON valid tapi bisa crash caller yang expect schema tertentu | MEDIUM | Return `{"status":"no_llm","data":null}` yang lebih aman |
| `buildMemoryContext()` | Silent catch — jika episodic store atau skill store error, memory context hilang tanpa notifikasi | LOW | Setidaknya log warning |
| `decomposeTask()` / `analyzeError()` / `generatePlan()` | Multiple fallback parsing bertumpuk — regex, codeBlock, arrMatch — kode sangat repetitif | MEDIUM | Extract ke utility `extractAndParseJSON` |
| `callAnthropic()` / `callOpenAI()` | API key langsung di URL/header — potensi leak di logging | MEDIUM | Sanitasi key sebelum log |

### `mcp-client.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `callStdio()` | Brace-counting JSON parser — tidak handle escaped braces dalam string JSON (`\"{\"`) | **HIGH** | Gunakan incremental JSON parser (e.g., `jsonparse` library) |
| `connectStdio()` | 200ms + 500ms + 30000ms chained setTimeout — fragile race condition | MEDIUM | Refactor ke promise chain yang lebih jelas |
| `connectStdio()` | `stdout.on("data")` listener tidak pernah di-remove setelah resolve/reject — memory leak | MEDIUM | Cleanup listener di `settled = true` |
| `callHTTP()` / `connectHTTP()` | HTTP transport menggunakan `http.request` / `https.request` — tidak handle redirect 3xx | MEDIUM | Follow redirect atau return error explicit |
| `connectStdio()` | `proc.stderr?.on("data", ...)` dengan comment "ignore" — stderr penting untuk debugging | LOW | Log stderr di debug mode |
| `disconnect()` / `disconnectAll()` | Tidak remove event listeners dari proc sebelum kill | MEDIUM | Cleanup stdout/stderr listeners sebelum kill |

### `model-registry.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `recordCall()` | `stat.byTaskType` — deep mutation tanpa copy, shared reference risk | LOW | Clone sebelum mutasi |
| `getScore()` | `hallucinationRate = hallucinationCount / totalCalls` — terdefinisi baik karena totalCalls > 0 sudah di-check | OK | (Clean, no issue) |
| `selectBestModel()` | Nested map/filter/sort chains — O(n*m*k) complexity untuk select sederhana | LOW | Simplify jadi single sort pass |
| `enterQuarantine()` | Parameter `durationMinutes` default 30 — hardcoded magic number | LOW | Gunakan config dari ConfigLoader |

### `navigator.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `walk()` | Membaca FULL content setiap file untuk parse imports/exports — I/O intensive untuk codebase besar | MEDIUM | Parse hanya header file (first 50 lines) atau gunakan AST parser |
| `walk()` | Recursion depth limit 10 — bisa miss file di `src/a/b/c/d/e/f/g/h/i/j/foo.ts` | LOW | Jadikan configurable, atau gunakan queue |
| `scan()` | Tidak ada skip untuk binary files — `readFile` di binary bisa throw | MEDIUM | Cek `extname` untuk source-only parsing |
| `findRelevantFiles()` | Score heuristic standalone — tidak ada normalisasi TF-IDF | MEDIUM | Tambahkan IDF component untuk kata umum |
| `findDir()` | `isSystemDirectory` check hardcoded untuk Linux paths — tidak cross-platform | LOW | Platform-agnostic path detection |
| `detectProjectLanguages()` | Async tapi sequential — `await stat()` untuk setiap lang config | MEDIUM | `Promise.all` untuk parallel stat |

### `parallel.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `executePhase()` + `executeAll()` | `Promise.all(phase.steps.map(runner))` — satu rejection crash semua step dalam phase | **HIGH** | Gunakan `allSettled` + isolate per-step error handling |
| `llmStepRunner()` | `mkdirSync(dirname(fullPath), {recursive: true})` — blocking I/O dalam async context | MEDIUM | Gunakan `mkdir` async version |
| `llmStepRunner()` | `writeFileSync` blocking di async function — bisa bottleneck | MEDIUM | Gunakan `writeFile` (async) |
| `executeWithSubprocessSpawn()` | `execFileSync` blocking — untuk subprocess spawn seharusnya async | MEDIUM | Gunakan `spawn` (async) |
| `suggestParallelTasks()` | Group by dependency key — jika ada 10 step dengan `dependsOn: []`, semua di group yang sama (`__root__`) | LOW | Tambahkan max group size |
| `detectConflicts()` | O(n²) pairwise comparison — untuk 100 parallel tasks, 4950 perbandingan | LOW | Index files-to-tasks mapping untuk O(n) |

### `planner.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `decompose()` | First matching pattern wins — jika goal mengandung multiple keywords (e.g., "fix security bug"), pattern "fix" (index 1) dipilih, padahal "security" (index 8) mungkin lebih relevan | MEDIUM | Score-based pattern matching, bukan first-match |
| `decompose()` | Rule `pattern: /create|build|make|.../i` (index 0 di generic section) OVERLAP dengan `pattern: /add|create|build|.../i` (index 0 di code section) — duplikasi | MEDIUM | Merge atau prioritaskan yang lebih spesifik |
| `decompose()` | Cycle detection setelah generate subtasks lalu auto-fix dengan `dependsOn = []` — bisa menghilangkan dependency valid | MEDIUM | Hapus hanya edge yang bikin cycle, bukan semua dependency |
| `suggestSubtask()` | Return `verificationCriteria: []` — empty array seharusnya warning | LOW | Tambahkan "Manual verification" default |

### `prompt-builder.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `buildTemplate()` | Numbered list (`${hasDebate ? "7" : "6"}`) — fragile karena hardcode mapping index | MEDIUM | Gunakan auto-numbering atau bullet list |
| `buildGenericAgentPrompt()` | Tool list di-render `x.description.split(".")[0]` — potong kalimat pertama, bisa misleading | MEDIUM | Gunakan ringkasan manual atau full description |

### `prompt-template.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `render()`, `renderWithFrontmatter()` | Jika semua section empty, render menghasilkan string kosong — empty prompt bisa crash LLM call | MEDIUM | Setidaknya tambahkan default identity |
| `clone()` | Shallow copy section content string — safe karena string immutable | OK | (Clean) |

### `router-agent.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `keywordRoute()` | Confidence formula `score / Math.max(2, totalKeywords * 0.5)` — sangat arbitrary, bisa under/over estimate | MEDIUM | Gunakan normalized TF atau cosine similarity |
| `keywordRoute()` | Iterasi semua keyword setiap category — O(c*k) per route, untuk tech category dengan 200+ keywords bisa lambat | MEDIUM | Gunakan Set lookup atau Trie |
| `route()` | Empty catch block saat LLM fallback gagal | LOW | Log error |
| `DEFAULT_CATEGORIES` | Tech category punya ~200 keywords inline di source code — maintainability buruk | MEDIUM | Load dari file external atau database |

### `task-classifier.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `detectTaskType()` | Order-dependent: REASONING pattern mencakup "design" dan "plan" — seharusnya setelah CODING karena overlap | MEDIUM | Prioritaskan pattern yang lebih spesifik atau score-based |
| `detectTaskType()` | Tidak ada pattern untuk web search, data analysis, devops, dsb | LOW | Tambahkan pattern untuk task types yang hilang |

### `tech-debt-scorer.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `analyzeCoupling()` | Regex `^import\s/gm` — hanya match line yang MULAI dengan "import", tidak handle multi-line imports atau `const x = require(...)` | MEDIUM | Gunakan regex yang lebih komprehensif |
| `analyzePatterns()` | `as unknown as` detection via `content.includes("as unknown as")` — false positive dalam string/komentar | MEDIUM | Gunakan AST parser (e.g., ts-morph) |
| `analyzeScope()` | Heuristic no-test-file-changed — false positive untuk non-code tasks | MEDIUM | Skip test check jika bukan code domain |
| `score()` | `maxScore` dari 4 kategori — satu kategori dominan bisa mark down yang lain | LOW | Bisa weighted average |

### `verifier.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `verifyFast()` | Compile cache: `filesSame = filesChanged.every((f,i) => f === lastCompileFiles[i])` — compare by exact reference dan order. Jika file list order berubah, cache miss | MEDIUM | Gunakan `Set` comparison atau sort sebelum compare |
| `verifyAll()` | `verifyTests` dipanggil TANPA test pattern — menjalankan full test suite setiap step. Untuk intermediate steps, ini sangat lambat | MEDIUM | Argument `testPattern` dari step verification criteria |
| `verifyTests()` | Test commands: TypeScript selalu vitest, Python selalu pytest — tidak semua project menggunakan ini | MEDIUM | Deteksi test runner dari package.json atau config |
| `verifyLint()` | Static commands — eslint, ruff, golangci-lint — hardcoded args seperti `--quiet` | MEDIUM | Baca dari project config |
| `verifyRelated()` | Inferred test files (`candidates`) dihasilkan tanpa cek keberadaan file — dikembalikan sebagai "related test files" meski tidak ada | LOW | Filter yang benar-benar exist |
| `verifySemantic()` | `readFileSync` untuk baca semua changed files — blocking I/O di async function | MEDIUM | Gunakan `readFile` async |

### `domains/code.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `detectLanguage()` | Duplikasi dari `Verifier.detectLanguage()` — DRY violation | LOW | Extract ke shared utility |
| `codeDetect()` | `existsSync(f)` — path relatif terhadap cwd, tidak konsisten dengan projectDir | MEDIUM | Gunakan absolute path |
| `codeVerifiers` | `execFileSync` di semua verifier — blocking event loop | LOW | (By design synchronous untuk compile/lint/test) |
| `codeErrorMatchers` | Import error: `suggestedFix: "npm install ..."` — tidak semua project npm | LOW | Deteksi package manager |

### `domains/data-science.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `dsDetect()` | `readdirSync(".")` dan `readFileSync(pf, "utf-8")` — blocking I/O + path hardcoded "." | MEDIUM | Terima projectDir parameter |
| `dsDetect()` | `readdirSync(".")` — tanpa filter, untuk project dengan ribuan files bisa lambat | MEDIUM | Batasi jumlah file yang di-scan |
| `dsVerifiers` | `notebook-check`: regex non-greedy untuk JSON parsing — rentan error | LOW | Parse dengan `JSON.parse` |

### `domains/devops.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `yaml-validate` | Tidak ada YAML parser real — hanya cek indentasi tab | MEDIUM | Gunakan `js-yaml` library untuk validasi |
| `dockerfile-lint` | `execFileSync("which", ["hadolint"])` — "which" tidak available di Windows | LOW | Platform-check sebelum exec |
| `devopsDetect()` | File detection untuk `.github/workflows` — path bisa di root atau subdir | LOW | Lebih flexible |

### `domains/generic.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `genericErrorMatcher.match()` | **Selalu return `{ matched: true }`** — untuk ERROR APAPUN, error matcher ini akan match dan claim "Domain-agnostic error" | **HIGH** | Return `null` jika tidak ada indikasi error, atau set `matched: false` |
| `emptyRoles` | Definisi inline roles untuk analyst/builder/reviewer/coordinator/planner — potential bloat | LOW | Extract ke file terpisah |

### `domains/mobile.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `manifest-check` | Regex `<activity[\s\S]*?<\/activity>` — tidak handle nested tags atau comments | MEDIUM | Gunakan XML parser proper |
| `mobileDetect()` | `existsSync(f)` untuk files seperti `AndroidManifest.xml` — path hardcoded di root | MEDIUM | Scan subdirectories untuk android/ dan ios/ |
| `plist-check` | Regex check untuk plist — hanya basic XML tag presence | LOW | Parse dengan XML parser |

### `domains/security.ts`
| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `securityDetect()` | `JSON.parse(readFileSync("package.json", "utf-8"))` — blocking I/O + bisa throw jika tidak ada package.json | MEDIUM | Try-catch + async, handle ENOENT |
| `secret-scan` | Regex pattern untuk secrets: `(?:api[_-]?key|...)[\s]*[:=][\s]*['"][A-Za-z0-9_\-/=+]{16,}['"]` — banyak false positive (contoh: test keys, example values) | MEDIUM | Tambahkan confidence heuristic (e.g., entropy check, exclusions) |
| `secret-scan` | `trivy fs --quiet ...` — exec command, `trivy` mungkin tidak terinstall | LOW | Deteksi availability sebelum run |

## Ringkasan Severity

| Severity | Jumlah | Contoh |
|---|---|---|
| **HIGH** | 10 | Double counting step, infinite loop risk, Promise.all crash, brace parser, no timeout LLM cache |
| **MEDIUM** | 52 | Memory leak listeners, race condition, fragile regex, blocking I/O, duplicate logic |
| **LOW** | 35 | Style, minor optimizations, code duplication, arbitrary thresholds |

**Total findings: 97**

## Prioritas Perbaikan

1. **executor.ts:55** — Hapus `budgetTracker.recordStep()` dari `recordResult()` (double counting)
2. **llm.ts:70** — Implement LRU cache untuk `responseCache` (memory leak)
3. **mcp-client.ts:353** — Ganti brace-counting JSON parser dengan parser proper
4. **parallel.ts:102** — Ganti `Promise.all` dengan `Promise.allSettled` di parallel execution
5. **agent-loop.ts:77** — Fix potential infinite loop di `batchSteps`
6. **debate-loop.ts:108** — Tambahkan timeout di semua LLM calls
7. **domains/generic.ts:21** — Fix error matcher yang selalu return `matched: true`
8. **config.ts:392** — Fix memory leak di polling interval
9. **data-cleaner.ts:146** — Fix validate() yang selalu return valid
10. **verifier.ts:162** — Fix fragile compile cache comparison
