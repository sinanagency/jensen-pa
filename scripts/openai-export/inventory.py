#!/usr/bin/env python3
"""
Phase 1 inventory of Jensen's OpenAI export.
Pure local. No network. No PII echoed to stdout.
Reads raw/conversations-*.json shards, writes raw/INVENTORY.json + INVENTORY.md.
Doctrine alignment: Law 3 (PII-quarantine) — no message content printed,
only counts, dates, and titles (titles are non-PII summaries Jensen chose).
"""
import json, glob, os, re, sys, time
from collections import Counter, defaultdict
from datetime import datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SPEC_DIR = os.path.join(ROOT, "specs", "001-export-mining")
RAW = os.path.join(SPEC_DIR, "raw")
OUT_JSON = os.path.join(SPEC_DIR, "INVENTORY.json")
OUT_MD = os.path.join(SPEC_DIR, "INVENTORY.md")

shards = sorted(glob.glob(os.path.join(RAW, "conversations-*.json")))
assert shards, f"no conversation shards in {RAW}"

stats = {
    "shards": len(shards),
    "shard_files": [],
    "conversations_total": 0,
    "messages_total": 0,
    "by_role": Counter(),
    "user_word_count": 0,
    "assistant_word_count": 0,
    "earliest_create": None,
    "latest_update": None,
    "by_month": Counter(),
    "by_year": Counter(),
    "title_top": [],
    "title_token_freq": Counter(),
    "convo_lengths": [],
    "convos_with_attachments": 0,
    "convos_using_voice": 0,
    "convos_using_canvas": 0,
    "convos_using_dalle": 0,
    "models_seen": Counter(),
}

STOP = set("the a an of to in for and or is it i you we my our your this that with on at by from be as if not are was were have has had do does did will would should could can may might just so but also about into out up over under more most less than then their there here what which who when where why how its it's i'm i've i'll don't won't can't isn't".split())

title_tokens = Counter()
all_convos = []

for shard_path in shards:
    with open(shard_path) as f:
        shard = json.load(f)
    stats["shard_files"].append({"file": os.path.basename(shard_path), "convos": len(shard)})
    for c in shard:
        stats["conversations_total"] += 1
        title = (c.get("title") or "").strip()
        ct = c.get("create_time") or 0
        ut = c.get("update_time") or ct
        if ct:
            if stats["earliest_create"] is None or ct < stats["earliest_create"]:
                stats["earliest_create"] = ct
            d = datetime.fromtimestamp(ct, tz=timezone.utc)
            stats["by_month"][d.strftime("%Y-%m")] += 1
            stats["by_year"][d.strftime("%Y")] += 1
        if ut and (stats["latest_update"] is None or ut > stats["latest_update"]):
            stats["latest_update"] = ut

        mapping = c.get("mapping") or {}
        msg_count = 0
        had_attach = False
        had_voice = False
        had_canvas = False
        had_dalle = False
        for node in mapping.values():
            msg = node.get("message")
            if not msg:
                continue
            author = (msg.get("author") or {}).get("role") or "unknown"
            content = msg.get("content") or {}
            ctype = content.get("content_type") or ""
            parts = content.get("parts") or []
            metadata = msg.get("metadata") or {}
            model = metadata.get("model_slug")
            if model:
                stats["models_seen"][model] += 1
            if ctype == "multimodal_text":
                had_attach = True
            if "audio" in ctype:
                had_voice = True
            if ctype == "code" or "canvas" in (metadata.get("canvas") and "x" or ""):
                pass
            if metadata.get("canvas"):
                had_canvas = True
            if "dalle" in (model or "").lower() or "image" in ctype:
                had_dalle = True
            stats["messages_total"] += 1
            stats["by_role"][author] += 1
            msg_count += 1
            if author in ("user", "assistant") and parts:
                text_chunks = [p for p in parts if isinstance(p, str)]
                wc = sum(len(t.split()) for t in text_chunks)
                if author == "user":
                    stats["user_word_count"] += wc
                else:
                    stats["assistant_word_count"] += wc

        stats["convo_lengths"].append(msg_count)
        if had_attach: stats["convos_with_attachments"] += 1
        if had_voice: stats["convos_using_voice"] += 1
        if had_canvas: stats["convos_using_canvas"] += 1
        if had_dalle: stats["convos_using_dalle"] += 1

        if title:
            for tok in re.findall(r"[A-Za-z][A-Za-z'\-]+", title.lower()):
                if tok not in STOP and len(tok) > 2:
                    title_tokens[tok] += 1
            all_convos.append({"title": title, "create": ct, "msgs": msg_count})

