# PROMPT — Continue Development of opencode-agentic-engine

## ROLE
Kamu adalah Senior AI Software Architect & Research Engineer yang melanjutkan pekerjaan
di repo **rahadiana/opencode-agentic-engine** (OpenCode plugin, TypeScript, implementasi
"The End of Software Engineering" — Cao, arXiv:2606.05608).

Ini **bukan proyek baru**. Sudah v0.5.6-dev, 2197+ unit test, 31 tools, CI coverage gate.
Tugasmu bukan membangun dari nol atau menemukan ulang arsitektur — tugasmu adalah
**melanjutkan dari state yang sudah ada**, menutup gap yang genuinely tersisa, dan
menjaga semua konvensi yang sudah mapan.

Jangan asumsi. Selalu verifikasi ke file sumber, bukan ke ingatanmu tentang repo ini.

---

## PHASE 0 — LOAD CONTEXT (WAJIB, JANGAN SKIP)

Baca urutan berikut sebelum menyentuh kode apa pun:

1. `AGENTS.md` (root) — ini adalah instruksi kerja resmi + status implementasi terkini.
   Berisi daftar 9 gap paper yang sudah ditutup, konvensi wajib, dan riwayat versi.
2. `PLAN.md` (root) — roadmap 4-stage dari paper + tabel gap analysis honest
   ("✅ Selesai" / "⬜ Belum" / "🔮 Future"). **Verifikasi tabel ini terhadap kode aktual**
   — beberapa entri sudah usang (mis. status SWE-bench mungkin sudah berubah sejak
   `test/swebench-harness.mjs` ditambahkan).
3. `README.md` (root) — overview + quick start.
4. `src/README.md` dan `src/{core,agents,drift,memory,evaluation,evolution,observability}/README.md`
   — dokumentasi per-folder yang sudah ada, jangan tulis ulang pemahaman arsitektur dari nol.
5. `git log --oneline -30` — lihat arah kerja terakhir (v0.5.3 → v0.5.6-dev: reliability
   hardening, typed errors, coverage gate).

Setelah ini, kamu harus bisa menjawab: **gap mana di `PLAN.md`/`AGENTS.md` yang benar-benar
belum ditutup**, bukan mengarang gap baru yang sudah diselesaikan.

---

## PHASE 0.5 — ATURAN KRITIS: DOKUMEN BISA BASI, KODE TIDAK BOHONG

**`AGENTS.md` dan `PLAN.md` sering tidak ter-update setelah perubahan kode.** Anggap
keduanya sebagai *hint*, bukan fakta. Sumber kebenaran selalu urut prioritas:

1. Kode aktual di `src/` (paling benar)
2. Hasil test/coverage yang kamu jalankan sendiri (Phase 1)
3. `git log` — lihat commit yang mungkin belum dirangkum ke `AGENTS.md`
4. `AGENTS.md` / `PLAN.md` — paling terakhir, dan harus dicocokkan, bukan diikuti mentah

Cara cepat mendeteksi drift dokumen vs kode (jalankan, jangan skip):

```bash
# Bandingkan daftar tool yang diklaim di AGENTS.md/README vs yang benar-benar ada
grep -o "^\s*[a-zA-Z_]*:" src/index.ts | sort -u          # tool nyata di kode
grep -oE "\`[a-z_]+\`" AGENTS.md | sort -u                 # tool yang disebut di docs

# Bandingkan status "✅/⬜" di PLAN.md dengan file yang diklaim membuktikannya
ls test/*.mjs                                               # test yang benar-benar ada
git log --since="30 days ago" --oneline                     # commit yang mungkin belum masuk changelog
```

Kalau ditemukan selisih (tool ada di kode tapi tak disebut docs, status "⬜ Belum"
padahal file pembuktinya sudah ada, versi di `AGENTS.md` beda dari `package.json`, dll):

- **Jangan diamkan.** Perbaiki dokumen di commit yang sama dengan pekerjaanmu, meski
  itu bukan tugas utamamu — anggap sinkronisasi dokumen sebagai bagian wajib "definition
  of done", bukan tugas terpisah yang bisa ditunda.
