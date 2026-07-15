#!/usr/bin/env bash
# sync-upstream.sh — Pull upstream alvinunreal/oh-my-opencode-serverlocal into our fork.
#
# Usage:
#   ./scripts/sync-upstream.sh           # one-time: add upstream remote
#   ./scripts/sync-upstream.sh fetch     # fetch upstream + show log
#   ./scripts/sync-upstream.sh merge     # merge upstream/master into our master
#
# Workflow:
#   1. ./scripts/sync-upstream.sh merge  # merges in upstream changes
#   2. Resolve any conflicts in src/agents/, src/hooks/, src/index.ts
#   3. ./scripts/check.sh                # verify nothing broke
#   4. ./scripts/dev.sh                  # rebuild + stage to cache
#   5. ./scripts/publish.sh patch        # ship to npm

set -euo pipefail
cd "$(dirname "$0")/.."

UPSTREAM_URL="https://github.com/alvinunreal/oh-my-opencode-serverlocal.git"

# Step 0: ensure upstream remote exists
if ! git remote get-url upstream >/dev/null 2>&1; then
  echo "=== adding upstream remote ==="
  git remote add upstream "$UPSTREAM_URL"
  echo "  added: $UPSTREAM_URL"
  echo ""
  echo "Run this command again to actually fetch."
  exit 0
fi

case "${1:-fetch}" in
  fetch)
    echo "=== fetching upstream ==="
    git fetch upstream master
    echo ""
    echo "Commits on upstream since our last sync:"
    git log --oneline upstream/master ^master | head -20
    echo ""
    echo "Next: \`./scripts/sync-upstream.sh merge\`"
    ;;
  merge)
    echo "=== merging upstream into our master ==="
    echo "  ⚠ You may have conflicts to resolve manually"
    echo "  ⚠ Especially likely in: src/agents/, src/hooks/, src/index.ts, package.json"
    echo ""
    git fetch upstream master
    git merge upstream/master --no-ff -m "merge: pull upstream changes from alvinunreal/oh-my-opencode-serverlocal"
    echo ""
    echo "=== post-merge state ==="
    git status --short
    echo ""
    if [[ -z "$(git status --short)" ]]; then
      echo "✓ clean merge, no conflicts"
      echo ""
      echo "Next: ./scripts/check.sh to verify"
    else
      echo "✗ unresolved conflicts — fix and commit"
    fi
    ;;
  *)
    echo "Usage: $0 [fetch|merge]"
    exit 1
    ;;
esac
