/**
 * Sparse Vector Store — TF-IDF retrieval.
 * Zero external dependencies. Pure math.
 *
 * Per-category inverted index + document-length normalization.
 * Supports incremental indexing (no full rebuild needed).
 */

export interface TfIdfDoc {
  id: string
  category: string
  title: string
  content: string
  keywords: string[]
  metadata?: Record<string, unknown>
}

export interface ScoredResult {
  doc: TfIdfDoc
  score: number
  matchFields: string[]
}

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "by", "with", "from", "as", "is", "was", "are", "were", "be",
  "been", "being", "have", "has", "had", "do", "does", "did", "will",
  "would", "could", "should", "may", "might", "shall", "can", "need",
  "dare", "ought", "used", "this", "that", "these", "those", "i", "me",
  "my", "we", "our", "you", "your", "he", "him", "his", "she", "her",
  "it", "its", "they", "them", "their", "what", "which", "who", "whom",
  "when", "where", "why", "how", "all", "each", "every", "both", "few",
  "more", "most", "other", "some", "such", "no", "nor", "not", "only",
  "own", "same", "so", "than", "too", "very", "just", "because", "as",
  "until", "while", "about", "between", "through", "during", "before",
  "after", "above", "below", "up", "down", "out", "off", "over", "under",
  "again", "further", "then", "once", "here", "there", "when", "where",
  "why",
])

function tokenize(text: string): string[] {
  // Use Unicode property escapes (\p{L} = any letter, \p{N} = any number)
  // to support non-Latin scripts (Cyrillic, Arabic, CJK, etc.)
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOP_WORDS.has(t))

  // Add bigrams for n-gram support
  const bigrams: string[] = []
  for (let i = 0; i < words.length - 1; i++) {
    bigrams.push(words[i] + "_" + words[i + 1])
  }

  return [...words, ...bigrams]
}

function computeTf(term: string, docTokens: string[]): number {
  const count = docTokens.filter(t => t === term).length
  if (count === 0) return 0
  return 1 + Math.log10(count)
}

export class VectorStore {
  /** category → term → set of doc IDs */
  private invertedIndex = new Map<string, Map<string, Set<string>>>()
  /** doc_id → doc + tokens */
  private docs = new Map<string, { doc: TfIdfDoc; tokens: string[] }>()
  /** category → total docs */
  private docCount = new Map<string, number>()
  /** keyword inverted index: keyword_lower → Set<docId> — for O(1) keyword matching */
  private keywordIndex = new Map<string, Set<string>>()
  /** title inverted index: title word → Set<docId> — for O(1) title matching */
  private titleIndex = new Map<string, Set<string>>()

  /**
   * Index a single document. Idempotent — re-indexing replaces old entry.
   */
  index(doc: TfIdfDoc): void {
    const tokens = tokenize(doc.title + " " + doc.content + " " + doc.keywords.join(" "))

    // Check if this is a re-index (replace existing doc)
    const existing = this.docs.get(doc.id)
    this.docs.set(doc.id, { doc, tokens })

    const catIndex = this.invertedIndex.get(doc.category) ?? new Map()

    // Remove old postings if re-indexing to prevent stale token matches
    if (existing) {
      for (const oldToken of existing.tokens) {
        const oldPostings = catIndex.get(oldToken)
        if (oldPostings) {
          oldPostings.delete(doc.id)
          if (oldPostings.size === 0) catIndex.delete(oldToken)
        }
      }
    }

    const seen = new Set<string>()
    for (const token of tokens) {
      if (!seen.has(token)) {
        seen.add(token)
        const postings = catIndex.get(token) ?? new Set()
        postings.add(doc.id)
        catIndex.set(token, postings)
      }
    }
    this.invertedIndex.set(doc.category, catIndex)

    // Update keyword inverted index
    if (existing) {
      for (const [, ids] of this.keywordIndex) ids.delete(doc.id)
    }
    for (const kw of doc.keywords) {
      const kwLower = kw.toLowerCase()
      const ids = this.keywordIndex.get(kwLower) ?? new Set()
      ids.add(doc.id)
      this.keywordIndex.set(kwLower, ids)
    }

    // Update title inverted index
    if (existing) {
      for (const [, ids] of this.titleIndex) ids.delete(doc.id)
    }
    const titleWords = tokenize(doc.title)
    for (const tw of titleWords) {
      const ids = this.titleIndex.get(tw) ?? new Set()
      ids.add(doc.id)
      this.titleIndex.set(tw, ids)
    }

    // Only increment docCount if this is a NEW document (not a re-index)
    if (!existing) {
      this.docCount.set(doc.category, (this.docCount.get(doc.category) ?? 0) + 1)
    }
  }

