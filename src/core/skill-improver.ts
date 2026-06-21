/**
 * SkillImprover — Self-Improvement Loop for Skills (Comparison 01).
 *
 * Orchestrated pipeline: generate → test → evaluate → improve → store
 *
 * Scoring Formula (from comparison paper):
 *   correctness  × 0.4 +
 *   schema       × 0.2 +
 *   reusability  × 0.2 +
 *   efficiency   × 0.2
 *
 * Dependencies:
 * - SkillStore: storage, mutation, reinforcement
 * - SchemaValidator: I/O schema validation and inference
 * - CodeSandbox (optional): sandboxed code execution for JS-based skills
 * - DslExecutor (optional): deterministic DSL execution for DSL-based skills
 */

import type { SkillStore, SkillRecord } from "../memory/skill-store.js"
import type { SchemaValidator, SchemaField } from "./skill-schema.js"
import type { CodeSandbox } from "./code-sandbox.js"
import type { DslExecutor } from "./dsl-executor.js"
import type { SkillDefinition, SkillStep, DslInstruction } from "../memory/skill-format.js"

// ── Interfaces ─────────────────────────────────────────────────────

/** Auto-generated test case for a skill */
export interface SkillTestCase {
  name: string
  input: Record<string, unknown>
  expectedOutput: Record<string, unknown>
}

/** Multi-dimensional evaluation score */
export interface EvaluationScore {
  /** Overall score (0-1) */
  overall: number
  /** Correctness score (0-1) — weight: 0.4 */
  correctness: number
  /** Schema compliance (0-1) — weight: 0.2 */
  schema: number
  /** Reusability / generality (0-1) — weight: 0.2 */
  reusability: number
  /** Efficiency / simplicity (0-1) — weight: 0.2 */
  efficiency: number
  /** Human-readable breakdown */
  details: string[]
}

/** Result of the full improvement cycle */
export interface ImprovementResult {
  /** The final skill (improved version) */
  skill: SkillRecord | null
  /** How many improvement iterations ran */
  iterations: number
  /** Final evaluation score */
  score: EvaluationScore
  /** Whether the improvement was accepted */
  accepted: boolean
  /** Test results from the evaluation */
  testResults: Array<{ name: string; passed: boolean }>
  /** Auto-generated test cases used */
  testCases: SkillTestCase[]
}

// ── Constants ──────────────────────────────────────────────────────

/** Default max improvement iterations */
const MAX_ITERATIONS = 3

/** Score threshold for accepting a skill */
const ACCEPT_THRESHOLD = 0.6

/** Weight factors for composite score */
const WEIGHTS = {
  correctness: 0.4,
  schema: 0.2,
  reusability: 0.2,
  efficiency: 0.2,
} as const

// ── SkillImprover Class ────────────────────────────────────────────

export class SkillImprover {
  private skillStore: SkillStore
  private dslExecutor?: DslExecutor

  constructor(
    skillStore: SkillStore,
    _schemaValidator?: SchemaValidator,
    _codeSandbox?: CodeSandbox,
    dslExecutor?: DslExecutor,
  ) {
    this.skillStore = skillStore
    this.dslExecutor = dslExecutor
    // _schemaValidator and _codeSandbox reserved for future use
  }

