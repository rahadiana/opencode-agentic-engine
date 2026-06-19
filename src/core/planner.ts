import type { TaskIntent, Subtask } from "./intent-parser.js"
import type { LLMEngine } from "./llm.js"
import { DependencyGraph } from "./formal-model.js"

export interface DecompositionRule {
  pattern: RegExp | string
  keywords: string[]
  template: (context: string) => Subtask[]
  domain?: string
}

export class Planner {
  private rules: DecompositionRule[] = [
    // ── Software-engineering templates (backward compatible, matched first) ──
    {
      pattern: /add|create|build|implement/i,
      keywords: ["feature", "component", "module", "page", "endpoint", "api"],
      template: (goal: string) => [
        { id: "plan-types", description: "Define TypeScript interfaces and types needed", dependsOn: [], verificationCriteria: ["No type errors"] },
        { id: "plan-impl", description: `Implement: ${goal}`, dependsOn: ["plan-types"], verificationCriteria: ["Tests pass"] },
        { id: "plan-tests", description: "Write comprehensive unit tests", dependsOn: ["plan-impl"], verificationCriteria: ["All tests pass"] },
      ],
    },
    {
      pattern: /fix|bug|repair|resolve|patch/i,
      keywords: ["bug", "issue", "error", "crash", "broken"],
      template: (goal: string) => [
        { id: "fix-repro", description: "Reproduce the bug and add a failing test", dependsOn: [], verificationCriteria: ["Test reproduces the error"] },
        { id: "fix-root", description: `Identify root cause and apply fix: ${goal}`, dependsOn: ["fix-repro"], verificationCriteria: ["Failing test now passes"] },
        { id: "fix-regression", description: "Run full test suite to check for regressions", dependsOn: ["fix-root"], verificationCriteria: ["All tests pass"] },
      ],
    },
    {
      pattern: /refactor|clean|restructure|extract/i,
      keywords: ["refactor", "cleanup", "extract", "move", "rename"],
      template: (goal: string) => [
        { id: "refactor-audit", description: "Audit current implementation and document dependencies", dependsOn: [], verificationCriteria: ["Dependency map created"] },
        { id: "refactor-extract", description: `Extract and restructure: ${goal}`, dependsOn: ["refactor-audit"], verificationCriteria: ["Tests still pass"] },
        { id: "refactor-cleanup", description: "Remove old code and update references", dependsOn: ["refactor-extract"], verificationCriteria: ["No dead code", "Tests pass"] },
      ],
    },
    {
      pattern: /test|spec|verify/i,
      keywords: ["test", "spec", "coverage", "verify"],
      template: (goal: string) => [
        { id: "test-audit", description: "Identify untested code paths and edge cases", dependsOn: [], verificationCriteria: ["Coverage gaps documented"] },
        { id: "test-write", description: `Write tests: ${goal}`, dependsOn: ["test-audit"], verificationCriteria: ["New tests pass"] },
        { id: "test-verify", description: "Run full suite and verify coverage improved", dependsOn: ["test-write"], verificationCriteria: ["Coverage increased"] },
      ],
    },
    {
      pattern: /deploy|release|ship/i,
      keywords: ["deploy", "release", "publish", "launch", "ship"],
      template: (goal: string) => [
        { id: "deploy-audit", description: "Verify all tests pass and build succeeds", dependsOn: [], verificationCriteria: ["CI green"] },
        { id: "deploy-build", description: `Build production artifacts: ${goal}`, dependsOn: ["deploy-audit"], verificationCriteria: ["Build succeeds"] },
        { id: "deploy-release", description: "Tag release and update changelog", dependsOn: ["deploy-build"], verificationCriteria: ["Release tagged"] },
      ],
    },
    {
      pattern: /migrate|upgrade|update dep/i,
      keywords: ["migrate", "upgrade", "update", "bump", "dependency"],
      template: (goal: string) => [
        { id: "migrate-check", description: "Check breaking changes and compatibility", dependsOn: [], verificationCriteria: ["Breaking changes documented"] },
        { id: "migrate-impl", description: `Apply migration: ${goal}`, dependsOn: ["migrate-check"], verificationCriteria: ["Migration applied"] },
        { id: "migrate-verify", description: "Run full test suite and check for regressions", dependsOn: ["migrate-impl"], verificationCriteria: ["All tests pass"] },
      ],
    },
    {
      pattern: /doc|document|readme/i,
      keywords: ["document", "documentation", "readme", "docs", "comment"],
      template: (goal: string) => [
        { id: "doc-audit", description: "Identify undocumented APIs and missing docs", dependsOn: [], verificationCriteria: ["Gaps documented"] },
        { id: "doc-write", description: `Write documentation: ${goal}`, dependsOn: ["doc-audit"], verificationCriteria: ["Docs generated"] },
        { id: "doc-review", description: "Review documentation accuracy and completeness", dependsOn: ["doc-write"], verificationCriteria: ["Docs reviewed"] },
      ],
    },
    {
      pattern: /perf|optimize|speed|slow|fast/i,
      keywords: ["performance", "optimize", "speed", "slow", "bottleneck", "profile"],
      template: (goal: string) => [
        { id: "perf-profile", description: "Profile and identify bottlenecks", dependsOn: [], verificationCriteria: ["Bottleneck identified"] },
        { id: "perf-impl", description: `Apply optimization: ${goal}`, dependsOn: ["perf-profile"], verificationCriteria: ["Performance improved"] },
        { id: "perf-verify", description: "Benchmark and verify no regressions", dependsOn: ["perf-impl"], verificationCriteria: ["Benchmarks stable"] },
      ],
    },
    {
      pattern: /security|auth|vuln|injection|xss|csrf/i,
      keywords: ["security", "vulnerability", "auth", "permission", "encrypt", "harden", "protect"],
      template: (goal: string) => [
        { id: "sec-audit", description: "Audit current security posture and identify vulnerabilities", dependsOn: [], verificationCriteria: ["Vulnerabilities documented"] },
        { id: "sec-fix", description: `Apply security fix: ${goal}`, dependsOn: ["sec-audit"], verificationCriteria: ["Fix verified"] },
        { id: "sec-verify", description: "Run security scan and verify no regressions", dependsOn: ["sec-fix"], verificationCriteria: ["Scan passes"] },
      ],
    },
    {
      pattern: /docker|container|image/i,
      keywords: ["docker", "container", "image", "dockerfile", "compose"],
      template: (goal: string) => [
        { id: "docker-audit", description: "Review current Docker setup and dependencies", dependsOn: [], verificationCriteria: ["Dockerfile reviewed"] },
        { id: "docker-build", description: `Build and optimize Docker image: ${goal}`, dependsOn: ["docker-audit"], verificationCriteria: ["Image builds"] },
        { id: "docker-test", description: "Test container startup and health check", dependsOn: ["docker-build"], verificationCriteria: ["Container healthy"] },
      ],
    },
    {
      pattern: /ci|cd|pipeline|github.action|gitlab/i,
      keywords: ["ci", "cd", "pipeline", "github action", "gitlab", "deploy", "automation"],
      template: (goal: string) => [
        { id: "ci-design", description: "Design CI/CD pipeline stages and triggers", dependsOn: [], verificationCriteria: ["Pipeline stages defined"] },
        { id: "ci-impl", description: `Implement CI/CD pipeline: ${goal}`, dependsOn: ["ci-design"], verificationCriteria: ["Pipeline runs"] },
        { id: "ci-verify", description: "Verify pipeline executes end-to-end", dependsOn: ["ci-impl"], verificationCriteria: ["Pipeline green"] },
      ],
    },
    // ── Generic templates (domain-agnostic, fallback for non-code tasks) ──
    {
      pattern: /research|learn|find|search|explore|investigate|analyze/i,
      keywords: ["research", "learn", "find", "search", "explore", "analyze", "understand", "information"],
      template: (goal: string) => [
        { id: "research-gather", description: `Gather information and context: ${goal}`, dependsOn: [], verificationCriteria: ["Information gathered"] },
        { id: "research-synthesize", description: "Synthesize findings and identify patterns", dependsOn: ["research-gather"], verificationCriteria: ["Findings documented"] },
        { id: "research-conclude", description: "Draw conclusions and make recommendations", dependsOn: ["research-synthesize"], verificationCriteria: ["Conclusions clear"] },
      ],
    },
    {
      pattern: /create|build|make|generate|produce|develop|design|implement/i,
      keywords: ["create", "build", "make", "generate", "write", "develop", "design", "produce"],
      template: (goal: string) => [
        { id: "create-plan", description: `Plan and design: ${goal}`, dependsOn: [], verificationCriteria: ["Design complete"] },
        { id: "create-execute", description: `Create artifacts: ${goal}`, dependsOn: ["create-plan"], verificationCriteria: ["Artifacts created"] },
        { id: "create-review", description: "Review and refine created artifacts", dependsOn: ["create-execute"], verificationCriteria: ["Artifacts reviewed"] },
      ],
    },
    {
      pattern: /review|check|verify|audit|validate|inspect|examine|evaluate/i,
      keywords: ["review", "check", "verify", "audit", "validate", "inspect", "examine", "evaluate", "quality"],
      template: (goal: string) => [
        { id: "review-audit", description: `Audit current state: ${goal}`, dependsOn: [], verificationCriteria: ["Current state documented"] },
        { id: "review-report", description: "Document findings and issues", dependsOn: ["review-audit"], verificationCriteria: ["Issues documented"] },
        { id: "review-fix", description: "Address findings and improvements", dependsOn: ["review-report"], verificationCriteria: ["Findings addressed"] },
      ],
    },
    {
      pattern: /fix|repair|resolve|correct|improve|optimize|enhance|upgrade|refine/i,
      keywords: ["fix", "repair", "resolve", "improve", "optimize", "enhance", "upgrade"],
      template: (goal: string) => [
        { id: "improve-diagnose", description: `Diagnose current state: ${goal}`, dependsOn: [], verificationCriteria: ["Root cause identified"] },
        { id: "improve-apply", description: `Apply improvements: ${goal}`, dependsOn: ["improve-diagnose"], verificationCriteria: ["Improvements applied"] },
        { id: "improve-verify", description: "Verify improvements work correctly", dependsOn: ["improve-apply"], verificationCriteria: ["Improvements verified"] },
      ],
    },
  ]