  /**
   * Remove a document by ID.
   */
  remove(id: string): void {
    const entry = this.docs.get(id)
    if (!entry) return

    const catIndex = this.invertedIndex.get(entry.doc.category)
    if (catIndex) {
      // Only iterate tokens that belong to this document
      for (const token of entry.tokens) {
        const postings = catIndex.get(token)
        if (postings) {
          postings.delete(id)
          if (postings.size === 0) catIndex.delete(token)
        }
      }
    }

    for (const [, ids] of this.keywordIndex) ids.delete(id)
    for (const [, ids] of this.titleIndex) ids.delete(id)

    this.docs.delete(id)
    const count = this.docCount.get(entry.doc.category) ?? 0
    if (count > 0) this.docCount.set(entry.doc.category, count - 1)
  }

  /**
   * Search within a category using TF-IDF scoring.
   * If query is empty or all stop words, returns recent documents as fallback.
   */
  search(query: string, category: string, limit = 10): ScoredResult[] {
    const qTokens = tokenize(query)
    if (qTokens.length === 0) {
      // Fallback to recent docs in this category
      return [...this.docs.values()]
        .filter(e => e.doc.category === category)
        .slice(0, limit)
        .map(({ doc }) => ({ doc, score: 0, matchFields: ["recent"] }))
    }

    const catIndex = this.invertedIndex.get(category)
    if (!catIndex) return []

    const n = this.docCount.get(category) ?? 0
    if (n === 0) return []

    const scores = new Map<string, { score: number; fields: Set<string> }>()

    for (const qTerm of qTokens) {
      const idf = Math.log10(1 + n / (1 + (catIndex.get(qTerm)?.size ?? 0)))
      const postings = catIndex.get(qTerm)

      if (!postings) continue

      for (const docId of postings) {
        const entry = this.docs.get(docId)
        if (!entry) continue

        const tf = computeTf(qTerm, entry.tokens)
        const existing = scores.get(docId) ?? { score: 0, fields: new Set<string>() }
        existing.score += tf * idf
        existing.fields.add("content")
        scores.set(docId, existing)
      }
    }

    // Title match bonus via titleIndex (O(qTokens * matchedDocCount) instead of O(n))
    const matchedTitleIds = new Set<string>()
    for (const qTerm of qTokens) {
      const titleMatches = this.titleIndex.get(qTerm)
      if (titleMatches) {
        for (const docId of titleMatches) {
          const entry = this.docs.get(docId)
          if (!entry || entry.doc.category !== category) continue
          matchedTitleIds.add(docId)
        }
      }
    }
    const qLower = query.toLowerCase()
    for (const docId of matchedTitleIds) {
      const entry = this.docs.get(docId)!
      const titleLower = entry.doc.title.toLowerCase()
      let bonus = 1.5
      if (titleLower.includes(qLower)) bonus = 2.0
      const existing = scores.get(docId) ?? { score: 0, fields: new Set<string>() }
      existing.score += bonus
      existing.fields.add("title")
      scores.set(docId, existing)
    }

    // Keyword match bonus via keywordIndex (O(qTokens * matchedDocCount) instead of O(n))
    const matchedKwIds = new Set<string>()
    for (const qTerm of qTokens) {
      for (const [kw, ids] of this.keywordIndex) {
        if (kw.includes(qTerm)) {
          for (const docId of ids) {
            const entry = this.docs.get(docId)
            if (!entry || entry.doc.category !== category) continue
            matchedKwIds.add(docId)
          }
        }
      }
    }
    for (const docId of matchedKwIds) {
      const existing = scores.get(docId) ?? { score: 0, fields: new Set<string>() }
      existing.score += 1.5
      existing.fields.add("keyword")
      scores.set(docId, existing)
    }

    // Length normalization: divide score by sqrt(doc token count)
    for (const [docId, data] of scores) {
      const entry = this.docs.get(docId)
      if (entry) {
        data.score = data.score / Math.sqrt(entry.tokens.length + 1)
      }
    }

    return [...scores.entries()]
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, limit)
      .map(([docId, { score, fields }]) => ({
        doc: this.docs.get(docId)!.doc,
        score,
        matchFields: [...fields],
      }))
  }

  /**
   * Search across all categories.
   */
  searchAll(query: string, limit = 10): ScoredResult[] {
    const qTokens = tokenize(query)
    const results: ScoredResult[] = []
    for (const [category] of this.invertedIndex) {
      if (qTokens.length === 0) {
        results.push(...this.search(query, category, limit))
      } else {
        // Tokenize once and pass pre-tokenized query
        const catResults = this.searchWithTokens(qTokens, query, category, limit)
        results.push(...catResults)
      }
    }
    return results.sort((a, b) => b.score - a.score).slice(0, limit)
  }

  private searchWithTokens(qTokens: string[], query: string, category: string, limit: number): ScoredResult[] {
    if (qTokens.length === 0) {
      return [...this.docs.values()]
        .filter(e => e.doc.category === category)
        .slice(0, limit)
        .map(({ doc }) => ({ doc, score: 0, matchFields: ["recent"] }))
    }

    const catIndex = this.invertedIndex.get(category)
    if (!catIndex) return []

    const n = this.docCount.get(category) ?? 0
    if (n === 0) return []

    const scores = new Map<string, { score: number; fields: Set<string> }>()

    for (const qTerm of qTokens) {
      const idf = Math.log10(1 + n / (1 + (catIndex.get(qTerm)?.size ?? 0)))
      const postings = catIndex.get(qTerm)
      if (!postings) continue
      for (const docId of postings) {
        const entry = this.docs.get(docId)
        if (!entry) continue
        const tf = computeTf(qTerm, entry.tokens)
        const existing = scores.get(docId) ?? { score: 0, fields: new Set<string>() }
        existing.score += tf * idf
        existing.fields.add("content")
        scores.set(docId, existing)
      }
    }

    const matchedTitleIds = new Set<string>()
    for (const qTerm of qTokens) {
      const titleMatches = this.titleIndex.get(qTerm)
      if (titleMatches) {
        for (const docId of titleMatches) {
          const entry = this.docs.get(docId)
          if (!entry || entry.doc.category !== category) continue
          matchedTitleIds.add(docId)
        }
      }
    }
    const qLower = query.toLowerCase()
    for (const docId of matchedTitleIds) {
      const entry = this.docs.get(docId)!
      const titleLower = entry.doc.title.toLowerCase()
      let bonus = 1.5
      if (titleLower.includes(qLower)) bonus = 2.0
      const existing = scores.get(docId) ?? { score: 0, fields: new Set<string>() }
      existing.score += bonus
      existing.fields.add("title")
      scores.set(docId, existing)
    }

    const matchedKwIds = new Set<string>()
    for (const qTerm of qTokens) {
      for (const [kw, ids] of this.keywordIndex) {
        if (kw.includes(qTerm)) {
          for (const docId of ids) {
            const entry = this.docs.get(docId)
            if (!entry || entry.doc.category !== category) continue
            matchedKwIds.add(docId)
          }
        }
      }
    }
    for (const docId of matchedKwIds) {
      const existing = scores.get(docId) ?? { score: 0, fields: new Set<string>() }
      existing.score += 1.5
      existing.fields.add("keyword")
      scores.set(docId, existing)
    }

    for (const [docId, data] of scores) {
      const entry = this.docs.get(docId)
      if (entry) {
        data.score = data.score / Math.sqrt(entry.tokens.length + 1)
      }
    }

    return [...scores.entries()]
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, limit)
      .map(([docId, { score, fields }]) => ({
        doc: this.docs.get(docId)!.doc,
        score,
        matchFields: [...fields],
      }))
  }

  /**
   * Export all indexed data for persistence.
   */
  exportAll(): TfIdfDoc[] {
    return [...this.docs.values()].map(e => e.doc)
  }

  /**
   * Import persisted documents (re-indexes all).
   */
  importAll(docs: TfIdfDoc[]): void {
    this.invertedIndex.clear()
    this.docs.clear()
    this.docCount.clear()
    for (const doc of docs) {
      this.index(doc)
    }
  }

  /** Total documents indexed */
  get size(): number {
    return this.docs.size
  }

  /** Categories with at least one document */
  get categories(): string[] {
    return [...this.invertedIndex.keys()]
  }

  /** Document count per category */
  docCountOf(category: string): number {
    return this.docCount.get(category) ?? 0
  }
}