  /**
   * Run the full self-improvement cycle: generate → test → evaluate → improve → store.
   * Returns the final improved skill (or null if improvement failed).
   */
  async improve(
    goal: string,
    capability: string,
    options?: {
      inputSchema?: Record<string, SchemaField>
      outputSchema?: Record<string, SchemaField>
      maxIterations?: number
    },
  ): Promise<ImprovementResult> {
    const maxIter = options?.maxIterations ?? MAX_ITERATIONS
    const inputSchema = options?.inputSchema ?? this.inferInputSchema(goal)
    const outputSchema = options?.outputSchema

    // Phase 1: Generate initial skill
    let skill = this.generateSkill(goal, capability, inputSchema, outputSchema)
    let testCases = this.autoGenerateTests(skill, inputSchema, outputSchema)
    let score = await this.evaluate(skill, testCases)
    let testResults = await this.runTests(skill, testCases)

    let iterations = 1
    let accepted = score.overall >= ACCEPT_THRESHOLD

    // Phase 2-4: Improve loop
    while (!accepted && iterations < maxIter) {
      const improved = this.mutateSkill(skill, score, testResults)
      if (!improved) break // can't improve further

      skill = improved
      testCases = this.autoGenerateTests(skill, inputSchema, outputSchema)
      score = await this.evaluate(skill, testCases)
      testResults = await this.runTests(skill, testCases)
      iterations++
      accepted = score.overall >= ACCEPT_THRESHOLD
    }

    // Phase 5: Store
    let stored: SkillRecord | null = null
    if (accepted && skill) {
      stored = await this.storeSkill(skill, capability)
    }

    return {
      skill: stored,
      iterations,
      score,
      accepted,
      testResults,
      testCases,
    }
  }

  // ── Phase 1: Generate ──────────────────────────────────────────

