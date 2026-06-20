import type { LLMEngine } from "./llm.js"

/**
 * Predefined knowledge categories for multi-index RAG routing.
 * Each category has keywords, suggested tools, and a RAG index name.
 */
export interface RouteCategory {
  id: string
  name: string
  keywords: string[]
  description: string
  suggestedTools: string[]
  suggestedRagIndex: string
}

export interface RouteMatch {
  /** The original user input */
  input: string
  /** Detected intent summary */
  intent: string
  /** Matched category ID */
  category: string
  /** Confidence score 0-1 */
  confidence: number
  /** Whether LLM was used (vs pure keyword) */
  usedLlm: boolean
  /** Suggested tools for this route */
  suggestedTools: string[]
  /** Suggested RAG index for this route */
  suggestedRagIndex: string
  /** Brief reasoning for the route */
  reasoning: string
}

const DEFAULT_CATEGORIES: RouteCategory[] = [
  {
    id: "automotive",
    name: "Otomotif",
    keywords: ["mobil", "motor", "otomotif", "kendaraan", "sparepart", "bengkel", "mesin", "ban", "oli", "servis", "gear", "transmisi", "rem", "kopling", "aki", "karburator", "tune-up"],
    description: "Informasi dan data seputar otomotif, kendaraan, dan perbengkelan",
    suggestedTools: [],
    suggestedRagIndex: "knowledge-automotive",
  },
  {
    id: "financial",
    name: "Finansial",
    keywords: ["keuangan", "finansial", "bank", "saham", "investasi", "reksadana", "asuransi", "pajak", "budget", "akuntansi", "neraca", "laba", "rugi", "cashflow", "modal", "kredit", "hutang", "bunga", "deposito"],
    description: "Informasi keuangan, akuntansi, dan investasi",
    suggestedTools: [],
    suggestedRagIndex: "knowledge-financial",
  },
  {
    id: "personal",
    name: "Personal",
    keywords: ["saya", "aku", "nama", "alamat", "personal", "pribadi", "jadwal", "agenda", "kontak", "telepon", "email", "catatan", "todo", "tugas", "reminder", "pengingat"],
    description: "Data personal, jadwal, kontak, dan catatan pribadi",
    suggestedTools: [],
    suggestedRagIndex: "knowledge-personal",
  },
    {
    id: "tech",
    name: "Teknologi",
    keywords: ["code", "kode", "program", "aplikasi", "website", "database", "api", "server", "bug", "feature", "deploy", "git", "npm", "docker", "typescript", "react", "node", "python", "rust", "backend", "frontend", "fullstack", "javascript", "java", "go", "php", "html", "css", "sql", "linux", "macos", "windows", "config", "setup", "install", "error", "test", "build", "compile", "fix", "refactor", "implement", "module", "class", "function", "import", "export", "interface", "type", "variable", "array", "object", "string", "number", "boolean", "async", "await", "promise", "callback", "middleware", "route", "controller", "service", "model", "view", "component", "hook", "state", "props", "event", "handler", "listener", "socket", "stream", "buffer", "file", "dir", "folder", "path", "url", "http", "https", "fetch", "ajax", "json", "xml", "yaml", "toml", "markdown", "readme", "license", "changelog", "test", "spec", "mock", "stub", "spy", "assert", "expect", "should", "suite", "benchmark", "perf", "optimize", "secure", "auth", "login", "register", "token", "jwt", "oauth", "session", "cookie", "cache", "queue", "worker", "thread", "process", "cluster", "scale", "load", "stress", "monitor", "log", "debug", "trace", "metric", "alert", "notification", "email", "sms", "push", "websocket", "graphql", "rest", "grpc", "soap", "microservice", "monolith", "serverless", "lambda", "container", "kubernetes", "k8s", "pod", "service", "ingress", "helm", "chart", "ansible", "terraform", "ci", "cd", "pipeline", "action", "workflow", "job", "cron", "schedule", "event", "message", "broker", "kafka", "rabbitmq", "redis", "mongo", "postgres", "mysql", "sqlite", "orm", "query", "schema", "migration", "seed", "transaction", "index", "key", "foreign", "primary", "unique", "constraint", "trigger", "procedure", "function", "view", "table", "column", "row", "cell", "data", "information", "content", "document", "file", "attachment", "upload", "download", "sync", "async", "batch", "real", "time", "stream", "live", "realtime", "ssr", "csr", "spa", "pwa", "mobile", "desktop", "cli", "gui", "terminal", "console", "shell", "bash", "zsh", "sh", "script", "command", "argument", "flag", "option", "param", "env", "variable", "config", "setting", "preference", "default", "custom", "override", "inherit", "extend", "mixin", "trait", "impl", "abstract", "concrete", "static", "dynamic", "typed", "untyped", "safe", "nullable", "optional", "required", "readonly", "mutable", "immutable", "pure", "side", "effect", "monad", "functor", "pipe", "compose", "curry", "partial", "recursive", "iterative", "loop", "while", "for", "each", "map", "filter", "reduce", "find", "some", "every", "includes", "sort", "reverse", "concat", "slice", "splice", "split", "join", "replace", "match", "search", "indexof", "tolowercase", "touppercase", "trim", "pad", "repeat", "flat", "flatmap", "entries", "keys", "values", "assign", "freeze", "seal", "define", "proxy", "reflect", "symbol", "iterator", "generator", "yield", "next", "throw", "return", "try", "catch", "finally", "throw", "error", "exception", "stack", "trace", "message", "name", "cause", "reject", "resolve", "settle", "race", "all", "allsettled", "anys", "prototype", "proto", "constructor", "new", "instanceof", "typeof", "void", "delete", "in", "with", "this", "super", "class", "extends", "implements", "interface", "enum", "namespace", "module", "declare", "export", "import", "require", "from", "as", "default", "readonly", "private", "public", "protected", "static", "abstract", "virtual", "override", "sealed", "final", "const", "let", "var", "function", "return", "if", "else", "switch", "case", "break", "continue", "default", "throw", "try", "catch", "finally", "for", "while", "do", "in", "of", "async", "await", "yield", "generator", "arrow", "lambda", "closure", "scope", "block", "hoist", "iife", "module", "commonjs", "esm", "umd", "amd", "system", "bundle", "pack", "chunk", "tree", "shake", "minify", "uglify", "compress", "gzip", "brotli", "cache", "store", "persist", "memoize", "debounce", "throttle", "cancel", "abort", "signal", "timeout", "interval", "delay", "request", "response", "header", "body", "status", "method", "get", "post", "put", "patch", "delete", "head", "options", "connect", "trace"],


    description: "Pengembangan perangkat lunak, programming, dan teknologi",
    suggestedTools: [],
    suggestedRagIndex: "knowledge-tech",
  },
  {
    id: "general",
    name: "General",
    keywords: [],
    description: "Pengetahuan umum yang tidak masuk kategori khusus",
    suggestedTools: [],
    suggestedRagIndex: "knowledge-general",
  },
]



