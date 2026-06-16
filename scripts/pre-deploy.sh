#!/usr/bin/env bash
set -euo pipefail

echo "=== Pre-deploy guard for jensen-pa ==="

# 1. Type check
echo "--- TypeScript check ---"
if ! npx tsc --noEmit 2>&1; then
  echo "FAIL: TypeScript errors found. Fix before deploy."
  exit 1
fi
echo "OK"

# 2. Run tests
echo "--- Test suite ---"
if ! npx tsx --test eval/**/*.test.mjs eval/integration/*.test.mjs 2>&1; then
  echo "FAIL: Tests failing. Fix before deploy."
  exit 1
fi
echo "OK"

# 3. Check for uncommitted changes
echo "--- Git status ---"
if [ -n "$(git status --porcelain)" ]; then
  echo "WARN: Uncommitted changes exist."
  git status --short
  echo "Continue anyway? (y/N)"
  read -r answer
  if [ "$answer" != "y" ] && [ "$answer" != "Y" ]; then
    echo "Deploy cancelled. Commit or stash changes first."
    exit 1
  fi
fi
echo "OK"

# 4. Verify ANTHROPIC_API_KEY is set in Vercel
echo "--- Vercel env check ---"
if command -v vercel &>/dev/null; then
  MISSING=0
  for var in ANTHROPIC_API_KEY SUPABASE_URL SUPABASE_SERVICE_KEY WHATSAPP_TOKEN WHATSAPP_PHONE_ID WHATSAPP_VERIFY_TOKEN SESSION_SECRET; do
    if ! vercel env ls 2>/dev/null | grep -q "$var"; then
      echo "MISSING Vercel env: $var"
      MISSING=1
    fi
  done
  if [ $MISSING -eq 1 ]; then
    echo "WARN: Some env vars may be missing from Vercel. Check above."
  fi
fi
echo "OK"

echo "=== Pre-deploy checks passed ==="
