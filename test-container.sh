#!/usr/bin/env bash
# ============================================================
# test-container.sh
# Build plugin locally, then build + run Docker test container.
# All crashes are isolated inside the container.
#
# Usage:
#   ./test-container.sh           # mock mode (default)
#   ./test-container.sh --llm     # real LLM via OpenCode Free (no auth)
#
# LOGS:
#   - Build logs: printed to terminal (docker build --progress=plain)
#   - Trace logs:  persisted to ./logs/.agentic/trace.jsonl (volume mount)
#   - Run logs:    persisted to ./logs/run.log
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IMAGE_NAME="opencode-agentic-test"
LOG_DIR="$SCRIPT_DIR/logs"

# Parse flags
LLM_MODE=false
if [ "${1:-}" = "--llm" ]; then
  LLM_MODE=true
fi

# Ensure log directory exists
mkdir -p "$LOG_DIR"

echo "╔══════════════════════════════════════════════════════════╗"
echo "║  Agentic Plugin — Docker Test Pipeline                  ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo "  Mode: $($LLM_MODE && echo 'LLM (OpenCode Free)' || echo 'MOCK')"
echo ""

# Step 1: Build plugin locally
echo "── Step 1: Local build ──"
cd "$SCRIPT_DIR"
npm run build 2>&1 || {
  echo ""
  echo "  LOCAL BUILD FAILED — fix this before Docker."
  echo "  Above is the compiler output showing what broke."
  exit 1
}
echo "  Local build OK (dist/index.js ready)"
echo ""

# Step 2: Build Docker image
echo "── Step 2: Docker build ──"
echo "  Context: $SCRIPT_DIR"
echo "  Dockerfile: $SCRIPT_DIR/Dockerfile.test"
echo ""
echo "  Build log also saved to: $LOG_DIR/build.log"
echo ""

docker build \
  --tag "$IMAGE_NAME" \
  --file "$SCRIPT_DIR/Dockerfile.test" \
  --progress=plain \
  $($LLM_MODE && echo "" || echo "--build-arg LLM_OFF=true") \
  "$SCRIPT_DIR" 2>&1 | tee "$LOG_DIR/build.log"

BUILD_EXIT=${PIPESTATUS[0]}
echo ""
if [ $BUILD_EXIT -ne 0 ]; then
  echo ""
  echo "  DOCKER BUILD FAILED — exit code $BUILD_EXIT"
  echo ""
  echo "  📋 LOGS:"
  echo "     Full build log:  $LOG_DIR/build.log"
  echo "     Scroll up to find '=== LAYER N ===' where it crashed."
  exit $BUILD_EXIT
fi

echo "  Docker image built: $IMAGE_NAME"
echo ""

# Step 3: Run tests in container with volume mount for persistent logs
echo "── Step 3: Docker run ──"
echo ""
echo "  📂 Mounting log directory:"
echo "     $LOG_DIR → /tmp/test-project/.agentic (trace logs)"
echo ""
echo "  Run log also saved to: $LOG_DIR/run.log"
echo ""

# Set LLM mode env var for Docker
DOCKER_ENV=""
if [ "$LLM_MODE" = false ]; then
  DOCKER_ENV="-e LLM_OFF=true"
fi

docker run --rm \
  $DOCKER_ENV \
  -v "$LOG_DIR:/tmp/test-project/.agentic" \
  "$IMAGE_NAME" 2>&1 | tee "$LOG_DIR/run.log"

RUN_EXIT=${PIPESTATUS[0]}
echo ""
if [ $RUN_EXIT -ne 0 ]; then
  echo ""
  echo "  DOCKER RUN FAILED — exit code $RUN_EXIT"
  echo ""
  echo "  📋 LOGS (semua disimpan di $LOG_DIR/):"
  echo "     build.log       — Docker build output (semua layer)"
  echo "     run.log         — Docker run output (stdout + stderr)"
  echo "     trace.jsonl     — Trace log dari plugin"
  echo ""
  echo "  🔍 Cek lokasi crash:"
  echo "     1. Buka run.log — cari 'FAIL' atau stack trace"
  echo "     2. Buka build.log — cari layer yang crash ('exit code' bukan 0)"
  exit $RUN_EXIT
fi

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  ALL TESTS PASSED — Plugin is stable in isolation       ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "📋 Logs disimpan di:"
echo "   $LOG_DIR/build.log          — Docker build output (semua layer)"
echo "   $LOG_DIR/run.log            — Docker run output (stdout + stderr)"
echo "   $LOG_DIR/trace.jsonl       — Trace log dari plugin"
