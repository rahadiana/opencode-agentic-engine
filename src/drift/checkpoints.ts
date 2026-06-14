export interface Checkpoint {
  id: string
  type: "warning" | "review" | "block"
  description: string
  context: string
  timestamp: string
  acknowledged: boolean
}

export class CheckpointSystem {
  private checkpoints = new Map<string, Checkpoint[]>()

  evaluate(stepId: string, action: string, filesModified: string[]): Checkpoint[] {
    const results: Checkpoint[] = []

    // File deletion
    if (action.includes("delete") || action.includes("remove")) {
      if (filesModified.some(f => f.endsWith(".ts") || f.endsWith(".js"))) {
        results.push({
          id: `${stepId}-delete`,
          type: "warning",
          description: `Deleting source files: ${filesModified.filter(f => f.match(/\.(ts|js|tsx)$/)).join(", ")}`,
          context: "Deleted files may break imports in other modules.",
          timestamp: new Date().toISOString(),
          acknowledged: false,
        })
      }
    }

    // Large change set
    if (filesModified.length > 5) {
      results.push({
        id: `${stepId}-scope`,
        type: "review",
        description: `Modifying ${filesModified.length} files in one step`,
        context: "Large change sets increase risk of merge conflicts and regressions.",
        timestamp: new Date().toISOString(),
        acknowledged: false,
      })
    }

    // API contract change
    if (action.toLowerCase().includes("export") || action.toLowerCase().includes("interface") || action.toLowerCase().includes("api")) {
      results.push({
        id: `${stepId}-api`,
        type: "review",
        description: "Public API or interface change detected",
        context: "API contract changes may affect consumers. Document the change.",
        timestamp: new Date().toISOString(),
        acknowledged: false,
      })
    }

    // Critical infrastructure
    for (const file of filesModified) {
      if (file.includes("config") || file.includes("env") || file.includes("secret")) {
        results.push({
          id: `${stepId}-config`,
          type: "block",
          description: `Configuration file changed: ${file}`,
          context: "⚠️ Manual review required for config/env changes.",
          timestamp: new Date().toISOString(),
          acknowledged: false,
        })
      }
    }

    // Test-only changes without source changes
    const onlyTests = filesModified.every(f => f.includes(".test.") || f.includes(".spec."))
    if (onlyTests && filesModified.length > 0) {
      results.push({
        id: `${stepId}-tests-only`,
        type: "warning",
        description: "Only test files modified — no production code changed",
        context: "Verify tests are testing real scenarios, not just passing.",
        timestamp: new Date().toISOString(),
        acknowledged: false,
      })
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

  getUnacknowledged(): Checkpoint[] {
    const all: Checkpoint[] = []
    for (const cps of this.checkpoints.values()) {
      all.push(...cps.filter(c => !c.acknowledged))
    }
    return all
  }

  hasBlockers(): boolean {
    return this.getUnacknowledged().some(c => c.type === "block")
  }
}
