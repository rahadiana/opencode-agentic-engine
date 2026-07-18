# Paper Audit — Implementasi vs Referensi Ilmiah

> **Dibuat**: 18 Juli 2026
> **Status**: ✅ **LENGKAP** — Seluruh 20 paper yang dirujuk plugin sudah diverifikasi
> **Auditor**: Agentic assistant

---

## Ringkasan Eksekutif

Dari **20 paper** yang telah diverifikasi dengan membaca abstrak/PDF asli:

| Status | Jumlah |
|--------|--------|
| 🔴 Tidak sesuai (CRITICAL) | 9 |
| 🔴 Implementasi tidak lengkap (MAJOR) | 1 |
| 🟡 Simplifikasi wajar (MINOR) | 8 |
| 🟢 Sesuai (ALIGNED) | 2 |

**Temuan utama**: 
- Sebagian besar modul RAG mengklaim "berdasarkan paper X" di header file,
  tapi implementasi aktualnya adalah **heuristic approximation** tanpa komponen inti paper
  (RL training, NLI-MCTS, knowledge hypergraph, reflection tokens, dll).
- Paper arsitektur umum (Auton, STEM Agent, Memory in the LLM Era) memiliki konsep yang
  lebih longgar — plugin mengimplementasikan ide serupa tanpa mengklaim implementasi langsung.
- Dua paper yang benar-benar sesuai: **Graph Harness** (posisi paper → implementasi setia) dan
  **LLM-as-Code** (prinsip inti diadopsi dengan tepat di DAG engine).

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

## 10. 🔴 RouteRAG — `src/memory/rag-mdp-retrieval.ts` (referensi)

**Paper**: *RouteRAG: Efficient Retrieval-Augmented Generation from Text and Graph via Reinforcement Learning*
— Guo et al., ACL Findings 2026 (arXiv:2512.09487, ACL ID: 2026.findings-acl.1502)

### Klaim Header
> RouteRAG (ACL Findings, 2026): RL-based multi-turn hybrid RAG, two-stage training

### Isi Paper
1. **RL-based framework** menggunakan GRPO (Group Relative Policy Optimization)
2. **Two-stage training**: Stage 1 = EM reward only, Stage 2 = add efficiency reward
3. **Graph-text hybrid retrieval**: adaptive switching antara text search dan knowledge graph
4. **Unified generation policy**: model learns when to reason, retrieve, and answer
5. **5 QA benchmarks**, outperforms prior multi-turn/graph-based RAG

### Realita Implementasi
| Aspek | Paper | Kode |
|-------|-------|------|
| RL/GRPO training | ✅ End-to-end GRPO | ❌ Heuristic thresholds |
| Two-stage training | ✅ Correctness → efficiency | ❌ Tidak ada |
| Graph-text hybrid | ✅ Adaptive text/graph retrieval | ❌ Hanya text |
| Unified generation policy | ✅ Single policy for all actions | ⚠️ MDP action space, tapi heuristic |
| Multi-turn reasoning | ✅ RL-driven adaptive | ❌ Fixed mode switching |

### Severitas: 🔴 CRITICAL
Header deskripsi paper akurat, tapi **0 komponen RouteRAG diimplementasi**.
GRPO, two-stage training, graph-text hybrid — semuanya tidak ada.
Yang ada hanyalah MDP action space yang sudah ada dari EvoGraph-R1.

---

## 11. 🔴 ReflectRAG — `src/memory/rag-quality-scorer.ts` (referensi)

**Paper**: *ReflectRAG: Enhancing Retrieval-Augmented Generation with GRPO-Optimized Iterative Reflection*
— Chen et al., Neurocomputing 2026 (doi: 10.1016/j.neucom.2026.134047)

### Klaim Header
> ReflectRAG (Neurocomputing, 2026): iterative reflection with GRPO

