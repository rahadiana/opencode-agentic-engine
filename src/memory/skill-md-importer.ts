/**
 * SKILL.md Importer — converts addyosmani/agent-skills format to agentic-skill/v1
 *
 * addyosmani/agent-skills uses Markdown SKILL.md files with YAML frontmatter.
 * This converter parses that format and creates compatible SkillDefinition entries
 * for the opencode-agentic-engine skill store.
 *
 * SKILL.md Anatomy:
 *   ---
 *   name: kebab-case-name
 *   description: One-line summary
 *   ---
 *   # Title
 *   ## Overview
 *   ## When to Use
 *   ## Process (step-by-step)
 *   ## Common Rationalizations (table: | Excuse | Reality |)
 *   ## Red Flags
 *   ## Verification (checklist)
 *
 * Output: SkillDefinition with antiRationalizations, workflow steps, and verification criteria.
 */
import { createLogger } from "../observability/logger.js"
import type { SkillDefinition, AntiRationalization } from "./skill-format.js"
import { createSkillDefinition } from "./skill-format.js"
import type { SkillStore } from "./skill-store.js"
import { createMemoryEnvelope } from "./schema-version.js"

const log = createLogger("SkillMDImporter")

export interface SkillMdFrontmatter {
  name: string
  description: string
}

export interface ParsedSkillMd {
  frontmatter: SkillMdFrontmatter
  overview: string
  whenToUse: string
  steps: Array<{ action: string; description: string }>
  antiRationalizations: AntiRationalization[]
  redFlags: string[]
  verificationCriteria: string[]
  allTags: string[]
}

/**
 * Parse raw SKILL.md content into structured data.
 * Handles:
 * - YAML frontmatter (between --- delimiters)
 * - Markdown sections (## headings)
 * - Tables (for anti-rationalizations)
 * - Checklists (for verification criteria)
 */
export function parseSkillMd(raw: string): ParsedSkillMd | null {
  try {
    // Extract YAML frontmatter
    const frontMatch = raw.match(/^---\n([\s\S]*?)\n---\n/)
    if (!frontMatch) {
      log.warn("[SKILL.md] No YAML frontmatter found")
      return null
    }

    const frontRaw = frontMatch[1]
    const name = frontRaw.match(/name:\s*(.+)/)?.[1]?.trim() || ""
    const description = frontRaw.match(/description:\s*(.+)/)?.[1]?.trim() || ""

    if (!name) {
      log.warn("[SKILL.md] Missing 'name' in frontmatter")
      return null
    }

    const body = raw.slice(frontMatch[0].length)

    // Extract sections by heading
    const overview = extractSection(body, "## Overview", ["## When", "## Process", "## Common", "## Red Flags", "## Verification"])
    const whenToUse = extractSection(body, "## When to Use", ["## Process", "## Common", "## Red Flags", "## Verification", "## Overview"])
    const processSection = extractSection(body, "## Process", ["## Common", "## Red Flags", "## Verification", "## When"])
    const rationalSection = extractSection(body, "## Common Rationalizations", ["## Red Flags", "## Verification", "## Process"])
    const redFlagsSection = extractSection(body, "## Red Flags", ["## Verification", "## Common", "## Process"])
    const verificationSection = extractSection(body, "## Verification", ["## Red Flags", "## Common", "## Process", "## See Also"])

    // Parse steps from process section
    const steps = parseSteps(processSection)

    // Parse anti-rationalizations from table
    const antiRationalizations = parseRationalizationTable(rationalSection)

    // Parse red flags (bullet points)
    const redFlags = parseBulletList(redFlagsSection)

    // Parse verification criteria (checklist items)
    const verificationCriteria = parseChecklist(verificationSection)

    // Extract tags from description and sections
    const allTags = extractTags(name, description, overview, whenToUse)

    return {
      frontmatter: { name, description },
      overview,
      whenToUse,
      steps: steps.length > 0 ? steps : [{ action: "Follow workflow", description: overview.slice(0, 200) }],
      antiRationalizations,
      redFlags,
      verificationCriteria,
      allTags,
    }
  } catch (e) {
    log.error(`[SKILL.md] Parse error: ${(e as Error).message}`)
    return null
  }
}

/**
 * Convert parsed SKILL.md to SkillDefinition compatible with our skill store.
 */