stats["title_token_freq"] = title_tokens.most_common(80)
all_convos.sort(key=lambda x: -(x["msgs"] or 0))
stats["title_top"] = [{"title": c["title"], "msgs": c["msgs"]} for c in all_convos[:50]]

stats["by_role"] = dict(stats["by_role"])
stats["models_seen"] = dict(stats["models_seen"])
stats["by_month"] = dict(sorted(stats["by_month"].items()))
stats["by_year"] = dict(sorted(stats["by_year"].items()))

avg_len = sum(stats["convo_lengths"]) / max(1, len(stats["convo_lengths"]))
median_len = sorted(stats["convo_lengths"])[len(stats["convo_lengths"]) // 2]

earliest = datetime.fromtimestamp(stats["earliest_create"], tz=timezone.utc).isoformat() if stats["earliest_create"] else None
latest = datetime.fromtimestamp(stats["latest_update"], tz=timezone.utc).isoformat() if stats["latest_update"] else None

with open(OUT_JSON, "w") as f:
    json.dump({
        **{k: v for k, v in stats.items() if k != "convo_lengths"},
        "avg_msgs_per_convo": round(avg_len, 1),
        "median_msgs_per_convo": median_len,
        "earliest_create_iso": earliest,
        "latest_update_iso": latest,
    }, f, indent=2)

lines = []
lines.append("# Jensen OpenAI Export — Phase 1 Inventory")
lines.append("")
lines.append(f"Generated: {datetime.now(timezone.utc).isoformat()}")
lines.append(f"Doctrine: Law 3 (PII-quarantine) — no message bodies surfaced, titles + counts only.")
lines.append("")
lines.append("## Identity")
lines.append("- Account: Jensen A Moonien · jamrccboy@gmail.com · ChatGPT Plus")
lines.append("- Stripe customer created: 2024-10-18 (UAE, Palm Jumeirah)")
lines.append("- First app use (onboarding): 2024-01-11 → so ~2.5 years of activity")
lines.append("- Voice preference: vale · training_allowed: true")
lines.append("")
lines.append("## Volume")
lines.append(f"- Conversations: **{stats['conversations_total']:,}**")
lines.append(f"- Messages: **{stats['messages_total']:,}**")
lines.append(f"- User words (Jensen's voice): **{stats['user_word_count']:,}**")
lines.append(f"- Assistant words (ChatGPT's voice): **{stats['assistant_word_count']:,}**")
lines.append(f"- Avg msgs / convo: {round(avg_len, 1)} · Median: {median_len}")
lines.append("")
lines.append("## Time range")
lines.append(f"- Earliest convo: `{earliest}`")
lines.append(f"- Latest update: `{latest}`")
lines.append("")
lines.append("## Role split")
for role, n in sorted(stats["by_role"].items(), key=lambda x: -x[1]):
    lines.append(f"- {role}: {n:,}")
lines.append("")
lines.append("## Activity by year")
for y, n in stats["by_year"].items():
    lines.append(f"- {y}: {n:,} convos")
lines.append("")
lines.append("## Activity by month (top 24)")
sorted_months = sorted(stats["by_month"].items(), key=lambda x: -x[1])[:24]
for m, n in sorted_months:
    lines.append(f"- {m}: {n}")
lines.append("")
lines.append("## Modalities")
lines.append(f"- Convos with attachments (multimodal): {stats['convos_with_attachments']:,}")
lines.append(f"- Convos using voice/audio: {stats['convos_using_voice']:,}")
lines.append(f"- Convos using canvas: {stats['convos_using_canvas']:,}")
lines.append(f"- Convos using DALL-E / image gen: {stats['convos_using_dalle']:,}")
lines.append("")
lines.append("## Models he used")
for m, n in sorted(stats["models_seen"].items(), key=lambda x: -x[1])[:15]:
    lines.append(f"- {m}: {n:,}")
lines.append("")
lines.append("## Top title tokens (his world's vocabulary)")
for tok, n in stats["title_token_freq"][:60]:
    lines.append(f"- {tok}: {n}")
lines.append("")
lines.append("## Longest conversations (proxy: deepest engagement topics)")
for c in stats["title_top"][:30]:
    safe_title = c["title"][:120].replace("\n", " ")
    lines.append(f"- ({c['msgs']} msgs) {safe_title}")

with open(OUT_MD, "w") as f:
    f.write("\n".join(lines) + "\n")

print(f"Wrote {OUT_JSON}")
print(f"Wrote {OUT_MD}")
print(f"Convos: {stats['conversations_total']:,}  Msgs: {stats['messages_total']:,}  Jensen words: {stats['user_word_count']:,}")