### Isi Paper
1. **Fact-based planning** — organize retrieved evidence into structured plan
2. **Iterative reflection module** — critiques and refines plans and answers
3. **GRPO optimization** — optimizes reflection module via RL
4. **Document re-ranking** — re-ranks retrieved documents
5. **+0.31 absolute F1** over base RAG on MS MARCO, TriviaQA, NQ

### Realita Implementasi
| Aspek | Paper | Kode |
|-------|-------|------|
| Iterative reflection | ✅ RL-optimized reflection loop | ❌ Tidak ada |
| GRPO optimization | ✅ Policy gradient for reflection | ❌ Tidak ada |
| Fact-based planning | ✅ Structured plan from evidence | ❌ Tidak ada |
| Document re-ranking | ✅ Re-ranking step | ❌ Tidak ada |
| Quality scoring | ❌ (bukan kontribusi paper) | ✅ Heuristic 5-dimensi (dari SCIM) |

### Severitas: 🔴 CRITICAL
ReflectRAG disebut sebagai referensi untuk "iterative reflection with GRPO",
tapi **tidak ada implementasi reflection module, GRPO, atau planning**.
5-dimensi quality scoring berasal dari SCIM, bukan ReflectRAG.

---

## 12. 🟡 Auton — `src/memory/memory-orchestrator.ts`, `consolidation-scheduler.ts`, `constraint-manifold.ts`

**Paper**: *The Auton Agentic AI Framework*
— Cao et al., 2026 (arXiv:2602.23720)

### Klaim Header
> Auton (arXiv:2602.23720): Hierarchical memory consolidation
> Auton (arXiv:2602.23720): Periodic consolidation with importance decay
> Auton (arXiv:2602.23720): cognitive blueprint with safety constraints

### Isi Paper (Framework Architecture Paper — bukan algorithm paper)
Auton adalah **framework architecture** (position paper) yang mendefinisikan:

1. **Cognitive Blueprint** — declarative agent specification (language-agnostic)
2. **Runtime Engine** — platform-specific execution substrate
3. **Augmented POMDP** — formal agent execution model
4. **Hierarchical memory consolidation** — biological episodic-inspired
5. **Constraint manifold** — safety via policy projection
6. **Three-level self-evolution** — in-context → fine-tuning → RL
7. **Parallel graph execution + speculative inference** — runtime optimizations

### Realita Implementasi
| Aspek | Paper | Kode |
|-------|-------|------|
| Hierarchical memory | ✅ 4-level working→episodic→semantic→procedural | ✅ 4-level hierarchy |
| Consolidation | ✅ Periodic, importance-based | ✅ Interval-based scheduler + importance decay |
| Constraint manifold | ✅ Safety via policy projection | ✅ ConstraintManifold class |
| Cognitive Blueprint | ✅ Declarative agent spec | ❌ Tidak ada |
| Augmented POMDP | ✅ Formal model | ❌ Tidak ada |
| Self-evolution | ✅ 3-level (in-context→FT→RL) | ⚠️ Hanya in-context (self-evolver.ts) |
| Parallel graph exec | ✅ DAG-based parallel | ✅ DAG with parallel phasing |

### Severitas: 🟡 MINOR
Auton adalah **framework architecture paper** (mirip Graph Harness), bukan algorithm
paper. Plugin mengimplementasikan beberapa konsep yang sama (hierarchical memory,
consolidation, constraint manifold) sebagai bagian dari arsitektur independennya.

Klaim "Dari riset: Auton" akurat sebagai inspirasi arsitektural — tidak ada klaim
implementasi langsung. Severitas ringan.

---

## 13. 🟡 STEM Agent — `memory-orchestrator.ts`, `consolidation-scheduler.ts`, `constraint-manifold.ts`, `protocol-adapter.ts`, `mcp-server.ts`

**Paper**: *STEM Agent: A Self-Adapting, Tool-Enabled, Extensible Architecture for Multi-Protocol AI Agent Systems*
— Shen & Shen, 2026 (arXiv:2603.22359)

