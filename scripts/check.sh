#!/usr/bin/env bash
# check.sh — Run all pre-publish quality gates.
#
# Usage:
#   ./scripts/check.sh    # biome check + typecheck + tests
#
# Mirrors the AGENTS.md "before pushing" workflow:
#   1. bun run check:ci  (biome lint + format)
#   2. bun run typecheck
#   3. bun test

set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== biome check:ci ==="
bun run check:ci

echo ""
echo "=== typecheck ==="
bun run typecheck

echo ""
echo "=== tests ==="
bun test

echo ""
echo "✓ all checks pass"
