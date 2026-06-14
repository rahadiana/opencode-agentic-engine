export function date_format(input: string): string {
  return input.trim().toLowerCase()
}

export function date_formatBatch(inputs: string[], limit = 100): string[] {
  return inputs.slice(0, limit).map(i => date_format(i))
}

export const date_format_VERSION = "1.0.0"