### Klaim Header
> STEM Agent (arXiv:2603.22359): 4-type memory + consolidation
> STEM Agent (arXiv:2603.22359): Event-triggered + time-triggered consolidation
> STEM Agent (arXiv:2603.22359): multi-protocol safety gateway
> STEM Agent (arXiv:2603.22359): Multi-protocol gateway pattern

### Isi Paper
1. **Multi-protocol gateway** — unifies 5 protocols (A2A, AG-UI, A2UI, UCP, AP2)
2. **Caller Profiler** — learns user preferences across 20+ dimensions
3. **MCP externalization** — domain capabilities via MCP
4. **Skills acquisition system** — patterns crystallize into skills, maturation lifecycle
5. **Memory consolidation** — episodic pruning, semantic dedup, pattern extraction
6. **413-test validation suite**

### Realita Implementasi
| Aspek | Paper | Kode |
|-------|-------|------|
| Multi-protocol gateway | ✅ 5 protocols unified | ✅ A2A + MCP unified (protocol-adapter.ts) |
| MCP externalization | ✅ MCP for domain capabilities | ✅ MCP server exposes plugin tools |
| Caller Profiler | ✅ 20+ behavioral dimensions | ❌ Tidak ada |
| Skills maturation | ✅ Cell-differentiation lifecycle | ❌ Simple skill store (extract/find) |
| Memory consolidation | ✅ Episodic pruning + semantic dedup | ✅ Consolidation scheduler |
| 4-type memory | ✅ Working, episodic, semantic, procedural | ✅ Same 4-level hierarchy |

### Severitas: 🟡 MINOR
Multi-protocol gateway (A2A + MCP) genuinely mengikuti pola STEM Agent.
Memory consolidation dan 4-type memory juga selaras.

Tapi kontribusi unik STEM Agent (Caller Profiler, skills maturation lifecycle,
AG-UI/A2UI/UCP/AP2 protocols, 413-test suite) tidak diimplementasi.

Klaim "Dari riset: STEM Agent" akurat sebagai inspirasi arsitektural, bukan
klaim implementasi penuh.

---

## 14. 🟡 OpenSage — `src/memory/memory-orchestrator.ts` (referensi)

**Paper**: *OpenSage: Self-programming Agent Generation Engine*
— Li et al., 2026 (arXiv:2602.16891)

### Klaim Header
> OpenSage (arXiv:2602.16891): Graph-based hierarchical memory

### Isi Paper
1. **Self-programming agents** — LLMs auto-create agents with self-generated topology
2. **Auto-created sub-agents and toolkits** — agents create/manage their own sub-agents
3. **Hierarchical graph-based memory** — graph structure for efficient management
4. **SE task toolkit** — specialized for software engineering
5. **SOTA on 3 benchmarks** — outperforms existing ADKs

### Realita Implementasi
| Aspek | Paper | Kode |
|-------|-------|------|
| Self-programming agents | ✅ LLM creates agents & topologies | ❌ Tidak ada |
| Auto-created toolkits | ✅ Agents create own toolsets | ❌ Tidak ada |
| Graph-based hierarchical memory | ✅ Memory as graph structure | ❌ Linear 4-level hierarchy (working→episodic→semantic→procedural) |
| SE toolkit | ✅ Specialized for SE tasks | ❌ Tidak ada yang khusus |

### Severitas: 🟡 MINOR
Klaim "graph-based hierarchical memory" sangat longgar — OpenSage uses actual
graph structures for memory, plugin uses a linear 4-level pipeline.
Core innovation OpenSage (self-programming) tidak ada sama sekali.

Namun klaim hanya "OpenSage: Graph-based hierarchical memory" yang merupakan
deskripsi akurat dari paper — masalahnya implementasi plugin tidak graph-based.

---

## 15. 🟢 Memory in the LLM Era — `src/memory/second-brain.ts` (referensi)

**Paper**: *Memory in the LLM Era: Modular Architectures and Strategies in a Unified Framework*
— Wu et al., 2026 (arXiv:2604.01707)

