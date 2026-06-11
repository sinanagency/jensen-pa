"""
Build a manifest of every file Jensen uploaded to ChatGPT (PDFs, DOCX, text,
images, video, archives) from library_files.json and insert one row per file
into public.docs so the platform's Documents section shows them all.

No bytes uploaded yet — that's a separate work-stream. This is the INDEX:
title + file_name + mime + size + linked conversation, routed to the right
folder. The bot can answer "do I have a doc called X?" and surface it.

Source: specs/001-export-mining/raw/library_files.json (131 entries).
"""
import json, os, re, subprocess, sys, time, uuid, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

def load_env():
    for line in open(os.path.join(ROOT, ".env.local")):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line: continue
        k, v = line.split("=", 1)
        os.environ[k.strip()] = v.strip().strip('"').strip("'")
load_env()

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]


def http_json(method, url, headers, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    for k,v in headers.items(): req.add_header(k,v)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
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


# Folder routing by mime/extension
def folder_for(mime: str, ext: str, category: str, filename: str) -> str:
    f = filename.lower()
    m = (mime or "").lower()
    if "pdf" in m:
        if "upaya" in f: return "upaya-decks"
        if "proposal" in f or "deck" in f or "pitch" in f: return "proposals"
        if "agreement" in f or "contract" in f or "nda" in f: return "contracts"
        return "pdfs"
    if "wordprocessingml" in m or ext == "docx":
        if "agreement" in f or "contract" in f or "nda" in f: return "contracts"
        if "proposal" in f or "deck" in f: return "proposals"
        return "docs"
    if "spreadsheet" in m or ext in ("xlsx", "xls", "csv"): return "spreadsheets"
    if "image" in m: return "images"
    if "video" in m or "audio" in m: return "media"
    if "zip" in m: return "archives"
    return "uploads"


def kind_for(mime: str, ext: str) -> str:
    if "pdf" in (mime or "").lower(): return "pdf"
    if "wordprocessingml" in (mime or "") or ext == "docx": return "docx"
    if "spreadsheet" in (mime or "") or ext in ("xlsx","xls"): return "spreadsheet"
    if "image" in (mime or ""): return "image"
    if "video" in (mime or ""): return "video"
    if "zip" in (mime or ""): return "archive"
    if "text" in (mime or "") or ext == "txt": return "text"
    return "file"


def main():
    lib_path = os.path.join(ROOT, "specs", "001-export-mining", "raw", "library_files.json")
    library = json.load(open(lib_path))
    print(f"loaded {len(library)} library files")

    # Existing docs for dedupe by file_name
    code, existing = sb("GET", "docs?select=file_name&limit=2000")
    seen_names = {(r.get("file_name") or "").strip().lower() for r in (existing or [])}
    print(f"  {len(seen_names)} existing file_names")

    rows = []
    skipped_dupe = 0
    skipped_deleted = 0
    for f in library:
        if f.get("deleted_at") or f.get("trashed_at"):
            skipped_deleted += 1
            continue
        name = (f.get("file_name") or "").strip()
        if not name: continue
        if name.lower() in seen_names:
            skipped_dupe += 1
            continue

        mime = f.get("mime_type") or "application/octet-stream"
        ext = (f.get("file_extension") or "").lower()
        cat = f.get("library_file_category") or ""
        size = f.get("file_size_bytes") or 0
        conv_id = f.get("initiating_conversation_id") or f.get("origination_thread_id")
        created = f.get("created_at") or f.get("file_upload_time")
        # Parse ISO created_at → millis
        ts_ms = int(time.time() * 1000)
        doc_date = None
        if created:
            try:
                from datetime import datetime
                dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
                ts_ms = int(dt.timestamp() * 1000)
                doc_date = dt.date().isoformat()
            except Exception:
                pass

        rows.append({
            "id": uuid.uuid4().hex[:12],
            "title": name,
            "file_name": name,
            "mime": mime,
            "kind": kind_for(mime, ext),
            "content": f"Imported from OpenAI export 2026-06-11. Original conversation: {conv_id or '(unknown)'}. Size: {size:,} bytes.",
            "size": size,
            "folder": folder_for(mime, ext, cat, name),
            "sensitivity": "normal",
            "created_at": ts_ms,
            "doc_date": doc_date,
        })

    print(f"\n  to insert: {len(rows)}")
    print(f"  skipped (deleted/trashed): {skipped_deleted}")
    print(f"  skipped (dupe by file_name): {skipped_dupe}")

    # Per-folder breakdown
    from collections import Counter
    folders = Counter(r["folder"] for r in rows)
    print(f"\n  folder distribution:")
    for f, n in folders.most_common():
        print(f"    {f:20} {n:3}")

    # Insert in batches
    BATCH = 30
    inserted = 0
    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i+BATCH]
        code, body = sb("POST", "docs", chunk)
        if code >= 300:
            print(f"  batch {i//BATCH+1} failed {code}: {str(body)[:200]}", file=sys.stderr)
            continue
        inserted += len(chunk)
        print(f"  inserted {inserted}/{len(rows)}", flush=True)

    print(f"\nDONE. {inserted} manifest entries written to docs.")
    print("Note: file BYTES not uploaded yet. Phase 3 work-stream.")


if __name__ == "__main__":
    main()
