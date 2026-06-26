# drift/ — Error Detection & Recovery

| File | Fungsi |
|------|--------|
| `checkpoints.ts` | Risk evaluation: BLOCK/REVIEW/WARNING. Deteksi file deletion, mass changes, API changes, config/secret exposure |
| `context-compressor.ts` | Sliding window + key info extraction untuk context compression |
| `dependency-tracker.ts` | Per-session file change + error propagation tracking |
| `hallucination-guard.ts` | Verifikasi 4 claim types: file_exists, function_exists, import_valid, api_signature. Path traversal protection |
| `pattern-discovery.ts` | Error pattern discovery dari riwayat error |

## Flow

```
execute step → hallucination guard (auto) → checkpoint risk eval → dependency track → pattern discovery
```
