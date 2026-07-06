/**
 * Shared types for tool definition extraction.
 *
 * Each tool file exports a `makeXxxTool(ctx: ToolContext)` function that
 * returns a ToolSpec. The caller (src/index.ts) wraps it with
 * registryTool() for error handling + session guard + dynamic registration.
 *
 * NOTE: The `args` field uses Zod schemas from @opencode-ai/plugin's `tool.schema.*`.
 * These must be imported via `import { tool } from "@opencode-ai/plugin"` in each tool file.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ToolSpec<Args = any, Result = any> {
  description: string
  /** Zod schema object via tool.schema.* */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: Record<string, any>
  execute: (args: Args, context: { sessionID: string; directory?: string; worktree?: string }) => Promise<Result>
}
