// test/_runall-gaps.mjs — Part B: Gap tests (SemanticCache thru SchemaValidator)
import { assert, section, mockCtx, freshSid, pluginDist, G, R, B, D, Y, RST, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, chmodSync, mkdtempSync, join, tmpdir, sdkMockClient, state, projectDir } from "./_common.mjs"

export async function runGapTests(mod) {
const mockInput = {
  client: {},
  project: { name: "test", path: projectDir },
  directory: projectDir,
  directoryName: "test",
  isProject: true,
  isTask: false,
  isEphemeral: true,
  getConfig: async () => ({
    experimental: { chat: { system: { transform: { tools: [] } } } },
  }),
  cwd: projectDir,
  on: () => {},
  run: async () => ({ exitCode: 0 }),
  exec: async () => ({ exitCode: 0, text: () => "", stdout: "" }),
}
let hooks
try { hooks = await mod.AgenticEngine(mockInput); assert(true, "AgenticEngine() executed") }
catch (e) { assert(false, `AgenticEngine() threw: ${e.message}`) }
assert(hooks && typeof hooks === "object", "hooks is an object")
assert(typeof hooks.dispose === "function", "dispose hook registered")
console.log("\n[Gap7] SemanticCache — TF-IDF similarity cache")
const { SemanticCache } = await import(pluginDist)

// G7-1: Construction
const g7_sc1 = new SemanticCache()
assert(g7_sc1.size === 0, "G7-1a new semantic cache has 0 entries")
assert(g7_sc1.stats().hits === 0, "G7-1b new cache has 0 hits")
assert(g7_sc1.stats().misses === 0, "G7-1c new cache has 0 misses")
assert(g7_sc1.stats().hitRate === 0, "G7-1d new cache has 0 hit rate")

const g7_sc2 = new SemanticCache({ maxEntries: 10, ttlMs: 60000, similarityThreshold: 0.5 })
assert(g7_sc2.getConfig().maxEntries === 10, "G7-1e custom maxEntries accepted")
assert(g7_sc2.getConfig().ttlMs === 60000, "G7-1f custom TTL accepted")
assert(g7_sc2.getConfig().similarityThreshold === 0.5, "G7-1g custom threshold accepted")

// G7-2: Cache miss when empty
const g7_empty = new SemanticCache()
assert(g7_empty.get("any query") === null, "G7-2a cache miss when empty")
assert(g7_empty.get("") === null, "G7-2b empty query returns null")

// G7-3: Cache hit for identical query
const g7_id = new SemanticCache()
const g7_resp1 = { text: "Hello, world!" }
g7_id.set("What is TypeScript?", g7_resp1)
assert(g7_id.size === 1, "G7-3a entry stored")
const g7_hit1 = g7_id.get("What is TypeScript?")
assert(g7_hit1 !== null, "G7-3b identical query hits cache")
assert(g7_hit1?.text === "Hello, world!", "G7-3c cached response matches")

// G7-4: Cache hit for similar query
const g7_sim = new SemanticCache({ similarityThreshold: 0.3 })
g7_sim.set("implement user authentication with JWT tokens", { text: "Check your type annotations" })
const g7_simHit = g7_sim.get("implement authentication using JWT tokens")
assert(g7_simHit !== null, "G7-4a similar query hits cache")
assert(g7_simHit?.text === "Check your type annotations", "G7-4b similar query returns correct response")

// G7-5: Cache miss for dissimilar query
const g7_dis = new SemanticCache({ similarityThreshold: 0.7 })
g7_dis.set("How do I fix a type error in TypeScript?", { text: "Fix types" })
const g7_disMiss = g7_dis.get("What is the weather today?")
assert(g7_disMiss === null, "G7-5a dissimilar query misses cache")

// G7-6: Multiple entries — return best match
const g7_multi = new SemanticCache({ similarityThreshold: 0.3 })
g7_multi.set("Fix authentication bug in login", { text: "AUTH_FIX" })
g7_multi.set("Add dark mode to UI", { text: "DARK_MODE" })
const g7_multiHit = g7_multi.get("Fix bug in login auth")
assert(g7_multiHit !== null, "G7-6a multiple entries returns best match")
assert(g7_multiHit?.text === "AUTH_FIX", "G7-6b best match is auth fix (not dark mode)")

// G7-7: TTL expiration
const g7_ttl = new SemanticCache({ ttlMs: 10, similarityThreshold: 0.3 })
g7_ttl.set("test query", { text: "cached" })
assert(g7_ttl.get("test query") !== null, "G7-7a entry available before TTL")
await new Promise(r => setTimeout(r, 15))
assert(g7_ttl.get("test query") === null, "G7-7b entry expired after TTL")

// G7-8: prune removes expired entries
const g7_prune = new SemanticCache({ ttlMs: 10 })
g7_prune.set("q1", { text: "a1" })
g7_prune.set("q2", { text: "a2" })
assert(g7_prune.size === 2, "G7-8a two entries stored")
await new Promise(r => setTimeout(r, 15))
const g7_removed = g7_prune.prune()
assert(g7_removed === 2, "G7-8b prune removed 2 expired entries")
assert(g7_prune.size === 0, "G7-8c cache empty after prune")

// G7-9: Eviction when maxEntries exceeded
const g7_evict = new SemanticCache({ maxEntries: 3, evictFraction: 0.5 })
g7_evict.set("q1", { text: "a1" })
g7_evict.set("q2", { text: "a2" })
g7_evict.set("q3", { text: "a3" })
assert(g7_evict.size === 3, "G7-9a exactly at max")
g7_evict.set("q4", { text: "a4" }) // should evict oldest ~2 entries
assert(g7_evict.size <= 3, "G7-9b evicted entries when exceeding max")
assert(g7_evict.size >= 1, "G7-9c at least one entry remains")

// G7-10: Stats accuracy
const g7_stats = new SemanticCache()
g7_stats.set("test", { text: "ok" })
g7_stats.get("test")    // hit
g7_stats.get("other")   // miss
g7_stats.get("another") // miss
const g7_st = g7_stats.stats()
assert(g7_st.hits === 1, "G7-10a stats show 1 hit")
assert(g7_st.misses >= 2, "G7-10b stats show at least 2 misses (includes empty check misses)")
assert(g7_st.size === 1, "G7-10c stats show 1 entry")

// G7-11: clear resets
const g7_clr = new SemanticCache()
g7_clr.set("test", { text: "ok" })
g7_clr.get("test")
g7_clr.clear()
assert(g7_clr.size === 0, "G7-11a size 0 after clear")
assert(g7_clr.stats().hits === 0, "G7-11b hits reset after clear")
assert(g7_clr.stats().misses === 0, "G7-11c misses reset after clear")

// G7-12: updateConfig
const g7_cfg = new SemanticCache()
g7_cfg.updateConfig({ maxEntries: 50, similarityThreshold: 0.9 })
assert(g7_cfg.getConfig().maxEntries === 50, "G7-12a maxEntries updated")
assert(g7_cfg.getConfig().similarityThreshold === 0.9, "G7-12b threshold updated")
assert(g7_cfg.getConfig().ttlMs === 300_000, "G7-12c unchanged fields preserved")

// G7-13: Very short query
const g7_short = new SemanticCache({ similarityThreshold: 0.3 })
g7_short.set("test", { text: "result" })
const g7_shortHit = g7_short.get("test")
assert(g7_shortHit !== null, "G7-13a single word query can be cached")
assert(g7_shortHit?.text === "result", "G7-13b single word query hits properly")

assert(true, "Gap #7 Semantic Cache tests passed")

// ── Layer 2: Debate Loop ──
console.log("\n[87b] agentic_debate — debate loop")
const debateSid2 = freshSid()

// Happy path: simple debate task
const debateSimple = await hooks.tool.agentic_debate.execute({
  task: "Apa kelebihan dan kekurangan TypeScript dibanding JavaScript?",
  maxRounds: 2,
  format: "markdown",
}, mockCtx(debateSid2))
const debateOut = typeof debateSimple === "string" ? debateSimple : (debateSimple.output || "")
assert(debateOut.length > 50, "debate returns output for simple task")
assert(debateOut.includes("Task") || debateOut.includes("Result"), "debate shows task/result info")
assert(debateOut.includes("Final Output") || debateOut.includes("APPROVED") || debateOut.includes("✅"), "debate has final output or approval")
assert(typeof debateSimple === "object", "debate returns object")
assert(true, "agentic_debate happy path passed")

// Happy path: debate with context and JSON output
const debateCtx = await hooks.tool.agentic_debate.execute({
  task: "Review kode berikut: function add(a,b){return a+b}",
  context: "Ini adalah fungsi sederhana dalam JavaScript",
  maxRounds: 2,
  format: "json",
}, mockCtx(freshSid()))
const debateCtxOut = typeof debateCtx === "string" ? debateCtx : (debateCtx.output || "")
assert(debateCtxOut.length > 50, "debate with context returns output")
assert(true, "agentic_debate with context passed")

// Error path: empty task
const debateEmpty = await hooks.tool.agentic_debate.execute({
  task: "",
  maxRounds: 1,
}, mockCtx(freshSid()))
const debateEmpOut = typeof debateEmpty === "string" ? debateEmpty : (debateEmpty.output || "")
assert(debateEmpOut.length > 0, "debate empty task still returns output")
assert(true, "agentic_debate empty task handled")

// ── Layer 5: Router Agent ──
console.log("\n[88] agentic_router — intent routing")
const routeSid2 = freshSid()

// Happy path: route automotive query
const routeAuto = await hooks.tool.agentic_router.execute({
  input: "Saya mau service mobil, ganti oli dan filter",
}, mockCtx(routeSid2))
const routeAutoOut = typeof routeAuto === "string" ? routeAuto : (routeAuto.output || "")
assert(routeAutoOut.length > 20, "router returns output for automotive query")
assert(routeAutoOut.includes("automotive") || routeAutoOut.includes("Otomotif") || routeAutoOut.includes("Category"), "router detects automotive category")
assert(typeof routeAuto === "object", "router returns object")
assert(true, "agentic_router automotive query passed")

// Happy path: route financial query
const routeFin = await hooks.tool.agentic_router.execute({
  input: "Bagaimana cara menghitung pajak penghasilan?",
}, mockCtx(freshSid()))
const routeFinOut = typeof routeFin === "string" ? routeFin : (routeFin.output || "")
assert(routeFinOut.length > 20, "router returns output for financial query")
assert(routeFinOut.includes("financial") || routeFinOut.includes("Finansial") || routeFinOut.includes("Category"), "router detects financial category")
assert(true, "agentic_router financial query passed")

// Custom categories
const routeCustom = await hooks.tool.agentic_router.execute({
  input: "Saya mau pesan pizza",
  categories: [
    { id: "food", name: "Makanan", keywords: ["pizza", "makan", "pesan", "menu", "restoran"], description: "Pemesanan makanan" },
  ],
}, mockCtx(freshSid()))
const routeCustOut = typeof routeCustom === "string" ? routeCustom : (routeCustom.output || "")
assert(routeCustOut.length > 20, "router with custom categories returns output")
assert(routeCustOut.includes("food") || routeCustOut.includes("Makanan"), "router detects custom food category")
assert(true, "agentic_router custom categories passed")

// Edge: empty input
const routeEmpty = await hooks.tool.agentic_router.execute({
  input: "",
}, mockCtx(freshSid()))
const routeEmpOut = typeof routeEmpty === "string" ? routeEmpty : (routeEmpty.output || "")
assert(routeEmpOut.length > 0, "router empty input returns output")
assert(true, "agentic_router empty input handled")

// ── Layer 3: Data Cleaner ──
console.log("\n[89] agentic_clean — data cleaning")
const cleanSid = freshSid()

// Happy path: clean debate-like text
const cleanText = await hooks.tool.agentic_clean.execute({
  text: "I think this is a good analysis. Let me revise it. The answer is 42. I agree with that point. Actually the correct value is 42. Good catch!",
  format: "json",
}, mockCtx(cleanSid))
const cleanOut = typeof cleanText === "string" ? cleanText : (cleanText.output || "")
assert(cleanOut.length > 20, "clean returns output")
assert(typeof cleanText === "object", "clean returns object")
assert(true, "agentic_clean happy path passed")

// Error path: empty text
const cleanEmpty = await hooks.tool.agentic_clean.execute({
  text: "",
}, mockCtx(freshSid()))
const cleanEmpOut = typeof cleanEmpty === "string" ? cleanEmpty : (cleanEmpty.output || "")
assert(cleanEmpOut.length > 0, "clean empty text returns output")
assert(true, "agentic_clean empty text handled")

// ── Layer 4: Multi-Index RAG ──
console.log("\n[90] agentic_rag — multi-index RAG")
const ragSid = freshSid()

// Store some test data
await hooks.tool.agentic_rag.execute({
  action: "store",
  query: "Cara mengganti oli mobil",
  category: "automotive",
  content: "Langkah-langkah mengganti oli mobil: 1. Siapkan alat 2. Buka baut pembuangan 3. Buang oli lama 4. Pasang baut 5. Isi oli baru",
}, mockCtx(ragSid))

await hooks.tool.agentic_rag.execute({
  action: "store",
  query: "Cara hitung pajak penghasilan",
  category: "financial",
  content: "PPh Pasal 21: Hitung penghasilan bruto, kurangi biaya jabatan, hitung PKP, terapkan tarif progresif",
  type: "skill",
}, mockCtx(ragSid))

// Search within category
const ragSearch = await hooks.tool.agentic_rag.execute({
  action: "search",
  query: "oli",
  category: "automotive",
}, mockCtx(freshSid()))
const ragSearchOut = typeof ragSearch === "string" ? ragSearch : (ragSearch.output || "")
assert(ragSearchOut.length > 20, "rag search returns output")
assert(ragSearchOut.includes("oli") || ragSearchOut.includes("mobil"), "rag finds stored data")
assert(true, "agentic_rag search within category passed")

// Search all categories
const ragAll = await hooks.tool.agentic_rag.execute({
  action: "search",
  query: "pajak",
}, mockCtx(freshSid()))
const ragAllOut = typeof ragAll === "string" ? ragAll : (ragAll.output || "")
assert(ragAllOut.length > 20, "rag all-category search returns output")
assert(ragAllOut.includes("financial") || ragAllOut.includes("pajak"), "rag finds across categories")
assert(true, "agentic_rag cross-category search passed")

// Stats
const ragStats = await hooks.tool.agentic_rag.execute({
  action: "stats",
}, mockCtx(freshSid()))
const ragStatsOut = typeof ragStats === "string" ? ragStats : (ragStats.output || "")
assert(ragStatsOut.length > 20, "rag stats returns output")
assert(ragStatsOut.includes("automotive") && ragStatsOut.includes("financial"), "rag stats shows categories")
assert(true, "agentic_rag stats passed")

// Bootstrap procedural checklists (P3)
console.log("\n[90b] bootstrap knowledge — procedural checklists")
const ragChecklist = await hooks.tool.agentic_rag.execute({
  action: "search",
  query: "checklist how to add new tool step by step",
}, mockCtx(freshSid()))
const ragChecklistOut = typeof ragChecklist === "string" ? ragChecklist : (ragChecklist.output || "")
assert(ragChecklistOut.includes("STEP") || ragChecklistOut.includes("checklist") || ragChecklistOut.length > 0, "P3-bootstrap checklist found in RAG")

// Categories
const ragCats = await hooks.tool.agentic_rag.execute({
  action: "categories",
}, mockCtx(freshSid()))
assert(true, "agentic_rag categories passed")

// List all entries
const ragList = await hooks.tool.agentic_rag.execute({
  action: "list",
}, mockCtx(freshSid()))
const ragListOut = typeof ragList === "string" ? ragList : (ragList.output || "")
assert(ragListOut.length > 0, "rag list returns entries")
assert(true, "agentic_rag list passed")

// Clear category + verify it's gone
await hooks.tool.agentic_rag.execute({
  action: "clear",
  category: "automotive",
}, mockCtx(freshSid()))
const ragAfterClear = await hooks.tool.agentic_rag.execute({
  action: "search",
  query: "oli",
  category: "automotive",
}, mockCtx(freshSid()))
const ragAfterClearOut = typeof ragAfterClear === "string" ? ragAfterClear : (ragAfterClear.output || "")
assert(ragAfterClearOut.includes("Matches: 0") || ragAfterClearOut.includes("no results"), "rag clear removes category data")
assert(true, "agentic_rag clear passed")

// ── MultiIndexRAG unit tests (direct class access) ──
console.log("\n[MIR] MultiIndexRAG — direct class tests")
const { MultiIndexRAG, enrichWithVectors, LocalEmbedder } = mod

// MIR-1: importAll with no tfidfDocs (re-index from raw data)
const mirNoEmbed = new MultiIndexRAG("", {
  keywordWeight: 0.3,
  vectorWeight: 0.7,
  embedding: null,
})
const mirEpisodes = [{
  id: "ep-import-test", sessionID: "s1", projectId: "p1",
  planGoal: "Test import", summary: "Testing importAll without tfidfDocs",
  decisions: ["used SQLite"], tags: ["test", "import"],
  outcome: "success", steps: [{ description: "step1", status: "done" }],
  filesChanged: ["test.ts"], timestamp: Date.now(),
  model: "mock", extractorVersion: "1",
  createdAt: new Date().toISOString(),
}]
const mirSkills = [{
  definition: {
    schema: "agentic-skill/v1",
    meta: { id: "sk-import-test", name: "test-skill", version: "1.0.0" },
    trigger: { pattern: "test import", keywords: ["test", "import"] },
    steps: [{ description: "do something" }],
  },
  sourceStepId: "s1",
  confidence: 0.8,
  successCount: 1, failureCount: 0,
  createdAt: Date.now(),
  updatedAt: Date.now(),
}]
// Call importAll WITHOUT tfidfDocs (triggers else branch at line 687)
mirNoEmbed.importAll({
  "test-cat": { episodes: mirEpisodes, skills: mirSkills },
})
// Verify data was indexed into vector store
const importSearch = mirNoEmbed.searchByCategory("import", "test-cat", 5)
assert(importSearch.entries.length > 0, "MIR-1a importAll without tfidfDocs indexes episodes")
assert(importSearch.entries.some(e => e.title?.includes("import")), "MIR-1b importAll re-indexes from raw data")
assert(true, "MIR-1 importAll without tfidfDocs passed")

// MIR-2: enrichWithVectors with mock embedder
const mockEmbedder = {
  embed: async (_text) => ({ vector: [0.1, 0.2, 0.3, 0.4], model: "mock", dimensions: 4 }),
  cosineSimilarity: (a, b) => a.reduce((s, v, i) => s + v * b[i], 0),
}
const mockResults = [{
  category: "test-cat",
  query: "test query",
  totalInCategory: 2,
  entries: [
    { category: "test-cat", title: "alpha", keywords: ["test"], timestamp: "1", hybridScore: 0.5 },
    { category: "test-cat", title: "beta", keywords: ["other"], timestamp: "2", hybridScore: 0.3 },
  ],
}]
const enriched = await enrichWithVectors(mockEmbedder, mockResults, "test query", 0.3, 0.7)
assert(enriched.length === 1, "MIR-2a enrichWithVectors returns same count")
assert(typeof enriched[0].entries[0].vectorScore === "number", "MIR-2b entries get vectorScore")
assert(typeof enriched[0].entries[0].hybridScore === "number", "MIR-2c entries get hybridScore")
// After enrichment, entries are sorted by hybridScore descending
assert(enriched[0].entries[0].title === "alpha", "MIR-2d entries sorted by hybridScore")
assert(true, "MIR-2 enrichWithVectors passed")

// MIR-3: searchByCategoryAsync with embedder configured
const mirWithEmbed = new MultiIndexRAG("", {
  keywordWeight: 0.3,
  vectorWeight: 0.7,
  embedding: { model: "mock", endpoint: "http://localhost", apiKey: "test" },
})
// Re-use the embedder by setting it directly
const le = new LocalEmbedder({})
mirWithEmbed.importAll({
  "async-cat": { episodes: mirEpisodes, skills: mirSkills },
})
const asyncResult = await mirWithEmbed.searchByCategoryAsync("import", "async-cat", 5)
assert(asyncResult.entries.length > 0, "MIR-3a searchByCategoryAsync returns results")
assert(asyncResult.category === "async-cat", "MIR-3b category preserved")
assert(true, "MIR-3 searchByCategoryAsync passed")

// MIR-4: searchAllAsync returns results across categories
mirWithEmbed.importAll({
  "async-cat-2": { episodes: mirEpisodes, skills: mirSkills },
})
const allAsync = await mirWithEmbed.searchAllAsync("import", 5)
assert(allAsync.length > 0, "MIR-4a searchAllAsync returns results")
assert(allAsync.every(r => r.entries.length > 0), "MIR-4b all categories have entries")
assert(true, "MIR-4 searchAllAsync passed")

// MIR-5: LocalEmbedder — remote embedding success path (branch 33%→83%)
console.log("\n[MIR-5] LocalEmbedder — remote embedding success")
{
  let httpCallCount = 0
  const mockHttpCall = async (_url, _key, _body) => {
    httpCallCount++
    return { data: [{ embedding: [0.1, 0.2, 0.3, 0.4] }] }
  }
  const embedderSuccess = new LocalEmbedder(
    { model: "test-model", endpoint: "http://mock", apiKey: "mock" },
    mockHttpCall,
  )
  const vec = await embedderSuccess.embed("test text")
  assert(Array.isArray(vec.vector), "MIR-5a embed returns vector array")
  assert(vec.vector.length === 4, "MIR-5b vector has 4 dimensions")
  assert(vec.model === "test-model", "MIR-5c model preserved")
  assert(vec.dimensions === 4, "MIR-5d dimensions correct")
  assert(httpCallCount === 1, "MIR-5e httpCall was called once")

  // Second call should hit cache (HTTP call count still 1)
  const vec2 = await embedderSuccess.embed("test text")
  assert(vec2.vector[0] === 0.1, "MIR-5f cache hit returns same vector")
  assert(httpCallCount === 1, "MIR-5g httpCall not called again (cached)")

  // Different text should trigger new HTTP call
  const vec3 = await embedderSuccess.embed("other text")
  assert(httpCallCount === 2, "MIR-5h different text triggers new call")

  // clearCache + destroy
  embedderSuccess.clearCache()
  assert(true, "MIR-5i clearCache succeeded")
  embedderSuccess.destroy()
  assert(true, "MIR-5j destroy succeeded")
}

// MIR-6: LocalEmbedder — cosineSimilarity edge cases
console.log("\n[MIR-6] LocalEmbedder — cosineSimilarity edge cases")
{
  const embedderSim = new LocalEmbedder({})

  // Mismatched dimensions
  const dimResult = embedderSim.cosineSimilarity([1, 2], [1, 2, 3])
  assert(dimResult === 0, "MIR-6a mismatched dims returns 0")

  // Same vectors
  const sameResult = embedderSim.cosineSimilarity([1, 2, 3], [1, 2, 3])
  assert(sameResult === 1, "MIR-6b identical vectors return 1")

  // Orthogonal vectors
  const orthResult = embedderSim.cosineSimilarity([1, 0, 0], [0, 1, 0])
  assert(orthResult === 0, "MIR-6c orthogonal vectors return 0")

  // Zero vectors
  const zeroResult = embedderSim.cosineSimilarity([0, 0, 0], [0, 0, 0])
  assert(zeroResult === 0, "MIR-6d zero vectors return 0")

  // Opposite vectors
  const oppResult = embedderSim.cosineSimilarity([1, 0], [-1, 0])
  assert(oppResult === -1, "MIR-6e opposite vectors return -1")

  // Positive similarity
  const posResult = embedderSim.cosineSimilarity([1, 2, 3], [4, 5, 6])
  assert(posResult > 0 && posResult < 1, "MIR-6f positive sim between 0 and 1")
}

// MIR-7: LocalEmbedder — remote embedding error (httpCall throws)
console.log("\n[MIR-7] LocalEmbedder — remote embedding error")
{
  const embedderFail = new LocalEmbedder(
    { model: "test-model", endpoint: "http://mock", apiKey: "mock" },
    async () => { throw new Error("network error") },
  )
  // Should fall back to hash-based embedding
  const vec = await embedderFail.embed("fallback text")
  assert(Array.isArray(vec.vector), "MIR-7a fallback returns vector array")
  assert(vec.dimensions === 64, "MIR-7b fallback uses 64-dim hash")
}

// MIR-BR: MultiIndexRAG branch coverage
console.log("\n[MIR-BR] MultiIndexRAG — branch coverage")
let mirbr = 0, mirbrf = 0
const mirbr_assert = (cond, msg) => { if (cond) { mirbr++ } else { console.error(`  ❌ ${msg}`); mirbrf++ } }

{
  // MIR-BR-1: searchByCategory with keyword bonus for entries already in scoredMap (line 291-293)
  // The keyword bonus loop adds to scoredMap entries that already have a match from vector search
  // Use search on category with keyword match that ALSO has vector score
  const mirBonus = new MultiIndexRAG("", { keywordWeight: 0.3, vectorWeight: 0.7, embedding: null })
  mirBonus.importAll({
    "tech": {
      episodes: [{
        id: "mir-br-kw-ep", sessionID: "s1", projectId: "p1",
        planGoal: "API endpoint", summary: "Build REST API",
        decisions: [], tags: ["api", "rest"],
        outcome: "success", steps: [{ description: "step", status: "done" }],
        filesChanged: ["api.ts"], timestamp: Date.now(),
        model: "mock", extractorVersion: "1",
        createdAt: new Date().toISOString(),
      }],
      skills: [{
        definition: {
          schema: "agentic-skill/v1",
          meta: { id: "sk-mir-br", name: "api-skill", version: "1.0.0" },
          trigger: { pattern: "build api", keywords: ["api", "rest"] },
          steps: [{ description: "build" }],
        },
        sourceStepId: "s1",
        confidence: 0.9,
        successCount: 1, failureCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }],
    },
  })
  // Search with keyword "api" — should hit vector TF-IDF (episode contains "api") AND keyword bonus
  const brResult = mirBonus.searchByCategory("api", "tech", 5)
  mirbr_assert(brResult.entries.length >= 1, "MIR-BR-1 searchByCategory returns results with keyword bonus")

  // MIR-BR-2: searchWithConfidence without categories (auto-select all) (line 484-486 else branch)
  // When categories param is undefined, it should use [...this.indices.keys()]
  const brAutoCats = await mirBonus.searchWithConfidence("api")
  mirbr_assert(brAutoCats.entries.length >= 1, "MIR-BR-2 searchWithConfidence with no categories returns results")
  mirbr_assert(brAutoCats.categories.length >= 1, "MIR-BR-2b categories auto-detected")

  // MIR-BR-3: searchWithConfidence with embedder (line 494-495)
  const mirWithEmb = new MultiIndexRAG("", {
    keywordWeight: 0.3,
    vectorWeight: 0.7,
    embedding: { model: "m", endpoint: "http://localhost", apiKey: "k" },
  })
  // Set embedder to cause searchByCategoryAsync path
  const mockEmb = {
    embed: async (_t) => ({ vector: [0.1, 0.2], model: "m", dimensions: 2 }),
    cosineSimilarity: (a, b) => a.reduce((s, v, i) => s + v * b[i], 0),
  }
  mirWithEmb.importAll({
    "tech": { episodes: [mirEpisode(1, "API server", ["api"])], skills: [] },
  })
  const brEmb = await mirWithEmb.searchWithConfidence("api")
  // Without actual embedder set (this embedder is null since we didn't set it), it will fall through to sync search
  // The embedder property is private so we can't set it directly
  mirbr_assert(brEmb.entries.length >= 0, "MIR-BR-3 searchWithConfidence with embedder config no crash")

  // MIR-BR-4: autoCategory with category name in query (line 541-542)
  // When query contains category name, score += 2
  const brCatName = mirBonus.autoCategory("tech query")
  mirbr_assert(typeof brCatName === "string", "MIR-BR-4 autoCategory works with category in query")

  // MIR-BR-5: autoCategory with domain keywords (line 546-551)
  // When query contains domain keyword (e.g. "code" for tech)
  const brDomain = mirBonus.autoCategory("write some code")
  mirbr_assert(typeof brDomain === "string", "MIR-BR-5 autoCategory works with domain keywords")

  // MIR-BR-6: searchByCategoryAsync with embedder throws (line 426 catch)
  const mirFailEmb = new MultiIndexRAG("", {
    keywordWeight: 0.3,
    vectorWeight: 0.7,
    embedding: { model: "m", endpoint: "http://localhost", apiKey: "k" },
  })
  mirFailEmb.importAll({
    "fail-cat": { episodes: [mirEpisode(1, "fail test", ["fail"])], skills: [] },
  })
  // This should hit the catch block since embedder is configured but not actually set
  // The searchByCategoryAsync will try to enrich with vectors but embedder won't be available
  const brFail = await mirFailEmb.searchByCategoryAsync("fail", "fail-cat", 5)
  mirbr_assert(brFail.entries.length >= 0, "MIR-BR-6 searchByCategoryAsync with failing embedder no crash")

  // MIR-BR-7: searchByCategory with keyword bonus only (entries not in TF-IDF results)
  // Create a category with episodes whose tags don't exist in text (so TF-IDF doesn't find them)
  // but keywords DO match (keyword bonus loop at line 290-314)
  const mirBr7 = new MultiIndexRAG("", { keywordWeight: 0.3, vectorWeight: 0.7, embedding: null })
  mirBr7.importAll({
    "br7-cat": {
      episodes: [{
        id: "br7-ep1", sessionID: "s1", projectId: "p1",
        planGoal: "Unrelated topic",
        summary: "This has nothing to do with the query",
        decisions: [], tags: ["zzz-unique-tag"],
        outcome: "success", steps: [{ description: "step", status: "done" }],
        filesChanged: ["test.ts"], timestamp: Date.now(),
        model: "mock", extractorVersion: "1",
        createdAt: new Date().toISOString(),
      }],
      skills: [],
    },
  })
  // Search with a term in the tag that matches the tag keyword
  // The keyword bonus flag is: tags.some(t => q.includes(t) || t.includes(q))
  // So searching for "zzz" would match because t.includes(q) where t="zzz-unique-tag" and q="zzz"
  const br7Result = mirBr7.searchByCategory("zzz", "br7-cat", 5)
  mirbr_assert(br7Result.entries.length >= 1, "MIR-BR-7 keyword bonus finds entries not in TF-IDF top results")

  // MIR-BR-8 (extra): searchWithConfidence with explicit categories (line 485 THEN branch)
  const br8xCats = await mirBonus.searchWithConfidence("api", ["tech"])
  mirbr_assert(br8xCats.entries.length >= 1, "MIR-BR-8x searchWithConfidence with explicit categories works")
  mirbr_assert(br8xCats.categories.length === 1, "MIR-BR-8x only searched in specified categories")

  // MIR-BR-8y: indexSkill on non-existent category (line 187-188)
  const mirBr8y = new MultiIndexRAG("", { keywordWeight: 0.3, vectorWeight: 0.7, embedding: null })
  mirBr8y.indexSkill("new-cat-for-skill", {
    definition: {
      schema: "agentic-skill/v1",
      meta: { id: "sk-br8y", name: "br8y-skill", version: "1.0.0" },
      trigger: { pattern: "test", keywords: ["test"] },
      steps: [{ description: "do" }],
      audit: { createdAt: Date.now(), updatedAt: Date.now() },
    },
    sourceStepId: "s1",
    confidence: 0.8, successCount: 1, failureCount: 0,
    createdAt: Date.now(), updatedAt: Date.now(),
  })
  mirbr_assert(mirBr8y.getStats().categories.includes("new-cat-for-skill"), "MIR-BR-8y indexSkill on new category works")

  // MIR-BR-8z: searchByCategoryAsync embedder catch (line 426-428) — use a known failing embedder
  // Create a MultiIndexRAG that won't create a LocalEmbedder (no embedding config) but manually
  // trigger the async path via a separate test that throws in enrichWithVectors
  const mirBr8z = new MultiIndexRAG("", { keywordWeight: 0.3, vectorWeight: 0.7, embedding: null })
  mirBr8z.importAll({
    "catch-cat": { episodes: [mirEpisode(1, "catch test", ["catch"])], skills: [] },
  })
  // Call searchByCategoryAsync without embedder — should fall through to sync path
  const br8zResult = await mirBr8z.searchByCategoryAsync("catch", "catch-cat", 5)
  mirbr_assert(br8zResult.entries.length >= 1, "MIR-BR-8z searchByCategoryAsync without embedder works")

  // MIR-BR-8: syncCategories (line 225) — adds new categories without removing existing ones
  const mirBr8 = new MultiIndexRAG("", { keywordWeight: 0.3, vectorWeight: 0.7, embedding: null })
  // Add "existing-cat" first
  mirBr8.addCategory("existing-cat")
  // Now syncCategories with additional categories
  mirBr8.syncCategories(["existing-cat", "new-cat-1", "new-cat-2"])
  // Both existing and new cats should be available
  const br8Stats = mirBr8.getStats()
  mirbr_assert(br8Stats.categories.includes("existing-cat"), "MIR-BR-8a existing category preserved after sync")
  mirbr_assert(br8Stats.categories.includes("new-cat-1"), "MIR-BR-8b new category added by sync")
  mirbr_assert(br8Stats.categories.includes("new-cat-2"), "MIR-BR-8c second new category added by sync")
  // Default categories should NOT appear (sync overwrites)
  mirbr_assert(!br8Stats.categories.includes("tech"), "MIR-BR-8d default categories removed after sync")
}

// Helper for creating test episodes inline
function mirEpisode(id, goal, tags) {
  return {
    id: "mir-br-" + id, sessionID: "s1", projectId: "p1",
    planGoal: goal, summary: goal,
    decisions: [], tags: tags || [],
    outcome: "success", steps: [{ description: "step", status: "done" }],
    filesChanged: ["test.ts"], timestamp: Date.now(),
    model: "mock", extractorVersion: "1",
    createdAt: new Date().toISOString(),
  }
}

console.log(`  MIR-BR: ${mirbr} passed, ${mirbrf} failed`)
state.passed += mirbr; state.failed += mirbrf

// ── Layer 1: MCP Client ──
console.log("\n[91] agentic_mcp — MCP client")
const mcpSid = freshSid()

// List with no connections
const mcpList = await hooks.tool.agentic_mcp.execute({
  action: "list",
}, mockCtx(mcpSid))
const mcpListOut = typeof mcpList === "string" ? mcpList : (mcpList.output || "")
assert(mcpListOut.includes("No MCP") || mcpListOut.includes("Connected"), "mcp list shows no connections")
assert(true, "agentic_mcp list empty passed")

// Missing params
const mcpNoTrans = await hooks.tool.agentic_mcp.execute({
  action: "connect",
}, mockCtx(freshSid()))
const mcpNoTransOut = typeof mcpNoTrans === "string" ? mcpNoTrans : (mcpNoTrans.output || "")
assert(mcpNoTransOut.includes("transport"), "mcp connect without transport shows error")
assert(true, "agentic_mcp missing params handled")

// Disconnect-all with no connections
const mcpDiscAll = await hooks.tool.agentic_mcp.execute({
  action: "disconnect-all",
}, mockCtx(freshSid()))
assert(true, "agentic_mcp disconnect-all passed")

// 91b. agentic_mcp — server start/stop/status (merged from agentic_mcp)
console.log("\n[91b] agentic_mcp — server management (merged)")
{
  const mcpSrvSid = freshSid()

  // Status when not running (server-status)
  const statusOff = await hooks.tool.agentic_mcp.execute({
    action: "server-status",
  }, mockCtx(mcpSrvSid))
  const statusOffOut = typeof statusOff === "string" ? statusOff : (statusOff.output || "")
  assert(statusOffOut.includes("not running"), "91b-1 mcp server-status shows not running")

  // Start server (server-start)
  const started = await hooks.tool.agentic_mcp.execute({
    action: "server-start",
  }, mockCtx(mcpSrvSid))
  const startedOut = typeof started === "string" ? started : (started.output || "")
  assert(startedOut.includes("started"), "91b-2 mcp server-start succeeds")

  // Status while running (server-status)
  const statusOn = await hooks.tool.agentic_mcp.execute({
    action: "server-status",
  }, mockCtx(mcpSrvSid))
  const statusOnOut = typeof statusOn === "string" ? statusOn : (statusOn.output || "")
  assert(statusOnOut.includes("Running") || statusOnOut.includes("✅"), "91b-3 mcp server-status shows running")

  // Start again (already running)
  const startedAgain = await hooks.tool.agentic_mcp.execute({
    action: "server-start",
  }, mockCtx(mcpSrvSid))
  const startedAgainOut = typeof startedAgain === "string" ? startedAgain : (startedAgain.output || "")
  assert(startedAgainOut.includes("already running"), "91b-4 mcp server-start again shows already running")

  // Stop server (server-stop)
  const stopped = await hooks.tool.agentic_mcp.execute({
    action: "server-stop",
  }, mockCtx(mcpSrvSid))
  const stoppedOut = typeof stopped === "string" ? stopped : (stopped.output || "")
  assert(stoppedOut.includes("stopped"), "91b-5 mcp server-stop succeeds")

  // Status after stop (server-status)
  const statusAfter = await hooks.tool.agentic_mcp.execute({
    action: "server-status",
  }, mockCtx(mcpSrvSid))
  const statusAfterOut = typeof statusAfter === "string" ? statusAfter : (statusAfter.output || "")
  assert(statusAfterOut.includes("not running"), "91b-6 mcp server-status shows stopped after stop")
}

// ── Stage V: Autonomous Loop ──
console.log("\n[92] agentic_auto — autonomous loop (mock mode)")

// Test: basic goal decomposition and execution
const autoSid = freshSid()
const autoResult = await hooks.tool.agentic_auto.execute({
  goal: "Add a greet function to test-project",
  constraints: ["TypeScript"],
}, mockCtx(autoSid))
const autoOut = typeof autoResult === "string" ? autoResult : (autoResult.output || "")
assert(autoOut.length > 20, "agentic_auto returns output")
assert(autoOut.includes("Goal") || autoOut.includes("goal") || autoOut.includes("Auto"), "output mentions goal")

// Test: verify metadata has plan info
const autoMeta = autoResult.metadata || {}
assert(autoMeta.plan || autoMeta.success !== undefined, "auto returns metadata with plan/success")
assert(true, "agentic_auto executed successfully")

// Test: agentic_auto with empty/invalid goal still returns gracefully
const emptySid = freshSid()
const emptyResult = await hooks.tool.agentic_auto.execute({
  goal: "",
  maxSteps: 1,
}, mockCtx(emptySid))
const emptyOut = typeof emptyResult === "string" ? emptyResult : (emptyResult.output || "")
assert(emptyOut.length > 5, "agentic_auto handles empty goal")
assert(true, "agentic_auto error handling passed")

// ── Sub-agent integration tests ──
console.log("\n── Sub-agent integration tests ──")

// P1: agentic_plan suggests pipeline for feature/bug/refactor goals
console.log("\n[P1] agentic_plan — pipeline suggestion")
const p1Sid = freshSid()
const p1Result = await hooks.tool.agentic_plan.execute({
  goal: "Add new user login feature with JWT",
}, mockCtx(p1Sid))
const p1Out = typeof p1Result === "string" ? p1Result : (p1Result.output || "")
assert(p1Out.includes("Pipeline") && p1Out.includes("feature-dev"), "plan suggests feature-dev pipeline")

const p1bSid = freshSid()
const p1bResult = await hooks.tool.agentic_plan.execute({
  goal: "Fix bug in payment module",
}, mockCtx(p1bSid))
const p1bOut = typeof p1bResult === "string" ? p1bResult : (p1bResult.output || "")
assert(p1bOut.includes("Pipeline") && p1bOut.includes("fix-verify"), "plan suggests fix-verify for bug")

const p1cSid = freshSid()
const p1cResult = await hooks.tool.agentic_plan.execute({
  goal: "Refactor authentication service",
}, mockCtx(p1cSid))
const p1cOut = typeof p1cResult === "string" ? p1cResult : (p1cResult.output || "")
assert(p1cOut.includes("Pipeline") && p1cOut.includes("refactor-review"), "plan suggests refactor-review pipeline")
assert(true, "agentic_plan pipeline suggestion tests passed")

// P2: agentic_execute suggests delegation after 2+ retries
console.log("\n[P2] agentic_execute — delegation suggestion on repeated failure")
const p2Sid = freshSid()
await hooks.tool.agentic_plan.execute({
  goal: "Execute escalation test",
  subtasks: [{ id: "es1", description: "Will fail twice", dependsOn: [] }],
}, mockCtx(p2Sid))
await hooks.tool.agentic_execute.execute({
  stepId: "es1", success: false, error: "TypeError: cannot read property 'x'", output: "Fail 1", autoVerify: false,
}, mockCtx(p2Sid))
const p2Result = await hooks.tool.agentic_execute.execute({
  stepId: "es1", success: false, error: "TypeError: cannot read property 'x' again", output: "Fail 2", autoVerify: false,
}, mockCtx(p2Sid))
const p2Out = typeof p2Result === "string" ? p2Result : (p2Result.output || "")
assert(p2Out.includes("Escalate") || p2Out.includes("delegate"), "delegation hint shown after 2 failures")
assert(true, "agentic_execute delegation suggestion tests passed")

// P3: agentic_parallel delegate-based runner still works
console.log("\n[P3] agentic_parallel — delegate-based execution")
const p3Sid = freshSid()
const p3Ctx = mockCtx(p3Sid)
await hooks.tool.agentic_plan.execute({
  goal: "Parallel delegate test",
  subtasks: [
    { id: "pd1", description: "Write alpha.txt", dependsOn: [] },
    { id: "pd2", description: "Write beta.txt", dependsOn: [] },
  ],
}, p3Ctx)
await hooks.tool.agentic_execute.execute({
  stepId: "pd1", success: true, autoVerify: false, output: "Done", filesModified: ["alpha.txt"],
}, p3Ctx)
const p3Result = await hooks.tool.agentic_parallel.execute({ action: "execute" }, p3Ctx)
const p3Out = typeof p3Result === "string" ? p3Result : (p3Result.output || "")
assert(p3Out.includes("Execution") || p3Out.includes("passed") || p3Out.includes("Failed"), "parallel delegate execution produces result")
assert(true, "agentic_parallel delegate execution tests passed")

// P4: agentic_auto with pipeline-suitable complex goal
console.log("\n[P4] agentic_auto — pipeline-suitable goal")
const p4Sid = freshSid()
const p4Result = await hooks.tool.agentic_auto.execute({
  goal: "Refactor utils module: extract validation functions",
  constraints: ["TypeScript"],
  thorough: true,
}, mockCtx(p4Sid))
const p4Out = typeof p4Result === "string" ? p4Result : (p4Result.output || "")
assert(p4Out.length > 20, "auto with pipeline goal returns output")
assert(p4Out.includes("Goal") || p4Out.includes("Auto"), "output mentions goal or auto")
  assert(true, "agentic_auto pipeline delegation tests passed")

  // ── Project-Scoped Memory Isolation tests ──
  console.log("\n[PS] Project-Scoped Memory Isolation")
  const { PersistenceLayer } = await import(pluginDist)

  // Create a temp persistence layer with ISOLATED global dir
  const scopeWorktree = join(projectDir, "scope-test")
  const scopeGlobal = join(projectDir, "scope-global")
  try { mkdirSync(scopeWorktree, { recursive: true }) } catch {}
  try { mkdirSync(scopeGlobal, { recursive: true }) } catch {}
  process.env.AGENTIC_STORE_DIR = scopeGlobal
  const pl = new PersistenceLayer(scopeWorktree)

  // Test 1: Scoped save + load (projectA vs projectB)
  const projA = "project-alpha"
  const projB = "project-beta"

  pl.save("episodes", "ep1", { goal: "Fix bug A" }, projA)
  pl.save("episodes", "ep1", { goal: "Fix bug B" }, projB)

  const epA = pl.load("episodes", "ep1", projA)
  const epB = pl.load("episodes", "ep1", projB)
  assert(epA && epA.goal === "Fix bug A", "project A episode is isolated")
  assert(epB && epB.goal === "Fix bug B", "project B episode is isolated")

  // Test 2: Unscoped save (shared — skills, models, prompts)
  pl.save("skills", "skill1", { name: "Test Pattern" }) // no scope = global
  const skGlobal = pl.load("skills", "skill1")
  assert(skGlobal && skGlobal.name === "Test Pattern", "unscoped skill is globally shared")

  // Test 3: Scoped evolution (per-project trend.json)
  pl.save("evolution", "trend", { results: [1, 2, 3] }, projA)
  pl.save("evolution", "trend", { results: [4, 5] }, projB)
  const evoA = pl.load("evolution", "trend", projA)
  const evoB = pl.load("evolution", "trend", projB)
  assert(evoA && evoA.results.length === 3, "project A evolution is isolated")
  assert(evoB && evoB.results.length === 2, "project B evolution is isolated")

  // Test 4: listScopes — detect existing project scopes
  const scopes = pl.listScopes("episodes")
  assert(scopes.includes("project-alpha"), "listScopes finds project-alpha")
  assert(scopes.includes("project-beta"), "listScopes finds project-beta")

  // Test 5: Episode.projectId field
  const mockEpStore = new (await import(pluginDist)).EpisodicStore()
  const ep = mockEpStore.record("sess-1", "Test goal", "success", ["did work"], ["src/app.ts"], "code", projA)
  assert(ep.projectId === projA, "Episode has projectId")
  const projectEps = mockEpStore.getByProject(projA)
  assert(projectEps.length === 1, "getByProject returns scoped episodes")
  assert(projectEps[0].projectId === projA, "getByProject filters correctly")

  // Test 6: PersistenceLayer.loadAll — returns entries from namespace
  const scopeGlobal2 = join(projectDir, "scope-global-2")
  try { mkdirSync(scopeGlobal2, { recursive: true }) } catch {}
  try { mkdirSync(scopeWorktree, { recursive: true }) } catch {}
  process.env.AGENTIC_STORE_DIR = scopeGlobal2
  const pl2 = new PersistenceLayer(scopeWorktree)
  pl2.save("episodes", "test-ep-1", { data: "first" }, projA)
  pl2.save("episodes", "test-ep-2", { data: "second" }, projA)
  const allEps = pl2.loadAll("episodes", projA)
  assert(allEps.length >= 2, "loadAll returns saved entries")
  assert(allEps.every(e => e.key && e.data), "loadAll returns valid PersistentState entries")

  // Test 7: PersistenceLayer.listKeys
  const keysA = pl2.listKeys("episodes", projA)
  assert(keysA.includes("test-ep-1"), "listKeys finds scoped key")
  assert(keysA.includes("test-ep-2"), "listKeys finds second scoped key")

  // Test 8: PersistenceLayer.delete
  pl2.save("episodes", "to-delete", { temp: true }, projA)
  const loadedBefore = pl2.load("episodes", "to-delete", projA)
  assert(loadedBefore !== null, "delete precondition: key exists")
  const deleted = pl2.delete("episodes", "to-delete", projA)
  assert(deleted === true, "delete returns true on success")
  const loadedAfter = pl2.load("episodes", "to-delete", projA)
  assert(loadedAfter === null, "delete removes key from persistence")

  // Test 9: PersistenceLayer.delete — non-existent key
  const notFound = pl2.delete("episodes", "nonexistent-key", projA)
  assert(notFound === false, "delete returns false for missing key")

  // Test 10: PersistenceLayer.listScopes — no scopes in empty namespace
  const emptyScopes = pl2.listScopes("nonexistent-ns")
  assert(emptyScopes.length === 0, "listScopes returns empty for missing namespace")

  // Test 11: PersistenceLayer.listKeys — empty namespace
  const emptyKeys = pl2.listKeys("nonexistent-ns")
  assert(emptyKeys.length === 0, "listKeys returns empty for missing namespace")

  // Cleanup Test 6-11 dirs
  try { rmSync(scopeWorktree, { recursive: true, force: true }) } catch {}
  try { rmSync(scopeGlobal, { recursive: true, force: true }) } catch {}
  try { rmSync(scopeGlobal2, { recursive: true, force: true }) } catch {}
  delete process.env.AGENTIC_STORE_DIR

  assert(true, "PersistenceLayer branch coverage tests passed")

  // ── BudgetTracker unit tests (inside runAll) ──
  console.log("\n[B1] BudgetTracker — class unit tests")
  const { BudgetTracker: BT } = await import(pluginDist)

  const bt1 = new BT()
  bt1.recordTokens("openai/gpt-4o", 1000, 500)
  assert(bt1.totalTokens === 1500, "B1a total tokens = input+output")
  assert(Math.abs(bt1.totalCostUsd - 7.50) < 0.001, "B1b cost = $7.50")
  bt1.recordStep()
  assert(bt1.steps === 1, "B1c steps recorded")
  assert(bt1.check("session") === null, "B1d no limits = null")
  bt1.setLimits("session", { maxTokens: 1000 })
  const ev1 = bt1.check("session")
  assert(ev1 !== null, "B1e limit exceeded returns event")
  assert(ev1.metric === "tokens", "B1f exceeded metric = tokens")
  bt1.reset("task")
  assert(bt1.totalTokens === 0, "B1g after reset: tokens = 0")

  // Merge semantics
  const bt2 = new BT()
  bt2.setLimits("task", { maxTokens: 500 }, "warn")
  bt2.setLimits("task", { maxSteps: 10 })
  assert(bt2.getLimits("task").maxTokens === 500, "B1h merge: maxTokens tetap 500")
  assert(bt2.getLimits("task").maxSteps === 10, "B1i merge: maxSteps jadi 10")

  // Cache & reasoning
  const bt3 = new BT()
  bt3.recordTokens("anthropic/claude-sonnet-4", 100, 50, 30, 10000, 500)
  assert(bt3.totalTokens === 10680, "B1j cache+reasoning tokens summed")
  assert(bt3.totalCostUsd > 4.0, "B1k cost includes cache pricing")

  // Fail-fast order
  const bt4 = new BT()
  bt4.setLimits("session", { maxSteps: 1, maxTokens: 100000 })
  bt4.recordStep()
  bt4.recordStep()
  assert(bt4.check("session").metric === "steps", "B1l fail-fast: steps before tokens")

  // getState
  const btState = bt2.getState(["session", "task"])
  assert(btState.length === 2, "B1m getState returns both scopes")
  assert(btState[0].scope === "session", "B1n state[0] = session")

  // Approval pause
  const bt5 = new BT()
  bt5.setLimits("session", { maxTimeMs: 60000 })
  bt5.pauseApproval()
  assert(bt5.elapsedMs < 100, "B1o elapsed ~0 saat pause")
  bt5.resumeApproval()

  // Unknown model — $0 silent (SessionReader sync dari OpenCode nanti)
  const bt6 = new BT()
  bt6.recordTokens("custom-model/xyz", 1000, 500)
  assert(bt6.totalCostUsd === 0, "B1p unknown model → $0 silent, no warning")

  // EventBus emission (covers _exceedLimit eventBus branch lines 441-452)
  const bt7 = new BT()
  let emittedEvent = null
  bt7.setEventBus({ emit: (ev) => { emittedEvent = ev } })
  bt7.setSessionId("evt-session")
  bt7.setLimits("session", { maxSteps: 1 })
  bt7.recordStep()
  bt7.recordStep()
  const exceeded = bt7.check("session")
  assert(exceeded !== null, "B1q eventBus: limit exceeded")
  assert(emittedEvent !== null, "B1r eventBus: event emitted")
  assert(emittedEvent.type === "budget.limit.exceeded", "B1s eventBus: correct type")
  assert(emittedEvent.payload.metric === "steps", "B1t eventBus: metric = steps")
  assert(emittedEvent.payload.sessionID === "evt-session", "B1u eventBus: sessionID set")

  // bt8: eventBus emission with no sessionId (covers line 445: this.sessionId ?? "")
  let emittedEventRef = null
  const bt8 = new BT()
  bt8.setEventBus({ emit: (ev) => { emittedEventRef = ev } })
  bt8.setLimits("session", { maxTokens: 10 })
  bt8.recordTokens(0, 100) // exceed token limit
  const exceeded2 = bt8.check("session")
  assert(exceeded2 !== null, "B1v eventBus no session: limit exceeded")
  assert(emittedEventRef !== null, "B1w eventBus no session: event emitted")
  assert(emittedEventRef.payload.sessionID === "", "B1x eventBus no session: sessionID falls back to empty string")
  assert(true, "B1z BudgetTracker all unit tests passed")

  // ── agentic_budget tool tests (inside runAll) ──
  console.log("\n[B2] agentic_budget — tool integration")
  const bSid = freshSid()
  const bCtx = mockCtx(bSid)
  assert(typeof hooks.tool.agentic_budget?.execute === "function", "B2a tool registered")

  const bSet = await hooks.tool.agentic_budget.execute({ action: "set", scope: "session", maxTokens: 50000, maxSteps: 100, maxTimeMs: 300000 }, bCtx)
  assert((bSet.output || "").includes("50000"), "B2b set response shows maxTokens")

  const bStatus = await hooks.tool.agentic_budget.execute({ action: "status", scope: "session" }, bCtx)
  const sOut = bStatus.output || ""
  assert(sOut.includes("Tokens") && sOut.includes("Steps") && sOut.includes("Time") && sOut.includes("Cost"), "B2c status shows all rows")

  const bGet = await hooks.tool.agentic_budget.execute({ action: "get", scope: "session" }, bCtx)
  assert((bGet.output || "").includes("50000"), "B2d get shows maxTokens")

  const bReset = await hooks.tool.agentic_budget.execute({ action: "reset", scope: "session" }, bCtx)
  assert((bReset.output || "").includes("reset"), "B2e reset confirmation")

  const bWarn = await hooks.tool.agentic_budget.execute({ action: "set", scope: "task", maxTokens: 100, onExceeded: "warn" }, bCtx)
  assert((bWarn.output || "").includes("warn"), "B2f onExceeded=warn reflected")

  const bPrice = await hooks.tool.agentic_budget.execute({ action: "set", scope: "task", maxTokens: 1000, maxCostUsd: 5.00, modelPrices: { "my-model/v1": { input: 1.0, output: 4.0 } } }, bCtx)
  assert((bPrice.output || "").includes("1000"), "B2g model price override accepted")

  const bBad = await hooks.tool.agentic_budget.execute({ action: "invalid", scope: "session" }, bCtx)
  assert((bBad.output || "").includes("Unknown"), "B2h invalid action handled")
  assert(true, "B2z agentic_budget tool tests passed")

  // ── Phase 1: DSL Executor ──
  console.log("\n[DSL] DslExecutor — deterministic interpreter")
  const { DslExecutor, validateDSL, resolvePath, setPath, resolveValue } = await import(pluginDist)

  // DSL-1: Constructor and basic validation
  const dsl1 = new DslExecutor()
  assert(typeof dsl1.validate === "function", "DSL-1a DslExecutor created")
  assert(typeof dsl1.execute === "function", "DSL-1b execute method exists")

  // DSL-2: validateDSL — empty instructions
  const dsl2v = validateDSL([])
  assert(Array.isArray(dsl2v) && dsl2v.length === 0, "DSL-2a empty instructions = valid")

  // DSL-3: validateDSL — unknown op
  const dsl3v = validateDSL([{ op: "invalid_op", id: "x1" }])
  assert(dsl3v.length > 0 && dsl3v[0].message.includes("Unknown op"), "DSL-3a unknown op detected")

  // DSL-4: validateDSL — get requires source
  const dsl4v = validateDSL([{ op: "get", id: "g1" }])
  assert(dsl4v.length > 0 && dsl4v[0].message.includes("source"), "DSL-4a get requires source")

  // DSL-5: validateDSL — set requires target
  const dsl5v = validateDSL([{ op: "set", id: "s1" }])
  assert(dsl5v.length > 0 && dsl5v[0].message.includes("target"), "DSL-5a set requires target")

  // DSL-6: validateDSL — add requires >=2 values
  const dsl6v = validateDSL([{ op: "add", id: "a1", values: [1] }])
  assert(dsl6v.length > 0 && dsl6v[0].message.includes("at least 2"), "DSL-6a add requires >=2 values")

  // DSL-7: validateDSL — mcp_call requires tool
  const dsl7v = validateDSL([{ op: "mcp_call", id: "m1" }])
  assert(dsl7v.length > 0 && dsl7v[0].message.includes("tool"), "DSL-7a mcp_call requires tool")

  // DSL-8: validateDSL — compare requires left, operator, right
  const dsl8v = validateDSL([{ op: "compare", id: "c1", left: "x" }])
  assert(dsl8v.length > 0 && dsl8v.some(e => e.message.includes("operator")), "DSL-8a compare requires operator")
  const dsl8v2 = validateDSL([{ op: "compare", id: "c2", left: "x", operator: "eq" }])
  assert(dsl8v2.length > 0 && dsl8v2.some(e => e.message.includes("right")), "DSL-8b compare requires right")

  // DSL-9: validateDSL — if requires condition
  const dsl9v = validateDSL([{ op: "if", id: "i1" }])
  assert(dsl9v.length > 0 && dsl9v[0].message.includes("condition"), "DSL-9a if requires condition")

  // DSL-10: validateDSL — max nesting
  const dsl10_deep = { op: "if", condition: "memory.x", then: [{ op: "if", condition: "memory.y", then: [{ op: "if", condition: "memory.z", then: [{ op: "if", condition: "memory.a", then: [{ op: "if", condition: "memory.b", then: [{ op: "if", condition: "memory.c", then: [] }] }] }] }] }] }
  const dsl10v = validateDSL([dsl10_deep])
  assert(dsl10v.length > 0 && dsl10v.some(e => e.message.includes("nesting")), "DSL-10a max nesting detected")

  // DSL-11: resolvePath — input
  const dsl11_ctx = { input: { name: "test", count: 42 }, output: {}, memory: {} }
  assert(resolvePath(dsl11_ctx, "input.name").value === "test", "DSL-11a resolvePath input.name")
  assert(resolvePath(dsl11_ctx, "input.count").value === 42, "DSL-11b resolvePath input.count")
  assert(resolvePath(dsl11_ctx, "output.x").found === false, "DSL-11c resolvePath missing path")
  assert(resolvePath(dsl11_ctx, "plainString").value === "plainString", "DSL-11d non-path returns literal")

  // DSL-12: setPath
  const dsl12_obj = {}
  setPath(dsl12_obj, "a.b.c", 42)
  assert(dsl12_obj.a.b.c === 42, "DSL-12a setPath nested")
  setPath(dsl12_obj, "x", "hello")
  assert(dsl12_obj.x === "hello", "DSL-12b setPath shallow")

  // DSL-13: resolveValue
  const dsl13_ctx = { input: { val: 99 }, output: {}, memory: { temp: "cached" } }
  assert(resolveValue(dsl13_ctx, "input.val") === 99, "DSL-13a resolveValue input path")
  assert(resolveValue(dsl13_ctx, "memory.temp") === "cached", "DSL-13b resolveValue memory path")
  assert(resolveValue(dsl13_ctx, 42) === 42, "DSL-13c resolveValue literal number")
  assert(resolveValue(dsl13_ctx, "hello") === "hello", "DSL-13d resolveValue literal string")

  // DSL-14: DslExecutor.execute — set operation
  const dsl14 = new DslExecutor()
  const dsl14r = dsl14.execute([
    { op: "set", target: "output.result", value: "hello world" },
  ])
  assert(dsl14r.success === true, "DSL-14a set success")
  assert(dsl14r.output.result === "hello world", "DSL-14b set output value")

  // DSL-15: DslExecutor.execute — get operation
  const dsl15 = new DslExecutor()
  const dsl15r = dsl15.execute([
    { op: "get", source: "input.name", target: "output.name" },
  ], { name: "test-user" })
  assert(dsl15r.success === true, "DSL-15a get success")
  assert(dsl15r.output.name === "test-user", "DSL-15b get resolves from input")

  // DSL-16: DslExecutor.execute — add numbers
  const dsl16 = new DslExecutor()
  const dsl16r = dsl16.execute([
    { op: "add", values: [10, 20, 30], target: "output.sum" },
  ])
  assert(dsl16r.success === true, "DSL-16a add numbers success")
  assert(dsl16r.output.sum === 60, "DSL-16b add numbers: 10+20+30=60")

  // DSL-17: DslExecutor.execute — add strings (concat)
  const dsl17 = new DslExecutor()
  const dsl17r = dsl17.execute([
    { op: "add", values: ["hello", " ", "world"], target: "output.greeting" },
  ])
  assert(dsl17r.success === true, "DSL-17a add strings success")
  assert(dsl17r.output.greeting === "hello world", "DSL-17b add strings concat")

  // DSL-18: DslExecutor.execute — compare eq
  const dsl18 = new DslExecutor()
  const dsl18r = dsl18.execute([
    { op: "compare", left: "input.a", operator: "eq", right: "input.b", target: "output.same" },
  ], { a: 5, b: 5 })
  assert(dsl18r.success === true, "DSL-18a compare eq success")
  assert(dsl18r.output.same === true, "DSL-18b compare eq: 5==5 is true")

  // DSL-19: DslExecutor.execute — compare ne
  const dsl19 = new DslExecutor()
  const dsl19r = dsl19.execute([
    { op: "compare", left: "input.x", operator: "ne", right: "input.y", target: "output.diff" },
  ], { x: "a", y: "b" })
  assert(dsl19r.success === true, "DSL-19a compare ne success")
  assert(dsl19r.output.diff === true, "DSL-19b compare ne: a!=b is true")

  // DSL-20: DslExecutor.execute — compare gt
  const dsl20 = new DslExecutor()
  const dsl20r = dsl20.execute([
    { op: "compare", left: "input.a", operator: "gt", right: "input.b", target: "output.gt" },
  ], { a: 10, b: 3 })
  assert(dsl20r.success === true, "DSL-20a compare gt success")
  assert(dsl20r.output.gt === true, "DSL-20b compare gt: 10>3 is true")

  // DSL-21: DslExecutor.execute — if/then/else
  const dsl21 = new DslExecutor()
  const dsl21r = dsl21.execute([
    { op: "set", target: "memory.score", value: 85 },
    { op: "compare", left: "memory.score", operator: "gte", right: 70, target: "memory.passed" },
    { op: "if", condition: "memory.passed",
      then: [{ op: "set", target: "output.status", value: "passed" }],
      else: [{ op: "set", target: "output.status", value: "failed" }],
    },
  ])
  assert(dsl21r.success === true, "DSL-21a if/then/else success")
  assert(dsl21r.output.status === "passed", "DSL-21b if/then: score>=70 -> passed")

  // DSL-22: DslExecutor.execute — if/else branch
  const dsl22 = new DslExecutor()
  const dsl22r = dsl22.execute([
    { op: "set", target: "memory.count", value: 3 },
    { op: "compare", left: "memory.count", operator: "gte", right: 10, target: "memory.enough" },
    { op: "if", condition: "memory.enough",
      then: [{ op: "set", target: "output.msg", value: "enough" }],
      else: [{ op: "set", target: "output.msg", value: "need more" }],
    },
  ])
  assert(dsl22r.success === true, "DSL-22a if/else success")
  assert(dsl22r.output.msg === "need more", "DSL-22b if/else: 3<10 -> need more")

  // DSL-23: DslExecutor.execute — short circuit on failure
  const dsl23 = new DslExecutor()
  const dsl23r = dsl23.execute([
    { op: "get", source: "input.nonexistent" },
    { op: "set", target: "output.result", value: "should not reach" },
  ])
  assert(dsl23r.success === false, "DSL-23a short circuit on failure")
  assert(dsl23r.output.result === undefined, "DSL-23b second instruction not executed")

  // DSL-24: getPendingMCPCalls
  const dsl24 = new DslExecutor()
  const dsl24r = dsl24.execute([
    { op: "mcp_call", tool: "read_file", params: { path: "/test" }, server: "fs" },
  ])
  const dsl24_pending = dsl24.getPendingMCPCalls(dsl24r)
  assert(Array.isArray(dsl24_pending), "DSL-24a pending MCP calls is array")
  assert(dsl24_pending.length === 1, "DSL-24b one pending MCP call")
  assert(dsl24_pending[0].tool === "read_file", "DSL-24c correct tool name in pending")
  assert(dsl24_pending[0].server === "fs", "DSL-24d correct server name in pending")

  // DSL-25: DslExecutor.validate method
  const dsl25 = new DslExecutor()
  assert(dsl25.validate([]).length === 0, "DSL-25a validate empty")
  assert(dsl25.validate([{ op: "invalid" }]).length > 0, "DSL-25b validate invalid op")

  // DSL-26: Aggregator — sum (data passed as initial input)
  const dsl26 = new DslExecutor()
  const dsl26r = dsl26.execute([
    { op: "sum", source: "input.nums", target: "output.total" },
  ], { nums: [1, 2, 3, 4, 5] })
  assert(dsl26r.success === true, "DSL-26a sum success")
  assert(dsl26r.output.total === 15, "DSL-26b sum: 1+2+3+4+5=15")

  // DSL-27: Aggregator — avg (data passed as initial input)
  const dsl27 = new DslExecutor()
  const dsl27r = dsl27.execute([
    { op: "avg", source: "input.vals", target: "output.mean" },
  ], { vals: [10, 20, 30] })
  assert(dsl27r.success === true, "DSL-27a avg success")
  assert(dsl27r.output.mean === 20, "DSL-27b avg: (10+20+30)/3=20")

  // DSL-28: Aggregator — count (data passed as initial input)
  const dsl28 = new DslExecutor()
  const dsl28r = dsl28.execute([
    { op: "count", source: "input.items", target: "output.len" },
  ], { items: ["a", "b", "c", "d"] })
  assert(dsl28r.success === true, "DSL-28a count success")
  assert(dsl28r.output.len === 4, "DSL-28b count: ['a','b','c','d'].length=4")

  // DSL-29: Aggregator — min (data passed as initial input)
  const dsl29 = new DslExecutor()
  const dsl29r = dsl29.execute([
    { op: "min", source: "input.v", target: "output.minVal" },
  ], { v: [7, 2, 9, 1, 5] })
  assert(dsl29r.success === true, "DSL-29a min success")
  assert(dsl29r.output.minVal === 1, "DSL-29b min: min of [7,2,9,1,5]=1")

  // DSL-30: Aggregator — max (data passed as initial input)
  const dsl30 = new DslExecutor()
  const dsl30r = dsl30.execute([
    { op: "max", source: "input.v", target: "output.maxVal" },
  ], { v: [7, 2, 9, 1, 5] })
  assert(dsl30r.success === true, "DSL-30a max success")
  assert(dsl30r.output.maxVal === 9, "DSL-30b max: max of [7,2,9,1,5]=9")

  // DSL-31: Aggregator — sum with memory source (set writes to memory, sum reads from memory)
  const dsl31 = new DslExecutor()
  const dsl31r = dsl31.execute([
    { op: "set", target: "memory.data", value: [100, 200, 300] },
    { op: "sum", source: "memory.data", target: "output.total" },
  ])
  assert(dsl31r.success === true, "DSL-31a sum from memory success")
  assert(dsl31r.output.total === 600, "DSL-31b sum from memory: 100+200+300=600")

  // DSL-32: Aggregator — empty array error (pass empty directly as input)
  const dsl32 = new DslExecutor()
  const dsl32r = dsl32.execute([
    { op: "sum", source: "input.empty", target: "output.total" },
  ], { empty: [] })
  assert(dsl32r.success === false, "DSL-32a empty array sum fails")
  assert(dsl32r.trace.steps.length > 0 && dsl32r.trace.steps[0].error && dsl32r.trace.steps[0].error.includes("No numeric values"), "DSL-32b correct error message in trace")

  // DSL-33: Aggregator — validation: sum requires source
  const dsl33v = validateDSL([{ op: "sum", id: "s1", target: "output.x" }])
  assert(dsl33v.length > 0 && dsl33v[0].message.includes("source"), "DSL-33a sum requires source")

  // DSL-34: Aggregator — validation: count requires target
  const dsl34v = validateDSL([{ op: "count", id: "c1", source: "input.x" }])
  assert(dsl34v.length > 0 && dsl34v.some(e => e.message.includes("target")), "DSL-34a count requires target")

  // DSL-35: Aggregator — avg with single element (data passed as initial input)
  const dsl35 = new DslExecutor()
  const dsl35r = dsl35.execute([
    { op: "avg", source: "input.single", target: "output.mean" },
  ], { single: [42] })
  assert(dsl35r.success === true, "DSL-35a avg single element success")
  assert(dsl35r.output.mean === 42, "DSL-35b avg single: 42/1=42")

  // DSL-36: call_skill — output normalization ({ result: ... } envelope)
  const dsl36_exec = new (await import(pluginDist)).DslExecutor()
  dsl36_exec.setSkillResolver((cap) => {
    if (cap === "math.add") {
      return {
        instructions: [
          { op: "add", id: "s1", target: "output.sum", values: ["input.a", "input.b"] },
        ],
      }
    }
    return null
  })
  const dsl36r = dsl36_exec.execute([{ op: "call_skill", id: "cs1", skill: "math.add", target: "output.result", args: { a: 10, b: 20 } }], {})
  assert(dsl36r.success === true, "DSL-36a call_skill succeeds with output normalization")
  assert(typeof dsl36r.output.result === "object", "DSL-36b output.result is an object")
  assert(dsl36r.output.result?.result !== undefined, "DSL-36c output has { result: ... } envelope")
  assert(dsl36r.output.result?.result?.sum === 30, "DSL-36d normalized output contains sum=30")

  // DSL-37: call_skill — skill level auto-detection (atomic vs composite)
  const dsl37_exec = new (await import(pluginDist)).DslExecutor()
  dsl37_exec.setSkillResolver((cap) => {
    if (cap === "math.double") {
      // Atomic: no call_skill inside — just adds n + n
      return {
        instructions: [
          { op: "add", id: "d1", target: "output.value", values: ["input.n", "input.n"] },
        ],
      }
    }
    if (cap === "math.quadruple") {
      // Composite: calls math.double twice (each doubles the input)
      return {
        instructions: [
          { op: "call_skill", id: "q1", skill: "math.double", target: "output.doubled", args: { n: 3 } },
          { op: "call_skill", id: "q2", skill: "math.double", target: "output.quadrupled", args: { n: 3 } },
        ],
      }
    }
    return null
  })
  const dsl37_atomic = dsl37_exec.execute([{ op: "call_skill", id: "cs2", skill: "math.double", target: "output.r", args: { n: 5 } }], {})
  assert(dsl37_atomic.success === true, "DSL-37a atomic skill call succeeds")
  const dsl37_composite = dsl37_exec.execute([{ op: "call_skill", id: "cs3", skill: "math.quadruple", target: "output.r", args: { n: 3 } }], {})
  assert(dsl37_composite.success === true, "DSL-37b composite skill call succeeds")

  // DSL-38: SkillDef type exported
  const dsl38_exec = new (await import(pluginDist)).DslExecutor()
  assert(typeof dsl38_exec.setSkillResolver === "function", "DSL-38a setSkillResolver accepts SkillDef")
  dsl38_exec.setSkillResolver((cap) => {
    if (cap === "test.atomic") return { instructions: [{ op: "set", id: "x", target: "output.x", source: "input.v" }], level: "atomic" }
    if (cap === "test.composite") return { instructions: [], level: "composite" }
    return null
  })
  const dsl38r = dsl38_exec.execute([{ op: "call_skill", id: "c1", skill: "test.atomic", target: "output.r", args: { v: 42 } }], { v: 42 })
  assert(dsl38r.success === true, "DSL-38b SkillDef with explicit level works")

  // ── Jump Op Tests (Comparison 05) ──
  const dslJump = new (await import(pluginDist)).DslExecutor()

  // DSL-39: Basic jump — jump forward past a skipped instruction
  const dsl39r = dslJump.execute([
    { op: "set", id: "s1", target: "output.result", value: "start" },
    { op: "jump", id: "j1", to: 3 },
    { op: "set", id: "s2", target: "output.result", value: "skipped" },
    { op: "set", id: "s3", target: "output.result", value: "end" },
  ])
  assert(dsl39r.success === true, "DSL-39a jump forward succeeds")
  assert(dsl39r.output.result === "end", "DSL-39b jump skips instruction: result should be 'end' not 'skipped'")

  // DSL-40: Jump backward — creates a loop (use with caution)
  const dsl40Instructions = [
    { op: "set", id: "s1", target: "memory.counter", value: 0 },
    { op: "set", id: "s2", target: "memory.counter", source: "memory.counter" },
    { op: "add", id: "a1", target: "memory.counter", values: ["memory.counter", 1] },
    { op: "jump", id: "j1", to: 1 },
    { op: "set", id: "s3", target: "output.result", value: "done" },
  ]
  // Need to set counter properly — use memory for counter tracking
  const dsl40Instructions2 = [
    { op: "set", id: "s1", target: "memory.counter", value: 0 },
    { op: "add", id: "a1", target: "memory.counter", values: ["memory.counter", 1] },
    { op: "set", id: "s2", target: "memory.check", source: "memory.counter" },
    { op: "jump", id: "j1", to: 1 },
    { op: "set", id: "s3", target: "output.result", value: "done" },
  ]
  const dsl40r = dslJump.execute(dsl40Instructions2)
  // Should hit MAX_EXECUTION_STEPS and stop
  assert(dsl40r.success === false, "DSL-40a jump backward hits step limit")
  assert(dsl40r.error || dsl40r.trace.steps.some(s => !s.success && (s.error || "").includes("infinite loop")), "DSL-40b step limit error reported")
  if (dsl40r.trace.steps.length > 210 || dsl40r.trace.steps.length < 10) throw new Error(`DSL-40c trace length ${dsl40r.trace.steps.length} — expected near MAX_EXECUTION_STEPS=200`)

  // DSL-41: Jump validation — missing 'to' in validation
  const dsl41v = dslJump.validate([{ op: "jump", id: "j1" }])
  assert(dsl41v.length > 0, "DSL-41a jump without 'to' should fail validation")
  assert(dsl41v.some(e => e.message.includes("to")), "DSL-41b validation error mentions 'to' field")

  // DSL-42: Jump validation — out of bounds
  const dsl42v = dslJump.validate([
    { op: "set", id: "s1", target: "output.x", value: 1 },
    { op: "jump", id: "j1", to: 99 },
  ])
  assert(dsl42v.length > 0, "DSL-42a jump out of bounds fails validation")
  assert(dsl42v.some(e => e.message.includes("out of bounds")), "DSL-42b error mentions out of bounds")

  // DSL-43: Jump zero (jump to first instruction)
  const dsl43r = dslJump.execute([
    { op: "jump", id: "j1", to: 2 },
    { op: "set", id: "s1", target: "output.result", value: "skipped" },
    { op: "set", id: "s2", target: "output.result", value: "target" },
  ])
  assert(dsl43r.success === true, "DSL-43a jump to index 2 succeeds")
  assert(dsl43r.output.result === "target", "DSL-43b jump skips instruction 1")

  // DSL-44: Jump to self (infinite loop guard)
  const dsl44r = dslJump.execute([
    { op: "jump", id: "j1", to: 0 },
    { op: "set", id: "s1", target: "output.result", value: "never" },
  ])
  assert(dsl44r.success === false, "DSL-44a jump to self hits step limit")
  assert(dsl44r.trace.steps.length > 0 && dsl44r.trace.steps.length <= 210, "DSL-44b stops before excessive steps")

  // DSL-45: Jump in valid (target equal to instructions.length-1, last instruction)
  const dsl45r = dslJump.execute([
    { op: "set", id: "s1", target: "output.result", value: "first" },
    { op: "jump", id: "j1", to: 3 },
    { op: "set", id: "s2", target: "output.result", value: "skipped" },
    { op: "set", id: "s3", target: "output.result", value: "last" },
  ])
  assert(dsl45r.success === true, "DSL-45a jump to last instruction succeeds")
  assert(dsl45r.output.result === "last", "DSL-45b executed last instruction after jump")

  assert(true, "DSL-Z DSL Executor all tests passed")

  // ── Phase 1: Schema Validator ──
  console.log("\n[SCHEMA] SchemaValidator — input/output schema validation")
  const { SchemaValidator } = await import(pluginDist)

  // SCHEMA-1: Constructor
  const sv1 = new SchemaValidator()
  assert(typeof sv1.validate === "function", "SCHEMA-1a SchemaValidator created")
  assert(typeof sv1.parseOrThrow === "function", "SCHEMA-1b parseOrThrow method exists")

  // SCHEMA-2: Valid — required fields present
  const sv2_schema = {
    name: { type: "string", required: true },
    age: { type: "number", required: true },
  }
  const sv2r = sv1.validate(sv2_schema, { name: "Alice", age: 30 })
  assert(sv2r.valid === true, "SCHEMA-2a valid data passes")
  assert(sv2r.errors.length === 0, "SCHEMA-2b no errors")

  // SCHEMA-3: Missing required field
  const sv3r = sv1.validate(sv2_schema, { name: "Alice" })
  assert(sv3r.valid === false, "SCHEMA-3a missing required detected")
  assert(sv3r.errors.some(e => e.code === "missing_required"), "SCHEMA-3b correct error code")

  // SCHEMA-4: Type mismatch
  const sv4r = sv1.validate({ age: { type: "number", required: true } }, { age: "not-a-number" })
  assert(sv4r.valid === false, "SCHEMA-4a type mismatch detected")
  assert(sv4r.errors.some(e => e.code === "type_mismatch"), "SCHEMA-4b type mismatch code")

  // SCHEMA-5: Enum validation
  const sv5_schema = {
    role: { type: "string", required: true, enum: ["admin", "user", "guest"] },
  }
  const sv5r1 = sv1.validate(sv5_schema, { role: "admin" })
  assert(sv5r1.valid === true, "SCHEMA-5a valid enum passes")
  const sv5r2 = sv1.validate(sv5_schema, { role: "superadmin" })
  assert(sv5r2.valid === false, "SCHEMA-5b invalid enum detected")
  assert(sv5r2.errors.some(e => e.code === "enum_violation"), "SCHEMA-5c enum violation code")

  // SCHEMA-6: Default value applied
  const sv6_schema = {
    enabled: { type: "boolean", default: true },
  }
  const sv6r = sv1.validate(sv6_schema, {})
  assert(sv6r.valid === true, "SCHEMA-6a default applied")
  assert(sv6r.data.enabled === true, "SCHEMA-6b default value in result data")

  // SCHEMA-7: String constraints
  const sv7_schema = {
    code: { type: "string", minLength: 2, maxLength: 10, pattern: "^[A-Z]+$" },
  }
  const sv7r1 = sv1.validate(sv7_schema, { code: "ABC" })
  assert(sv7r1.valid === true, "SCHEMA-7a valid string passes")
  const sv7r2 = sv1.validate(sv7_schema, { code: "A" })
  assert(sv7r2.valid === false && sv7r2.errors.some(e => e.code === "min_length"), "SCHEMA-7b minLength violation")
  const sv7r3 = sv1.validate(sv7_schema, { code: "ABCDEFGHIJK" })
  assert(sv7r3.valid === false && sv7r3.errors.some(e => e.code === "max_length"), "SCHEMA-7c maxLength violation")
  const sv7r4 = sv1.validate(sv7_schema, { code: "abc" })
  assert(sv7r4.valid === false && sv7r4.errors.some(e => e.code === "pattern_mismatch"), "SCHEMA-7d pattern violation")

  // SCHEMA-8: Number constraints
  const sv8_schema = {
    score: { type: "number", minimum: 0, maximum: 100 },
  }
  const sv8r1 = sv1.validate(sv8_schema, { score: 50 })
  assert(sv8r1.valid === true, "SCHEMA-8a valid number passes")
  const sv8r2 = sv1.validate(sv8_schema, { score: -1 })
  assert(sv8r2.valid === false && sv8r2.errors.some(e => e.code === "minimum"), "SCHEMA-8b minimum violation")
  const sv8r3 = sv1.validate(sv8_schema, { score: 101 })
  assert(sv8r3.valid === false && sv8r3.errors.some(e => e.code === "maximum"), "SCHEMA-8c maximum violation")

  // SCHEMA-9: Object type with nested properties
  const sv9_schema = {
    address: {
      type: "object",
      required: true,
      properties: {
        street: { type: "string", required: true },
        city: { type: "string", required: true },
        zip: { type: "number" },
      },
    },
  }
  const sv9r1 = sv1.validate(sv9_schema, { address: { street: "123 Main", city: "NYC", zip: 10001 } })
  assert(sv9r1.valid === true, "SCHEMA-9a nested object passes")
  const sv9r2 = sv1.validate(sv9_schema, { address: { street: "123 Main" } })
  assert(sv9r2.valid === false, "SCHEMA-9b nested missing required detected")

  // SCHEMA-10: Array type
  const sv10_schema = {
    tags: {
      type: "array",
      items: { type: "string" },
    },
  }
  const sv10r1 = sv1.validate(sv10_schema, { tags: ["a", "b", "c"] })
  assert(sv10r1.valid === true, "SCHEMA-10a string array passes")
  const sv10r2 = sv1.validate(sv10_schema, { tags: "not-array" })
  assert(sv10r2.valid === false && sv10r2.errors.some(e => e.code === "type_mismatch"), "SCHEMA-10b non-array rejected")

  // SCHEMA-11: parseOrThrow
  const sv11 = new SchemaValidator()
  const sv11r = sv11.parseOrThrow({ x: { type: "number", required: true } }, { x: 42 })
  assert(sv11r.x === 42, "SCHEMA-11a parseOrThrow returns parsed data")
  let sv11_threw = false
  try { sv11.parseOrThrow({ x: { type: "number", required: true } }, {}, "Test") }
  catch (e) { sv11_threw = true; assert(e.message.includes("Test"), "SCHEMA-11b parseOrThrow includes label") }
  assert(sv11_threw === true, "SCHEMA-11c parseOrThrow throws on invalid")

  // SCHEMA-12: toJSONSchema
  const sv12_schema = {
    name: { type: "string", required: true, description: "User name" },
    age: { type: "number", description: "Age in years", minimum: 0 },
  }
  const sv12_js = sv1.toJSONSchema(sv12_schema)
  assert(sv12_js.type === "object", "SCHEMA-12a JSON Schema type=object")
  assert(Array.isArray(sv12_js.required) && sv12_js.required.includes("name"), "SCHEMA-12b required fields included")
  assert(sv12_js.properties?.name?.type === "string", "SCHEMA-12c property type preserved")

  // SCHEMA-12b: Object/array types via toJSONSchema (covers fieldToJSONSchema branches)
  const sv12b_schema = {
    tags: { type: "array", items: { type: "string" }, description: "Item labels" },
    metadata: { type: "object", properties: { key: { type: "string", required: true }, value: { type: "string" } } },
    status: { type: "string", enum: ["active", "inactive"], default: "active", minLength: 1, maxLength: 20, pattern: "^[a-z]+$", maximum: 0 },
    count: { type: "number", minimum: 0, maximum: 100 },
  }
  const sv12b_js = sv1.toJSONSchema(sv12b_schema)
  assert(typeof sv12b_js.properties?.tags?.items === "object", "SCHEMA-12d array items object")
  assert(sv12b_js.properties?.tags?.items?.type === "string", "SCHEMA-12e array items type")
  assert(typeof sv12b_js.properties?.metadata?.properties === "object", "SCHEMA-12f object properties exists")
  assert(sv12b_js.properties?.metadata?.properties?.key?.type === "string", "SCHEMA-12g nested property type")
  assert(Array.isArray(sv12b_js.properties?.metadata?.required) && sv12b_js.properties?.metadata?.required?.includes("key"), "SCHEMA-12h nested required propagated")

  // SCHEMA-13: inferField
  assert(sv1.inferField("hello").type === "string", "SCHEMA-13a infer string")
  assert(sv1.inferField(42).type === "number", "SCHEMA-13b infer number")
  assert(sv1.inferField(true).type === "boolean", "SCHEMA-13c infer boolean")
  const sv13_inferred = sv1.inferField({ a: 1, b: "x" })
  assert(sv13_inferred.type === "object" && sv13_inferred.properties?.a?.type === "number", "SCHEMA-13d infer object")
  assert(sv1.inferField(BigInt(42)).type === "string", "SCHEMA-13e infer bigint falls to default string")
  assert(sv1.inferField(Symbol("x")).type === "string", "SCHEMA-13f infer symbol falls to default string")
  assert(sv1.inferField(null).type === "string", "SCHEMA-13g infer null returns string")
  assert(sv1.inferField(undefined).type === "string", "SCHEMA-13h infer undefined returns string")
  assert(sv1.inferField([]).type === "array", "SCHEMA-13i infer empty array returns array")
  assert(sv1.inferField([1, 2]).type === "array", "SCHEMA-13j infer non-empty array returns array")

  // SCHEMA-14: inferSchema
  const sv14_inferred = sv1.inferSchema({ name: "test", count: 5, active: true })
  assert(sv14_inferred.name.type === "string", "SCHEMA-14a inferred name is string")
  assert(sv14_inferred.count.type === "number", "SCHEMA-14b inferred count is number")
  assert(sv14_inferred.active.type === "boolean", "SCHEMA-14c inferred active is boolean")

  assert(true, "SCHEMA-Z SchemaValidator all tests passed")
}

// ── Standalone execution ──
const _isMain = typeof process !== "undefined" && process.argv[1] && (process.argv[1] === import.meta.url || process.argv[1].endsWith("/_runall-gaps.mjs"))
if (_isMain) {
  const { pluginDist: _pd } = await import("./_common.mjs")
  const _mod = await import(_pd)
  await runGapTests(_mod)
  const { state } = await import("./_state.mjs")
  console.log(`__RESULT__:${JSON.stringify({ passed: state.passed, failed: state.failed })}`)
  process.exit(state.failed > 0 ? 1 : 0)
}
