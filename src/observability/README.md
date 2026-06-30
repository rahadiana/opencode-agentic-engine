# observability/ — Observability

| File | Fungsi |
|------|--------|
| `logger.ts` | Structured logger: debug/info/warn/error, timestamped |
| `dashboard.ts` | Timeline + stats + anomaly detection + model reliability |
| `trace-logger.ts` | JSONL trace writer (buffered, auto-flush, dedup guard) |

## Dashboard Metrics

Tersedia via `agentic_status detail="full"`:
- Statistics (calls, success rate, latency, peak concurrency)
- Tools Used (sorted table)
- Timeline (last 20 events)
- Anomalies (timeout, loop, retry storm detection)
- Evolution metrics (skills, lifecycle, usage)
- Constraint safety (violations, circuit breaker)
- Performance (slowest tools, semantic cache hit rate)
- Model reliability (per-model: reliability %, hallucination %, calls)