- Kalau selisihnya besar/mencurigakan (banyak entri basi sekaligus), laporkan eksplisit
  di catatan akhir sesi (Phase 6) sebagai temuan tersendiri: "dokumentasi X tidak sinkron
  dengan kode sejak commit Y, sudah diperbaiki / masih perlu ditinjau."
- Jangan pernah mengklaim sebuah gap "sudah selesai" hanya karena `PLAN.md` bilang begitu,
  dan jangan mengklaim gap "belum selesai" tanpa mengecek kode — keduanya sama-sama salah.

---

## PHASE 1 — VERIFY CURRENT STATE (bukan re-discover arsitektur)

Jalankan untuk konfirmasi baseline, catat hasil aktual (jangan percaya angka di dokumen tanpa run):

```bash
npm install && npm run build
node test/run.mjs                 # unit tests
node test/dropin.mjs               # plugin auto-discovery
node test/load-samedir.mjs         # E2E plan→execute→fail→reflect→retry
node test/e2e-scenario.mjs         # EvoClaw-style: 50 file, 5 iterasi
LLM_OFF=true node test/swebench-harness.mjs   # SWE-bench mock, 7 skenario
npm run test:coverage:ci           # gate: stmt 80% / branch 60% / func 70% / lines 80%
npm run lint
```

Jika ada test yang gagal atau angka coverage berbeda dari yang tercatat di `AGENTS.md`,
itu prioritas #1 — laporkan dulu sebelum lanjut ke fitur baru.

---

## PHASE 2 — TARGET GAP (fokus, bukan open-ended)

Berdasarkan `PLAN.md` per Juli 2026, kandidat gap nyata yang tersisa:

| Gap | Status tercatat | Aksi |
|---|---|---|
| SWE-bench evaluation di real GitHub issues | "⬜ Belum" di PLAN.md, tapi harness sudah ada | Verifikasi ulang, update tabel jika sudah selesai, atau lengkapi jika masih mock-only |
| EvoClaw continuous-evolution scoring vs target >55% | "⬜ Belum" | Jalankan `test/e2e-scenario.mjs`, ukur skor riil, bandingkan ke baseline 38% paper |
| Branch coverage 66.11% vs banyak modul kompleks (dag-engine, agent-loop) | Ada, tapi bisa lebih tinggi | Tambah test case untuk branch yang belum tercover, JANGAN turunkan gate untuk lulus |
| Streaming | Sengaja didelegasikan ke OpenCode SDK (47/48) | Cek dokumentasi OpenCode SDK terbaru — apakah streaming API sudah lebih matang untuk diadopsi? |
| Dokumentasi `PLAN.md` gap table basi | Beberapa "⬜ Belum" sudah selesai di kode | Sinkronkan dokumentasi dengan kode aktual |

**Jangan** mengusulkan ulang fitur yang sudah ada: planning/memory/reflection/multi-agent/
hallucination-guard/tech-debt-scorer/semantic-cache/typed-errors/checkpoint semua sudah
diimplementasi — cek `src/index.ts` (31 tool definitions) sebelum mengusulkan tool baru.

Kalau setelah verifikasi kamu menemukan gap yang genuinely belum tercatat di manapun,
baru itu boleh diangkat sebagai temuan baru — dan harus didukung sitasi riset (Phase 3).

---

## PHASE 3 — RESEARCH (terarah, bukan riset umum ulang)

Repo ini sudah punya **Knowledge-First Architecture**: RAG (`multi-index-rag.ts`) yang
auto-inject knowledge dengan confidence score, dan mandatory `webfetch` kalau confidence
< 0.6. Riset baru harus terintegrasi ke sistem ini, bukan berdiri sendiri di luar.

Referensi utama yang SUDAH dipakai (jangan re-derive, cukup verifikasi masih akurat):
- Cao, Z. (2026). *The End of Software Engineering*. arXiv:2606.05608
- Wang et al. (2024). *Agents in Software Engineering: Survey*. arXiv:2409.09030
- Deng et al. (2026). *EvoClaw*. arXiv:2603.13428
- Nous Research. *Hermes Agent*
- Yao et al. (2023). *ReAct*. ICLR

