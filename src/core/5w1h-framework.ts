/**
 * 5W1H Research Framework
 *
 * Konsep dari jurnalistik: What, Who, Where, When, Why, How.
 * Diadaptasi untuk agentic software engineering sebagai RESEARCH PHASE WAJIB
 * sebelum agent mulai planning atau coding.
 *
 * Prinsip:
 *   Agent BUKAN knowledge base — harus riset dulu.
 *   5W1H memastikan riset sistematis, bukan asal cari.
 *
 * Flow:
 *   User input → 5W1H Research → ResearchReport → Plan → Execute → Verify
 */
import { createLogger } from "../observability/logger.js"
import type { LLMEngine } from "./llm.js"
import type { MultiIndexRAG } from "../memory/multi-index-rag.js"
import type { EpisodicStore } from "../memory/episodic-store.js"
import type { SkillStore } from "../memory/skill-store.js"
import type { CodebaseNavigator } from "./navigator.js"
import { getTechKnowledgeRegistry, type TechKnowledgeRegistry, type BestPracticeEntry } from "./tech-knowledge-registry.js"

const log = createLogger("5W1H")

// ── 5W1H Dimensions ───────────────────────────────────────────

export type ResearchDimension = "what" | "who" | "where" | "when" | "why" | "how"

export const ALL_DIMENSIONS: ResearchDimension[] = ["what", "who", "where", "when", "why", "how"]

/** Mapping dimension → template pertanyaan untuk riset */
export const DIMENSION_QUESTIONS: Record<ResearchDimension, { en: string; id: string; prompts: string[] }> = {
  what: {
    en: "What",
    id: "Apa",
    prompts: [
      "What exactly needs to be built? (features, functionality, scope)",
      "What are the core requirements?",
      "What technologies/frameworks are involved?",
      "What does success look like? (acceptance criteria)",
      "What are the constraints? (time, budget, resources)",
      "What existing code or patterns should be followed?",
    ],
  },
  who: {
    en: "Who",
    id: "Siapa",
    prompts: [
      "Who are the end users? (role, technical level, expectations)",
      "Who are the stakeholders? (decision makers, reviewers)",
      "Who will maintain this code?",
      "Who is the target audience?",
      "Are there any third-party services or APIs involved?",
    ],
  },
  where: {
    en: "Where",
    id: "Di Mana",
    prompts: [
      "Where will this run? (environment: browser, server, mobile, CLI)",
      "Where in the codebase should changes go? (directory structure, module)",
      "Where are the dependencies defined? (package.json, requirements.txt)",
      "Where will this be deployed? (cloud provider, on-premise)",
      "Where are similar features implemented? (existing patterns)",
    ],
  },
  when: {
    en: "When",
    id: "Kapan",
    prompts: [
      "When is this needed by? (deadline, milestone)",
      "When should certain operations happen? (cron, events, triggers)",
      "When in the user flow does this execute?",
      "What is the priority compared to other work?",
      "Are there time-dependent behaviors? (TTL, expiry, scheduling)",
    ],
  },
  why: {
    en: "Why",
    id: "Mengapa",
    prompts: [
      "Why is this needed? (business value, problem being solved)",
      "Why this approach vs alternatives? (architecture decisions)",
      "Why these specific technologies?",
      "Why this particular implementation pattern?",
      "What problem does this solve that cannot be solved otherwise?",
    ],
  },
  how: {
    en: "How",
    id: "Bagaimana",
    prompts: [
      "How should this be implemented? (architecture, design pattern)",
      "How does this integrate with existing systems?",
      "How will this be tested? (unit, integration, e2e)",
      "How will errors be handled? (error boundaries, retry logic)",
      "How will performance be measured? (benchmarks, SLAs)",
      "How will this be deployed and monitored?",
      "What are the best practices for the chosen tech stack?",
      "How should the code be structured? (files, directories, modules)",
    ],
  },
}

// ── Research Results ───────────────────────────────────────────

