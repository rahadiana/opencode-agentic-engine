/**
 * Skill Schema — input_schema / output_schema validation for skills.
 *
 * Provides a lightweight JSON Schema-like validator for skill inputs and outputs.
 * Zero external dependencies — pure TypeScript implementation.
 *
 * Design:
 * - SchemaField defines expected shape: type, required, nested properties, constraints
 * - SchemaValidator validates runtime data against schema
 * - Supports string, number, boolean, array, object types
 * - Nested object validation, array item validation
 * - Numeric constraints (min/max), string constraints (min/max length), enum values
 */
export type SchemaFieldType = "string" | "number" | "boolean" | "array" | "object"

/**
 * Schema field definition — describes a single field in input/output schema.
 */
export interface SchemaField {
  /** Expected data type */
  type: SchemaFieldType
  /** Whether the field is required */
  required?: boolean
  /** Human-readable description */
  description?: string
  /** Nested properties (for object type) */
  properties?: Record<string, SchemaField>
  /** Item schema (for array type) */
  items?: SchemaField
  /** Allowed values (enum constraint) */
  enum?: unknown[]
  /** Default value if not provided */
  default?: unknown
  /** Minimum string length (string type) */
  minLength?: number
  /** Maximum string length (string type) */
  maxLength?: number
  /** Minimum numeric value (number type) */
  minimum?: number
  /** Maximum numeric value (number type) */
  maximum?: number
  /** Pattern/regex for string validation */
  pattern?: string
}

/**
 * Skill schema — input and/or output schema definitions.
 */
export interface SkillSchema {
  /** Schema for skill inputs */
  input_schema?: Record<string, SchemaField>
  /** Schema for skill outputs */
  output_schema?: Record<string, SchemaField>
}

/**
 * Schema validation result.
 */
export interface SchemaValidationResult {
  valid: boolean
  errors: SchemaValidationError[]
  /** Data with defaults applied */
  data: Record<string, unknown>
}

/**
 * Individual validation error.
 */
export interface SchemaValidationError {
  path: string
  field: string
  message: string
  code: SchemaErrorCode
}

/** Error codes for structured error handling */
export type SchemaErrorCode =
  | "missing_required"
  | "type_mismatch"
  | "enum_violation"
  | "min_length"
  | "max_length"
  | "minimum"
  | "maximum"
  | "pattern_mismatch"
  | "extra_field"
  | "invalid_type"

// ── Schema Validator ──────────────────────────────────────────────

/**
 * Validates runtime data against a schema definition.
 * Applies default values for missing optional fields.
 */
export class SchemaValidator {
  /**
   * Validate data against a schema field definition.
   */
  validate(
    schema: Record<string, SchemaField>,
    data: Record<string, unknown>,
    options?: { allowExtraFields?: boolean },
  ): SchemaValidationResult {
    const errors: SchemaValidationError[] = []
    const result: Record<string, unknown> = { ...data }

    const allowExtra = options?.allowExtraFields ?? true

    // Check for extra fields
    if (!allowExtra) {
      for (const key of Object.keys(data)) {
        if (!(key in schema)) {
          errors.push({
            path: key,
            field: key,
            message: `Unexpected field: "${key}"`,
            code: "extra_field",
          })
        }
      }
    }

    // Validate each schema field
    for (const [key, field] of Object.entries(schema)) {
      const hasValue = key in data && data[key] !== undefined

      // Check required
      if (!hasValue && field.required) {
        errors.push({
          path: key,
          field: key,
          message: `Missing required field: "${key}"`,
          code: "missing_required",
        })
        continue
      }

      // Apply default if not present and has default
      if (!hasValue && field.default !== undefined) {
        result[key] = field.default
        continue
      }

      // Skip if not present and not required
      if (!hasValue) continue

      // Validate field
      const fieldErrors = this.validateField(key, data[key], field)
      errors.push(...fieldErrors)
    }

    return {
      valid: errors.length === 0,
      errors,
      data: result,
    }
  }

  /**
   * Generate a JSON Schema-compatible object from SchemaField definitions.
   */
  toJSONSchema(schema: Record<string, SchemaField>): Record<string, unknown> {
    const properties: Record<string, unknown> = {}
    const required: string[] = []

    for (const [key, field] of Object.entries(schema)) {
      properties[key] = this.fieldToJSONSchema(field)
      if (field.required) {
        required.push(key)
      }
    }

    const result: Record<string, unknown> = {
      type: "object",
      properties,
    }

    if (required.length > 0) {
      result.required = required
    }

    return result
  }

  /**
   * Parse data against schema and return strongly-typed result.
   * Throws on validation failure with descriptive message.
   */
  parseOrThrow(
    schema: Record<string, SchemaField>,
    data: Record<string, unknown>,
    label?: string,
  ): Record<string, unknown> {
    const result = this.validate(schema, data)
    if (!result.valid) {
      const prefix = label ? `${label}: ` : ""
      const messages = result.errors.map(e => e.message).join("; ")
      throw new Error(`${prefix}Schema validation failed: ${messages}`)
    }
    return result.data
  }

