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
  rootCauseConfidence: number
}

export interface ImpactAnalysis {
  file: string
  impactedFiles: string[]
  impactedSteps: string[]
  risk: "low" | "medium" | "high"
}

export class DependencyTracker {
  private fileChanges = new Map<string, FileChange[]>()
  private dependencies = new Map<string, DependencyEdge[]>()
  private stepFiles = new Map<string, Map<string, string[]>>()

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

    const sessionFiles = this.stepFiles.get(sessionId) ?? new Map()
    const existing = sessionFiles.get(stepId) ?? []
    sessionFiles.set(stepId, [...new Set([...existing, ...files])])
    this.stepFiles.set(sessionId, sessionFiles)
  }

  addDependency(from: string, to: string, relation: DependencyEdge["relation"]): void {
    const edges = this.dependencies.get(from) ?? []
    const exists = edges.some(e => e.to === to && e.relation === relation)
    if (!exists) {
      edges.push({ from, to, relation })
      this.dependencies.set(from, edges)
    }
  }

  getDependencies(module: string): DependencyEdge[] {
    return this.dependencies.get(module) ?? []
  }

  getDependents(module: string): DependencyEdge[] {
    const dependents: DependencyEdge[] = []
    for (const edges of this.dependencies.values()) {
      for (const edge of edges) {
        if (edge.to === module) dependents.push(edge)
      }
    }
    return dependents
  }

  analyzeImpact(sessionId: string, changedFiles: string[]): ImpactAnalysis[] {
    const results: ImpactAnalysis[] = []
    for (const file of changedFiles) {
      const impactedFiles = this.getDependents(file).map(e => e.from)
      const sessionFiles = this.stepFiles.get(sessionId)
      const impactedSteps: string[] = []
      if (sessionFiles) {
        for (const [stepId, files] of sessionFiles) {
          const overlap = files.some(f => impactedFiles.includes(f) || f === file)
          if (overlap) impactedSteps.push(stepId)
        }
      }
      results.push({
        file,
        impactedFiles: [...new Set(impactedFiles)],
        impactedSteps: [...new Set(impactedSteps)],
        risk: impactedFiles.length > 5 ? "high" : impactedFiles.length > 2 ? "medium" : "low",
      })
    }
    return results
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

    const currentStepFiles = this.getFilesChangedByStep(sessionId, failingStepId)
    const allPreviousFiles = new Set<string>()

    for (const stepId of planSteps) {
      if (stepId === failingStepId) break
      const stepFiles = this.getFilesChangedByStep(sessionId, stepId)
      for (const f of stepFiles) allPreviousFiles.add(f)
    }

    const matchesInError: string[] = []
    for (const file of allPreviousFiles) {
      if (error.toLowerCase().includes(file.toLowerCase())) {
        matchesInError.push(file)
      }
    }

    let likelyCulprit: string | null = null
    let confidence = 0

    if (matchesInError.length > 0) {
      likelyCulprit = matchesInError[matchesInError.length - 1]
      confidence = matchesInError.length >= 2 ? 0.8 : 0.5
    } else if (previousFiles.length > 0) {
      const latestStepBefore = planSteps.slice(0, planSteps.indexOf(failingStepId)).reverse()
      for (const stepId of latestStepBefore) {
        const stepFiles = this.getFilesChangedByStep(sessionId, stepId)
        if (stepFiles.length > 0) {
          likelyCulprit = stepFiles[stepFiles.length - 1]
          confidence = 0.3
          break
        }
      }
    }

    if (currentStepFiles.length > 0 && !likelyCulprit) {
      likelyCulprit = currentStepFiles[0]
      confidence = 0.2
    }

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
      // Check both file-level and step-level impact
      const fileImpact = this.analyzeImpact(sessionId, [likelyCulprit])
      const stepImpact = this.getDependents(likelyCulprit)
      const ri = fileImpact[0]
      const combinedImpact = [...new Set([
        ...(ri?.impactedSteps ?? []),
        ...stepImpact.map(e => e.from),
      ])]

      suggestion = `Error likely originates from changes to ${likelyCulprit} (confidence: ${(confidence * 100).toFixed(0)}%).`
      if (combinedImpact.length > 0) {
        suggestion += ` Impacts: ${combinedImpact.join(", ")}.`
      }
      suggestion += ` Review this file first, then check propagation.`
    } else if (propagationPath.length > 0) {
      suggestion = `Error may have propagated from earlier steps: ${propagationPath.join(", ")}. Check those changes for side effects.`
    } else {
      suggestion = "Unable to trace error source with confidence. Review the most recent changes manually and consider adding dependency tracking."
    }

    return { likelyCulprit, affectedSteps: [...new Set(affectedSteps)], propagationPath, suggestion, rootCauseConfidence: confidence }
  }

  clear(sessionId?: string): void {
    if (sessionId) {
      this.fileChanges.delete(sessionId)
      this.stepFiles.delete(sessionId)
    } else {
      this.fileChanges.clear()
      this.dependencies.clear()
      this.stepFiles.clear()
    }
  }
}