  decompose(goal: string, relevantFiles: string[], activeDomain?: string): { intent: TaskIntent; autoGenerated: boolean } {
    const intent: TaskIntent = {
      goal,
      constraints: [],
      context: { relevantFiles, dependencies: [] },
      subtasks: [],
    }

    for (const rule of this.rules) {
      const patternMatch = typeof rule.pattern === "string"
        ? goal.toLowerCase().includes(rule.pattern.toLowerCase())
        : rule.pattern.test(goal)

      const keywordMatch = rule.keywords.some(k => goal.toLowerCase().includes(k.toLowerCase()))

      if (patternMatch && keywordMatch) {
        if (rule.domain && rule.domain !== activeDomain) continue
        intent.subtasks = rule.template(goal)

        // G5: Detect circular dependencies in generated subtasks
        const graph = new DependencyGraph()
        for (const step of intent.subtasks) {
          for (const dep of step.dependsOn) {
            graph.addEdge(dep, step.id)
          }
        }
        const vertices = intent.subtasks.map(s => s.id)
        const cycle = graph.detectCycle(vertices)
        if (cycle.hasCycle) {
          // Auto-fix: remove cyclic edges by clearing dependsOn for cycle participants
          const cycleSet = new Set(cycle.cyclePath)
          for (const step of intent.subtasks) {
            if (cycleSet.has(step.id)) {
              step.dependsOn = step.dependsOn.filter(d => !cycleSet.has(d))
            }
          }
          // Re-check
          const fixedGraph = new DependencyGraph()
          for (const step of intent.subtasks) {
            for (const dep of step.dependsOn) {
              fixedGraph.addEdge(dep, step.id)
            }
          }
          const fixedCycle = fixedGraph.detectCycle(vertices)
          if (fixedCycle.hasCycle) {
            // Last resort: flatten all deps
            for (const step of intent.subtasks) {
              step.dependsOn = []
            }
          }
        }

        return { intent, autoGenerated: true }
      }
    }

    // Fallback: create a generic step so the task isn't treated as instantly complete
    intent.subtasks = [{
      id: "generic-execute",
      description: goal,
      dependsOn: [],
      verificationCriteria: [],
    }]
    return { intent, autoGenerated: true }
  }

  registerRule(rule: DecompositionRule): void {
    this.rules.push(rule)
  }

  getRules(): DecompositionRule[] {
    return [...this.rules]
  }

  async decomposeWithLLM(llm: LLMEngine, goal: string, codebaseSummary: string): Promise<TaskIntent> {
    const llmPlan = await llm.generatePlan(goal, [], codebaseSummary)
    const subtasks = Array.isArray(llmPlan.steps)
      ? llmPlan.steps.map((s, i) => ({
          id: s.id || `step-${i + 1}`,
          description: s.description,
          dependsOn: s.dependsOn ?? [],
          verificationCriteria: [],
        }))
      : []
    const intent: TaskIntent = {
      goal,
      constraints: [],
      context: { relevantFiles: [], dependencies: [] },
      subtasks,
    }
    return intent
  }

  suggestSubtask(id: string, description: string, dependsOn: string[] = []): Subtask {
    return { id, description, dependsOn, verificationCriteria: [] }
  }
}
