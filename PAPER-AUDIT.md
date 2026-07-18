# Paper Audit — Implementasi vs Referensi Ilmiah

> **Dibuat**: 18 Juli 2026
> **Status**: Partial (9 dari ~20 paper diverifikasi)
> **Auditor**: Agentic assistant

---

## Ringkasan Eksekutif

Dari **9 paper** yang telah diverifikasi dengan membaca abstrak/PDF asli:

| Status | Jumlah |
|--------|--------|
| 🔴 Tidak sesuai (CRITICAL) | 6 |
| 🔴 Implementasi tidak lengkap (MAJOR) | 1 |
| 🟡 Simplifikasi wajar (MINOR) | 2 |

**Temuan utama**: Sebagian besar modul RAG mengklaim "berdasarkan paper X" di header file,
tapi implementasi aktualnya adalah **heuristic approximation** tanpa komponen inti paper
(RL training, NLI-MCTS, knowledge hypergraph, reflection tokens, dll).

---

## 1. 🔴 KbPO — `src/memory/rag-knowledge-boundary.ts`

**Paper**: *Trust Within? Seek Beyond? Knowledge Boundary Aware Policy Optimization for Agentic Search*
— Feng et al., ACL 2026 (arXiv: belum ditemukan, ACL Anthology ID: 2026.acl-long.1276)

### Klaim Header
> Berdasarkan paper: KbPO: Knowledge Boundary Policy Optimization (ACL, 2026)

### Isi Paper (dari abstrak & PDF)
KbPO adalah **Reinforcement Learning framework** yang berisi:
1. **Semantic stability metric** — dari internal hidden states LLM (Gram determinant of hidden representations)
2. **Four-quadrant taxonomy** — internal certainty vs retrieval quality
3. **Quadrant-based reward mechanism** — untuk RL training (GRPO/PPO)
4. **Iterative query evolution pipeline** — construct boundary-probing training samples
5. **10 benchmarks**, hasil: Qwen2.5-7B failure rate 32.6% vs Search-R1 44.1%

### Realita Implementasi
| Aspek | Paper | Kode |
|-------|-------|------|
| RL/GRPO training | ✅ Ya | ❌ Tidak ada — heuristic classification |
| Semantic stability metric | ✅ Internal states Gram determinant | ❌ Regex keyword counting ("mungkin", "saya pikir") |
| Reward mechanism | ✅ Quadrant-based RL reward | ❌ Tidak ada |
| Query evolution | ✅ Iterative pipeline | ❌ Tidak ada |
| 4-quadrant taxonomy | ✅ Internal HIGH/LOW × External HIGH/LOW | ✅ Sama, threshold 0.7/0.3 |

### Severitas: 🔴 CRITICAL
Mengimplementasikan < 10% dari paper. Hanya 4-quadrant taxonomy dan confidence
thresholding yang diadopsi. Inti paper (RL training, reward mechanism, semantic stability) tidak ada.

---

## 2. 🔴 EvoGraph-R1 — `src/memory/rag-mdp-retrieval.ts`

**Paper**: *EvoGraph-R1: Self-Evolving Multimodal Knowledge Hypergraphs for Agentic Retrieval*
— Lin et al., CVPR 2026 (arXiv:2607.12764)

### Klaim Header
> Berdasarkan paper: EvoGraph-R1 (CVPR, 2026): MDP dengan action GRAPHRETRIEVE, WEBSEARCH, GRAPHEDIT, ANSWER

### Isi Paper (dari PDF & CVPR Open Access)
1. **Multimodal knowledge hypergraph** sebagai environment state
2. MDP action space: **GraphRetrieve, WebSearch, GraphEdit, Answer**
3. **GRPO end-to-end optimization** untuk policy
4. Hypergraph **benar-benar berevolusi** — nodes/edges ditambah, dihapus, dimodifikasi
5. Multimodal (text + vision)
6. SOTA on multimodal VQA + text QA benchmarks

