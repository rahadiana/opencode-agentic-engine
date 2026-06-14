export function array_utils(input: string): string {
  return input.trim().toLowerCase()
}

export function array_utilsBatch(inputs: string[], limit = 100): string[] {
  return inputs.slice(0, limit).map(i => array_utils(i))
}

export const array_utils_VERSION = "1.0.0"
