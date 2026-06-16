#!/bin/bash
# Tail Jensen's chat with Dorje in real time. Polls chat_messages every 2s.
# Usage: bash scripts/tail-chat.sh
#   (uses .env.prod or .env.local in the project root)

cd "$(dirname "$0")/.." || exit 1

ENV_FILE=".env.prod"
[ ! -f "$ENV_FILE" ] && ENV_FILE=".env.local"
[ ! -f "$ENV_FILE" ] && echo "No .env.prod or .env.local found" && exit 1

# Strip quotes from values
URL=$(grep ^SUPABASE_URL "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"')
KEY=$(grep ^SUPABASE_SERVICE_KEY "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"')

LAST_ID=0
echo "Tailing Jensen's chat from $ENV_FILE ... (Ctrl+C to stop)"
echo "---"

while true; do
  RESULT=$(curl -s "${URL}/rest/v1/chat_messages?party=eq.jensen&id=gt.$LAST_ID&order=id.asc" \
    -H "apikey: $KEY" -H "Authorization: Bearer $KEY" 2>/dev/null)

  if [ -n "$RESULT" ] && [ "$RESULT" != "[]" ]; then
    python3 -c "
import sys, json
from datetime import datetime, timezone, timedelta
rows = json.load(sys.stdin)
if not rows: exit()
for r in rows:
    ts = r['ts']
    dt = datetime.fromtimestamp(ts/1000, tz=timezone(timedelta(hours=4)))
    t = dt.strftime('%H:%M:%S')
    role = '→ Jensen' if r['role'] == 'assistant' else 'Jensen →'
    content = r.get('content','')[:500]
    print(f'[{t}] {role} {content}')
" <<< "$RESULT" 2>/dev/null

    LAST_ID=$(python3 -c "import sys,json; rows=json.loads('''$RESULT'''); print(rows[-1]['id'])" 2>/dev/null)
  fi

  sleep 2
done
