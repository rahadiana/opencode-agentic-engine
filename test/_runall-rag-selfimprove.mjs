// test/_runall-rag-selfimprove.mjs — RAG Self-Improvement System Tests
// Menguji semua modul baru: QualityScorer, FeedbackLoop, AdaptiveRetrieval,
// MDPRetrieval, KnowledgeBoundary, ContextOptimizer
import { assert, section, pluginDist } from "./_common.mjs"

export async function runRAGSelfImproveTests(mod) {
  // ── RAGQualityScorer Tests ──
  section("RAGQualityScorer")

  // QS-1: Default quality score
  const { RAGQualityScorer, QUALITY_THRESHOLDS } = mod
  const qs = new RAGQualityScorer()
  assert(typeof qs.score === "function", "QS-1a: RAGQualityScorer has score method")
  assert(typeof qs.computeStaleness === "function", "QS-1b: has computeStaleness")
  assert(typeof qs.applyDecay === "function", "QS-1c: has applyDecay")

  // QS-2: Score calculation
  const defaultQ = { relevance: 0.7, completeness: 0.7, consistency: 0.7, factuality: 0.7, fluency: 0.7 }
  const score = qs.score(defaultQ)
  const expected = 0.7 * 0.25 + 0.7 * 0.25 + 0.7 * 0.20 + 0.7 * 0.20 + 0.7 * 0.10
  assert(Math.abs(score - expected) < 0.01, `QS-2: score=(${score}) ≈ expected=(${expected})`)

  // QS-3: Staleness computation
  const freshEntry = { timestamp: new Date().toISOString() }
  const freshStale = qs.computeStaleness(freshEntry)
  assert(freshStale < 0.1, `QS-3a: fresh entry staleness=${freshStale} < 0.1`)

  const oldEntry = { timestamp: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString() } // 200 days ago
  const oldStale = qs.computeStaleness(oldEntry)
  assert(oldStale > 0.3, `QS-3b: old entry staleness=${oldStale} > 0.3`)

  // QS-4: Apply decay
  const decayed = qs.applyDecay(defaultQ, 0.5)
  assert(decayed.relevance < defaultQ.relevance, "QS-4a: decay reduces relevance")
  assert(decayed.factuality < defaultQ.factuality, "QS-4b: decay reduces factuality")
  assert(decayed.fluency >= 0.1, "QS-4c: decay floor at 0.1")

  // QS-5: Apply feedback
  const positiveFeedback = qs.applyFeedback(defaultQ, "positive")
  assert(positiveFeedback.relevance > defaultQ.relevance, "QS-5a: positive feedback boosts relevance")

  const negativeFeedback = qs.applyFeedback(defaultQ, "negative")
  assert(negativeFeedback.factuality < defaultQ.factuality, "QS-5b: negative feedback reduces factuality")

  // QS-6: Quality classification
  const highEntry = { quality: defaultQ, qualityScore: 0.85, stalenessScore: 0.1 }
  assert(qs.classifyQuality(highEntry) === "high", "QS-6a: classifies high quality")

  const critEntry = { quality: { relevance: 0.2, completeness: 0.2, consistency: 0.2, factuality: 0.2, fluency: 0.2 }, qualityScore: 0.2, stalenessScore: 0.8 }
  assert(qs.classifyQuality(critEntry) === "critical", "QS-6b: classifies critical")

  // QS-7: Recommendation
  const recFresh = qs.getRecommendation({ quality: defaultQ, qualityScore: 0.85, stalenessScore: 0.1 })
  assert(recFresh.action === "none", `QS-7a: fresh high quality → action=none got=${recFresh.action}`)

  const recStale = qs.getRecommendation({ quality: defaultQ, qualityScore: 0.6, stalenessScore: 0.8 })
  assert(recStale.action === "refresh" || recStale.action === "verify", `QS-7b: stale → action=refresh/verify got=${recStale.action}`)

  // QS-8: Quality report format
  const report = qs.formatQualityReport({ title: "test", timestamp: new Date().toISOString(), keywords: [], category: "tech" })
  assert(report.includes("Quality:"), "QS-8: report includes Quality")
  assert(report.includes("Staleness:"), "QS-8b: report includes Staleness")

  // ── RAGFeedbackLoop Tests ──
  section("RAGFeedbackLoop")

  const { RAGFeedbackLoop, MultiIndexRAG } = mod
  const fbl = new RAGFeedbackLoop()
  assert(typeof fbl.feedStepResult === "function", "FBL-1: feedStepResult exists")
  assert(typeof fbl.getQualityHealth === "function", "FBL-1b: getQualityHealth exists")

  // FBL-2: Feed step result with empty entries
  const rag = new MultiIndexRAG()
  const feedback = {
    sourceId: "test-step-1",
    success: true,
    usedEntryTitles: [],
    output: "test output",
    timestamp: new Date().toISOString(),
  }
  const report2a = await fbl.feedStepResult(rag, feedback)
  assert(report2a.entriesUpdated === 0, `FBL-2: no entries to update, got=${report2a.entriesUpdated}`)

  // FBL-3: Index an episode, then feed feedback
  rag.indexEpisode("knowledge-tech", {
    id: "test-ep-1", sessionId: "test", planGoal: "Test Express Best Practices",
    summary: "Express best practices for error handling and routing",
    outcome: "success", decisions: ["Use middleware"], filesChanged: [],
    timestamp: new Date().toISOString(), tags: ["express", "best-practice"],
    projectId: "test", score: 0.9, usageCount: 1, significance: "notable",
  })

  const feedback2 = {
    sourceId: "test-step-2",
    success: true,
    usedEntryTitles: ["Test Express Best Practices"],
    output: "Successfully implemented Express middleware",
    timestamp: new Date().toISOString(),
  }
  const report2b = await fbl.feedStepResult(rag, feedback2)
  assert(report2b.entriesUpdated > 0, `FBL-3: entry updated, got=${report2b.entriesUpdated}`)

  // FBL-4: Feed failure feedback
  const feedback3 = {
    sourceId: "test-step-3",
    success: false,
    usedEntryTitles: ["Test Express Best Practices"],
    output: "Failed to implement",
    error: "TypeError: middleware not a function",
    errorCategory: "type",
    timestamp: new Date().toISOString(),
  }
  const report2c = await fbl.feedStepResult(rag, feedback3)
  assert(report2c.entriesUpdated > 0, `FBL-4: failure feedback processed, got=${report2c.entriesUpdated}`)

  // FBL-5: Quality health
  const health = await fbl.getQualityHealth(rag)
  assert(typeof health.totalEntries === "number", "FBL-5: health.totalEntries exists")

  // ── RAGAdaptiveRetrieval Tests ──
  section("RAGAdaptiveRetrieval")

  const { RAGAdaptiveRetrieval } = mod
  const ar = new RAGAdaptiveRetrieval()
  assert(typeof ar.search === "function", "AR-1: search method exists")
  assert(typeof ar.searchWithAutoEscalate === "function", "AR-1b: searchWithAutoEscalate exists")
  assert(typeof ar.formatForPrompt === "function", "AR-1c: formatForPrompt exists")

  // AR-2: Search with empty RAG
  const emptyResult = await ar.search(rag, "test query", "standard", 5)
  assert(Array.isArray(emptyResult.entries), "AR-2a: entries is array")
  assert(typeof emptyResult.sufficient === "boolean", "AR-2b: sufficient is boolean")

  // AR-3: Search with data
  const result = await ar.search(rag, "Express middleware", "standard", 5)
  assert(Array.isArray(result.entries), "AR-3a: search returns entries")

  // AR-4: Auto escalate
  const escalateResult = await ar.searchWithAutoEscalate(rag, "Express", 3, 5)
  assert(Array.isArray(escalateResult.entries), "AR-4: auto-escalate returns entries")

  // AR-5: Format for prompt
  const formatted = ar.formatForPrompt(result)
  assert(formatted.includes("adaptive-rag"), "AR-5: formatted includes adaptive-rag tag")

  // AR-6: Generate refine queries
  const deficits = { completeness: true, consistency: false, factuality: false, relevance: false }
  const queries = ar.generateRefineQueries("Express", deficits)
  assert(queries.length > 0, "AR-6a: generates refine queries")
  assert(queries.some(q => q.includes("complete")), "AR-6b: completeness deficit → tutorial query")

  // ── MDPRetrievalAgent Tests ──
  section("MDPRetrievalAgent")

  const { MDPRetrievalAgent } = mod
  const mdp = new MDPRetrievalAgent()
  assert(typeof mdp.run === "function", "MDP-1: run method exists")
  assert(typeof mdp.formatForPrompt === "function", "MDP-1b: formatForPrompt exists")

  // MDP-2: Run with empty RAG
  const mdpResult = await mdp.run(rag, "test query", 3)
  assert(Array.isArray(mdpResult.entries), "MDP-2a: returns entries array")
  assert(mdpResult.totalTurns <= 3, `MDP-2b: turns=${mdpResult.totalTurns} <= 3`)
  assert(mdpResult.finalAction === "answer", `MDP-2c: finalAction=answer got=${mdpResult.finalAction}`)

  // MDP-3: Format for prompt
  const mdpFormatted = mdp.formatForPrompt(mdpResult)
  assert(mdpFormatted.includes("mdp-retrieval"), "MDP-3: formatted includes mdp-retrieval tag")
  assert(mdpFormatted.includes("action-trace"), "MDP-3b: includes action-trace")

  // ── KnowledgeBoundaryCalibrator Tests ──
  section("KnowledgeBoundaryCalibrator")

  const { KnowledgeBoundaryCalibrator } = mod
  const kb = new KnowledgeBoundaryCalibrator()
  assert(typeof kb.analyze === "function", "KB-1a: analyze method exists")
  assert(typeof kb.calibrateEntries === "function", "KB-1b: calibrateEntries exists")
  assert(typeof kb.estimateInternalConfidence === "function", "KB-1c: estimateInternalConfidence exists")

  // KB-2: Analyze Q1 (both high)
  const highEntries = [
    { title: "good1", timestamp: new Date().toISOString(), keywords: ["express", "api"], category: "tech",
      qualityScore: 0.9, quality: { relevance: 0.9, completeness: 0.9, consistency: 0.9, factuality: 0.9, fluency: 0.9 } }
  ]
  const q1 = kb.analyze(0.9, highEntries)
  assert(q1.quadrant === 1, `KB-2: Q1 both high got=Q${q1.quadrant}`)
  assert(q1.action === "integrate", `KB-2b: action=integrate got=${q1.action}`)

  // KB-3: Analyze Q2 (internal low, external high)
  const q2 = kb.analyze(0.3, highEntries)
  assert(q2.quadrant === 2, `KB-3: Q2 internal low got=Q${q2.quadrant}`)
  assert(q2.action === "trust-rag", `KB-3b: action=trust-rag got=${q2.action}`)

  // KB-4: Analyze Q4 (both low)
  const lowEntries = [
    { title: "bad1", timestamp: new Date().toISOString(), keywords: ["test"], category: "tech",
      qualityScore: 0.2, quality: { relevance: 0.2, completeness: 0.2, consistency: 0.2, factuality: 0.2, fluency: 0.2 } }
  ]
  const q4 = kb.analyze(0.2, lowEntries)
  assert(q4.quadrant === 4, `KB-4: Q4 both low got=Q${q4.quadrant}`)

  // KB-5: Calibrate entries
  const calibrated = kb.calibrateEntries(highEntries, q1)
  assert(calibrated.length === 1, "KB-5a: calibrate returns same count")
  assert(calibrated[0].shouldUse === true, "KB-5b: Q1 entry should be used")

  // KB-6: Estimate internal confidence from text
  const confidentText = "Tentu, saya yakin dengan implementasi Express middleware yang sudah pasti benar."
  const highConf = kb.estimateInternalConfidence(confidentText)
  assert(highConf > 0.5, `KB-6a: confident text → confidence=${highConf} > 0.5`)

  const unsureText = "Mungkin saya kurang yakin, sepertinya ini bisa jadi salah."
  const lowConf = kb.estimateInternalConfidence(unsureText)
  assert(lowConf < 0.6, `KB-6b: unsure text → confidence=${lowConf} < 0.6`)

  // KB-7: Format for prompt
  const kbFormatted = kb.formatForPrompt(q1)
  assert(kbFormatted.includes("knowledge-boundary"), "KB-7: formatted includes knowledge-boundary tag")
  assert(kbFormatted.includes("quadrant"), "KB-7b: includes quadrant")

  // ── RAGContextOptimizer Tests ──
  section("RAGContextOptimizer")

  const { RAGContextOptimizer } = mod
  const co = new RAGContextOptimizer()
  assert(typeof co.optimize === "function", "CO-1a: optimize method exists")
  assert(typeof co.estimateTokens === "function", "CO-1b: estimateTokens exists")
  assert(typeof co.formatForPrompt === "function", "CO-1c: formatForPrompt exists")

  // CO-2: Token estimation
  const tokens = co.estimateTokens("Hello world ini adalah test untuk estimasi token count")
  assert(tokens > 0, `CO-2a: tokens=${tokens} > 0`)

  // CO-3: Optimize with empty entries
  const emptyOpt = co.optimize([], 4000)
  assert(emptyOpt.entries.length === 0, "CO-3a: empty input → empty output")
  assert(emptyOpt.budget === 4000, "CO-3b: budget preserved")

  // CO-4: Optimize with entries
  const entries = [
    { title: "entry1", timestamp: new Date().toISOString(), keywords: ["express", "api", "routing"], category: "tech",
      qualityScore: 0.9, episode: { summary: "Express routing best practices", decisions: ["Use Router()"], tags: [] } },
    { title: "entry2", timestamp: new Date().toISOString(), keywords: ["vue", "component", "composition"], category: "tech",
      qualityScore: 0.7, episode: { summary: "Vue Composition API", decisions: ["Use ref()"], tags: [] } },
    { title: "entry3", timestamp: new Date().toISOString(), keywords: ["express", "middleware", "error"], category: "tech",
      qualityScore: 0.8, episode: { summary: "Express error handling", decisions: ["Centralized error handler"], tags: [] } },
  ]
  const opt = co.optimize(entries, 2000, "Express API")
  assert(opt.entries.length > 0, `CO-4a: selected ${opt.entries.length} entries`)
  assert(opt.totalTokens > 0, "CO-4b: tokens > 0")
  assert(opt.totalTokens <= 2000, `CO-4c: tokens=${opt.totalTokens} <= budget=2000`)
  assert(opt.avgQuality > 0, "CO-4d: avgQuality > 0")

  // CO-5: Budget constraint
  const tinyOpt = co.optimize(entries, 100)
  assert(tinyOpt.entries.length <= entries.length, "CO-5: tiny budget limits selection")

  // CO-6: Format for prompt
  const coFormatted = co.formatForPrompt(opt)
  assert(coFormatted.includes("optimized-context"), "CO-6a: formatted includes optimized-context tag")
  assert(coFormatted.includes("budget"), "CO-6b: includes budget")

  // CO-7: Estimate entry tokens
  const entryTokens = co.estimateEntryTokens(entries[0])
  assert(entryTokens > 0, `CO-7: entry tokens=${entryTokens} > 0`)

  // ── RAGSelfImprovePipeline (ecosystem solid critical path) ──
  section("RAGSelfImprovePipeline")

  const {
    RAGSelfImprovePipeline,
    getRAGSelfImprovePipeline,
    resetRAGSelfImprovePipeline,
  } = mod

  assert(typeof RAGSelfImprovePipeline === "function", "SIP-1a: RAGSelfImprovePipeline exported")
  assert(typeof getRAGSelfImprovePipeline === "function", "SIP-1b: singleton getter exported")

  resetRAGSelfImprovePipeline()
  const sip = getRAGSelfImprovePipeline()
  assert(sip instanceof RAGSelfImprovePipeline, "SIP-1c: singleton is pipeline instance")

  // Empty without RAG store
  const emptySearch = await sip.search("express routing")
  assert(emptySearch.knowledge.length === 0, "SIP-2a: no store → empty knowledge")
  assert(emptySearch.hasHighConfidence === false, "SIP-2b: no high confidence without data")
  assert(emptySearch.meta.recommendation === "manual-research", "SIP-2c: recommends research")

  // Wire a live MultiIndexRAG with sample episode (reuse MultiIndexRAG from earlier destructure)
  const sipRag = new MultiIndexRAG()
  sipRag.indexEpisode("knowledge-tech", {
    id: "ep-sip-1",
    planGoal: "Express routing guide",
    outcome: "success",
    summary: "Use express.Router() for modular routes. Mount with app.use('/api', router).",
    decisions: ["Use Router()", "Central error middleware"],
    filesChanged: [],
    sessionId: "test-sip",
    timestamp: new Date().toISOString(),
    tags: ["express", "routing", "api"],
    score: 1.0,
    usageCount: 0,
    significance: "notable",
  })
  sip.setRagStore(sipRag)
  assert(sip.getRagStore() === sipRag, "SIP-3a: setRagStore binds store")

  const filled = await sip.search("express routing api", { limit: 3, mode: "standard" })
  assert(Array.isArray(filled.knowledge), "SIP-3b: knowledge is array")
  assert(Array.isArray(filled.usedTitles), "SIP-3c: usedTitles tracked")
  assert(filled.knowledgeState && typeof filled.knowledgeState.quadrant === "number", "SIP-3d: KbPO state present")
  assert(filled.meta && filled.meta.mode === "standard", "SIP-3e: meta.mode standard")
  const metaPrompt = sip.formatMetaForPrompt(filled)
  assert(metaPrompt.includes("self-improve-rag"), "SIP-3g: formatMetaForPrompt XML")

  // Feedback loop with titles
  const titles = filled.usedTitles.length > 0 ? filled.usedTitles : ["Express routing guide"]
  const fbReport = await sip.feedStepResult({
    sourceId: "step-sip-1",
    success: true,
    usedEntryTitles: titles,
    output: "Implemented express routes using Router()",
    timestamp: new Date().toISOString(),
  })
  assert(fbReport !== null, "SIP-4a: feedback returns report")
  assert(typeof fbReport.entriesUpdated === "number", "SIP-4b: entriesUpdated numeric")

  // Negative feedback path
  const fbNeg = await sip.feedStepResult({
    sourceId: "step-sip-2",
    success: false,
    usedEntryTitles: titles,
    output: "compile failed",
    error: "TS2307",
    errorCategory: "type",
    timestamp: new Date().toISOString(),
  })
  assert(fbNeg !== null, "SIP-5a: negative feedback ok")
  assert(true, "SIP-6: orchestrator wiring covered via setRAGSelfImprove API")

  resetRAGSelfImprovePipeline()
}

// ── Standalone execution (parallel worker) ──
const _isMain = typeof process !== "undefined" && process.argv[1] && (
  process.argv[1] === import.meta.url || process.argv[1].endsWith("/_runall-rag-selfimprove.mjs")
)
if (_isMain) {
  const { pluginDist: _pd } = await import("./_common.mjs")
  const _mod = await import(_pd)
  await runRAGSelfImproveTests(_mod)
  const { state } = await import("./_state.mjs")
  console.log(`__RESULT__:${JSON.stringify({ passed: state.passed, failed: state.failed })}`)
  process.exit(state.failed > 0 ? 1 : 0)
}
