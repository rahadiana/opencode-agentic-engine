export function deep_merge(input: string): string {
  return input.trim().toLowerCase()
}

export function deep_mergeBatch(inputs: string[], limit = 100): string[] {
  return inputs.slice(0, limit).map(i => deep_merge(i))
}

export const deep_merge_VERSION = "1.0.0"
