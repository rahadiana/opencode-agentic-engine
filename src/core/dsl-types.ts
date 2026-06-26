/**
 * DSL Types — type definitions and constants for the DSL executor.
 *
 * Extracted from dsl-executor.ts for modularity.
 */

// ── Type Definitions ──────────────────────────────────────────────

/** Supported DSL operation types */
export type DslOp = "get" | "set" | "add" | "mcp_call" | "compare" | "if" | "jump" | "call_skill" | "map" | "filter" | "reduce" | "sum" | "avg" | "count" | "min" | "max"

/** Comparison operators */
export type CompareOp = "eq" | "ne" | "gt" | "gte" | "lt" | "lte"

/** A single DSL instruction */
export interface DslInstruction {
  /** Optional step identifier */
  id?: string
  /** Operation to execute */
  op: DslOp
  /** Source path expression (get, compare left side) */
  source?: string
  /** Target path to store result (set target) */
  target?: string
  /** Literal value (set value, compare right side) */
  value?: unknown
  /** Values for add operation */
  values?: unknown[]
  /** MCP tool name (mcp_call) */
  tool?: string
  /** MCP tool parameters (mcp_call) */
  params?: Record<string, unknown>
  /** Left side of comparison (compare) */
  left?: string
  /** Comparison operator (compare) */
  operator?: CompareOp
  /** Right side of comparison (compare) */
  right?: unknown
  /** Condition reference for branching (if) */
  condition?: string
  /** Instructions to run if condition is truthy */
  then?: DslInstruction[]
  /** Instructions to run if condition is falsy */
  else?: DslInstruction[]
  /** MCP server name (mcp_call) */
  server?: string
  /** Capability or skill ID for call_skill operation */
  skill?: string
  /** Input arguments for called skill (call_skill) */
  args?: Record<string, unknown>
  /** Max recursion depth for call_skill (call_skill, default: MAX_CALL_DEPTH) */
  maxDepth?: number
  /** Variable name for current element in array ops (map/filter/reduce) */
  as?: string
  /** Sub-instructions executed per element (map, reduce iteratee) */
  instructions?: DslInstruction[]
  /** Initial accumulator value for reduce operation */
  initial?: unknown
  /** Target instruction index for jump operation (jump) */
  to?: number
}

/** Execution context — sandboxed data environment */
export interface DslContext {
  input: Record<string, unknown>
  output: Record<string, unknown>
  memory: Record<string, unknown>
}

/** Result of executing a DSL program */
export interface DslResult {
  success: boolean
  output: Record<string, unknown>
  memory: Record<string, unknown>
  error?: string
}

/** Step-level execution detail */
export interface DslStepResult {
  instructionId?: string
  op: DslOp
  success: boolean
  value?: unknown
  error?: string
}

/** Detailed execution trace */
export interface DslTrace {
  steps: DslStepResult[]
  durationMs: number
}

/** Full execution result with trace */
export interface DslFullResult extends DslResult {
  trace: DslTrace
}

/** Validation error */
export interface DslValidationError {
  path: string
  message: string
  instructionId?: string
}

// ── Constants ─────────────────────────────────────────────────────

/** Maximum number of instructions allowed in a single DSL program */
export const MAX_DSL_INSTRUCTIONS = 50

/** Maximum nesting depth for if/then/else */
export const MAX_DSL_NESTING = 5

/** Max recursion depth for call_skill composition */
export const MAX_CALL_DEPTH = 3

/** Maximum total execution steps (anti infinite loop guard for jump/if) */
export const MAX_EXECUTION_STEPS = 200

/** Whitelist of allowed operation types */
export const DSL_OP_WHITELIST: ReadonlySet<DslOp> = new Set([
  "get", "set", "add", "mcp_call", "compare", "if", "jump", "call_skill", "map", "filter", "reduce",
  "sum", "avg", "count", "min", "max",
])
