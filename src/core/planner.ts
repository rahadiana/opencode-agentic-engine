import type { TaskIntent, Subtask } from "./intent-parser.js"
import type { LLMEngine } from "./llm.js"

export interface DecompositionRule {
  pattern: RegExp | string
  keywords: string[]
  template: (context: string) => Subtask[]
}

export class Planner {
  private rules: DecompositionRule[] = [
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
  ]

  decompose(goal: string, relevantFiles: string[]): { intent: TaskIntent; autoGenerated: boolean } {
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
        intent.subtasks = rule.template(goal)
        return { intent, autoGenerated: true }
      }
    }

    return { intent, autoGenerated: false }
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
      ? llmPlan.steps.map(s => ({
          id: s.id,
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
