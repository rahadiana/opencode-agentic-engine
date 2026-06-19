# `src/evaluation` — Evaluasi Real-time Performa Agent

> Modul evaluasi live yang mengukur performa agent secara real-time dari aktivitas sesi nyata,
> terinspirasi dari metrik SWE-bench (task success) dan EvoClaw (continuous evolution).
>
> Bobot penilaian: taskSuccess 40%, errorRecovery 20%, contextStability 15%, multiAgent 15%, skillReuse 10%.

## Daftar File

### 1. `live-evaluator.ts`

| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `LiveEvalDimension` (interface) | `score: number`, `weight: number`, `target: number`, `detail: string` | — | Dimensi evaluasi tunggal: skor 0-1, bobot kontribusi, target minimal, dan deskripsi |
| `LiveEvalScore` (interface) | `overall: number`, `dimensions: Record<string, LiveEvalDimension>`, `totalSteps: number`, `totalErrors: number`, `recoveredErrors: number`, `totalDelegations: number`, `successfulDelegations: number`, `sweBenchScore: number`, `evoClawScore: number` | — | Hasil evaluasi lengkap: skor overall (0-100), rincian dimensi, statistik aktivitas, skor SWE-bench & EvoClaw |
| `LiveEvaluator` (class) | — | — | Kelas utama untuk mengumpulkan data, menghitung skor, dan menghasilkan laporan evaluasi live |
| `feedStepResult(step)` | `step: { stepId, success, sessionId? }` | `void` | Mencatat hasil eksekusi step (sukses/gagal) |
| `feedErrorRecovery(errorId, recovered)` | `errorId: string`, `recovered: boolean` | `void` | Mencatat apakah error berhasil pulih setelah retry |
| `feedNavigation(query, resultsCount)` | `query: string`, `resultsCount: number` | `void` | Mencatat navigasi file yang dilakukan agent |
| `feedDelegation(taskId, role, success)` | `taskId: string`, `role: string`, `success: boolean` | `void` | Mencatat hasil delegasi ke agent role lain |
| `feedSkillLookup(found)` | `found: boolean` | `void` | Mencatat apakah pencarian skill berhasil |
| `computeTaskSuccess()` | — | `number` (0-1) | Menghitung persentase step yang sukses dari total (SWE-bench style) |
| `computeErrorRecovery()` | — | `number` (0-1) | Menghitung persentase error yang berhasil pulih |
| `computeContextStability()` | — | `number` (0-1) | Menghitung proporsi navigasi fokus (≤10 hasil) sebagai indikator stabilitas konteks |
| `computeMultiAgent()` | — | `number` (0-1) | Menghitung persentase delegasi multi-agent yang sukses |
| `computeSkillReuse()` | — | `number` (0-1) | Menghitung persentase lookup skill yang berhasil ditemukan |
| `computeScore()` | — | `LiveEvalScore` | Menghitung skor evaluasi keseluruhan (weighted composite) + skor SWE-bench & EvoClaw |
| `formatReport(includeTips?)` | `includeTips?: boolean` (default: `true`) | `string` | Menghasilkan laporan human-readable dengan progress bar, tips perbaikan jika skor < 80 |
| `toJSON()` | — | `{ stepResults, errorRecoveries, navigations, delegations, skillLookups }` | Men-serialize state internal untuk persistensi |
| `fromJSON(data)` | `data: ReturnType<LiveEvaluator["toJSON"]>` | `void` | Me-restore state dari data yang di-persist sebelumnya |
