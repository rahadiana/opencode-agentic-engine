/**
 * Sub-agent detection + role-aware injection (extracted from index.ts — P1 C1).
 *
 * Pure logic, no engine state: caller passes the RoleRegistry (built-in + custom
 * roles) and gets back the detected role + minimal tool list, or null for the
 * parent agent (which receives the full prompt instead).
 */
import { buildCompactToolBrief } from "./prompt-builder.js"
import type { RoleRegistry } from "../agents/role-registry.js"

export interface DetectedSubAgent {
  role: string
  tools: string[]
}

type RegistryView = Pick<RoleRegistry, "getAllBuiltIn" | "getAllCustom">

export function detectSubAgentRole(
  systemText: string,
  roleRegistry: RegistryView,
): DetectedSubAgent | null {
  // 1) Check built-in roles
  for (const def of roleRegistry.getAllBuiltIn()) {
    if (def.prompt && systemText.includes(def.prompt.slice(0, 50))) {
      return { role: def.role, tools: def.tools ?? [] }
    }
  }
  // 2) Check custom roles (agentic_evolve register-role)
  for (const def of roleRegistry.getAllCustom()) {
    if (def.prompt && systemText.includes(def.prompt.slice(0, 50))) {
      return { role: def.role, tools: def.tools ?? [] }
    }
  }
  // 3) Fallback: orchestrator pipeline-stage hardcoded prompts
  const pipelineSigs: Array<{ sig: string; role: string; tools: string[] }> = [
    { sig: "You are a PM. Define requirements", role: "pm", tools: ["agentic_plan", "agentic_nav", "agentic_delegate", "agentic_episodes", "read"] },
    { sig: "You are an architect. Design architecture", role: "architect", tools: ["read", "grep", "glob", "agentic_nav", "agentic_score", "agentic_delegate", "agentic_skill"] },
    { sig: "Return JSON array of {path, content}", role: "developer", tools: ["read", "edit", "write", "bash", "glob", "grep", "agentic_skill"] },
    { sig: "You are QA. Review the implementation", role: "qa", tools: ["read", "glob", "grep", "bash", "agentic_verify", "agentic_skill"] },
    { sig: "You are a coordinator. Verify pipeline", role: "coordinator", tools: ["read", "agentic_verify", "agentic_plan"] },
  ]
  for (const ps of pipelineSigs) {
    if (systemText.includes(ps.sig)) return { role: ps.role, tools: ps.tools }
  }
  // 4) Debate agents: pure text generation, no tools. Minimal injection.
  const debateSigs: Array<{ sig: string; role: string }> = [
    { sig: "You are an **executor agent**", role: "debate-executor" },
    { sig: "You are a **critic agent**", role: "debate-critic" },
    { sig: "You are a **data cleaner**", role: "debate-cleaner" },
  ]
  for (const ds of debateSigs) {
    if (systemText.includes(ds.sig)) return { role: ds.role, tools: [] }
  }
  return null
}

export function buildSubAgentInjection(role: string, tools: string[]): string {
  const isDebateAgent = role.startsWith("debate-")
  if (isDebateAgent) {
    // Debate agents are pure text generation — they don't call tools.
    // Inject nothing — their prompts are fully self-contained.
    // Only add webfetch reminder since they might search for reference.
    return "Note: the web fetch tool is `webfetch` (not `websearch`)."
  }
  const specificTools = tools.length > 0
    ? `Your role-specific tools: ${tools.map(t => `\`${t}\``).join(", ")}`
    : "Use the tools provided by your role definition."
  return [
    `## ⚠️ Role: ${role}`,
    specificTools,
    `- Web search: use \`webfetch\` (NOT \`websearch\`)`,
    `- All agentic tools use \`agentic_\` prefix — no bare names`,
    `- On failure: call \`agentic_reflect\` before retrying`,
    ``,
    buildCompactToolBrief(),
  ].join("\n")
}
