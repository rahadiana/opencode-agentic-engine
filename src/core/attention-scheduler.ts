/**
 * AttentionScheduler — Priority-based agent scheduling with attention mechanism (Comparison 18).
 *
 * Core concepts:
 * 1. **Attention**: each agent only gets a "focus slice" of shared state (not the full blackboard)
 * 2. **Priority Scheduler**: agents registered with base priority, dynamically adjusted
 * 3. **Dynamic Priority**: urgency boost, stagnation boost (stale agents get priority lift)
 * 4. **Starvation Prevention**: cooldown after execution, aging mechanism
 * 5. **Eligibility Check**: canRun() determines if agent is eligible to execute
 *
 * Design follows best practices from multi-agent scheduling research:
 * - Multi-level priority with aging to prevent starvation
 * - Two-level fairness: agent-level then task-level
 * - Predictable O(n log n) sort-based scheduling
 */

// ── Interfaces ─────────────────────────────────────────────────────

/** Agent registration configuration */
export interface AgentScheduleConfig {
  /** Unique agent identifier */
  agentId: string
  /** Base priority (0 = lowest, 100 = highest, default: 50) */
  basePriority?: number
  /** Focus keys — which state keys this agent can "see" */
  focusKeys: string[]
  /** Cooldown cycles after execution before agent can run again (default: 1) */
  cooldown?: number
  /** Whether this agent is enabled (default: true) */
  enabled?: boolean
  /** Max consecutive runs before forced cooldown (default: 3, prevents hogging) */
  maxConsecutive?: number
}

/** Runtime state for a registered agent */
export interface AgentScheduleState {
  config: AgentScheduleConfig
  /** Current dynamic priority (base + boosts) */
  currentPriority: number
  /** Cycles since last run */
  cyclesSinceRun: number
  /** How many consecutive cycles this agent has run */
  consecutiveRuns: number
  /** Remaining cooldown cycles (decremented each cycle) */
  cooldownRemaining: number
  /** Total times this agent has been selected */
  totalRuns: number
  /** Last cycle number when this agent ran */
  lastRunCycle: number
}

/** Snapshot of shared state for attention filtering */
export interface SharedState {
  [key: string]: unknown
}

/** Result of a single scheduling cycle */
export interface CycleResult {
  /** Cycle number */
  cycle: number
  /** Agent selected to run (null if none eligible) */
  selectedAgentId: string | null
  /** Focus slice given to the selected agent */
  focusSlice: Record<string, unknown>
  /** Priority scores of all eligible agents at decision time */
  priorities: Array<{ agentId: string; priority: number }>
  /** Whether MAX_CYCLES was reached */
  maxCyclesReached: boolean
}

/** Overall scheduler metrics */
export interface SchedulerMetrics {
  totalCycles: number
  totalSelections: number
  agentStats: Array<{
    agentId: string
    totalRuns: number
    currentPriority: number
    cooldownRemaining: number
  }>
  starvationWarnings: string[]
}

// ── Constants ──────────────────────────────────────────────────────

/** Default base priority */
const DEFAULT_BASE_PRIORITY = 50

/** Default cooldown cycles after run */
const DEFAULT_COOLDOWN = 1

/** Default max consecutive runs */
const DEFAULT_MAX_CONSECUTIVE = 3

/** Maximum scheduling cycles before forced stop */
export const MAX_SCHEDULER_CYCLES = 10

/** Priority boost per cycle of stagnation (aging) */
const STAGNATION_BOOST_PER_CYCLE = 5

/** Maximum stagnation boost cap */
const MAX_STAGNATION_BOOST = 30

/** Urgency boost threshold — cycles since run beyond which urgency kicks in */
const URGENCY_THRESHOLD = 3

/** Urgency boost amount */
const URGENCY_BOOST = 10

/** How much priority is reduced per cycle after running (anti-hogging) */
const CONSECUTIVE_PENALTY = 10

/** Starvation threshold — cycles without running before warning */
const STARVATION_THRESHOLD = 8

// ── AttentionScheduler Class ───────────────────────────────────────

export class AttentionScheduler {
  private agents: Map<string, AgentScheduleState> = new Map()
  private cycleCount = 0
  private totalSelections = 0
  private starvationWarnings: string[] = []