export class RouterAgent {
  private categories: RouteCategory[]
  private llmEngine: LLMEngine | null

  constructor(
    llmEngine?: LLMEngine,
    categories?: RouteCategory[],
  ) {
    this.categories = categories ?? DEFAULT_CATEGORIES
    this.llmEngine = llmEngine ?? null
  }

  setCategories(categories: RouteCategory[]): void {
    this.categories = categories
  }

  getCategories(): RouteCategory[] {
    return [...this.categories]
  }

  /** Update the LLM engine reference */
  setLLM(llm: LLMEngine): void {
    this.llmEngine = llm
  }

  hasLLM(): boolean {
    return this.llmEngine !== null
  }

  /**
   * Fast keyword-based routing — no LLM call needed.
   * Returns null if no clear match found (confidence < 0.3).
   */
  keywordRoute(input: string): RouteMatch | null {
    const normalizedInput = input.toLowerCase()
    const matches: Array<{ category: RouteCategory; score: number; matchedKeywords: string[] }> = []

    for (const cat of this.categories) {
      if (cat.keywords.length === 0) continue
      let score = 0
      const matchedKeywords: string[] = []
      const kwSet = new Set(cat.keywords.map(k => k.toLowerCase()))

      for (const word of normalizedInput.split(/\s+/)) {
        if (kwSet.has(word)) {
          score += 1
          matchedKeywords.push(word)
        }
      }

      if (score > 0) {
        matches.push({ category: cat, score, matchedKeywords })
      }
    }

    if (matches.length === 0) {
      return null
    }

    matches.sort((a, b) => b.score - a.score)
    const top = matches[0]
    const maxPossible = Math.max(2, normalizedInput.split(/\s+/).length)
    const confidence = Math.min(1.0, top.score / maxPossible)

    if (confidence < 0.3) return null

    return {
      input,
      intent: `Related to ${top.category.name}`,
      category: top.category.id,
      confidence: parseFloat(confidence.toFixed(2)),
      usedLlm: false,
      suggestedTools: top.category.suggestedTools,
      suggestedRagIndex: top.category.suggestedRagIndex,
      reasoning: `Keyword match: ${top.matchedKeywords.slice(0, 5).join(", ")}${top.matchedKeywords.length > 5 ? ` +${top.matchedKeywords.length - 5} more` : ""}`,
    }
  }

