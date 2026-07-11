export type VerificationEvidence = {
  build?: "passed" | "failed" | "skipped"
  lint?: "passed" | "failed" | "skipped"
  techDebt?: "low" | "medium" | "high" | "critical"
  tests?: Array<{ command?: string; passed?: number; failed?: number }>
}

// ── Helpers for agentic_fetch auto-indexing ──
/** Detect content type: HTML page, source code, JSON, or plain text */
export function _detectContentType(content: string, contentTypeHeader: string, url: string): "html" | "code" | "json" | "text" {
  if (contentTypeHeader.startsWith("text/html") || contentTypeHeader.startsWith("application/xhtml")) return "html"
  if (contentTypeHeader.startsWith("application/json") || url.match(/\.json$/i)) return "json"
  if (content.match(/^\s*</)) return "html"
  if (url.match(/\.(ts|js|tsx|jsx|mjs|cjs|mts|cts|py|rs|go|java|c|cpp|h|hpp|rb|php|swift|kt|scala|ex|exs|hs|lua|r|sh|bash|zsh|fish|sql|graphql|css|scss|less|sass|vue|svelte|astro)$/i)) return "code"
  return "text"
}
/** Extract readable text from HTML while preserving <pre>/<code> blocks */
function _htmlToText(html: string): string {
  const codeBlocks: string[] = []
  const saved = html.replace(/<(pre|code)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi, (_, _tag, inner) => {
    codeBlocks.push(inner.replace(/<[^>]+>/g, "").trim())
    return `\n---CODEBLOCK${codeBlocks.length - 1}---\n`
  })
  return saved
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/---CODEBLOCK(\d+)---/g, (_, idx) => `\n\`\`\`\n${codeBlocks[parseInt(idx as string)] || ""}\n\`\`\`\n`)
}
/** Extract meaningful summary based on content type */
function _extractSummary(content: string, type: "html" | "code" | "json" | "text"): string {
  if (type === "code") {
    const lines = content.split("\n").filter(l => l.trim() && !l.trim().startsWith("//") && !l.trim().startsWith("/*") && !l.trim().startsWith("*"))
    const sigLines = lines.slice(0, Math.min(15, lines.length)).join("\n")
    const totalLines = content.split("\n").length
    return `${sigLines.slice(0, 800)}\n\n(... ${totalLines} total lines, ${content.length} chars)`
  }
  if (type === "json") {
    const first = content.replace(/\s+/g, " ").trim().slice(0, 500)
    const keys = content.match(/"([^"]+)":/g)?.slice(0, 10).map(k => k.replace(/[":]/g, "")) || []
    return `${first}\n\nTop keys: ${keys.join(", ")}`
  }
  return content.replace(/\s+/g, " ").trim().slice(0, 1000)
}
/** Build tags for a fetched URL */
function _buildFetchTags(url: string, ctype: string): string[] {
  const tags: string[] = ["web-fetch"]
  const parts = url.split("/").filter(Boolean).slice(-3).map(t => t.replace(/[^a-zA-Z0-9-]/g, "").toLowerCase()).filter(Boolean)
  tags.push(...parts)
  if (ctype === "code") {
    tags.push("source-code")
    const ext = url.match(/\.([a-z0-9]+)(?:\?|$)/i)?.[1] || ""
    if (ext) tags.push(`ext-${ext}`)
    const langMap: Record<string, string> = { ts: "typescript", js: "javascript", py: "python", rs: "rust", go: "golang", rb: "ruby", java: "java", cs: "csharp", php: "php", swift: "swift", kt: "kotlin" }
    if (langMap[ext]) tags.push(langMap[ext])
  } else if (ctype === "html") {
    tags.push("html")
  } else if (ctype === "json") {
    tags.push("json")
  }
  if (tags.length < 2) tags.push("web-research")
  return [...new Set(tags)]
}

function _evidenceToSignals(evidence?: VerificationEvidence): Partial<import("./core/confidence-scorer.js").ScoringSignals> {
  if (!evidence) return {}
  const testTotals = evidence.tests?.reduce<{ passed: number; failed: number }>((acc, t) => {
    acc.passed += t.passed ?? 0
    acc.failed += t.failed ?? 0
    return acc
  }, { passed: 0, failed: 0 })
  const totalTests = testTotals ? testTotals.passed + testTotals.failed : 0
  return {
    compileResult: evidence.build && evidence.build !== "skipped" ? { passed: evidence.build === "passed" } : undefined,
    lintResult: evidence.lint && evidence.lint !== "skipped" ? { passed: evidence.lint === "passed" } : undefined,
    testResult: testTotals && totalTests > 0 ? { passed: testTotals.failed === 0, total: totalTests, passedCount: testTotals.passed } : undefined,
    techDebtScore: evidence.techDebt ? { overall: evidence.techDebt } : undefined,
  }
}

