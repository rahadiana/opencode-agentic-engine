# curation/ — Skill Curation

## Fungsi

Lifecycle + kualitas skill: inject ke prompt, mark stale, archive, handle negative feedback.

## File

| File | Deskripsi |
|------|-----------|
| `skill-curator.ts` | SkillCurator — lifecycle + auto-injection ke system prompt |

## Flow

```
Skill extract (execute / skill tool)
  → SkillStore
  → Curator: inject top-N by relevance (TF-IDF vs goal)
  → periodic applyLifecycle() (stale / archive)
  → negative feedback → handleNegativeFeedback
```

Config: `config.curator.*` (enabled, staleAfterDays, maxSkillsInPrompt, injectThreshold, …).

## Key Dependencies

- `memory/skill-store.ts` — storage
- `memory/skill-security.ts` — scan saat import SKILL.md eksternal (bukan curator, tapi pipeline skill)
- `core/prompt-builder.ts` — inject curated skills ke system prompt
