import type { MacroPhase } from "./planner.js"

/**
 * Compute a valid topological order for phases using Kahn's algorithm.
 */
export function computePhaseOrder(phases: MacroPhase[]): string[] {
  const inDegree = new Map<string, number>()
  const adj = new Map<string, string[]>()
  for (const p of phases) {
    inDegree.set(p.id, 0)
    adj.set(p.id, [])
  }
  for (const p of phases) {
    for (const dep of p.dependsOn) {
      if (adj.has(dep)) {
        adj.get(dep)!.push(p.id)
        inDegree.set(p.id, (inDegree.get(p.id) ?? 0) + 1)
      }
    }
  }
  const queue: string[] = []
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id)
  }
  const order: string[] = []
  while (queue.length > 0) {
    const id = queue.shift()!
    order.push(id)
    for (const next of adj.get(id) ?? []) {
      const newDeg = (inDegree.get(next) ?? 1) - 1
      inDegree.set(next, newDeg)
      if (newDeg === 0) queue.push(next)
    }
  }
  return order
}

/**
 * Compute a numeric score (0-1) for a subgoal based on issues found.
 */
export function computeSubgoalScore(issues: string[], stepCount: number): number {
  let score = 1.0

  // Deduct for issues
  score -= issues.length * 0.15

  // Penalty for too few or too many steps
  if (stepCount === 0) score -= 0.5
  if (stepCount > 5) score -= 0.2

  return Math.max(0, Math.min(1, score))
}
