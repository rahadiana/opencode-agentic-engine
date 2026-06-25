/**
 * ConstraintManifold — Safety-by-Design enforcement for agentic workflows.
 *
 * Implements proactive constraint validation inspired by:
 * - Auton (arXiv:2602.23720): cognitive blueprint with safety constraints
 * - STEM Agent (arXiv:2603.22359): multi-protocol safety gateway
 * - Omnigent: circuit breaker + rate limiting + loop detection
 *
 * Unlike post-hoc filtering, ConstraintManifold validates actions BEFORE
 * they execute, providing a safety layer that is by-design, not bolted-on.
 *
 * Phase 4C: Safety by Design — Plan #26
 */

// ── Types ──────────────────────────────────────────────────────

/** Categories of safety constraints */
export type ConstraintCategory =
  | "file_safety"
  | "budget"
  | "resource"
  | "circuit_breaker"
  | "invariant"
  | "dependency"
  | "other"

/** Severity levels for violations */
export type ConstraintSeverity = "warning" | "error" | "critical"

/** A single constraint violation record */
export interface ConstraintViolation {
  category: ConstraintCategory
  severity: ConstraintSeverity
  message: string
  timestamp: number
  fileId?: string
}

/** Result of validating an action against constraints */
export interface ConstraintCheck {
  passed: boolean
  violations: ConstraintViolation[]
}

/** Safety policy configuration */
export interface SafetyPolicy {
  /** Block file deletion operations */
  blockFileDeletion: boolean
  /** Maximum tokens allowed per action */
  maxTokensPerAction: number
  /** Maximum files affected per action */
  maxFilesPerAction: number
  /** Maximum concurrent modifications */
  maxModifications: number
  /** Circuit breaker trip threshold (number of consecutive violations) */
  circuitBreakerThreshold: number
  /** Protected file patterns that cannot be written */
  protectedPaths: string[]
  /** Dangerous shell command patterns */
  dangerousCommands: string[]
}

/** An action proposed by the agent */
export interface ActionProposal {
  /** Action type: file_write, file_edit, file_delete, shell_exec, etc. */
  type: string
  /** Target file or resource */
  target: string
  /** Human-readable description */
  description: string
  /** Estimated tokens for this action */
  estimatedTokens?: number
  /** Number of files affected */
  estimatedFilesAffected?: number
  /** Shell command (for shell_exec type) */
  command?: string
}

/** Configuration for ConstraintManifold */
export interface ConstraintConfig {
  /** Partial policy overrides */
  policies?: Partial<SafetyPolicy>
  /** Categories to enable (default: all) */
  enabledCategories?: ConstraintCategory[]
  /** Maximum violations to keep in history */
  maxRecentViolations?: number
}

// ── Default Policies ───────────────────────────────────────────

const DEFAULT_POLICY: SafetyPolicy = {
  blockFileDeletion: true,
  maxTokensPerAction: 100000,
  maxFilesPerAction: 20,
  maxModifications: 5,
  circuitBreakerThreshold: 10,
  protectedPaths: [
    ".env",
    ".env.production",
    ".env.local",
    ".env.staging",
    ".ssh",
    ".gnupg",
    "id_rsa",
    "id_ed25519",
    ".git/config",
    "/etc/",
    "/usr/bin/",
    "/bin/",
    "/sbin/",
  ],
  dangerousCommands: [
    "rm -rf /",
    "rm -rf /*",
    "rm -rf ~",
    "rm -rf ~/",
    "mkfs",
    "dd if=",
    "format",
    ":(){ :|:& };:",
    "chmod -R 777 /",
    "chown -R",
    "> /dev/sda",
    "shutdown",
    "reboot",
    "halt",
    "init 0",
    "init 6",
  ],
}

// ── ConstraintManifold Class ───────────────────────────────────

export class ConstraintManifold {
  private policy: SafetyPolicy
  private enabledCategories: Set<ConstraintCategory>
  private recentViolations: ConstraintViolation[]
  private activeModifications: Set<string>
  private violationCount: number
  private consecutiveViolations: number
  private maxRecentViolations: number
  private totalChecks: number

  constructor(config?: { policies?: Partial<SafetyPolicy> }) {
    this.policy = { ...DEFAULT_POLICY, ...config?.policies }
    this.enabledCategories = new Set<ConstraintCategory>([
      "file_safety",
      "budget",
      "resource",
      "circuit_breaker",
      "invariant",
      "dependency",
      "other",
    ])
    this.recentViolations = []
    this.activeModifications = new Set()
    this.violationCount = 0
    this.consecutiveViolations = 0
    this.maxRecentViolations = 100
    this.totalChecks = 0
  }

