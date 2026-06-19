# src/observability — Observability & Monitoring

> Modul observability menyediakan tracing eksekusi agent berbasis JSONL dan dashboard real-time dengan deteksi anomali (timeout, retry storm, loop, silent failure).

## Daftar File

### 1. `trace-logger.ts`
| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `TraceLogger(worktree)` | `worktree: string` | `TraceLogger` | Membuat instance logger dengan path log di `.agentic/trace.jsonl` |
| `setRetentionDays(days)` | `days: number` | `void` | Mengatur jumlah hari retensi untuk pruning otomatis (0 = nonaktif) |
| `pruneOldTraces()` | — | `Promise<number>` | Menghapus entri trace yang lebih tua dari `retentionDays`, mengembalikan jumlah yang dihapus |
| `init()` | — | `Promise<void>` | Membuat direktori log jika belum ada |
| `log(entry)` | `entry: Omit<TraceEntry, "timestamp">` | `void` | Menambahkan entri trace ke buffer; flush otomatis tiap 10 entri atau 5 detik |
| `flush()` | — | `Promise<void>` | Menulis buffer ke file `trace.jsonl` secara atomik |
| `dispose()` | — | `Promise<void>` | Membersihkan interval flush dan menulis sisa buffer |
| `TraceEntry` | — | `interface` | `{timestamp, step, input, output, toolUsed, success, durationMs, metadata?}` |

### 2. `dashboard.ts`
| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `Dashboard()` | — | `Dashboard` | Membuat instance dashboard untuk generate laporan observability |
| `generate(traces, _sessionStart)` | `traces: TraceEntry[]`, `_sessionStart: number` | `DashboardData` | Menghitung timeline, statistik (total calls, success rate, avg latency, peak concurrency), dan mendeteksi anomali |
| `formatForDisplay(data)` | `data: DashboardData` | `string` | Memformat data dashboard ke string markdown siap tampil (statistik, tools, timeline 20 terakhir, anomali) |
| `DashboardData` | — | `interface` | `{timeline: TimelineEvent[], statistics: Statistics, anomalies: Anomaly[]}` |
| `TimelineEvent` | — | `interface` | `{time, tool, step, success, durationMs}` |
| `Statistics` | — | `interface` | `{totalCalls, successRate, averageLatency, toolsUsed: Map, peakConcurrency}` |
| `Anomaly` | — | `interface` | `{type: "timeout"\|"loop"\|"retry_storm"\|"silent_failure", description, detectedAt, tool?, count?}` |
