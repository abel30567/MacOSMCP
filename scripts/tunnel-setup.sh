#!/bin/bash
set -euo pipefail

TUNNEL_NAME="macos-mcp"
HOSTNAME="${TUNNEL_HOSTNAME:-mac.example.com}"
CONFIG_DIR="$HOME/.cloudflared"

echo "=== MacOSMCP Tunnel Setup ==="
echo ""

# Step 1: Check cloudflared
command -v cloudflared >/dev/null 2>&1 || { echo "Install cloudflared: brew install cloudflared"; exit 1; }

# Step 2: Login if needed
if [ ! -f "$CONFIG_DIR/cert.pem" ]; then
  echo "Step 1: Authenticate with Cloudflare..."
  echo "A browser will open — select the zone for $HOSTNAME"
  cloudflared tunnel login
fi

# Step 3: Create tunnel if it doesn't exist
if cloudflared tunnel list 2>/dev/null | grep -q "$TUNNEL_NAME"; then
  echo "Tunnel '$TUNNEL_NAME' already exists"
  TUNNEL_ID=$(cloudflared tunnel list 2>/dev/null | grep "$TUNNEL_NAME" | awk '{print $1}')
else
  echo "Step 2: Creating tunnel '$TUNNEL_NAME'..."
  cloudflared tunnel create "$TUNNEL_NAME"
  TUNNEL_ID=$(cloudflared tunnel list 2>/dev/null | grep "$TUNNEL_NAME" | awk '{print $1}')
fi

echo "  Tunnel ID: $TUNNEL_ID"

# Step 4: Write tunnel config
TUNNEL_CONFIG="$CONFIG_DIR/config-macos-mcp.yml"
cat > "$TUNNEL_CONFIG" <<EOF
tunnel: $TUNNEL_ID
credentials-file: $CONFIG_DIR/${TUNNEL_ID}.json

ingress:
  - hostname: $HOSTNAME
    service: http://127.0.0.1:3847
    originRequest:
      noTLSVerify: false
  - service: http_status:404
EOF

echo "  Config written to $TUNNEL_CONFIG"

# Step 5: Create DNS route
echo "Step 3: Routing DNS $HOSTNAME -> tunnel..."
cloudflared tunnel route dns "$TUNNEL_NAME" "$HOSTNAME" 2>/dev/null || echo "  DNS route may already exist"

# Step 6: Test tunnel connectivity
echo ""
echo "Step 4: Testing tunnel..."
cloudflared tunnel --config "$TUNNEL_CONFIG" run &
TUNNEL_PID=$!
sleep 5

# Start MCP server briefly to test
cd "$(dirname "$0")/.."
set -a; source .env; set +a
timeout 5 bun src/index.ts &
SERVER_PID=$!
sleep 2

HEALTH=$(curl -s --max-time 5 "https://$HOSTNAME/health" 2>/dev/null || echo '{"ok":false}')
echo "  Health check: $HEALTH"

kill $SERVER_PID 2>/dev/null || true
kill $TUNNEL_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true
wait $TUNNEL_PID 2>/dev/null || true

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Tunnel ID:   $TUNNEL_ID"
echo "Hostname:    https://$HOSTNAME"
echo "Config:      $TUNNEL_CONFIG"
echo ""
echo "Next steps:"
echo "  1. Install launchd services: ./scripts/launchd-install.sh"
echo "  2. Store secrets in Fermi:"
echo "     wrangler secret put MACOS_MCP_URL  # enter: https://$HOSTNAME"
echo "     wrangler secret put MACOS_MCP_TOKEN  # enter your AGENT_TOKEN from .env"
