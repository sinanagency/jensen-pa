#!/usr/bin/env bash
# Installs the project's git hooks by pointing core.hooksPath at hooks/.
# Runs automatically via `npm install` (postinstall). Idempotent.
#
# Why this exists: commit e3c3fe8 leaked .env.vercel.prod to GitHub. The
# pre-commit hook in hooks/ blocks that class of mistake at the source.
# Every fresh clone needs to install it; this script makes that automatic.

set -e

# Skip if not in a git repo (e.g. when this package is consumed as a dep,
# which shouldn't happen for a private app but be defensive).
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  exit 0
fi

# Check the hooks dir exists. If hooks/pre-commit was deleted somehow, fail
# loud rather than silently leaving the repo unprotected.
if [[ ! -f "hooks/pre-commit" ]]; then
  echo "  ⚠ hooks/pre-commit not found, skipping installation" >&2
  exit 0
fi

# Point git at our hooks dir. This is a per-clone config (.git/config), not
# committed, so re-running install is what activates it on each new clone.
git config core.hooksPath hooks

# Ensure hooks are executable. Should already be from git, but defensive.
chmod +x hooks/pre-commit 2>/dev/null || true

echo "  ✓ git hooks installed (pre-commit secret guard active)"
