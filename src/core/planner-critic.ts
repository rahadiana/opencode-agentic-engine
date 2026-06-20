/**
 * PlannerCritic — Self-reflection loop for plan quality (comp 13).
 *
 * Flow:
 * 1. Generate 2-4 candidate plans via LLM
 * 2. Critic evaluates each plan (score 0.0-1.0, issues, suggestions)
 * 3. Refine best plan based on critic feedback (max 3 iterations)
 * 4. If score >= ACCEPT_THRESHOLD (0.85), accept
 * 5. Fallback to best available when max iterations reached
 */
import type { LLMEngine } from "./llm.js"
import type { TaskIntent, Subtask } from "./intent-parser.js"

// ── Constants ─────────────────────────────────────────────────────

/** Maximum number of candidate plans to generate */
const MAX_CANDIDATES = 4
/** Maximum steps per candidate plan */
const MAX_STEPS = 6
/** Score threshold to accept a plan without further refinement */
const ACCEPT_THRESHOLD = 0.85
/** Maximum refinement iterations */
const MAX_REFINE_ITERATIONS = 3

// ── Interfaces ────────────────────────────────────────────────────

export interface CandidatePlan {
  id: string
  steps: Subtask[]
  rationale: string
}

export interface CriticScore {
  overall: number
  issues: string[]
  suggestions: string[]
}

export interface CriticResult {
  plan: TaskIntent
  candidates: CandidatePlan[]
  scores: CriticScore[]
  bestScore: number
  iterations: number
  accepted: boolean
}

// ── Prompts ───────────────────────────────────────────────────────

const PLANNER_PROMPT = `You are a **planning agent**. Your task is to break down a software engineering goal into a structured plan.

Generate between 2 and 4 different candidate plans for the given goal. Each plan should have 2-6 concrete steps.

For each candidate plan, provide:
1. A short rationale (why this approach)
2. Ordered steps with step IDs and descriptions

CRITICAL: Respond with a valid JSON array. Each element must have:
{
  "rationale": "string explaining this approach",
  "steps": [{ "id": "step-1", "description": "what to do" }]
}

Focus on concrete, actionable steps. Each step should be completable in one coding session.
Dependencies between steps should be implicit in the ordering (later steps depend on earlier ones).

Goal: {GOAL}
Codebase: {CODEBASE}`

const CRITIC_EVALUATOR_PROMPT = `You are a **plan critic**. Evaluate the following candidate plan for a software engineering goal.

Score from 0.0 (terrible) to 1.0 (perfect) based on:
1. Completeness — does it cover all aspects of the goal?
2. Correctness — are the steps in the right order with proper dependencies?
3. Clarity — are the step descriptions concrete and actionable?
4. Feasibility — can each step be completed in one coding session?
5. Efficiency — does it avoid unnecessary steps or duplication?

Respond with a valid JSON object:
{
  "overall": 0.85,
  "issues": ["Step 2 is too vague", "Missing error handling consideration"],
  "suggestions": ["Add a step for writing tests", "Split step 3 into two"]
}

Goal: {GOAL}

Plan: {PLAN}`

const REFINEMENT_PROMPT = `You are a **plan refiner**. You have received critic feedback on your plan. Revise the plan to address ALL issues raised.

Return a valid JSON object with the revised plan:
{
  "rationale": "How this revision addresses the critic's concerns",
  "steps": [{ "id": "step-1", "description": "revised step" }]
}

Goal: {GOAL}
Previous Plan: {PLAN}
Critic Issues: {ISSUES}
Critic Suggestions: {SUGGESTIONS}`

// ── PlannerCritic Class ───────────────────────────────────────────

export class PlannerCritic {
  constructor(private llmEngine: LLMEngine) {}