### Klaim Header
> arXiv:2604.01707 (Memory in the LLM Era — unified memory framework)

### Isi Paper
**Survey paper** yang:
1. Merangkum unified framework untuk agent memory methods
2. Membandingkan representative methods pada 2 benchmarks
3. Mendesain memory method baru dari modul existing
4. Memberikan future research opportunities

### Realita Implementasi
| Aspek | Paper | Kode |
|-------|-------|------|
| Unified framework | ✅ Survey of existing methods | ⚠️ Plugin has its own architecture |
| Novel memory method | ✅ Kombinasi modul existing | ❌ Tidak mengadopsi method spesifik |
| Benchmark comparison | ✅ 2 benchmarks | ❌ Tidak ada |

### Severitas: 🟢 INFO/ALIGNED
Paper adalah **survey**, bukan proposal arsitektur spesifik. Referensi sebagai
"salah satu paper yang dijadikan referensi" adalah praktik yang wajar dan tidak
menyesatkan. Plugin tidak mengklaim implementasi dari paper ini.

---

## 16. 🟡 CraniMem — `src/memory/second-brain.ts` (referensi)

**Paper**: *CraniMem: Cranial Inspired Gated and Bounded Memory for Agentic Systems*
— Mody et al., ICLR 2026 Workshop (arXiv:2603.15642)

### Klaim Header
> arXiv:2603.15642 (CraniMem — hierarchical memory consolidation)

### Isi Paper
1. **Goal-conditioned gating** — memory access gated by current goal
2. **Utility tagging** — items tagged with utility scores
3. **Bounded episodic buffer** — for near-term continuity
4. **Structured long-term knowledge graph** — for durable semantic recall
5. **Scheduled consolidation loop** — replay high-utility → graph, prune low-utility
6. **Noise robustness** — robust to distractor content

### Realita Implementasi
| Aspek | Paper | Kode |
|-------|-------|------|
| Goal-conditioned gating | ✅ Goal-dependent memory access | ❌ Tidak ada |
| Utility tagging | ✅ Utility scores for items | ❌ Tidak ada (importance-based, bukan utility) |
| Bounded episodic buffer | ✅ Fixed-size near-term store | ❌ Tidak ada buffer terpisah |
| Knowledge graph | ✅ Structured long-term graph | ⚠️ Minimal adjacency list (entity-relation) |
| Consolidation loop | ✅ Scheduled replay + prune | ✅ Scheduler dengan prune |
| Noise robustness | ✅ Evaluated under injected noise | ❌ Tidak diuji |

### Severitas: 🟡 MINOR
Konsep umum "hierarchical memory consolidation" sama, tapi mekanisme spesifik
CraniMem (gating, utility tagging, bounded buffer, noise robustness) tidak ada.
Plugin punya scheduler consolidation (umum di banyak framework).

---

## 17. 🟡 AutoTool — `src/core/tool-router.ts` (inspirasi)

**Paper**: *AutoTool: Efficient Tool Selection for Large Language Model Agents*
— Jia & Li, AAAI 2026 (arXiv:2511.14650)

### Klaim Header
> Transition probability graph (AutoTool-inspired: arXiv:2511.14650)

### Isi Paper
1. **Tool usage inertia** — empirical observation: tool invocations follow predictable sequential patterns
2. **Directed graph** from historical trajectories — nodes = tools, edges = transition probabilities
3. **Parameter-level information** — refines tool input generation
4. **30% inference cost reduction** while maintaining task completion
5. **Graph traversal** — efficient tool/parameter selection without LLM

### Realita Implementasi
| Aspek | Paper | Kode |
|-------|-------|------|
| Tool usage inertia | ✅ Empirical finding | ✅ Transition tracking |
| Directed transition graph | ✅ Full graph from trajectories | ✅ Map<string, Map<string, number>> |
| Transition probability | ✅ Probability matrix | ✅ getTransitionProbability() |
| Parameter refinement | ✅ Input generation via graph | ❌ Tidak ada |
| 30% cost reduction | ✅ Empirical result | ❌ Tidak diukur |
| Graph traversal | ✅ Bypasses LLM inference | ❌ Hanya bonus score, LLM tetap dipakai |