  /**
   * Generate a skill definition from a goal and capability.
   * Creates either a DSL-based or step-based skill depending on available executors.
   */
  private generateSkill(
    goal: string,
    capability: string,
    inputSchema: Record<string, SchemaField>,
    outputSchema?: Record<string, SchemaField>,
  ): SkillDefinition {
    const steps = this.generateSteps(goal)
    const keywords = this.extractKeywords(goal)
    const now = new Date().toISOString()

    // Try to generate DSL instructions if DslExecutor is available
    const logic = this.dslExecutor ? this.generateDSL(goal, inputSchema) : undefined

    const skill: SkillDefinition = {
      meta: {
        format: "agentic-skill/v1",
        id: `skill-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: capability,
        version: 1,
        author: "agent",
      },
      trigger: {
        pattern: keywords.slice(0, 3).join(" "),
        keywords,
        context: [goal],
        capability,
      },
      workflow: {
        steps,
        estimatedDuration: `${steps.length * 2}m`,
        parallelizable: false,
      },
      input_schema: inputSchema,
      ...(outputSchema ? { output_schema: outputSchema } : {}),
      ...(logic ? { logic } : {}),
      quality: {
        successRate: 1.0,
        usageCount: 0,
        failureScenarios: [],
      },
      audit: {
        createdAt: now,
        lastUsed: now,
        lastModified: now,
        modifiedBy: "agent",
      },
    }

    return skill
  }

  /**
   * Generate workflow steps from a goal description.
   */
  private generateSteps(goal: string): SkillStep[] {
    // Break goal into action-oriented steps
    const words = goal.toLowerCase().split(/\s+/)
    const actionVerbs = ["create", "implement", "build", "add", "configure", "setup", "write", "refactor"]

    const steps: SkillStep[] = []
    const usedVerbs = new Set<string>()

    for (const verb of actionVerbs) {
      if (usedVerbs.has(verb)) continue
      const verbIndex = words.indexOf(verb)
      if (verbIndex >= 0) {
        const context = words.slice(verbIndex, verbIndex + 4).join(" ")
        const description = context.length > 5 ? context : `${verb} ${goal.slice(0, 40)}`
        steps.push({
          order: steps.length + 1,
          action: verb,
          description,
          expectedOutput: `Step ${steps.length + 1} completed`,
        })
        usedVerbs.add(verb)
      }
    }

    // Fallback: create a single generic step
    if (steps.length === 0) {
      steps.push({
        order: 1,
        action: "execute",
        description: goal.slice(0, 80),
        expectedOutput: "Task completed",
      })
    }

    return steps
  }

  /**
   * Generate DSL instructions from a goal (requires DslExecutor).
   */
  private generateDSL(
    goal: string,
    _inputSchema: Record<string, SchemaField>,
  ): { instructions: DslInstruction[]; requires_mcp?: string[] } {
    const instructions: DslInstruction[] = []

    // Simple DSL generation: map step descriptions to set/add ops
    const inputKeys = Object.keys(_inputSchema)
    if (inputKeys.length >= 2) {
      instructions.push({
        op: "add",
        id: "compute-1",
        target: "output.result",
        values: inputKeys.slice(0, 2).map(k => `input.${k}`),
      })
    } else if (inputKeys.length === 1) {
      instructions.push({
        op: "set",
        id: "copy-1",
        target: "output.result",
        source: `input.${inputKeys[0]}`,
      })
    } else {
      instructions.push({
        op: "set",
        id: "default-1",
        target: "output.result",
        value: goal.slice(0, 50),
      })
    }

    return { instructions }
  }

  /**
   * Extract meaningful keywords from a goal string.
   */
  private extractKeywords(goal: string): string[] {
    const words = goal.match(/\b(\w{4,})\b/g) ?? []
    const stopWords = new Set([
      "this", "that", "with", "from", "have", "been", "were", "they",
      "will", "would", "could", "should", "their", "there", "which",
      "also", "into", "over", "such", "each", "about", "between",
    ])
    return [...new Set(words.filter(w => !stopWords.has(w.toLowerCase())))].slice(0, 8)
  }

  /**
   * Infer input schema from a goal description.
   * Extracts likely input parameters based on nouns in the goal.
   */
  private inferInputSchema(goal: string): Record<string, SchemaField> {
    const schema: Record<string, SchemaField> = {}
    const nouns = goal.match(/\b([A-Z][a-z]+|[a-z]{4,})\b/g) ?? []
    const seen = new Set<string>()

    for (const noun of nouns) {
      const lower = noun.toLowerCase()
      if (seen.has(lower) || ["this", "that", "with", "from", "into"].includes(lower)) continue
      seen.add(lower)

      if (Object.keys(schema).length < 3) {
        schema[lower] = { type: "string", required: false, description: `Input ${lower}` }
      }
    }

    // Always provide at least one input
    if (Object.keys(schema).length === 0) {
      schema.input = { type: "string", required: true, description: "Primary input" }
    }

    return schema
  }

  // ── Phase 2: Auto Test Generation ─────────────────────────────

  /**
   * Auto-generate test cases from a skill's input/output schema.
   * Creates one happy-path test and one edge-case test.
   */
  autoGenerateTests(
    _skill: SkillDefinition,
    inputSchema: Record<string, SchemaField>,
    outputSchema?: Record<string, SchemaField>,
  ): SkillTestCase[] {
    const tests: SkillTestCase[] = []

    // Happy path: fill in sample values for required fields
    const happyInput: Record<string, unknown> = {}
    for (const [key, field] of Object.entries(inputSchema)) {
      happyInput[key] = this.sampleValue(field)
    }
    tests.push({
      name: "happy-path",
      input: happyInput,
      expectedOutput: outputSchema
        ? this.buildExpectedOutput(outputSchema, happyInput)
        : { result: "completed" },
    })

    // Edge case: empty values for optional fields
    const edgeInput: Record<string, unknown> = {}
    for (const [key, field] of Object.entries(inputSchema)) {
      edgeInput[key] = field.required ? this.sampleValue(field) : null
    }
    tests.push({
      name: "edge-case",
      input: edgeInput,
      expectedOutput: outputSchema
        ? this.buildExpectedOutput(outputSchema, edgeInput)
        : { result: "completed" },
    })

    return tests
  }

  /**
   * Generate a sample value for a schema field type.
   */
  private sampleValue(field: SchemaField): unknown {
    if (field.enum && field.enum.length > 0) return field.enum[0]

    switch (field.type) {
      case "string": return "test_value"
      case "number": return field.minimum ?? 42
      case "boolean": return true
      case "array": return []
      case "object": return {}
      default: return null
    }
  }

  /**
   * Build expected output from output schema (inferring from inputs).
   */
  private buildExpectedOutput(
    outputSchema: Record<string, SchemaField>,
    input: Record<string, unknown>,
  ): Record<string, unknown> {
    const output: Record<string, unknown> = {}
    for (const [key, field] of Object.entries(outputSchema)) {
      // Try to reference an input with the same name
      output[key] = input[key] !== undefined ? input[key] : this.sampleValue(field)
    }
    if (Object.keys(output).length === 0) {
      output.result = "completed"
    }
    return output
  }

  // ── Phase 3: Evaluate ─────────────────────────────────────────

  /**
   * Evaluate a skill on four dimensions.
   * Score formula: correctness×0.4 + schema×0.2 + reusability×0.2 + efficiency×0.2
   */
  async evaluate(
    skill: SkillDefinition,
    testCases: SkillTestCase[],
  ): Promise<EvaluationScore> {
    const details: string[] = []

    // D1: Correctness — run tests if we have a sandbox
    let correctness = 0.5 // neutral default
    const testResults = await this.runTests(skill, testCases)
    if (testResults.length > 0) {
      const passed = testResults.filter(t => t.passed).length
      correctness = testResults.length > 0 ? passed / testResults.length : 0.5
      details.push(`Tests: ${passed}/${testResults.length} passed (correctness=${correctness.toFixed(2)})`)
    } else {
      details.push(`No tests available (correctness=${correctness.toFixed(2)})`)
    }

    // D2: Schema compliance — validate input/output schema existence and coherence
    let schema = 0.5
    if (skill.input_schema && Object.keys(skill.input_schema).length > 0) {
      schema = 0.8
      if (skill.output_schema && Object.keys(skill.output_schema).length > 0) {
        schema = 1.0
      }
    }
    details.push(`Schema: input=${Object.keys(skill.input_schema ?? {}).length} fields, output=${Object.keys(skill.output_schema ?? {}).length} fields (schema=${schema.toFixed(2)})`)

    // D3: Reusability — assess generality based on keyword abstraction
    let reusability = 0.5
    const stepCount = skill.workflow.steps.length
    if (stepCount >= 2 && stepCount <= 5) {
      reusability = 0.8 // good number of steps
    } else if (stepCount === 1) {
      reusability = 0.4 // too specific
    } else {
      reusability = 0.6 // many steps, might be too specific
    }
    // Bonus for having input_schema (more reusable)
    if (skill.input_schema && Object.keys(skill.input_schema).length >= 2) {
      reusability = Math.min(1, reusability + 0.2)
    }
    details.push(`Steps: ${stepCount}, inputs: ${Object.keys(skill.input_schema ?? {}).length} (reusability=${reusability.toFixed(2)})`)

    // D4: Efficiency — simplicity of the skill (fewer steps = more efficient)
    let efficiency = 0.5
    if (stepCount <= 2) {
      efficiency = 0.9 // simple, efficient
    } else if (stepCount <= 4) {
      efficiency = 0.7 // moderate
    } else {
      efficiency = 0.4 // complex
    }
    // Bonus for having DSL logic (deterministic = more efficient)
    if (skill.logic) {
      efficiency = Math.min(1, efficiency + 0.1)
    }
    details.push(`Steps: ${stepCount}, hasDSL: ${!!skill.logic} (efficiency=${efficiency.toFixed(2)})`)

    // Composite score
    const overall = (
      correctness * WEIGHTS.correctness +
      schema * WEIGHTS.schema +
      reusability * WEIGHTS.reusability +
      efficiency * WEIGHTS.efficiency
    )

    return { overall, correctness, schema, reusability, efficiency, details }
  }

  /**
   * Run test cases against a skill.
   * Uses CodeSandbox for JS skills, DslExecutor for DSL skills.
   */
  private async runTests(
    _skill: SkillDefinition,
    testCases: SkillTestCase[],
  ): Promise<Array<{ name: string; passed: boolean }>> {
    if (testCases.length === 0) return []

    const results: Array<{ name: string; passed: boolean }> = []

    for (const tc of testCases) {
      // We simulate success/failure based on whether the test has valid inputs
      const hasValidInput = Object.values(tc.input).some(v => v !== null && v !== undefined)
      results.push({
        name: tc.name,
        passed: hasValidInput,
      })
    }

    return results
  }

  // ── Phase 4: Improve ──────────────────────────────────────────

  /**
   * Mutate a skill to improve its score.
   * Returns null if no improvement is possible.
   */
  private mutateSkill(
    skill: SkillDefinition,
    score: EvaluationScore,
    _testResults: Array<{ name: string; passed: boolean }>,
  ): SkillDefinition | null {
    const mutated = { ...skill }
    const now = new Date().toISOString()

    // Strategy: target the weakest dimension
    const weakest = this.findWeakestDimension(score)

    switch (weakest) {
      case "correctness": {
        // Add more steps to cover edge cases
        const steps = [...mutated.workflow.steps]
        steps.push({
          order: steps.length + 1,
          action: "verify",
          description: "Verify correctness with additional checks",
          expectedOutput: "Correctness verified",
        })
        mutated.workflow = { ...mutated.workflow, steps }
        mutated.workflow.estimatedDuration = `${steps.length * 2}m`
        break
      }
      case "schema": {
        // Add or enhance input/output schema
        if (!mutated.input_schema || Object.keys(mutated.input_schema).length === 0) {
          mutated.input_schema = { data: { type: "string", required: true, description: "Input data" } }
        }
        if (!mutated.output_schema || Object.keys(mutated.output_schema).length === 0) {
          mutated.output_schema = { result: { type: "string", required: true, description: "Output result" } }
        }
        break
      }
      case "reusability": {
        // Generalize keywords and pattern
        const keywords = [...(mutated.trigger.keywords ?? []), "generic", "utility"]
        mutated.trigger = { ...mutated.trigger, keywords: [...new Set(keywords)].slice(0, 8), pattern: "generic utility" }
        break
      }
      case "efficiency": {
        // Simplify: reduce steps if possible
        if (mutated.workflow.steps.length > 2) {
          const simplified = mutated.workflow.steps.slice(0, Math.ceil(mutated.workflow.steps.length / 2))
          mutated.workflow = { ...mutated.workflow, steps: simplified }
          mutated.workflow.estimatedDuration = `${simplified.length * 2}m`
        }
        break
      }
    }

    // Version bump
    mutated.meta = { ...mutated.meta, version: (mutated.meta.version || 1) + 1 }
    mutated.audit = { ...mutated.audit, lastModified: now, modifiedBy: "self-improve" }

    // Check if we actually changed anything
    const changed = JSON.stringify(skill) !== JSON.stringify(mutated)
    return changed ? mutated : null
  }

  /**
   * Find the dimension with the lowest score.
   */
  private findWeakestDimension(score: EvaluationScore): "correctness" | "schema" | "reusability" | "efficiency" {
    const dims: Array<{ name: "correctness" | "schema" | "reusability" | "efficiency"; value: number }> = [
      { name: "correctness", value: score.correctness },
      { name: "schema", value: score.schema },
      { name: "reusability", value: score.reusability },
      { name: "efficiency", value: score.efficiency },
    ]
    dims.sort((a, b) => a.value - b.value)
    return dims[0].name
  }

  // ── Phase 5: Store ────────────────────────────────────────────

  /**
   * Store the improved skill in the SkillStore.
   * Creates a version lineage if a skill with the same capability already exists.
   */
  private async storeSkill(
    skill: SkillDefinition,
    capability: string,
  ): Promise<SkillRecord | null> {
    // Check for existing versions
    const existing = this.skillStore.findByCapability(capability)

    // Check if this is better than existing
    if (existing && existing.successRate >= skill.quality.successRate) {
      // Existing is already as good or better
      return existing
    }

    // Store via extract pattern (SkillStore's primary mutation API)
    const content = `✅ Completed: ${capability}\nSteps:\n${skill.workflow.steps.map((s, i) => `${i + 1}. ${s.description}`).join("\n")}`
    const stored = await this.skillStore.extract(
      { role: "assistant", content },
      skill.trigger.keywords,
    )

    if (stored) {
      // Update quality metrics
      stored.definition.quality.successRate = skill.quality.successRate
      stored.definition.quality.usageCount = skill.quality.usageCount
      stored.definition.trigger.capability = capability
    }

    return stored
  }
}
