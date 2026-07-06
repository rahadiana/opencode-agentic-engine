import { realpathSync, readFileSync } from "node:fs"

export interface Checkpoint {
  id: string
  type: "warning" | "review" | "block"
  description: string
  context: string
  timestamp: string
  acknowledged: boolean
  expiresAt: number
}

export class CheckpointSystem {
  private checkpoints = new Map<string, Checkpoint[]>()
  private blockEnforcement = true
  private ttlMs: number

  constructor(ttlMs = 300_000) {
    this.ttlMs = ttlMs
  }

  setTTL(ms: number): void {
    this.ttlMs = ms
  }

  enableBlockEnforcement(enabled: boolean): void {
    this.blockEnforcement = enabled
  }

  isBlocked(): { blocked: boolean; reason?: string } {
    if (!this.blockEnforcement) return { blocked: false }
    const unacknowledged = this.getUnacknowledged()
    const blocker = unacknowledged.find(c => c.type === "block")
    if (blocker) {
      return {
        blocked: true,
        reason: `Blocked by checkpoint "${blocker.id}": ${blocker.description}. Acknowledge to proceed.`,
      }
    }
    return { blocked: false }
  }

  evaluate(stepId: string, action: string, filesModified: string[]): Checkpoint[] {
    const results: Checkpoint[] = []
    const now = Date.now()
    const expiresAt = now + this.ttlMs

    if (/\bdelete\b/i.test(action) || /\bremove\b/i.test(action)) {
      if (filesModified.some(f => /\.(ts|tsx|js|py|go|rs)$/i.test(f))) {
        results.push({
          id: `${stepId}-delete`,
          type: "warning",
          description: `Deleting source files: ${filesModified.filter(f => /\.(ts|js|tsx|py|go|rs)$/i.test(f)).join(", ")}`,
          context: "Deleted files may break imports in other modules.",
          timestamp: new Date().toISOString(),
          acknowledged: false,
          expiresAt,
        })
      }
    }

    if (filesModified.length > 5) {
      results.push({
        id: `${stepId}-scope`,
        type: "review",
        description: `Modifying ${filesModified.length} files in one step`,
        context: "Large change sets increase risk of merge conflicts and regressions.",
        timestamp: new Date().toISOString(),
        acknowledged: false,
        expiresAt,
      })
    }

    if (/\bexport\b/i.test(action) || /\binterface\b/i.test(action) || /\bapi\b/i.test(action)) {
      results.push({
        id: `${stepId}-api`,
        type: "review",
        description: "Public API or interface change detected",
        context: "API contract changes may affect consumers. Document the change.",
        timestamp: new Date().toISOString(),
        acknowledged: false,
        expiresAt,
      })
    }

    const configPatterns = [/\.env(\..*)?$/i, /credentials/i, /secret/i, /config\.(json|yaml|yml|toml|ini|conf|cfg)$/i, /\.config\.(js|ts|mjs|cjs)$/i]
    const highRiskDirPatterns = [/\/etc\//, /\/var\//, /\/boot\//, /\/usr\/lib/, /\/lib\/systemd/, /\.ssh\//, /\.gnupg\//, /\.aws\/credentials/, /\.kube\/config/]

    for (const file of filesModified) {
      let canonical: string
      try {
        canonical = realpathSync(file)
      } catch {
        canonical = file
      }

      if (configPatterns.some(p => p.test(canonical))) {
        results.push({
          id: `${stepId}-config-${file.replace(/[^a-zA-Z0-9]/g, "-")}`,
          type: "block",
          description: `Configuration/secret file changed: ${file}`,
          context: "Manual review required for config/env/secret changes.",
          timestamp: new Date().toISOString(),
          acknowledged: false,
          expiresAt,
        })
      }

      if (highRiskDirPatterns.some(p => p.test(canonical))) {
        results.push({
          id: `${stepId}-system-${file.replace(/[^a-zA-Z0-9]/g, "-")}`,
          type: "block",
          description: `System-critical path modified: ${file}`,
          context: "System-level file changes require explicit approval.",
          timestamp: new Date().toISOString(),
          acknowledged: false,
          expiresAt,
        })
      }

      if (/\.(ts|js|tsx|jsx|py|go|rs)$/i.test(canonical)) {
        try {
          const content = readFileSync(canonical, "utf-8")
          if (/\b(export|function|class|interface)\b/.test(action) && content) {
            const exportMatches = content.match(/^\s*export\s+(?:default\s+)?(?:function|class|const|let|var|interface|type)\s+\w+/gm)
            if (exportMatches && exportMatches.length > 0) {
              results.push({
                id: `${stepId}-api-content-${file.replace(/[^a-zA-Z0-9]/g, "-")}`,
                type: "review",
                description: `Public API changes detected in ${file}: ${exportMatches.slice(0, 3).join(", ")}${exportMatches.length > 3 ? ` (+${exportMatches.length - 3} more)` : ""}`,
                context: "Content analysis confirms API signature changes. Verify backward compatibility.",
                timestamp: new Date().toISOString(),
                acknowledged: false,
                expiresAt,
              })
            }
          }
        } catch { console.warn("catch: skip unreadable") }
      }
    }

    const onlyTests = filesModified.every(f => /\.test\./i.test(f) || /\.spec\./i.test(f) || /_test\./i.test(f))
    if (onlyTests && filesModified.length > 0) {
      results.push({
        id: `${stepId}-tests-only`,
        type: "warning",
        description: "Only test files modified — no production code changed",
        context: "Verify tests are testing real scenarios, not just passing.",
        timestamp: new Date().toISOString(),
        acknowledged: false,
        expiresAt,
      })
    }

    for (const file of filesModified) {
      if (/\bschema\b/i.test(file) || /\bmigration\b/i.test(file) || /\.sql$/i.test(file)) {
        results.push({
          id: `${stepId}-schema-${file.replace(/[^a-zA-Z0-9]/g, "-")}`,
          type: "review",
          description: `Schema/migration file changed: ${file}`,
          context: "Database or data schema changes should be reviewed for backward compatibility.",
          timestamp: new Date().toISOString(),
          acknowledged: false,
          expiresAt,
        })
      }
    }

    this.checkpoints.set(stepId, results)
    return results
  }

  acknowledge(stepId: string, checkpointId: string): boolean {
    const cps = this.checkpoints.get(stepId)
    if (!cps) return false
    const cp = cps.find(c => c.id === checkpointId)
    if (!cp) return false
    cp.acknowledged = true
    return true
  }

  acknowledgeAll(stepId: string): number {
    const cps = this.checkpoints.get(stepId)
    if (!cps) return 0
    let count = 0
    for (const cp of cps) {
      if (!cp.acknowledged) {
        cp.acknowledged = true
        count++
      }
    }
    return count
  }

  getUnacknowledged(stepId?: string): Checkpoint[] {
    const now = Date.now()
    const all: Checkpoint[] = []
    if (stepId) {
      const cps = this.checkpoints.get(stepId)
      if (cps) all.push(...cps.filter(c => !c.acknowledged && c.expiresAt > now))
    } else {
      for (const cps of this.checkpoints.values()) {
        all.push(...cps.filter(c => !c.acknowledged && c.expiresAt > now))
      }
    }
    return all
  }

  hasBlockers(): boolean {
    return this.getUnacknowledged().some(c => c.type === "block")
  }

  hasCyclicDependencies(): string[] {
    const adjacency = new Map<string, Set<string>>()
    for (const [stepId, cps] of this.checkpoints) {
      const deps = new Set<string>()
      for (const cp of cps) {
        const depMatch = cp.description.match(/depends on (\S+)/i)
        if (depMatch) deps.add(depMatch[1])
      }
      if (deps.size > 0) adjacency.set(stepId, deps)
    }

    const visited = new Set<string>()
    const recStack = new Set<string>()
    const cycles: string[] = []

    const dfs = (node: string): boolean => {
      if (recStack.has(node)) return true
      if (visited.has(node)) return false
      visited.add(node)
      recStack.add(node)
      const neighbors = adjacency.get(node)
      if (neighbors) {
        for (const n of neighbors) {
          if (dfs(n)) {
            cycles.push(`Cycle detected involving step: ${node} → ${n}`)
            return true
          }
        }
      }
      recStack.delete(node)
      return false
    }

    for (const node of adjacency.keys()) {
      if (!visited.has(node)) dfs(node)
    }

    return cycles
  }
}