  /**
   * Register an agent with the scheduler.
   * Each agent declares its focus keys and scheduling preferences.
   */
  registerAgent(config: AgentScheduleConfig): void {
    const state: AgentScheduleState = {
      config: {
        ...config,
        basePriority: config.basePriority ?? DEFAULT_BASE_PRIORITY,
        cooldown: config.cooldown ?? DEFAULT_COOLDOWN,
        maxConsecutive: config.maxConsecutive ?? DEFAULT_MAX_CONSECUTIVE,
        enabled: config.enabled ?? true,
      },
      currentPriority: config.basePriority ?? DEFAULT_BASE_PRIORITY,
      cyclesSinceRun: 0,
      consecutiveRuns: 0,
      cooldownRemaining: 0,
      totalRuns: 0,
      lastRunCycle: -1,
    }
    this.agents.set(config.agentId, state)
  }

  /**
   * Unregister an agent.
   */
  unregisterAgent(agentId: string): boolean {
    return this.agents.delete(agentId)
  }

  /**
   * Set or update attention focus keys for an agent.
   * Controls which parts of shared state the agent can "see".
   */
  setAttention(agentId: string, focusKeys: string[]): boolean {
    const agent = this.agents.get(agentId)
    if (!agent) return false
    agent.config.focusKeys = focusKeys
    return true
  }

  /**
   * Enable or disable an agent.
   */
  setEnabled(agentId: string, enabled: boolean): boolean {
    const agent = this.agents.get(agentId)
    if (!agent) return false
    agent.config.enabled = enabled
    return true
  }

  /**
   * Check if an agent is eligible to run in the current cycle.
   * Conditions:
   * 1. Agent must be enabled
   * 2. Cooldown must be 0
   * 3. Agent must not have exceeded maxConsecutive runs
   */
  canRun(agentId: string): boolean {
    const agent = this.agents.get(agentId)
    if (!agent) return false
    if (!agent.config.enabled) return false
    if (agent.cooldownRemaining > 0) return false
    if (agent.consecutiveRuns >= (agent.config.maxConsecutive ?? DEFAULT_MAX_CONSECUTIVE)) return false
    return true
  }

  /**
   * Compute the dynamic priority for an agent based on:
   * - Base priority (config)
   * - Stagnation boost (cycles without running)
   * - Urgency boost (if stale beyond threshold)
   * - Consecutive penalty (anti-hogging)
   */
  computePriority(agentId: string): number {
    const agent = this.agents.get(agentId)
    if (!agent) return 0

    let priority = agent.config.basePriority ?? DEFAULT_BASE_PRIORITY

    // Stagnation boost: priority increases the longer an agent hasn't run
    const cyclesSinceRun = agent.cyclesSinceRun
    if (cyclesSinceRun > 0) {
      const stagnationBoost = Math.min(
        cyclesSinceRun * STAGNATION_BOOST_PER_CYCLE,
        MAX_STAGNATION_BOOST,
      )
      priority += stagnationBoost
    }

    // Urgency boost: if agent has been waiting too long
    if (cyclesSinceRun >= URGENCY_THRESHOLD) {
      priority += URGENCY_BOOST
    }

    // Consecutive penalty: reduce priority if agent has been hogging
    if (agent.consecutiveRuns > 1) {
      priority -= (agent.consecutiveRuns - 1) * CONSECUTIVE_PENALTY
    }

    // Clamp to [0, 100]
    agent.currentPriority = Math.max(0, Math.min(100, priority))
    return agent.currentPriority
  }

  /**
   * Get the focus slice of shared state for an agent.
   * This is the "attention" mechanism — agent only sees keys it registered for.
   */
  getFocusSlice(agentId: string, state: SharedState): Record<string, unknown> {
    const agent = this.agents.get(agentId)
    if (!agent) return {}

    const slice: Record<string, unknown> = {}
    for (const key of agent.config.focusKeys) {
      if (key in state) {
        slice[key] = state[key]
      }
    }
    return slice
  }

