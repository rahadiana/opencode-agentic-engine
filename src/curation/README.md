# curation/ — Skill Curation

## Fungsi

Memfilter dan mengkurasi skill yang diekstrak dari percakapan. Skill dengan kualitas rendah otomatis ditolak, skill bagus dipromosikan ke skill store.

## File

| File | Deskripsi |
|------|-----------|
| `skill-curator.ts` | SkillCurator class — quality gate untuk skill baru |

## Flow

```
Skill diekstrak → SkillCurator.curate()
  ├─ Validasi metadata (name, description)
  ├─ Validasi workflow steps
  ├─ Check success rate threshold
  └─ Jika lolos → simpan ke SkillStore
```

## Key Dependencies

- `memory/skill-store.ts` — penyimpanan skill yang sudah dikurasi
- `memory/skill-format.ts` — format/validasi schema skill
