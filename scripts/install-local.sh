#!/usr/bin/env bash
# install-local.sh — Install the freshly built dist into OpenCode's plugin cache.
#
# Usage:
#   ./scripts/install-local.sh    # copies dist/* into OpenCode's plugin cache
#
# After running this, OpenCode will use OUR fork instead of upstream
# oh-my-opencode-serverlocal on next startup.
#
# This script:
#   1. Removes any existing oh-my-opencode-serverlocal cache
#   2. Removes the upstream oh-my-opencode-serverlocal cache (our replacement)
#   3. Installs our built dist into the @latest cache so OpenCode loads it

set -euo pipefail
cd "$(dirname "$0")/.."

CACHE_BASE="${HOME}/.cache/opencode/packages"

echo "=== installing built dist to OpenCode cache ==="

# Determine our cache target
OUR_CACHE="${CACHE_BASE}/oh-my-opencode-serverlocal@latest"
UPSTREAM_CACHE="${CACHE_BASE}/oh-my-opencode-serverlocal@latest"

# Step 1: clear any existing copies
echo ""
echo "  clearing stale caches..."
if [[ -d "$OUR_CACHE" ]]; then
  rm -rf "$OUR_CACHE"
  echo "    removed: $OUR_CACHE"
fi
if [[ -d "${CACHE_BASE}/oh-my-opencode-serverlocal" ]]; then
  rm -rf "${CACHE_BASE}/oh-my-opencode-serverlocal"
fi
if [[ -d "${CACHE_BASE}/oh-my-opencode-serverlocal" ]]; then
  rm -rf "${CACHE_BASE}/oh-my-opencode-serverlocal"
fi

# Step 2: install ours via npm (using our local tarball), so OpenCode reuses it
echo ""
echo "  building tarball..."
NPM_TARBALL=$(npm pack 2>/dev/null | tail -1)
if [[ -z "$NPM_TARBALL" || ! -f "$NPM_TARBALL" ]]; then
  echo "✗ npm pack failed"
  exit 1
fi
echo "    tarball: $NPM_TARBALL (size: $(wc -c < "$NPM_TARBALL") bytes)"

echo ""
echo "  installing globally (npm will populate cache on next opencode start)..."
npm install -g "$NPM_TARBALL" 2>&1 | tail -3

# Cleanup tarball
rm -f "$NPM_TARBALL"

# Step 3: also stage a copy directly into the cache so OpenCode can find it
# even if the local install command above doesn't refresh the cache
echo ""
echo "  priming cache..."
mkdir -p "${OUR_CACHE}/node_modules/oh-my-opencode-serverlocal"
cp -r dist/* "${OUR_CACHE}/node_modules/oh-my-opencode-serverlocal/"
cp package.json "${OUR_CACHE}/node_modules/oh-my-opencode-serverlocal/"

echo ""
echo "✓ install complete"
echo ""
echo "Cache contents:"
ls "${OUR_CACHE}/node_modules/oh-my-opencode-serverlocal/" 2>/dev/null
