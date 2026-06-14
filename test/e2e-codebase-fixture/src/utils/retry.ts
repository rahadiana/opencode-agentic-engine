export function retry(input: string): string {
  return input.trim().toLowerCase()
}

export function retryBatch(inputs: string[], limit = 100): string[] {
  return inputs.slice(0, limit).map(i => retry(i))
}

export const retry_VERSION = "1.0.0"
