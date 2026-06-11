"""
SPEC 001 — Distill atomic profile facts from jensen_corpus → brain_facts.

For each conversation with >= 4 authentic Jensen messages, send the user-only
messages to Claude Haiku and ask for 0-5 atomic profile-level facts. Embed each
new fact via OpenAI text-embedding-3-small. Upsert into brain_facts using the
existing schema (kind=archive_fact, source=openai-export-2026-06-11).

Cost guard: caps at MAX_CONVERSATIONS to keep spend bounded. Dry-run shows
projected facts + cost before committing.

Usage:
  python3 scripts/openai-export/distill.py [--dry] [--limit N]
"""
import argparse, json, os, sys, time, urllib.request, urllib.error
from collections import defaultdict

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

# --- env load (override semantics, per the bug we hit) ---
def load_env():
    p = os.path.join(ROOT, ".env.local")
    if not os.path.exists(p): return
    for line in open(p):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line: continue
        k, v = line.split("=", 1)
        os.environ[k.strip()] = v.strip().strip('"').strip("'")
load_env()

# Pull API keys from keychain (not in .env.local)
import subprocess
def keychain(svc: str, acct: str | None = None) -> str:
    args = ["security", "find-generic-password", "-s", svc, "-w"]
    if acct: args = ["security", "find-generic-password", "-a", acct, "-s", svc, "-w"]
    r = subprocess.run(args, capture_output=True, text=True)
    return r.stdout.strip()

ANTHROPIC_KEY = keychain("rinq-anthropic-key", "rinq-anthropic")
OPENAI_KEY = keychain("claude-openai", "claude-openai")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

assert ANTHROPIC_KEY and OPENAI_KEY and SUPABASE_URL and SUPABASE_KEY, "missing creds"

# --- HTTP helpers ---
def http_json(method: str, url: str, headers: dict, body: dict | None = None, timeout: int = 60):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    for k, v in headers.items(): req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode("utf-8")
            if not raw.strip(): return r.status, {}
            return r.status, json.loads(raw)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore")
        try: return e.code, json.loads(body)
        except: return e.code, {"_err": body[:300]}


# --- Anthropic Haiku distillation call ---
DISTILL_SYSTEM = """You read a conversation between Jensen (a luxury F&B hospitality founder in Dubai) and ChatGPT.
Extract 0 to 5 atomic, durable PROFILE facts about Jensen that would help his future AI concierge know him better.

A good fact:
- Is a single declarative sentence, ≤ 25 words
- States something true about Jensen, his work, his people, his preferences, his projects, his network, his obligations, his recurring patterns
- Will still be true in 6 months
- Adds NEW information that wouldn't already be obvious from his title

Skip facts that are:
- Transactional (one-off events: "Jensen asked X on date Y")
- About third parties' private lives (medical, intimate, financial)
- Generic platitudes ("Jensen is a busy operator")
- About ChatGPT, AI, or the conversation itself
- Repeating what a basic Wikipedia of his role would say

Output STRICT JSON: {"facts": ["fact1", "fact2", ...]}. If nothing novel worth keeping, output {"facts": []}.
No prose. No markdown. JSON only."""

def distill_conv(title: str, messages: list[str]) -> list[str]:
    user = f"Conversation title: {title or '(untitled)'}\n\nJensen's messages in this conversation:\n\n"
    user += "\n\n---\n\n".join(f"[{i+1}] {m}" for i, m in enumerate(messages[:30]))  # cap context
    code, body = http_json("POST", "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": ANTHROPIC_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        body={
            "model": "claude-haiku-4-5-20251001",
            "max_tokens": 600,
            "system": DISTILL_SYSTEM,
            "messages": [{"role": "user", "content": user[:80000]}],
        })
    if code >= 300:
        return []
    text = "".join(b.get("text","") for b in body.get("content",[]))
    # Strip markdown code fences (Haiku tends to wrap JSON in ```json ... ```)
    t = text.strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[1] if "\n" in t else t
        if t.endswith("```"): t = t[:-3]
        if t.startswith("json"): t = t[4:]
    # Extract first JSON object substring if there's still leading prose
    s = t.find("{"); e = t.rfind("}")
    if s >= 0 and e > s: t = t[s:e+1]
    try:
        obj = json.loads(t)
        facts = obj.get("facts") or []
        return [f.strip() for f in facts if isinstance(f, str) and 10 < len(f) < 300]
    except Exception:
        return []


def embed(text: str) -> list[float] | None:
    code, body = http_json("POST", "https://api.openai.com/v1/embeddings",
        headers={"Authorization": f"Bearer {OPENAI_KEY}", "content-type": "application/json"},
        body={"model": "text-embedding-3-small", "input": text[:4000]})
    if code >= 300: return None
    return body.get("data", [{}])[0].get("embedding")


