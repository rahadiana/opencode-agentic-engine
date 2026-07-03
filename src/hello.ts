/**
 * Hello World — a simple greeting function.
 * Minimal, zero-dependency module.
 */

/**
 * Returns a greeting string for the given name.
 * @param name - The person to greet (default: "World")
 * @returns A friendly greeting
 */
export function hello(name: string = "World"): string {
  return `Hello, ${name}!`
}
