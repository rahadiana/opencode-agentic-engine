# src/observability — Code Review & Optimization Todo

## Web Search Best Practices
- **Grafana dashboard best practices**: RED method (Rate, Errors, Duration) untuk services; USE method (Utilization, Saturation, Errors) untuk infrastruktur
- **JSONL best practices**: Stream jangan slurp; kompres dengan gzip/zstd; gunakan readline untuk line-by-line processing
- **Structured logging (Node.js)**: Pino/tslog untuk JSONL production; Async buffer dengan backpressure; jangan re-add entries di catch tanpa guard
- **OpenTelemetry**: Standard instrumentation untuk traces + metrics + logs

---

## Temuan per File

### `trace-logger.ts`

| Fungsi | Issue | Severity | Rekomendasi | Status |
|---|---|---|---|---|
| `log()` | `flush()` dipanggil async tapi tidak di-`await` — unhandled promise | **High** | Return promise dan await di caller | ✅ Fixed (.catch handler) |
| `flush()` | Race condition: buffer atomik ditukar, tapi jika write gagal, entries di-re-add bisa duplikat | **High** | Pake mekanisme backoff + queue terpisah untuk failed writes | ✅ Fixed (tidak clear buffer sampai sukses) |
| `pruneOldTraces()` | Baca SEMUA file ke memory — defeats streaming JSONL | **High** | Stream line-by-line dengan readline, write ke temp + rename | ✅ Fixed (readline stream) |
| `flush()` | Tidak ada backpressure — buffer bisa tumbuh tak terbatas | **Medium** | Set `maxBufferSize`, jika overflow drop oldest atau block | ✅ Fixed (maxBufferSize=10000, shift) |
| Tidak ada | File rotation — satu file `trace.jsonl` terus membesar | **Medium** | Implement daily/hourly rotation: `trace-2025-06-19.jsonl.gz` | ✅ Fixed (rotateIfNeeded at 100MB) |
| `pruneOldTraces()` | Catch silent — error pruning diabaikan total | **Medium** | Log error, kasih metric counter untuk observability | ✅ Fixed (console.error) |
| `log()` | Batch size hardcoded 10 — tidak adaptif | **Low** | Jadikan configurable di constructor | ✅ Fixed (batchSize param) |
| `init()` | Tidak ada error handling jika mkdir gagal | **Medium** | Throw atau return structured error | ✅ Fixed (try/catch + throw) |
| `flush()` | Tidak ada compression — file besar bisa GB | **Medium** | Tambah opsi gzip streaming (zlib) | ✅ Fixed (useCompression option) |
| `log()` | Tidak ada log level filtering | **Low** | Tambah field `level: "info" | "warn" | "error"` | ✅ Fixed (minLevel filter) |
| `dispose()` | Tidak ada mutex — dipanggil concurrent bisa partial write | **Low** | Guard dengan lock sederhana | ✅ Fixed (flushLock) |

### `dashboard.ts`

| Fungsi | Issue | Severity | Rekomendasi | Status |
|---|---|---|---|---|
| `computePeakConcurrency()` | Fixed 2-second window — arbitrary, tidak cocok semua workload | **High** | Jadikan configurable parameter, auto-detect dari data | ✅ Fixed (constructor param, default 2000ms) |
| `computePeakConcurrency()` | Hanya pakai timestamp, bukan actual start/end time | **Medium** | Pakai range-based overlap detection jika data tersedia | ✅ Fixed (metadata._start/_end) |
| `detectAnomalies()` (loop) | O(n² × 4) complexity — slow untuk >1000 traces | **High** | Optimasi: batasi sliding window max 100, atau sampling | ✅ Fixed (Map-based O(n), bounded 100) |
| `detectAnomalies()` (silent failure) | Asumsi sequential order verify→execute — false positive jika out-of-order | **High** | Case-insensitive step prefix match; handle missing gaps | ✅ Fixed (match by stepId) |
| `detectAnomalies()` (retry_storm) | Step match pakai `startsWith("execute:")` — tidak handle prefix lain | **Medium** | Regex atau case-insensitive match | ✅ Fixed (/^execute:/i) |
| `detectAnomalies()` (semua) | Tidak deduplikasi — anomaly yang sama bisa muncul berulang | **Medium** | Dedup berdasarkan `type + tool + description` dalam satu waktu | ✅ Fixed (Map-based dedup) |
| `generate()` | `toolsUsed` sebagai Map — tidak serializable ke JSON | **Medium** | Cast ke `Record<string, number>` sebelum return | ✅ Fixed (convert to object) |
| `formatForDisplay()` | Menggunakan emoji (`📈`, `✅`, `❌`, `⚠️`) | **Low** | Ganti dengan ASCII `[OK]` `[FAIL]` `[WARN]` | ✅ Fixed (ASCII) |
| `formatForDisplay()` | Timeline hardcoded "last 20" — tidak ada parameter | **Low** | Jadikan parameter opsional, default 20 | ✅ Fixed (timelineLimit param) |
| `statistics` | Tidak ada percentiles latency (p50, p95, p99) | **Medium** | Tambah `latencyPercentiles: { p50, p95, p99 }` | ✅ Fixed (computeLatencyPercentiles) |
| `detectAnomalies()` | Tidak ada anomaly severity level | **Low** | Tambah field `severity: "critical" | "warning" | "info"` | ✅ Fixed (severity field) |

**Rekomendasi Prioritas:**
1. ✅ Fix unhandled promise di `TraceLogger.log()` — done (.catch)
2. ✅ Optimasi loop detection di dashboard — done (Map-based O(n))
3. ✅ Implement streaming prune (jangan baca semua ke memory) — done (readline)
4. ✅ Fix race condition flush + silent failure detection — done