### Realita Implementasi
| Aspek | Paper | Kode |
|-------|-------|------|
| MDP action space | ✅ GraphRetrieve, WebSearch, GraphEdit, Answer | ✅ RETRIEVE, WEBSEARCH, GRAPHEDIT, DECOMPOSE, ANSWER (plus DECOMPOSE tambahan) |
| Knowledge graph sebagai state | ✅ Hypergraph dengan nodes/edges | ❌ `accumulatedEntries: IndexEntry[]` — flat array |
| GRPO training | ✅ End-to-end RL | ❌ Heuristic hard-coded thresholds |
| GraphEdit | ✅ Edit hypergraph structure | ❌ Hanya flag di action choice |
| Multimodal | ✅ Text + vision | ❌ Text-only |

### Severitas: 🔴 CRITICAL
Struktur MDP action space benar, tapi tidak ada hypergraph, tidak ada GRPO, tidak ada multimodal.
Yang ada hanyalah heuristic policy dengan flat array sebagai "graph".

---

## 3. 🔴 Self-Correcting RAG — `src/memory/rag-context-optimizer.ts`

**Paper**: *Self-Correcting RAG: Enhancing Faithfulness via MMKP Context Selection and NLI-Guided MCTS*
— Xu et al., ACL Findings 2026 (arXiv:2604.10734)

### Klaim Header
> Berdasarkan paper: Self-Correcting RAG (ACL Findings, 2026): MMKP (Multi-dimensional Multiple Choice Knapsack Problem)

### Isi Paper (dari PDF & ACL Anthology)
Framework **dua fase**:
1. **MMKP Context Selection** — formal multi-dimensional knapsack dengan token budget + **redundancy budget**
2. **NLI-Guided MCTS** — Natural Language Inference sebagai reward model, Monte Carlo Tree Search untuk
   explore reasoning trajectories. Branching factor k=3, max depth 3, contradiction penalty.

### Realita Implementasi
| Aspek | Paper | Kode |
|-------|-------|------|
| Fase 1: MMKP selection | ✅ Multi-dimensional knapsack | ⚠️ 1D greedy sort by value/token density |
| Redundancy budget | ✅ Explicit constraint C_red ≈ 120 | ❌ Hanya similarity threshold 0.6 |
| Token budget | ✅ Strict budget | ✅ Sama |
| Fase 2: NLI-MCTS | ✅ NLI reward + MCTS path exploration | ❌ **Tidak ada sama sekali** |

### Severitas: 🔴 MAJOR
Fase 1 diimplementasi dalam bentuk yang sangat disederhanakan (greedy 1D, bukan MMKP sejati).
**Fase 2 (NLI-Guided MCTS) tidak ada** — ini adalah kontribusi utama kedua paper.

---

## 4. 🟡 SCIM — `src/memory/rag-quality-scorer.ts`

**Paper**: *SCIM: Self-Correcting Iterative Mechanism for Retrieval-Augmented Generation*
— Li & Zhang, MDPI Electronics 2026 (doi: 10.3390/electronics15050996)

### Klaim Header
> Berdasarkan paper: SCIM (MDPI Electronics, 2026): 5-dimensi quality eval + degradation detection

### Isi Paper (dari MDPI)
1. Flan-T5-base **250M parameter**, no fine-tuning — lightweight LLM-based evaluator
2. **5-dimensi quality**: relevance, completeness, consistency, factuality, fluency
3. Adaptive retrieval based on quality deficits
4. **17.2% improvement** vs standard RAG (p < 0.01)
5. 35% queries converge in 1-2 iterations
6. Strong human correlation: Spearman = 0.842

### Realita Implementasi
| Aspek | Paper | Kode |
|-------|-------|------|
| 5 quality dimensions | ✅ relevance, completeness, consistency, factuality, fluency | ✅ Sama persis |
| Quality weights | ✅ relevance 0.25, factuality 0.25, completeness 0.20, consistency 0.20, fluency 0.10 | ✅ Sama |
| Quality scorer | ✅ LLM-based (Flan-T5 250M) | ❌ Heuristic (keyword overlap + rata-rata) |
| Iterative mechanism | ✅ 35% converge 1-2 iterasi | ❌ Tidak ada iterative loop |
| Human validation | ✅ Spearman = 0.842 | ❌ Tidak divalidasi |
| Staleness detection | ❌ Tidak ada di SCIM | ✅ **Tambahan plugin sendiri** |

