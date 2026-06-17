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
  private blockEnforcement = true

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

    // File deletion
    if (action.includes("delete") || action.includes("remove")) {
      if (filesModified.some(f => f.endsWith(".ts") || f.endsWith(".tsx") || f.endsWith(".js") || f.endsWith(".py") || f.endsWith(".go") || f.endsWith(".rs"))) {
        results.push({
          id: `${stepId}-delete`,
          type: "warning",
          description: `Deleting source files: ${filesModified.filter(f => f.match(/\.(ts|js|tsx|py|go|rs)$/)).join(", ")}`,
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

    // Critical infrastructure — only block actual config/secret files, not source code that happens to have "config" in the name
    const configPatterns = [/\.env(\..*)?$/i, /credentials/i, /secret/i, /config\.(json|yaml|yml|toml|ini|conf|cfg)$/i, /\.config\.(js|ts|mjs|cjs)$/i]
    for (const file of filesModified) {
      if (configPatterns.some(p => p.test(file))) {
        results.push({
          id: `${stepId}-config-${file.replace(/[^a-zA-Z0-9]/g, "-")}`,
          type: "block",
          description: `Configuration/secret file changed: ${file}`,
          context: "⚠️ Manual review required for config/env/secret changes. Acknowledge with agentic_execute to proceed.",
          timestamp: new Date().toISOString(),
          acknowledged: false,
        })
      }

      const highRiskPatterns = ["/etc/", "/var/", "/boot/", "/usr/lib", "/lib/systemd", ".ssh/", ".gnupg/", ".aws/credentials", ".kube/config"]
      for (const risky of highRiskPatterns) {
        if (file.includes(risky)) {
          results.push({
            id: `${stepId}-system-${file.replace(/[^a-zA-Z0-9]/g, "-")}`,
            type: "block",
            description: `System-critical path modified: ${file}`,
            context: "⚠️ System-level file changes require explicit approval.",
            timestamp: new Date().toISOString(),
            acknowledged: false,
          })
        }
      }
    }

    // Test-only changes without source changes
    const onlyTests = filesModified.every(f => f.includes(".test.") || f.includes(".spec.") || f.includes("_test."))
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

    // Schema or migration files
    for (const file of filesModified) {
      if (file.includes("schema") || file.includes("migration") || file.includes(".sql")) {
        results.push({
          id: `${stepId}-schema-${file.replace(/[^a-zA-Z0-9]/g, "-")}`,
          type: "review",
          description: `Schema/migration file changed: ${file}`,
          context: "Database or data schema changes should be reviewed for backward compatibility.",
          timestamp: new Date().toISOString(),
          acknowledged: false,
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
