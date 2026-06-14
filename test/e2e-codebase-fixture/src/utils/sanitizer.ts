export function sanitizer(input: string): string {
  return input.trim().toLowerCase()
}

export function sanitizerBatch(inputs: string[], limit = 100): string[] {
  return inputs.slice(0, limit).map(i => sanitizer(i))
}

export const sanitizer_VERSION = "1.0.0"
