#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUN_PATH="$(which bun)"
USER_HOME="$HOME"
TUNNEL_CONFIG="$HOME/.cloudflared/config-macos-mcp.yml"

echo "=== MacOSMCP launchd Install ==="
echo ""
echo "Project:  $PROJECT_DIR"
echo "Bun:      $BUN_PATH"
echo ""

# Validate
[ -f "$PROJECT_DIR/.env" ] || { echo "Run scripts/install.sh first"; exit 1; }
[ -f "$TUNNEL_CONFIG" ] || { echo "Run scripts/tunnel-setup.sh first"; exit 1; }

# Generate MCP server plist
AGENT_PLIST="$USER_HOME/Library/LaunchAgents/com.macos-mcp.agent.plist"
cat > "$AGENT_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>com.macos-mcp.agent</string>
	<key>ProgramArguments</key>
	<array>
		<string>$BUN_PATH</string>
		<string>src/index.ts</string>
	</array>
	<key>WorkingDirectory</key>
	<string>$PROJECT_DIR</string>
	<key>EnvironmentVariables</key>
	<dict>
		<key>PATH</key>
		<string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$(dirname "$BUN_PATH")</string>
		<key>HOME</key>
		<string>$USER_HOME</string>
	</dict>
	<key>KeepAlive</key>
	<true/>
	<key>RunAtLoad</key>
	<true/>
	<key>StandardOutPath</key>
	<string>$USER_HOME/.macos-mcp/agent.log</string>
	<key>StandardErrorPath</key>
	<string>$USER_HOME/.macos-mcp/agent.err</string>
</dict>
</plist>
EOF

echo "  Wrote: $AGENT_PLIST"

# Generate tunnel plist
TUNNEL_PLIST="$USER_HOME/Library/LaunchAgents/com.macos-mcp.tunnel.plist"
cat > "$TUNNEL_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>com.macos-mcp.tunnel</string>
	<key>ProgramArguments</key>
	<array>
		<string>/usr/local/bin/cloudflared</string>
		<string>tunnel</string>
		<string>--config</string>
		<string>$TUNNEL_CONFIG</string>
		<string>run</string>
	</array>
	<key>KeepAlive</key>
	<true/>
	<key>RunAtLoad</key>
	<true/>
	<key>StandardOutPath</key>
	<string>$USER_HOME/.macos-mcp/tunnel.log</string>
	<key>StandardErrorPath</key>
	<string>$USER_HOME/.macos-mcp/tunnel.err</string>
</dict>
</plist>
EOF

echo "  Wrote: $TUNNEL_PLIST"

# Load services
echo ""
echo "Loading services..."
launchctl unload "$AGENT_PLIST" 2>/dev/null || true
launchctl unload "$TUNNEL_PLIST" 2>/dev/null || true
launchctl load "$AGENT_PLIST"
launchctl load "$TUNNEL_PLIST"

echo ""
echo "=== Services Installed ==="
echo ""
echo "  MCP Server:  com.macos-mcp.agent   (KeepAlive, RunAtLoad)"
echo "  CF Tunnel:   com.macos-mcp.tunnel  (KeepAlive, RunAtLoad)"
echo ""
echo "Check status:"
echo "  launchctl list | grep macos-mcp"
echo ""
echo "Logs:"
echo "  tail -f ~/.macos-mcp/agent.log"
echo "  tail -f ~/.macos-mcp/tunnel.log"
echo ""
echo "To uninstall:"
echo "  launchctl unload $AGENT_PLIST"
echo "  launchctl unload $TUNNEL_PLIST"
echo "  rm $AGENT_PLIST $TUNNEL_PLIST"
