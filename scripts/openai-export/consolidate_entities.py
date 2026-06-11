"""
Merge near-duplicate entities created by the LLM distillation pass.

LLM (Haiku) clusters the 128 entities into groups of refer-to-the-same-thing.
For each group, pick the LONGEST descriptive name as canonical. Then:
  1. PATCH every docs.entity_id pointing to a duplicate → point to canonical
  2. PATCH every contacts.entity_id same
  3. DELETE the duplicate entity rows

Logs every merge to specs/001-export-mining/ENTITY-MERGES.md for audit.
"""
import json, os, re, subprocess, sys, time, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
LOG = os.path.join(ROOT, "specs", "001-export-mining", "ENTITY-MERGES.md")

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


SYSTEM = """You are consolidating duplicate entities in a business contact database.

You will receive a numbered list of entities (id, kind, name, subtitle).
Cluster ONLY entities that refer to the SAME business / venue / event in the real world. Different brands or unrelated venues that happen to share a word do NOT cluster.

Examples of valid clusters:
  - "Sohum", "Sohum Cafe", "Sohum Wellness Sanctuary" → same Sohum brand
  - "Upaya", "UPAYA Premium Beachfront Hospitality", "Upaya Festival" → same Upaya
  - "La Rencontre FZE", "La Rencontre" → same company
  - "Birds Dubai", "Birds" → same venue (if context is the same)

Examples that should NOT cluster:
  - "Four Seasons" and "Four Seasons Dubai" — same brand but treat as one only if both refer to the SAME hotel
  - Unrelated venues with same word ("Sphere" the venue vs "Sphere" the project)

Output strict JSON: {"clusters": [["E001","E045","E067"], ["E002","E089"], ...]}.
Only include clusters with 2+ entities. Singletons (no merge needed) are omitted.
No prose, no markdown fences."""


def main():
    code, ents = sb("GET", "entities?select=id,name,kind,subtitle&limit=500")
    if code >= 300 or not ents:
        print("no entities", file=sys.stderr); sys.exit(1)
    print(f"loaded {len(ents)} entities")

    # Build catalog for LLM
    lines = []
    for i, e in enumerate(ents):
        sub = (e.get("subtitle") or "")[:60]
        lines.append(f"  E{i+1:03d} [{e['kind']:6}] {e['name']} {f'({sub})' if sub else ''}")
    catalog = "\n".join(lines)

    code, body = http("POST", "https://api.anthropic.com/v1/messages",
        headers={"x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json"},
        body={"model": "claude-haiku-4-5-20251001", "max_tokens": 3000, "system": SYSTEM,
              "messages": [{"role":"user","content": "Entities:\n" + catalog}]})
    if code >= 300:
        print(f"LLM failed {code}: {body}", file=sys.stderr); sys.exit(2)
    text = "".join(b.get("text","") for b in body.get("content",[])).strip()
    if text.startswith("```"):
        text = text.split("\n",1)[1] if "\n" in text else text
        if text.endswith("```"): text = text[:-3]
        if text.startswith("json"): text = text[4:]
    s = text.find("{"); e = text.rfind("}")
    if s>=0 and e>s: text = text[s:e+1]
    try:
        clusters = json.loads(text).get("clusters", []) or []
    except Exception as ex:
        print(f"parse failed: {ex}\n{text[:400]}", file=sys.stderr); sys.exit(2)
    print(f"\n{len(clusters)} clusters identified")

    # Resolve E### codes → entity dicts
    def code_to_ent(code: str):
        m = re.match(r"E(\d+)", code)
        if not m: return None
        idx = int(m.group(1)) - 1
        if idx < 0 or idx >= len(ents): return None
        return ents[idx]

    # For each cluster, pick canonical = longest name
    log_lines = ["# Entity Consolidation Log", "", f"Run: {time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())}", ""]
    merges = []  # list of (canonical_id, [dupe_ids])
    for cluster in clusters:
        cents = [code_to_ent(c) for c in cluster]
        cents = [c for c in cents if c]
        if len(cents) < 2: continue
        # Same-kind only (don't merge venue + client by accident)
        kinds = {c["kind"] for c in cents}
        if len(kinds) > 1:
            log_lines.append(f"## SKIPPED mixed-kind cluster")
            for c in cents: log_lines.append(f"  - [{c['kind']}] {c['name']}")
            log_lines.append("")
            continue
        # Canonical = longest name (tiebreak: alphabetical first)
        canonical = max(cents, key=lambda c: (len(c["name"]), -ord(c["name"][0].lower())))
        dupes = [c for c in cents if c["id"] != canonical["id"]]
        log_lines.append(f"## ✓ Merged → **{canonical['name']}** ({canonical['kind']})")
        log_lines.append(f"  canonical: `{canonical['id']}` — {canonical['name']}")
        for d in dupes:
            log_lines.append(f"  dupe:      `{d['id']}` — {d['name']}")
        log_lines.append("")
        merges.append((canonical["id"], [d["id"] for d in dupes], canonical["name"]))

    print(f"\n{len(merges)} merges will run:")
    for canonical_id, dupe_ids, name in merges:
        print(f"  → {name}  (collapses {len(dupe_ids)} dupes)")

    # Execute merges
    total_docs_repointed = 0
    total_contacts_repointed = 0
    total_deleted = 0
    for canonical_id, dupe_ids, name in merges:
        for dupe_id in dupe_ids:
            # Repoint docs
            code, _ = sb("PATCH", f"docs?entity_id=eq.{dupe_id}", {"entity_id": canonical_id})
            if code < 300: total_docs_repointed += 1
            # Repoint contacts
            code, _ = sb("PATCH", f"contacts?entity_id=eq.{dupe_id}", {"entity_id": canonical_id})
            if code < 300: total_contacts_repointed += 1
            # Delete dupe entity
            code, _ = sb("DELETE", f"entities?id=eq.{dupe_id}")
            if code < 300: total_deleted += 1

    with open(LOG, "w") as f:
        f.write("\n".join(log_lines) + "\n")
    print(f"\nlog written to {LOG}")

    # Final state
    code, ents_after = sb("GET", "entities?select=count", body=None)
    code_ct, _ = sb("GET", "entities?select=id&limit=500")
    code, after_list = sb("GET", "entities?select=id&limit=500")
    print(f"\nDONE.")
    print(f"  merges executed         : {len(merges)}")
    print(f"  entities deleted        : {total_deleted}")
    print(f"  docs repointed          : {total_docs_repointed}")
    print(f"  contacts repointed      : {total_contacts_repointed}")
    print(f"  entities before/after   : {len(ents)} → {len(after_list)}")


if __name__ == "__main__":
    main()
