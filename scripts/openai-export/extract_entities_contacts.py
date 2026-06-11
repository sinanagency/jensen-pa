"""
Extract structured entities (venues, clients, events) and contacts (people)
from the brain_facts archive_facts, populate public.entities and public.contacts.

Both tables are empty in the current jensen-pa DB. Rencontre's `list_entities`
and `list_contacts` tools return nothing today. After this run, the bot can
answer "show me my venues" / "who's my contact at TABCo" from grounded data.

Strategy: read distilled facts in batches, ask Haiku to pull structured rows,
dedupe by (kind, name) for entities and by name+company for contacts.
"""
import json, os, re, subprocess, sys, time, uuid, urllib.request

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


def http_json(method, url, headers, body=None):
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
    return http_json(method, f"{SUPABASE_URL}/rest/v1/{path}",
        {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
         "content-type": "application/json", "Prefer": "return=minimal"}, body)


SYSTEM = """You read distilled atomic facts about Jensen (a luxury F&B hospitality founder in Dubai).
Extract structured ENTITIES and CONTACTS he engages with in his work.

ENTITY = a venue, client, brand, event, or organization he operates with or runs. Examples: Sohum Wellness Sanctuary, Upaya Festival, La Rencontre FZE, Arte Museum, One Zaabeel Hotel, TAAMA Restaurant, TABCo International.

CONTACT = a person (named individual) in his network. Examples: Reza (wellness brand owner), Maria Patsatzoglou (online client), Sandra Matur (advisor), Jensen's accountant, his employees.

DO NOT include: Jensen himself, ChatGPT, generic categories like "real estate agents."

For each entity, kind ∈ {venue, client, event}:
- venue: physical place where he operates (Sohum, One Zaabeel, Surf Club Dubai)
- client: consulting client / business he serves (TABCo, GEM Group)
- event: a recurring or named gathering (Upaya Festival, Sohum Prelude)

For each contact:
- name (first + last if known)
- company (entity they're at, if known)
- role (their title/function, if known)
- entity_match (name of an entity they belong to, if obvious)

Output strict JSON: {"entities": [{...}], "contacts": [{...}]}.
Each entity: {name, kind, subtitle, notes}.
Each contact: {name, company, role, notes, entity_match}.
Use "" for unknown fields. No prose, no markdown fences."""


def llm_extract(facts: list[str]) -> tuple[list[dict], list[dict]]:
    user = "Distilled facts about Jensen:\n\n" + "\n".join(f"- {f}" for f in facts[:80])
    code, body = http_json("POST", "https://api.anthropic.com/v1/messages",
        headers={"x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json"},
        body={"model": "claude-haiku-4-5-20251001", "max_tokens": 4000, "system": SYSTEM,
              "messages": [{"role":"user","content": user[:80000]}]})
    if code >= 300: return [], []
    text = "".join(b.get("text","") for b in body.get("content",[]))
    t = text.strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[1] if "\n" in t else t
        if t.endswith("```"): t = t[:-3]
        if t.startswith("json"): t = t[4:]
    s = t.find("{"); e = t.rfind("}")
    if s >= 0 and e > s: t = t[s:e+1]
    try:
        o = json.loads(t)
        return o.get("entities") or [], o.get("contacts") or []
    except: return [], []


def main():
    print("loading archive_facts...")
    code, facts_rows = sb("GET", "brain_facts?select=fact&status=eq.active&source=eq.openai-export-2026-06-11&limit=2000")
    if code >= 300 or not facts_rows:
        print("no facts to mine", file=sys.stderr)
        sys.exit(1)
    facts = [r["fact"] for r in facts_rows if r.get("fact")]
    print(f"  {len(facts)} facts")

    entities, contacts = {}, {}
    BATCH = 60
    t0 = time.time()
    for i in range(0, len(facts), BATCH):
        chunk = facts[i:i+BATCH]
        es, cs = llm_extract(chunk)
        for e in es:
            if not isinstance(e, dict): continue
            name = (e.get("name") or "").strip()
            kind = (e.get("kind") or "").strip().lower()
            if not name or len(name) < 2 or kind not in ("venue","client","event"): continue
            key = (kind, name.lower())
            if key not in entities:
                entities[key] = {
                    "id": uuid.uuid4().hex[:12],
                    "kind": kind, "name": name[:120],
                    "subtitle": (e.get("subtitle") or "")[:200],
                    "status": "active",
                    "notes": (e.get("notes") or "")[:400],
                    "created_at": int(time.time() * 1000),
                }
        for c in cs:
            if not isinstance(c, dict): continue
            name = (c.get("name") or "").strip()
            if not name or len(name) < 2 or name.lower() == "jensen" or name.lower().startswith("jensen "): continue
            company = (c.get("company") or "").strip()
            key = (name.lower(), company.lower())
            if key not in contacts:
                contacts[key] = {
                    "id": uuid.uuid4().hex[:12],
                    "name": name[:120],
                    "company": company[:120],
                    "role": (c.get("role") or "")[:120],
                    "email": "", "phone": "",
                    "notes": (c.get("notes") or "")[:400],
                    "entity_id": None,  # match resolution below
                    "created_at": int(time.time() * 1000),
                }
        print(f"  batch {i//BATCH+1}/{(len(facts)+BATCH-1)//BATCH}: {len(entities)} entities, {len(contacts)} contacts ({time.time()-t0:0.0f}s)", flush=True)

    # Match contacts to entities by company name
    by_name = {e["name"].lower(): e["id"] for e in entities.values()}
    for c in contacts.values():
        comp = c["company"].lower()
        if comp and comp in by_name:
            c["entity_id"] = by_name[comp]

    print(f"\n--- EXTRACTED ---")
    print(f"  entities: {len(entities)}")
    print(f"  contacts: {len(contacts)}")

    if entities:
        print("\ninserting entities...")
        rows = list(entities.values())
        for i in range(0, len(rows), 50):
            code, body = sb("POST", "entities", rows[i:i+50])
            if code >= 300: print(f"  batch failed {code}: {str(body)[:200]}", file=sys.stderr)
            else: print(f"  inserted {min(i+50, len(rows))}/{len(rows)} entities")

    if contacts:
        print("inserting contacts...")
        rows = list(contacts.values())
        for i in range(0, len(rows), 50):
            code, body = sb("POST", "contacts", rows[i:i+50])
            if code >= 300: print(f"  batch failed {code}: {str(body)[:200]}", file=sys.stderr)
            else: print(f"  inserted {min(i+50, len(rows))}/{len(rows)} contacts")

    print("\nDONE.")


if __name__ == "__main__":
    main()
