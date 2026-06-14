import type { Subtask } from "./intent-parser"

export interface ParallelPlan {
  phases: Phase[]
  maxParallelism: number
}

export interface Phase {
  index: number
  steps: Subtask[]
  canRunInParallel: boolean
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
}
