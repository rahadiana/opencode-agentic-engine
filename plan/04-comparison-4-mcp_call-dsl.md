# Comparison 04: MCP Call ke DSL

## Source
`MARKDOWN_PLAN/4 - tambahin mcp_call ke DSL.md` — MCP integration ke DSL

## Inti Konsep
- Op baru: `mcp_call` — bisa panggil tools eksternal dari dalam DSL
- Tool registry: `http.get`, `http.post`, `json.parse`
- Args resolution dari memory context
- Async executor (karena MCP async)
- Security: whitelist ALLOWED_TOOLS, rate limit 200ms
- Example: fetch API → parse JSON → set output

## Yang Kita Punya
- **MCP Client** (`src/core/mcp-client.ts`): stdio/HTTP MCP client untuk connect ke external servers.
- **Tool Router** (`src/core/tool-router.ts`): dynamic tool selection per session.
- **29 Tools** registered via `tool()` helper — termasuk `agentic_mcp` untuk koneksi MCP.

## Gap
1. **❌ MCP dalam DSL** — Kita bisa connect ke MCP server via `agentic_mcp` tool, tapi bukan sebagai op dalam DSL execution.
2. **❌ Tool Registry Lokal** — Mereka punya `MCPTools = { "http.get": fn, "http.post": fn }` — sederhana dan langsung. Kita punya lebih kompleks.
3. **❌ Args Resolution dari Memory** — MCP call mereka bisa resolve args dari memory context; kita pure parameter passing.
4. **❌ Rate Limit Bawaan** — Mereka built-in rate limit di MCP layer.
5. **❌ Async DSL Ops** — Executor kita sync-only; mereka sudah async-aware.

## Kesimpulan
Kita punya MCP client yang lebih lengkap (stdio, HTTP, multiple servers), tapi mereka integrasi MCP sebagai op dalam DSL — lebih mulus dan deterministic. Approach mereka: "MCP adalah operasi DSL seperti add/get/set". Approach kita: "MCP adalah tool terpisah yang dipanggil LLM".
