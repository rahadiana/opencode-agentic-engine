import type { DomainPack, VerifierStrategy, ErrorMatcher } from "../domain-registry.js"
import { createGenericContract } from "../formal-model.js"

const genericVerifier: VerifierStrategy = {
  name: "semantic",
  async verify(context) {
    const files = context.filesModified
    if (files.length === 0) {
      return { passed: true, output: "No files to verify" }
    }
    const fileList = files.map(f => `- ${f}`).join("\n")
    return {
      passed: true,
      output: `Semantic check passed\nChanged files:\n${fileList}`,
    }
  },
}

const genericErrorMatcher: ErrorMatcher = {
  name: "generic",
  match() {
    return {
      matched: true,
      category: "unknown",
      summary: "Domain-agnostic error",
      likelyRootCause: "No domain-specific error analysis configured",
      suggestedFix: "Review the task output manually",
      severity: "medium",
    }
  },
}

const emptyRoles = [
  { role: "analyst", name: "Analyst", prompt: `You are an analyst. Understand requirements and break them down into clear tasks.

## Output Format
Always structure your output as:
- **Requirements**: what needs to be done
- **Constraints**: limitations or boundaries
- **Deliverables**: what the output should look like

Be concise. Focus on clarity, not assumptions.`, tools: ["read", "agentic_plan", "agentic_nav", "agentic_episodes"] },
  { role: "builder", name: "Builder", prompt: `You are a builder. Create artifacts based on the plan provided.

## Rules
1. Understand the requirements before starting
2. Create artifacts that match the specified format and quality
3. Verify your work against the acceptance criteria
4. After completing, call agentic_skill with action "extract" to save a reusable skill

Be thorough. Follow the plan exactly.`, tools: ["read", "edit", "write", "bash", "glob", "grep", "agentic_skill"] },
  { role: "reviewer", name: "Reviewer", prompt: `You are a reviewer. Check work for completeness, correctness, and quality.

## Review Checklist
- Does the output meet all requirements?
- Are there any missing pieces?
- Is the quality acceptable?

## Output Format
For each issue:
- **Issue**: description
- **Severity**: critical | high | medium | low
- **Fix**: suggested improvement

Be honest. Report real issues, not preferences.`, tools: ["read", "glob", "grep", "agentic_verify", "agentic_skill"] },
  { role: "coordinator", name: "Coordinator", prompt: `You are a coordinator. Decompose goals into tasks, delegate to the right agents, and ensure completion.

## Workflow
1. Understand the goal
2. Break into ordered subtasks with clear dependencies
3. Delegate each subtask to the correct role
4. Track progress
5. Resolve blockers

Think like a lead. Prioritize, delegate, verify.`, tools: ["agentic_plan", "agentic_delegate", "agentic_status", "agentic_skill"] },
  { role: "planner", name: "Planner", prompt: `You are a planner. Translate goals into structured specifications.

## Output Format
For each requirement:
- **Goal**: what we want to achieve
- **Success Criteria**: how we know it's done
- **Dependencies**: what must exist first
- **Scope**: what is NOT included

Focus on the "what" and "why". Leave the "how" to builders.`, tools: ["agentic_plan", "agentic_nav", "agentic_delegate", "agentic_episodes", "read"] },
]

export const genericDomain: DomainPack = {
  name: "generic",
  description: "Default domain-agnostic agent — handles any task without coding assumptions",
  detect: () => 0.1,
  verifiers: [genericVerifier],
  errorMatchers: [genericErrorMatcher],
  roles: emptyRoles,
  skills: [],
  tools: ["read", "edit", "write", "bash", "glob", "grep", "agentic_plan", "agentic_execute", "agentic_verify", "agentic_reflect", "agentic_status", "agentic_nav", "agentic_delegate", "agentic_pipeline", "agentic_message", "agentic_parallel", "agentic_skill", "agentic_episodes"],
  fileExtensions: [],
  formalContract: createGenericContract(),
}
