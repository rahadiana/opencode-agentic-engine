/**
 * PromptTemplate — XML-based prompt composition (OpenAI + Anthropic best practices).
 *
 * Structure mirrors HTML's head/body/footer, wrapped in XML tags per
 * Anthropic's recommendation for unambiguous LLM parsing:
 *
 *   <identity>        — HEAD : who the agent IS (role, purpose, tool reminders)
 *   <instructions>    — BODY : what the agent should DO (tools, workflow, domain)
 *   <guardrails>      — FOOTER: constraints, rules, budget (closing)
 *
 * Usage:
 *   const t = new PromptTemplate()
 *   t.identity("You are an autonomous software engineering agent.")
 *   t.instructions("## Workflow", "1. agentic_plan → agentic_execute → agentic_verify")
 *   t.guardrails("CRITICAL: Never call non-existent tools.")
 *   const prompt = t.render()
 */

export interface PromptSection {
  /** Section content (supports Markdown inside XML) */
  content: string
  /** Optional condition — section only rendered when true */
  when?: boolean
}

export class PromptTemplate {
  private _identity: PromptSection[] = []
  private _instructions: PromptSection[] = []
  private _guardrails: PromptSection[] = []
  private _title: string = ""

  /** Set the top-level heading */
  title(value: string): this {
    this._title = value
    return this
  }

  /**
   * HEAD — who the agent IS.
   * Role, purpose, communication style, critical tool name reminders.
   * Rendered inside <identity> XML tags.
   */
  identity(content: string, when: boolean = true): this {
    this._identity.push({ content, when })
    return this
  }

  /**
   * BODY — what the agent should DO.
   * Tool list, domain-specific rules, workflow, examples.
   * Rendered inside <instructions> XML tags.
   */
  instructions(content: string, when: boolean = true): this {
    this._instructions.push({ content, when })
    return this
  }

  /**
   * FOOTER — constraints and guardrails.
   * Critical rules, budget limits, anti-hallucination, closing constraints.
   * Rendered inside <guardrails> XML tags.
   */
  guardrails(content: string, when: boolean = true): this {
    this._guardrails.push({ content, when })
    return this
  }

  /**
   * Bulk-add multiple items to a section.
   */
  identityAll(items: string[], when: boolean = true): this {
    for (const item of items) this.identity(item, when)
    return this
  }

  instructionsAll(items: string[], when: boolean = true): this {
    for (const item of items) this.instructions(item, when)
    return this
  }

  guardrailsAll(items: string[], when: boolean = true): this {
    for (const item of items) this.guardrails(item, when)
    return this
  }

  /** Returns true if at least one section has active (when=true) content */
  private get hasContent(): boolean {
    return (
      this._identity.some(s => s.when !== false) ||
      this._instructions.some(s => s.when !== false) ||
      this._guardrails.some(s => s.when !== false)
    )
  }

  /** Render a single section only if it has active items */
  private renderSection(tag: string, sections: PromptSection[]): string {
    const active = sections.filter(s => s.when !== false)
    if (active.length === 0) return ""
    const body = active.map(s => s.content).join("\n\n")
    return `<${tag}>\n${body}\n</${tag}>`
  }

  /**
   * Render the full prompt.
   *
   * Output format:
   *   # Title (if set)
   *   <identity>...</identity>
   *   <instructions>...</instructions>
   *   <guardrails>...</guardrails>
   */
  render(): string {
    if (!this.hasContent) return ""

    const parts: string[] = []
    if (this._title) parts.push(`# ${this._title}`)

    const identity = this.renderSection("identity", this._identity)
    if (identity) parts.push(identity)

    const instructions = this.renderSection("instructions", this._instructions)
    if (instructions) parts.push(instructions)

    const guardrails = this.renderSection("guardrails", this._guardrails)
    if (guardrails) parts.push(guardrails)

    return parts.join("\n\n")
  }

  /**
   * Returns YAML frontmatter + prompt body (for file-based agent definition).
   */
  renderWithFrontmatter(description: string): string {
    const body = this.render()
    return `---
description: ${description}
mode: all
---

${body}`
  }

  /** Reset all sections */
  clear(): void {
    this._identity = []
    this._instructions = []
    this._guardrails = []
    this._title = ""
  }

  /** Clone this template (deep copy of sections) */
  clone(): PromptTemplate {
    const t = new PromptTemplate()
    t._title = this._title
    t._identity = [...this._identity.map(s => ({ ...s }))]
    t._instructions = [...this._instructions.map(s => ({ ...s }))]
    t._guardrails = [...this._guardrails.map(s => ({ ...s }))]
    return t
  }
}
