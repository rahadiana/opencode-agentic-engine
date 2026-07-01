import { createLogger } from "../observability/logger.js"
import type { LLMEngine } from "./llm.js"
import { SchemaValidator, type SchemaField } from "./skill-schema.js"
import { ValidationError } from "./errors.js"

const log = createLogger("Router")

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

export interface RouterClassificationPayload {
  category: string
  confidence: number
  reasoning: string
}

const routerClassificationSchema: Record<string, SchemaField> = {
  category: { type: "string", required: true, minLength: 1 },
  confidence: { type: "number", required: true, minimum: 0, maximum: 1 },
  reasoning: { type: "string", required: true, minLength: 1 },
}

const routerClassificationSchemaValidator = new SchemaValidator()

export function parseRouterClassificationPayload(raw: string): RouterClassificationPayload | null {
  const cleaned = raw.trim()
  const jsonText = cleaned.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)?.[1]
    ?? cleaned.match(/\{[\s\S]*\}/)?.[0]
    ?? cleaned

  try {
    const data = JSON.parse(jsonText)
    if (!data || typeof data !== "object" || Array.isArray(data)) return null
    const result = routerClassificationSchemaValidator.validate(routerClassificationSchema, data as Record<string, unknown>, { allowExtraFields: false })
    if (!result.valid) return null
    return {
      category: result.data.category as string,
      confidence: result.data.confidence as number,
      reasoning: result.data.reasoning as string,
    }
  } catch {
    return null
  }
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
    keywords: ["saya", "aku", "kamu", "nama", "alamat", "personal", "pribadi", "jadwal", "agenda", "kontak", "telepon", "email", "catatan", "todo", "tugas", "reminder", "pengingat", "lagi", "sedang", "lakukan", "melakukan", "kerjakan", "aktivitas", "kegiatan", "cari", "search", "find", "ingat", "memory", "apa", "doing", "what", "now", "about", "current", "status", "project", "projek", "proyek", "user", "work", "working", "active", "projects", "users", "works", "aktivitas", "kegiatan", "tugas", "task", "tasks"],
    description: "Data personal, jadwal, kontak, dan catatan pribadi",
    suggestedTools: [],
    suggestedRagIndex: "knowledge-personal",
  },
    {
    id: "tech",
    name: "Teknologi",
    keywords: ["code", "kode", "program", "aplikasi", "website", "database", "api", "server", "bug", "feature", "deploy", "git", "npm", "docker", "typescript", "react", "node", "python", "rust", "backend", "frontend", "fullstack", "javascript", "java", "go", "php", "html", "css", "sql", "linux", "macos", "windows", "config", "setup", "install", "error", "test", "build", "compile", "fix", "refactor", "implement", "module", "class", "function", "import", "export", "interface", "type", "variable", "array", "object", "string", "number", "boolean", "async", "await", "promise", "callback", "middleware", "route", "controller", "service", "model", "view", "component", "hook", "state", "props", "event", "handler", "listener", "socket", "stream", "buffer", "file", "dir", "folder", "path", "url", "http", "https", "fetch", "ajax", "json", "xml", "yaml", "toml", "markdown", "readme", "license", "changelog", "test", "spec", "mock", "stub", "spy", "assert", "expect", "should", "suite", "benchmark", "perf", "optimize", "secure", "auth", "login", "register", "token", "jwt", "oauth", "session", "cookie", "cache", "queue", "worker", "thread", "process", "cluster", "scale", "load", "stress", "monitor", "log", "debug", "trace", "metric", "alert", "notification", "email", "sms", "push", "websocket", "graphql", "rest", "grpc", "soap", "microservice", "monolith", "serverless", "lambda", "container", "kubernetes", "k8s", "pod", "service", "ingress", "helm", "chart", "ansible", "terraform", "ci", "cd", "pipeline", "action", "workflow", "job", "cron", "schedule", "event", "message", "broker", "kafka", "rabbitmq", "redis", "mongo", "postgres", "mysql", "sqlite", "orm", "query", "search", "cari", "find", "lookup", "retrieve", "memory", "recall", "episode", "history", "cache", "project", "projek", "proyek", "user", "users", "work", "working", "works", "active", "schema", "migration", "seed", "transaction", "index", "key", "foreign", "primary", "unique", "constraint", "trigger", "procedure", "function", "view", "table", "column", "row", "cell", "data", "information", "content", "document", "file", "attachment", "upload", "download", "sync", "async", "batch", "real", "time", "stream", "live", "realtime", "ssr", "csr", "spa", "pwa", "mobile", "desktop", "cli", "gui", "terminal", "console", "shell", "bash", "zsh", "sh", "script", "command", "argument", "flag", "option", "param", "env", "variable", "config", "setting", "preference", "default", "custom", "override", "inherit", "extend", "mixin", "trait", "impl", "abstract", "concrete", "static", "dynamic", "typed", "untyped", "safe", "nullable", "optional", "required", "readonly", "mutable", "immutable", "pure", "side", "effect", "monad", "functor", "pipe", "compose", "curry", "partial", "recursive", "iterative", "loop", "while", "for", "each", "map", "filter", "reduce", "find", "some", "every", "includes", "sort", "reverse", "concat", "slice", "splice", "split", "join", "replace", "match", "search", "indexof", "tolowercase", "touppercase", "trim", "pad", "repeat", "flat", "flatmap", "entries", "keys", "values", "assign", "freeze", "seal", "define", "proxy", "reflect", "symbol", "iterator", "generator", "yield", "next", "throw", "return", "try", "catch", "finally", "throw", "error", "exception", "stack", "trace", "message", "name", "cause", "reject", "resolve", "settle", "race", "all", "allsettled", "anys", "prototype", "proto", "constructor", "new", "instanceof", "typeof", "void", "delete", "in", "with", "this", "super", "class", "extends", "implements", "interface", "enum", "namespace", "module", "declare", "export", "import", "require", "from", "as", "default", "readonly", "private", "public", "protected", "static", "abstract", "virtual", "override", "sealed", "final", "const", "let", "var", "function", "return", "if", "else", "switch", "case", "break", "continue", "default", "throw", "try", "catch", "finally", "for", "while", "do", "in", "of", "async", "await", "yield", "generator", "arrow", "lambda", "closure", "scope", "block", "hoist", "iife", "module", "commonjs", "esm", "umd", "amd", "system", "bundle", "pack", "chunk", "tree", "shake", "minify", "uglify", "compress", "gzip", "brotli", "cache", "store", "persist", "memoize", "debounce", "throttle", "cancel", "abort", "signal", "timeout", "interval", "delay", "request", "response", "header", "body", "status", "method", "get", "post", "put", "patch", "delete", "head", "options", "connect", "trace"],


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
  private stopWords: Set<string> = new Set([
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
    "dan", "di", "ke", "dari", "yang", "ini", "itu", "dengan", "untuk",
    "pada", "adalah", "telah", "sudah", "akan", "bisa", "dapat", "tidak",
    "ada", "juga", "atau", "saya", "kami", "kita", "mereka", "dia",
    "oleh", "sebagai", "tentang", "karena", "jika", "saat", "setelah",
    "sebelum", "antara", "tanpa", "sambil", "meski", "walaupun",
    "sangat", "agak", "cukup", "paling", "semua", "masing", "sendiri",
    "hal", "banyak", "sedikit", "lain", "baru", "lama", "besar", "kecil",
    "tolong", "mohon", "silakan", "terima", "kasih", "maaf",
  ])

  extractKeywords(input: string): { keywords: string[]; category: string } {
    const normalized = input.toLowerCase()
    const tokens = normalized.split(/[\s,.;:!?(){}[\]"'/\\@#$%^&*+=<>~`|]+/).filter(t => t.length > 2)

    // Score each token by relevance
    const scored = new Map<string, number>()
    const matchedCategory = new Map<string, number>()

    for (const token of tokens) {
      if (this.stopWords.has(token)) continue
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
   * Lightweight keyword fallback — used ONLY when LLM is unavailable.
   * This is NOT the primary router; LLM is the primary classifier.
   */
  private _keywordFallback(input: string): RouteMatch {
    const normalized = input.toLowerCase()

    // Score each category by how many keywords match
    let bestCat: RouteCategory | null = null
    let bestScore = 0
    let bestMatches: string[] = []

    for (const cat of this.categories) {
      if (cat.keywords.length === 0) continue
      let score = 0
      const matches: string[] = []
      for (const kw of cat.keywords) {
        if (normalized.includes(kw.toLowerCase())) {
          score++
          matches.push(kw)
        }
      }
      if (score > bestScore) {
        bestScore = score
        bestCat = cat
        bestMatches = matches
      }
    }

    const inputTokenCount = Math.max(2, normalized.split(/\s+/).length)
    const confidence = bestCat && bestScore > 0
      ? Math.min(1.0, bestScore / inputTokenCount)
      : 0.3

    const cat = bestCat && bestScore > 0 ? bestCat : this.categories.find(c => c.id === "general")

    return {
      input,
      intent: cat ? `Terkait ${cat.name}` : "Pengetahuan umum",
      category: cat?.id ?? "general",
      confidence: parseFloat(confidence.toFixed(2)),
      usedLlm: false,
      suggestedTools: cat?.suggestedTools ?? [],
      suggestedRagIndex: cat?.suggestedRagIndex ?? "knowledge-general",
      reasoning: bestCat && bestScore > 0
        ? `Keyword fallback: "${bestMatches.slice(0, 5).join(", ")}"${bestMatches.length > 5 ? ` +${bestMatches.length - 5} more` : ""}`
        : "LLM unavailable, fallback ke general",
    }
  }

  /**
   * Route input using LLM intent classification.
   * LLM is the primary classifier. Keyword fallback only when LLM unavailable.
   */
  async route(input: string): Promise<RouteMatch> {
    // LLM as primary classifier
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

        const parsed = parseRouterClassificationPayload(resp.content)
        if (parsed) {
          const matchedCat = this.categories.find(c => c.id === parsed.category)
          if (!matchedCat) {
            throw new ValidationError(`LLM returned unknown category "${parsed.category}", using keyword fallback`)
          }
          return {
            input,
            intent: `Terkait ${matchedCat.name}`,
            category: parsed.category,
            confidence: parseFloat(parsed.confidence.toFixed(2)),
            usedLlm: true,
            suggestedTools: matchedCat.suggestedTools ?? [],
            suggestedRagIndex: matchedCat.suggestedRagIndex ?? "knowledge-general",
            reasoning: parsed.reasoning,
          }
        }
        throw new ValidationError("LLM returned invalid router classification schema, using keyword fallback")
      } catch (e) {
        log.error(`LLM fallback failed`, { error: e })
      }
    }

    // Fallback: keyword-based when LLM unavailable or failed
    return this._keywordFallback(input)
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
