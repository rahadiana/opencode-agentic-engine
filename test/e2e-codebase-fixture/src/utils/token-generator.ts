export function token_generator(input: string): string {
  return input.trim().toLowerCase()
}

export function token_generatorBatch(inputs: string[], limit = 100): string[] {
  return inputs.slice(0, limit).map(i => token_generator(i))
}

export const token_generator_VERSION = "1.0.0"
