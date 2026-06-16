#!/usr/bin/env bash
set -euo pipefail

TELEGRAM_BOT_TOKEN=""
TELEGRAM_CHAT_ID=""
PORT="${OPENCODE_SERVER_PORT:-4096}"
TUNNEL_LOG="/tmp/cloudflared.log"

echo "=== Starting OpenCode Web ==="
opencode web --hostname 0.0.0.0 --port "$PORT" &
OPENCODE_PID=$!
echo "OpenCode PID: $OPENCODE_PID"

sleep 5

echo "=== Starting Cloudflare Tunnel ==="
cloudflared tunnel --url "http://localhost:$PORT" > "$TUNNEL_LOG" 2>&1 &
TUNNEL_PID=$!
echo "Cloudflared PID: $TUNNEL_PID"

# Wait for tunnel URL and send Telegram notification
for i in $(seq 1 30); do
    TUNNEL_URL=$(grep -oP 'https://\S+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | head -1 || true)
    if [ -n "$TUNNEL_URL" ]; then
        echo "Tunnel URL: $TUNNEL_URL"

        # Verify tunnel is actually routing before notifying
        for j in $(seq 1 10); do
            HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 5 "$TUNNEL_URL" 2>/dev/null || echo "000")
            if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "302" ]; then
                echo "Tunnel verified (HTTP $HTTP_CODE)"
                break
            fi
            echo "Waiting for tunnel to become routable... ($j/10)"
            sleep 3
        done

        MESSAGE="🟢 OpenCode Agentic Engine is live!
%0A%0A📡 Web: $TUNNEL_URL
%0A🔌 Local: http://localhost:$PORT
%0A📦 Plugin: opencode-agentic-engine v0.1.0
%0A⏰ $(date -u +'%Y-%m-%d %H:%M:%S UTC')"

        curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
            -H "Content-Type: application/json" \
            -d "{\"chat_id\":\"${TELEGRAM_CHAT_ID}\",\"text\":\"${MESSAGE}\",\"parse_mode\":\"HTML\"}"

        echo ""
        echo "Telegram notification sent!"

        break
    fi
    echo "Waiting for tunnel URL... ($i/30)"
    sleep 2
done

if [ -z "${TUNNEL_URL:-}" ]; then
    echo "WARNING: Tunnel URL not found after 60s, continuing..."
    curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
        -H "Content-Type: application/json" \
        -d "{\"chat_id\":\"${TELEGRAM_CHAT_ID}\",\"text\":\"⚠️ OpenCode started but tunnel failed — localhost:$PORT\"}"
fi

# Keep container alive
echo "=== Services running ==="
echo "OpenCode PID: $OPENCODE_PID"
echo "Cloudflared PID: $TUNNEL_PID"

# Tail cloudflared logs and wait for either process to die
tail -f "$TUNNEL_LOG" &
TAIL_PID=$!

# Monitor processes
while kill -0 "$OPENCODE_PID" 2>/dev/null && kill -0 "$TUNNEL_PID" 2>/dev/null; do
    sleep 5
done

echo "A process exited. Shutting down..."
kill "$TAIL_PID" 2>/dev/null || true
kill "$TUNNEL_PID" 2>/dev/null || true
kill "$OPENCODE_PID" 2>/dev/null || true
exit 1
