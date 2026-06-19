# src/core — Code Review & Optimization Todo

## Ringkasan
Total file: 35 (29 core + 6 domains) | Total fungsi/class dianalisis: ~145 exported symbols

## Temuan per File

### `agent-loop.ts`
| Fungsi | Issue | Severity | Status |
|---|---|---|---|
| `batchSteps` | Infinite loop risk: jika semua step conflict satu sama lain, `used` tidak pernah advance dan loop `for (const step of steps)` berulang tanpa progres | HIGH | ⏳ remaining |
| ~~`executeBatch`~~ | ~~`Promise.all(batch.map(...))` — satu promise reject langsung reject semua. Seharusnya `allSettled` + handling partial failure~~ | ~~MEDIUM~~ | ✅ fixed |
| ~~`executeStepWithRetry`~~ | ~~Tidak ada timeout/jangka waktu maksimum untuk eksekusi step — bisa hang forever jika stepExecutor menggantung~~ | ~~MEDIUM~~ | ✅ fixed |
| ~~`attemptRepair`~~ | ~~Empty catch block (`catch { }`) dan empty try-catch di `fixExecutor?.(...).catch(() => false)` — error swallowed total~~ | ~~LOW~~ | ✅ fixed |
| ~~`hasConflict`~~ | ~~Perbandingan filesModified berdasarkan array string — false negative jika file ditulis dengan path relatif vs absolut berbeda~~ | ~~LOW~~ | ✅ fixed |

### `auto-retry.ts`
| Fungsi | Issue | Severity | Status |
|---|---|---|---|
| ~~`getBackoffDelay`~~ | ~~Full jitter (`Math.random() * maxDelay`) sudah best practice, tapi tidak ada minimum delay — bisa delay 0ms~~ | ~~LOW~~ | ✅ fixed |
| ~~`recordAttempt`~~ | ~~Array `this.attempts` grow unbounded per instance — memory leak di long-running session~~ | ~~MEDIUM~~ | ✅ fixed |
| ~~`getFilesToRollback`~~ | ~~Regex `/(?:src\/|lib\/|test\/)[\w./-]+\.(?:ts|js|...)/g` — hardcoded path prefix, tidak cocok untuk project tanpa src/~~ | ~~MEDIUM~~ | ✅ fixed |

### `budget-tracker.ts`
| Fungsi | Issue | Severity | Status |
|---|---|---|---|
| `check()` | Race condition: synchronous check, tapi accumulator update terpisah. Jika `recordTokens` dan `check` dipanggil concurrent, state tidak konsisten | MEDIUM | ⏳ remaining |
| ~~`lookupPrice`~~ | ~~Fallback ke gpt-4o prices tanpa log — user tidak sadar model mereka dihitung dengan harga salah~~ | ~~MEDIUM~~ | ✅ fixed |
| ~~`calculateCost`~~ | ~~`_reasoningTokens` parameter tidak dipakai — reasoning tokens seharusnya dihitung dengan harga output (sesuai komentar "best practice")~~ | ~~LOW~~ | ✅ fixed |
| ~~`recordTokens`~~ | ~~Floating-point cost accumulation — error akumulasi bisa signifikan setelah ribuan call~~ | ~~LOW~~ | ✅ fixed |
| ~~`setLimits`~~ | ~~Merge field-per-field, tapi `behavior` di-set terpisah — bisa inconsistency antara limits dan behavior~~ | ~~LOW~~ | ✅ fixed |

### `config.ts`
| Fungsi | Issue | Severity | Status |
|---|---|---|---|
| ~~`startWatch`~~ | ~~SetInterval (polling 5s) tidak pernah di-clear jika watcher error — memory leak~~ | ~~MEDIUM~~ | ✅ fixed |
| ~~`startWatch`~~ | ~~Polling fallback tetap jalan meski fs.watch berhasil — duplikasi reload~~ | ~~MEDIUM~~ | ✅ fixed |
| `validateConfig` | `validateObject` — `as Record<string, unknown>` menghilangkan type safety | LOW | ⏳ remaining |
| `load()` | Catch block terlalu luas — semua error (parse, filesystem, etc) dianggap config corrupt | LOW | ⏳ remaining |
| ~~`mergeDeep`~~ | ~~Rekursif untuk object, tapi tidak handle array — bisa corrupt jika ada field array di config~~ | ~~MEDIUM~~ | ✅ fixed |

