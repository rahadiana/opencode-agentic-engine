import { STOP_WORDS } from "./stopwords.js"

// ── Constants ──

/** Action verb prefixes for step validation — filters non-action lines */
const ACTION_VERBS = new Set([
  "create", "add", "implement", "build", "write", "develop", "refactor",
  "delete", "remove", "modify", "update", "edit", "change", "fix", "patch",
  "rename", "move", "extract", "migrate", "upgrade", "downgrade",
  "research", "search", "find", "analyze", "investigate", "diagnose",
  "test", "verify", "check", "validate", "review", "audit", "inspect",
  "run", "execute", "deploy", "publish", "release", "build",
  "plan", "design", "architect", "configure", "setup", "install",
  "learn", "study", "document", "comment", "annotate",
  "configure", "optimize", "refine", "improve", "enhance",
  "merge", "rebase", "commit", "push", "pull",
  "connect", "integrate", "wrap", "expose", "export", "import",
  // Indonesian action verbs
  "menambahkan", "membuat", "memperbaiki", "menghapus", "mengubah",
  "memodifikasi", "mengimplementasi", "menguji", "memverifikasi",
  "merencanakan", "mendesain", "menulis", "membangun", "menjalankan",
])

/** Success markers in multiple languages */
const SUCCESS_MARKERS = ["✅", "✓", "✔", "success", "completed", "done", "finish",
  "selesai", "sukses", "berhasil"]

/** Completion context markers */
const COMPLETION_MARKERS = ["step", "langkah", "task", "tugas", "phase", "fase",
  "iteration", "iterasi", "milestone"]

/** Minimum content length to qualify as extractable (avoids trivial noise) */
export const MIN_EXTRACT_CONTENT_LENGTH = 60

// ── Utilities ──

/** Normalize text for search: lowercase, remove special chars */
export function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()
}

// ── Types ──

export interface ExtractedSkill {
  name: string
  steps: string[]
  pattern: string
  keywords: string[]
  tools: string[]
  capability: string | undefined
}

// ── SkillExtractor Class ──

export class SkillExtractor {
  /**
   * Extract a skill from agent output content.
   * Returns null if content doesn't meet extractable criteria.
   */
  extract(content: string, _contextTags: string[] = []): ExtractedSkill | null {
    if (!this.isExtractablePattern(content)) return null

    const name = this.extractName(content)
    if (!name) return null

    const steps = this.extractSteps(content)
    if (steps.length === 0) return null

    const pattern = this.extractPattern(content)
    const keywords = this.extractKeywords(content)
    const tools = this.inferTools(content)
    const capability = this.inferCapability(name, keywords)

    return { name, steps, pattern, keywords, tools, capability }
  }

  /** Check if text contains action-oriented language */
  private hasActionWords(text: string): boolean {
    const lower = text.toLowerCase()
    let actionCount = 0
    for (const verb of ACTION_VERBS) {
      const regex = new RegExp(`\\b${verb}\\b`, "i")
      if (regex.test(lower)) {
        actionCount++
        if (actionCount >= 2) return true  // at least 2 action verbs needed
      }
    }
    return actionCount >= 1 && text.length >= MIN_EXTRACT_CONTENT_LENGTH
  }

  private isExtractablePattern(content: string): boolean {
    if (content.length < MIN_EXTRACT_CONTENT_LENGTH) return false

    const lower = content.toLowerCase()

    // Must have at least one success indicator
    const hasSuccess = SUCCESS_MARKERS.some(m => lower.includes(m))
    if (!hasSuccess) return false

    // Must have at least one completion context marker
    const hasCompletion = COMPLETION_MARKERS.some(m => lower.includes(m))
    if (!hasCompletion) return false

    // Must have action-oriented content (semantic gate against false positives)
    if (!this.hasActionWords(content)) return false

    return true
  }

