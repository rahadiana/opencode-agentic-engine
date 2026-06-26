import type { DecompositionRule, MacroTemplate, MacroPhase } from "./planner.js"

export function createDefaultRules(): DecompositionRule[] {
  return [
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
}

export function createMacroTemplates(): MacroTemplate[] {
  return [
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
}