### `data-cleaner.ts`
| Fungsi | Issue | Severity | Status |
|---|---|---|---|
| ~~`clean()`~~ | ~~Potensi catastrophic backtracking di regex patterns seperti `stripDebateMarkers`~~ | ~~MEDIUM~~ | ✅ fixed |
| `validate()` | Selalu return `{ valid: true, issues: [] }` jika LLM tidak available atau parse gagal — false sense of security | HIGH | ⏳ remaining |
| ~~`stripDebateMarkers`~~ | ~~Regex case-insensitive multi-line bisa overlap — satu line terhapus oleh multiple pattern~~ | ~~LOW~~ | ✅ fixed |
| ~~`tryParseJSON`~~ | ~~Mengganti `\n` di JSON string saat parsing dari code fence~~ | ~~LOW~~ | ✅ fixed |

### `debate-loop.ts`
| Fungsi | Issue | Severity | Status |
|---|---|---|---|
| ~~`execute()`~~ | ~~Tidak ada timeout untuk LLM calls — jika LLM menggantung, debate loop hang forever~~ | ~~HIGH~~ | ✅ fixed |
| ~~`execute()`~~ | ~~Issue extraction heuristic: lines yang mulai dengan `-` atau mengandung kata "issue"/"problem" — sangat fragil~~ | ~~MEDIUM~~ | ✅ fixed |
| ~~`execute()`~~ | ~~Temperature escalation (`0.3 + (round-1) * 0.1`) — bisa menghasilkan output makin random, bukan makin baik~~ | ~~MEDIUM~~ | ✅ fixed |
| ~~`execute()`~~ | ~~Duplicate detection cek `draft === prevDraft` — compare string exact, padahal perubahan minor (1 char) tidak terdeteksi~~ | ~~LOW~~ | ✅ fixed |
| ~~`formatDebateResult`~~ | ~~Emoji hardcoded — tergantung font support~~ | ~~LOW~~ | ✅ fixed |

### `domain-registry.ts`
| Fungsi | Issue | Severity | Status |
|---|---|---|---|
| ~~`detect()`~~ | ~~Selalu pilih score tertinggi — tidak ada threshold minimum untuk aktivasi domain~~ | ~~MEDIUM~~ | ✅ fixed |
| ~~`activateFor()`~~ | ~~Setelah aktivasi, tidak mengembalikan hasil aktivasi (sukses/gagal) secara eksplisit~~ | ~~LOW~~ | ✅ fixed |
| ~~`unregister()`~~ | ~~Tidak cleanup custom error matchers atau verifiers dari domain lain yang mungkin mereferensi~~ | ~~LOW~~ | ✅ fixed |

### `error-analyzer.ts`
| Fungsi | Issue | Severity | Status |
|---|---|---|---|
| ~~`analyzeDeep()`~~ | ~~LLM JSON parsing via regex `\{[\s\S]*\}` — bisa salah match dengan nested braces di string~~ | ~~MEDIUM~~ | ✅ fixed |
| ~~`fallbackAnalyze()`~~ | ~~Heuristic berdasarkan `msg.includes("type")` sangat general — false positive tinggi~~ | ~~MEDIUM~~ | ✅ fixed |
| `analyze()` | Domain matchers di-iterasi, tapi hanya first match yang dipakai — tidak agregasi | LOW | ⏳ remaining |

### `event-bus.ts`
| Fungsi | Issue | Severity | Status |
|---|---|---|---|
| ~~`emit()`~~ | ~~Async subscriber di fire-and-forget via `.catch()` — error tidak propagate ke caller~~ | ~~MEDIUM~~ | ✅ fixed |
| ~~`emit()`~~ | ~~Subscriber dieksekusi secara synchronous sequential — slow subscriber bisa block event lain~~ | ~~MEDIUM~~ | ✅ fixed |
| ~~`getHistory`~~ | ~~`maxHistory` hardcoded 200 — tidak ada batas atas~~ | ~~LOW~~ | ✅ fixed |
| ~~`on()`~~ | ~~Return unsubscribe function yang aman, tapi subscriber sendiri tidak punya ID — sulit debug~~ | ~~LOW~~ | ✅ fixed |

