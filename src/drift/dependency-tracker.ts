import { existsSync } from "node:fs"
import { join, relative, dirname } from "node:path"

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

export interface CircularDependency {
  cycle: string[]
  participants: string[]
}

export class DependencyTracker {
  private fileChanges = new Map<string, FileChange[]>()
  private dependencies = new Map<string, DependencyEdge[]>()
  private stepFiles = new Map<string, Map<string, string[]>>()
  private fileGraph = new Map<string, Set<string>>()
  private statCache = new Map<string, boolean>()

  // ── File-level import parsing ──

  parseImports(content: string): string[] {
    const imports: string[] = []
    const seen = new Set<string>()
    const normalized = content.replace(/\r\n/g, "\n")

    const importRegex = /(?:import\s+(?:(?:\{[^}]*\}|[^;{]+?)\s+from\s+|)\s*["'`]|export\s+(?:\{[^}]*\}|\*)\s+from\s+["'`])([^"'`]+)["'`]/g
    const multiLineImportRegex = /import\s*\{[\s\S]*?\}\s*from\s*["'`]([^"'`]+)["'`]/g
    const typeImportRegex = /import\s+type\s+\{[\s\S]*?\}\s*from\s*["'`]([^"'`]+)["'`]/g
    const requireRegex = /(?:require|import)\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g
    const dynamicImportRegex = /import\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g

    for (const match of normalized.matchAll(importRegex)) {
      const raw = match[1]
      if (raw && !seen.has(raw)) { seen.add(raw); imports.push(raw) }
    }
    for (const match of normalized.matchAll(multiLineImportRegex)) {
      const raw = match[1]
      if (raw && !seen.has(raw)) { seen.add(raw); imports.push(raw) }
    }
    for (const match of normalized.matchAll(typeImportRegex)) {
      const raw = match[1]
      if (raw && !seen.has(raw)) { seen.add(raw); imports.push(raw) }
    }
    for (const match of normalized.matchAll(requireRegex)) {
      const raw = match[1]
      if (raw && !seen.has(raw)) { seen.add(raw); imports.push(raw) }
    }
    for (const match of normalized.matchAll(dynamicImportRegex)) {
      const raw = match[1]
      if (raw && !seen.has(raw)) { seen.add(raw); imports.push(raw) }
    }

    return imports
  }

  resolveImportPath(sourceFile: string, specifier: string): string[] {
    if (specifier.startsWith("node:")) return []
    if (!specifier.startsWith(".")) return []
    const sourceDir = dirname(sourceFile)
    const base = join(sourceDir, specifier).replace(/\\/g, "/")
    const withoutExt = base.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, "")
    const extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]

    const candidates: string[] = []
    candidates.push(base)
    for (const ext of extensions) {
      if (!base.endsWith(ext)) candidates.push(withoutExt + ext)
    }
    for (const ext of extensions) {
      candidates.push(join(withoutExt, "index") + ext)
    }

    return candidates
  }

  scanFiles(files: Record<string, string>, projectDir: string): void {
    for (const [absPath, content] of Object.entries(files)) {
      const allImportSpecifiers = this.parseImports(content)
      const localSpecifiers = allImportSpecifiers.filter(s => s.startsWith("."))

      if (localSpecifiers.length === 0) continue

      const sourceRel = relative(projectDir, absPath).replace(/\\/g, "/")
      const resolvedTargets: string[] = []

      for (const spec of localSpecifiers) {
        const candidates = this.resolveImportPath(absPath, spec)
        for (const cand of candidates) {
          let exists = this.statCache.get(cand)
          if (exists === undefined) {
            exists = existsSync(cand)
            this.statCache.set(cand, exists)
          }
          if (exists) {
            const targetRel = relative(projectDir, cand).replace(/\\/g, "/")
            resolvedTargets.push(targetRel)
            break
          }
        }
      }

      if (resolvedTargets.length > 0) {
        const existing = this.fileGraph.get(sourceRel) ?? new Set()
        for (const t of resolvedTargets) {
          existing.add(t)
          this.addDependency(sourceRel, t, "imports")
        }
        this.fileGraph.set(sourceRel, existing)
      }
    }
  }

  getFileDependents(filePath: string): string[] {
    const normalized = filePath.replace(/\\/g, "/")
    const result: string[] = []
    for (const [source, targets] of this.fileGraph) {
      for (const t of targets) {
        if (t === normalized) {
          result.push(source)
          break
        }
      }
    }
    return [...new Set(result)]
  }

  updateFile(absPath: string, content: string, projectDir: string): void {
    const relPath = relative(projectDir, absPath).replace(/\\/g, "/")
    this.fileGraph.delete(relPath)
    this.dependencies.delete(relPath)

    for (const [_src, targets] of this.fileGraph) {
      if (targets.has(relPath)) {
        targets.delete(relPath)
      }
    }

    if (!existsSync(absPath)) return

    this.scanFiles({ [absPath]: content }, projectDir)
  }

  getFileImports(filePath: string): string[] {
    const normalized = filePath.replace(/\\/g, "/")
    return [...(this.fileGraph.get(normalized) ?? [])]
  }

  private getTransitiveDependents(file: string, visited?: Set<string>): string[] {
    const visitedSet = visited ?? new Set<string>()
    if (visitedSet.has(file)) return []
    visitedSet.add(file)
    const direct = this.getFileDependents(file)
    const all = [...direct]
    for (const d of direct) {
      all.push(...this.getTransitiveDependents(d, visitedSet))
    }
    return all
  }

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

  private recencyWeight(timestamp: number, now: number): number {
    const ageMs = now - timestamp
    const halfLifeMs = 120_000
    return Math.exp(-ageMs / halfLifeMs)
  }

  analyzeImpact(sessionId: string, changedFiles: string[]): ImpactAnalysis[] {
    const now = Date.now()
    const results: ImpactAnalysis[] = []
    for (const file of changedFiles) {
      const stepDeps = this.getDependents(file).map(e => e.from)
      const fileDeps = this.getFileDependents(file)
      const transitiveDeps = this.getTransitiveDependents(file)
      const combinedFiles = [...new Set([...stepDeps, ...fileDeps, ...transitiveDeps])]

      const sessionFiles = this.stepFiles.get(sessionId)
      const impactedSteps: string[] = []
      if (sessionFiles) {
        for (const [stepId, files] of sessionFiles) {
          const overlap = files.some(f => combinedFiles.includes(f) || f === file)
          if (overlap) impactedSteps.push(stepId)
        }
      }

      const changes = this.fileChanges.get(sessionId) ?? []
      const weightedImpact = changes
        .filter(c => c.file === file)
        .reduce((sum, c) => sum + this.recencyWeight(c.timestamp, now), 0)

      const significantDeps = combinedFiles.filter(f => {
        const depChanges = changes.filter(c => c.file === f)
        return depChanges.some(c => this.recencyWeight(c.timestamp, now) > 0.3)
      })

      results.push({
        file,
        impactedFiles: significantDeps.length > 0 ? significantDeps : combinedFiles,
        impactedSteps: [...new Set(impactedSteps)],
        risk: combinedFiles.length > 5 || weightedImpact > 3 ? "high" : combinedFiles.length > 2 ? "medium" : "low",
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

    const previousStepIds = new Set(planSteps.slice(0, currentIdx))

    const changes = this.fileChanges.get(sessionId) ?? []
    const files = new Set<string>()
    for (const c of changes) {
      if (previousStepIds.has(c.stepId)) {
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
      const escaped = file.replace(/[/\-\\^$*+?.()|[\]{}]/g, "\\$&")
      if (new RegExp(`\\b${escaped}\\b`, "i").test(error)) {
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
      const hasOverlap = changedFiles.some(f => {
        const escaped = f.replace(/[/\-\\^$*+?.()|[\]{}]/g, "\\$&")
        return new RegExp(`\\b${escaped}\\b`, "i").test(error)
      })
      if (hasOverlap || changedFiles.length > 0) {
        propagationPath.push(stepId)
      }
    }

    let suggestion = ""
    if (likelyCulprit) {
      const fileImpact = this.analyzeImpact(sessionId, [likelyCulprit])
      const stepImpact = this.getDependents(likelyCulprit)
      const ri = fileImpact[0]
      const combinedImpact = [...new Set([
        ...(ri?.impactedSteps ?? []),
        ...stepImpact.map(e => e.from),
      ])]

      const fileLevelDeps = this.getFileDependents(likelyCulprit)
      suggestion = `Error likely originates from changes to ${likelyCulprit} (confidence: ${(confidence * 100).toFixed(0)}%).`
      if (combinedImpact.length > 0) {
        suggestion += ` Step impacts: ${combinedImpact.join(", ")}.`
      }
      if (fileLevelDeps.length > 0) {
        suggestion += ` File-level dependents: ${fileLevelDeps.join(", ")}.`
      }
      suggestion += ` Review this file first, then check propagation.`
    } else if (propagationPath.length > 0) {
      suggestion = `Error may have propagated from earlier steps: ${propagationPath.join(", ")}. Check those changes for side effects.`
    } else {
      suggestion = "Unable to trace error source with confidence. Review the most recent changes manually and consider adding dependency tracking."
    }

    return { likelyCulprit, affectedSteps: [...new Set(affectedSteps)], propagationPath, suggestion, rootCauseConfidence: confidence }
  }

  // ── Tarjan's SCC Algorithm for Circular Dependency Detection ──

  detectCircularDependencies(): CircularDependency[] {
    const graph = new Map<string, string[]>()
    for (const [src, targets] of this.fileGraph) {
      graph.set(src, [...targets])
    }

    const indexMap = new Map<string, number>()
    const lowLink = new Map<string, number>()
    const onStack = new Set<string>()
    const stack: string[] = []
    let index = 0
    const sccs: string[][] = []

    const strongConnect = (v: string): void => {
      indexMap.set(v, index)
      lowLink.set(v, index)
      index++
      stack.push(v)
      onStack.add(v)

      const neighbors = graph.get(v) ?? []
      for (const w of neighbors) {
        if (!indexMap.has(w)) {
          strongConnect(w)
          lowLink.set(v, Math.min(lowLink.get(v)!, lowLink.get(w)!))
        } else if (onStack.has(w)) {
          lowLink.set(v, Math.min(lowLink.get(v)!, indexMap.get(w)!))
        }
      }

      if (lowLink.get(v) === indexMap.get(v)) {
        const scc: string[] = []
        let w: string | undefined
        do {
          w = stack.pop()!
          onStack.delete(w)
          scc.push(w)
        } while (w !== v)
        if (scc.length > 1) sccs.push(scc)
      }
    }

    for (const v of graph.keys()) {
      if (!indexMap.has(v)) strongConnect(v)
    }

    return sccs.map(scc => ({
      cycle: scc,
      participants: [...new Set(scc.flatMap(n => [n, ...(graph.get(n) ?? []).filter(m => scc.includes(m))]))],
    }))
  }

  clear(sessionId?: string): void {
    if (sessionId) {
      this.fileChanges.delete(sessionId)
      this.stepFiles.delete(sessionId)
    } else {
      this.fileChanges.clear()
      this.dependencies.clear()
      this.stepFiles.clear()
      this.fileGraph.clear()
      this.statCache.clear()
    }
  }
}
