export function hash(input: string): string {
  return input.trim().toLowerCase()
}

export function hashBatch(inputs: string[], limit = 100): string[] {
  return inputs.slice(0, limit).map(i => hash(i))
}

export const hash_VERSION = "1.0.0"