### `event-taxonomy.ts`
| Fungsi | Issue | Severity | Status |
|---|---|---|---|
| (Type definitions only) | Tidak ada runtime validation bahwa event yang di-emit sesuai schema — type hanya compile-time | MEDIUM | ⏳ remaining |
| `EVENT_PRODUCER_MAP` / `EVENT_CONSUMER_MAP` | Dokumentasi hardcoded di source — mudah out of sync dengan implementasi | LOW | ⏳ remaining |

### `execution-helpers.ts`
| Fungsi | Issue | Severity | Status |
|---|---|---|---|
| ~~`writeFiles()`~~ | ~~Silent catch `catch { }` — file gagal nulis tanpa feedback~~ | ~~MEDIUM~~ | ✅ fixed |
| ~~`writeFiles()`~~ | ~~`as any` untuk emit event — type safety hilang~~ | ~~MEDIUM~~ | ✅ fixed |
| ~~`parseFileEntries()`~~ | ~~Catch-all fallback ke generic code block (`src/generated.ts`) — potensi file tidak terduga~~ | ~~MEDIUM~~ | ✅ fixed |
| ~~`recordCompletion()`~~ | ~~`deps.eventBus?.emit({...} as any)` — type cast ke any, kehilangan compile-time checking~~ | ~~MEDIUM~~ | ✅ fixed |

### `executor.ts`
| Fungsi | Issue | Severity | Status |
|---|---|---|---|
| `recordResult()` | `this.budgetTracker?.recordStep()` dipanggil di sini DAN di `recordCompletion()` — **double counting step** | **HIGH** | ⏳ remaining |
| ~~`recordResult()`~~ | ~~Jika step gagal: `stepState.retryCount++` — retry count naik sebelum error analysis. Jika nanti analyze return "unknown", retry count sudah ke-increment~~ | ~~MEDIUM~~ | ✅ fixed |
| ~~`detectErrorCategory()`~~ | ~~Keyword matching sangat basic — "timeout", "error", "fail" — false positive tinggi~~ | ~~MEDIUM~~ | ✅ fixed |
| `getReadySteps()` | O(n) scan setiap kali — untuk plan besar (100+ steps) bisa lambat | LOW | ⏳ remaining |
| ~~`ContractVerifier` di instance field~~ | ~~`new ContractVerifier()` dibuat langsung — tidak bisa di-inject mock untuk testing~~ | ~~LOW~~ | ✅ fixed |

### `fine-tuning.ts`
| Fungsi | Issue | Severity | Status |
|---|---|---|---|
| ~~`waitForJob()`~~ | ~~`while(true)` loop — tidak ada timeout untuk individual `getJobStatus()`~~ | ~~MEDIUM~~ | ✅ fixed |
| ~~`waitForJob()`~~ | ~~Polling setiap 10s — untuk fine-tuning yang bisa 1 jam, ini 360 API calls~~ | ~~LOW~~ | ✅ fixed |
| ~~`uploadFile()`~~ | ~~`readFileSync` load entire file ke memory — file training bisa GB-size~~ | ~~MEDIUM~~ | ✅ fixed |
| ~~`createJob()`~~ | ~~Body construction dengan spread rawan type error — `hyperparameters` field overwrite~~ | ~~MEDIUM~~ | ✅ fixed |
| ~~Semua API calls~~ | ~~**Tidak ada retry logic** untuk API calls — fine-tuning API terkenal sering rate limit~~ | ~~MEDIUM~~ | ✅ fixed |
| ~~`parseJobResponse()`~~ | ~~`data.error as { message?: string }?.message` — unsafe cast~~ | ~~LOW~~ | ✅ fixed |

