export function slug(input: string): string {
  return input.trim().toLowerCase()
}

export function slugBatch(inputs: string[], limit = 100): string[] {
  return inputs.slice(0, limit).map(i => slug(i))
}

export const slug_VERSION = "1.0.0"