export interface ResearchFinding {
  /** Which dimension this finding belongs to */
  dimension: ResearchDimension
  /** The finding text */
  finding: string
  /** Source of this finding (RAG entry, web URL, code analysis, user statement) */
  source: "rag" | "web" | "codebase" | "user" | "llm-reasoning" | "best-practice"
  /** Confidence 0-1 */
  confidence: number
  /** Source URL or reference ID if available */
  sourceUrl?: string
}

export interface ResearchReport {
  /** The original goal being researched */
  goal: string
  /** Timestamp when research was conducted */
  timestamp: string
  /** All findings organized by dimension */
  findings: ResearchFinding[]
  /** Detected tech stack from research */
  techStack: {
    languages: string[]
    frameworks: string[]
    databases: string[]
    tools: string[]
  }
  /** Detected architecture pattern */
  architecturePattern?: string
  /** Key decisions derived from research */
  keyDecisions: string[]
  /** If any dimension has 0 findings, list them */
  missingDimensions: ResearchDimension[]
  /** Are we confident enough to proceed? (all dimensions have at least 1 finding) */
  readyToProceed: boolean
  /** Best practices that should be followed for the detected stack */
  bestPractices: string[]
  /** Critical constraints identified */
  constraints: string[]
}

// ── Technology Detection ──────────────────────────────────────
// Note: Tech keywords and best practices are now managed by TechKnowledgeRegistry
// (see tech-knowledge-registry.ts). The registry is extensible, persistent,
// and loaded from .agentic/tech-knowledge.json per project.

// ── 5W1H Research Agent ───────────────────────────────────────

export interface ResearchContext {
  /** The user's goal / request */
  goal: string
  /** Project directory */
  projectDir: string
  /** LLM engine for reasoning */
  llm: LLMEngine
  /** RAG for knowledge search */
  rag?: MultiIndexRAG
  /** Episodic store for past experiences */
  episodicStore?: EpisodicStore
  /** Skill store for reusable skills */
  skillStore?: SkillStore
  /** Codebase navigator */
  navigator?: CodebaseNavigator
  /** TechKnowledgeRegistry — extensible tech knowledge base.
   *  If not provided, uses the global singleton (getTechKnowledgeRegistry()).
   *  Pass a custom instance for project-specific overrides. */
  techRegistry?: TechKnowledgeRegistry
}

export class ResearchAgent5W1H {
  /**
   * Main entry: conduct 5W1H research for a given goal.
   * 
   * Flow:
   * 1. Extract tech stack clues from goal
   * 2. Search RAG + episodes + codebase for each dimension
   * 3. Use LLM reasoning to fill gaps
   * 4. Look up best practices for detected tech
   * 5. Compile research report
   */
  async research(ctx: ResearchContext): Promise<ResearchReport> {
    const startTime = Date.now()
    const findings: ResearchFinding[] = []
    const goal = ctx.goal

    log.info(`[5W1H] Researching: "${goal.slice(0, 80)}..."`)

    // ── Phase 1: Detect tech stack from goal ──
    const registry = this._getRegistry(ctx)
    const techStack = this._detectTechStack(goal, registry)
    if (techStack.languages.length > 0 || techStack.frameworks.length > 0) {
      findings.push({
        dimension: "what",
        finding: `Detected tech stack: ${[
          ...techStack.languages, ...techStack.frameworks,
          ...techStack.databases, ...techStack.tools,
        ].join(", ")}`,
        source: "llm-reasoning",
        confidence: 0.8,
      })
    }

    // ── Phase 2: Research each 5W1H dimension ──
    const dimResults = await Promise.allSettled(
      ALL_DIMENSIONS.map(dim => this._researchDimension(dim, ctx, techStack))
    )

    for (const result of dimResults) {
      if (result.status === "fulfilled") {
        findings.push(...result.value)
      }
    }

    // ── Phase 3: Get best practices for detected stack ──
    const bestPractices = this._getBestPractices(techStack, registry)

    // Add best practices as "how" findings
    for (const bp of bestPractices.slice(0, 10)) {
      findings.push({
        dimension: "how",
        finding: `[${bp.priority ?? "recommended"}] ${bp.practice}: ${bp.detail}`,
        source: "best-practice",
        confidence: bp.priority === "critical" ? 0.95 : bp.priority === "recommended" ? 0.85 : 0.7,
        sourceUrl: bp.sourceUrl,
      })
    }

    // ── Phase 4: Identify constraints ──
    const constraints = this._extractConstraints(goal, findings)

    // ── Compile report ──
    const missingDimensions = ALL_DIMENSIONS.filter(
      dim => !findings.some(f => f.dimension === dim)
    )

    const report: ResearchReport = {
      goal,
      timestamp: new Date().toISOString(),
      findings,
      techStack,
      keyDecisions: this._extractKeyDecisions(findings),
      missingDimensions,
      readyToProceed: missingDimensions.length === 0,
      bestPractices: bestPractices.map(bp => `[${bp.category}] ${bp.practice}: ${bp.detail}`),
      constraints,
    }

    log.info(`[5W1H] Research complete: ${findings.length} findings, ${missingDimensions.length} gaps, took ${Date.now() - startTime}ms`)

    return report
  }