### `formal-model.ts`
| Fungsi | Issue | Severity | Status |
|---|---|---|---|
| `defaultConditionEvaluator()` | Heuristic string-based: `expr.includes("compile") && expr.includes("pass")` — false positive tinggi | MEDIUM | ⏳ remaining |
| `detectCycle()` | DFS dengan `stack.indexOf(node)` — O(n) search setiap node, total O(n²) | LOW | ⏳ remaining |
| `topologicalSort()` | Duplikasi logic dengan `detectCycle()` — Kahn's algorithm di-run 2x | MEDIUM | ⏳ remaining |
| `verify()` | Async keyword di function signature tapi implementasi synchronous — misleading | LOW | ⏳ remaining |
| `wouldCreateCycle()` | Create new `DependencyGraph` setiap call — O(V+E) alokasi | LOW | ⏳ remaining |

### `git.ts`
| Fungsi | Issue | Severity | Status |
|---|---|---|---|
| Semua fungsi | `execFileSync` di setiap git operation — blocking event loop. Untuk git operations yang bisa >1s | LOW | ⏳ remaining |
| ~~`getHistory()`~~ | ~~Parser delimiter `|||` — jika commit message mengandung `|||`, parsing broken~~ | ~~MEDIUM~~ | ✅ fixed |
| ~~`createPR()`~~ | ~~`gh pr create` output parsing — regex khusus github.com, tidak support GitHub Enterprise~~ | ~~MEDIUM~~ | ✅ fixed |
| `generatePRDescription()` | `title.slice(0, 69) + "..."` — hardcoded 72 chars | LOW | ⏳ remaining |

### `id-chain.ts`
| Fungsi | Issue | Severity | Status |
|---|---|---|---|
| `parsePipelineRunId()` | Regex `run-([^-]+)-(.+)$` — jika sessionID mengandung dash, parsing salah | MEDIUM | ⏳ remaining |
| (IDChain interface) | Tidak ada validasi format ID — bisa kosong, terlalu panjang, atau karakter ilegal | LOW | ⏳ remaining |

### `intent-parser.ts`
| Fungsi | Issue | Severity | Status |
|---|---|---|---|
| `validatePlan()` | DFS circular detection — recursion bisa stack overflow untuk plan >10k steps | LOW | ⏳ remaining |
| `createPlan()` | Complexity hanya berdasarkan subtask count — tidak consider dependency complexity | LOW | ⏳ remaining |

### `llm.ts`
| Fungsi | Issue | Severity | Status |
|---|---|---|---|
| ~~`getCacheKey()`~~ | ~~Hanya 200 chars systemPrompt + 500 chars userPrompt — hash collision risk tinggi~~ | ~~MEDIUM~~ | ✅ fixed |
| `responseCache` | `Map<string, ...>` tanpa batas size — memory leak di session panjang dengan banyak unique prompts | **HIGH** | ⏳ remaining |
| `callAnthropic()` | Body untuk Anthropic API: `system` field + jsonMode instruction digabung — format tidak sesuai spek Anthropic (system harus string, bukan concat) | MEDIUM | ⏳ remaining |
| `callOpenCode()` | `client.session.prompt()` dipanggil tanpa timeout wrapper — bisa hang jika OpenCode tidak responsif | **HIGH** | ⏳ remaining |
| ~~`httpCall()`~~ | ~~`setTimeout(() => controller.abort(), 60000)` kemudian `clearTimeout(timeout)` — jika fetch selesai tepat di batas waktu, race condition abort vs response~~ | ~~MEDIUM~~ | ✅ fixed |
| ~~`httpCall()`~~ | ~~`d.choices?.[0]` akses — tidak handle kasus choices array kosong~~ | ~~MEDIUM~~ | ✅ fixed |
| ~~`fallbackResponse()`~~ | ~~Untuk `jsonMode`, return `{"_no_llm": true}` — ini JSON valid tapi bisa crash caller yang expect schema tertentu~~ | ~~MEDIUM~~ | ✅ fixed |
| `buildMemoryContext()` | Silent catch — jika episodic store atau skill store error, memory context hilang tanpa notifikasi | LOW | ⏳ remaining |
| `decomposeTask()` / `analyzeError()` / `generatePlan()` | Multiple fallback parsing bertumpuk — regex, codeBlock, arrMatch — kode sangat repetitif | MEDIUM | ⏳ remaining |
| `callAnthropic()` / `callOpenAI()` | API key langsung di URL/header — potensi leak di logging | MEDIUM | ⏳ remaining |

