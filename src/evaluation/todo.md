# src/evaluation — Code Review & Optimization Todo

## Web Search Best Practices
- **NIST AI 800-2** — Automated benchmark evaluations harus punya confidence intervals, reproducible pipeline
- **Four Golden Signals (Google SRE)** — Latency, traffic, errors, saturation sebagai dimensi inti
- **Trajectory-level eval** — Setiap dimensi skor harus independen, bukan agregat doang
- **Per-dimension scoring** — Aggregate task-completion saja tidak cukup; perlu breakdown per dimensi

---

## Temuan per File

### `live-evaluator.ts`

| Fungsi | Issue | Severity | Rekomendasi | Status |
|---|---|---|---|---|
| `computeErrorRecovery()` | Return `1` (sempurna) ketika tidak ada error — false positive | **High** | Return `null` atau `undefined` untuk "no data", jangan inflate score | ✅ Fixed (return 0) |
| `computeContextStability()` | Return `1` ketika navigasi kosong — bias optimistis | **High** | Sama, bedakan "no data" vs "perfect score" | ✅ Fixed (return 0) |
| `computeMultiAgent()` | Return `1` ketika delegasi kosong — melebih-lebihkan performa | **High** | Sama seperti di atas | ✅ Fixed (return 0) |
| `computeSkillReuse()` | Return `0.5` (arbitrer) ketika tidak ada skill lookup — nilai tebakan | **Medium** | Return `null`, biarkan weighted sum menyesuaikan |
| `computeScore()` | Tidak ada validasi weights total = 1.0 (saat ini benar, tapi rapuh) | **Low** | Normalisasi weights secara otomatis di `computeScore()` |
| `computeScore()` | Tidak handle NaN/Infinity — bisa crash kalau ada edge-case | **Medium** | Guard `isNaN` / `isFinite` setelah kalkulasi |
| `formatReport()` | Menggunakan emoji (`📊`, `✅`, `⚠️`, `❌`, `🔧`) — melanggar AGENTS.md | **Low** | Ganti dengan ASCII (`[OK]`, `[WARN]`, `[FAIL]`) |
| `computeScore()` | Tidak ada `confidenceInterval` atau `standardDeviation` per dimensi | **Medium** | Tambah statistik dasar (mean, stddev dari sliding window) |
| `feedStepResult()` | Tidak ada timestamp — tidak bisa time-series analysis | **Low** | Tambah field `timestamp` opsional |
| `fromJSON()` | Tidak validasi data — silent corruption jika JSON rusak | **Medium** | Tambah Zod/io-ts schema validation |
| `computeContextStability()` | Threshold ≤10 results sebagai "focused" — terlalu sederhana | **Low** | Jadikan configurable, atau gunakan relevansi score |
| Semua compute\*() | Tidak ada session-scoping — data tercampur antar sesi | **Medium** | Filter berdasarkan sessionId waktu compute |

**Rekomendasi Prioritas:**
1. ✅ Fix false-positive returns (no data = null, bukan 1) — DONE: return 0 instead
2. Tambah NaN/Infinity guard
3. Tambah schema validation di `fromJSON()`
4. Ganti emoji dengan ASCII