  /**
   * Format research report as a prompt section for LLM injection.
   */
  formatForPrompt(report: ResearchReport): string {
    const parts: string[] = [
      `<research-report>`,
      `<goal>${report.goal}</goal>`,
      `<ready>${report.readyToProceed ? "READY" : "MISSING INFORMATION"}</ready>`,
      ``,
      `<tech-stack>`,
    ]

    if (report.techStack.languages.length > 0) {
      parts.push(`  Languages: ${report.techStack.languages.join(", ")}`)
    }
    if (report.techStack.frameworks.length > 0) {
      parts.push(`  Frameworks: ${report.techStack.frameworks.join(", ")}`)
    }
    if (report.techStack.databases.length > 0) {
      parts.push(`  Databases: ${report.techStack.databases.join(", ")}`)
    }
    if (report.techStack.tools.length > 0) {
      parts.push(`  Tools: ${report.techStack.tools.join(", ")}`)
    }
    parts.push(`</tech-stack>`)
    parts.push(``)

    // Best practices section
    if (report.bestPractices.length > 0) {
      parts.push(`<mandatory-best-practices>`)
      parts.push(`CRITICAL: You MUST follow these practices for the detected tech stack:`)
      for (const bp of report.bestPractices) {
        parts.push(`  • ${bp}`)
      }
      parts.push(`</mandatory-best-practices>`)
      parts.push(``)
    }

    // Findings per dimension
    for (const dim of ALL_DIMENSIONS) {
      const dimFindings = report.findings.filter(f => f.dimension === dim)
      if (dimFindings.length === 0) continue
      const label = DIMENSION_QUESTIONS[dim]
      parts.push(`<${dim} title="${label.id} - ${label.en}">`)
      for (const f of dimFindings) {
        parts.push(`  <finding confidence="${f.confidence.toFixed(2)}" source="${f.source}">${f.finding}</finding>`)
      }
      parts.push(`</${dim}>`)
      parts.push(``)
    }

    if (report.constraints.length > 0) {
      parts.push(`<constraints>`)
      for (const c of report.constraints) {
        parts.push(`  • ${c}`)
      }
      parts.push(`</constraints>`)
      parts.push(``)
    }

    if (!report.readyToProceed) {
      parts.push(`<warning>⚠️ MISSING DIMENSIONS: ${report.missingDimensions.join(", ")}. You MUST research these before implementing.</warning>`)
    }

    parts.push(`</research-report>`)

    return parts.join("\n")
  }

  /**
   * Format as condensed research context for delegation/sub-agents.
   */
  formatForDelegation(report: ResearchReport): string {
    const lines: string[] = [
      `## 5W1H Research Context`,
      `Goal: ${report.goal}`,
      `Tech Stack: ${[
        ...report.techStack.languages,
        ...report.techStack.frameworks,
        ...report.techStack.databases,
      ].join(", ") || "unknown"}`,
      ``,
    ]

    if (report.bestPractices.length > 0) {
      lines.push(`### Mandatory Best Practices`)
      for (const bp of report.bestPractices) {
        lines.push(`- ${bp}`)
      }
      lines.push(``)
    }

    if (report.constraints.length > 0) {
      lines.push(`### Constraints`)
      for (const c of report.constraints) {
        lines.push(`- ${c}`)
      }
      lines.push(``)
    }

    return lines.join("\n")
  }

