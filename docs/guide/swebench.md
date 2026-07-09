# SWE-bench Harness

Evaluasi `agentic_auto` pada **7 skenario** bug-fix / config / test-writing di fixture `test/e2e-codebase-fixture/`.

Harness: `test/swebench-harness.mjs`.

---

## Dua mode (jangan dicampur)

| Mode | Kapan | Perintah | Skor target |
|------|--------|----------|-------------|
| **Mock** | CI, regression cepat, tanpa network | `LLM_OFF=true npm run test:swebench` | **7/7 (100%)** — “tidak crash” |
| **Real LLM** | Ukur kemampuan model + harness | `npm run test:swebench` (default Free) atau env di bawah | Free ≈ **3/7 (43%)** (Juli 2026) |

Mock **bukan** bukti model pintar. Real **butuh** HTTP LLM client (sudah di-wire di harness).

---

## Cara ulang — Mock (wajib hijau)

```bash
npm run build
LLM_OFF=true node test/swebench-harness.mjs
# atau
LLM_OFF=true npm run test:swebench
```

Expected: `Score: 7/7 (100%)`.

---

## Cara ulang — Real LLM (OpenCode Free)

Default harness: **OpenCode Free** `https://opencode.ai/zen/v1` + model `mimo-v2.5-free`.

### Recommended (copy-paste)

```bash
npm run build

# JANGAN set OPENAI_API_KEY palsu (lihat "Pitfalls")
unset LLM_OFF
unset OPENAI_API_KEY

export OPENAI_BASE_URL=https://opencode.ai/zen/v1
export OPENAI_MODEL=mimo-v2.5-free

node test/swebench-harness.mjs
# atau
npm run test:swebench
```

### Apa yang harus terlihat (real)

Per scenario, log mirip:

```text
  LLM calls: 2 model=mimo-v2.5-free
  Targets: package.json
  Modified: package.json
  PASS: S1-fix-test-script: ...
```

- **`LLM calls: N`** dengan N ≥ 1 → HTTP client aktif  
- **`Targets:`** → path targeting H4  
- Durasi total real free: **~10–15+ menit** (bukan ~20s)  
- Trace `llm.response` dengan **tokens > 0** (bukan 0/0)

### Debug LLM body

```bash
SWE_DEBUG_LLM=1 node test/swebench-harness.mjs
```

Print preview content + usage tokens per call.

---

## Model / endpoint lain

```bash
# Local Ollama (OpenAI-compatible)
export OPENAI_BASE_URL=http://localhost:11434/v1
export OPENAI_MODEL=qwen2.5:0.5b
unset OPENAI_API_KEY   # atau key yang Ollama terima
node test/swebench-harness.mjs

# npm shortcut (Ollama)
npm run test:swebench-llm
```

Dengan API key berbayar (OpenAI-compatible):

```bash
export OPENAI_BASE_URL=https://api.openai.com/v1   # atau proxy
export OPENAI_API_KEY=sk-...
export OPENAI_MODEL=gpt-4o-mini
node test/swebench-harness.mjs
```

---

## Pitfalls (sering bikin “fake real”)

| Salah | Efek | Benar |
|-------|------|--------|
| Tidak pass `client` ke plugin (versi harness lama) | `[NO_LLM]`, 0 token, ~2s/scenario, skor palsu | Harness sekarang pakai `createHttpLlmClient` |
| `OPENAI_API_KEY=opencode-free` (atau key fiktif) | **HTTP 401** Invalid API key | **`unset OPENAI_API_KEY`** untuk zen free |
| `Authorization: Bearer opencode-free` | 401 | Free zen: **tanpa** header auth (atau bearer kosong) |
| Menganggap mock 7/7 = model bagus | Misleading | Mock = no crash; real = correctness |
| Free model + `max_tokens` kecil | Content null, cuma reasoning | Harness default max_tokens 8192 |

---

## 7 skenario

| ID | Kategori | File utama |
|----|----------|------------|
| S1 | config | `package.json` test script → vitest |
| S2 | test-writing | `tests/unit/AuthService.test` |
| S3 | bug-fix | `src/utils/validation.ts` email regex |
| S4 | import-bug | `src/utils/logger.ts` broken import |
| S5 | config | `src/middleware/RateLimitMiddleware.ts` |
| S6 | bug-fix | `src/middleware/AuthMiddleware.ts` |
| S7 | config | `src/middleware/CorsMiddleware.ts` |

Fixture: `test/e2e-codebase-fixture/` (disalin ke `/tmp/swebench-worktree-<id>`).

---

## Baseline skor (agentic_auto, free model)

| Tanggal | Setup | Score | Catatan |
|---------|--------|-------|---------|
| 2026-07 (pre-H4 / harness palsu) | “real” tanpa client | 2/7 (29%) | Sering NO_LLM / 0-token |
| **2026-07-09 (post-H4 + HTTP client)** | mimo-v2.5-free + zen | **3/7 (43%)** | S1+S3+S6 pass; S2/S4/S5/S7 fail |
| Delegate + manual fix | model kuat / manual | 7/7 | Bukan pure `agentic_auto` |

H4 (path targeting, verify-before-done) membantu **S1** (package.json). Bottleneck sisa: kualitas free model + scope creep file.

---

## npm scripts

| Script | Perilaku |
|--------|----------|
| `npm run test:swebench` | Real default (OpenCode Free jika env kosong) |
| `npm run test:swebench:mock` | `LLM_OFF=true` mock 7/7 |
| `npm run test:swebench-llm` | Override Ollama localhost |

---

## Arsitektur singkat

```
swebench-harness.mjs
  → createHttpLlmClient()  // session.prompt → POST /chat/completions
  → AgenticEngine({ client, worktree })
  → agentic_auto.execute({ goal: scenario.description })
  → scenario.evaluate(worktree)
```

Plugin **tidak** call API eksternal sendiri; semua lewat client yang di-inject. Standalone tanpa client = `[NO_LLM]`.

---

## Lihat juga

- `AGENTS.md` — Commands  
- `TODO.md` / `PLAN.md` — skor & H4 notes  
- `src/tools/auto.ts` — path hints / verify-before-done  