  /**
   * Validate a single field value against its schema.
   */
  private validateField(
    key: string,
    value: unknown,
    field: SchemaField,
  ): SchemaValidationError[] {
    const errors: SchemaValidationError[] = []

    // Type check
    const actualType = typeof value
    const expectedType = field.type

    // Handle array type specially
    if (expectedType === "array") {
      if (!Array.isArray(value)) {
        errors.push({
          path: key,
          field: key,
          message: `Expected array, got ${actualType}`,
          code: "type_mismatch",
        })
        return errors
      }

      // Validate array items
      if (field.items && value.length > 0) {
        for (let i = 0; i < value.length; i++) {
          const itemErrors = this.validateField(
            `${key}[${i}]`,
            value[i],
            field.items,
          )
          errors.push(...itemErrors)
        }
      }

      return errors
    }

    // Handle object type
    if (expectedType === "object") {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        errors.push({
          path: key,
          field: key,
          message: `Expected object, got ${actualType}`,
          code: "type_mismatch",
        })
        return errors
      }

      // Validate nested properties
      if (field.properties) {
        const objErrors = this.validate(
          field.properties,
          value as Record<string, unknown>,
        )
        errors.push(...objErrors.errors.map(e => ({
          ...e,
          path: `${key}.${e.path}`,
        })))
      }

      return errors
    }

    // Primitive type check (string, number, boolean)
    const tsTypeMap: Record<string, string> = {
      string: "string",
      number: "number",
      boolean: "boolean",
    }

    if (expectedType in tsTypeMap && actualType !== tsTypeMap[expectedType]) {
      errors.push({
        path: key,
        field: key,
        message: `Expected ${expectedType}, got ${actualType}`,
        code: "type_mismatch",
      })
      return errors
    }

    // Enum check
    if (field.enum && !field.enum.includes(value)) {
      errors.push({
        path: key,
        field: key,
        message: `Value "${String(value)}" not in enum [${field.enum.map(String).join(", ")}]`,
        code: "enum_violation",
      })
    }

    // String constraints
    if (expectedType === "string" && typeof value === "string") {
      if (field.minLength !== undefined && value.length < field.minLength) {
        errors.push({
          path: key,
          field: key,
          message: `String length ${value.length} < minimum ${field.minLength}`,
          code: "min_length",
        })
      }
      if (field.maxLength !== undefined && value.length > field.maxLength) {
        errors.push({
          path: key,
          field: key,
          message: `String length ${value.length} > maximum ${field.maxLength}`,
          code: "max_length",
        })
      }
      if (field.pattern) {
        const regex = new RegExp(field.pattern)
        if (!regex.test(value)) {
          errors.push({
            path: key,
            field: key,
            message: `String does not match pattern: ${field.pattern}`,
            code: "pattern_mismatch",
          })
        }
      }
    }

    // Number constraints
    if (expectedType === "number" && typeof value === "number") {
      if (field.minimum !== undefined && value < field.minimum) {
        errors.push({
          path: key,
          field: key,
          message: `Value ${value} < minimum ${field.minimum}`,
          code: "minimum",
        })
      }
      if (field.maximum !== undefined && value > field.maximum) {
        errors.push({
          path: key,
          field: key,
          message: `Value ${value} > maximum ${field.maximum}`,
          code: "maximum",
        })
      }
    }

    return errors
  }

  /**
   * Convert a SchemaField to a JSON Schema-compatible object.
   */
  private fieldToJSONSchema(field: SchemaField): Record<string, unknown> {
    const schema: Record<string, unknown> = { type: field.type }

    if (field.description) schema.description = field.description
    if (field.enum) schema.enum = field.enum
    if (field.default !== undefined) schema.default = field.default
    if (field.minLength !== undefined) schema.minLength = field.minLength
    if (field.maxLength !== undefined) schema.maxLength = field.maxLength
    if (field.minimum !== undefined) schema.minimum = field.minimum
    if (field.maximum !== undefined) schema.maximum = field.maximum
    if (field.pattern) schema.pattern = field.pattern

    if (field.type === "object" && field.properties) {
      const props: Record<string, unknown> = {}
      const required: string[] = []
      for (const [key, prop] of Object.entries(field.properties)) {
        props[key] = this.fieldToJSONSchema(prop)
        if (prop.required) required.push(key)
      }
      schema.properties = props
      if (required.length > 0) schema.required = required
    }

    if (field.type === "array" && field.items) {
      schema.items = this.fieldToJSONSchema(field.items)
    }

    return schema
  }

  /**
   * Infer SchemaField from a sample value (for auto-schema generation).
   */
  inferField(value: unknown): SchemaField {
    if (value === null || value === undefined) {
      return { type: "string" }
    }

    if (Array.isArray(value)) {
      const itemSchema = value.length > 0
        ? this.inferField(value[0])
        : { type: "string" as const }
      return { type: "array", items: itemSchema }
    }

    switch (typeof value) {
      case "string":
        return { type: "string" }
      case "number":
        return { type: "number" }
      case "boolean":
        return { type: "boolean" }
      case "object": {
        const properties: Record<string, SchemaField> = {}
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          properties[k] = this.inferField(v)
        }
        return { type: "object", properties }
      }
      default:
        return { type: "string" }
    }
  }

  /**
   * Infer full schema from a sample data object.
   */
  inferSchema(data: Record<string, unknown>): Record<string, SchemaField> {
    const schema: Record<string, SchemaField> = {}
    for (const [key, value] of Object.entries(data)) {
      schema[key] = this.inferField(value)
    }
    return schema
  }
}