### Severitas: 🟡 MINOR
5-dimensi quality diadopsi dengan baik termasuk bobot yang sesuai.
Tapi SCIM asli menggunakan LLM kecil (Flan-T5) untuk evaluasi, implementasi hanya
heuristic. Staleness detection adalah tambahan yang tidak ada di paper asli.

---

## 5. 🔴 Closed-Loop RAG — `src/memory/rag-feedback-loop.ts`

**Paper**: *Closed-Loop RAG Optimization System Based on User Feedback*
— Zhang, ITM Web Conferences 2026 (doi: 10.1051/itmconf/20268403024)

Juga merujuk: *Feedback Adaptation for Retrieval-Augmented Generation* (PatchRAG)
— Bang et al., ACL Findings 2026 (arXiv:2604.06647)

### Klaim Header
> Berdasarkan paper: Closed-Loop RAG (ITM Web, 2026): CFL + FCS + RGA
> PatchRAG (ACL Findings, 2026): feedback adaptation, correction lag

### Isi Paper Closed-Loop RAG
Tiga modul:
1. **CFL (Causal Feedback Labeling)** — "feedback-type → root-cause → optimization-strategy" lookup table
2. **FCS (Few-Shot Cold-Start)** — synthetic pseudo-feedback + active learning
3. **RGA (Retrieval-Generation Collaborative Adapter)** — cross-attention layers antara retriever dan generator
4. Hasil: 5.2 points F1 gain, 4.5 point hallucination drop

### Isi Paper PatchRAG
1. **Feedback adaptation** sebagai problem setting baru
2. **Correction lag + post-feedback performance** sebagai evaluation axes
3. **Training-free inference-time feedback integration**

### Realita Implementasi
| Aspek | Paper | Kode |
|-------|-------|------|
| CFL module | ✅ Causal feedback labeling | ❌ Tidak ada |
| FCS module | ✅ Few-shot cold-start | ❌ Tidak ada |
| RGA module | ✅ Cross-attention adapter | ❌ Tidak ada |
| PatchRAG | ✅ Training-free integration | ❌ Tidak ada |
| Feedback → quality update | ❌ (bukan kontribusi paper) | ✅ Yang diimplementasi |

### Severitas: 🔴 CRITICAL
"Feedback → update quality score" adalah konsep paling dasar yang bahkan tidak
disebut sebagai kontribusi paper. Ketiga modul utama paper (CFL, FCS, RGA)
**tidak ada implementasinya**. PatchRAG juga tidak diimplementasi.

---

## 6. 🔴 SPARKLE — `src/memory/rag-mdp-retrieval.ts` (referensi)

**Paper**: *SPARKLE: A Structured and Plug-and-play Agentic Retrieval Policy for Adaptive RAG Models*
— Fang et al., ACL 2026 (ACL Anthology ID: 2026.acl-long.1793)

### Klaim Header
> SPARKLE (ACL, 2026): proxy model + 3 agents (Retrieval Decision, Query Formulation, Knowledge Integration)

### Isi Paper
1. **Tiga agent**: Retrieval Decision Agent, Query Formulation Agent, Knowledge Integration Agent
2. **Proxy model lightweight** trained via RL (PPO)
3. **Binary tree-structured rollout** untuk eksplorasi RL
4. **KG-based reasoning chains** untuk identifikasi knowledge gaps
5. Plug-and-play — bisa ganti retriever/LLM tanpa retrain
6. 9.17% in-domain, 2.85% out-of-domain improvement

### Realita Implementasi
Disebut di header file sebagai referensi, tapi:

| Aspek | Paper | Kode |
|-------|-------|------|
| 3 specialized agents | ✅ Retrieval Decision, Query Formulation, Knowledge Integration | ❌ Single MDP policy heuristic |
| RL-trained proxy model | ✅ PPO optimization | ❌ Heuristic thresholds |
| Binary tree rollout | ✅ Structured exploration | ❌ Tidak ada |
| KG reasoning chains | ✅ Knowledge graph-based | ❌ Tidak ada |

### Severitas: 🔴 CRITICAL
SPARKLE **tidak diimplementasi**. Disebut di header comment sebagai referensi
tapi kode tidak mengandung satupun komponen spesifik SPARKLE.

---

