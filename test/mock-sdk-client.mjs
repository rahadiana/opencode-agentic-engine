/**
 * Shared mock SDK client for testing.
 * Returns an object matching the OpenCode SDK client interface
 * with { data: ... } wrapped responses.
 */
export function sdkMockClient(sessionId = "mock-session") {
  let sessionCost = 0
  let sessionTokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
  const messages = []
  return {
    config: {
      providers: async () => ({
        data: {
          providers: [
            { name: "OpenAI", id: "openai", models: { "gpt-4o": { id: "gpt-4o", providerID: "openai", name: "GPT-4o", status: "active" } } },
            { name: "Anthropic", id: "anthropic", models: { "claude-sonnet-4-20250514": { id: "claude-sonnet-4-20250514", providerID: "anthropic", name: "Claude Sonnet 4", status: "active" } } },
          ],
          default: { build: "openai/gpt-4o", plan: "anthropic/claude-sonnet-4-20250514" },
        },
      }),
    },
    session: {
      get: async (opts) => {
        return {
          data: {
            cost: sessionCost,
            model: { id: "gpt-4o", providerID: "openai" },
            tokens: sessionTokens,
            title: "Test Session",
            agent: "build",
          },
        }
      },
      create: async (opts) => ({ data: { id: `temp-${Date.now()}` } }),
      delete: async (opts) => true,
      prompt: async (opts) => {
        // Track tokens/cost as real SDK would
        sessionCost += 0.001
        sessionTokens.input += opts.body?.parts?.[0]?.text?.length ?? 0
        sessionTokens.output += 50
        messages.push({ role: "user", text: opts.body?.parts?.[0]?.text })
        return {
          data: {
            info: {
              id: `msg-${messages.length}`,
              sessionID: sessionId,
              role: "assistant",
              cost: 0.001,
              tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
              finish: "stop",
            },
            parts: [{ id: `part-${messages.length}`, type: "text", text: `Response to: ${opts.body?.parts?.[0]?.text ?? ""}` }],
          },
        }
      },
    },
    app: {
      log: async (opts) => { /* capture for assertions */ return true },
    },
  }
}