  /**
   * Run the full planner critic loop: generate candidates → evaluate → refine.
   * Returns the best plan found.
   */
  async refinePlan(goal: string, codebaseSummary: string): Promise<CriticResult> {
    // Phase 1: Generate candidate plans
    const candidates = await this.generateCandidates(goal, codebaseSummary)
    if (candidates.length === 0) {
      return {
        plan: { goal, constraints: [], context: { relevantFiles: [], dependencies: [] }, subtasks: [] },
        candidates: [],
        scores: [],
        bestScore: 0,
        iterations: 0,
        accepted: false,
      }
    }

    // Phase 2: Evaluate each candidate
    const scores = await Promise.all(
      candidates.map(c => this.evaluatePlan(c, goal))
    )

    // Sort by score descending
    const ranked = candidates.map((c, i) => ({ candidate: c, score: scores[i] }))
      .sort((a, b) => b.score.overall - a.score.overall)

    let bestCandidate = ranked[0].candidate
    let bestScore = ranked[0].score

    // Phase 3: Refinement loop
    let iterations = 0
    let accepted = bestScore.overall >= ACCEPT_THRESHOLD

    while (!accepted && iterations < MAX_REFINE_ITERATIONS) {
      iterations++
      const refined = await this.refineCandidate(
        goal,
        bestCandidate,
        bestScore.issues,
        bestScore.suggestions,
      )
      if (!refined) break

      const refinedScore = await this.evaluatePlan(refined, goal)
      bestCandidate = refined
      bestScore = refinedScore
      accepted = refinedScore.overall >= ACCEPT_THRESHOLD
    }

    const plan: TaskIntent = {
      goal,
      constraints: [],
      context: { relevantFiles: [], dependencies: [] },
      subtasks: bestCandidate.steps,
    }

    return {
      plan,
      candidates,
      scores,
      bestScore: bestScore.overall,
      iterations,
      accepted,
    }
  }

  /**
   * Generate 2-4 candidate plans for a goal.
   */
  async generateCandidates(goal: string, codebaseSummary: string): Promise<CandidatePlan[]> {
    try {
      const prompt = PLANNER_PROMPT
        .replace("{GOAL}", goal)
        .replace("{CODEBASE}", codebaseSummary || "(no codebase context)")

      const response = await this.llmEngine.call({
        systemPrompt: "You are a structured plan generator. Always output valid JSON arrays.",
        userPrompt: prompt,
        temperature: 0.7,
        maxTokens: 4096,
      })

      const parsed = this.parsePlanResponse(response.content)
      if (parsed.length === 0) {
        // Fallback: try a simpler parse
        return this.fallbackGenerate(goal)
      }
      return parsed.slice(0, MAX_CANDIDATES)
    } catch {
      return this.fallbackGenerate(goal)
    }
  }

  /**
   * Evaluate a candidate plan and return scores + issues.
   */
  async evaluatePlan(candidate: CandidatePlan, goal: string): Promise<CriticScore> {
    try {
      const planStr = JSON.stringify(candidate.steps, null, 2)
      const prompt = CRITIC_EVALUATOR_PROMPT
        .replace("{GOAL}", goal)
        .replace("{PLAN}", planStr)

      const response = await this.llmEngine.call({
        systemPrompt: "You are a rigorous plan critic. Always output valid JSON with overall, issues, suggestions.",
        userPrompt: prompt,
        temperature: 0.2,
        maxTokens: 2048,
      })

      const parsed = this.parseCriticResponse(response.content)
      if (parsed) return parsed
    } catch {
      // Fall through to default score
    }

    return { overall: 0.5, issues: ["Evaluation failed"], suggestions: [] }
  }

  /**
   * Refine a candidate plan based on critic feedback.
   */
  async refineCandidate(
    goal: string,
    candidate: CandidatePlan,
    issues: string[],
    suggestions: string[],
  ): Promise<CandidatePlan | null> {
    try {
      const prompt = REFINEMENT_PROMPT
        .replace("{GOAL}", goal)
        .replace("{PLAN}", JSON.stringify(candidate.steps, null, 2))
        .replace("{ISSUES}", issues.map((s, i) => `${i + 1}. ${s}`).join("\n"))
        .replace("{SUGGESTIONS}", suggestions.map((s, i) => `${i + 1}. ${s}`).join("\n"))

      const response = await this.llmEngine.call({
        systemPrompt: "You are a plan refiner. Always output valid JSON with rationale and steps.",
        userPrompt: prompt,
        temperature: 0.4,
        maxTokens: 4096,
      })

      const parsed = this.parseRefineResponse(response.content)
      if (parsed && parsed.steps.length > 0) return parsed
    } catch {
      // Fall through
    }
    return null
  }

