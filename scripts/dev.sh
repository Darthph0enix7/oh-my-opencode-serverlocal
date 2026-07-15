#!/usr/bin/env bash
# dev.sh — Quick iteration loop: rebuild + sync to cache + suggest restart.
#
# Usage:
#   ./scripts/dev.sh    # rebuilds dist and stages it into OpenCode cache
#
# Workflow when tweaking prompts:
#   1. Edit src/agents/orchestrator.ts (or wherever the prompt lives)
#   2. Run ./scripts/dev.sh
#   3. Run `op restart` to load the new dist
#   4. Test in OpenCode

set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== dev rebuild ==="
./scripts/build.sh --fast

echo ""
echo "=== staging to OpenCode cache ==="
CACHE="${HOME}/.cache/opencode/packages/oh-my-opencode-serverlocal@latest/node_modules/oh-my-opencode-serverlocal"
mkdir -p "$CACHE"
cp -r dist/* "$CACHE/"
cp package.json "$CACHE/"

echo ""
echo "✓ dist staged to cache"
echo ""
echo "Next: run \`op restart\` to load the new build"
