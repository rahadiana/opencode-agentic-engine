# opencode-agentic-engine

> Multi-agent software engineering plugin for [OpenCode](https://opencode.ai) — implements the agentic workflow from *"The End of Software Engineering"* (Cao, arXiv:2606.05608).

[![Tests](https://img.shields.io/badge/tests-102%2F102-brightgreen)](test/run.mjs)
[![Docker](https://img.shields.io/badge/docker-7%20layers%20pass-brightgreen)](Dockerfile.test)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

## Overview

A plugin that transforms OpenCode from a simple LLM tool-calling interface into a **self-coordinating engineering team**. It implements the four-stage roadmap from the paper:

| Stage | Capability | Tools |
|---|---|---|
| **I** — Tool-Augmented | Self-correction loop, intent parsing, trace logging | plan, execute, reflect, verify, status |
| **II** — Single-Task Autonomous | Auto-decompose, codebase nav, context compression, git | nav, context, snapshot, pr, score |
| **III** — Multi-Agent Teams | Role delegation, parallel exec, skills, episodic memory | delegate, parallel, skill, episodes, dashboard, guard |
| **IV** — Design Constraints | Extensible roles, versioned memory, self-describing skills | evolve |

## Quick Start

```bash
# Build
npm install && npm run build

# Run tests (no LLM needed — all mock)
node test/run.mjs          # 99 unit tests
node test/dropin.mjs        # Plugin auto-discovery
node test/load-samedir.mjs  # Full E2E workflow
node test/e2e-scenario.mjs  # 50-file codebase, 5 iterations

# Docker pipeline (all 7 layers)
./test-container.sh
```

## Docker Deploy (Production)

```bash
# One-command deploy: OpenCode + plugin + cloudflared tunnel + Telegram notif
docker compose up -d

# Cek status
docker compose logs -f

# Akses OpenCode Web UI via tunnel URL (kirim via Telegram)
```

**Services:**
- `opencode` — OpenCode web server (port 4096) + plugin (17 tools)
- Auto-tunnel via cloudflared → public HTTPS URL
- Telegram notifikasi saat tunnel ready (bot: `RanaProjectsBot`, chat: `336238760`)

**Volumes persist:**
- `opencode_data` — OpenCode config, sessions, trace logs
- `agentic_store` — Plugin state: skills, episodes, session memory

**Env (optional):**
```bash
OPENCODE_PASSWORD=opencode-agentic-2026  # Web UI auth
TELEGRAM_BOT_TOKEN=...                   # Override bot
TELEGRAM_CHAT_ID=...                     # Override chat
```

## Architecture

```
src/
├── core/           # intent-parser, planner, executor, verifier, error-analyzer,
│                   # navigator, git, tech-debt-scorer, parallel
├── agents/         # coordinator, role-registry (extensible)
├── drift/          # context-compressor, dependency-tracker, checkpoints,
│                   # hallucination-guard
├── memory/         # session-store, skill-store, episodic-store,
│                   # schema-version, skill-format
├── observability/  # trace-logger (JSONL), dashboard
└── index.ts        # Plugin entry: 17 tool definitions + hooks
```

## 18 Tools

| Tool | Description |
|---|---|
| `agentic_plan` | Create + auto-decompose execution plan |
| `agentic_nav` | Scan codebase, search files |
| `agentic_execute` | Record step completion, auto-verify |
| `agentic_reflect` | Error analysis + propagation tracing |
| `agentic_verify` | Compile + test verification |
| `agentic_status` | Dashboard + blocked steps |
| `agentic_context` | View/compress context window |
| `agentic_snapshot` | Save/list checkpoints |
| `agentic_pr` | Generate PR description |
| `agentic_score` | Tech debt analysis (coupling/size/scope/patterns) |
| `agentic_delegate` | Assign task to architect/developer/qa/coordinator |
| `agentic_parallel` | Dependency-based concurrency |
| `agentic_skill` | Extract/find/reuse skills |
| `agentic_episodes` | Cross-session memory search |
| `agentic_dashboard` | Timeline + anomaly detection |
| `agentic_guard` | Hallucination detection |
| `agentic_evolve` | Inspect + extend agent system |
| `agentic_auto` | Fully autonomous agent loop (plan→execute→verify→retry in one call) |

## Installation

Add to `opencode.json`:

```json
{
  "plugin": ["./dist/index.js"]
}
```

Or reference from npm:
```json
{
  "plugin": ["opencode-agentic-engine"]
}
```

## Testing

All tests are **LLM-free** — they pass hardcoded results to `agentic_execute`. This means:

- No API keys needed
- No network calls
- Fully deterministic
- Runs in Docker isolation

```bash
test/run.mjs              # 99 unit tests (mock context)
test/dropin.mjs           # Plugin auto-discovery verification
test/load-samedir.mjs     # Same-directory load + plan→execute→fail→reflect→retry
test/e2e-scenario.mjs     # 50-file codebase × 5 iterations × 3-agent parallel
./test-container.sh       # All 7 Docker layers
```

## Configuration

The plugin requires minimal configuration — it inherits the LLM provider from OpenCode:

```jsonc
// opencode.json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["./dist/index.js"]
  // model: auto-detected from OpenCode
}
```

## Design Principles

From the paper:

1. **Intent-first, code-second** — Accept *what* is desired, not *how*
2. **Agent in the driver's seat, human in the loop** — Agents execute, humans approve at checkpoints
3. **Observability is not optional** — Every reasoning step is traced to `~/.agentic/trace.jsonl`
4. **Fail loudly, recover gracefully** — Errors exposed with root cause analysis + propagated impact

## References

- [The End of Software Engineering](https://arxiv.org/abs/2606.05608) — Cao (2026)
- [Agents in Software Engineering: Survey](https://arxiv.org/abs/2409.09030) — Wang et al. (2024)
- [EvoClaw: Evaluating AI Agents on Continuous Software Evolution](https://arxiv.org/abs/2603.13428) — Deng et al. (2026)
- [Hermes Agent: The Self-Improving AI Agent](https://github.com/NousResearch/Hermes-Function-Calling) — Nous Research

## License

MIT