  /**
   * Store research report to RAG for cross-session reuse.
   * Findings disimpan sebagai episode di category "knowledge-tech"
   * dengan tag "5w1h" + tech stack keywords.
   */
  async storeResearchToRAG(report: ResearchReport, rag: MultiIndexRAG, projectId: string): Promise<void> {
    try {
      const now = new Date().toISOString()
      const techKeywords = [
        ...report.techStack.languages,
        ...report.techStack.frameworks,
        ...report.techStack.databases,
      ].map(s => s.toLowerCase().replace(/[^a-z0-9]/g, "-"))

      // Store per-dimension findings as separate RAG entries
      for (const dim of ALL_DIMENSIONS) {
        const dimFindings = report.findings.filter(f => f.dimension === dim)
        if (dimFindings.length === 0) continue

        const dimLabel = DIMENSION_QUESTIONS[dim]
        const summary = dimFindings.map(f => `[${f.source}] ${f.finding.slice(0, 200)}`).join("\n")
        const decisions = dimFindings
          .filter(f => f.confidence >= 0.7)
          .map(f => f.finding.slice(0, 100))

        rag.indexEpisode("knowledge-tech", {
          id: `5w1h-${dim}-${Date.now()}`,
          sessionId: projectId,
          planGoal: `${dimLabel.en}: ${report.goal.slice(0, 60)}`,
          summary: summary.slice(0, 500),
          outcome: "success",
          decisions,
          filesChanged: [],
          timestamp: now,
          tags: ["5w1h", `dim-${dim}`, ...techKeywords, "research"],
          projectId,
          score: 0.85,
          usageCount: 1,
          significance: "notable",
        })
      }

      // Store combined research report as a single episode
      const allFindings = report.findings.map(f =>
        `[${f.dimension.toUpperCase()}] ${f.finding.slice(0, 150)}`
      ).join("\n")

      rag.indexEpisode("knowledge-tech", {
        id: `5w1h-combined-${Date.now()}`,
        sessionId: projectId,
        planGoal: `5W1H Research: ${report.goal.slice(0, 60)}`,
        summary: `Tech stack: ${[...report.techStack.frameworks, ...report.techStack.languages, ...report.techStack.databases].join(", ") || "unknown"}\nBest practices: ${report.bestPractices.length}\nFindings:\n${allFindings.slice(0, 1000)}`,
        outcome: "success",
        decisions: report.keyDecisions.slice(0, 5),
        filesChanged: [],
        timestamp: now,
        tags: ["5w1h", "combined", ...techKeywords, "research"],
        projectId,
        score: 0.9,
        usageCount: 1,
        significance: "pivotal",
      })

      log.info(`[5W1H] Stored ${ALL_DIMENSIONS.length}+1 RAG entries for "${report.goal.slice(0, 40)}..."`)
    } catch (e) {
      log.warn(`[5W1H] Failed to store to RAG: ${e}`)
    }
  }

  /** Get or create tech registry from context or global */
  private _getRegistry(ctx?: ResearchContext): TechKnowledgeRegistry {
    if (ctx?.techRegistry) return ctx.techRegistry
    return getTechKnowledgeRegistry()
  }

  /** Detect tech stack from goal text + codebase */
  private _detectTechStack(goal: string, registry?: TechKnowledgeRegistry): ResearchReport["techStack"] {
    const reg = registry ?? getTechKnowledgeRegistry()
    const result = reg.detectTechs(goal)
    return result.stack
  }

