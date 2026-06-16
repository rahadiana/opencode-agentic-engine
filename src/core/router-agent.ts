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
    keywords: ["code", "kode", "program", "aplikasi", "website", "database", "api", "server", "bug", "feature", "deploy", "git", "npm", "docker", "typescript", "react", "node", "python", "rust", "backend", "frontend", "fullstack"],
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
    const confidence = Math.min(1.0, top.score / Math.max(1, totalKeywords * 0.3))

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
   * Full routing with optional LLM refinement for ambiguous cases.
   */
  async route(input: string): Promise<RouteMatch> {
    // Step 1: Try fast keyword routing
    const keywordResult = this.keywordRoute(input)

    // Step 2: If good confidence from keywords, return it
    if (keywordResult && keywordResult.confidence >= 0.6) {
      return keywordResult
    }

    // Step 3: If LLM available, use it for ambiguous cases
    if (this.llmEngine) {
      try {
        const categoriesList = this.categories
          .map(c => `- ${c.id}: "${c.name}" — ${c.description} (keywords: ${c.keywords.slice(0, 10).join(", ") || "none"})`)
          .join("\n")

        const resp = await this.llmEngine.call({
          systemPrompt: ROUTER_SYSTEM_PROMPT.replace("{CATEGORIES_LIST}", categoriesList),
          userPrompt: `User input: "${input}"\n\nDetermine the best matching category.`,
          temperature: 0.1,
          maxTokens: 512,
          jsonMode: true,
        })

        const parsed = this.tryParseJSON(resp.content)
        if (parsed && typeof parsed.category === "string") {
          const catId = parsed.category as string
          const matchedCat = this.categories.find(c => c.id === catId)
          const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0.5
          const intentStr = typeof parsed.intent === "string" ? parsed.intent : `Terkait ${matchedCat?.name || catId}`
          const reasoningStr = typeof parsed.reasoning === "string" ? parsed.reasoning : keywordResult?.reasoning || `LLM classification: ${catId}`

          return {
            input,
            intent: intentStr || `Terkait ${matchedCat?.name || catId}`,
            category: catId,
            confidence: Math.max(confidence, keywordResult?.confidence ?? 0),
            usedLlm: true,
            suggestedTools: matchedCat?.suggestedTools ?? [],
            suggestedRagIndex: matchedCat?.suggestedRagIndex ?? "knowledge-general",
            reasoning: reasoningStr,
          }
        }
      } catch (error) {
        logParseError("router llm call", error)
      }
    }

    // Step 4: Fallback to keyword result or general
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
      reasoning: "Tidak ada keyword yang cocok, fallback ke general",
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