### `mcp-client.ts`
| Fungsi | Issue | Severity | Status |
|---|---|---|---|
| `callStdio()` | Brace-counting JSON parser — tidak handle escaped braces dalam string JSON (`\"{\"`) | **HIGH** | ⏳ remaining |
| `connectStdio()` | 200ms + 500ms + 30000ms chained setTimeout — fragile race condition | MEDIUM | ⏳ remaining |
| `connectStdio()` | `stdout.on("data")` listener tidak pernah di-remove setelah resolve/reject — memory leak | MEDIUM | ⏳ remaining |
| `callHTTP()` / `connectHTTP()` | HTTP transport menggunakan `http.request` / `https.request` — tidak handle redirect 3xx | MEDIUM | ⏳ remaining |
| `connectStdio()` | `proc.stderr?.on("data", ...)` dengan comment "ignore" — stderr penting untuk debugging | LOW | ⏳ remaining |
| `disconnect()` / `disconnectAll()` | Tidak remove event listeners dari proc sebelum kill | MEDIUM | ⏳ remaining |

### `model-registry.ts`
| Fungsi | Issue | Severity | Status |
|---|---|---|---|
| `recordCall()` | `stat.byTaskType` — deep mutation tanpa copy, shared reference risk | LOW | ⏳ remaining |
| `getScore()` | `hallucinationRate = hallucinationCount / totalCalls` — terdefinisi baik karena totalCalls > 0 sudah di-check | OK | (Clean, no issue) |
| `selectBestModel()` | Nested map/filter/sort chains — O(n*m*k) complexity untuk select sederhana | LOW | ⏳ remaining |
| `enterQuarantine()` | Parameter `durationMinutes` default 30 — hardcoded magic number | LOW | ⏳ remaining |

### `navigator.ts`
| Fungsi | Issue | Severity | Status |
|---|---|---|---|
| ~~`walk()`~~ | ~~Membaca FULL content setiap file untuk parse imports/exports — I/O intensive untuk codebase besar~~ | ~~MEDIUM~~ | ✅ fixed |
| `walk()` | Recursion depth limit 10 — bisa miss file di `src/a/b/c/d/e/f/g/h/i/j/foo.ts` | LOW | ⏳ remaining |
| ~~`scan()`~~ | ~~Tidak ada skip untuk binary files — `readFile` di binary bisa throw~~ | ~~MEDIUM~~ | ✅ fixed |
| ~~`findRelevantFiles()`~~ | ~~Score heuristic standalone — tidak ada normalisasi TF-IDF~~ | ~~MEDIUM~~ | ✅ fixed |
| ~~`findDir()`~~ | ~~`isSystemDirectory` check hardcoded untuk Linux paths — tidak cross-platform~~ | ~~LOW~~ | ✅ fixed |
| ~~`detectProjectLanguages()`~~ | ~~Async tapi sequential — `await stat()` untuk setiap lang config~~ | ~~MEDIUM~~ | ✅ fixed |

### `parallel.ts`
| Fungsi | Issue | Severity | Status |
|---|---|---|---|
| ~~`executePhase()` + `executeAll()`~~ | ~~`Promise.all(phase.steps.map(runner))` — satu rejection crash semua step dalam phase~~ | ~~**HIGH**~~ | ✅ fixed |
| ~~`llmStepRunner()`~~ | ~~`mkdirSync(dirname(fullPath), {recursive: true})` — blocking I/O dalam async context~~ | ~~MEDIUM~~ | ✅ fixed |
| ~~`llmStepRunner()`~~ | ~~`writeFileSync` blocking di async function — bisa bottleneck~~ | ~~MEDIUM~~ | ✅ fixed |
| `executeWithSubprocessSpawn()` | `execFileSync` blocking — untuk subprocess spawn seharusnya async | MEDIUM | ⏳ remaining |
| `suggestParallelTasks()` | Group by dependency key — jika ada 10 step dengan `dependsOn: []`, semua di group yang sama (`__root__`) | LOW | ⏳ remaining |
| `detectConflicts()` | O(n²) pairwise comparison — untuk 100 parallel tasks, 4950 perbandingan | LOW | ⏳ remaining |

