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

export class DependencyTracker {
  private fileChanges = new Map<string, FileChange[]>()
  private dependencies = new Map<string, DependencyEdge[]>()
  private stepFiles = new Map<string, Map<string, string[]>>()
  private fileGraph = new Map<string, Set<string>>()
  private statCache = new Map<string, boolean>()

  // ── File-level import parsing ──

  /**
   * Parse import/require statements from file content.
   * Supports: import x from "y", import { x } from "y", import * as x from "y",
   *           const x = require("y"), dynamic import(), re-exports.
   */
  parseImports(content: string): string[] {
    const imports: string[] = []
    const seen = new Set<string>()

    // Normalize line breaks for multi-line imports
    const normalized = content.replace(/\r\n/g, "\n")

    // Single-line ESM import + export from
    const importRegex = /(?:import\s+(?:(?:\{[^}]*\}|[^;{]+?)\s+from\s+|)\s*["'`]|export\s+(?:\{[^}]*\}|\*)\s+from\s+["'`])([^"'`]+)["'`]/g
    // Multi-line import: import { ...\n ... } from "module"
    const multiLineImportRegex = /import\s*\{[\s\S]*?\}\s*from\s*["'`]([^"'`]+)["'`]/g
    // import type { ... } from "module"
    const typeImportRegex = /import\s+type\s+\{[\s\S]*?\}\s*from\s*["'`]([^"'`]+)["'`]/g
    // require() calls
    const requireRegex = /(?:require|import)\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g
    // dynamic import() (template literals with static parts)
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

  /**
   * Resolve a relative import specifier to possible filesystem paths.
   * Also handles node: prefix, @scope/package, and package.json exports.
   */
  resolveImportPath(sourceFile: string, specifier: string): string[] {
    // Handle node: prefix — skip to built-in module
    if (specifier.startsWith("node:")) return []
    // Handle @scope/package or bare package — skip
    if (!specifier.startsWith(".")) return []
    const sourceDir = dirname(sourceFile)
    const base = join(sourceDir, specifier).replace(/\\/g, "/")

    // Remove known extension if present
    const withoutExt = base.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, "")
    const extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]

    const candidates: string[] = []
    // Try exact path first
    candidates.push(base)
    // Try with/extensions
    for (const ext of extensions) {
      if (!base.endsWith(ext)) candidates.push(withoutExt + ext)
    }
    // Try as index file in directory
    for (const ext of extensions) {
      candidates.push(join(withoutExt, "index") + ext)
    }

    return candidates
  }

  /**
   * Scan a batch of files and build the file-level dependency graph.
   * Only processes relative imports (local files), skips npm packages.
   *
   * @param files  Record<absoluteFilePath, fileContent>
   * @param projectDir  Project root for computing relative paths
   */
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
            break // first existing resolution wins
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

  /**
   * Get files that directly import the given file (via file-level graph).
   */
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

  /**
   * Incrementally update the file graph for a single file (e.g., after creation/modification).
   * Re-parses imports and replaces the entry in the graph.
   */
  updateFile(absPath: string, content: string, projectDir: string): void {
    const relPath = relative(projectDir, absPath).replace(/\\/g, "/")
    // Remove old entries for this file
    this.fileGraph.delete(relPath)
    this.dependencies.delete(relPath)
    // Remove old edges where this file was the target
    for (const [_src, targets] of this.fileGraph) {
      if (targets.has(relPath)) {
        targets.delete(relPath)
      }
    }
    // Re-scan
    this.scanFiles({ [absPath]: content }, projectDir)
  }

  /**
   * Get files that a given file directly imports (via file-level graph).
   */
  getFileImports(filePath: string): string[] {
    const normalized = filePath.replace(/\\/g, "/")
    return [...(this.fileGraph.get(normalized) ?? [])]
  }

  /**
   * Traverse transitive dependents (A imports B imports C → change C impacts A).
   */
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

  analyzeImpact(sessionId: string, changedFiles: string[]): ImpactAnalysis[] {
    const results: ImpactAnalysis[] = []
    for (const file of changedFiles) {
      // Combine step-level + file-level dependents
      const stepDeps = this.getDependents(file).map(e => e.from)
      const fileDeps = this.getFileDependents(file)
      const transitiveDeps = this.getTransitiveDependents(file)
      const combinedFiles = [...new Set([...stepDeps, ...fileDeps, ...transitiveDeps])]

      // Map back to steps
      const sessionFiles = this.stepFiles.get(sessionId)
      const impactedSteps: string[] = []
      if (sessionFiles) {
        for (const [stepId, files] of sessionFiles) {
          const overlap = files.some(f => combinedFiles.includes(f) || f === file)
          if (overlap) impactedSteps.push(stepId)
        }
      }

      results.push({
        file,
        impactedFiles: combinedFiles,
        impactedSteps: [...new Set(impactedSteps)],
        risk: combinedFiles.length > 5 ? "high" : combinedFiles.length > 2 ? "medium" : "low",
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

    // Build a set of step IDs that come before the current step for O(1) lookup
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
      // Check both file-level and step-level impact
      const fileImpact = this.analyzeImpact(sessionId, [likelyCulprit])
      const stepImpact = this.getDependents(likelyCulprit)
      const ri = fileImpact[0]
      const combinedImpact = [...new Set([
        ...(ri?.impactedSteps ?? []),
        ...stepImpact.map(e => e.from),
      ])]

      // Include file-level dependents in suggestion
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

  clear(sessionId?: string): void {
    if (sessionId) {
      this.fileChanges.delete(sessionId)
      this.stepFiles.delete(sessionId)
    } else {
      this.fileChanges.clear()
      this.dependencies.clear()
      this.stepFiles.clear()
      this.fileGraph.clear()
    }
  }
}