## 7. 🔴 ConfidenceScorer — `src/core/confidence-scorer.ts`

**Paper**: *Agentic AI Software Engineers: Programming with Trust*
— Roychoudhury et al., 2025 (arXiv:2502.13767 | CACM 2026)

### Klaim Header
> Paper: Roychoudhury '25 — "Agentic AI Software Engineers: Programming with Trust"

### Isi Paper
Paper ini adalah **opinion piece** 5 halaman yang membahas trust barrier pada
AI software engineer. Satu-satunya kalimat tentang confidence scores:
> *"Providing AI generated code with confidence scores can reduce developer hesitation."*

Tidak ada:
- Dimensi scoring
- Bobot/weight
- Formula atau algoritma
- Implementasi apa pun

### Realita Implementasi
Tujuh dimensi dengan bobot presisi:
| Dimensi | Bobot |
|---------|-------|
| compileCheck | 0.25 |
| hallucinationCheck | 0.20 |
| semanticMatch | 0.15 |
| testPassRate | 0.15 |
| lintCheck | 0.10 |
| techDebtImpact | 0.10 |
| modelReliability | 0.05 |

### Severitas: 🔴 CRITICAL
**Paper tidak mengusulkan algoritma apa pun.** Seluruh sistem 7-dimensi scoring
dengan bobot presisi adalah buatan plugin sendiri. Klaim "berdasarkan paper"
menyesatkan — paper hanya menyebut confidence scores sebagai ide satu baris.

---

## 8. 🟡 Graph Harness — `src/core/dag-engine.ts`, `planning-layer.ts`, `execution-layer.ts`, `recovery-layer.ts`

**Paper**: *From Agent Loops to Structured Graphs: A Scheduler-Theoretic Framework for LLM Agent Execution*
— Hu Wei, 2026 (arXiv:2604.11378)

### Klaim Header
> Paper ref: arXiv:2604.11378 (Graph Harness) — DAG-based execution tracking

### Isi Paper
**Position paper / design proposal** — 51 halaman, tidak ada implementasi produksi.
Kutipan abstrak:
> *"This is a position paper and design proposal. We contribute a theoretical framework,
> a design analysis, and an experimental protocol—not a production implementation or empirical results."*

Tiga design commitment:
1. **Immutable execution plans** — plan version tidak bisa diubah selama eksekusi
2. **Three-layer separation** — planning, execution, recovery sebagai layer independen
3. **Bounded recovery protocol** — strict escalation protocol

### Realita Implementasi
| Aspek | Paper | Kode |
|-------|-------|------|
| 3-layer separation | ✅ Planning, execution, recovery | ✅ PlanningLayer, ExecutionLayer, RecoveryLayer |
| Immutable plan | ✅ Plan version immutable | ✅ Plan versioning di DAGEngine |
| Bounded recovery | ✅ Escalation protocol | ✅ Recovery dengan retry policy |
| Implementasi | ❌ Position paper — tidak ada | ✅ Produksi siap pakai |

### Severitas: 🟡 MINOR
Plugin mengikuti 3 prinsip desain paper dengan setia dan menyediakan implementasi
produksi yang paper-nya sendiri tidak miliki. Wajar, karena paper adalah position paper.

---

## 9. 🔴 Reflective RAG — `src/memory/rag-quality-scorer.ts` (referensi)

**Paper**: *Reflective RAG: Self-Evaluation Driven Strategy Optimization in Agentic RAG*
— Wu et al., ACL Findings 2026 (ACL Anthology ID: 2026.findings-acl.648)

### Klaim Header
> Reflective RAG (ACL Findings, 2026): self-evaluation signals

### Isi Paper
1. **Reflection tagging mechanism** — model generates reflection tokens untuk critique retrieval
2. **Two-stage training**: SFT untuk reflection signals, lalu RL untuk strategy optimization
3. **Dynamic KL regularization** selama RL
4. 5 knowledge-intensive QA benchmarks, outperform agentic baselines

### Realita Implementasi
| Aspek | Paper | Kode |
|-------|-------|------|
| Reflection tagging | ✅ Trained reflection tokens | ❌ Tidak ada |
| SFT + RL training | ✅ Two-stage | ❌ Tidak ada |
| Dynamic KL regularization | ✅ Stabilized RL | ❌ Tidak ada |
| Self-evaluation concept | ✅ Reflection-driven | ⚠️ `getRecommendation()` heuristic |

