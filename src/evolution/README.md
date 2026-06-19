# src/evolution — Evolusi Berkelanjutan & Self-Evolver

> Modul untuk memonitor performa agent secara real-time, mendeteksi degradasi, dan secara otomatis menganalisis akar masalah untuk meningkatkan efektivitas agent dari waktu ke waktu. Mengimplementasikan visi "continuous evolution" dari paper — agent yang memonitor diri sendiri dan melakukan self-improvement.

## Daftar File

### 1. `continuous-evolution.ts`
Rolling window performance tracker. Memonitor hasil step dalam jendela geser, mendeteksi tren degradasi, memberikan rekomendasi, dan memicu evolution analysis ketika performa menurun.

| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `StepResult` | `stepId: string, success: boolean, output: string, sessionId: string, timestamp: number, category?: string` | Interface | Data hasil eksekusi satu step |
| `ForecastData` | `nextWindowRate: number, stepsUntilCritical: number \| null, critical: boolean, bucketRates: number[]` | Interface | Prediksi degradasi ke depan (Gap #12) |
| `PerformanceTrend` | `overall: {...}, rolling: {...}, degradationDetected: boolean, anomalyCount: number, recentErrors: array, recommendations: string[], forecast: ForecastData` | Interface | Ringkasan tren performa lengkap dengan prediksi |
| `EvolutionTrigger` | `reason: string, type: "degradation"\|"anomaly_spike"\|"milestone", metrics: {...}` | Interface | Alasan mengapa evolusi perlu dipicu |
| `DegradationCallback` | `(trend: PerformanceTrend, trigger: EvolutionTrigger) => void` | Type | Callback yang dipanggil saat degradasi terdeteksi |
| `ContinuousEvolution` (class) | | | Kelas utama untuk tracking performa rolling window |
| `constructor(windowSize=20)` | `windowSize: number` | - | Buat instance dengan ukuran jendela geser |
| `feedStepResult(result)` | `result: StepResult` | `void` | Masukkan satu hasil step ke rolling window |
| `feedBatch(results)` | `results: StepResult[]` | `void` | Masukkan banyak hasil step sekaligus |
| `onDegradation(cb)` | `cb: DegradationCallback` | `void` | Daftarkan callback yang dipanggil saat degradasi |
| `getTrend()` | - | `PerformanceTrend` | Dapatkan tren performa terkini + prediksi |
| `checkAndNotify()` | - | `PerformanceTrend` | Cek tren & panggil callback jika degradasi |
| `shouldEvolve(sessionId)` | `sessionId: string` | `EvolutionTrigger \| null` | Putuskan apakah perlu auto-evolve |
| `reset()` | - | `void` | Reset state (untuk testing) |
| `getStats()` | - | `{ totalResults, evolveCount, windowSize }` | Dapatkan statistik mentah |
| `toJSON()` | - | `{ results, evolveCount, windowSize }` | Serialisasi untuk persistensi |
| `fromJSON(data)` | `data: {...}` | `void` | Restore dari state tersimpan |

### 2. `self-evolver.ts`
Menganalisis data dari sesi sebelumnya (skills, episodes, tasks, traces) dan menghasilkan laporan evolusi berupa patch untuk skill, saran role baru, dan patch prompt untuk agent roles.

| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `EvolutionMetrics` | `totalSessions, totalSteps, successRate, retryRate, avgRetriesPerFailure, topErrorCategories, skillEffectiveness, toolUsage, recommendations` | Interface | Metrik performa komprehensif dari semua sesi |
| `SkillPatch` | `skillId, skillName, failures, suggestedChanges: [{type, description, detail}]` | Interface | Saran perbaikan untuk skill yang bermasalah |
| `RoleSuggestion` | `name, triggerPattern, suggestedTools: string[], reason` | Interface | Saran pembuatan role agent baru berdasarkan pola kegagalan |
| `PromptPatch` | `role, errorCategory, instruction, priority, occurrences` | Interface | Saran penambahan instruksi ke prompt agent role |
| `EvolutionReport` | `metrics: EvolutionMetrics, skillPatches, roleSuggestions, promptPatches, improvementScore` | Interface | Laporan evolusi lengkap |
| `SelfEvolver` (class) | | | Kelas utama untuk analisis evolusi multi-sesi |
| `feedSkills(skills)` | `skills: SkillRecord[]` | `void` | Masukkan data skill yang ada |
| `feedEpisodes(episodes)` | `episodes: Episode[]` | `void` | Masukkan episode dari sesi sebelumnya |
| `feedTasks(tasks)` | `tasks: AgentTask[]` | `void` | Masukkan data task |
| `feedStepStates(steps)` | `steps: Array<{stepId, success, output}>` | `void` | Masukkan state step untuk analisis |
| `feedTraces(traces)` | `traces: Array<{toolUsed, success, step}>` | `void` | Masukkan trace tool usage |
| `evolve()` | - | `EvolutionReport` | Jalankan analisis evolusi: hitung metrik, analisis skill, saran role, saran patch prompt |
| `computeMetrics()` (private) | - | `EvolutionMetrics` | Hitung metrik dari semua data yang di-feed |
| `analyzeSkills()` (private) | - | `SkillPatch[]` | Analisis skill dengan sukses rate < 80%, beri saran perbaikan (rollback, retry, validasi, split) |
| `suggestRoles()` (private) | - | `RoleSuggestion[]` | Deteksi pola kegagalan berdasarkan keyword (security, performance, database) & saran role baru |
| `suggestPromptPatches(metrics)` (private) | `metrics: EvolutionMetrics` | `PromptPatch[]` | Mapping error category ke instruksi prompt untuk role tertentu (compile→developer, import→architect, test→QA) |
