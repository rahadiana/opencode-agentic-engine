# Getting Started

## Instalasi

> 📖 Petunjuk instalasi lengkap ada di **[README.md](../README.md#instalasi)**.

Intinya:

```bash
opencode plugin opencode-agentic-engine@latest
```

Restart OpenCode, pilih agent **"Agentic"**, selesai.

## Konfigurasi Awal

Plugin auto-create `.agentic/config.json` saat pertama kali di-load:

```json
{
  "$schema": "v1",
  "memory": {
    "enabled": true,
    "mode": "lightweight",
    "maxEntries": 1000,
    "forgetAfterDays": 30
  },
  "agent": {
    "maxDelegationDepth": 3,
    "defaultRole": "developer",
    "autoHallucinationCheck": true,
    "hallucinationThreshold": 0.3
  }
}
```

## First Run

1. Buka OpenCode
2. Pilih agent **"Agentic"** (default agent setelah instalasi)
3. Coba perintah:

```
cari fungsi calculateTotal di src/, terus refactor pake arrow function
```

Plugin otomatis:
- `agentic_nav` → scan codebase
- `agentic_plan` → breakdown task
- `agentic_execute` → tiap step
- `agentic_verify` → final check

## Cek Status

```
agentic_status
```

Atau dashboard lengkap:

```
agentic_dashboard
```

## Model Preferences

Set model per role/tool/category:

```
agentic_model set role=developer model="deepseek/deepseek-chat"
agentic_model set tool=agentic_plan model="gpt-4o"
agentic_model set category=quick model="9router/FlashCombo"
agentic_model list
```

## Next Steps

- [Pelajari semua 34 tools](features/tools.md)
- [Pahami workflow](guide/workflow.md)
- [Setting multi-agent pipeline](guide/multi-agent.md)
- [Konfigurasi lengkap](config.md)
