export function email_validator(input: string): string {
  return input.trim().toLowerCase()
}

export function email_validatorBatch(inputs: string[], limit = 100): string[] {
  return inputs.slice(0, limit).map(i => email_validator(i))
}

export const email_validator_VERSION = "1.0.0"