  // ── JSON Parsers ─────────────────────────────────────────────────

  private parsePlanResponse(raw: string): CandidatePlan[] {
    try {
      // Try direct parse first
      const data = JSON.parse(raw)
      if (Array.isArray(data)) {
        return data
          .map((item: any, i: number) => ({
            id: `candidate-${i + 1}`,
            rationale: item.rationale || item.description || "",
            steps: (item.steps || []).map((s: any, j: number) => ({
              id: s.id || `step-${i + 1}-${j + 1}`,
              description: s.description || s.action || "",
              dependsOn: s.dependsOn ?? (j > 0 ? [`step-${i + 1}-${j}`] : []),
              verificationCriteria: s.verificationCriteria ?? [],
            })),
          }))
          .filter(c => c.steps.length > 0 && c.steps.length <= MAX_STEPS)
      }
    } catch {
      // Try extracting JSON from markdown code block
      const jsonMatch = raw.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/)
      if (jsonMatch) {
        return this.parsePlanResponse(jsonMatch[1])
      }
      const objMatch = raw.match(/\{[\s\S]*"steps"[\s\S]*\}/)
      if (objMatch) {
        try {
          const obj = JSON.parse(objMatch[0])
          if (obj.steps) {
            return [{
              id: "candidate-1",
              rationale: obj.rationale || "",
              steps: obj.steps.map((s: any, j: number) => ({
                id: s.id || `step-${j + 1}`,
                description: s.description || "",
                dependsOn: s.dependsOn ?? (j > 0 ? [`step-${j}`] : []),
                verificationCriteria: s.verificationCriteria ?? [],
              })),
            }]
          }
        } catch { /* ignore */ }
      }
    }
    return []
  }

  private parseCriticResponse(raw: string): CriticScore | null {
    try {
      const data = JSON.parse(raw)
      if (typeof data.overall === "number") {
        return {
          overall: Math.max(0, Math.min(1, data.overall)),
          issues: Array.isArray(data.issues) ? data.issues : [],
          suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
        }
      }
    } catch {
      const jsonMatch = raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)
      if (jsonMatch) {
        return this.parseCriticResponse(jsonMatch[1])
      }
    }
    return null
  }

  private parseRefineResponse(raw: string): CandidatePlan | null {
    try {
      const data = JSON.parse(raw)
      if (data.steps && Array.isArray(data.steps) && data.steps.length > 0) {
        return {
          id: "refined",
          rationale: data.rationale || "",
          steps: data.steps.map((s: any, i: number) => ({
            id: s.id || `refined-${i + 1}`,
            description: s.description || "",
            dependsOn: s.dependsOn ?? (i > 0 ? [`refined-${i}`] : []),
            verificationCriteria: s.verificationCriteria ?? [],
          })),
        }
      }
    } catch {
      const jsonMatch = raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)
      if (jsonMatch) {
        return this.parseRefineResponse(jsonMatch[1])
      }
    }
    return null
  }

  /**
   * Fallback: generate a simple plan without LLM.
   */
  private fallbackGenerate(goal: string): CandidatePlan[] {
    return [{
      id: "candidate-1",
      rationale: `Direct execution plan for: ${goal}`,
      steps: [
        { id: "step-1", description: `Set up project structure and dependencies for: ${goal}`, dependsOn: [], verificationCriteria: [] },
        { id: "step-2", description: `Implement core functionality: ${goal}`, dependsOn: ["step-1"], verificationCriteria: [] },
        { id: "step-3", description: `Add error handling and edge cases: ${goal}`, dependsOn: ["step-2"], verificationCriteria: [] },
        { id: "step-4", description: `Write tests for: ${goal}`, dependsOn: ["step-3"], verificationCriteria: [] },
        { id: "step-5", description: `Verify and finalize: ${goal}`, dependsOn: ["step-4"], verificationCriteria: [] },
      ],
    }]
  }
}