### `planner.ts`
| Fungsi | Issue | Severity | Status |
|---|---|---|---|
| ~~`decompose()`~~ | ~~First matching pattern wins — jika goal mengandung multiple keywords (e.g., "fix security bug"), pattern "fix" (index 1) dipilih, padahal "security" (index 8) mungkin lebih relevan~~ | ~~MEDIUM~~ | ✅ fixed |
| ~~`decompose()`~~ | ~~Rule `pattern: /create|build|make|.../i` (index 0 di generic section) OVERLAP dengan `pattern: /add|create|build|.../i` (index 0 di code section) — duplikasi~~ | ~~MEDIUM~~ | ✅ fixed |
| ~~`decompose()`~~ | ~~Cycle detection setelah generate subtasks lalu auto-fix dengan `dependsOn = []` — bisa menghilangkan dependency valid~~ | ~~MEDIUM~~ | ✅ fixed |
| `suggestSubtask()` | Return `verificationCriteria: []` — empty array seharusnya warning | LOW | ⏳ remaining |

### `prompt-builder.ts`
| Fungsi | Issue | Severity | Status |
|---|---|---|---|
| ~~`buildTemplate()`~~ | ~~Numbered list (`${hasDebate ? "7" : "6"}`) — fragile karena hardcode mapping index~~ | ~~MEDIUM~~ | ✅ fixed |
| ~~`buildGenericAgentPrompt()`~~ | ~~Tool list di-render `x.description.split(".")[0]` — potong kalimat pertama, bisa misleading~~ | ~~MEDIUM~~ | ✅ fixed |

### `prompt-template.ts`
| Fungsi | Issue | Severity | Status |
|---|---|---|---|
| ~~`render()`, `renderWithFrontmatter()`~~ | ~~Jika semua section empty, render menghasilkan string kosong — empty prompt bisa crash LLM call~~ | ~~MEDIUM~~ | ✅ fixed |
| `clone()` | Shallow copy section content string — safe karena string immutable | OK | (Clean) |

### `router-agent.ts`
| Fungsi | Issue | Severity | Status |
|---|---|---|---|
| ~~`keywordRoute()`~~ | ~~Confidence formula `score / Math.max(2, totalKeywords * 0.5)` — sangat arbitrary, bisa under/over estimate~~ | ~~MEDIUM~~ | ✅ fixed |
| ~~`keywordRoute()`~~ | ~~Iterasi semua keyword setiap category — O(c*k) per route, untuk tech category dengan 200+ keywords bisa lambat~~ | ~~MEDIUM~~ | ✅ fixed |
| ~~`route()`~~ | ~~Empty catch block saat LLM fallback gagal~~ | ~~LOW~~ | ✅ fixed |
| `DEFAULT_CATEGORIES` | Tech category punya ~200 keywords inline di source code — maintainability buruk | MEDIUM | ⏳ remaining |

### `task-classifier.ts`
| Fungsi | Issue | Severity | Status |
|---|---|---|---|
| ~~`detectTaskType()`~~ | ~~Order-dependent: REASONING pattern mencakup "design" dan "plan" — seharusnya setelah CODING karena overlap~~ | ~~MEDIUM~~ | ✅ fixed |
| `detectTaskType()` | Tidak ada pattern untuk web search, data analysis, devops, dsb | LOW | ⏳ remaining |

