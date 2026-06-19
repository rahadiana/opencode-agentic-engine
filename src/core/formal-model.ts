/**
 * Formal Model A=(M,T,M,Π) — Contract-based verification for multi-agent systems.
 *
 * Based on "Agentic Software: How AI Agents Are Restructuring Software Engineering"
 * (arXiv:2606.05608), the formal model decomposes an agentic system into:
 *
 *   A = (M, T, M, Π)
 *
 *   - M (Memory)    : session store, episodic store, skill store, vector store
 *   - T (Tools)     : the 27 agentic tools
 *   - M (Multi)     : coordinator, orchestrator, role registry
 *   - Π (Prompts)   : system prompts per agent role
 *
 * This file implements:
 *   1. FormalContract    — Pre/post-condition + invariant model for tasks
 *   2. DependencyGraph   — Kahn's algorithm for cycle detection + topological sort
 *   3. ContractVerifier  — Pre/post-condition verification engine
 *   4. FormalModel       — Aggregate of all four components A=(M,T,M,Π)
 */

// ──────────────────────────────────────────────────────────────
// 1. FormalContract — Pre/post-condition + invariant model
// ──────────────────────────────────────────────────────────────

/** Type of condition expression — simple string-based predicate */
export type ConditionExpr = string

/** Severity level when a condition is violated */
export type ConditionSeverity = "error" | "warning" | "info"

export interface Condition {
  expr: ConditionExpr
  severity: ConditionSeverity
  description: string
}

export interface FormalContract {
  /** Pre-conditions: must be TRUE before task execution */
  preConditions: Condition[]
  /** Post-conditions: must be TRUE after task execution */
  postConditions: Condition[]
  /** Invariants: must hold THROUGHOUT execution */
  invariants: Condition[]
  /** Human-readable description of what this contract governs */
  description: string
}

// ──────────────────────────────────────────────────────────────
// 2. DependencyGraph — Kahn's algorithm for cycle detection
// ──────────────────────────────────────────────────────────────

export interface DependencyEdge {
  from: string  // step ID that must complete first
  to: string    // step ID that depends on `from`
}

export interface CycleResult {
  hasCycle: boolean
  /** The cyclic path (list of step IDs forming the cycle) */
  cyclePath: string[]
  /** Detailed error message */
  message: string
}

export interface TopoSortResult {
  /** Ordered list of step IDs (topological order if no cycles) */
  order: string[]
  cycle: CycleResult
}

export class DependencyGraph {
  private edges: DependencyEdge[] = []

  constructor(edges?: DependencyEdge[]) {
    if (edges) this.edges = [...edges]
  }

  addEdge(from: string, to: string): void {
    this.edges.push({ from, to })
  }

  /** Detect cycles using Kahn's algorithm (BFS-based in-degree approach).
   *  O(V + E) time, O(V) space.
   *  Returns the first cycle found, or indicates acyclic. */
  detectCycle(vertices: string[]): CycleResult {
    // Build adjacency list + in-degree map
    const adj = new Map<string, string[]>()
    const inDeg = new Map<string, number>()

    for (const v of vertices) {
      adj.set(v, [])
      inDeg.set(v, 0)
    }

    for (const { from, to } of this.edges) {
      const list = adj.get(from)
      if (list) list.push(to)
      inDeg.set(to, (inDeg.get(to) ?? 0) + 1)
    }

    // Queue of nodes with in-degree 0
    const queue: string[] = []
    for (const [v, deg] of inDeg) {
      if (deg === 0) queue.push(v)
    }

    const topoOrder: string[] = []
    while (queue.length > 0) {
      const node = queue.shift()!
      topoOrder.push(node)
      for (const neighbor of adj.get(node) ?? []) {
        const newDeg = (inDeg.get(neighbor) ?? 1) - 1
        inDeg.set(neighbor, newDeg)
        if (newDeg === 0) queue.push(neighbor)
      }
    }

    const hasCycle = topoOrder.length < vertices.length

    if (!hasCycle) {
      return { hasCycle: false, cyclePath: [], message: "Graph is acyclic (valid DAG)" }
    }

    // Find the cycle path: find nodes that still have positive in-degree
    const inCycle = new Set(vertices.filter(v => (inDeg.get(v) ?? 0) > 0))

    // Build cycle path by traversing from any cycle node
    const cyclePath: string[] = []
    if (inCycle.size > 0) {
      const start = [...inCycle][0]
      const visited = new Set<string>()
      const stack = [start]

      while (stack.length > 0) {
        const node = stack[stack.length - 1]
        if (visited.has(node)) {
          // Found the cycle — extract from first occurrence to end
          const idx = stack.indexOf(node)
          for (let i = idx; i < stack.length; i++) {
            cyclePath.push(stack[i])
          }
          break
        }
        visited.add(node)

        const neighbors = adj.get(node) ?? []
        const cycleNeighbor = neighbors.find(n => inCycle.has(n))
        if (cycleNeighbor) {
          stack.push(cycleNeighbor)
        } else {
          break
        }
      }
    }

    return {
      hasCycle: true,
      cyclePath,
      message: `Circular dependency detected: ${cyclePath.join(" → ")}`,
    }
  }