export function convertSkillMdToDefinition(parsed: ParsedSkillMd): SkillDefinition | null {
  try {
    const { frontmatter, steps, antiRationalizations, allTags } = parsed

    const keywords = extractKeywords(frontmatter.name, frontmatter.description)
    const triggerPattern = keywords.slice(0, 3).join(" ")

    return createSkillDefinition(
      frontmatter.name,
      triggerPattern,
      keywords,
      steps.map((s, _i) => ({
        action: s.action,
        description: s.description,
        tool: inferTool(s.action, s.description),
        expectedOutput: `${s.action}: completed`,
        rollback: inferRollbackFromAction(s.action),
      })),
      allTags,
      "human",
      {
        capability: `skill.${frontmatter.name}`,
        antiRationalizations: antiRationalizations.length > 0 ? antiRationalizations : undefined,
      },
    )
  } catch (e) {
    log.error(`[SKILL.md] Conversion error: ${(e as Error).message}`)
    return null
  }
}

/**
 * High-level import: parse SKILL.md content and add to skill store.
 * Returns the SkillDefinition if successful, null otherwise.
 */
export function importSkillMdToStore(
  raw: string,
  skillStore: SkillStore,
): SkillDefinition | null {
  const parsed = parseSkillMd(raw)
  if (!parsed) return null

  const def = convertSkillMdToDefinition(parsed)
  if (!def) return null

  // Check if skill already exists
  const existing = skillStore.find(parsed.frontmatter.name)
  if (existing.length > 0) {
    log.info(`[SKILL.md] Skill "${parsed.frontmatter.name}" already exists — skipping`)
    return existing[0].definition
  }

  // Import to skill store via envelope
  skillStore.importFromEnvelope(createMemoryEnvelope(def, "skill"))
  log.info(`[SKILL.md] Imported skill "${parsed.frontmatter.name}" (${parsed.steps.length} steps, ${parsed.antiRationalizations.length} anti-rationalizations)`)

  return def
}

// ── Helper: extract section between headings ──

