# Comparison 21: Autonomous Goal Generation + Curiosity System

## Source
`MARKDOWN_PLAN/21 - autonomous goal generation + curiosity system.md` — Intrinsic motivation

## Inti Konsep
- **Curiosity Engine**: hitung curiosity dari uncertainty (belief rendah) + novelty (entity baru) + prediction error
- **Goal Generator**: jika curiosity > threshold → generate goals untuk explore gaps
- **Goal Queue**: priority-sorted, dengan source "external" atau "curiosity"
- **Goal Manager agent**: priority 4, jalan tiap cycle
- **Safety**: MAX_GOALS = 20, CURIOSITY_THRESHOLD = 2, dedupe, decay
- **Completion handling**: mark done → select next

## Yang Kita Punya
- **Router Agent** (`src/core/router-agent.ts`): intent classification.
- **Intent Parser** (`src/core/intent-parser.ts`): parse user intent → Plan structure.
- **Task Classifier** (`src/core/task-classifier.ts`): task type classification.
- **Self Evolver** (`src/evolution/self-evolver.ts`): agent prompt evolution.

## Gap
1. **❌ Curiosity Engine** — Tidak ada mekanisme "rasa ingin tahu" yang mendorong eksplorasi.
2. **❌ Autonomous Goal Generation** — Semua goal datang dari user input. Agent tidak punya inisiatif sendiri.
3. **❌ Goal Queue** — Tidak ada priority queue untuk multiple goals.
4. **❌ Intrinsic Motivation** — Tidak ada sistem reward internal untuk exploration.
5. **❌ Goal Manager** — Tidak ada agent khusus yang manage goals.

## Kesimpulan
**Autonomous goal generation adalah Stage V concept (fully autonomous) yang kita belum implement.** Kita masih Stage I-IV. Ini terlalu advanced untuk masalah tool calling effectiveness saat ini. Tapi menarik untuk future roadmap.
