/**
 * DSL Executor — pure interpreter for deterministic skill execution.
 *
 * Supported ops: get, set, add, mcp_call, compare, if, call_skill,
 *                map, filter, reduce
 *
 * Design principles:
 * - NO eval or new Function — pure interpreter pattern
 * - Context-based execution: { input, output, memory }
 * - Path resolution via dot notation: "input.name", "memory.temp", "output.result"
 * - Ops whitelist — no arbitrary code execution
 * - validateDSL() pre-checks structure before execution
 * - call_skill supports recursive skill composition (max depth: MAX_CALL_DEPTH=3)
 * - map/filter/reduce iterate arrays with sub-instructions
 */
import type { MCPClient } from "./mcp-client.js"

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

// ── Module-level call depth tracking ──
let _callDepth = 0

// ── Path Resolution ───────────────────────────────────────────────

/**
 * Resolve a path expression against the context.
 * Supports: "input.x.y", "output.x", "memory.temp", literal values (strings, numbers, booleans)
 */
export function resolvePath(context: DslContext, path: string): { found: boolean; value: unknown } {
  // Check if it's a context path
  const match = path.match(/^(input|output|memory)\.(.+)$/)
  if (!match) {
    // Not a context reference — return as literal string
    return { found: true, value: path }
  }

  const [, scope, rest] = match as [string, string, string]
  const keys = rest.split(".")

  let current: unknown = context[scope as keyof DslContext]
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== "object") {
      return { found: false, value: undefined }
    }
    const obj = current as Record<string, unknown>
    if (!(key in obj)) {
      return { found: false, value: undefined }
    }
    current = obj[key]
  }

  return { found: true, value: current }
}

/**
 * Set a value at a path expression within a target object.
 * Creates intermediate objects as needed.
 */
export function setPath(target: Record<string, unknown>, path: string, value: unknown): boolean {
  const keys = path.split(".")
  let current = target

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]
    if (!(key in current) || current[key] === null || typeof current[key] !== "object") {
      current[key] = {}
    }
    current = current[key] as Record<string, unknown>
  }

  const lastKey = keys[keys.length - 1]
  current[lastKey] = value
  return true
}

// ── Value Resolution ──────────────────────────────────────────────

/** Resolve a value: if string matches path syntax, resolve from context; otherwise return literal */
export function resolveValue(context: DslContext, value: unknown): unknown {
  if (typeof value === "string" && /^(input|output|memory)\./.test(value)) {
    const { found, value: resolved } = resolvePath(context, value)
    return found ? resolved : value // fallback to literal string if path not found
  }
  return value
}

// ── Scope Resolution Helpers ──────────────────────────────────────

/** Resolve a target path to its context scope object */
function resolveScope(target: string, context: DslContext): Record<string, unknown> | null {
  if (target.startsWith("memory.")) return context.memory
  if (target.startsWith("output.")) return context.output
  return null
}

type AggregateOp = "sum" | "avg" | "count" | "min" | "max"

function aggregateArray(source: number[], op: AggregateOp): number {
  if (source.length === 0) return 0
  switch (op) {
    case "sum": return source.reduce((a, b) => a + b, 0)
    case "avg": return source.reduce((a, b) => a + b, 0) / source.length
    case "count": return source.length
    case "min": return Math.min(...source)
    case "max": return Math.max(...source)
  }
}

// ── Schema Validation ─────────────────────────────────────────────

/**
 * Validate a DSL instruction set before execution.
 * Returns array of validation errors (empty = valid).
 */
