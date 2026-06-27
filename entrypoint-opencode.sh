#!/usr/bin/env bash
set -euo pipefail

# Set up agentic prompt file
PROMPTS_DIR="/workspace/.opencode/prompts"
mkdir -p "$PROMPTS_DIR"

# Copy the agentic-agent prompt (written during Docker build)
if [ -f /workspace/agentic-agent-prompt.md ]; then
  cp /workspace/agentic-agent-prompt.md "$PROMPTS_DIR/agentic.txt"
  echo "=== Agentic prompt copied ==="
fi

# Generate opencode.json with dynamic provider config + agentic agent
CONFIG_FILE="/workspace/.opencode/opencode.json"

node -e "
const fs = require('fs');
const config = { 
  \$schema: 'https://opencode.ai/config.json' 
};

const apiKey = process.env.LLM_API_KEY;
const baseURL = process.env.LLM_BASE_URL;
const model = process.env.LLM_MODEL;

if (apiKey && baseURL && model) {
  config.provider = {
    'custom-llm': {
      name: process.env.LLM_PROVIDER_NAME || 'Custom LLM',
      npm: '@ai-sdk/openai-compatible',
      options: { baseURL, apiKey },
      models: { [model]: {} }
    }
  };
  config.model = model;

  // Global permissions — allow within project, deny external/system access
  config.permission = {
    external_directory: 'deny',
    read: { '*': 'allow' },
    edit: { '*': 'allow' },
    glob: { '*': 'allow' },
    grep: { '*': 'allow' },
    list: { '*': 'allow' },
    bash: {
      '*': 'allow',
      'rm -rf /*': 'deny',
      'rm -rf /': 'deny',
      'chmod 777': 'deny',
      '> /dev/*': 'deny',
      'dd *': 'deny',
      'mkfs*': 'deny',
      'fdisk*': 'deny',
      'mount*': 'deny',
      ':(){ :|&: };:': 'deny',
    },
    task: 'allow',
    webfetch: 'allow',
    websearch: 'allow',
    question: 'allow',
    skill: 'allow',
  };

  // Agentic agent — fully autonomous
  config.agent = {
    agentic: {
      description: 'Autonomous software engineer using agentic-engine pipeline',
      mode: 'primary',
      model: model,
      prompt: '{file:./prompts/agentic.txt}',
    },
    // Default build agent
    build: {
      mode: 'primary',
      model: model,
    }
  };
}

fs.writeFileSync('$CONFIG_FILE', JSON.stringify(config, null, 2));
console.log('=== Config generated ===');
console.log(JSON.stringify(config, null, 2));
"

# ── Embedding Config (Ollama / external) ──
# Set EMBEDDING_ENDPOINT to enable vector search in agentic-engine
if [ -n "${EMBEDDING_ENDPOINT:-}" ]; then
  AGENTIC_CONFIG="/workspace/.agentic/config.json"
  mkdir -p "/workspace/.agentic"

  if [ -f "$AGENTIC_CONFIG" ]; then
    # Update existing config — inject embedding settings
    node -e "
    const fs = require('fs');
    const cfg = JSON.parse(fs.readFileSync('$AGENTIC_CONFIG', 'utf-8'));
    cfg.embedding = {
      endpoint: '${EMBEDDING_ENDPOINT}',
      model: '${EMBEDDING_MODEL:-nomic-embed-text}',
      ${EMBEDDING_API_KEY:+apiKey: '${EMBEDDING_API_KEY}',}
    };
    cfg.memory.mode = 'full';
    fs.writeFileSync('$AGENTIC_CONFIG', JSON.stringify(cfg, null, 2));
    console.log('=== Embedding config injected ===');
    "
  else
    # Create fresh config with embedding
    node -e "
    const cfg = {
      \"\$schema\": \"v1\",
      embedding: {
        endpoint: '${EMBEDDING_ENDPOINT}',
        model: '${EMBEDDING_MODEL:-nomic-embed-text}',
        ${EMBEDDING_API_KEY:+apiKey: '${EMBEDDING_API_KEY}',}
      },
      memory: {
        enabled: true,
        mode: 'full',
        maxEntries: 1000,
        forgetAfterDays: 30,
        search: { keywordWeight: 0.3, vectorWeight: 0.7 }
      }
    };
    fs.writeFileSync('$AGENTIC_CONFIG', JSON.stringify(cfg, null, 2));
    console.log('=== Embedding config created ===');
    "
  fi
fi

exec "$@"
