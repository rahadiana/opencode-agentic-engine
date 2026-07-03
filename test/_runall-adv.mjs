// test/_runall-adv.mjs — Part A: Advanced tests (VectorStore only — verifier moved to _runall-adv-verifier.mjs)
import { assert, section, mockCtx, freshSid, pluginDist, G, R, B, D, Y, RST, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, chmodSync, mkdtempSync, join, tmpdir, sdkMockClient, state, projectDir } from "./_common.mjs"

export async function runAdvancedTests(mod) {
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
console.log("\n[55] VectorStore — TF-IDF sparse retrieval")
const { VectorStore } = await import(pluginDist)
const vs = new VectorStore()

// Index documents
vs.index({
  id: "doc1", category: "general", title: "Hello world",
  content: "this is a test document for vector store",
  keywords: ["hello", "test"],
})
vs.index({
  id: "doc2", category: "general", title: "Arabic test",
  content: "السلام عليكم ورحمة الله وبركاته هذا نص تجريبي",
  keywords: ["arabic"],
})
vs.index({
  id: "doc3", category: "general", title: "Chinese test",
  content: "你好世界这是一个测试文档",
  keywords: ["chinese"],
})
vs.index({
  id: "doc4", category: "general", title: "Japanese test",
  content: "こんにちは世界 これはテスト文書です",
  keywords: ["japanese"],
})
vs.index({
  id: "doc5", category: "general", title: "Korean test",
  content: "안녕하세요 세계 이것은 테스트 문서입니다",
  keywords: ["korean"],
})
vs.index({
  id: "doc6", category: "general", title: "Russian test",
  content: "Привет мир это тестовый документ",
  keywords: ["russian"],
})

assert(vs.size === 6, "all 6 docs indexed")

// Search for a matching term
const results = vs.search("hello", "general", 5)
assert(results.length > 0, "TF-IDF search returns results")
assert(results[0].doc.id === "doc1", "doc1 ranked first for 'hello' query")
assert(results[0].score > 0, "TF-IDF score is positive")
assert(results[0].matchFields.includes("content") || results[0].matchFields.includes("title"), "match fields populated")

// Search in Russian — should find Russian doc
const russianResults = vs.search("тестовый", "general", 3)
assert(russianResults.length > 0, "Russian TF-IDF search returns results")
assert(russianResults[0].doc.id === "doc6", "Russian doc ranked first for Russian query")

// Search across all categories
const allResults = vs.searchAll("test", 10)
assert(allResults.length > 0, "searchAll returns results")
assert(allResults[0].score > 0, "searchAll score is positive")

assert(true, "VectorStore TF-IDF tests passed")

// ── LRUCache tests ──
console.log("\n[56] LRUCache — get/set/delete/eviction")
const { LRUCache } = await import(pluginDist)

// Test 1: Basic get/set
const cache1 = new LRUCache({ maxSize: 3 })
cache1.set("a", 1)
cache1.set("b", 2)
cache1.set("c", 3)
assert(cache1.get("a") === 1, "LRU-1 get returns value for existing key")
assert(cache1.get("d") === undefined, "LRU-2 get returns undefined for missing key")
assert(cache1.size === 3, "LRU-3 size is 3 after 3 inserts")

// Test 2: LRU eviction — evicts least recently used
const cache2 = new LRUCache({ maxSize: 3 })
cache2.set("a", 1)
cache2.set("b", 2)
cache2.set("c", 3)
cache2.set("d", 4) // should evict "a" (oldest)
assert(cache2.get("a") === undefined, "LRU-4 evicts oldest entry when full")
assert(cache2.get("d") === 4, "LRU-5 new entry is accessible")
assert(cache2.size === 3, "LRU-6 size stays at max after eviction")

// Test 3: Get updates recency — accessed key is not evicted
const cache3 = new LRUCache({ maxSize: 3 })
cache3.set("a", 1)
cache3.set("b", 2)
cache3.set("c", 3)
cache3.get("a")          // "a" becomes most recently used
cache3.set("d", 4)       // should evict "b" (now LRU), not "a"
assert(cache3.get("a") === 1, "LRU-7 accessed key survives eviction")
assert(cache3.get("b") === undefined, "LRU-8 non-accessed LRU key is evicted")
assert(cache3.get("c") === 3, "LRU-9 other keys preserved")
assert(cache3.get("d") === 4, "LRU-10 new key preserved")

// Test 4: Delete
const cache4 = new LRUCache({ maxSize: 5 })
cache4.set("a", 1)
cache4.set("b", 2)
cache4.set("c", 3)
const deleted = cache4.delete("b")
assert(deleted === true, "LRU-11 delete returns true for existing key")
assert(cache4.get("b") === undefined, "LRU-12 deleted key is not accessible")
assert(cache4.size === 2, "LRU-13 size decreases after delete")
assert(cache4.delete("nonexistent") === false, "LRU-14 delete returns false for missing key")

// Test 5: Update existing key
const cache5 = new LRUCache({ maxSize: 3 })
cache5.set("a", 1)
cache5.set("b", 2)
cache5.set("a", 99) // update "a" and move to MRU
cache5.set("c", 3)  // no eviction needed (still 3 unique keys)
assert(cache5.get("a") === 99, "LRU-15 update overwrites value")
assert(cache5.size === 3, "LRU-16 update does not increase size")

// Test 6: Eviction with key update (update + full cache)
const cache6 = new LRUCache({ maxSize: 2 })
cache6.set("x", 1)
cache6.set("y", 2)
cache6.set("x", 10) // update "x" makes it MRU
cache6.set("z", 3)  // should evict "y" (now LRU), not "x"
assert(cache6.get("x") === 10, "LRU-17 updated key survives eviction")
assert(cache6.get("y") === undefined, "LRU-18 non-updated key is evicted")
assert(cache6.get("z") === 3, "LRU-19 new key preserved")

// Test 7: Clear
const cache7 = new LRUCache({ maxSize: 5 })
cache7.set("a", 1)
cache7.set("b", 2)
cache7.clear()
assert(cache7.size === 0, "LRU-20 cache is empty after clear")
assert(cache7.get("a") === undefined, "LRU-21 get returns undefined after clear")

// Test 8: Default maxSize
const cache8 = new LRUCache()
for (let i = 0; i < 200; i++) cache8.set(`k${i}`, i)
assert(cache8.size === 100, `LRU-22 default maxSize is 100 (got ${cache8.size})`)

// Test 9: has()
const cache9 = new LRUCache({ maxSize: 3 })
cache9.set("a", 1)
assert(cache9.has("a") === true, "LRU-23 has returns true for existing key")
assert(cache9.has("b") === false, "LRU-24 has returns false for missing key")

// Test 10: keys() returns in LRU order
const cache10 = new LRUCache({ maxSize: 5 })
cache10.set("a", 1)
cache10.set("b", 2)
cache10.set("c", 3)
cache10.get("a") // "a" moves to MRU
cache10.set("d", 4)
cache10.set("e", 5)
const keys = cache10.keys()
assert(keys[0] === "b", `LRU-25 keys()[0] is LRU ("b") got "${keys[0]}"`)
assert(keys[keys.length - 1] === "e", `LRU-26 keys()[-1] is MRU ("e") got "${keys[keys.length - 1]}"`)

// Test 11: values() and entries()
const cache11 = new LRUCache({ maxSize: 3 })
cache11.set("a", 1)
cache11.set("b", 2)
const vals = cache11.values()
assert(vals.length === 2 && vals[0] === 1, "LRU-27 values() returns in LRU order")
const ents = cache11.entries()
assert(ents.length === 2 && ents[0][0] === "a" && ents[0][1] === 1, "LRU-28 entries() returns key-value pairs")

// Test 12: capacity getter
const cache12 = new LRUCache({ maxSize: 42 })
assert(cache12.capacity === 42, "LRU-29 capacity getter returns maxSize")

assert(true, "LRUCache tests passed")

}

// ── Standalone execution ──
const _isMain = typeof process !== "undefined" && process.argv[1] && (process.argv[1] === import.meta.url || process.argv[1].endsWith("/_runall-adv.mjs"))
if (_isMain) {
  const { pluginDist: _pd } = await import("./_common.mjs")
  const _mod = await import(_pd)
  await runAdvancedTests(_mod)
  const { state } = await import("./_state.mjs")
  console.log(`__RESULT__:${JSON.stringify({ passed: state.passed, failed: state.failed })}`)
  process.exit(state.failed > 0 ? 1 : 0)
}
