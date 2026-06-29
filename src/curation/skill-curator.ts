/**
 * Skill Curator — Background skill maintenance and auto-injection.
 *
 * Inspired by Hermes Agent's ``Curator`` (agent/curator.py). Manages the
 * lifecycle of agent-created skills — auto-transitioning stale skills to
 * archived, detecting overlapping skills for consolidation, and injecting
 * relevant skills into the system prompt before each task.
 *
 * Two subsystems:
 *
 * 1. **Lifecycle engine** (deterministic, no LLM):
 *    active → stale (30 days inactive) → archived (90 days).
 *    Lifecycle is COMPUTED from lastUsed — skills are never mutated.
 *
 * 2. **Relevance injector** (TF-IDF, fast):
 *    Before each task, select top-N skills matching the goal description.
 *    Inject their key steps into the system prompt's <knowledge-context>.
 */

import type { SkillRecord } from "../memory/skill-store.js"
import { STOP_WORDS } from "../memory/stopwords.js"
import { createLogger } from "../observability/logger.js"

const log = createLogger("SkillCurator")

// ── Config ─────────────────────────────────────────────────────────

export interface CuratorConfig {
  enabled: boolean
  staleAfterDays: number
  archiveAfterDays: number
  maxSkillsInPrompt: number
  injectThreshold: number
  consolidationEnabled: boolean
}

export const DEFAULT_CURATOR_CONFIG: CuratorConfig = {
  enabled: true,
  staleAfterDays: 30,
  archiveAfterDays: 90,
  maxSkillsInPrompt: 3,
  injectThreshold: 0.15,
  consolidationEnabled: false,
}

// ── Lifecycle States ───────────────────────────────────────────────

export type CuratorLifecycleState = "active" | "stale" | "archived"

export interface LifecycleReport {
  markedStale: number
  archived: number
  reactivated: number
  checked: number
}

// ── Types for relevance injection ──────────────────────────────────

export interface InjectedSkill {
  id: string
  name: string
  pattern: string
  keywords: string[]
  steps: string[]
  usageCount: number
  successRate: number
  /** TF-IDF similarity score (0–1) */
  relevance: number
  /** Computed lifecycle state */
  lifecycle: CuratorLifecycleState
}

// ── Curator ────────────────────────────────────────────────────────

export class SkillCurator {
  private config: CuratorConfig
  /** Callback to get all skills */
  private getSkills: () => SkillRecord[]
  /** Pinned skill IDs */
  private pinned: Set<string> = new Set()

  constructor(config: Partial<CuratorConfig> = {}, getSkills: () => SkillRecord[]) {
    this.config = { ...DEFAULT_CURATOR_CONFIG, ...config }
    this.getSkills = getSkills
  }

  pin(skillId: string): void { this.pinned.add(skillId) }
  unpin(skillId: string): void { this.pinned.delete(skillId) }
  isPinned(skillId: string): boolean { return this.pinned.has(skillId) }

  updateConfig(partial: Partial<CuratorConfig>): void {
    this.config = { ...this.config, ...partial }
  }

  getConfig(): CuratorConfig { return { ...this.config } }

  /**
   * Compute the curator lifecycle for a skill based on lastUsed date.
   * Pure function — no mutation.
   */
  getLifecycle(skill: SkillRecord, now: Date = new Date()): CuratorLifecycleState {
    if (this.pinned.has(skill.definition.meta.id)) return "active"

    const lastUsed = new Date(skill.lastUsed)
    const staleMs = this.config.staleAfterDays * 86400000
    const archiveMs = this.config.archiveAfterDays * 86400000

    if (now.getTime() - lastUsed.getTime() >= archiveMs) return "archived"
    if (now.getTime() - lastUsed.getTime() >= staleMs) return "stale"
    return "active"
  }

  /**
   * Walk all skills and report lifecycle transitions.
   * Does NOT mutate skill records — only reports what would change.
   */
  applyLifecycle(now: Date = new Date()): LifecycleReport {
    const report: LifecycleReport = { markedStale: 0, archived: 0, reactivated: 0, checked: 0 }
    if (!this.config.enabled) return report

    const skills = this.getSkills()

    for (const skill of skills) {
      report.checked++
      const state = this.getLifecycle(skill, now)

      if (state === "archived") {
        report.archived++
        log.debug(`[Curator] Skill "${skill.definition.meta.name}" would be archived — unused since ${skill.lastUsed}`)
      } else if (state === "stale") {
        report.markedStale++
      }
    }

    if (report.markedStale > 0 || report.archived > 0) {
      log.info(
        `[Curator] Lifecycle scan: ${report.checked} checked, ` +
        `${report.markedStale} stale, ${report.archived} archived`,
      )
    }

    return report
  }

