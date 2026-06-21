import type { TaskIntent, Subtask } from "./intent-parser.js"
import type { LLMEngine } from "./llm.js"
import { DependencyGraph } from "./formal-model.js"
import type { PlannerCritic, CriticResult, CriticScore } from "./planner-critic.js"

export interface MacroPhase {
  id: string
  name: string
  description: string
  goal: string
  dependsOn: string[]
  /** Expected outcome of this phase */
  outcome: string
  /** Schema of expected outputs (for context passing to dependent phases) */
  outputSchema?: Record<string, string>
  /** Schema of expected inputs (from parent phases) */
  inputSchema?: Record<string, string>
}

/**
 * Context mapping between two phases.
 * Describes how output fields from one phase map to input fields of another.
 */
export interface PhaseContextMapping {
  /** Source phase ID */
  fromPhaseId: string
  /** Target phase ID */
  toPhaseId: string
  /** Field mappings: outputField → inputField */
  mappings: Record<string, string>
}

/** Error context for phase retry */
export interface PhaseErrorContext {
  phaseId: string
  error: string
  failedStepIds: string[]
}

export interface MicroStep {
  id: string
  phaseId: string
  description: string
  dependsOn: string[]
  verificationCriteria: string[]
}

export interface HierarchicalPlan {
  goal: string
  phases: MacroPhase[]
  /** Detailed steps per phase */
  micro: Map<string, MicroStep[]>
  /** Topological order of all phases */
  phaseOrder: string[]
}

