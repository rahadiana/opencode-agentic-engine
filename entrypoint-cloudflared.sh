#!/usr/bin/env bash
set -euo pipefail

TELEGRAM_BOT_TOKEN="8726183460:AAFkcRxiIzsye4nIGSCz9kQx6QkZZohmWQY"
TELEGRAM_CHAT_ID="336238760"
TUNNEL_LOG="/tmp/cloudflared.log"
OPECODE_URL="${OPENCODE_URL:-http://opencode:4096}"

echo "=== Starting Cloudflare Tunnel → ${OPECODE_URL} ==="
cloudflared tunnel --url "$OPECODE_URL" > "$TUNNEL_LOG" 2>&1 &
TUNNEL_PID=$!

# Wait for tunnel URL
for i in $(seq 1 30); do
    TUNNEL_URL=$(grep -oP 'https://\S+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | head -1 || true)
    if [ -n "$TUNNEL_URL" ]; then
        echo "Tunnel URL: $TUNNEL_URL"

        # Verify tunnel is routable
        for j in $(seq 1 10); do
            HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 5 "$TUNNEL_URL" 2>/dev/null || echo "000")
            if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "302" ]; then
                echo "Tunnel verified (HTTP $HTTP_CODE)"
                break
            fi
            echo "Waiting for tunnel to become routable... ($j/10)"
            sleep 3
        done

        MESSAGE="🟢 OpenCode Agentic Engine is live!%0A%0A📡 Web: $TUNNEL_URL%0A🔌 Internal: ${OPECODE_URL}%0A📦 Plugin: opencode-agentic-engine v0.1.0%0A⏰ $(date -u +'%Y-%m-%d %H:%M:%S UTC')"

        curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
            -H "Content-Type: application/json" \
            -d "{\"chat_id\":\"${TELEGRAM_CHAT_ID}\",\"text\":\"${MESSAGE}\",\"parse_mode\":\"HTML\"}"

        echo ""
        echo "Telegram notification sent!"

        # Keep container alive until cloudflared exits
        wait "$TUNNEL_PID"
        exit 0
    fi
    echo "Waiting for tunnel URL... ($i/30)"
    sleep 2
done

echo "ERROR: Tunnel URL not found after 60s"
exit 1
