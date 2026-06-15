import type { Subtask } from "./intent-parser.js"
import type { LLMEngine } from "./llm.js"
import { execFileSync } from "node:child_process"
import { writeFileSync, mkdirSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"

export interface ParallelPlan {
  phases: Phase[]
  maxParallelism: number
}

export interface Phase {
  index: number
  steps: Subtask[]
  canRunInParallel: boolean
}

export interface ParallelExecutionResult {
  stepId: string
  success: boolean
  output?: string
  error?: string
  filesModified: string[]
}

export type StepRunner = (step: Subtask) => Promise<ParallelExecutionResult>

export interface LLMStepRunnerOptions {
  llmEngine: LLMEngine
  projectDir: string
  planGoal: string
  sessionId: string
  opencodePath?: string
  verbose?: boolean
}

export interface ConcurrentExecutionReport {
  phaseResults: Array<{
    phaseIndex: number
    steps: Array<{ id: string; description: string }>
    results: ParallelExecutionResult[]
  }>
  totalSteps: number
  completedSteps: number
  failedSteps: number
  totalDurationMs: number
  summary: string
}

export class ParallelExecutor {
  analyzeParallelism(subtasks: Subtask[]): ParallelPlan {
    const phases: Phase[] = []
    const completed = new Set<string>()
    const remaining = new Set(subtasks.map(s => s.id))

    let phaseIndex = 0
    while (remaining.size > 0) {
      const ready: Subtask[] = []
      for (const step of subtasks) {
        if (!remaining.has(step.id)) continue
        if (step.dependsOn.every(d => completed.has(d))) {
          ready.push(step)
        }
      }

      if (ready.length === 0) {
        // Circular dependency or all blocked
        const leftover = subtasks.filter(s => remaining.has(s.id))
        phases.push({ index: phaseIndex++, steps: leftover, canRunInParallel: false })
        break
      }

      for (const step of ready) {
        remaining.delete(step.id)
        completed.add(step.id)
      }

      phases.push({ index: phaseIndex++, steps: ready, canRunInParallel: ready.length > 1 })
    }

    return {
      phases,
      maxParallelism: Math.max(...phases.map(p => p.steps.length), 1),
    }
  }

  async executePhase(
    phase: Phase,
    runner: StepRunner,
    abortOnFailure = false,
  ): Promise<ParallelExecutionResult[]> {
    if (!phase.canRunInParallel || phase.steps.length <= 1) {
      const results: ParallelExecutionResult[] = []
      for (const step of phase.steps) {
        const result = await runner(step)
        results.push(result)
        if (abortOnFailure && !result.success) break
      }
      return results
    }

    const promises = phase.steps.map(step => runner(step))
    const results = await Promise.all(promises)

    if (abortOnFailure && results.some(r => !r.success)) {
      return results
    }

    return results
  }

  async executeAll(
    plan: ParallelPlan,
    runner: StepRunner,
    abortOnFailure = false,
  ): Promise<ParallelExecutionResult[]> {
    const allResults: ParallelExecutionResult[] = []

    for (const phase of plan.phases) {
      const phaseResults = await this.executePhase(phase, runner, abortOnFailure)
      allResults.push(...phaseResults)

      if (abortOnFailure && phaseResults.some(r => !r.success)) {
        break
      }
    }

    return allResults
  }

  suggestParallelTasks(subtasks: Subtask[], currentlyCompleted: string[]): { taskId: string; parallelGroup: number }[] {
    const completed = new Set(currentlyCompleted)
    const ready: Subtask[] = []

    for (const step of subtasks) {
      if (completed.has(step.id)) continue
      if (step.dependsOn.every(d => completed.has(d))) {
        ready.push(step)
      }
    }

    // Group steps that have no shared dependencies (can truly run in parallel)
    const groups = new Map<string, number>()
    let groupId = 0

    for (const step of ready) {
      const depKey = [...step.dependsOn].sort().join(",")
      const group = groups.get(depKey)
      if (group !== undefined) {
        groups.set(step.id, group)
      } else {
        groups.set(depKey, groupId)
        groups.set(step.id, groupId)
        groupId++
      }
    }

    return ready.map(s => ({ taskId: s.id, parallelGroup: groups.get(s.id) ?? 0 }))
  }

  detectConflicts(parallelTasks: string[], modifiedFiles: Map<string, string[]>): Array<{ taskA: string; taskB: string; conflictingFile: string }> {
    const conflicts: Array<{ taskA: string; taskB: string; conflictingFile: string }> = []

    for (let i = 0; i < parallelTasks.length; i++) {
      for (let j = i + 1; j < parallelTasks.length; j++) {
        const filesA = modifiedFiles.get(parallelTasks[i]) ?? []
        const filesB = modifiedFiles.get(parallelTasks[j]) ?? []

        for (const file of filesA) {
          if (filesB.includes(file)) {
            conflicts.push({
              taskA: parallelTasks[i],
              taskB: parallelTasks[j],
              conflictingFile: file,
            })
          }
        }
      }
    }

    return conflicts
  }

  llmStepRunner(opts: LLMStepRunnerOptions): StepRunner {
    return async (step: Subtask): Promise<ParallelExecutionResult> => {
      const startTime = Date.now()
      try {
        const resp = await opts.llmEngine.call({
          systemPrompt: `You are an autonomous software engineer implementing a step of a larger plan. Generate implementation as JSON with:
- "files": [{ "path": "relative/file/path", "content": "file content" }]
- "summary": "what was done"
Only include files that need changing. Return ONLY valid JSON.` + opts.llmEngine.getMemoryContext(step.description),
          userPrompt: `Goal: ${opts.planGoal}\nStep (${step.id}): ${step.description}\nDir: ${opts.projectDir}\nComplete the step.`,
          jsonMode: true,
          temperature: 0.3,
        })

        let impl: { files?: Array<{ path: string; content: string }>; summary?: string }
        try { impl = JSON.parse(resp.content) } catch {
          return { stepId: step.id, success: false, error: "LLM JSON parse error", output: resp.content, filesModified: [] }
        }

        const files: string[] = []
        for (const file of impl.files ?? []) {
          const fullPath = join(opts.projectDir, file.path)
          mkdirSync(dirname(fullPath), { recursive: true })
          writeFileSync(fullPath, file.content, "utf-8")
          files.push(file.path)
        }

        return {
          stepId: step.id,
          success: true,
          output: impl.summary ?? step.description,
          filesModified: files,
        }
      } catch (e) {
        return { stepId: step.id, success: false, error: (e as Error).message, output: "", filesModified: [] }
      }
    }
  }

  async executePlanConcurrently(
    plan: ParallelPlan,
    stepRunner: StepRunner,
    abortOnFailure = false,
  ): Promise<{ results: ParallelExecutionResult[]; durationMs: number }> {
    const startTime = Date.now()
    const results = await this.executeAll(plan, stepRunner, abortOnFailure)
    return { results, durationMs: Date.now() - startTime }
  }

  async executeWithSubprocessSpawn(
    step: Subtask,
    opencodePath: string,
    projectDir: string,
    sessionId: string,
  ): Promise<ParallelExecutionResult> {
    try {
      if (!existsSync(opencodePath)) {
        return { stepId: step.id, success: false, error: `opencode not found at ${opencodePath}`, output: "", filesModified: [] }
      }

      const taskJson = JSON.stringify({
        goal: `Implement: ${step.description}`,
        sessionId,
        constraints: [],
      })

      const result = execFileSync(opencodePath, ["eval", "--json", taskJson], {
        cwd: projectDir,
        encoding: "utf-8",
        timeout: 120000,
        maxBuffer: 10 * 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
      })

      return {
        stepId: step.id,
        success: true,
        output: result.trim(),
        filesModified: [],
      }
    } catch (e) {
      return {
        stepId: step.id,
        success: false,
        error: (e as Error).message,
        output: "",
        filesModified: [],
      }
    }
  }
}