### `tech-debt-scorer.ts`
| Fungsi | Issue | Severity | Status |
|---|---|---|---|
| ~~`analyzeCoupling()`~~ | ~~Regex `^import\s/gm` — hanya match line yang MULAI dengan "import", tidak handle multi-line imports atau `const x = require(...)`~~ | ~~MEDIUM~~ | ✅ fixed |
| ~~`analyzePatterns()`~~ | ~~`as unknown as` detection via `content.includes("as unknown as")` — false positive dalam string/komentar~~ | ~~MEDIUM~~ | ✅ fixed |
| ~~`analyzeScope()`~~ | ~~Heuristic no-test-file-changed — false positive untuk non-code tasks~~ | ~~MEDIUM~~ | ✅ fixed |
| ~~`score()`~~ | ~~`maxScore` dari 4 kategori — satu kategori dominan bisa mark down yang lain~~ | ~~LOW~~ | ✅ fixed |

### `verifier.ts`
| Fungsi | Issue | Severity | Status |
|---|---|---|---|
| ~~`verifyFast()`~~ | ~~Compile cache: `filesSame = filesChanged.every((f,i) => f === lastCompileFiles[i])` — compare by exact reference dan order. Jika file list order berubah, cache miss~~ | ~~MEDIUM~~ | ✅ fixed |
| ~~`verifyAll()`~~ | ~~`verifyTests` dipanggil TANPA test pattern — menjalankan full test suite setiap step. Untuk intermediate steps, ini sangat lambat~~ | ~~MEDIUM~~ | ✅ fixed |
| ~~`verifyTests()`~~ | ~~Test commands: TypeScript selalu vitest, Python selalu pytest — tidak semua project menggunakan ini~~ | ~~MEDIUM~~ | ✅ fixed |
| `verifyLint()` | Static commands — eslint, ruff, golangci-lint — hardcoded args seperti `--quiet` | MEDIUM | ⏳ remaining |
| `verifyRelated()` | Inferred test files (`candidates`) dihasilkan tanpa cek keberadaan file — dikembalikan sebagai "related test files" meski tidak ada | LOW | ⏳ remaining |
| ~~`verifySemantic()`~~ | ~~`readFileSync` untuk baca semua changed files — blocking I/O di async function~~ | ~~MEDIUM~~ | ✅ fixed |

### `domains/code.ts`
| Fungsi | Issue | Severity | Status |
|---|---|---|---|
| `detectLanguage()` | Duplikasi dari `Verifier.detectLanguage()` — DRY violation | LOW | ⏳ remaining |
| ~~`codeDetect()`~~ | ~~`existsSync(f)` — path relatif terhadap cwd, tidak konsisten dengan projectDir~~ | ~~MEDIUM~~ | ✅ fixed |
| `codeVerifiers` | `execFileSync` di semua verifier — blocking event loop | LOW | ⏳ remaining |
| `codeErrorMatchers` | Import error: `suggestedFix: "npm install ..."` — tidak semua project npm | LOW | ⏳ remaining |

### `domains/data-science.ts`
| Fungsi | Issue | Severity | Status |
|---|---|---|---|
| ~~`dsDetect()`~~ | ~~`readdirSync(".")` dan `readFileSync(pf, "utf-8")` — blocking I/O + path hardcoded "."~~ | ~~MEDIUM~~ | ✅ fixed |
| ~~`dsDetect()`~~ | ~~`readdirSync(".")` — tanpa filter, untuk project dengan ribuan files bisa lambat~~ | ~~MEDIUM~~ | ✅ fixed |
| `dsVerifiers` | `notebook-check`: regex non-greedy untuk JSON parsing — rentan error | LOW | ⏳ remaining |

### `domains/devops.ts`
| Fungsi | Issue | Severity | Status |
|---|---|---|---|
| ~~`yaml-validate`~~ | ~~Tidak ada YAML parser real — hanya cek indentasi tab~~ | ~~MEDIUM~~ | ✅ fixed |
| `dockerfile-lint` | `execFileSync("which", ["hadolint"])` — "which" tidak available di Windows | LOW | ⏳ remaining |
| `devopsDetect()` | File detection untuk `.github/workflows` — path bisa di root atau subdir | LOW | ⏳ remaining |

