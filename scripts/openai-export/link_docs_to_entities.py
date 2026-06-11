"""
Second-pass entity linking for docs that didn't match by simple title substring.

Loads all unlinked docs (250) + all entities (128). For batches of docs, asks
Haiku which entity each doc is most about. Returns entity_id or null. Batch
update.

Cheaper + smarter than per-doc calls: each LLM call sees all 128 entities once
in the system prompt and processes ~15 docs in one shot.
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
        with urllib.request.urlopen(req, timeout=120) as r:
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


def main():
    # Pull entities
    code, ents = sb("GET", "entities?select=id,name,kind,subtitle&limit=500")
    if code >= 300 or not ents:
        print("no entities", file=sys.stderr); sys.exit(1)
    print(f"loaded {len(ents)} entities")

    # Build a compact entity catalog the model can pick from
    catalog_lines = []
    for i, e in enumerate(ents):
        sub = (e.get("subtitle") or "")[:60]
        catalog_lines.append(f"  E{i+1:03d} [{e['kind']:6}] {e['name']} {f'({sub})' if sub else ''}")
    catalog = "\n".join(catalog_lines)

    # Pull docs that are NOT yet linked
    code, docs = sb("GET", "docs?select=id,title,folder,content&entity_id=is.null&limit=500")
    if code >= 300:
        print(f"docs load failed {code}: {docs}", file=sys.stderr); sys.exit(1)
    # Skip docs whose folder is purely meta (no business linkage useful)
    docs = [d for d in docs if d.get("folder") not in ("pastes", "archives", "media")]
    print(f"loaded {len(docs)} candidate docs to link\n")

    SYSTEM = f"""You are linking business documents to the right entity in Jensen's world.

ENTITIES CATALOG (use the E### code, NOT the name, in your output):
{catalog}

You will receive a batch of documents (each tagged D###). For each one, decide which entity it most clearly belongs to. If no entity is a clear fit, return "null".

Output strict JSON: {{"links": [{{"d": "D001", "e": "E042"}}, {{"d": "D002", "e": "null"}}, ...]}}
No prose, no markdown fences. Be conservative: when in doubt, return "null"."""

    updates = []
    BATCH = 15
    t0 = time.time()
    for i in range(0, len(docs), BATCH):
        chunk = docs[i:i+BATCH]
        lines = []
        for j, d in enumerate(chunk):
            content_preview = (d.get("content") or "")[:200].replace("\n", " ")
            lines.append(f"  D{j+1:03d}  title='{d['title'][:120]}'  folder={d['folder']}  preview='{content_preview}'")
        user = "Documents:\n" + "\n".join(lines)
        code, body = http("POST", "https://api.anthropic.com/v1/messages",
            headers={"x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json"},
            body={"model": "claude-haiku-4-5-20251001", "max_tokens": 1200, "system": SYSTEM,
                  "messages": [{"role":"user","content": user[:80000]}]})
        if code >= 300:
            print(f"  batch {i//BATCH+1} failed {code}", file=sys.stderr)
            continue
        text = "".join(b.get("text","") for b in body.get("content",[])).strip()
        if text.startswith("```"):
            text = text.split("\n",1)[1] if "\n" in text else text
            if text.endswith("```"): text = text[:-3]
            if text.startswith("json"): text = text[4:]
        s = text.find("{"); e = text.rfind("}")
        if s>=0 and e>s: text = text[s:e+1]
        try:
            links = json.loads(text).get("links", []) or []
        except Exception:
            links = []
        for link in links:
            d_code = link.get("d", "")
            e_code = link.get("e", "")
            m = re.match(r"D(\d+)", d_code)
            if not m: continue
            idx = int(m.group(1)) - 1
            if idx < 0 or idx >= len(chunk): continue
            doc_id = chunk[idx]["id"]
            if e_code == "null" or not e_code:
                continue
            m2 = re.match(r"E(\d+)", e_code)
            if not m2: continue
            ent_idx = int(m2.group(1)) - 1
            if ent_idx < 0 or ent_idx >= len(ents): continue
            entity_id = ents[ent_idx]["id"]
            updates.append((doc_id, entity_id))
        print(f"  [{min(i+BATCH, len(docs))}/{len(docs)}] processed, {len(updates)} links so far  ({time.time()-t0:0.0f}s)", flush=True)

    print(f"\nFound {len(updates)} new links. Updating...")
    updated = 0
    for doc_id, entity_id in updates:
        code, _ = sb("PATCH", f"docs?id=eq.{doc_id}", {"entity_id": entity_id})
        if code < 300: updated += 1
    print(f"updated {updated}/{len(updates)} docs.\n")

    # Final state
    code, all_docs = sb("GET", "docs?select=entity_id&limit=500")
    linked = sum(1 for d in (all_docs or []) if d.get("entity_id"))
    print(f"TOTAL: {linked}/{len(all_docs or [])} docs now linked to an entity.")


if __name__ == "__main__":
    main()