  /**
   * Run one scheduling cycle:
   * 1. Decrement cooldowns
   * 2. Compute priorities
   * 3. Find eligible agents
   * 4. Sort by priority (highest first)
   * 5. Select highest-priority eligible agent
   * 6. Update state for selected agent
   * 7. Check for starvation warnings
   */
  runCycle(state: SharedState): CycleResult {
    this.cycleCount++

    // 1. Decrement cooldowns and increment cyclesSinceRun for all agents
    for (const agent of this.agents.values()) {
      if (agent.cooldownRemaining > 0) {
        agent.cooldownRemaining--
      }
      agent.cyclesSinceRun++
    }

    // 2. Compute priorities for all agents
    const priorities: Array<{ agentId: string; priority: number }> = []
    for (const agentId of this.agents.keys()) {
      const priority = this.computePriority(agentId)
      priorities.push({ agentId, priority })
    }

    // 3. Find eligible agents
    const eligible: Array<{ agentId: string; priority: number }> = []
    for (const p of priorities) {
      if (this.canRun(p.agentId)) {
        eligible.push(p)
      }
    }

    // 4. Sort by priority descending
    eligible.sort((a, b) => b.priority - a.priority)

    // 5. Select highest-priority eligible agent
    const selected = eligible.length > 0 ? eligible[0].agentId : null

    // 6. Update state for selected agent
    if (selected) {
      const agent = this.agents.get(selected)!
      agent.totalRuns++
      agent.consecutiveRuns++
      agent.cooldownRemaining = agent.config.cooldown ?? DEFAULT_COOLDOWN
      agent.cyclesSinceRun = 0
      agent.lastRunCycle = this.cycleCount
      this.totalSelections++
    } else {
      // No eligible agents — reset consecutive counters to prevent deadlock
      for (const agent of this.agents.values()) {
        agent.consecutiveRuns = 0
      }
    }

    // 7. Starvation check
    for (const [agentId, agent] of this.agents) {
      if (agent.cyclesSinceRun >= STARVATION_THRESHOLD && agent.config.enabled) {
        const warning = `Agent "${agentId}" has not run for ${agent.cyclesSinceRun} cycles (starvation risk)`
        if (!this.starvationWarnings.includes(warning)) {
          this.starvationWarnings.push(warning)
        }
      }
    }

    // 8. Focus slice for selected agent
    const focusSlice = selected ? this.getFocusSlice(selected, state) : {}

    const maxReached = this.cycleCount >= MAX_SCHEDULER_CYCLES

    return {
      cycle: this.cycleCount,
      selectedAgentId: selected,
      focusSlice,
      priorities: priorities.sort((a, b) => b.priority - a.priority),
      maxCyclesReached: maxReached,
    }
  }

  /**
   * Run multiple cycles until MAX_CYCLES or no eligible agents remain.
   * Returns an array of all cycle results.
   */
  runAll(state: SharedState): CycleResult[] {
    const results: CycleResult[] = []

    while (this.cycleCount < MAX_SCHEDULER_CYCLES) {
      const result = this.runCycle(state)
      results.push(result)

      // Stop if no agent was selected (no eligible agents)
      if (result.selectedAgentId === null) {
        break
      }

      // Update shared state with any focus slice changes (simulate agent work)
      // In real usage, the selected agent would modify state here
    }

    return results
  }

  /**
   * Reset the scheduler to initial state.
   */
  reset(): void {
    this.agents.clear()
    this.cycleCount = 0
    this.totalSelections = 0
    this.starvationWarnings = []
  }

  /**
   * Get scheduler metrics and stats.
   */
  getMetrics(): SchedulerMetrics {
    const agentStats: SchedulerMetrics["agentStats"] = []
    for (const [agentId, agent] of this.agents) {
      agentStats.push({
        agentId,
        totalRuns: agent.totalRuns,
        currentPriority: agent.currentPriority,
        cooldownRemaining: agent.cooldownRemaining,
      })
    }

    return {
      totalCycles: this.cycleCount,
      totalSelections: this.totalSelections,
      agentStats,
      starvationWarnings: [...this.starvationWarnings],
    }
  }

  /**
   * Get the current state of a registered agent.
   */
  getAgentState(agentId: string): AgentScheduleState | undefined {
    return this.agents.get(agentId)
  }

  /**
   * Get all registered agent IDs.
   */
  getRegisteredAgents(): string[] {
    return Array.from(this.agents.keys())
  }
}
