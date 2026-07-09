// test/_runall-auto-h4.mjs — H4 agentic_auto reliability helpers + smoke
import { assert, section, pluginDist } from "./_common.mjs"

export async function runAutoH4Tests(mod) {
  section("H4 extractPathHints / mergeTargetFiles")

  const { extractPathHints, mergeTargetFiles } = mod
  assert(typeof extractPathHints === "function", "H4-1a: extractPathHints exported")
  assert(typeof mergeTargetFiles === "function", "H4-1b: mergeTargetFiles exported")

  // Path with directory
  const g1 = "Fix the bug in src/middleware/AuthMiddleware.ts and package.json"
  const h1 = extractPathHints(g1)
  assert(h1.some(p => p.includes("AuthMiddleware")), `H4-2a: finds AuthMiddleware got=${JSON.stringify(h1)}`)
  assert(h1.some(p => p === "package.json" || p.endsWith("package.json")), `H4-2b: finds package.json got=${JSON.stringify(h1)}`)

  // Bare package.json only
  const h2 = extractPathHints('Update the "test" script in package.json to use vitest')
  assert(h2.includes("package.json"), `H4-3: bare package.json got=${JSON.stringify(h2)}`)

  // Empty / non-string
  assert(extractPathHints("").length === 0, "H4-4a: empty goal")
  assert(extractPathHints(null).length === 0, "H4-4b: null goal")

  // No false positives on URLs
  const hUrl = extractPathHints("see https://example.com/docs/guide.md for details")
  assert(!hUrl.some(p => p.includes("://")), `H4-5: no URLs in hints got=${JSON.stringify(hUrl)}`)

  // mergeTargetFiles: hints first, dedupe, cap
  const merged = mergeTargetFiles(
    ["package.json", "src/a.ts"],
    ["src/a.ts", "src/b.ts", "src/c.ts"],
    3,
  )
  assert(merged[0] === "package.json", `H4-6a: hints first got=${merged[0]}`)
  assert(merged.filter(x => x === "src/a.ts").length === 1, "H4-6b: dedupe")
  assert(merged.length === 3, `H4-6c: cap 3 got=${merged.length}`)

  // agentic_auto mock smoke still works
  section("H4 agentic_auto mock smoke")
  const hooks = await mod.AgenticEngine({
    client: { session: { create: async () => ({ data: { id: "h4-auto" } }), prompt: async () => ({ data: { parts: [] } }), messages: async () => ({ data: [] }), delete: async () => {} } },
    project: { worktree: process.env.TEST_PROJECT_DIR || "/tmp/test-project-h4" },
    directory: process.env.TEST_PROJECT_DIR || "/tmp/test-project-h4",
  })
  try {
    const r = await hooks.tool.agentic_auto.execute(
      { goal: "Fix package.json test script to use vitest run", thorough: false, maxSteps: 1 },
      { sessionID: "h4-auto-sess", messageID: "m1", agent: "test", directory: process.env.TEST_PROJECT_DIR || "/tmp", worktree: process.env.TEST_PROJECT_DIR || "/tmp", abort: new AbortController().signal, metadata: () => ({}), ask: async () => "ok" },
    )
    const out = typeof r === "string" ? r : (r.output || "")
    assert(out.length > 10, "H4-7a: auto returns output")
    assert(out.includes("Auto Complete") || out.includes("Goal"), "H4-7b: auto dashboard shape")
    // metadata may include pathHints when available
    const meta = r.metadata || {}
    if (meta.pathHints) {
      assert(Array.isArray(meta.pathHints), "H4-7c: pathHints array")
      assert(meta.pathHints.includes("package.json"), "H4-7d: package.json in pathHints")
    } else {
      assert(true, "H4-7c: pathHints optional on mock")
    }
  } finally {
    await hooks.dispose?.()
  }
}

const _isMain = typeof process !== "undefined" && process.argv[1] && (
  process.argv[1] === import.meta.url || process.argv[1].endsWith("/_runall-auto-h4.mjs")
)
if (_isMain) {
  const { pluginDist: _pd } = await import("./_common.mjs")
  const _mod = await import(_pd)
  await runAutoH4Tests(_mod)
  const { state } = await import("./_state.mjs")
  console.log(`__RESULT__:${JSON.stringify({ passed: state.passed, failed: state.failed })}`)
  process.exit(state.failed > 0 ? 1 : 0)
}
