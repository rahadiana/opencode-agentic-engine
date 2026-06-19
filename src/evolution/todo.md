# src/evolution — Code Review & Optimization Todo

## Web Search Best Practices
- **Agent Drift (Kumaran Ponnambalam, 2025)**: Goal Drift, Context Drift, Reasoning Drift, Collaboration Drift — perlu di-deteksi secara terpisah
- **EvolveR (ICLR 2026)**: Closed-loop experience lifecycle — offline self-distillation + online interaction dengan policy reinforcement
- **Dual-Process Agent (DPA)**: Fast system 1 (retrieve) + Slow system 2 (reflect + write back) — inspirasi untuk checkpoint/curator gate
- **Rolling window forecasting**: Gunakan cross-validation untuk pilih window size optimal, bukan fixed 20

---

## Temuan per File

### `continuous-evolution.ts`

| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `getTrend()` (forecast) | Linear regression sederhana — asumsi linear decay tidak realistis | **High** | Pakai exponential smoothing (Holt-Winters) atau weighted moving average |
| `getTrend()` (`isDecreasing`) | Pakai `<=` — plateau juga dianggap decreasing | **High** | Ganti `<` dan tambah minimum decline threshold (≥10%) |
| `feedBatch()` | Loop O(N) panggil `feedStepResult()` — redundant validasi | **Medium** | Batch push langsung ke `this.results` lalu trim sekali |
| `checkAndNotify()` | Callback error silent — mati tanpa jejak | **Medium** | Log error ke console/trace sebelum catch |
| `shouldEvolve()` | Cap 20 evolutions hardcoded — tidak configurable | **Medium** | Jadikan parameter constructor atau config |
| `getTrend()` (direction) | Threshold 5% arbitrary — tidak ada statistical significance | **Medium** | Tambah confidence interval (CI 95%) sebelum deklarasi "direction" |
| `getTrend()` (buckets) | 5 buckets tetap — untuk 10 data poin hanya 2 per bucket | **Medium** | Dynamic bucket count: min(5, floor(N/3)) |
| `getTrend()` | Tidak ada deteksi seasonality — performa bisa fluktuasi by design | **Low** | Tambah deteksi pola mingguan/harian sederhana |
| `fromJSON()` | Tidak validasi `windowSize` — bisa 0 atau negatif | **Medium** | Guard `windowSize = Math.max(1, data.windowSize)` |
| `toJSON()` | Tidak serialize `lastEvolveSession` — state hilang setelah persist | **Low** | Tambah field ke JSON output |
| `getTrend()` (recommendations) | String literal dibanding (`category === "type"` dll) — fragile | **Low** | Pake enum atau konstanta |
| `getTrend()` | Tidak ada cache — dipanggil 2-3x per siklus (getTrend, shouldEvolve) | **Low** | Tambah memoization di checkAndNotify |

### `self-evolver.ts`

| Fungsi | Issue | Severity | Rekomendasi |
|---|---|---|---|
| `evolve()` | `improvementScore` menggunakan multipliers arbitrary (15,10,8,5) | **High** | Ganti dengan normalized weighted formula berbasis data aktual |
| `computeMetrics()` | Double-counting: `doneSteps + tasks.filter(done)` dan `failedSteps + tasks.filter(failed)` | **High** | Dedup — pilih satu source of truth (stepStates atau tasks) |
| `analyzeSkills()` | Hanya analisis 3 failure scenarios terakhir — bisa miss pattern | **Medium** | Analisis semua failure scenarios, atau pakai weighted sampling |
| `suggestRoles()` | Keyword matching sederhana — "security" bisa false positive | **Medium** | Tambah konteks: cocokkan dengan error categories juga |
| `suggestPromptPatches()` | Mapping static di hardcoded array — tidak extensible | **Medium** | Jadikan configurable via constructor atau external config |
| `analyzeSkills()` (`scenario.includes("rollback")`) | Case-sensitive — "Rollback" vs "rollback" | **Low** | `scenario.toLowerCase().includes()` |
| `evolve()` | Auto-apply logic fragile: `occurrences >= 2 && <= 5` untuk high priority | **Medium** | Tambah threshold sebagai parameter, jangan hardcode |
| `computeMetrics()` | Tidak bedakan task complexity — success rate sederhana vs multi-step sama | **Medium** | Weight success rate berdasarkan step count per task |
| `feedEpisodes()` / `feedTasks()` | Tidak ada validasi input — bisa null/undefined | **Medium** | Guard: `this.episodes = episodes ?? []` |
| `computeMetrics()` | `avgRetriesPerFailure` bisa NaN jika `failed = 0` | **Medium** | Guard: `failed > 0 ? ... : 0` |
| `suggestRoles()` (Coordinator) | Trigger "tasks.length > 10" — terlalu sederhana | **Low** | Pertimbangkan juga failure rate per role |
| Semua feed\*() | Tidak ada dedup — data bisa di-feed multiple kali | **Low** | Opsional dedup berdasarkan ID |

**Rekomendasi Prioritas:**
1. Fix double-counting di `computeMetrics()`
2. Ganti linear regression forecast dengan exponential smoothing
3. Fix plateau detection (`>=` jadi `>` dengan threshold)
4. Tambah statistik confidence interval untuk direction detection
