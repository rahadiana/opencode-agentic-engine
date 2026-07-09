# observability/ — Observability

| File | Fungsi |
|------|--------|
| `logger.ts` | Structured logger: debug/info/warn/error |
| `dashboard.ts` | Timeline + stats + anomaly + model reliability (+ evolution/constraint metrics) |
| `trace-logger.ts` | JSONL trace writer (buffered, auto-flush, dedup) |

## Dashboard via `agentic_status detail="full"`

- Execution overview / progress
- Workflow engine retry entries
- **Model reliability** (per-model)
- **🛡️ Dumb-Model Harness** — ACTIVE/off, source, model, WorkflowPolicy effective
- Available models (dari OpenCode)
- Error recovery / Alignment / Economics summaries
- Trace timeline, anomalies, evolution metrics (jika data ada)

## Events → traces

`EventBus.onAny` di `index.ts` menulis ke TraceLogger.  
File: `.agentic/trace.jsonl` (retensi lewat `storage.traceRetentionDays`).