  private extractName(content: string): string | null {
    const patterns = [
      // English action patterns
      /(?:Created|Added|Implemented|Built|Fixed|Refactored|Removed|Updated)\s+(?:the\s+)?(.{3,80}?)(?:\.|$)/i,
      /Step\s+\w+:\s*(.{3,80}?)(?:\.|$)/i,
      /Completed\s+(.{3,80}?)(?:\.|$)/i,
      // Indonesian patterns
      /(?:Menambahkan|Membuat|Memperbaiki|Menghapus|Mengubah|Mengimplementasi)\s+(.{3,80}?)(?:\.|$)/i,
      /Selesai\s+(.+?)(?:\.|$)/i,
      // Generic action pattern (last resort)
      /✅\s*(?:Step\s+\w+[:-]?\s*)?(.{5,80}?)(?:\.|$)/i,
    ]
    for (const p of patterns) {
      const m = content.match(p)
      if (m) {
        const name = m[1].trim().slice(0, 60)
        // Skip non-informative names
        if (name.length >= 5 &&
            !STOP_WORDS.has(name.toLowerCase()) &&
            !/^(the|a|an)\s/.test(name.toLowerCase()) &&
            !/^\d+$/.test(name)) {
          return name
        }
      }
    }
    return null
  }

  private extractSteps(content: string): string[] {
    const steps: string[] = []
    const seen = new Set<string>()
    const lines = content.split("\n")

    for (const line of lines) {
      const trimmed = line.trim()

      // Skip markdown headers, code blocks, empty lines
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("```") || trimmed.startsWith(">")) continue

      let stepText: string | null = null
      const mNum = trimmed.match(/^\d+[.)]\s+(.+)/)
      if (mNum) stepText = mNum[1].trim()
      const mDash = trimmed.match(/^[-*]\s+(.+)/)
      if (mDash) stepText = mDash[1].trim()

