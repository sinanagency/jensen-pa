"""
Re-classify the 76 docs sitting in junk folders (pdfs/uploads/general/docs)
into meaningful folders. Also link docs to entities by name match.

Target taxonomy:
  contracts   - agreements, NDAs, commission, addenda, annexes
  proposals   - pitches, decks, presentations sent to a client/partner
  decks       - brand presentations, Sohum/Upaya pitch decks
  policies    - dress codes, cancellation, refund policy
  operations  - SOPs, sequences of service, training briefs
  pricing     - sales quotations, pricing sheets, package definitions
  brand       - brand statements, bios, credibility decks
  pastes      - "Pasted text(N).txt" - scratchpads
  images      - photos, screenshots
  media       - video, audio
  archives    - zips
  other       - genuine catchall
"""
import json, os, re, subprocess, sys, time, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
def load_env():
    for line in open(os.path.join(ROOT, ".env.local")):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line: continue
        k,v = line.split("=", 1); os.environ[k.strip()] = v.strip().strip('"').strip("'")
load_env()

def keychain(s, a):
    return subprocess.run(["security","find-generic-password","-a",a,"-s",s,"-w"], capture_output=True, text=True).stdout.strip()
ANTHROPIC_KEY = keychain("rinq-anthropic-key", "rinq-anthropic")
SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]


def http(method, url, headers, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    for k,v in headers.items(): req.add_header(k,v)
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            raw = r.read().decode("utf-8")
            return r.status, json.loads(raw) if raw.strip() else {}
    except urllib.error.HTTPError as e:
        b = e.read().decode("utf-8", errors="ignore")
        try: return e.code, json.loads(b)
        except: return e.code, {"_err": b[:300]}

def sb(method, path, body=None):
    return http(method, f"{SUPABASE_URL}/rest/v1/{path}",
        {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
         "content-type": "application/json", "Prefer": "return=minimal"}, body)


FOLDERS = ["contracts","proposals","decks","policies","operations","pricing",
           "brand","pastes","images","media","archives","other"]

CLASSIFY_SYSTEM = f"""You classify business documents into ONE folder for Jensen's hospitality concierge platform.

Folders:
  contracts   - signed/draft agreements, NDAs, commission terms, addenda, annexes
  proposals   - pitches and decks sent to a specific client or partner
  decks       - brand presentations and pitch decks (Sohum, Upaya, brand-side)
  policies    - dress codes, cancellation policy, refund policy, code of conduct
  operations  - SOPs, sequences of service, training briefs, staff procedures
  pricing     - sales quotations, package definitions, AED rate cards
  brand       - brand statements, founder bios, credibility / about decks
  pastes      - generic "Pasted text" or unstructured raw text snippets
  images      - photos, screenshots, image files
  media       - video, audio
  archives    - zip files, compressed bundles
  other       - genuinely nothing fits

Read the title (and content preview if provided). Output a strict JSON:
{{"folder": "<one of the above>", "confidence": "high|medium|low"}}
No prose, no markdown."""

def classify_one(title: str, content_preview: str = "") -> str:
    user = f"Title: {title}\n\nContent preview (first 400 chars):\n{content_preview[:400]}"
    code, body = http("POST", "https://api.anthropic.com/v1/messages",
        headers={"x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json"},
        body={"model": "claude-haiku-4-5-20251001", "max_tokens": 80, "system": CLASSIFY_SYSTEM,
              "messages": [{"role":"user","content": user}]})
    if code >= 300: return "other"
    text = "".join(b.get("text","") for b in body.get("content",[])).strip()
    if text.startswith("```"):
        text = text.split("\n",1)[1] if "\n" in text else text
        if text.endswith("```"): text = text[:-3]
        if text.startswith("json"): text = text[4:]
    s = text.find("{"); e = text.rfind("}")
    if s>=0 and e>s: text = text[s:e+1]
    try:
        f = json.loads(text).get("folder", "other")
        return f if f in FOLDERS else "other"
    except: return "other"


def rule_classify(title: str, mime: str) -> str | None:
    """Fast deterministic shortcuts to skip the LLM where obvious."""
    t = title.lower().strip()
    m = (mime or "").lower()
    # 1. Pasted text files
    if re.match(r"pasted text\s*\(?\d*\)?\.txt", t): return "pastes"
    # 2. WhatsApp chat exports
    if "whatsapp chat" in t: return "archives"
    # 3. Sohum/Upaya brand decks
    if "sohum" in t and ("presentation" in t or "brand" in t): return "decks"
    if "upaya" in t and ("deck" in t or "festival" in t or "surf club" in t): return "decks"
    # 4. Specific known
    if t.startswith("addendum"): return "contracts"
    if t.startswith("annex"): return "contracts"
    if "sales quotation" in t: return "pricing"
    if "cloud kitchen" in t and "rencontre" in t: return "proposals"
    if "credibility" in t: return "brand"
    if t.startswith("cover"): return "brand"
    if "image" in m: return "images"
    if "video" in m: return "media"
    if "zip" in m: return "archives"
    return None


def main():
    code, docs = sb("GET", "docs?select=id,title,folder,mime,content&folder=in.(pdfs,uploads,general,docs)&limit=200")
    if code >= 300:
        print(f"failed to load: {docs}", file=sys.stderr); sys.exit(1)
    print(f"loaded {len(docs)} junk-folder docs")

    # Pre-load entities for matching
    code, ents = sb("GET", "entities?select=id,name")
    by_name = {e["name"].lower(): e["id"] for e in (ents or [])}
    print(f"loaded {len(by_name)} entities for matching")

    updates = []
    t0 = time.time()
    for i, d in enumerate(docs, 1):
        title = d.get("title","")
        # Try rule classifier first (fast, free)
        folder = rule_classify(title, d.get("mime",""))
        if folder is None:
            folder = classify_one(title, d.get("content","") or "")
        # Entity match: scan title for any entity name
        title_l = title.lower()
        entity_id = None
        for ent_name, ent_id in by_name.items():
            if ent_name in title_l and len(ent_name) > 3:
                entity_id = ent_id
                break
        updates.append({"id": d["id"], "folder": folder, "entity_id": entity_id})
        if i % 20 == 0:
            print(f"  [{i}/{len(docs)}] classified ({time.time()-t0:0.0f}s)", flush=True)

    # PATCH each row (PostgREST PATCH on docs?id=eq.<id>)
    from collections import Counter
    print(f"\nfolder distribution after re-classify:")
    for f,n in Counter(u["folder"] for u in updates).most_common():
        print(f"  {f:12} {n}")
    print(f"\nentity-matched: {sum(1 for u in updates if u['entity_id'])}")

    print("\nupdating rows...")
    updated = 0
    for u in updates:
        body = {"folder": u["folder"]}
        if u["entity_id"]: body["entity_id"] = u["entity_id"]
        code, _ = sb("PATCH", f"docs?id=eq.{u['id']}", body)
        if code < 300: updated += 1
    print(f"updated {updated}/{len(updates)} rows.")


if __name__ == "__main__":
    main()