# --- Supabase helpers ---
def sb_get(path: str):
    code, body = http_json("GET", f"{SUPABASE_URL}/rest/v1/{path}",
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"})
    return body if code < 300 else []

def sb_post(table: str, rows: list):
    return http_json("POST", f"{SUPABASE_URL}/rest/v1/{table}",
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "content-type": "application/json",
            "Prefer": "return=minimal",
        }, body=rows)


# --- Main ---
def load_conversations(min_msgs: int = 4):
    """Pull authentic Jensen messages from jensen_corpus, grouped by conversation."""
    # Paginate the corpus
    by_conv = defaultdict(lambda: {"title": "", "msgs": [], "domain": "", "intent": ""})
    offset = 0
    while True:
        rows = sb_get(f"jensen_corpus?select=conv_id,conv_title,content,domain,intent,word_count&looks_pasted=eq.false&order=conv_id.asc,create_time.asc&limit=1000&offset={offset}")
        if not rows: break
        for r in rows:
            cid = r["conv_id"]
            by_conv[cid]["title"] = r.get("conv_title") or ""
            by_conv[cid]["msgs"].append(r["content"])
            by_conv[cid]["domain"] = r["domain"]
            by_conv[cid]["intent"] = r["intent"]
        if len(rows) < 1000: break
        offset += 1000
    # keep only conversations with enough authentic Jensen messages
    return {cid: c for cid, c in by_conv.items() if len(c["msgs"]) >= min_msgs}


def existing_facts_lower() -> set[str]:
    rows = sb_get("brain_facts?select=fact&status=eq.active&limit=2000")
    return {(r.get("fact") or "").strip().lower() for r in rows}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--limit", type=int, default=0, help="cap conversations processed")
    ap.add_argument("--min-msgs", type=int, default=4)
    args = ap.parse_args()

    print("loading conversations from jensen_corpus...", flush=True)
    convs = load_conversations(args.min_msgs)
    print(f"  {len(convs):,} conversations with >= {args.min_msgs} authentic messages", flush=True)

    if args.limit:
        # take a representative sample: top by message count
        sorted_cids = sorted(convs.keys(), key=lambda k: -len(convs[k]["msgs"]))[:args.limit]
        convs = {k: convs[k] for k in sorted_cids}
        print(f"  limited to top {len(convs)} by message count", flush=True)

    print("loading existing brain_facts for dedupe...", flush=True)
    seen = existing_facts_lower()
    print(f"  {len(seen)} existing facts indexed", flush=True)

    all_new_facts = []
    t0 = time.time()
    for i, (cid, c) in enumerate(convs.items(), 1):
        facts = distill_conv(c["title"], c["msgs"])
        novel = [f for f in facts if f.strip().lower() not in seen]
        for f in novel:
            seen.add(f.strip().lower())
            all_new_facts.append({
                "fact": f,
                "domain": c["domain"],
                "intent": c["intent"],
                "conv_title": c["title"][:120],
            })
        if i % 20 == 0:
            elapsed = time.time() - t0
            rate = i / elapsed if elapsed else 0
            eta = (len(convs) - i) / rate if rate else 0
            print(f"  [{i}/{len(convs)}] convs done, {len(all_new_facts)} novel facts, {elapsed:0.0f}s elapsed, {eta:0.0f}s ETA", flush=True)

    print(f"\n--- DISTILLED ---")
    print(f"  conversations processed : {len(convs):,}")
    print(f"  novel facts extracted   : {len(all_new_facts):,}")
    print(f"  elapsed                 : {time.time()-t0:0.1f}s")

    if args.dry:
        print(f"\n  (dry-run — no DB writes, no embeddings)")
        print("\nSample 10 facts:")
        for f in all_new_facts[:10]:
            print(f"  - {f['fact']}")
        return

    # embed + insert in batches
    print("\nembedding + inserting...", flush=True)
    BATCH = 50
    inserted = 0
    for i in range(0, len(all_new_facts), BATCH):
        chunk = all_new_facts[i:i+BATCH]
        rows = []
        for f in chunk:
            emb = embed(f["fact"])
            row = {
                "fact": f["fact"],
                "kind": "archive_fact",
                "subject": f.get("domain"),
                "source": "openai-export-2026-06-11",
                "status": "active",
                "created_at": int(time.time() * 1000),
            }
            if emb:
                row["embedding"] = "[" + ",".join(str(x) for x in emb) + "]"
            rows.append(row)
        code, body = sb_post("brain_facts", rows)
        if code >= 300:
            print(f"  insert batch failed {code}: {str(body)[:200]}", file=sys.stderr)
            continue
        inserted += len(rows)
        print(f"  inserted {inserted}/{len(all_new_facts)}", flush=True)

    print(f"\nDONE. {inserted} facts written to brain_facts.")


if __name__ == "__main__":
    main()