### Severitas: 🟡 MINOR
Konsep tool usage inertia dan transition probability graph **genuinely diadopsi**.
Implementasi sederhana tapi faithful ke ide dasar paper.

Tapi komponen utama AutoTool (parameter-level refinement, graph traversal bypassing
LLM, 30% cost reduction) tidak ada.

Kode menggunakan label "AutoTool-inspired" yang akurat.

---

## 18. 🔴 To Call or Not to Call — `src/core/tool-router.ts` (referensi)

**Paper**: *To Call or Not to Call: A Framework to Assess and Optimize LLM Tool Calling*
— Wu et al., 2026 (arXiv:2605.00737)

### Klaim Header
> Anti-keyword penalty (arXiv:2605.00737 "To Call or Not to Call")

### Isi Paper
1. **Principled framework** — necessity, utility, affordability dimensions
2. **Normative + descriptive lens** — true need vs model's self-perceived need
3. **Lightweight estimators** from hidden states
4. **Controllers** for decision quality improvement
5. **6 open + 1 closed-source models** evaluated
6. **Misalignment finding** — perceived vs true need frequently misaligned

### Realita Implementasi
| Aspek | Paper | Kode |
|-------|-------|------|
| Necessity/utility/affordability | ✅ Three-factor framework | ❌ Tidak ada |
| Hidden state estimators | ✅ Lightweight probes | ❌ Tidak ada |
| Decision controllers | ✅ Quality improvement | ❌ Tidak ada |
| Anti-keyword penalty | ❌ (bukan kontribusi paper) | ✅ Simple regex penalty |

### Severitas: 🔴 CRITICAL
Kode punya fungsi `antiKeywordPenalty()` yang menambahkan penalti berdasarkan regex
— ini **sama sekali tidak ada hubungannya** dengan paper. Paper membahas framework
sofistikated dengan hidden state estimators dan decision-making theory.

Referensi ini sangat menyesatkan: anti-keyword penalty adalah heuristic sederhana
yang tidak disebut dalam paper.

---

## 19. 🟡 Belief Memory — `src/core/world-model.ts` (inspirasi)

**Paper**: *Belief Memory: Agent Memory Under Partial Observability*
— Liao et al., 2026 (arXiv:2605.05583v2)

### Klaim Header
> Belief Memory: Agent Memory Under Partial Observability (arXiv:2605.05583v2)

### Isi Paper
1. **Multiple candidate conclusions** per observation — not single deterministic conclusion
2. **Noisy-OR probability update** — probabilities updated as new observations arrive
3. **Preserved uncertainty** — alternatives visible to agent, avoids self-reinforcing error
4. **Empirical evaluation** — LoCoMo, ALFWorld benchmarks, SOTA average

### Realita Implementasi
| Aspek | Paper | Kode |
|-------|-------|------|
| Multiple candidates | ✅ Separate entries with probabilities | ❌ Single deterministic belief per key |
| Noisy-OR update | ✅ Probabilistic update rule | ❌ Simple decay (×0.98) + conflict penalty |
| Uncertainty preservation | ✅ Alternatives visible | ❌ Single conclusion, uncertainty lost |
| Confidence scoring | ✅ Probability [0,1] | ✅ Confidence [0,1] |
| Evidence provenance | ✅ Source tracking | ✅ BeliefEvidence[] with source, supports |

### Severitas: 🟡 MINOR
Keduanya tentang "belief with confidence" — tapi **mekanisme fundamentalnya
berlawanan**. BeliefMem menyimpan BANYAK kandidat, plugin hanya SATU.
BeliefMem pakai Noisy-OR, plugin pakai decay factor.

