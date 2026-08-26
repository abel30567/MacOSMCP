#!/bin/bash
set -euo pipefail

echo "=== MacOSMCP Install ==="

command -v brew >/dev/null 2>&1 || { echo "Install Homebrew first: https://brew.sh"; exit 1; }

echo "Installing system dependencies..."
brew install cliclick cloudflared 2>/dev/null || true

mkdir -p ~/.macos-mcp

if [ ! -f .env ]; then
  TOKEN=$(openssl rand -hex 32)
  cat > .env <<EOF
AGENT_TOKEN=$TOKEN
PORT=3847
ALLOWED_PATHS=$HOME,/tmp
LOG_DIR=$HOME/.macos-mcp
EOF
  echo ""
  echo "Generated .env with AGENT_TOKEN"
  echo "IMPORTANT: Save this token — you'll need it for the Fermi Worker config"
  echo "Token: $TOKEN"
  echo ""
fi

echo "Installing Node dependencies..."
bun install

echo ""
echo "=== Done ==="
echo ""
echo "Next steps:"
echo "  1. Test locally:     bun run dev"
echo "  2. Setup tunnel:     ./scripts/tunnel-setup.sh"
echo "  3. Install services: ./scripts/launchd-install.sh"
