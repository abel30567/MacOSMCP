#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a; source .env; set +a
fi

echo "Starting MacOSMCP on port ${PORT:-3847}..."
exec bun src/index.ts
