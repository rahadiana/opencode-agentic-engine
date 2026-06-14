export function jwt(input: string): string {
  return input.trim().toLowerCase()
}

export function jwtBatch(inputs: string[], limit = 100): string[] {
  return inputs.slice(0, limit).map(i => jwt(i))
}

export const jwt_VERSION = "1.0.0"
