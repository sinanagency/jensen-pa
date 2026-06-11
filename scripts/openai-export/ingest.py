"""
SPEC 001 — Ingest Jensen's OpenAI export into public.jensen_corpus.

Parses 12 conversations-*.json shards from specs/001-export-mining/raw/,
walks each conversation's mapping tree, keeps user-role messages only,
redacts PII, tags domain + intent, upserts to Supabase via PostgREST.

Idempotent on (conv_id, msg_id). Safe to rerun.

Usage:
  python3 scripts/openai-export/ingest.py [--dry] [--limit N]

--dry      : parse + classify, no DB writes. Prints sample + totals.
--limit N  : process only the first N conversations across all shards.
"""
import argparse, glob, json, os, sys, time, urllib.parse, urllib.request
from datetime import datetime, timezone
from typing import Iterator, Optional

sys.path.insert(0, os.path.dirname(__file__))
from redact import redact
from cluster import classify

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
RAW = os.path.join(ROOT, "specs", "001-export-mining", "raw")
SOURCE_TAG = "openai-export-2026-06-11"
MIN_WORDS = 4   # drop "ok thanks" style noise messages

# ---------- env load ----------
def load_env():
    p = os.path.join(ROOT, ".env.local")
    if not os.path.exists(p):
        return
    for line in open(p):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ[k.strip()] = v.strip().strip('"').strip("'")  # override, not setdefault

load_env()
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
if not SUPABASE_URL or not SUPABASE_KEY:
    print("ERROR: SUPABASE_URL / SUPABASE_SERVICE_KEY missing in .env.local", file=sys.stderr)


# ---------- supabase ----------
def sb_post(table: str, rows: list, prefer_resolution: str = "merge-duplicates"):
    url = f"{SUPABASE_URL}/rest/v1/{table}?on_conflict=conv_id,msg_id"
    body = json.dumps(rows).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("apikey", SUPABASE_KEY)
    req.add_header("Authorization", f"Bearer {SUPABASE_KEY}")
    req.add_header("Content-Type", "application/json")
    req.add_header("Prefer", f"resolution={prefer_resolution},return=minimal")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode("utf-8", errors="ignore")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="ignore")


# ---------- parse one conversation ----------
def walk_user_messages(c: dict) -> Iterator[dict]:
    """Yield each user-authored message in this conversation."""
    mapping = c.get("mapping") or {}
    title = (c.get("title") or "").strip()
    conv_id = c.get("conversation_id") or c.get("id") or ""
    if not conv_id:
        return

    # Pre-compute concatenated sibling text per conversation (Jensen's other turns)
    # for context-aware classification.
    sibling_text_parts = []
    for node in mapping.values():
        m = node.get("message")
        if not m:
            continue
        if ((m.get("author") or {}).get("role")) != "user":
            continue
        for p in (m.get("content") or {}).get("parts") or []:
            if isinstance(p, str):
                sibling_text_parts.append(p)
    siblings = " ".join(sibling_text_parts)[:4000]

    for node_id, node in mapping.items():
        m = node.get("message")
        if not m:
            continue
        author = (m.get("author") or {}).get("role") or ""
        if author != "user":
            continue
        content_obj = m.get("content") or {}
        parts = content_obj.get("parts") or []
        text_parts = [p for p in parts if isinstance(p, str) and p.strip()]
        if not text_parts:
            continue
        content = "\n".join(text_parts).strip()
        if not content or len(content.split()) < MIN_WORDS:
            continue

        create_time = m.get("create_time")
        yield {
            "conv_id": conv_id,
            "conv_title": title,
            "msg_id": m.get("id") or node_id,
            "raw_content": content,
            "create_time": create_time,
            "_siblings": siblings,
        }