  /**
   * Validate an action against all active constraints.
   * Returns a ConstraintCheck with passed=true if safe, or passed=false with violations.
   */
  validate(action: ActionProposal): ConstraintCheck {
    this.totalChecks++
    const violations: ConstraintViolation[] = []

    // ── File Safety ──
    if (this.enabledCategories.has("file_safety")) {
      // Block file deletion if policy says so
      if (action.type === "file_delete" && this.policy.blockFileDeletion) {
        violations.push({
          category: "file_safety",
          severity: "error",
          message: `File deletion blocked: ${action.target}`,
          timestamp: Date.now(),
          fileId: action.target,
        })
      }

      // Block writes to protected paths
      if (action.type === "file_write" || action.type === "file_edit") {
        for (const protectedPath of this.policy.protectedPaths) {
          if (action.target.includes(protectedPath)) {
            violations.push({
              category: "file_safety",
              severity: "error",
              message: `Protected path: ${action.target} matches ${protectedPath}`,
              timestamp: Date.now(),
              fileId: action.target,
            })
            break
          }
        }
      }

      // Detect dangerous shell commands
      if (action.type === "shell_exec" && action.command) {
        for (const dangerous of this.policy.dangerousCommands) {
          if (action.command.includes(dangerous)) {
            violations.push({
              category: "file_safety",
              severity: "critical",
              message: `Dangerous command detected: ${action.command}`,
              timestamp: Date.now(),
            })
            break
          }
        }
      }
    }

    // ── Resource: Concurrent Modifications ──
    if (this.enabledCategories.has("resource")) {
      if (action.type === "file_edit" && this.activeModifications.has(action.target)) {
        violations.push({
          category: "resource",
          severity: "error",
          message: `Concurrent modification detected: ${action.target}`,
          timestamp: Date.now(),
          fileId: action.target,
        })
      }

      if (this.activeModifications.size >= this.policy.maxModifications) {
        violations.push({
          category: "resource",
          severity: "warning",
          message: `Max concurrent modifications reached: ${this.activeModifications.size}/${this.policy.maxModifications}`,
          timestamp: Date.now(),
        })
      }
    }

    // ── Budget ──
    if (this.enabledCategories.has("budget")) {
      if (action.estimatedTokens && action.estimatedTokens > this.policy.maxTokensPerAction) {
        violations.push({
          category: "budget",
          severity: "warning",
          message: `Token estimate ${action.estimatedTokens} exceeds limit ${this.policy.maxTokensPerAction}`,
          timestamp: Date.now(),
        })
      }

      if (action.estimatedFilesAffected && action.estimatedFilesAffected > this.policy.maxFilesPerAction) {
        violations.push({
          category: "budget",
          severity: "warning",
          message: `File count ${action.estimatedFilesAffected} exceeds limit ${this.policy.maxFilesPerAction}`,
          timestamp: Date.now(),
        })
      }
    }

    // ── Circuit Breaker ──
    if (this.enabledCategories.has("circuit_breaker")) {
      if (this.consecutiveViolations >= this.policy.circuitBreakerThreshold) {
        violations.push({
          category: "circuit_breaker",
          severity: "critical",
          message: `Circuit breaker tripped: ${this.consecutiveViolations} consecutive violations`,
          timestamp: Date.now(),
        })
      }
    }

    // Update tracking
    if (violations.length > 0) {
      this.violationCount += violations.length
      this.consecutiveViolations++
      this.recentViolations = [...violations, ...this.recentViolations].slice(0, this.maxRecentViolations)
    } else {
      this.consecutiveViolations = 0
    }

    const passed = !violations.some(v => v.severity === "error" || v.severity === "critical")

    return { passed, violations }
  }

  /**
   * Begin tracking a file modification.
   * While a file is in active modification, concurrent edits to the same file are blocked.
   */
  beginModification(file: string): void {
    this.activeModifications.add(file)
  }

  /**
   * End tracking a file modification.
   */
  endModification(file: string): void {
    this.activeModifications.delete(file)
  }

  /**
   * Get a snapshot of the current constraint state.
   */
  snapshot(): {
    violationCount: number
    enabledCategories: string[]
    policy: { blockFileDeletion: boolean; maxTokensPerAction: number; maxFilesPerAction: number }
  } {
    return {
      violationCount: this.violationCount,
      enabledCategories: [...this.enabledCategories],
      policy: {
        blockFileDeletion: this.policy.blockFileDeletion,
        maxTokensPerAction: this.policy.maxTokensPerAction,
        maxFilesPerAction: this.policy.maxFilesPerAction,
      },
    }
  }

  /**
   * Get list of files currently being modified (active modifications).
   */
  getActiveModifications(): string[] {
    return [...this.activeModifications]
  }

  /**
   * Get recent violations from the last validation checks.
   */
  getRecentViolations(): Array<{ category: string; severity: string; message: string }> {
    return this.recentViolations.map(v => ({
      category: v.category,
      severity: v.severity,
      message: v.message,
    }))
  }

  /**
   * Get the current safety policy.
   */
  getPolicy(): SafetyPolicy {
    return { ...this.policy }
  }

  /**
   * Toggle a constraint category on/off.
   */
  setCategoryEnabled(category: ConstraintCategory, enabled: boolean): void {
    if (enabled) {
      this.enabledCategories.add(category)
    } else {
      this.enabledCategories.delete(category)
    }
  }

  /**
   * Check if a category is enabled.
   */
  isCategoryEnabled(category: ConstraintCategory): boolean {
    return this.enabledCategories.has(category)
  }

  /**
   * Reset all state (for testing or session restart).
   */
  reset(): void {
    this.recentViolations = []
    this.activeModifications.clear()
    this.violationCount = 0
    this.consecutiveViolations = 0
    this.totalChecks = 0
  }

  /**
   * Get total number of checks performed.
   */
  getTotalChecks(): number {
    return this.totalChecks
  }
}