### `domains/generic.ts`
| Fungsi | Issue | Severity | Status |
|---|---|---|---|
| ~~`genericErrorMatcher.match()`~~ | ~~**Selalu return `{ matched: true }`** — untuk ERROR APAPUN, error matcher ini akan match dan claim "Domain-agnostic error"~~ | ~~**HIGH**~~ | ✅ fixed |
| `emptyRoles` | Definisi inline roles untuk analyst/builder/reviewer/coordinator/planner — potential bloat | LOW | ⏳ remaining |

### `domains/mobile.ts`
| Fungsi | Issue | Severity | Status |
|---|---|---|---|
| `manifest-check` | Regex `<activity[\s\S]*?<\/activity>` — tidak handle nested tags atau comments | MEDIUM | ⏳ remaining |
| ~~`mobileDetect()`~~ | ~~`existsSync(f)` untuk files seperti `AndroidManifest.xml` — path hardcoded di root~~ | ~~MEDIUM~~ | ✅ fixed |
| `plist-check` | Regex check untuk plist — hanya basic XML tag presence | LOW | ⏳ remaining |

### `domains/security.ts`
| Fungsi | Issue | Severity | Status |
|---|---|---|---|
| ~~`securityDetect()`~~ | ~~`JSON.parse(readFileSync("package.json", "utf-8"))` — blocking I/O + bisa throw jika tidak ada package.json~~ | ~~MEDIUM~~ | ✅ fixed |
| ~~`secret-scan`~~ | ~~Regex pattern untuk secrets: `(?:api[_-]?key|...)[\s]*[:=][\s]*['"][A-Za-z0-9_\-/=+]{16,}['"]` — banyak false positive (contoh: test keys, example values)~~ | ~~MEDIUM~~ | ✅ fixed |
| `secret-scan` | `trivy fs --quiet ...` — exec command, `trivy` mungkin tidak terinstall | LOW | ⏳ remaining |

## Ringkasan Severity

| Severity | Awal | Fixed | Tersisa |
|---|---|---|---|
| **HIGH** | 10 | 3 (debate-loop execute timeout, parallel executePhase, generic error matcher) | 7 (agent-loop batchSteps, data-cleaner validate, llm responseCache, llm callOpenCode, mcp-client callStdio, executor recordResult double-counting, parallel executeWithSubprocess) |
| **MEDIUM** | 52 | 40 | 12 (budget-tracker check, event-taxonomy runtime validation, formal-model evaluator+sort, llm callAnthropic+decompose+key, mcp-client 4 items, router DEFAULT_CATEGORIES, verifier verifyLint) |
| **LOW** | 35 | 20 | 15 (config validateConfig+load, error-analyzer analyze, formal-model 3 items, git all functions, id-chain 2 items, intent-parser 2 items, llm buildMemoryContext, model-registry 3 items, navigator walk depth, parallel 2 items, planner suggestSubtask, verifier verifyRelated, domains: 5 items) |
| **OK** | 2 | — | 2 (model-registry getScore, prompt-template clone) |

**Total findings: 97**
**Fixed: 63 items + 3 HIGH**
**Remaining: 34 items (7 HIGH + 12 MEDIUM + 15 LOW)**

## Prioritas Perbaikan

1. ~~**executor.ts:55** — Hapus `budgetTracker.recordStep()` dari `recordResult()` (double counting)~~
2. **llm.ts:70** — Implement LRU cache untuk `responseCache` (memory leak)
3. **mcp-client.ts:353** — Ganti brace-counting JSON parser dengan parser proper
4. ~~**parallel.ts:102** — Ganti `Promise.all` dengan `Promise.allSettled` di parallel execution~~
5. **agent-loop.ts:77** — Fix potential infinite loop di `batchSteps`
6. ~~**debate-loop.ts:108** — Tambahkan timeout di semua LLM calls~~
7. ~~**domains/generic.ts:21** — Fix error matcher yang selalu return `matched: true`~~
8. ~~**config.ts:392** — Fix memory leak di polling interval~~
9. **data-cleaner.ts:146** — Fix validate() yang selalu return valid
10. ~~**verifier.ts:162** — Fix fragile compile cache comparison~~