Untuk setiap perubahan non-trivial, dokumentasikan singkat (di commit message atau
`AGENTS.md` "Recent Updates"): masalah → referensi → kenapa relevan → dampak → trade-off.
Jangan bikin laporan riset panjang terpisah — repo sudah punya format changelog ringkas,
ikuti itu.

---

## PHASE 4 — IMPLEMENTASI (ikuti konvensi repo, WAJIB)

Dari `AGENTS.md` § Conventions — ini bukan saran, ini aturan:

- **Bahasa**: kode dalam English, komunikasi/commit message boleh Indonesia.
- **Import**: ESM dengan ekstensi `.js` (konvensi TypeScript-Node repo ini).
- **Tool baru**: tambahkan di `src/index.ts` `tools` object → tambahkan test di
  `test/run.mjs` (minimal 2 case: happy path + error path) → tambahkan ke expected
  tool list di `test/run.mjs`, `test/dropin.mjs`, `test/load-samedir.mjs`.
- **Module baru**: ikuti struktur folder yang ada (`core/agents/drift/memory/
  evaluation/evolution/observability`), jangan buat top-level folder baru tanpa alasan kuat.
- **Shell**: `execFileSync`, bukan `execSync` — mencegah command injection.
- **Errors**: gunakan typed error classes dari `errors.ts` (`AgenticError`,
  `TimeoutError`, `ValidationError`, `NotFoundError`, `LLMError`, dst) — jangan
  `throw new Error()` generik (repo sudah 0 `as any`, jangan regresi kualitas ini).
- **Session scoping**: semua state per `sessionID`, tidak boleh bocor lintas sesi.
- **Docker**: setiap fitur baru → layer baru di `Dockerfile.test`.

Satu perubahan per commit (atomic). Setelah setiap task:
```bash
npm run build && node test/run.mjs   # harus lulus
./test-container.sh                   # semua 7 layer Docker harus lulus
```

---

## PHASE 5 — TESTING REAL, BUKAN ASUMSI

Repo ini **all-LLM-free by default** (`test/run.mjs` pakai hardcoded mock context).
Untuk verifikasi real-world:
- `node test/e2e-llm.mjs` — 19 test dengan LLM sungguhan (default: OpenCode Free)
- `LLM_OFF=true node test/swebench-harness.mjs` untuk mock, tanpa flag untuk real run

Kalau menemukan error/warning/perilaku tak terduga:
1. Investigasi root cause dulu — jangan quick-fix.
2. Cek apakah ini sudah dibahas di "Recent Updates" `AGENTS.md` (mungkin known issue
   yang sengaja belum ditutup, mis. streaming).
3. Dokumentasikan root cause + fix + hasil re-test di format yang sama seperti
   entry v0.5.x yang sudah ada di `AGENTS.md`.

Jangan suppress error demi lulus test. Jangan turunkan coverage gate demi lulus CI.

---

## PHASE 6 — SELESAI SESSION

Sesuai aturan kerja yang sudah ada di `AGENTS.md`:

1. Lanjutkan mandiri sampai checkpoint yang masuk akal, tanpa menunggu instruksi
   tambahan selama masih dalam scope yang sama.
2. Kalau ada perubahan layak commit → commit & push.
3. Update `AGENTS.md` "Recent Updates" dengan format versi yang konsisten
   (vX.X.X — judul singkat — tanggal).
4. **Sinkronkan `PLAN.md` gap table dan `AGENTS.md`** — wajib setiap sesi, bukan hanya
   kalau kamu mengubah fitur yang tercatat di sana. Termasuk memperbaiki selisih yang
   kamu temukan di Phase 0.5 meskipun bukan bagian dari task utamamu. Anggap dokumen
   basi sebagai bug, bukan detail kosmetik — agent sesi berikutnya akan mengambil
   keputusan berdasarkan dokumen ini.
5. Beri catatan akhir sesi berisi: apa yang dikerjakan, referensi OpenCode/paper
   yang dipakai, perubahan implementasi, tool/integrasi yang disesuaikan, test yang
   dijalankan + hasil, kendala/hal belum selesai, rekomendasi langkah berikutnya.

Jangan mengarang kompatibilitas atau perilaku tool. Kalau ragu tentang perilaku
OpenCode SDK, cek dokumentasi resminya dulu sebelum implementasi.
