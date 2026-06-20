# Comparison 09: Capability Search pakai Embedding + Vector DB

## Source
`MARKDOWN_PLAN/9 - upgrade capability search pakai embedding + vector DB.md` — Semantic search

## Inti Konsep
- Upgrade capability search dari **exact match → semantic search**
- Embedding via API (OpenAI text-embedding-3-small)
- Cosine similarity di JS (manual, no library needed)
- Threshold system: ≥ 0.75 match, else generate new skill
- Top-K search (k=3) dengan re-ranking: `(sim * 0.7) + (skill.score * 0.3)`
- Fallback: kalau score < threshold → generate new skill

## Yang Kita Punya
- **Vector Store** (`src/memory/vector-store.ts`): vector similarity search built-in.
- **Multi-Index RAG** (`src/memory/multi-index-rag.ts`): multi-category RAG dengan hybrid search.
- **Local Embedder** (`src/memory/local-embedder.ts`): API-based text embedding.
- **Semantic Cache** (`src/core/semantic-cache.ts`): TF-IDF + cosine similarity untuk LLM response cache.
- **Episodic Store** (`src/memory/episodic-store.ts`): cross-session memory.
- **TF-IDF** sudah ada di semantic-cache.ts.

## Gap
1. **⚠️ Embedding Integration dengan Skill** — Kita punya vector store tapi tidak terintegrasi langsung dengan skill lookup.
2. **❌ Capability-based Vector Index** — Vector index kita untuk RAG/episodic memory, bukan untuk skill capability search.
3. **❌ Re-ranking Formula** — Kita tidak punya formula `(sim * 0.7) + (skill.score * 0.3)` untuk skill selection.
4. **⚠️ Threshold System** — Kita punya confidence threshold di RAG, tapi tidak untuk skill matching.

## Kesimpulan
**Ini area yang kita sudah lumayan kuat.** Vector store, RAG, embedder kita sudah ada. Yang kurang adalah integrasi langsung ke skill lookup dengan re-ranking formula. Kita lebih unggul di infrastruktur search, tapi mereka lebih terintegrasi.

**Yang bisa kita adopsi:** re-ranking formula + threshold system untuk skill selection.