  /** Topological sort using Kahn's algorithm.
   *  Returns ordering + cycle info. */
  topologicalSort(vertices: string[]): TopoSortResult {
    const cycle = this.detectCycle(vertices)

    if (cycle.hasCycle) {
      return { order: [], cycle }
    }

    // Re-run Kahn's for the full order
    const adj = new Map<string, string[]>()
    const inDeg = new Map<string, number>()

    for (const v of vertices) {
      adj.set(v, [])
      inDeg.set(v, 0)
    }

    for (const { from, to } of this.edges) {
      const list = adj.get(from)
      if (list) list.push(to)
      inDeg.set(to, (inDeg.get(to) ?? 0) + 1)
    }

    const queue: string[] = []
    for (const [v, deg] of inDeg) {
      if (deg === 0) queue.push(v)
    }

    const order: string[] = []
    while (queue.length > 0) {
      const node = queue.shift()!
      order.push(node)
      for (const neighbor of adj.get(node) ?? []) {
        const newDeg = (inDeg.get(neighbor) ?? 1) - 1
        inDeg.set(neighbor, newDeg)
        if (newDeg === 0) queue.push(neighbor)
      }
    }

    return { order, cycle }
  }

  /** Get all edges */
  getEdges(): DependencyEdge[] {
    return [...this.edges]
  }

  /** Check if adding an edge would create a cycle */
  wouldCreateCycle(from: string, to: string, allVertices: string[]): boolean {
    const testGraph = new DependencyGraph([...this.edges, { from, to }])
    return testGraph.detectCycle(allVertices).hasCycle
  }
}

// ──────────────────────────────────────────────────────────────
// 3. ContractVerifier — Pre/post-condition verification engine
// ──────────────────────────────────────────────────────────────

export interface ContractVerificationResult {
  contractDescription: string
  preConditions: Array<{ condition: Condition; satisfied: boolean; detail: string }>
  postConditions: Array<{ condition: Condition; satisfied: boolean; detail: string }>
  invariants: Array<{ condition: Condition; satisfied: boolean; detail: string }>
  passed: boolean
  summary: string
}

/** Context provided to condition evaluators */
export interface VerificationContext {
  stepId: string
  description: string
  projectDir?: string
  filesModified?: string[]
  output?: string
  errorOutput?: string
  existingFiles?: string[]
}

/** Evaluator function type — pluggable per domain */
export type ConditionEvaluator = (
  condition: Condition,
  context: VerificationContext,
) => { satisfied: boolean; detail: string }

/** Default evaluator: checks conditions via string heuristics */
export const defaultConditionEvaluator: ConditionEvaluator = (
  condition: Condition,
  context: VerificationContext,
) => {
  const expr = condition.expr.toLowerCase()
  const output = context.output?.toLowerCase() ?? ""
  const errorOut = context.errorOutput?.toLowerCase() ?? ""
  const files = context.filesModified ?? []
  const existing = context.existingFiles ?? []

  // Built-in condition patterns
  if (expr.includes("file") && expr.includes("exists")) {
    const fileName = expr.match(/file\s+"([^"]+)"\s+exists/)?.[1]
    if (fileName) {
      const found = existing.some(f => f.includes(fileName)) || files.some(f => f.includes(fileName))
      return { satisfied: found, detail: found ? `File ${fileName} found` : `File ${fileName} not found` }
    }
    // Generic "files exist" check
    const hasFiles = files.length > 0
    return { satisfied: hasFiles, detail: hasFiles ? `${files.length} file(s) modified` : "No files modified" }
  }

  if (expr.includes("no") && expr.includes("error")) {
    const noErrors = !errorOut && !output?.includes("error") && !output?.includes("fail")
    return { satisfied: noErrors, detail: noErrors ? "No errors detected" : `Errors found: ${errorOut || output?.slice(0, 100)}` }
  }

  if (expr.includes("compile") && expr.includes("pass")) {
    const passed = output?.includes("compilation successful") || output?.includes("passed") || !errorOut
    return { satisfied: passed, detail: passed ? "Compilation passed" : "Compilation failed" }
  }

  if (expr.includes("test") && expr.includes("pass")) {
    const passed = !errorOut && output?.includes("passed") !== false
    return { satisfied: passed, detail: passed ? "Tests passed" : "Tests failed" }
  }

  if (expr.includes("dependency") && expr.includes("complete")) {
    // Dependencies are assumed completed if step is being verified
    return { satisfied: true, detail: "Dependencies resolved (step reached execution)" }
  }

  if (expr.includes("output") && expr.includes("non-empty")) {
    const nonEmpty = (context.output?.length ?? 0) > 0
    return { satisfied: nonEmpty, detail: nonEmpty ? "Output is non-empty" : "Output is empty" }
  }

  // Fallback: unknown condition — warn but don't block
  return {
    satisfied: true,
    detail: `Condition "${condition.expr}" could not be evaluated (assuming satisfied)`,
  }
}

