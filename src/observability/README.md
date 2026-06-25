# src/observability — Observability & Monitoring

> Modul observability menyediakan tracing eksekusi agent berbasis JSONL dan dashboard real-time dengan deteksi anomali (timeout, retry storm, loop, silent failure).

## Daftar File

### 1. `logger.ts`
| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `createLogger(source)` | `source: string` | `Logger` | Membuat logger dengan source prefix. Set `AGENTIC_LOG_JSON=1` untuk JSON output, `AGENTIC_LOG_LEVEL` untuk filter level |
| `Logger.debug(msg, meta?)` | `msg: string`, `meta?: Record<string, unknown>` | `void` | Log level debug |
| `Logger.info(msg, meta?)` | `msg: string`, `meta?: Record<string, unknown>` | `void` | Log level info |
| `Logger.warn(msg, meta?)` | `msg: string`, `meta?: Record<string, unknown>` | `void` | Log level warn |
| `Logger.error(msg, meta?)` | `msg: string \| Error`, `meta?: Record<string, unknown>` | `void` | Log level error — menerima string atau Error object |
| `LogSeverity` | — | `type` | `"debug" \| "info" \| "warn" \| "error"` |
| `LogEntry` | — | `interface` | `{timestamp, severity, source, message, meta?}` |

### 2. `trace-logger.ts`
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

### 3. `dashboard.ts`
| Fungsi/Kelas | Parameter | Return | Deskripsi |
|---|---|---|---|
| `Dashboard()` | — | `Dashboard` | Membuat instance dashboard untuk generate laporan observability |
| `generate(traces, _sessionStart)` | `traces: TraceEntry[]`, `_sessionStart: number` | `DashboardData` | Menghitung timeline, statistik (total calls, success rate, avg latency, peak concurrency), dan mendeteksi anomali |
| `formatForDisplay(data)` | `data: DashboardData` | `string` | Memformat data dashboard ke string markdown siap tampil (statistik, tools, timeline 20 terakhir, anomali) |
| `DashboardData` | — | `interface` | `{timeline: TimelineEvent[], statistics: Statistics, anomalies: Anomaly[]}` |
| `TimelineEvent` | — | `interface` | `{time, tool, step, success, durationMs}` |
| `Statistics` | — | `interface` | `{totalCalls, successRate, averageLatency, toolsUsed: Map, peakConcurrency}` |
| `Anomaly` | — | `interface` | `{type: "timeout"\|"loop"\|"retry_storm"\|"silent_failure", description, detectedAt, tool?, count?}` |
