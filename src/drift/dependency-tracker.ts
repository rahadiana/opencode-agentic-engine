export interface FileChange {
  file: string
  stepId: string
  changeType: "create" | "modify" | "delete"
  timestamp: number
}

export interface DependencyEdge {
  from: string
  to: string
  relation: "imports" | "extends" | "type-ref"
}

export interface PropagationAnalysis {
  likelyCulprit: string | null
  affectedSteps: string[]
  propagationPath: string[]
  suggestion: string
}

export class DependencyTracker {
  private fileChanges = new Map<string, FileChange[]>()
  private dependencies = new Map<string, DependencyEdge[]>()

  recordChange(sessionId: string, stepId: string, files: string[]): void {
    const changes = this.fileChanges.get(sessionId) ?? []
    for (const file of files) {
      changes.push({
        file,
        stepId,
        changeType: "modify",
        timestamp: Date.now(),
      })
    }
    this.fileChanges.set(sessionId, changes)
  }

  addDependency(from: string, to: string, relation: DependencyEdge["relation"]): void {
    const edges = this.dependencies.get(from) ?? []
    edges.push({ from, to, relation })
    this.dependencies.set(from, edges)
  }

  getFilesChangedByStep(sessionId: string, stepId: string): string[] {
    const changes = this.fileChanges.get(sessionId) ?? []
    return [...new Set(changes.filter(c => c.stepId === stepId).map(c => c.file))]
  }

  getFilesChangedByPreviousSteps(sessionId: string, currentStepId: string, planSteps: string[]): string[] {
    const currentIdx = planSteps.indexOf(currentStepId)
    if (currentIdx <= 0) return []

    const changes = this.fileChanges.get(sessionId) ?? []
    const files = new Set<string>()
    for (const c of changes) {
      const stepIdx = planSteps.indexOf(c.stepId)
      if (stepIdx >= 0 && stepIdx < currentIdx) {
        files.add(c.file)
      }
    }
    return [...files]
  }

  analyzeErrorPropagation(sessionId: string, failingStepId: string, error: string, planSteps: string[]): PropagationAnalysis {
    const previousFiles = this.getFilesChangedByPreviousSteps(sessionId, failingStepId, planSteps)
    const likelyCulprit = previousFiles.length > 0 ? previousFiles[previousFiles.length - 1] : null

    const affectedSteps: string[] = []
    const changes = this.fileChanges.get(sessionId) ?? []
    const conflictFiles = new Set(changes.map(c => c.file))
    if (previousFiles.some(f => conflictFiles.has(f))) {
      for (const c of changes) {
        if (c.stepId !== failingStepId) affectedSteps.push(c.stepId)
      }
    }

    const propagationPath: string[] = []
    for (const stepId of planSteps) {
      if (stepId === failingStepId) break
      const changedFiles = this.getFilesChangedByStep(sessionId, stepId)
      const hasOverlap = changedFiles.some(f =>
        error.toLowerCase().includes(f.toLowerCase())
      )
      if (hasOverlap || changedFiles.length > 0) {
        propagationPath.push(stepId)
      }
    }

    let suggestion = ""
    if (likelyCulprit) {
      suggestion = `Error likely originates from changes to ${likelyCulprit}. Review this file first.`
    } else if (propagationPath.length > 0) {
      suggestion = `Error may have propagated from earlier steps: ${propagationPath.join(", ")}. Check those changes for side effects.`
    } else {
      suggestion = "Unable to trace error source. Review the most recent changes manually."
    }

    return { likelyCulprit, affectedSteps: [...new Set(affectedSteps)], propagationPath, suggestion }
  }

  clear(sessionId?: string): void {
    if (sessionId) {
      this.fileChanges.delete(sessionId)
    } else {
      this.fileChanges.clear()
      this.dependencies.clear()
    }
  }
}
