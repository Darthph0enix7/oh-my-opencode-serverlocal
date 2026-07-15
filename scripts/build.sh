#!/usr/bin/env bash
# build.sh — Build the serverlocal fork of oh-my-opencode-slim.
#
# Usage:
#   ./scripts/build.sh           # full build (clean → plugin → cli → schema)
#   ./scripts/build.sh --fast    # skip clean + schema (faster iteration)
#
# Output: dist/index.js, dist/tui.js, dist/cli/index.js, *.d.ts, schema

set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "${1:-}" == "--fast" ]]; then
  echo "=== fast build (plugin + cli) ==="
  bun run build:plugin
  bun run build:cli
  echo "✓ fast build complete"
else
  echo "=== full build ==="
  bun run build
  echo "✓ full build complete"
fi

echo ""
echo "Built artifacts:"
ls -lh dist/*.js dist/*.d.ts 2>/dev/null | awk '{print "  " $NF "  (" $5 ")"}'