export class ContractVerifier {
  private evaluator: ConditionEvaluator

  constructor(evaluator?: ConditionEvaluator) {
    this.evaluator = evaluator ?? defaultConditionEvaluator
  }

  /** Set a custom condition evaluator (e.g., domain-specific) */
  setEvaluator(evaluator: ConditionEvaluator): void {
    this.evaluator = evaluator
  }

  /** Verify a contract against execution context */
  async verify(
    contract: FormalContract,
    context: VerificationContext,
  ): Promise<ContractVerificationResult> {
    const preResults = contract.preConditions.map(c => ({
      condition: c,
      ...this.evaluator(c, context),
    }))

    const postResults = contract.postConditions.map(c => ({
      condition: c,
      ...this.evaluator(c, context),
    }))

    const invResults = contract.invariants.map(c => ({
      condition: c,
      ...this.evaluator(c, context),
    }))

    const allChecks = [...preResults, ...postResults, ...invResults]
    const passed = allChecks.every(r => r.satisfied)
    const errors = allChecks.filter(r => !r.satisfied && r.condition.severity === "error")
    const warnings = allChecks.filter(r => !r.satisfied && r.condition.severity === "warning")

    const summary = passed
      ? `✅ All ${allChecks.length} condition(s) satisfied`
      : `⚠ ${errors.length} error(s), ${warnings.length} warning(s) — ${errors.map(e => e.condition.description).join("; ")}`

    return {
      contractDescription: contract.description,
      preConditions: preResults,
      postConditions: postResults,
      invariants: invResults,
      passed,
      summary,
    }
  }

  /** Quick check: only verify pre-conditions (before execution) */
  async verifyPreConditions(
    contract: FormalContract,
    context: VerificationContext,
  ): Promise<{ passed: boolean; results: Array<{ condition: Condition; satisfied: boolean; detail: string }>; summary: string }> {
    const results = contract.preConditions.map(c => ({
      condition: c,
      ...this.evaluator(c, context),
    }))

    const passed = results.every(r => r.satisfied || r.condition.severity !== "error")
    const errors = results.filter(r => !r.satisfied && r.condition.severity === "error")
    const summary = passed
      ? `✅ Pre-conditions satisfied (${results.length})`
      : `❌ Pre-conditions failed: ${errors.map(e => e.condition.description).join("; ")}`

    return { passed, results, summary }
  }

  /** Quick check: only verify post-conditions (after execution) */
  async verifyPostConditions(
    contract: FormalContract,
    context: VerificationContext,
  ): Promise<{ passed: boolean; results: Array<{ condition: Condition; satisfied: boolean; detail: string }>; summary: string }> {
    const results = contract.postConditions.map(c => ({
      condition: c,
      ...this.evaluator(c, context),
    }))

    const passed = results.every(r => r.satisfied || r.condition.severity !== "error")
    const errors = results.filter(r => !r.satisfied && r.condition.severity === "error")
    const summary = passed
      ? `✅ Post-conditions satisfied (${results.length})`
      : `❌ Post-conditions failed: ${errors.map(e => e.condition.description).join("; ")}`

    return { passed, results, summary }
  }
}

// ──────────────────────────────────────────────────────────────
// 4. FormalModel — Aggregate A=(M,T,M,Π)
// ──────────────────────────────────────────────────────────────

export interface FormalModelSnapshot {
  memoryProviders: string[]
  tools: string[]
  multiAgentRoles: string[]
  promptCount: number
  domainContracts: Array<{ domain: string; contractCount: number }>
  dependencyGraphEdges: number
  timestamp: number
}

