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

const ROUTER_SYSTEM_PROMPT = `You are a **router agent** — a lightweight, fast intent classifier.

Given a user input and a list of categories, determine:
1. **Category**: Which category best matches this input?
2. **Intent**: A brief (1-2 sentence) summary of what the user wants
3. **Confidence**: How confident are you? (0.0 - 1.0)
4. **Reasoning**: Why did you pick this category?

Return your answer as a JSON object:
{
  "category": "category_id",
  "intent": "string",
  "confidence": 0.0-1.0,
  "reasoning": "string"
}

Available categories:
{CATEGORIES_LIST}

If the input doesn't clearly match any category, choose "general" with low confidence.`

export class RouterAgent {
  private categories: RouteCategory[]

  constructor(
    private llmEngine?: LLMEngine,
    categories?: RouteCategory[],
  ) {
    this.categories = categories ?? DEFAULT_CATEGORIES
  }

  setCategories(categories: RouteCategory[]): void {
    this.categories = categories
  }

  getCategories(): RouteCategory[] {
    return [...this.categories]
  }

  /**
   * Fast keyword-based routing — no LLM call needed.
   * Returns null if no clear match found (confidence < 0.3).
   */
  keywordRoute(input: string): RouteMatch | null {
    const normalizedInput = input.toLowerCase()
    const words = normalizedInput.split(/\s+/)
    const matches: Array<{ category: RouteCategory; score: number; matchedKeywords: string[] }> = []

    for (const cat of this.categories) {
      if (cat.keywords.length === 0) continue // 'general' has no keywords
      let score = 0
      const matchedKeywords: string[] = []

      for (const keyword of cat.keywords) {
        if (normalizedInput.includes(keyword)) {
          score += 1
          matchedKeywords.push(keyword)
        }
      }

      if (score > 0) {
        matches.push({ category: cat, score, matchedKeywords })
      }
    }

    if (matches.length === 0) {
      return null
    }

    // Sort by score descending
    matches.sort((a, b) => b.score - a.score)
    const top = matches[0]
    const totalKeywords = top.category.keywords.length
    // Use higher denominator for small keyword sets to prevent over-confident routing
    const confidence = Math.min(1.0, top.score / Math.max(2, totalKeywords * 0.5))

    // Only return if confidence is reasonable
    if (confidence < 0.3) return null

    return {
      input,
      intent: `Terkait ${top.category.name}`,
      category: top.category.id,
      confidence: parseFloat(confidence.toFixed(2)),
      usedLlm: false,
      suggestedTools: top.category.suggestedTools,
      suggestedRagIndex: top.category.suggestedRagIndex,
      reasoning: `Keyword match: ${top.matchedKeywords.slice(0, 5).join(", ")}${top.matchedKeywords.length > 5 ? ` +${top.matchedKeywords.length - 5} more` : ""}`,
    }
  }

  /**
   * Keyword-only routing — zero LLM cost. Falls back to "general" with low confidence.
   */
  async route(input: string): Promise<RouteMatch> {
    const keywordResult = this.keywordRoute(input)

    if (keywordResult) {
      return keywordResult
    }

    const generalCat = this.categories.find(c => c.id === "general")
    return {
      input,
      intent: "Pengetahuan umum",
      category: "general",
      confidence: 0.3,
      usedLlm: false,
      suggestedTools: generalCat?.suggestedTools ?? [],
      suggestedRagIndex: generalCat?.suggestedRagIndex ?? "knowledge-general",
      reasoning: "No keyword match, fallback ke general",
    }
  }

  private tryParseJSON(content: string): Record<string, unknown> | null {
    try {
      return JSON.parse(content)
    } catch {
      const match = content.match(/\{[\s\S]*?\}/)
      if (match) {
        try {
          return JSON.parse(match[0])
        } catch {
          return null
        }
      }
      return null
    }
  }
}

function logParseError(context: string, error: unknown): void {
  if (process.env.DEBUG_AGENTIC) {
    console.error(`[RouterAgent] ${context}:`, error)
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