def detect_paste_back(content: str) -> bool:
    """Heuristic: text Jensen pasted IN from somewhere (his own past draft, or
    GPT's earlier output) to be polished, rather than his native composition.

    Signals:
      - em-dashes / en-dashes (Jensen does not type these in WhatsApp/email)
      - extreme length (>400 words in a single user turn is almost always a
        draft pasted in for polish)
    Both are conservative — false positives = the corpus is slightly smaller
    for voice modelling but RAG still has everything (we tag, not drop).
    """
    if "—" in content or "–" in content:
        return True
    if len(content.split()) > 400:
        return True
    return False


def build_row(raw: dict) -> dict:
    redacted, pii_kinds = redact(raw["raw_content"])
    domain, intent = classify(redacted, raw.get("conv_title") or "", raw.get("_siblings") or "")
    create_iso = (
        datetime.fromtimestamp(raw["create_time"], tz=timezone.utc).isoformat()
        if raw.get("create_time") else None
    )
    return {
        "conv_id": raw["conv_id"],
        "conv_title": raw.get("conv_title"),
        "msg_id": raw["msg_id"],
        "content": redacted,
        "word_count": len(redacted.split()),
        "create_time": create_iso,
        "domain": domain,
        "intent": intent,
        "contains_pii": bool(pii_kinds),
        "pii_kinds": pii_kinds,
        "looks_pasted": detect_paste_back(redacted),
        "source": SOURCE_TAG,
    }


# ---------- main ----------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true", help="parse + classify, no DB writes")
    ap.add_argument("--limit", type=int, default=0, help="limit total conversations")
    ap.add_argument("--batch", type=int, default=200, help="rows per POST batch")
    args = ap.parse_args()

    shards = sorted(glob.glob(os.path.join(RAW, "conversations-*.json")))
    if not shards:
        print(f"ERROR: no shards in {RAW}", file=sys.stderr)
        sys.exit(1)

    total_convos = 0
    total_msgs = 0
    skipped_noise = 0
    written = 0
    pii_rows = 0
    domain_counts: dict[str, int] = {}
    intent_counts: dict[str, int] = {}

    batch: list[dict] = []
    t0 = time.time()

    for shard in shards:
        with open(shard) as f:
            convos = json.load(f)
        for c in convos:
            if args.limit and total_convos >= args.limit:
                break
            total_convos += 1
            for raw in walk_user_messages(c):
                row = build_row(raw)
                total_msgs += 1
                if row["contains_pii"]:
                    pii_rows += 1
                domain_counts[row["domain"]] = domain_counts.get(row["domain"], 0) + 1
                intent_counts[row["intent"]] = intent_counts.get(row["intent"], 0) + 1
                batch.append(row)
                if not args.dry and len(batch) >= args.batch:
                    code, body = sb_post("jensen_corpus", batch)
                    if code >= 300:
                        print(f"\n  POST failed {code}: {body[:300]}", file=sys.stderr)
                        sys.exit(2)
                    written += len(batch)
                    print(f"  wrote {written:,} / {total_msgs:,} parsed  ({time.time()-t0:0.1f}s)", flush=True)
                    batch = []
        if args.limit and total_convos >= args.limit:
            break

    if not args.dry and batch:
        code, body = sb_post("jensen_corpus", batch)
        if code >= 300:
            print(f"  final POST failed {code}: {body[:300]}", file=sys.stderr)
            sys.exit(2)
        written += len(batch)

    elapsed = time.time() - t0
    print(f"\n--- DONE in {elapsed:0.1f}s ---")
    print(f"  conversations scanned : {total_convos:,}")
    print(f"  user messages parsed  : {total_msgs:,}")
    print(f"  containing PII        : {pii_rows:,}")
    print(f"  written to DB         : {written:,}" + ("  (dry-run, no writes)" if args.dry else ""))
    print(f"\nDomain distribution:")
    for d, n in sorted(domain_counts.items(), key=lambda kv: -kv[1]):
        print(f"  {d:25} {n:5}")
    print(f"\nIntent distribution:")
    for i, n in sorted(intent_counts.items(), key=lambda kv: -kv[1]):
        print(f"  {i:15} {n:5}")


if __name__ == "__main__":
    main()