  /**
   * Extract meaningful keywords from user input for RAG search.
   *
   * Strategy:
   * 1. Tokenize input (split by whitespace/punctuation)
   * 2. Filter out common stop words (English + Indonesian)
   * 3. Detect category from matched keywords
   * 4. Score and rank keywords by relevance
   *
   * Returns deduplicated, ranked keywords + detected category.
   */
  extractKeywords(input: string): { keywords: string[]; category: string } {
    // Common stop words (English + Indonesian)
    const stopWords = new Set([
      "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
      "have", "has", "had", "do", "does", "did", "will", "would", "could",
      "should", "may", "might", "shall", "can", "need", "dare", "ought",
      "used", "to", "of", "in", "for", "on", "with", "at", "by", "from",
      "as", "into", "through", "during", "before", "after", "above", "below",
      "between", "out", "off", "over", "under", "again", "further", "then",
      "once", "here", "there", "when", "where", "why", "how", "all", "each",
      "every", "both", "few", "more", "most", "other", "some", "such", "no",
      "nor", "not", "only", "own", "same", "so", "than", "too", "very", "just",
      "because", "but", "and", "or", "if", "while", "although", "though",
      "what", "which", "who", "whom", "this", "that", "these", "those",
      "it", "its", "i", "me", "my", "we", "our", "you", "your", "he", "him",
      "his", "she", "her", "they", "them", "their",
      // Indonesian
      "dan", "di", "ke", "dari", "yang", "ini", "itu", "dengan", "untuk",
      "pada", "adalah", "telah", "sudah", "akan", "bisa", "dapat", "tidak",
      "ada", "juga", "atau", "saya", "kami", "kita", "mereka", "dia",
      "oleh", "sebagai", "tentang", "karena", "jika", "saat", "setelah",
      "sebelum", "antara", "tanpa", "sambil", "meski", "walaupun",
      "sangat", "agak", "cukup", "paling", "semua", "masing", "sendiri",
      "hal", "banyak", "sedikit", "lain", "baru", "lama", "besar", "kecil",
      "tolong", "mohon", "silakan", "terima", "kasih", "maaf",
    ])

    const normalized = input.toLowerCase()
    const tokens = normalized.split(/[\s,.;:!?(){}[\]"'/\\@#$%^&*+=<>~`|]+/).filter(t => t.length > 2)

    // Score each token by relevance
    const scored = new Map<string, number>()
    const matchedCategory = new Map<string, number>()

    for (const token of tokens) {
      if (stopWords.has(token)) continue
      if (/^\d+$/.test(token)) continue  // skip pure numbers

      const currentScore = scored.get(token) ?? 0
      scored.set(token, currentScore + 1)

      // Bonus if token matches a category keyword
      for (const cat of this.categories) {
        if (cat.keywords.some(kw => kw.toLowerCase() === token)) {
          matchedCategory.set(cat.id, (matchedCategory.get(cat.id) ?? 0) + 2)
          scored.set(token, (scored.get(token) ?? 0) + 2)
        }
      }
    }

    // Sort by score descending
    const sorted = [...scored.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)  // max 10 keywords
      .map(([word]) => word)

    // Detect best category
    let bestCategory = "general"
    let bestScore = 0
    for (const [cat, score] of matchedCategory) {
      if (score > bestScore) {
        bestScore = score
        bestCategory = cat
      }
    }

    return { keywords: sorted, category: bestCategory }
  }

  /**
   * Routing with LLM fallback — keyword first, LLM if confidence < threshold.
   */
  async route(input: string): Promise<RouteMatch> {
    const keywordResult = this.keywordRoute(input)

    // Jika keyword confidence >= 0.3, pakai keyword result
    if (keywordResult && keywordResult.confidence >= 0.3) {
      return keywordResult
    }

    // LLM fallback: jika keyword gagal (null or < 0.3) dan LLM tersedia
    if (this.llmEngine) {
      try {
        const categoryList = this.categories
          .filter(c => c.id !== "general")
          .map(c => `- "${c.id}": ${c.description}`)
          .join("\n")

        const resp = await this.llmEngine.call({
          systemPrompt: `You are an intent classifier. Given user input, classify it into one of these categories:\n\n${categoryList}\n\n- "general": anything else\n\nReturn ONLY a JSON object with keys: category (string), confidence (0.0-1.0), reasoning (string). No other text.`,
          userPrompt: `Classify this input: "${input}"`,
          temperature: 0.1,
          jsonMode: true,
        })

        const cleaned = resp.content.trim()
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0])
          const catId = parsed.category || "general"
          const matchedCat = this.categories.find(c => c.id === catId)
          const confidence = Math.min(1, Math.max(0, parsed.confidence ?? 0.5))
          return {
            input,
            intent: matchedCat ? `Terkait ${matchedCat.name}` : "Pengetahuan umum",
            category: catId,
            confidence: parseFloat(confidence.toFixed(2)),
            usedLlm: true,
            suggestedTools: matchedCat?.suggestedTools ?? [],
            suggestedRagIndex: matchedCat?.suggestedRagIndex ?? "knowledge-general",
            reasoning: parsed.reasoning ?? `LLM classified as ${catId}`,
          }
        }
      } catch (e) {
        console.error(`[RouterAgent] LLM fallback failed:`, e)
      }
    }

    // Ultimate fallback: general category
    const generalCat = this.categories.find(c => c.id === "general")
    return {
      input,
      intent: "Pengetahuan umum",
      category: "general",
      confidence: 0.3,
      usedLlm: false,
      suggestedTools: generalCat?.suggestedTools ?? [],
      suggestedRagIndex: generalCat?.suggestedRagIndex ?? "knowledge-general",
      reasoning: keywordResult
        ? `Keyword confidence too low (${keywordResult.confidence}), fallback ke general`
        : "No keyword match, fallback ke general",
    }
  }

}

/**
 * Create a custom category for routing.
 */
export function createCategory(
  id: string,
  name: string,
  keywords: string[],
  description: string,
  tools?: string[],
): RouteCategory {
  return {
    id,
    name,
    keywords,
    description,
    suggestedTools: tools ?? [],
    suggestedRagIndex: `knowledge-${id}`,
  }
}