Namun referensi wajar sebagai inspirasi tingkat tinggi: keduanya externalize
belief state dengan confidence dan evidence tracking.

---

## 20. 🟢 LLM-as-Code — `src/core/dag-engine.ts` (prinsip)

**Paper**: *LLM-as-Code: Agentic Programming for Agent Harness*
— Qi et al., KDD 2026 Workshop (arXiv:2606.15874)

### Klaim Header
> LLM-as-Code (arXiv:2606.15874): "LLM should NOT be the orchestrator"

### Isi Paper
1. **Agentic Programming** — program governs ALL control flow
2. **LLM-as-Code** — LLM invoked only for reasoning/generation, not orchestration
3. **DAG-based context** — call tree from execution history
4. **Context length determined by depth** — not accumulation over steps
5. **Computer-use case study** — practical stability improvement

### Realita Implementasi
| Aspek | Paper | Kode |
|-------|-------|------|
| Program controls flow | ✅ DAG orchestrates execution | ✅ DAGEngine controls node execution |
| LLM not orchestrator | ✅ LLM only for reasoning | ✅ "LLM cuma dipanggil per-node sebagai reasoning engine, BUKAN sebagai orchestrator" |
| DAG-based context | ✅ Call tree = DAG | ✅ DAG dengan dependensi |
| Context by depth | ✅ Depth-based, not cumulative | ⚠️ Tidak secara eksplisit, tapi natural dari DAG |
| Agentic Programming | ✅ Formal paradigm | ⚠️ Konsep diadopsi via DAG |

### Severitas: 🟢 ALIGNED
Prinsip inti paper diadopsi dengan tepat dan eksplisit. DAG engine comment
menyatakan filosofi yang sama. Ini adalah salah satu dari sedikit paper yang
implementasinya benar-benar sesuai dengan klaim.

---

## Metodologi Audit

Untuk setiap paper:
1. Cari paper asli di jurnal/arXiv/ACL Anthology/CVF Open Access
2. Baca abstrak + PDF/notes untuk pahami kontribusi inti
3. Bandingkan kontribusi paper dengan implementasi di kode
4. Catat ketidaksesuaian per komponen

### Semua paper yang diverifikasi (20):

| # | Paper | Venue | File | Status |
|---|-------|-------|------|--------|
| 1 | KbPO (Knowledge Boundary PO) | ACL 2026 | `rag-knowledge-boundary.ts` | 🔴 CRITICAL |
| 2 | EvoGraph-R1 | CVPR 2026 | `rag-mdp-retrieval.ts` | 🔴 CRITICAL |
| 3 | Self-Correcting RAG (MMKP+MCTS) | ACL Findings 2026 | `rag-context-optimizer.ts` | 🔴 MAJOR |
| 4 | SCIM | MDPI Electronics 2026 | `rag-quality-scorer.ts` | 🟡 MINOR |
| 5 | Closed-Loop RAG (CFL+FCS+RGA) | ITM Web 2026 | `rag-feedback-loop.ts` | 🔴 CRITICAL |
| 6 | SPARKLE | ACL 2026 | `rag-mdp-retrieval.ts` | 🔴 CRITICAL |
| 7 | Roychoudhury '25 (Confidence) | arXiv/CACM 2025-26 | `confidence-scorer.ts` | 🔴 CRITICAL |
| 8 | Graph Harness (SGH) | arXiv 2026 | `dag-engine.ts` + 3 layer | 🟡 MINOR |
| 9 | Reflective RAG | ACL Findings 2026 | `rag-quality-scorer.ts` | 🔴 CRITICAL |
| 10 | RouteRAG | ACL Findings 2026 | `rag-mdp-retrieval.ts` | 🔴 CRITICAL |
| 11 | ReflectRAG | Neurocomputing 2026 | `rag-quality-scorer.ts` | 🔴 CRITICAL |
| 12 | Auton | arXiv 2026 | `memory-orchestrator.ts` + 2 | 🟡 MINOR |
| 13 | STEM Agent | arXiv 2026 | 5 files | 🟡 MINOR |
| 14 | OpenSage | arXiv 2026 | `memory-orchestrator.ts` | 🟡 MINOR |
| 15 | Memory in the LLM Era (survey) | arXiv 2026 | `second-brain.ts` | 🟢 ALIGNED |
| 16 | CraniMem | ICLR Workshop 2026 | `second-brain.ts` | 🟡 MINOR |
| 17 | AutoTool | AAAI 2026 | `tool-router.ts` | 🟡 MINOR |
| 18 | To Call or Not to Call | arXiv 2026 | `tool-router.ts` | 🔴 CRITICAL |
| 19 | Belief Memory | arXiv 2026 | `world-model.ts` | 🟡 MINOR |
| 20 | LLM-as-Code | KDD Workshop 2026 | `dag-engine.ts` | 🟢 ALIGNED |

