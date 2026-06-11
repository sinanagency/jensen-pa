"""
Extract contract templates, signed agreements, policies, and other reusable
documents from the OpenAI export and populate the docs table in the jensen-pa
portal.

Strategy:
  1. Query jensen_corpus for legal/contract-flavored conversations (intent='legal'
     OR conversations whose titles include agreement/contract/nda).
  2. Group messages by conversation, concatenate.
  3. Send each conv to Claude Haiku with instructions to extract any embedded
     documents (templates, signed agreements, formal policies, SOPs).
  4. Each doc gets a title, kind, parties, folder, and cleaned content.
  5. Dedupe against existing docs.title (case-insensitive) before insert.
"""
import argparse, json, os, re, subprocess, sys, time, uuid, urllib.request, urllib.error
from collections import defaultdict

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

def load_env():
    p = os.path.join(ROOT, ".env.local")
    for line in open(p):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line: continue
        k, v = line.split("=", 1)
        os.environ[k.strip()] = v.strip().strip('"').strip("'")
load_env()

def keychain(svc, acct):
    r = subprocess.run(["security","find-generic-password","-a",acct,"-s",svc,"-w"], capture_output=True, text=True)
    return r.stdout.strip()

ANTHROPIC_KEY = keychain("rinq-anthropic-key", "rinq-anthropic")
SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]