### Severitas: 🔴 CRITICAL
Disebut di header sebagai referensi tapi **tidak ada implementasi**.
Konsep "self-evaluation" diadopsi secara longgar lewat `getRecommendation()`
yang pure heuristic.

---

## Metodologi Audit

Untuk setiap paper:
1. Cari paper asli di jurnal/arXiv/ACL Anthology/CVF Open Access
2. Baca abstrak + PDF/notes untuk pahami kontribusi inti
3. Bandingkan kontribusi paper dengan implementasi di kode
4. Catat ketidaksesuaian per komponen

### Paper yang sudah diverifikasi (9):
| # | Paper | Venue | File |
|---|-------|-------|------|
| 1 | KbPO (Knowledge Boundary PO) | ACL 2026 | `rag-knowledge-boundary.ts` |
| 2 | EvoGraph-R1 | CVPR 2026 | `rag-mdp-retrieval.ts` |
| 3 | Self-Correcting RAG (MMKP+MCTS) | ACL Findings 2026 | `rag-context-optimizer.ts` |
| 4 | SCIM | MDPI Electronics 2026 | `rag-quality-scorer.ts` |
| 5 | Closed-Loop RAG (CFL+FCS+RGA) | ITM Web 2026 | `rag-feedback-loop.ts` |
| 6 | SPARKLE | ACL 2026 | `rag-mdp-retrieval.ts` |
| 7 | Roychoudhury '25 (Confidence) | arXiv/CACM 2025-26 | `confidence-scorer.ts` |
| 8 | Graph Harness (SGH) | arXiv 2026 | `dag-engine.ts` + 3 layer |
| 9 | Reflective RAG | ACL Findings 2026 | `rag-quality-scorer.ts` |

### Paper yang BELUM diverifikasi (~11):
| Paper | Venue | File |
|-------|-------|------|
| RouteRAG | ACL Findings 2026 | `rag-mdp-retrieval.ts` |
| ReflectRAG | Neurocomputing 2026 | `rag-quality-scorer.ts` |
| Auton (arXiv:2602.23720) | arXiv | `memory-orchestrator.ts`, `consolidation-scheduler.ts`, `constraint-manifold.ts` |
| STEM Agent (arXiv:2603.22359) | arXiv | `memory-orchestrator.ts`, `consolidation-scheduler.ts`, `constraint-manifold.ts`, `protocol-adapter.ts`, `mcp-server.ts` |
| OpenSage (arXiv:2602.16891) | arXiv | `memory-orchestrator.ts` |
| Memory in the LLM Era (arXiv:2604.01707) | arXiv | `second-brain.ts` |
| CraniMem (arXiv:2603.15642) | arXiv | `second-brain.ts` |
| AutoTool (arXiv:2511.14650) | arXiv | `tool-router.ts` |
| To Call or Not to Call (arXiv:2605.00737) | arXiv | `tool-router.ts` |
| Belief Memory (arXiv:2605.05583v2) | arXiv | `world-model.ts` |
| LLM-as-Code (arXiv:2606.15874) | arXiv | `dag-engine.ts` |

---

## Rekomendasi

1. **Koreksi header file** — Ubah klaim dari "Berdasarkan paper X" menjadi "Terinspirasi dari
   konsep paper X" atau "Mengadopsi taksonomi X dari paper Y" untuk yang memang sesuai.

2. **Implementasi riil** — Untuk paper yang kritis (KbPO, EvoGraph-R1, Self-Correcting RAG,
   Closed-Loop RAG), tambahkan implementasi komponen inti yang hilang:
   - KbPO: Tambah semantic stability metric atau ganti klaim
   - Self-Correcting RAG: Tambah NLI-Guided MCTS
   - Closed-Loop RAG: Tambah CFL/FCS/RGA modules

3. **Hapus referensi palsu** — Untuk ConfidenceScorer, ganti referensi paper opinion piece
   dengan justifikasi teknis sendiri.

4. **Lanjutkan audit** — Verifikasi ~11 paper yang belum dicek untuk completeness.