export function validateDSL(instructions: DslInstruction[], nesting = 0): DslValidationError[] {
  const errors: DslValidationError[] = []

  if (nesting > MAX_DSL_NESTING) {
    errors.push({ path: "nesting", message: `Max nesting depth (${MAX_DSL_NESTING}) exceeded` })
    return errors
  }

  if (instructions.length > MAX_DSL_INSTRUCTIONS) {
    errors.push({ path: "length", message: `Max instructions (${MAX_DSL_INSTRUCTIONS}) exceeded: ${instructions.length}` })
    return errors
  }

  for (let i = 0; i < instructions.length; i++) {
    const instr = instructions[i]
    const path = `[${i}]`

    // Validate op is whitelisted
    if (!DSL_OP_WHITELIST.has(instr.op)) {
      errors.push({ path: `${path}.op`, message: `Unknown op: "${instr.op}"`, instructionId: instr.id })
      continue
    }

    // Per-op validation
    switch (instr.op) {
      case "get":
        if (!instr.source) {
          errors.push({ path: `${path}.source`, message: "get requires a source path", instructionId: instr.id })
        }
        break

      case "set":
        if (!instr.target) {
          errors.push({ path: `${path}.target`, message: "set requires a target path", instructionId: instr.id })
        }
        if (instr.value === undefined && instr.source === undefined) {
          errors.push({ path: `${path}.value`, message: "set requires value or source", instructionId: instr.id })
        }
        break

      case "add":
        if (!instr.values || instr.values.length < 2) {
          errors.push({ path: `${path}.values`, message: "add requires at least 2 values", instructionId: instr.id })
        }
        break

      case "mcp_call":
        if (!instr.tool) {
          errors.push({ path: `${path}.tool`, message: "mcp_call requires a tool name", instructionId: instr.id })
        }
        break

      case "compare":
        if (!instr.left) {
          errors.push({ path: `${path}.left`, message: "compare requires a left operand", instructionId: instr.id })
        }
        if (!instr.operator) {
          errors.push({ path: `${path}.operator`, message: "compare requires an operator", instructionId: instr.id })
        }
        if (instr.right === undefined) {
          errors.push({ path: `${path}.right`, message: "compare requires a right operand", instructionId: instr.id })
        }
        break

      case "if":
        if (!instr.condition) {
          errors.push({ path: `${path}.condition`, message: "if requires a condition", instructionId: instr.id })
        }
        if (instr.then) {
          errors.push(...validateDSL(instr.then, nesting + 1).map(e => ({
            ...e,
            path: `${path}.then.${e.path}`,
          })))
        }
        if (instr.else) {
          errors.push(...validateDSL(instr.else, nesting + 1).map(e => ({
            ...e,
            path: `${path}.else.${e.path}`,
          })))
        }
        break

      case "call_skill":
        if (!instr.skill) {
          errors.push({ path: `${path}.skill`, message: "call_skill requires a skill capability string", instructionId: instr.id })
        }
        break

      case "map":
        if (!instr.source) {
          errors.push({ path: `${path}.source`, message: "map requires a source array path", instructionId: instr.id })
        }
        if (!instr.target) {
          errors.push({ path: `${path}.target`, message: "map requires a target path to store result", instructionId: instr.id })
        }
        if (!instr.instructions || instr.instructions.length === 0) {
          errors.push({ path: `${path}.instructions`, message: "map requires at least one sub-instruction", instructionId: instr.id })
        } else {
          errors.push(...validateDSL(instr.instructions, nesting + 1).map(e => ({
            ...e, path: `${path}.instructions.${e.path}`,
          })))
        }
        break

      case "filter":
        if (!instr.source) {
          errors.push({ path: `${path}.source`, message: "filter requires a source array path", instructionId: instr.id })
        }
        if (!instr.target) {
          errors.push({ path: `${path}.target`, message: "filter requires a target path to store result", instructionId: instr.id })
        }
        if (!instr.condition) {
          errors.push({ path: `${path}.condition`, message: "filter requires a condition path or expression", instructionId: instr.id })
        }
        break

      case "reduce":
        if (!instr.source) {
          errors.push({ path: `${path}.source`, message: "reduce requires a source array path", instructionId: instr.id })
        }
        if (!instr.target) {
          errors.push({ path: `${path}.target`, message: "reduce requires a target path to store result", instructionId: instr.id })
        }
        if (!instr.instructions || instr.instructions.length === 0) {
          errors.push({ path: `${path}.instructions`, message: "reduce requires at least one sub-instruction", instructionId: instr.id })
        } else {
          errors.push(...validateDSL(instr.instructions, nesting + 1).map(e => ({
            ...e, path: `${path}.instructions.${e.path}`,
          })))
        }
        if (instr.initial === undefined) {
          errors.push({ path: `${path}.initial`, message: "reduce requires an initial accumulator value", instructionId: instr.id })
        }
        break

      case "sum":
      case "avg":
      case "min":
      case "max":
        if (!instr.source) {
          errors.push({ path: `${path}.source`, message: `${instr.op} requires a source array path`, instructionId: instr.id })
        }
        if (!instr.target) {
          errors.push({ path: `${path}.target`, message: `${instr.op} requires a target path to store result`, instructionId: instr.id })
        }
        break

      case "count":
        if (!instr.source) {
          errors.push({ path: `${path}.source`, message: "count requires a source array path", instructionId: instr.id })
        }
        if (!instr.target) {
          errors.push({ path: `${path}.target`, message: "count requires a target path to store result", instructionId: instr.id })
        }
        break

      case "jump":
        if (instr.to === undefined) {
          errors.push({ path: `${path}.to`, message: "jump requires a target instruction index (to)", instructionId: instr.id })
        } else if (instr.to < 0 || instr.to >= instructions.length) {
          errors.push({ path: `${path}.to`, message: `jump target index ${instr.to} is out of bounds (0-${instructions.length - 1})`, instructionId: instr.id })
        }
        break
    }
  }

  return errors
}

