/**
 * DSL Validator — validates DSL instruction sets before execution.
 *
 * Extracted from dsl-executor.ts for modularity.
 */
import { MAX_DSL_NESTING, MAX_DSL_INSTRUCTIONS, DSL_OP_WHITELIST } from "./dsl-types.js"
import type { DslInstruction, DslValidationError } from "./dsl-types.js"

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