      if (stepText && stepText.length > 5) {
        // Deduplicate by normalized content
        const normalized = normalize(stepText)
        const key = normalized.slice(0, 40)
        if (!seen.has(key)) {
          seen.add(key)
          // Only include if it has action-oriented language
          const lower = stepText.toLowerCase()
          const hasAction = [...ACTION_VERBS].some(v => {
            const regex = new RegExp(`\\b${v}\\b`, "i")
            return regex.test(lower)
          })
          if (hasAction || stepText.length > 20) {
            steps.push(stepText)
          }
        }
      }
    }

    return steps
  }

  private extractPattern(content: string): string {
    const words = content.match(/\b(\w{4,})\b/g) ?? []
    const significant = words.filter(w => w.length >= 4 && !STOP_WORDS.has(w.toLowerCase()))
    return [...new Set(significant)].slice(0, 5).join(" ")
  }

  private extractKeywords(content: string): string[] {
    const words = content.match(/\b(\w{4,})\b/g) ?? []
    const filtered = words.filter(w => {
      const lower = w.toLowerCase()
      return lower.length >= 4 && !STOP_WORDS.has(lower) && !ACTION_VERBS.has(lower)
    })
    // Sort by frequency (most common first) then deduplicate
    const freq = new Map<string, number>()
    for (const w of filtered) freq.set(w, (freq.get(w) ?? 0) + 1)
    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([word]) => word.toLowerCase())
  }

  /** Infer action type from a step description */
  inferAction(stepDesc: string): string {
    const lower = stepDesc.toLowerCase()
    if (lower.includes("create") || lower.includes("add") || lower.includes("write") || lower.includes("build") || lower.includes("develop")) return "create"
    if (lower.includes("delete") || lower.includes("remove") || lower.includes("hapus")) return "delete"
    if (lower.includes("modify") || lower.includes("update") || lower.includes("edit") || lower.includes("change") || lower.includes("ubah")) return "modify"
    if (lower.includes("research") || lower.includes("cari") || lower.includes("search") || lower.includes("find")) return "research"
    if (lower.includes("test") || lower.includes("verify") || lower.includes("check") || lower.includes("cek")) return "verify"
    if (lower.includes("run") || lower.includes("exec") || lower.includes("execute") || lower.includes("jalankan")) return "execute"
    if (lower.includes("review") || lower.includes("audit") || lower.includes("inspect") || lower.includes("review")) return "review"
    if (lower.includes("plan") || lower.includes("rencana") || lower.includes("design") || lower.includes("desain")) return "plan"
    if (lower.includes("learn") || lower.includes("belajar") || lower.includes("study") || lower.includes("pelajari")) return "learn"
    return "execute"
  }

  /** Infer tool name from a step description */
  inferToolForStep(stepDesc: string): string | undefined {
    const lower = stepDesc.toLowerCase()
    if (lower.includes("search") || lower.includes("cari") || lower.includes("find") || lower.includes("lookup")) return "agentic_nav"
    if (lower.includes("plan") || lower.includes("rencana") || lower.includes("design")) return "agentic_plan"
    if (lower.includes("execute") || lower.includes("run") || lower.includes("jalankan")) return "agentic_execute"
    if (lower.includes("verify") || lower.includes("test") || lower.includes("check")) return "agentic_verify"
    if (lower.includes("delegate") || lower.includes("assign")) return "agentic_delegate"
    if (lower.includes("reflect") || lower.includes("analyz")) return "agentic_reflect"
    if (lower.includes("message") || lower.includes("send")) return "agentic_message"
    if (lower.includes("snapshot") || lower.includes("checkpoint")) return "agentic_snapshot"
    if (lower.includes("debate") || lower.includes("review")) return "agentic_debate"
    return undefined
  }

  private inferTools(content: string): string[] {
    const lower = content.toLowerCase()
    const tools: string[] = []
    if (lower.includes("search") || lower.includes("find")) tools.push("agentic_nav")
    if (lower.includes("plan")) tools.push("agentic_plan")
    if (lower.includes("execute") || lower.includes("implement")) tools.push("agentic_execute")
    if (lower.includes("test") || lower.includes("verify")) tools.push("agentic_verify")
    if (lower.includes("delegate")) tools.push("agentic_delegate")
    if (lower.includes("message")) tools.push("agentic_message")
    return [...new Set(tools)]
  }

  private inferCapability(name: string, keywords: string[]): string | undefined {
    const lower = name.toLowerCase().trim()
    // If name itself looks like a capability (contains "."), use it directly
    if (lower.includes(".")) return lower
    // Common verb-noun patterns
    const verbPatterns = [
      { regex: /^(create|add|make|build|generate)\s+(.+)/i, prefix: (v: string, n: string) => `${n.toLowerCase().replace(/\s+/g, ".")}.${v.toLowerCase()}` },
      { regex: /^(get|find|search|fetch|retrieve|read)\s+(.+)/i, prefix: (v: string, n: string) => `${n.toLowerCase().replace(/\s+/g, ".")}.${v.toLowerCase()}` },
      { regex: /^(update|edit|modify|change|set)\s+(.+)/i, prefix: (v: string, n: string) => `${n.toLowerCase().replace(/\s+/g, ".")}.${v.toLowerCase()}` },
      { regex: /^(delete|remove|destroy|clear)\s+(.+)/i, prefix: (v: string, n: string) => `${n.toLowerCase().replace(/\s+/g, ".")}.${v.toLowerCase()}` },
    ]
    for (const pattern of verbPatterns) {
      const match = lower.match(pattern.regex)
      if (match) {
        return pattern.prefix(match[1], match[2])
      }
    }
    // Check keywords for known domain prefixes
    for (const kw of keywords) {
      const kwLower = kw.toLowerCase()
      if (kwLower.includes("auth") || kwLower.includes("login") || kwLower.includes("user")) return "auth." + lower.replace(/\s+/g, "_")
      if (kwLower.includes("db") || kwLower.includes("database") || kwLower.includes("migrate")) return "db." + lower.replace(/\s+/g, "_")
      if (kwLower.includes("api") || kwLower.includes("endpoint") || kwLower.includes("route")) return "api." + lower.replace(/\s+/g, "_")
      if (kwLower.includes("test") || kwLower.includes("spec") || kwLower.includes("assert")) return "test." + lower.replace(/\s+/g, "_")
      if (kwLower.includes("deploy") || kwLower.includes("ci") || kwLower.includes("build")) return "deploy." + lower.replace(/\s+/g, "_")
    }
    return undefined
  }
}
