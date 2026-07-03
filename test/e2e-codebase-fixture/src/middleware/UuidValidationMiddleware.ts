import { isUUID } from "../utils/validation.js"
import { ValidationError } from "../errors/validation-error.js"

/**
 * Middleware that validates a UUID route parameter.
 * Throws ValidationError if the param is not a valid UUID.
 *
 * @param paramName - The route parameter name to validate (default: "id").
 */
export function uuidValidationMiddleware(paramName: string = "id") {
  return (req: { params: Record<string, string> }): void => {
    const value = req.params[paramName]
    if (!value || !isUUID(value)) {
      throw new ValidationError([`Invalid ${paramName} format: expected UUID`])
    }
  }
}
