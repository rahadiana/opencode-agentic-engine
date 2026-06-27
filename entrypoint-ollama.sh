#!/usr/bin/env bash
set -euo pipefail

MODEL="${OLLAMA_EMBEDDING_MODEL:-nomic-embed-text}"

echo "=== Starting Ollama ==="
ollama serve &
OLLAMA_PID=$!

# Wait for Ollama to be ready
for i in $(seq 1 30); do
  if curl -s "http://localhost:11434/api/tags" >/dev/null 2>&1; then
    echo "Ollama ready after ${i}s"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "ERROR: Ollama failed to start"
    exit 1
  fi
  sleep 1
done

# Pull embedding model
echo "=== Pulling embedding model: $MODEL ==="
ollama pull "$MODEL"
echo "=== Model $MODEL ready ==="

# Wait for Ollama process
wait "$OLLAMA_PID"