// ── Array Source Resolution ───────────────────────────────────────

/** Resolve a source path to an array value from context */
function resolveArraySource(context: DslContext, source?: string): unknown[] | null {
  if (!source) return null
  const { found, value } = resolvePath(context, source)
  if (!found) return null
  if (Array.isArray(value)) return value
  return null
}

// ── Execution ─────────────────────────────────────────────────────

/**
 * Execute a single DSL instruction against the context.
 */
function executeInstruction(
  instr: DslInstruction,
  context: DslContext,
  executor: DslExecutor,
): DslStepResult {
  try {
    switch (instr.op) {
      case "get": {
        if (!instr.source) {
          return { instructionId: instr.id, op: instr.op, success: false, error: "No source path" }
        }
        const { found, value } = resolvePath(context, instr.source)
        if (!found) {
          return { instructionId: instr.id, op: instr.op, success: false, error: `Path not found: ${instr.source}` }
        }
          if (instr.target) {
            const scope = resolveScope(instr.target, context)
            if (scope) {
              const path = instr.target.replace(/^(memory|output)\./, "")
              setPath(scope, path, value)
            }
          }
        return { instructionId: instr.id, op: instr.op, success: true, value }
      }

      case "set": {
        if (!instr.target) {
          return { instructionId: instr.id, op: instr.op, success: false, error: "No target path" }
        }

        // Determine value: from source or literal
        let val: unknown
        if (instr.source !== undefined) {
          val = resolveValue(context, instr.source)
        } else {
          val = instr.value
        }

        const scope = resolveScope(instr.target, context)

        if (!scope) {
          return { instructionId: instr.id, op: instr.op, success: false, error: `Invalid target scope: ${instr.target}` }
        }

        const path = instr.target.replace(/^(memory|output)\./, "")
        setPath(scope, path, val)
        return { instructionId: instr.id, op: instr.op, success: true, value: val }
      }

      case "add": {
        const resolved = (instr.values ?? []).map(v => resolveValue(context, v)) as (string | number)[]
        if (resolved.length < 2) {
          return { instructionId: instr.id, op: instr.op, success: false, error: "Need at least 2 values" }
        }

        // If any value is a string, do concatenation
        const hasString = resolved.some(v => typeof v === "string")
        let result: string | number

        if (hasString) {
          result = resolved.map(v => String(v ?? "")).join("")
        } else if (resolved.every(v => typeof v === "number")) {
          result = (resolved as number[]).reduce((a, b) => a + b, 0)
        } else {
          return { instructionId: instr.id, op: instr.op, success: false, error: "Mixed types in add — use all numbers or all strings" }
        }

        if (instr.target) {
          const scope = resolveScope(instr.target, context)
          if (scope) {
            const path = instr.target.replace(/^(memory|output)\./, "")
            setPath(scope, path, result)
          }
        }

        return { instructionId: instr.id, op: instr.op, success: true, value: result }
      }

      case "compare": {
        const leftVal = resolveValue(context, instr.left)
        const rightVal = resolveValue(context, instr.right)

        let result = false
        switch (instr.operator) {
          case "eq": result = leftVal === rightVal; break
          case "ne": result = leftVal !== rightVal; break
          case "gt": result = (leftVal as number) > (rightVal as number); break
          case "gte": result = (leftVal as number) >= (rightVal as number); break
          case "lt": result = (leftVal as number) < (rightVal as number); break
          case "lte": result = (leftVal as number) <= (rightVal as number); break
          default:
            return { instructionId: instr.id, op: instr.op, success: false, error: `Unknown operator: ${instr.operator}` }
        }

        if (instr.target) {
          const scope = resolveScope(instr.target, context)
          if (scope) {
            const path = instr.target.replace(/^(memory|output)\./, "")
            setPath(scope, path, result)
          }
        }

        return { instructionId: instr.id, op: instr.op, success: true, value: result }
      }

      case "mcp_call": {
        if (!instr.tool) {
          return { instructionId: instr.id, op: instr.op, success: false, error: "No tool specified" }
        }
        // MCP call is async — we return the instruction for the caller to handle
        // Always mark as pending even without mcpClient (external orchestrator handles it)
        return { instructionId: instr.id, op: instr.op, success: true, value: { __mcp_pending: true, server: instr.server, tool: instr.tool, params: instr.params } }
      }

      case "call_skill": {
        if (!instr.skill) {
          return { instructionId: instr.id, op: instr.op, success: false, error: "No skill capability specified" }
        }
        const exec = executor
        if (!exec) {
          return { instructionId: instr.id, op: instr.op, success: false, error: "No executor context" }
        }
        _callDepth++
        try {
          if (_callDepth > MAX_CALL_DEPTH) {
            _callDepth--
            return { instructionId: instr.id, op: instr.op, success: false, error: `Max call depth (${MAX_CALL_DEPTH}) exceeded` }
          }
          const resolver = exec.getSkillResolver()
          if (!resolver) {
            _callDepth--
            return { instructionId: instr.id, op: instr.op, success: false, error: "No skill resolver configured" }
          }
          const skillDef = resolver(instr.skill)
          if (!skillDef) {
            _callDepth--
            return { instructionId: instr.id, op: instr.op, success: false, error: `Skill not found: ${instr.skill}` }
          }
          // Execute skill instructions recursively using the same context
          const childTrace: DslStepResult[] = []

          // Merge call_skill args into context input before execution
          if (instr.args && typeof instr.args === "object") {
            Object.assign(context.input, instr.args)
          }

          // Output normalization: snapshot output BEFORE skill execution,
          // then compute delta AFTER to produce { result: ... } envelope
          const beforeKeys = new Set(Object.keys(context.output))
          exec.executeBlock(skillDef.instructions, context, childTrace)
          const allSuccess = childTrace.every(s => s.success)

          // Auto-detect skill level based on whether instructions contain call_skill
          const hasCallSkill = (skillDef.instructions ?? []).some(i =>
            i.op === "call_skill" ||
            (i.then && i.then.some(t => t.op === "call_skill")) ||
            (i.else && i.else.some(e => e.op === "call_skill")),
          )
          skillDef.level = hasCallSkill ? "composite" : "atomic"

          if (instr.target) {
            const scope = resolveScope(instr.target, context)
            if (scope) {
              const path = instr.target.replace(/^(memory|output)\./, "")

              // Normalized output: { result: <delta of what this skill produced> }
              const delta: Record<string, unknown> = {}
              for (const key of Object.keys(context.output)) {
                if (!beforeKeys.has(key)) {
                  delta[key] = context.output[key]
                }
              }
              const normalizedOutput = {
                result: Object.keys(delta).length > 0 ? delta : context.output,
              }
              setPath(scope, path, allSuccess ? normalizedOutput : { result: "failed" })
            }
          }
          _callDepth--
          return {
            instructionId: instr.id,
            op: instr.op,
            success: allSuccess,
            value: { skill: instr.skill, steps: childTrace.length, level: skillDef.level },
          }
        } finally {
          _callDepth--
        }
      }

      case "map": {
        const arr = resolveArraySource(context, instr.source)
        if (!arr) {
          return { instructionId: instr.id, op: instr.op, success: false, error: `Source not found or not an array: ${instr.source}` }
        }
        if (!instr.instructions || instr.instructions.length === 0) {
          return { instructionId: instr.id, op: instr.op, success: false, error: "No instructions for map" }
        }
        const itemVar = instr.as || "item"
        const results: unknown[] = []
        const childTrace: DslStepResult[] = []
        for (let i = 0; i < arr.length; i++) {
          context.input[itemVar] = arr[i]
          context.input._index = i
          executor.executeBlock(instr.instructions, context, childTrace)
          if (instr.target) {
            const targetVal = resolvePath(context, instr.target)
            results.push(targetVal.found ? targetVal.value : undefined)
          }
        }
        delete context.input[itemVar]
        delete context.input._index
        if (instr.target) {
          const scope = resolveScope(instr.target, context) ?? context.output
          const path = instr.target.replace(/^(memory|output)\./, "")
          setPath(scope, path, results)
        }
        return {
          instructionId: instr.id, op: instr.op, success: true, value: results,
        }
      }

      case "filter": {
        const arr = resolveArraySource(context, instr.source)
        if (!arr) {
          return { instructionId: instr.id, op: instr.op, success: false, error: `Source not found or not an array: ${instr.source}` }
        }
        if (!instr.condition) {
          return { instructionId: instr.id, op: instr.op, success: false, error: "No condition for filter" }
        }
        const itemVar = instr.as || "item"
        const filtered: unknown[] = []
        for (let i = 0; i < arr.length; i++) {
          context.input[itemVar] = arr[i]
          const { found, value: condVal } = resolvePath(context, instr.condition)
          if (found && condVal) {
            filtered.push(arr[i])
          }
        }
        delete context.input[itemVar]
        if (instr.target) {
          const scope = resolveScope(instr.target, context) ?? context.output
          const path = instr.target.replace(/^(memory|output)\./, "")
          setPath(scope, path, filtered)
        }
        return {
          instructionId: instr.id, op: instr.op, success: true, value: filtered,
        }
      }

      case "reduce": {
        if (!instr.source) {
          return { instructionId: instr.id, op: instr.op, success: false, error: "No source for reduce" }
        }
        const arr = resolveArraySource(context, instr.source)
        if (!arr) {
          return { instructionId: instr.id, op: instr.op, success: false, error: `Source not found or not an array: ${instr.source}` }
        }
        if (!instr.instructions || instr.instructions.length === 0) {
          return { instructionId: instr.id, op: instr.op, success: false, error: "No instructions for reduce" }
        }
        const itemVar = instr.as || "item"
        let acc = instr.initial !== undefined ? resolveValue(context, instr.initial) : undefined
        const childTrace: DslStepResult[] = []
        for (let i = 0; i < arr.length; i++) {
          context.input[itemVar] = arr[i]
          context.input._acc = acc
          context.input._index = i
          executor.executeBlock(instr.instructions, context, childTrace)
          if (instr.target) {
            const resolvedAcc = resolvePath(context, instr.target)
            if (resolvedAcc.found) {
              acc = resolvedAcc.value
            }
          }
        }
        delete context.input[itemVar]
        delete context.input._acc
        delete context.input._index
        if (instr.target) {
          const scope = resolveScope(instr.target, context) ?? context.output
          const path = instr.target.replace(/^(memory|output)\./, "")
          setPath(scope, path, acc)
        }
        return {
          instructionId: instr.id, op: instr.op, success: true, value: acc,
        }
      }

      case "sum": {
        const arr = resolveArraySource(context, instr.source)
        if (!arr) {
          return { instructionId: instr.id, op: instr.op, success: false, error: `Source not found or not an array: ${instr.source}` }
        }
        const numbers = arr.map(v => typeof v === "number" ? v : Number(v)).filter(v => !isNaN(v))
        if (numbers.length === 0) {
          return { instructionId: instr.id, op: instr.op, success: false, error: "No numeric values in source array" }
        }
        const result = aggregateArray(numbers, "sum")
        if (instr.target) {
          const scope = resolveScope(instr.target, context) ?? context.output
          const path = instr.target.replace(/^(memory|output)\./, "")
          setPath(scope, path, result)
        }
        return { instructionId: instr.id, op: instr.op, success: true, value: result }
      }

      case "avg": {
        const arr = resolveArraySource(context, instr.source)
        if (!arr) {
          return { instructionId: instr.id, op: instr.op, success: false, error: `Source not found or not an array: ${instr.source}` }
        }
        const numbers = arr.map(v => typeof v === "number" ? v : Number(v)).filter(v => !isNaN(v))
        if (numbers.length === 0) {
          return { instructionId: instr.id, op: instr.op, success: false, error: "No numeric values in source array" }
        }
        const result = aggregateArray(numbers, "avg")
        if (instr.target) {
          const scope = resolveScope(instr.target, context) ?? context.output
          const path = instr.target.replace(/^(memory|output)\./, "")
          setPath(scope, path, result)
        }
        return { instructionId: instr.id, op: instr.op, success: true, value: result }
      }

      case "count": {
        const arr = resolveArraySource(context, instr.source)
        if (!arr) {
          return { instructionId: instr.id, op: instr.op, success: false, error: `Source not found or not an array: ${instr.source}` }
        }
        const result = aggregateArray(arr as unknown as number[], "count")
        if (instr.target) {
          const scope = resolveScope(instr.target, context) ?? context.output
          const path = instr.target.replace(/^(memory|output)\./, "")
          setPath(scope, path, result)
        }
        return { instructionId: instr.id, op: instr.op, success: true, value: result }
      }

      case "min": {
        const arr = resolveArraySource(context, instr.source)
        if (!arr) {
          return { instructionId: instr.id, op: instr.op, success: false, error: `Source not found or not an array: ${instr.source}` }
        }
        const numbers = arr.map(v => typeof v === "number" ? v : Number(v)).filter(v => !isNaN(v))
        if (numbers.length === 0) {
          return { instructionId: instr.id, op: instr.op, success: false, error: "No numeric values in source array" }
        }
        const result = aggregateArray(numbers, "min")
        if (instr.target) {
          const scope = resolveScope(instr.target, context) ?? context.output
          const path = instr.target.replace(/^(memory|output)\./, "")
          setPath(scope, path, result)
        }
        return { instructionId: instr.id, op: instr.op, success: true, value: result }
      }

      case "max": {
        const arr = resolveArraySource(context, instr.source)
        if (!arr) {
          return { instructionId: instr.id, op: instr.op, success: false, error: `Source not found or not an array: ${instr.source}` }
        }
        const numbers = arr.map(v => typeof v === "number" ? v : Number(v)).filter(v => !isNaN(v))
        if (numbers.length === 0) {
          return { instructionId: instr.id, op: instr.op, success: false, error: "No numeric values in source array" }
        }
        const result = aggregateArray(numbers, "max")
        if (instr.target) {
          const scope = resolveScope(instr.target, context) ?? context.output
          const path = instr.target.replace(/^(memory|output)\./, "")
          setPath(scope, path, result)
        }
        return { instructionId: instr.id, op: instr.op, success: true, value: result }
      }

      case "jump":
        // Handled at executeBlock level via IP modification
        return { instructionId: instr.id, op: instr.op, success: true, value: instr.to }

      default:
        return { instructionId: instr.id, op: instr.op, success: false, error: `Unsupported op: ${instr.op}` }
    }
  } catch (err) {
    return {
      instructionId: instr.id,
      op: instr.op,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

// ── Skill Definition for call_skill ─────────────────────────────────

/**
 * Skill definition returned by the skill resolver for call_skill operations.
 * Includes optional level for atomic vs composite distinction.
 */
export interface SkillDef {
  instructions: DslInstruction[]
  level?: "atomic" | "composite"
}

// ── DslExecutor Class ─────────────────────────────────────────────

/**
 * Deterministic DSL executor.
 * Executes a sequence of instructions against a sandboxed context.
 * Supports branching (if/then/else) and MCP tool calling.
 */
export class DslExecutor {
  private mcpClient: MCPClient | null = null
  private skillResolver: ((capability: string) => SkillDef | null) | null = null

  /** Set MCP client for mcp_call operations */
  setMCPClient(client: MCPClient): void {
    this.mcpClient = client
  }

  /** Get current MCP client */
  getMCPClient(): MCPClient | null {
    return this.mcpClient
  }

  /**
   * Set skill resolver for call_skill operations.
   * The resolver takes a capability string and returns the skill's DSL instructions, or null if not found.
   */
  setSkillResolver(resolver: (capability: string) => SkillDef | null): void {
    this.skillResolver = resolver
  }

  /** Get current skill resolver */
  getSkillResolver(): ((capability: string) => SkillDef | null) | null {
    return this.skillResolver
  }

  /**
   * Validate a set of instructions without executing.
   * Returns array of validation errors (empty = valid).
   */
  validate(instructions: DslInstruction[]): DslValidationError[] {
    return validateDSL(instructions)
  }

  /**
   * Execute a sequence of DSL instructions.
   * MCP calls are detected in the result trace for external execution.
   */
  execute(
    instructions: DslInstruction[],
    initialInput: Record<string, unknown> = {},
  ): DslFullResult {
    const startTime = Date.now()
    const context: DslContext = {
      input: { ...initialInput },
      output: {},
      memory: {},
    }

    // Pre-validate
    const validationErrors = this.validate(instructions)
    if (validationErrors.length > 0) {
      return {
        success: false,
        output: {},
        memory: context.memory,
        error: `Validation errors: ${validationErrors.map(e => e.message).join("; ")}`,
        trace: { steps: [], durationMs: Date.now() - startTime },
      }
    }

    const trace: DslStepResult[] = []

    try {
      _callDepth = 0
      this.executeBlock(instructions, context, trace)
      const durationMs = Date.now() - startTime

      return {
        success: trace.every(s => s.success),
        output: context.output,
        memory: context.memory,
        trace: { steps: trace, durationMs },
      }
    } catch (err) {
      const durationMs = Date.now() - startTime
      return {
        success: false,
        output: context.output,
        memory: context.memory,
        error: err instanceof Error ? err.message : String(err),
        trace: { steps: trace, durationMs },
      }
    }
  }

  /**
   * Execute a block of instructions, supporting branching.
   * Public so call_skill op can access it recursively.
   */
  executeBlock(
    instructions: DslInstruction[],
    context: DslContext,
    trace: DslStepResult[],
  ): void {
    let ip = 0
    let steps = 0
    const maxSteps = MAX_EXECUTION_STEPS

    while (ip >= 0 && ip < instructions.length) {
      // Anti infinite loop guard
      steps++
      if (steps > maxSteps) {
        trace.push({
          op: "jump",
          success: false,
          error: `Execution steps exceeded (${maxSteps}) — possible infinite loop`,
        })
        return
      }

      const instr = instructions[ip]
      const nextIp = ip + 1 // default: advance to next instruction

      if (instr.op === "if") {
        this.executeIf(instr, context, trace)
      } else if (instr.op === "jump") {
        // Jump to target index (unconditional)
        const result = executeInstruction(instr, context, this)
        trace.push(result)
        if (result.success && typeof instr.to === "number") {
          ip = instr.to // set IP to jump target
          continue // skip the default ip = nextIp below
        } else {
          // jump failed or invalid target — stop
          return
        }
      } else {
        const result = executeInstruction(instr, context, this)
        trace.push(result)
        if (!result.success) {
          // Short-circuit on failure
          return
        }
      }

      ip = nextIp
    }
  }

  /**
   * Execute if/then/else branching.
   */
  private executeIf(
    instr: DslInstruction,
    context: DslContext,
    trace: DslStepResult[],
  ): void {
    const conditionPath = instr.condition
    if (!conditionPath) {
      trace.push({ instructionId: instr.id, op: "if", success: false, error: "No condition" })
      return
    }

    const { found, value: conditionValue } = resolvePath(context, conditionPath)
    if (!found) {
      trace.push({ instructionId: instr.id, op: "if", success: false, error: `Condition path not found: ${conditionPath}` })
      return
    }

    const isTruthy = conditionValue !== false && conditionValue !== null && conditionValue !== undefined && conditionValue !== 0 && conditionValue !== ""

    // Log the condition evaluation
    trace.push({
      instructionId: instr.id,
      op: "if",
      success: true,
      value: { condition: conditionPath, result: isTruthy },
    })

    if (isTruthy && instr.then) {
      this.executeBlock(instr.then, context, trace)
    } else if (!isTruthy && instr.else) {
      this.executeBlock(instr.else, context, trace)
    }
  }

  /**
   * Process MCP calls from a result — returns instructions that need async MCP handling.
   */
  getPendingMCPCalls(result: DslFullResult): DslInstruction[] {
    const pending: DslInstruction[] = []
    for (const step of result.trace.steps) {
      if (step.value && typeof step.value === "object" && (step.value as Record<string, unknown>).__mcp_pending) {
        const val = step.value as Record<string, unknown>
        pending.push({
          id: step.instructionId,
          op: "mcp_call",
          server: val.server as string,
          tool: val.tool as string,
          params: val.params as Record<string, unknown>,
        })
      }
    }
    return pending
  }

  /**
   * Complete an MCP call by injecting the result back into context.
   */
  completeMCPCall(
    context: DslContext,
    instructionId: string | undefined,
    result: unknown,
  ): void {
    if (instructionId && result !== undefined) {
      context.memory[`_mcp_${instructionId}`] = result
    }
  }
}
