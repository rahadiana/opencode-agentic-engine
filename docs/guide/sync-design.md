# Remote RAG Two-Way Sync — Design (P0-3, belum diimplementasi penuh)

> Status: **pull terimplementasi opt-in** (`rag.remotePullEnabled`, default `false`).
> Tanpa config pull → perilaku one-way push seperti `v0.5.9-dev`, zero perubahan.

## Tujuan

- Pull knowledge dari remote (`server → plugin`) + push yang sudah ada.
- Konflik deterministik, offline-first (lokal selalu bisa jalan tanpa remote).
- Query remote via MCP (sesuai `PLAN.md` future work).

## Kontrak API

```
POST {remoteUrl}            # push (sudah ada): { entries, exportedAt, projectId }
GET  {remoteUrl}?since={etag}&projectId={id}   # pull (baru): { entries, etag }
```

- `etag`: opaque string dari server (`lastSync` ISO atau hash). Plugin kirim `since` terakhir.
- Auth: `Authorization: Bearer {remoteApiKey}` bila dikonfigurasi.
- Timeout 5s, retry 1× dengan backoff; gagal pull = log + lanjut lokal (graceful degradation).

## Konflik: server-wins untuk konten, local-wins untuk usage stats

| Field | Pemenang | Alasan |
|-------|----------|--------|
| `quality`, `summary`, `decisions` | server (lebih baru bila `updatedAt` server > lokal) | kurasi terpusat |
| `usageStats`, `feedbackHistory` | lokal (di-merge append, cap 50) | telemetri lokal tidak boleh hilang |
| entry hanya ada di satu sisi | di-copy ke sisi lain (upsert by `id`, fallback `title`) | tidak ada delete propagation di v1 |

## Alur pull (di `setPersistCallback` / interval yang sama dengan push)

```
pull():
  resp = GET remoteUrl?since=lastEtag (timeout 5s)
  if 304 / empty → done
  for entry in resp.entries: MultiIndexRAG.updateEntry({id}, entry) atau index baru
  lastEtag = resp.etag → persist di StateStore namespace "rag" key "sync:etag"
```

## Config (tambahan ke `.agentic/config.json`, semua opsional)

```json
{
  "rag": {
    "remoteUrl": null,
    "remoteApiKey": null,
    "remoteBatchIntervalMs": 5000,
    "remoteSyncMode": "full",
    "remotePullEnabled": false,
    "remotePullIntervalMs": 30000
  }
}
```

Default `remotePullEnabled: false` → perilaku kini (one-way) tidak berubah.

## Verifikasi saat implementasi

1. Unit: konflik server-wins vs local-merge + 304 no-op + timeout fallback.
2. E2E mock: fake HTTP server push→pull round-trip.
3. `agentic_rag stats` konsisten sebelum/sesudah pull.
