# Protocols: MCP & A2A

## MCP (Model Context Protocol)

Standard protocol untuk komunikasi agent dengan external tools/APIs.

### MCP Client (`agentic_mcp`)

Connect ke external MCP servers:

```
# Connect via stdio
agentic_mcp action="connect" transport="stdio" command="node" args=["server.js"] name="my-server"

# Connect via HTTP
agentic_mcp action="connect" transport="http" url="http://localhost:3000" name="api-server"

# List connections
agentic_mcp action="list"

# Call external tool
agentic_mcp action="call" server="my-server" tool="get_weather" params='{"city":"Jakarta"}'

# Disconnect
agentic_mcp action="disconnect" server="my-server"
```

### MCP Server (`agentic_mcp_server`)

Expose plugin tools sebagai MCP server — external clients bisa panggil:

```
# Start server
agentic_mcp_server action="start" port=4124
  → Agentic MCP server running on port 4124

# Status
agentic_mcp_server action="status"

# Restart
agentic_mcp_server action="restart"

# Stop
agentic_mcp_server action="stop"
```

External client bisa discover dan call semua `agentic_*` tools via MCP protocol.

## A2A (Agent-to-Agent)

Google A2A standard untuk interop antar agent framework.

### Server Mode

Serve Agent Card untuk ditemukan agent lain:

```
agentic_a2a action="serve" port=4123 agentName="agentic-engine"
  → Agent Card available at http://localhost:4123/.well-known/agent-card
```

### Client Mode

Discover dan delegate ke remote agents:

```
# Discover agent
agentic_a2a action="discover" url="http://other-agent:4123"

# List known agents
agentic_a2a action="list"

# Delegate task
agentic_a2a action="delegate" url="http://other-agent:4123"
  taskDescription="Refactor authentication module"

# Ping agent
agentic_a2a action="ping" url="http://other-agent:4123"

# Stats
agentic_a2a action="stats"
```

## Unified Tool Discovery (`agentic_tools`)

Cari dan panggil tools dari MCP + A2A dalam satu tempat:

```
# Search across all protocols
agentic_tools action="search" query="database"

# Call specific tool
agentic_tools action="call" source="my-server" method="query_db" params='{"sql":"SELECT * FROM users"}'

# List all connected backends
agentic_tools action="list"

# Combined stats
agentic_tools action="stats"
```

## Protocol Architecture

```
┌──────────────────────────────────────────────────────┐
│                    Agentic Engine                     │
│                                                      │
│  ┌─────────┐  ┌──────────┐  ┌──────────────────┐    │
│  │   A2A   │  │   MCP    │  │   Tool Router     │    │
│  │  Server │  │  Server  │  │  (internal)       │    │
│  └────┬────┘  └────┬─────┘  └────────┬─────────┘    │
│       │            │                 │              │
│       ▼            ▼                 ▼              │
│  ┌─────────────────────────────────────────┐        │
│  │        34 agentic_* Tools               │        │
│  │  (plan, execute, verify, nav, ...)      │        │
│  └─────────────────────────────────────────┘        │
│                                                      │
│  ┌─────────────────────────────────────────┐        │
│  │  OpenCode SDK (LLM calls, chat hooks)   │        │
│  └─────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────┘
           │                 │
           ▼                 ▼
    External MCP       Remote A2A
    Clients            Agents
```