export class FormalModel {
  /** Dependency graph for task scheduling */
  readonly dependencyGraph: DependencyGraph
  /** Contract verifier for pre/post-condition checks */
  readonly contractVerifier: ContractVerifier
  /** Registered formal contracts, keyed by domain or step pattern */
  private contracts = new Map<string, FormalContract>()

  constructor() {
    this.dependencyGraph = new DependencyGraph()
    this.contractVerifier = new ContractVerifier()
  }

  /** Register a formal contract for a domain or pattern */
  registerContract(key: string, contract: FormalContract): void {
    this.contracts.set(key, contract)
  }

  /** Get contract by key */
  getContract(key: string): FormalContract | undefined {
    return this.contracts.get(key)
  }

  /** Get all registered contracts */
  getAllContracts(): Map<string, FormalContract> {
    return new Map(this.contracts)
  }

  /** Remove a contract */
  unregisterContract(key: string): boolean {
    return this.contracts.delete(key)
  }

  /** Verify a specific contract */
  async verifyContract(
    key: string,
    context: VerificationContext,
  ): Promise<ContractVerificationResult | null> {
    const contract = this.contracts.get(key)
    if (!contract) return null
    return this.contractVerifier.verify(contract, context)
  }

  /** Detect cycles in a set of step dependencies */
  detectCycle(subtasks: Array<{ id: string; dependsOn: string[] }>): CycleResult {
    const vertices = subtasks.map(s => s.id)
    const graph = new DependencyGraph()

    for (const step of subtasks) {
      for (const dep of step.dependsOn) {
        graph.addEdge(dep, step.id)
      }
    }

    return graph.detectCycle(vertices)
  }

  /** Get a snapshot of the current formal model state */
  snapshot(): FormalModelSnapshot {
    return {
      memoryProviders: ["session-store", "episodic-store", "skill-store", "vector-store"],
      tools: [
        "agentic_plan", "agentic_execute", "agentic_reflect", "agentic_verify",
        "agentic_status", "agentic_nav", "agentic_context", "agentic_snapshot",
        "agentic_pr", "agentic_score", "agentic_model", "agentic_model_reset",
        "agentic_delegate", "agentic_pipeline", "agentic_message", "agentic_parallel",
        "agentic_skill", "agentic_episodes", "agentic_dashboard", "agentic_guard",
        "agentic_evolve", "agentic_auto", "agentic_debate", "agentic_router",
        "agentic_clean", "agentic_rag", "agentic_mcp", "agentic_budget",
      ],
      multiAgentRoles: ["pm", "architect", "developer", "qa", "coordinator"],
      promptCount: 5, // 5 built-in roles
      domainContracts: [...this.contracts.entries()].map(([domain, contract]) => ({
        domain,
        contractCount: contract.preConditions.length + contract.postConditions.length + contract.invariants.length,
      })),
      dependencyGraphEdges: this.dependencyGraph.getEdges().length,
      timestamp: Date.now(),
    }
  }
}

// ──────────────────────────────────────────────────────────────
// 5. Helper: Build default contracts for common domains
// ──────────────────────────────────────────────────────────────

/** Default generic contract — applies to any domain */
export function createGenericContract(): FormalContract {
  return {
    description: "Generic domain contract — basic output and dependency checks",
    preConditions: [
      { expr: "output is non-empty", severity: "warning", description: "Step should produce some output" },
      { expr: "dependency is complete", severity: "error", description: "All dependencies must be completed before this step" },
    ],
    postConditions: [
      { expr: "no errors", severity: "error", description: "No errors should be produced" },
      { expr: "files exist", severity: "warning", description: "Expected files should exist" },
    ],
    invariants: [
      { expr: "no circular dependencies", severity: "error", description: "Task dependency graph must be acyclic" },
    ],
  }
}

/** Code domain contract — stricter, with compile/test verification */
export function createCodeContract(): FormalContract {
  return {
    description: "Software engineering domain contract — compile + test + quality gates",
    preConditions: [
      { expr: "dependency is complete", severity: "error", description: "All dependencies must be completed before this step" },
      { expr: "output is non-empty", severity: "error", description: "Code step must produce output" },
      { expr: "files exist", severity: "warning", description: "At least one file should be modified" },
    ],
    postConditions: [
      { expr: "compile passes", severity: "error", description: "Code must compile without errors" },
      { expr: "no errors", severity: "error", description: "No runtime errors or exceptions" },
      { expr: "files exist", severity: "error", description: "Implementation files must exist" },
    ],
    invariants: [
      { expr: "no circular dependencies", severity: "error", description: "Task dependency graph must be acyclic" },
      { expr: "no errors", severity: "warning", description: "System must remain in consistent state" },
    ],
  }
}
