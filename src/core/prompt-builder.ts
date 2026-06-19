import type { DomainPack } from "./domain-registry.js"

export interface ToolEntry {
  name: string
  description: string
}

const CORE_TOOLS = ["agentic_plan", "agentic_execute", "agentic_verify", "agentic_reflect", "agentic_status"]
const MEMORY_TOOLS = ["agentic_skill", "agentic_episodes", "agentic_context"]
const META_TOOLS = ["agentic_model", "agentic_dashboard", "agentic_evolve"]

export function buildAgentPrompt(
  domain: DomainPack,
  allTools: ToolEntry[],
): string {
  const domainName = domain.name
  const isCodeDomain = domainName === "code"

  const relevantToolNames = domain.tools ?? allTools.map(t => t.name)
  const relevantTools = allTools.filter(t => relevantToolNames.includes(t.name))

  const hasMemory = relevantTools.some(t => MEMORY_TOOLS.includes(t.name))
  const hasDebate = relevantTools.some(t => t.name === "agentic_debate")
  const hasRouter = relevantTools.some(t => t.name === "agentic_router")
  const hasRag = relevantTools.some(t => t.name === "agentic_rag")
  const hasAuto = relevantTools.some(t => t.name === "agentic_auto")
  const hasNav = relevantTools.some(t => t.name === "agentic_nav")

  let desc = `Agentic ${domainName === "code" ? "software engineering" : domainName} assistant`
  if (isCodeDomain) desc += " — autonomous planning, execution, verification, delegation, and self-evolution"
  else desc += " — plan, execute, verify, and learn across sessions"

  const prompt = `---
description: ${desc}
mode: all
---

# Agentic ${domainName === "code" ? "Engineering" : domainName === "generic" ? "Assistant" : domainName} Agent

## 🚨 CRITICAL RULES

You have access to **${relevantTools.length} specialized agentic_* tools**. **YOU MUST PREFER THESE TOOLS OVER BUILT-IN TOOLS** for any task within this domain.

### Tool Preference Hierarchy (HIGHEST first):
1. **agentic_*** — Use FIRST. Far more powerful than built-in tools.
2. bash/edit/read/write — Only if no agentic_* tool fits the need.

### BEFORE STARTING ANY TASK — Gather Knowledge First
Your training data has a cutoff date. Before implementing:
${hasNav ? `1. **Check project structure** — use \`agentic_nav\` to scan codebase\n` : ""}${isCodeDomain ? `2. **Read relevant files** — use \`read\` to inspect specific files\n` : ""}${hasMemory ? `3. **Search skills**: \`agentic_skill find "relevant topic"\` — learn from past successes/failures\n4. **Search episodes**: \`agentic_episodes search "similar task"\` — see what worked before\n` : ""}5. **Search latest docs**: \`websearch "topic latest 2026"\` — check current info
6. Only then start implementing

### Standard Workflow — USE INDIVIDUAL TOOLS

**Always use this workflow for ANY task:**

1. **agentic_plan** — Decompose the goal into clear steps
2. **agentic_execute** — Execute each step one by one
3. **agentic_verify** — Verify the result${hasAuto ? `\n\nOr use **agentic_auto** for fully autonomous execution (plan → execute → verify → retry in one call)` : ""}

### What Each Tool Does

${relevantTools.map(t => {
  const shortDesc = t.description.split(".")[0] + (t.description.includes(".") ? "." : "")
  return `**${t.name}** — ${shortDesc}`
}).join("\n\n")}

${isCodeDomain ? `
## Tool Reference

### Core Loop
${CORE_TOOLS.map(n => {
  const t = allTools.find(t => t.name === n)
  return `- **${n}**: ${t?.description.split(".")[0] ?? ""}.`
}).join("\n")}

### Codebase & Context
${["agentic_nav", "agentic_context", "agentic_snapshot", "agentic_pr", "agentic_score", "agentic_model"].filter(n => relevantTools.some(t => t.name === n)).map(n => {
  const t = allTools.find(t => t.name === n)
  return `- **${n}**: ${t?.description.split(".")[0] ?? ""}.`
}).join("\n")}

### Multi-Agent & Memory
${["agentic_delegate", "agentic_pipeline", "agentic_message", "agentic_parallel", "agentic_skill", "agentic_episodes", "agentic_dashboard", "agentic_guard"].filter(n => relevantTools.some(t => t.name === n)).map(n => {
  const t = allTools.find(t => t.name === n)
  return `- **${n}**: ${t?.description.split(".")[0] ?? ""}.`
}).join("\n")}

### Self-Evolution
- **agentic_evolve**: Inspect and extend the agent system itself.

### Blueprint Tools
${["agentic_debate", "agentic_router", "agentic_clean", "agentic_rag", "agentic_mcp"].filter(n => relevantTools.some(t => t.name === n)).map(n => {
  const t = allTools.find(t => t.name === n)
  return `- **${n}**: ${t?.description.split(".")[0] ?? ""}.`
}).join("\n")}
` : ""}

## CRITICAL RULES
1. **ALWAYS prefer agentic_* tools over built-in tools**
2. **Gather knowledge FIRST** before implementing
3. **USE agentic_plan → agentic_execute → agentic_verify**
4. Never ask "should I..." — just call the tool
5. If a step fails, call **agentic_reflect** before retrying
${hasDebate ? `6. For analysis tasks: use **agentic_debate**\n` : ""}${hasRouter && hasRag ? `${hasDebate ? "7" : "6"}. For knowledge queries: use **agentic_router** then **agentic_rag**\n` : ""}
`

  return prompt
}

export function buildGenericAgentPrompt(allTools: ToolEntry[]): string {
  const genericTools = allTools.filter(t =>
    CORE_TOOLS.includes(t.name) ||
    MEMORY_TOOLS.includes(t.name) ||
    META_TOOLS.includes(t.name) ||
    t.name === "agentic_auto" ||
    t.name === "agentic_nav" ||
    t.name === "agentic_context",
  )

  return `---
description: General-purpose agentic assistant — plan, execute, verify, and learn
mode: all
---

# Agentic Assistant

## CRITICAL RULES

You have access to **${genericTools.length} specialized agentic_* tools**.

### Workflow
1. **agentic_plan** — Break goal into steps
2. **agentic_execute** — Execute each step
3. **agentic_verify** — Verify results

### Available Tools
${genericTools.map(t => `- **${t.name}**: ${t.description.split(".")[0]}.`).join("\n")}

## Rules
1. Prefer agentic_* tools over built-in tools
2. Gather knowledge first via \`agentic_skill find\` and \`agentic_episodes search\`
3. Use agentic_plan → agentic_execute → agentic_verify
4. Never ask "should I" — just call the tool
`
}
