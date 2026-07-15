#!/usr/bin/env bash
# publish.sh — Build and publish oh-my-opencode-serverlocal to npm.
#
# Usage:
#   ./scripts/publish.sh patch    # 0.1.0 → 0.1.1 (bug fixes)
#   ./scripts/publish.sh minor    # 0.1.0 → 0.2.0 (new features)
#   ./scripts/publish.sh major    # 0.1.0 → 1.0.0 (breaking changes)
#   ./scripts/publish.sh          # defaults to patch
#
# Requires:
#   npm login (one-time setup)
#   2FA configured on the npm account (publishing requires an OTP)
#
# What this does:
#   1. Bumps version in package.json (patch/minor/major)
#   2. Builds clean
#   3. Runs `npm publish --access public --otp=<prompt>`
#   4. Commits version bump + pushes to fork

set -euo pipefail
cd "$(dirname "$0")/.."

BUMP="${1:-patch}"
if [[ ! "$BUMP" =~ ^(patch|minor|major)$ ]]; then
  echo "Usage: $0 [patch|minor|major]"
  exit 1
fi

echo "=== verifying npm auth ==="
NPM_USER=$(npm whoami 2>/dev/null || echo "")
if [[ -z "$NPM_USER" ]]; then
  echo "✗ Not logged in to npm. Run: npm login"
  exit 1
fi
echo "  logged in as: $NPM_USER"

echo ""
echo "=== current state ==="
CURRENT=$(node -e "console.log(require('./package.json').version)")
echo "  current version: $CURRENT"
echo "  bump type: $BUMP"

echo ""
echo "=== running pre-publish checks ==="
echo "  - biome check (skip — use ./scripts/check.sh)"
echo "  - bun test (skip — use ./scripts/check.sh)"
echo "  ...run checks manually if you want, or trust your local edits"

echo ""
echo "=== bumping version ==="
npm version "$BUMP" --no-git-tag-version
NEW=$(node -e "console.log(require('./package.json').version)")
echo "  new version: $NEW"

echo ""
echo "=== building ==="
bun run build

echo ""
echo "=== running tests (last sanity check) ==="
if bun test --bail 2>&1 | tail -10; then
  echo "  tests pass"
else
  echo ""
  echo "✗ Tests failed. Rolling back version bump..."
  git checkout -- package.json
  exit 1
fi

echo ""
echo "=== committing + tagging ==="
git add package.json bun.lock 2>/dev/null || true
git add dist/ 2>/dev/null || true
git commit -m "release: v$NEW" --allow-empty
git push origin master --follow-tags

echo ""
echo "=== publishing to npm ==="
echo "  package name: oh-my-opencode-serverlocal"
echo "  version:      $NEW"
echo "  tag:          latest"
echo ""
read -rp "  Enter your npm OTP (or Ctrl+C to cancel): " OTP
npm publish --access public --otp="$OTP" --tag latest

echo ""
echo "=== syncing to local OpenCode cache ==="
./scripts/install-local.sh

echo ""
echo "✓ Published oh-my-opencode-serverlocal@$NEW"
echo ""
echo "Don't forget to restart OpenCode: op restart"