def http_json(method, url, headers, body=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    for k,v in headers.items(): req.add_header(k,v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode("utf-8")
            return r.status, json.loads(raw) if raw.strip() else {}
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore")
        try: return e.code, json.loads(body)
        except: return e.code, {"_err": body[:400]}


EXTRACT_SYSTEM = """You are reading a conversation between Jensen (a luxury F&B hospitality founder in Dubai) and ChatGPT. He used ChatGPT extensively to draft, refine, and proofread real business documents.

Your job: find any DOCUMENTS in this conversation worth saving to his document library.

A document is:
- A contract or agreement (NDA, partnership agreement, commission agreement, service agreement, etc.)
- A formal proposal he sent or received
- A policy (dress code, cancellation policy, refund policy, code of conduct)
- An SOP (sequence of service, standard procedure, training brief)
- A pricing sheet, package definition, or service catalog
- A bio or brand statement he uses externally

Skip:
- One-off email replies, casual notes, brainstorming
- Captions or social posts
- Anything under 100 words of actual document text

For EACH document you find, output a JSON object:
{
  "title": "Clear descriptive title, max 80 chars, what this document IS",
  "kind": "contract|agreement|policy|sop|proposal|pricing|bio|other",
  "folder": "contracts|policies|operations|proposals|pricing|brand|general",
  "parties": "Counter-party names if any, comma-separated, else empty string",
  "content": "The full cleaned text of the document, no surrounding chat, em-dashes replaced with commas/periods",
  "doc_date_iso": "YYYY-MM-DD if a clear date appears in the doc, else empty string"
}

Output strict JSON: {"documents": [obj, obj, ...]}. Empty {"documents": []} if nothing qualifies. No prose, no markdown fences."""


def parse_response(text: str) -> list[dict]:
    t = text.strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[1] if "\n" in t else t
        if t.endswith("```"): t = t[:-3]
        if t.startswith("json"): t = t[4:]
    s = t.find("{"); e = t.rfind("}")
    if s >= 0 and e > s: t = t[s:e+1]
    try:
        return json.loads(t).get("documents", []) or []
    except: return []


def extract(title: str, messages: list[str]) -> list[dict]:
    user = f"Conversation title: {title or '(untitled)'}\n\nJensen's messages:\n\n"
    user += "\n\n---\n\n".join(messages[:40])
    code, body = http_json("POST", "https://api.anthropic.com/v1/messages",
        headers={"x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json"},
        body={"model": "claude-haiku-4-5-20251001", "max_tokens": 4000,
              "system": EXTRACT_SYSTEM,
              "messages": [{"role":"user","content": user[:80000]}]})
    if code >= 300: return []
    text = "".join(b.get("text","") for b in body.get("content",[]))
    docs = parse_response(text)
    cleaned = []
    for d in docs:
        if not isinstance(d, dict): continue
        c = (d.get("content") or "").strip()
        if len(c) < 100: continue                # min body
        c = c.replace("—", ",").replace("–", ",") # L5 strip at extract time
        cleaned.append({
            "title": (d.get("title") or "(untitled)")[:120].strip(),
            "kind": d.get("kind") or "document",
            "folder": d.get("folder") or "general",
            "parties": (d.get("parties") or "")[:200],
            "content": c,
            "doc_date_iso": (d.get("doc_date_iso") or "").strip() or None,
        })
    return cleaned


def sb(method, path, body=None):
    return http_json(method, f"{SUPABASE_URL}/rest/v1/{path}",
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
                 "content-type": "application/json", "Prefer": "return=minimal"},
        body=body)


def candidate_conversations() -> list[tuple[str, str, list[str]]]:
    """Pull document-shaped conversations: legal-intent + contract-titled long ones."""
    seen = {}
    # Strategy 1: all legal-intent authentic messages
    offset = 0
    while True:
        code, rows = sb("GET", f"jensen_corpus?select=conv_id,conv_title,content,word_count,intent,looks_pasted&intent=eq.legal&order=conv_id.asc,create_time.asc&limit=1000&offset={offset}")
        if code >= 300 or not rows: break
        for r in rows:
            cid = r["conv_id"]
            if cid not in seen:
                seen[cid] = {"title": r.get("conv_title") or "", "msgs": []}
            seen[cid]["msgs"].append(r["content"])
        if len(rows) < 1000: break
        offset += 1000
    # Strategy 2: conv titles with contract/agreement/proposal keywords
    title_kws = ["agreement", "contract", "nda", "commission", "partnership", "proposal", "terms", "policy"]
    or_filter = ",".join(f"conv_title.ilike.*{k}*" for k in title_kws)
    code, rows = sb("GET", f"jensen_corpus?select=conv_id,conv_title,content&or=({or_filter})&order=conv_id.asc,create_time.asc&limit=2000")
    if code < 300 and rows:
        for r in rows:
            cid = r["conv_id"]
            if cid not in seen:
                seen[cid] = {"title": r.get("conv_title") or "", "msgs": []}
            if r["content"] not in seen[cid]["msgs"]:
                seen[cid]["msgs"].append(r["content"])
    # Filter to convs with at least one meaningful message (>= 50 words)
    out = []
    for cid, c in seen.items():
        if any(len(m.split()) >= 50 for m in c["msgs"]):
            out.append((cid, c["title"], c["msgs"]))
    return out


def existing_titles_lower() -> set[str]:
    code, rows = sb("GET", "docs?select=title&limit=2000")
    if code >= 300: return set()
    return {(r.get("title") or "").strip().lower() for r in rows}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    print("loading candidate conversations...", flush=True)
    convs = candidate_conversations()
    print(f"  {len(convs)} candidates", flush=True)
    if args.limit:
        convs.sort(key=lambda x: -sum(len(m) for m in x[2]))
        convs = convs[:args.limit]
        print(f"  limited to {len(convs)} longest", flush=True)

    print("loading existing docs.title for dedupe...", flush=True)
    seen = existing_titles_lower()
    print(f"  {len(seen)} existing titles", flush=True)

    all_docs = []
    t0 = time.time()
    for i, (cid, title, msgs) in enumerate(convs, 1):
        docs = extract(title, msgs)
        novel = [d for d in docs if d["title"].lower() not in seen]
        for d in novel:
            seen.add(d["title"].lower())
            d["conv_id"] = cid
            d["src_conv_title"] = title
            all_docs.append(d)
        if i % 10 == 0:
            elapsed = time.time() - t0
            eta = elapsed * (len(convs) - i) / i
            print(f"  [{i}/{len(convs)}] {len(all_docs)} docs found, {elapsed:0.0f}s elapsed, {eta:0.0f}s ETA", flush=True)

    print(f"\n--- EXTRACTED ---")
    print(f"  candidates processed : {len(convs)}")
    print(f"  novel documents      : {len(all_docs)}")
    print(f"  elapsed              : {time.time()-t0:0.1f}s")

    if args.dry:
        print("\nSample 8:")
        for d in all_docs[:8]:
            print(f"  [{d['folder']}/{d['kind']}] {d['title']} ({len(d['content'])} chars)")
        return

    print("\ninserting...", flush=True)
    inserted = 0
    BATCH = 30
    for i in range(0, len(all_docs), BATCH):
        chunk = all_docs[i:i+BATCH]
        rows = []
        now = int(time.time() * 1000)
        for d in chunk:
            doc_id = uuid.uuid4().hex[:12]
            file_name = re.sub(r"[^a-zA-Z0-9._\- ]", "", d["title"])[:80] + ".txt"
            rows.append({
                "id": doc_id,
                "title": d["title"],
                "file_name": file_name,
                "mime": "text/plain",
                "kind": d["kind"],
                "content": d["content"],
                "size": len(d["content"]),
                "folder": d["folder"],
                "sensitivity": "normal",
                "created_at": now,
                "doc_date": d.get("doc_date_iso"),
            })
        code, body = sb("POST", "docs", rows)
        if code >= 300:
            print(f"  insert batch {i//BATCH+1} failed {code}: {str(body)[:200]}", file=sys.stderr)
            continue
        inserted += len(rows)
        print(f"  inserted {inserted}/{len(all_docs)}", flush=True)

    print(f"\nDONE. {inserted} documents written to docs.")


if __name__ == "__main__":
    main()