  /**
   * Select top-N skills relevant to the given goal.
   * Filters out archived skills automatically.
   */
  injectRelevant(goal: string): InjectedSkill[] {
    if (!this.config.enabled) return []

    const now = new Date()
    const skills = this.getSkills().filter(s => {
      if (this.pinned.has(s.definition.meta.id)) return true
      return this.getLifecycle(s, now) !== "archived"
    })

    if (skills.length === 0) return []

    const goalTokens = this.tokenize(goal)
    if (goalTokens.size === 0) return []

    const scored: Array<{ skill: SkillRecord; score: number }> = []

    for (const skill of skills) {
      const skillText = [
        skill.definition.meta.name,
        skill.definition.trigger.pattern,
        ...(skill.definition.trigger.keywords ?? []),
      ].join(" ")

      const skillTokens = this.tokenize(skillText)
      if (skillTokens.size === 0) continue

      let intersection = 0
      for (const gt of goalTokens) {
        if (skillTokens.has(gt)) intersection++
      }
      const union = goalTokens.size + skillTokens.size - intersection
      const similarity = union > 0 ? intersection / union : 0

      // Boost by success rate
      const boosted = similarity * (0.7 + 0.3 * skill.successRate)

      if (boosted >= this.config.injectThreshold) {
        scored.push({ skill, score: boosted })
      }
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, this.config.maxSkillsInPrompt)
      .map(({ skill, score }) => ({
        id: skill.definition.meta.id,
        name: skill.definition.meta.name,
        pattern: skill.definition.trigger.pattern,
        keywords: skill.definition.trigger.keywords ?? [],
        steps: (skill.definition.workflow?.steps ?? []).map(s => s.description),
        usageCount: skill.usageCount,
        successRate: skill.successRate,
        relevance: Math.round(score * 100) / 100,
        lifecycle: this.getLifecycle(skill),
      }))
  }

  /** Format injected skills as a prompt section */
  formatInjectedSkills(injected: InjectedSkill[]): string {
    if (injected.length === 0) return ""

    const blocks: string[] = [
      `## 🧠 Relevant Skills (from past sessions)\n`,
      `> The following skills were extracted from similar tasks. Use them as reference — they represent proven approaches.\n`,
    ]

    for (const skill of injected) {
      const confidenceLabel = skill.successRate >= 0.8 ? "HIGH" : skill.successRate >= 0.5 ? "MEDIUM" : "LOW"

      blocks.push(`### ${skill.name}`)
      blocks.push(`> **Success:** ${(skill.successRate * 100).toFixed(0)}% | **Used:** ${skill.usageCount}× | **Confidence:** ${confidenceLabel} | **Relevance:** ${(skill.relevance * 100).toFixed(0)}%\n`)
      blocks.push(`**Pattern:** ${skill.pattern}\n`)
      if (skill.steps.length > 0) {
        blocks.push(`**Key steps:**`)
        for (const step of skill.steps.slice(0, 5)) {
          blocks.push(`  - ${step}`)
        }
      }
      blocks.push("")
    }

    blocks.push(
      "> 💡 *Don't see what you need? Use `agentic_skill find \"your keyword\"` to search across all skills.*\n",
    )

    return blocks.join("\n")
  }

  /** Detect overlapping skill pairs via TF-IDF similarity */
  detectOverlaps(threshold = 0.6): Array<{ a: string; b: string; similarity: number }> {
    const now = new Date()
    const skills = this.getSkills().filter(s => {
      if (this.pinned.has(s.definition.meta.id)) return false
      return this.getLifecycle(s, now) !== "archived"
    })

    const overlaps: Array<{ a: string; b: string; similarity: number }> = []

    for (let i = 0; i < skills.length; i++) {
      const tokensA = this.tokenize([
        skills[i].definition.meta.name,
        skills[i].definition.trigger.pattern,
        ...(skills[i].definition.trigger.keywords ?? []),
      ].join(" "))

      for (let j = i + 1; j < skills.length; j++) {
        const tokensB = this.tokenize([
          skills[j].definition.meta.name,
          skills[j].definition.trigger.pattern,
          ...(skills[j].definition.trigger.keywords ?? []),
        ].join(" "))

        let intersection = 0
        for (const ta of tokensA) {
          if (tokensB.has(ta)) intersection++
        }
        const union = tokensA.size + tokensB.size - intersection
        const sim = union > 0 ? intersection / union : 0

        if (sim >= threshold) {
          overlaps.push({
            a: skills[i].definition.meta.name,
            b: skills[j].definition.meta.name,
            similarity: Math.round(sim * 100) / 100,
          })
        }
      }
    }

    return overlaps.sort((a, b) => b.similarity - a.similarity)
  }

  /** Handle negative feedback on a skill */
  handleNegativeFeedback(skillName: string): void {
    const skills = this.getSkills().filter(s => s.definition.meta.name === skillName)
    for (const skill of skills) {
      skill.successWindow.push(false)
      if (skill.successWindow.length > 20) {
        skill.successWindow = skill.successWindow.slice(-20)
      }
      const wins = skill.successWindow.filter(Boolean).length
      skill.successRate = skill.successWindow.length > 0
        ? wins / skill.successWindow.length
        : 0.5
      log.info(`[Curator] Negative feedback on "${skillName}" — success rate now ${(skill.successRate * 100).toFixed(0)}%`)
    }
  }

  private tokenize(text: string): Set<string> {
    const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()
    const tokens = new Set<string>()
    for (const t of normalized.split(/\s+/)) {
      if (t.length > 2 && !STOP_WORDS.has(t)) {
        tokens.add(t)
      }
    }
    return tokens
  }
}