export interface MacroTemplate {
  pattern: RegExp | string
  keywords: string[]
  /** Generate phases for a goal */
  phases: (goal: string) => MacroPhase[]
  /** Expand a phase into micro-steps */
  expand: (phase: MacroPhase, goal: string) => MicroStep[]
  domain?: string
}

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

    let bestScore = 0
    let bestRule: DecompositionRule | null = null
    for (const rule of this.rules) {
      const patternMatch = typeof rule.pattern === "string"
        ? goal.toLowerCase().includes(rule.pattern.toLowerCase())
        : rule.pattern.test(goal)

      const keywordMatch = rule.keywords.some(k => goal.toLowerCase().includes(k.toLowerCase()))
      if (!patternMatch && !keywordMatch) continue
      if (rule.domain && rule.domain !== activeDomain) continue

      // Score: specific patterns + domain match + keyword density
      let score = patternMatch ? 2 : 0
      score += keywordMatch ? 1 : 0
      const kwCount = rule.keywords.filter(k => goal.toLowerCase().includes(k.toLowerCase())).length
      score += kwCount * 0.5
      if (rule.domain) score += 1

      if (score > bestScore) {
        bestScore = score
        bestRule = rule
      }
    }

    if (bestRule) {
      intent.subtasks = bestRule.template(goal)

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
        const cycleSet = new Set(cycle.cyclePath ?? [])
        for (const step of intent.subtasks) {
          if (!cycleSet.has(step.id)) continue
          step.dependsOn = step.dependsOn.filter(d => !cycleSet.has(d))
        }
        const fixedGraph = new DependencyGraph()
        for (const step of intent.subtasks) {
          for (const dep of step.dependsOn) {
            fixedGraph.addEdge(dep, step.id)
          }
        }
        const fixedCycle = fixedGraph.detectCycle(vertices)
        if (fixedCycle.hasCycle) {
          for (const step of intent.subtasks) {
            step.dependsOn = []
          }
        }
      }

      return { intent, autoGenerated: true }
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

  private critic: PlannerCritic | null = null

  /** Set PlannerCritic instance for self-reflection planning */
  setCritic(critic: PlannerCritic): void {
    this.critic = critic
  }

  /** Check if critic is available */
  hasCritic(): boolean {
    return this.critic !== null
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

  /**
   * Decompose using PlannerCritic self-reflection loop.
   * Generates multiple candidates, evaluates, refines.
   */
  async decomposeWithCritic(goal: string, codebaseSummary: string): Promise<CriticResult> {
    if (!this.critic) {
      // Fallback: return empty CriticResult
      return {
        plan: { goal, constraints: [], context: { relevantFiles: [], dependencies: [] }, subtasks: [] },
        candidates: [],
        scores: [],
        bestScore: 0,
        iterations: 0,
        accepted: false,
      }
    }
    return this.critic.refinePlan(goal, codebaseSummary)
  }

  suggestSubtask(id: string, description: string, dependsOn: string[] = []): Subtask {
    return { id, description, dependsOn, verificationCriteria: [] }
  }

  private macroTemplates: MacroTemplate[] = [
    {
      pattern: /create|build|implement|develop|add/i,
      keywords: ["feature", "component", "module", "api", "endpoint", "service"],
      phases: (goal: string) => [
        { id: "phase-design", name: "Design", description: "Design architecture and interfaces", goal, dependsOn: [], outcome: "Design document ready" },
        { id: "phase-impl", name: "Implementation", description: "Implement core logic", goal, dependsOn: ["phase-design"], outcome: "Code written" },
        { id: "phase-test", name: "Testing", description: "Write and run tests", goal, dependsOn: ["phase-impl"], outcome: "All tests pass" },
        { id: "phase-review", name: "Review", description: "Review and polish", goal, dependsOn: ["phase-test"], outcome: "Code reviewed and merged" },
      ],
      expand: (phase: MacroPhase, goal: string) => {
        if (phase.id === "phase-design") return [
          { id: `${phase.id}-1`, phaseId: phase.id, description: `Define interfaces and types for: ${goal}`, dependsOn: [], verificationCriteria: ["Types defined"] },
          { id: `${phase.id}-2`, phaseId: phase.id, description: `Design data flow and component structure`, dependsOn: [`${phase.id}-1`], verificationCriteria: ["Design documented"] },
        ]
        if (phase.id === "phase-impl") return [
          { id: `${phase.id}-1`, phaseId: phase.id, description: `Implement core logic: ${goal}`, dependsOn: [], verificationCriteria: ["Core logic works"] },
          { id: `${phase.id}-2`, phaseId: phase.id, description: "Add error handling and edge cases", dependsOn: [`${phase.id}-1`], verificationCriteria: ["Edge cases handled"] },
        ]
        if (phase.id === "phase-test") return [
          { id: `${phase.id}-1`, phaseId: phase.id, description: `Write unit tests for: ${goal}`, dependsOn: [], verificationCriteria: ["Unit tests pass"] },
          { id: `${phase.id}-2`, phaseId: phase.id, description: "Run integration tests and verify coverage", dependsOn: [`${phase.id}-1`], verificationCriteria: ["Coverage >= 80%"] },
        ]
        return [
          { id: `${phase.id}-1`, phaseId: phase.id, description: `Review and refactor: ${phase.name}`, dependsOn: [], verificationCriteria: ["Review complete"] },
        ]
      },
    },
    {
      pattern: /fix|bug|repair|resolve|patch/i,
      keywords: ["bug", "issue", "error", "crash"],
      phases: (goal: string) => [
        { id: "phase-diagnose", name: "Diagnosis", description: "Reproduce and diagnose the bug", goal, dependsOn: [], outcome: "Root cause identified" },
        { id: "phase-fix", name: "Fix", description: "Apply the fix", goal, dependsOn: ["phase-diagnose"], outcome: "Bug fixed" },
        { id: "phase-verify", name: "Verification", description: "Verify fix and check regressions", goal, dependsOn: ["phase-fix"], outcome: "Tests pass" },
      ],
      expand: (phase: MacroPhase, goal: string) => {
        if (phase.id === "phase-diagnose") return [
          { id: `${phase.id}-1`, phaseId: phase.id, description: `Reproduce the bug: ${goal}`, dependsOn: [], verificationCriteria: ["Bug reproducible"] },
          { id: `${phase.id}-2`, phaseId: phase.id, description: "Add a failing test that captures the bug", dependsOn: [`${phase.id}-1`], verificationCriteria: ["Test fails as expected"] },
        ]
        if (phase.id === "phase-fix") return [
          { id: `${phase.id}-1`, phaseId: phase.id, description: `Identify root cause and fix: ${goal}`, dependsOn: [], verificationCriteria: ["Fix applied"] },
          { id: `${phase.id}-2`, phaseId: phase.id, description: "Verify the failing test now passes", dependsOn: [`${phase.id}-1`], verificationCriteria: ["Test passes"] },
        ]
        return [
          { id: `${phase.id}-1`, phaseId: phase.id, description: "Run full test suite for regressions", dependsOn: [], verificationCriteria: ["All tests pass"] },
        ]
      },
    },
    {
      pattern: /refactor|clean|restructure|extract/i,
      keywords: ["refactor", "cleanup", "extract", "move"],
      phases: (goal: string) => [
        { id: "phase-audit", name: "Audit", description: "Audit current code and map dependencies", goal, dependsOn: [], outcome: "Dependencies mapped" },
        { id: "phase-refactor", name: "Refactoring", description: "Apply refactoring changes", goal, dependsOn: ["phase-audit"], outcome: "Code restructured" },
        { id: "phase-verify", name: "Verification", description: "Verify no regressions", goal, dependsOn: ["phase-refactor"], outcome: "Tests pass" },
      ],
      expand: (phase: MacroPhase, goal: string) => {
        if (phase.id === "phase-audit") return [
          { id: `${phase.id}-1`, phaseId: phase.id, description: `Audit current implementation: ${goal}`, dependsOn: [], verificationCriteria: ["Audit complete"] },
          { id: `${phase.id}-2`, phaseId: phase.id, description: "Document dependencies and risks", dependsOn: [`${phase.id}-1`], verificationCriteria: ["Dependencies documented"] },
        ]
        if (phase.id === "phase-refactor") return [
          { id: `${phase.id}-1`, phaseId: phase.id, description: `Extract and restructure: ${goal}`, dependsOn: [], verificationCriteria: ["Code restructured"] },
          { id: `${phase.id}-2`, phaseId: phase.id, description: "Update all references and imports", dependsOn: [`${phase.id}-1`], verificationCriteria: ["No broken imports"] },
        ]
        return [
          { id: `${phase.id}-1`, phaseId: phase.id, description: `Verify no regressions after: ${goal}`, dependsOn: [], verificationCriteria: ["All tests pass"] },
        ]
      },
    },
    {
      pattern: /research|learn|analyze|investigate/i,
      keywords: ["research", "learn", "explore", "analyze", "understand"],
      phases: (goal: string) => [
        { id: "phase-gather", name: "Gathering", description: "Gather information and context", goal, dependsOn: [], outcome: "Information collected" },
        { id: "phase-synthesize", name: "Synthesis", description: "Synthesize findings", goal, dependsOn: ["phase-gather"], outcome: "Findings documented" },
        { id: "phase-recommend", name: "Recommendation", description: "Formulate recommendations", goal, dependsOn: ["phase-synthesize"], outcome: "Recommendations ready" },
      ],
      expand: (phase: MacroPhase, goal: string) => {
        if (phase.id === "phase-gather") return [
          { id: `${phase.id}-1`, phaseId: phase.id, description: `Search and gather information: ${goal}`, dependsOn: [], verificationCriteria: ["Information gathered"] },
          { id: `${phase.id}-2`, phaseId: phase.id, description: "Review and organize collected data", dependsOn: [`${phase.id}-1`], verificationCriteria: ["Data organized"] },
        ]
        if (phase.id === "phase-synthesize") return [
          { id: `${phase.id}-1`, phaseId: phase.id, description: `Synthesize findings from research`, dependsOn: [], verificationCriteria: ["Findings summarized"] },
        ]
        return [
          { id: `${phase.id}-1`, phaseId: phase.id, description: `Formulate actionable recommendations`, dependsOn: [], verificationCriteria: ["Recommendations clear"] },
        ]
      },
    },
  ]

  /**
   * Select the best matching macro template for a goal.
   * Returns null if no template matches with sufficient score.
   */
  private selectMacroTemplate(goal: string, activeDomain?: string): MacroTemplate | null {
    let bestScore = 0
    let bestTemplate: MacroTemplate | null = null
    for (const tmpl of this.macroTemplates) {
      const patternMatch = typeof tmpl.pattern === "string"
        ? goal.toLowerCase().includes(tmpl.pattern.toLowerCase())
        : tmpl.pattern.test(goal)
      const keywordMatch = tmpl.keywords.some(k => goal.toLowerCase().includes(k.toLowerCase()))
      if (!patternMatch && !keywordMatch) continue
      if (tmpl.domain && tmpl.domain !== activeDomain) continue
      const score = (patternMatch ? 2 : 0) + (keywordMatch ? 1 : 0)
      if (score > bestScore) {
        bestScore = score
        bestTemplate = tmpl
      }
    }
    return bestTemplate
  }

  /**
   * Decompose a goal into macro-level phases.
   * Returns a list of ordered phases with dependencies.
   * Falls back to a default 3-phase plan if no template matches.
   */
  decomposeMacro(goal: string, activeDomain?: string): HierarchicalPlan {
    const template = this.selectMacroTemplate(goal, activeDomain)
    let phases: MacroPhase[]
    if (template) {
      phases = template.phases(goal)
    } else {
      phases = [
        { id: "phase-plan", name: "Plan", description: `Plan: ${goal}`, goal, dependsOn: [], outcome: "Plan ready" },
        { id: "phase-execute", name: "Execute", description: `Execute: ${goal}`, goal, dependsOn: ["phase-plan"], outcome: "Execution complete" },
        { id: "phase-verify", name: "Verify", description: `Verify: ${goal}`, goal, dependsOn: ["phase-execute"], outcome: "Verified" },
      ]
    }

    const phaseOrder = this.computePhaseOrder(phases)

    const plan: HierarchicalPlan = {
      goal,
      phases,
      micro: new Map(),
      phaseOrder,
    }

    this.expandAll(plan, template)
    return plan
  }

  /**
   * Compute a valid topological order for phases using Kahn's algorithm.
   */
  private computePhaseOrder(phases: MacroPhase[]): string[] {
    const inDegree = new Map<string, number>()
    const adj = new Map<string, string[]>()
    for (const p of phases) {
      inDegree.set(p.id, 0)
      adj.set(p.id, [])
    }
    for (const p of phases) {
      for (const dep of p.dependsOn) {
        if (adj.has(dep)) {
          adj.get(dep)!.push(p.id)
          inDegree.set(p.id, (inDegree.get(p.id) ?? 0) + 1)
        }
      }
    }
    const queue: string[] = []
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id)
    }
    const order: string[] = []
    while (queue.length > 0) {
      const id = queue.shift()!
      order.push(id)
      for (const next of adj.get(id) ?? []) {
        const newDeg = (inDegree.get(next) ?? 1) - 1
        inDegree.set(next, newDeg)
        if (newDeg === 0) queue.push(next)
      }
    }
    return order
  }

  /**
   * Expand a specific phase into detailed micro-steps.
   * Uses the template's expand function if available, otherwise generic.
   */
  expandPhase(phase: MacroPhase, goal: string, template?: MacroTemplate | null): MicroStep[] {
    if (template) {
      return template.expand(phase, goal)
    }
    return [
      { id: `${phase.id}-1`, phaseId: phase.id, description: `Prepare for phase: ${phase.name}`, dependsOn: [], verificationCriteria: ["Ready"] },
      { id: `${phase.id}-2`, phaseId: phase.id, description: `Complete phase: ${phase.name}`, dependsOn: [`${phase.id}-1`], verificationCriteria: ["Complete"] },
    ]
  }

  /**
   * Expand all phases in a hierarchical plan into micro-steps,
   * producing the flat step list for execution.
   */
  expandAll(plan: HierarchicalPlan, template?: MacroTemplate | null): void {
    for (const phase of plan.phases) {
      const steps = this.expandPhase(phase, plan.goal, template)
      plan.micro.set(phase.id, steps)
    }
  }

  /**
   * Convert a hierarchical plan into a flat list of Subtasks for execution.
   * Each micro-step becomes a Subtask with dependencies linked intra- and inter-phase.
   */
  flattenHierarchical(plan: HierarchicalPlan): Subtask[] {
    const subtasks: Subtask[] = []
    const processed = new Set<string>()

    for (const phaseId of plan.phaseOrder) {
      const steps = plan.micro.get(phaseId) ?? []
      const phase = plan.phases.find(p => p.id === phaseId)
      const depPhaseId = phase?.dependsOn?.[0]
      const depSteps = depPhaseId ? plan.micro.get(depPhaseId) ?? [] : []
      const lastPrevStep = depSteps.length > 0
        ? depSteps[depSteps.length - 1].id
        : null

      for (const step of steps) {
        if (processed.has(step.id)) continue
        processed.add(step.id)

        const deps = step.dependsOn.filter(d => processed.has(d))
        if (deps.length === 0 && lastPrevStep && subtasks.length > 0) {
          deps.push(lastPrevStep)
        }

        subtasks.push({
          id: step.id,
          description: step.description,
          dependsOn: deps,
          verificationCriteria: step.verificationCriteria,
        })
      }
    }

    return subtasks
  }

  // ── Context Passing (Gap #1: output → input antar phase) ──────

  /**
   * Compute context mappings between sequential phases.
   * For each dependency relationship (phase A depends on phase B),
   * maps declared outputSchema fields of B to inputSchema fields of A.
   */
  applyContextPassing(plan: HierarchicalPlan): PhaseContextMapping[] {
    const mappings: PhaseContextMapping[] = []
    const phaseMap = new Map(plan.phases.map(p => [p.id, p]))

    for (const phase of plan.phases) {
      if (!phase.inputSchema || Object.keys(phase.inputSchema).length === 0) continue

      for (const depId of phase.dependsOn) {
        const depPhase = phaseMap.get(depId)
        if (!depPhase || !depPhase.outputSchema) continue

        const fieldMappings: Record<string, string> = {}
        const usedOutputs = new Set<string>()

        // First pass: match by exact name
        for (const [inField] of Object.entries(phase.inputSchema)) {
          if (depPhase.outputSchema[inField]) {
            fieldMappings[inField] = inField
            usedOutputs.add(inField)
          }
        }

        // Second pass: match remaining by type
        const remainingInput = Object.entries(phase.inputSchema).filter(([k]) => !fieldMappings[k])
        const remainingOutput = Object.entries(depPhase.outputSchema).filter(([k]) => !usedOutputs.has(k))
        for (const [inField, inType] of remainingInput) {
          for (const [outField, outType] of remainingOutput) {
            if (inType === outType && !usedOutputs.has(outField)) {
              fieldMappings[outField] = inField
              usedOutputs.add(outField)
              break
            }
          }
        }

        if (Object.keys(fieldMappings).length > 0) {
          mappings.push({
            fromPhaseId: depId,
            toPhaseId: phase.id,
            mappings: fieldMappings,
          })
        }
      }
    }

    return mappings
  }

  // ── Per-subgoal Error Recovery (Gap #2: retryPhase) ──────────

  /**
   * Retry a failed phase by re-expanding it with error context.
   * Returns a new set of micro-steps with adjusted descriptions
   * that incorporate the failure information.
   *
   * @param plan — the hierarchical plan
   * @param failedPhaseId — ID of the phase that failed
   * @param errorContext — what went wrong (error message + failed step IDs)
   * @param template — optional macro template for re-expansion
   */
  retryPhase(
    plan: HierarchicalPlan,
    failedPhaseId: string,
    errorContext: PhaseErrorContext,
    template?: MacroTemplate | null,
  ): MicroStep[] {
    const phase = plan.phases.find(p => p.id === failedPhaseId)
    if (!phase) return []

    // Include error context in the goal for re-expansion
    const adjustedGoal = `${plan.goal} (retry after: ${errorContext.error})`
    const newSteps = this.expandPhase(phase, adjustedGoal, template)

    // Mark the new steps as retry steps
    const retrySteps: MicroStep[] = newSteps.map((step, i) => ({
      ...step,
      id: `${step.id}-retry-${i}`,
      description: `${step.description} [retry #${i + 1}: avoid "${errorContext.error}"]`,
      verificationCriteria: [
        ...step.verificationCriteria,
        `Fixed error: ${errorContext.error}`,
      ],
    }))

    // Replace phase micro-steps in plan
    plan.micro.set(failedPhaseId, retrySteps)

    return retrySteps
  }

  // ── Per-subgoal Critic Integration (Gap #3) ──────────────────

  /**
   * Critically evaluate a single phase's micro-steps.
   * Returns issues and suggestions for this specific sub-goal.
   *
   * @param phase — the macro phase to evaluate
   * @param microSteps — the micro-steps generated for this phase
   * @param critic — optional PlannerCritic instance for LLM-based evaluation
   */
  criticizeSubgoal(
    phase: MacroPhase,
    microSteps: MicroStep[],
    _critic?: PlannerCritic,
  ): CriticScore {
    const issues: string[] = []
    const suggestions: string[] = []

    // Structural validation (always available)
    if (microSteps.length === 0) {
      issues.push(`Phase "${phase.name}" has no micro-steps`)
      suggestions.push("Expand the phase with at least one actionable step")
    }
    if (microSteps.length > 5) {
      issues.push(`Phase "${phase.name}" has ${microSteps.length} steps (max 5 recommended)`)
      suggestions.push("Consider splitting this phase into smaller sub-phases")
    }

    // Check step descriptions are concrete
    const vagueWords = ["stuff", "things", "etc", "misc", "whatever", "todo"]
    for (const step of microSteps) {
      for (const word of vagueWords) {
        if (step.description.toLowerCase().includes(word)) {
          issues.push(`Step "${step.id}" contains vague word "${word}": "${step.description}"`)
          suggestions.push(`Replace vague descriptions with concrete actions`)
          break
        }
      }
    }

    // Check dependency completeness
    const stepIds = new Set(microSteps.map(s => s.id))
    for (const step of microSteps) {
      for (const dep of step.dependsOn) {
        if (!stepIds.has(dep)) {
          issues.push(`Step "${step.id}" depends on unknown step "${dep}"`)
          suggestions.push("Fix dependency references to valid step IDs")
        }
      }
    }

    // Check verification criteria
    const stepsWithoutCriteria = microSteps.filter(s => !s.verificationCriteria || s.verificationCriteria.length === 0)
    if (stepsWithoutCriteria.length > 0) {
      issues.push(`${stepsWithoutCriteria.length} step(s) without verification criteria`)
      suggestions.push("Add at least one verification criterion per step")
    }

    const score = this.computeSubgoalScore(issues, microSteps.length)

    return { overall: score, issues, suggestions }
  }

  /**
   * Compute a numeric score (0-1) for a subgoal based on issues found.
   */
  private computeSubgoalScore(issues: string[], stepCount: number): number {
    let score = 1.0

    // Deduct for issues
    score -= issues.length * 0.15

    // Penalty for too few or too many steps
    if (stepCount === 0) score -= 0.5
    if (stepCount > 5) score -= 0.2

    return Math.max(0, Math.min(1, score))
  }
}
