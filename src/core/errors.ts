/**
 * Custom error classes for the agentic engine.
 *
 * Enables callers to use `catch (e instanceof SessionNotFoundError)` instead
 * of parsing error strings (fragile) or silencing all errors (dangerous).
 */

export class AgenticError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message)
    this.name = this.constructor.name
  }
}

/**
 * Thrown when an operation references a session ID that does not exist.
 */
export class SessionNotFoundError extends AgenticError {
  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`, 'SESSION_NOT_FOUND')
  }
}

/**
 * Thrown when a resource budget (tokens, steps, time, cost) is exceeded.
 */
export class BudgetExceededError extends AgenticError {
  constructor(
    public readonly limit: string,
    public readonly value: number,
    public readonly max: number,
  ) {
    super(`Budget exceeded: ${limit} (${value}/${max})`, 'BUDGET_EXCEEDED')
  }
}

/**
 * Thrown when an LLM call fails (timeout, API error, etc.).
 * Optional fields: modelName, statusCode untuk debugging.
 */
export class LLMError extends AgenticError {
  constructor(
    message: string,
    public readonly modelName?: string,
    public readonly statusCode?: number,
  ) {
    super(message, 'LLM_ERROR')
  }
}

/**
 * Thrown when an operation times out.
 */
export class TimeoutError extends AgenticError {
  constructor(
    public readonly operation: string,
    public readonly ms: number,
  ) {
    super(`Timeout: ${operation} exceeded ${ms}ms`, 'TIMEOUT')
  }
}

/**
 * Thrown when input validation fails.
 */
export class ValidationError extends AgenticError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR')
  }
}

/**
 * Thrown when a requested resource (file, tool, etc.) is not found.
 */
export class NotFoundError extends AgenticError {
  constructor(
    public readonly resourceType: string,
    public readonly resourceId: string,
  ) {
    super(`${resourceType} not found: ${resourceId}`, 'NOT_FOUND')
  }
}
