# Troubleshooting

## Common Issues

### Tool not found

```
Error: Tool "plan" not found. Available: agentic_plan, agentic_execute...
```

**Fix:** Gunakan prefix `agentic_`. Semua tool pakai `agentic_` prefix.

```
✗ plan goal="..."
✓ agentic_plan goal="..."
```

### Build errors

```
tsc: error TS2304: Cannot find module './core/error-recovery.js'
```

**Fix:** Pastikan file ada dan path benar. ESM require `.js` extension.

```bash
npm run build
```

### LLM calls hanging

```
LLM call timed out after 120s
```

**Fix:**
1. Cek koneksi internet
2. Cek API key provider
3. Coba model lain: `agentic_model set tool=agentic_plan model="gpt-4o"`

### Memory not working

```
agentic_episodes search query="..." → return empty
```

**Fix:**
1. Cek `.agentic/config.json` → `memory.enabled: true`
2. Pastikan sudah ada task sukses (memory terisi otomatis)
3. Cek mode: `lightweight` tidak pakai embedding, `full` butuh endpoint

### Dashboard tidak show Gap sections

**Fix:** Gap #5/#10/#11 sections muncul setelah plugin di-reload (sesi baru). Build dulu:

```bash
npm run build
```

Kemudian restart agent sesi.

### Agent loop runaway

```
agentic_auto → stuck di loop retry
```

**Fix:** Set budget limits:

```
agentic_budget set maxSteps=10 maxTimeMs=300000
```

### Model reliability degraded

```
Dashboard: ❌ gpt-4o — reliability: 0%, calls: 5 (quarantined)
```

**Fix:** Reset stats:

```
agentic_model action="reset" model="gpt-4o"
```

### Pipeline stage gagal

**Fix:** Cek inter-agent messages untuk review details:

```
agentic_message action="inbox"
```

### Test failures

```bash
# Run all tests
node test/run.mjs

# Specific gap tests
node test/run.mjs | grep "GAP #5"
```

## Debug Mode

Trace log tersimpan di `.agentic/trace.jsonl`:

```bash
tail -f .agentic/trace.jsonl | jq .
```

## FAQ

**Q: Plugin tidak muncul di agent list?**
A: Cek `~/.cache/opencode/packages/` — pastikan package ter-copy dengan benar.

**Q: Bisa pake model local?**
A: Bisa, set endpoint di config atau via `agentic_model`.

**Q: Gimana cara add custom tool?**
A: Tambah di `src/index.ts` → `tools` object, daftarin di `TOOL_REGISTRY`, tambah test.

**Q: Data memory disimpan dimana?**
A: SQLite (default) atau JSON files di `.agentic/`.

**Q: Apa bedanya agentic_auto sama manual flow?**
A: `agentic_auto` = satu call: plan → execute → verify → retry → score. Manual = panggil tiap tool satu-satu.