  /** Research a single 5W1H dimension */
  private async _researchDimension(
    dim: ResearchDimension,
    ctx: ResearchContext,
    techStack: ResearchReport["techStack"],
  ): Promise<ResearchFinding[]> {
    const findings: ResearchFinding[] = []
    const _questions = DIMENSION_QUESTIONS[dim].prompts
    const _lowerGoal = ctx.goal.toLowerCase()

    // 1. Extract user-stated facts from goal
    if (dim === "what") {
      findings.push({
        dimension: "what",
        finding: `Goal: ${ctx.goal}`,
        source: "user",
        confidence: 1.0,
      })
    }

    // 2. If user mentioned specific tech, add to how/what
    if (dim === "how" || dim === "what") {
      for (const lang of techStack.languages) {
        findings.push({
          dimension: dim,
          finding: `Technology required: ${lang}`,
          source: "user",
          confidence: 0.9,
        })
      }
      for (const fw of techStack.frameworks) {
        findings.push({
          dimension: dim,
          finding: `Framework required: ${fw}`,
          source: "user",
          confidence: 0.9,
        })
      }
      for (const db of techStack.databases) {
        findings.push({
          dimension: dim,
          finding: `Database required: ${db}`,
          source: "user",
          confidence: 0.9,
        })
      }
    }

    // 3. Search RAG for relevant knowledge
    if (ctx.rag) {
      try {
        const query = `${DIMENSION_QUESTIONS[dim].en}: ${ctx.goal}`
        const ragResult = await ctx.rag.searchWithConfidence(query)
        const ragEntries = ragResult?.entries ?? []
        if (ragEntries.length > 0) {
          for (const r of ragEntries.slice(0, 3)) {
            // Extract content from episode summary or title
            const content = r.episode?.summary ?? r.title
            if (content && content.length > 10) {
              findings.push({
                dimension: dim,
                finding: content.slice(0, 300),
                source: "rag",
                confidence: r.confidence ?? 0.5,
                sourceUrl: r.episode?.id ? `rag:${r.episode.id}` : undefined,
              })
            }
          }
        }
      } catch (e) {
        log.warn(`[5W1H] RAG search failed for ${dim}: ${e}`)
      }
    }

    // 4. Search episodic store for similar tasks
    if (ctx.episodicStore) {
      try {
        const episodes = ctx.episodicStore.search(ctx.goal)
        for (const ep of episodes.slice(0, 2)) {
          if (ep.summary) {
            findings.push({
              dimension: dim,
              finding: `Past experience: ${ep.summary.slice(0, 300)} (outcome: ${ep.outcome})`,
              source: "rag",
              confidence: ep.outcome === "success" ? 0.7 : 0.4,
            })
          }
        }
      } catch (e) {
        log.warn(`[5W1H] Episodic search failed: ${e}`)
      }
    }

    return findings
  }

  /** Get best practices for detected tech stack */
  private _getBestPractices(techStack: ResearchReport["techStack"], registry?: TechKnowledgeRegistry): BestPracticeEntry[] {
    const reg = registry ?? getTechKnowledgeRegistry()
    const allTechs = [
      ...techStack.frameworks,
      ...techStack.languages,
      ...techStack.databases,
      ...techStack.tools,
    ]
    // Get practices from registry — includes built-in + custom + general
    const practices = reg.getPractices(allTechs.length > 0 ? allTechs : undefined, "recommended")
    return practices
  }

  /** Extract constraints from goal and findings */
  private _extractConstraints(goal: string, _findings: ResearchFinding[]): string[] {
    const constraints: string[] = []
    const lower = goal.toLowerCase()

    // Check for explicit constraint keywords
    if (/\b(urgent|asap|segera|cepat)\b/i.test(lower)) {
      constraints.push("High priority — optimize for development speed")
    }
    if (/\b(simple|minimalis|sederhana)\b/i.test(lower)) {
      constraints.push("Keep it simple — avoid over-engineering")
    }
    if (/\b(secure|keamanan|aman)\b/i.test(lower)) {
      constraints.push("Security is a primary concern — follow OWASP guidelines")
    }
    if (/\b(scalable|scale|banyak|besar)\b/i.test(lower)) {
      constraints.push("Must be scalable — consider horizontal scaling and caching")
    }
    if (/\b(budget|murah|gratis|free)\b/i.test(lower)) {
      constraints.push("Cost-sensitive — prefer free/open-source solutions")
    }

    return constraints
  }

  /** Extract key decisions from findings */
  private _extractKeyDecisions(findings: ResearchFinding[]): string[] {
    const decisions: string[] = []
    for (const f of findings) {
      if (f.confidence >= 0.8 && f.source !== "llm-reasoning") {
        decisions.push(f.finding.slice(0, 150))
      }
    }
    return decisions.slice(0, 10)
  }
}