---

## Rekomendasi

### Prioritas Tinggi (menyesatkan pengguna)

1. **🔴 Hapus/ubah referensi palsu** — 3 paper yang referensinya sangat menyesatkan:
   - `tool-router.ts` baris 277 — Hapus referensi `arXiv:2605.00737` dari `antiKeywordPenalty()`
     karena anti-keyword penalty tidak ada hubungannya dengan paper "To Call or Not to Call"
   - `confidence-scorer.ts` — Ganti referensi Roychoudhury '25 (opinion piece) dengan justifikasi
     teknis sendiri: "7-dimensi confidence scoring dengan bobot berdasarkan pengembangan internal"
   - `rag-quality-scorer.ts` header — Referensi Reflective RAG dan ReflectRAG harus diubah
     atau dihapus karena 0% komponen paper diimplementasi

2. **🔴 Koreksi header "Berdasarkan paper" jadi "Terinspirasi dari"** — Untuk:
   - `rag-knowledge-boundary.ts` — Ubah jadi "Mengadopsi 4-quadrant taxonomy dari KbPO"
   - `rag-mdp-retrieval.ts` — Ubah jadi "MDP action space terinspirasi dari EvoGraph-R1"
   - `rag-feedback-loop.ts` — Ubah jadi "Feedback update mechanism (konsep umum, bukan implementasi Closed-Loop RAG)"
   - `rag-context-optimizer.ts` — Ubah jadi "MMKP-inspired greedy selection (tanpa NLI-MCTS)"
   - `rag-quality-scorer.ts` — SCIM reference ok, tapi Reflective RAG & ReflectRAG harus dihapus

3. **🟡 Review referensi arsitektural** — Untuk Auton, STEM Agent, OpenSage, CraniMem:
   - Ubah "Dari riset:" menjadi "Terinspirasi secara arsitektural dari:" untuk membedakan
     dengan paper yang implementasinya setia

### Prioritas Sedang (perbaikan implementasi)

4. **Tambahkan komponen inti yang hilang** untuk paper yang paling mungkin diimplementasi:
   - `tool-router.ts` — AutoTool: parameter-level refinement dari transition graph
   - `rag-context-optimizer.ts` — NLI-Guided MCTS: bisa diimplementasi sebagai optional mode
   - `rag-feedback-loop.ts` — Closed-Loop CFL: feedback-type → root-cause lookup table (sederhana)

### Prioritas Rendah (dokumentasi)

5. **Dokumentasikan perbedaan** di JSDoc masing-masing file:
   - "Paper asli menggunakan RL/GRPO, implementasi ini menggunakan heuristic approximation"
   - Untuk AutoTool: "Hanya konsep transition probability yang diadopsi, tanpa graph traversal"
   - Untuk Belief Memory: "Plugin menggunakan single belief, BeliefMem menggunakan multiple candidates"

6. **Audit selesai** — Seluruh 20 paper yang dirujuk oleh plugin sudah diverifikasi.
   Tidak ada paper tersisa yang perlu dicek.