function extractSection(body: string, heading: string, stopHeadings: string[]): string {
  const headingRegex = new RegExp(`^${escapeRegex(heading)}\\s*$`, "m")
  const match = headingRegex.exec(body)
  if (!match) return ""

  const startIdx = match.index + match[0].length

  // Find the earliest stop heading after this section
  let endIdx = body.length
  for (const stop of stopHeadings) {
    const stopRegex = new RegExp(`^${escapeRegex(stop)}\\s*$`, "m")
    const stopMatch = stopRegex.exec(body.slice(startIdx))
    if (stopMatch) {
      const candidate = startIdx + stopMatch.index
      if (candidate < endIdx) endIdx = candidate
    }
  }

  return body.slice(startIdx, endIdx).trim()
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// ── Helper: parse steps from process section ──

function parseSteps(text: string): Array<{ action: string; description: string }> {
  if (!text) return []

  const steps: Array<{ action: string; description: string }> = []

  // Try numbered steps first (e.g., "### Step 1: Title" or "1. Do this")
  const numberedPattern = /(?:###\s*)?Step\s+(\d+)[:\s)]*(.*?)$|^\s*(\d+)[.)]\s+(.*)$/gm
  let match: RegExpExecArray | null
  let found = false

  while ((match = numberedPattern.exec(text)) !== null) {
    found = true
    const title = (match[2] || match[4] || "").trim()
    // Get description as the paragraph after the heading
    const afterMatch = text.slice(match.index + match[0].length).match(/^([\s\S]*?)(?=\n(?:###|Step|\d+[.)]|\n##|$))/)
    const description = afterMatch
      ? afterMatch[1].trim().slice(0, 200)
      : `Follow the ${title.toLowerCase()} workflow`

    steps.push({
      action: title || `Step ${match[1] || match[3]}`,
      description: description || title,
    })
  }

  if (!found) {
    // Fallback: split by paragraphs and use first sentence of each
    const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 20)
    for (const p of paragraphs.slice(0, 8)) {
      const firstLine = p.replace(/^[#*\- ]+/, "").trim()
      const action = firstLine.split(/[.\n]/)[0].slice(0, 60)
      if (action.length > 5) {
        steps.push({ action, description: firstLine.slice(0, 200) })
      }
    }
  }

  return steps
}

// ── Helper: parse anti-rationalization table ──

function parseRationalizationTable(text: string): AntiRationalization[] {
  if (!text) return []

  const results: AntiRationalization[] = []

  // Match markdown table rows: | rationalization | reality |
  const tableRowPattern = /^\|\s*(.*?)\s*\|\s*(.*?)\s*\|/gm
  let match: RegExpExecArray | null

  // Skip header row (first match if table)
  let headerSkipped = false

  while ((match = tableRowPattern.exec(text)) !== null) {
    const fullRow = match[0]
    // Skip separator rows (| --- | --- |)
    if (/^\|[\s-]+\|[\s-]+\|$/.test(fullRow)) continue

    if (!headerSkipped) {
      headerSkipped = true
      continue // Skip the header row
    }

    const rationalization = match[1].replace(/\*+/g, "").trim()
    const reality = match[2].replace(/\*+/g, "").trim()

    if (rationalization && reality && rationalization.length > 5 && reality.length > 5) {
      results.push({ rationalization, reality })
    }
  }

  return results
}

// ── Helpers ──

function parseBulletList(text: string): string[] {
  if (!text) return []
  const items: string[] = []
  const pattern = /^[-*]\s+(.*)$/gm
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    items.push(match[1].trim())
  }
  return items.slice(0, 10)
}

function parseChecklist(text: string): string[] {
  if (!text) return []
  const items: string[] = []
  // Match [ ] checkbox items
  const pattern = /[-*]\s*\[[ x]?\]\s*(.*)$/gm
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    items.push(match[1].trim())
  }

  // Fallback: bullet points if no checkboxes found
  if (items.length === 0) {
    return parseBulletList(text)
  }

  return items.slice(0, 15)
}

function extractKeywords(name: string, description: string): string[] {
  const text = `${name} ${description}`.toLowerCase()
  const words = text.split(/[\s,.;:!?(){}[\]"'/\\@#$%^&*+=<>~`|]+/)
    .filter(w => w.length > 2)
    .filter(w => !["the", "and", "for", "are", "but", "not", "you", "all", "any", "can", "had", "her", "was", "one", "our", "out", "has", "have", "been", "some", "such", "than", "that", "this", "very", "just", "with", "will", "what", "when", "where", "which", "who", "how", "why"].includes(w))

  return [...new Set(words)].slice(0, 10)
}

function extractTags(name: string, description: string, overview: string, whenToUse: string): string[] {
  const all = `${name} ${description} ${overview} ${whenToUse}`.toLowerCase()
  const tags = new Set<string>()

  const tagPatterns: Array<{ tag: string; keywords: string[] }> = [
    { tag: "testing", keywords: ["test", "tdd", "coverage", "assertion"] },
    { tag: "security", keywords: ["security", "owasp", "vulnerability", "auth", "threat"] },
    { tag: "performance", keywords: ["performance", "optimization", "bundle", "profiling"] },
    { tag: "frontend", keywords: ["frontend", "ui", "component", "accessibility", "css"] },
    { tag: "backend", keywords: ["backend", "api", "endpoint", "database", "server"] },
    { tag: "devops", keywords: ["deploy", "ci", "cd", "pipeline", "rollback", "monitoring"] },
    { tag: "review", keywords: ["review", "quality", "readability", "maintain"] },
    { tag: "debugging", keywords: ["debug", "error", "recovery", "fix", "triage"] },
    { tag: "design", keywords: ["design", "architecture", "pattern", "interface", "api"] },
    { tag: "planning", keywords: ["plan", "breakdown", "task", "spec", "requirement"] },
  ]

  for (const { tag, keywords } of tagPatterns) {
    for (const kw of keywords) {
      if (all.includes(kw)) {
        tags.add(tag)
        break
      }
    }
  }

  return [...tags]
}

function inferTool(action: string, _description: string): string | undefined {
  const lower = action.toLowerCase()
  if (lower.includes("test") || lower.includes("debug")) return "agentic_verify"
  if (lower.includes("plan") || lower.includes("breakdown")) return "agentic_plan"
  if (lower.includes("review") || lower.includes("audit")) return "agentic_debate"
  if (lower.includes("deploy") || lower.includes("ship")) return "agentic_auto"
  if (lower.includes("nav") || lower.includes("search")) return "agentic_nav"
  if (lower.includes("implement") || lower.includes("code")) return undefined
  return undefined
}

function inferRollbackFromAction(action: string): string | undefined {
  const lower = action.toLowerCase()
  if (lower.includes("write") || lower.includes("create") || lower.includes("add")) {
    return "Revert via git checkout or delete the created file"
  }
  if (lower.includes("migrate") || lower.includes("deploy")) {
    return "Run rollback procedure or revert migration"
  }
  if (lower.includes("delete") || lower.includes("remove")) {
    return "Restore from git: git checkout -- <file>"
  }
  if (lower.includes("refactor") || lower.includes("change")) {
    return "Revert changes: git checkout or git revert"
  }
  return undefined
}
