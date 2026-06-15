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

  // Register a custom primary agent that uses the agentic-engine tools
  config.agent = {
    agentic: {
      description: 'Autonomous software engineer using agentic-engine pipeline',
      mode: 'primary',
      model: model,
      prompt: '{file:./prompts/agentic.txt}',
      permission: { read: 'allow', edit: 'allow', glob: 'allow', grep: 'allow', list: 'allow', bash: 'allow', task: 'allow', webfetch: 'allow', websearch: 'allow', question: 'allow', skill: 'allow' }
    }
  };
}

fs.writeFileSync('$CONFIG_FILE', JSON.stringify(config, null, 2));
console.log('=== Config generated ===');
console.log(JSON.stringify(config, null, 2));
"

exec "$@"
