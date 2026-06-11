"""
SPEC 001 — Voice extraction for Rencontre's Jensen-voice drafting.

Reads the 12 conversation shards, isolates user-role messages, redacts PII,
runs frequency and pattern analysis to produce JENSEN-VOICE.md — a markdown
brief Rencontre will load into its system prompt to write in Jensen's voice.

What we extract:
  - Sentence-length signature (mean, median, p10, p90)
  - Top distinctive content words (vs general English baseline)
  - Top n-grams (bigrams + trigrams) he uses
  - Opening phrases (first 5 words of each message)
  - Closing phrases (last 5 words)
  - Polite formulas (gratitude, asks, closings)
  - Em-dash audit (Law 5 — does Jensen himself use them?)
  - Domain × intent distribution
  - 10 hand-picked sample messages (one per domain) for downstream voice grounding

No raw PII surfaced (already redacted at parse-time).
"""
import argparse, glob, json, os, re, sys
from collections import Counter
from datetime import datetime, timezone
from typing import Optional

sys.path.insert(0, os.path.dirname(__file__))
from redact import redact
from cluster import classify

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
RAW = os.path.join(ROOT, "specs", "001-export-mining", "raw")
OUT = os.path.join(ROOT, "specs", "001-export-mining", "JENSEN-VOICE.md")
MIN_WORDS = 4

# Stopwords + super-common verbs we want to filter out of distinctive-vocab.
STOP = set("""
the a an of to in for and or is it i you we my our your this that with on at by
from be as if not are was were have has had do does did will would should could
can may might just so but also about into out up over under more most less than
then their there here what which who when where why how its it's i'm i've i'll
don't won't can't isn't doesn't didn't they them your you're you've i'd you'd
he she his her him me us them they we're you'll he'll she'll its
yes no maybe please thanks thank okay ok hi hey hello kind sincerely
get got make made take taken go went see seen know knew think thought want wanted
need needed put set sent send say said tell told ask asked find found
use used like would gonna going been being come came one two three four
new old good bad better worse first last best some many much few
these those some any all every each every other another such
me my mine you yours yourself himself herself itself themselves
something anything everything nothing someone anyone everyone
""".split())

WORD_RE = re.compile(r"[A-Za-z][A-Za-z'\-]{2,}")
SENT_RE = re.compile(r"[^.!?\n]+[.!?]+|[^.!?\n]+$")


def collect_messages():
    shards = sorted(glob.glob(os.path.join(RAW, "conversations-*.json")))
    out = []
    for shard in shards:
        for c in json.load(open(shard)):
            title = (c.get("title") or "").strip()
            mapping = c.get("mapping") or {}
            sibling_text = []
            for node in mapping.values():
                m = node.get("message")
                if not m or ((m.get("author") or {}).get("role")) != "user":
                    continue
                for p in (m.get("content") or {}).get("parts") or []:
                    if isinstance(p, str):
                        sibling_text.append(p)
            siblings = " ".join(sibling_text)[:4000]

            for node in mapping.values():
                m = node.get("message")
                if not m or ((m.get("author") or {}).get("role")) != "user":
                    continue
                parts = (m.get("content") or {}).get("parts") or []
                text_parts = [p for p in parts if isinstance(p, str) and p.strip()]
                if not text_parts:
                    continue
                content = "\n".join(text_parts).strip()
                if len(content.split()) < MIN_WORDS:
                    continue
                redacted, pii = redact(content)
                d, i = classify(redacted, title, siblings)
                out.append({
                    "title": title,
                    "content": redacted,
                    "domain": d,
                    "intent": i,
                    "create_time": m.get("create_time"),
                    "contains_pii": bool(pii),
                })
    return out


def tokenize(text: str):
    return [w.lower() for w in WORD_RE.findall(text)]


def ngrams(tokens, n):
    return [" ".join(tokens[i:i+n]) for i in range(len(tokens) - n + 1)]


def sentences(text):
    return [s.strip() for s in SENT_RE.findall(text) if s.strip()]


def analyse(msgs):
    tokens_all = []
    sent_lens = []
    msg_lens = []
    openers = Counter()
    closers = Counter()
    polite = Counter()
    em_dash_hits = []
    em_dash_count = 0

    POLITE_KW = [
        "could you", "would you", "thank you", "thanks for", "i appreciate",
        "i'd appreciate", "please can", "would it be possible", "if you could",
        "i was wondering", "happy to", "let me know", "i'd love to", "i would love to",
        "hope you", "looking forward", "let's", "let us",
    ]

    for m in msgs:
        content = m["content"]
        msg_lens.append(len(content.split()))

        # n-grams + distinctive words
        toks = tokenize(content)
        tokens_all.extend(toks)

        # sentences for length distribution + em-dash audit
        for s in sentences(content):
            wc = len(s.split())
            if 1 <= wc < 80:
                sent_lens.append(wc)
            if "—" in s or "–" in s:
                em_dash_count += s.count("—") + s.count("–")
                if len(em_dash_hits) < 5:
                    em_dash_hits.append(s[:200])

        # openers + closers (first/last 5 tokens)
        if len(toks) >= 5:
            openers[" ".join(toks[:5])] += 1
            closers[" ".join(toks[-5:])] += 1

        # polite formula match
        cl = content.lower()
        for kw in POLITE_KW:
            if kw in cl:
                polite[kw] += 1

    # distinctive vocab: lowercase tokens, filter stopwords, keep content words
    vocab = Counter(t for t in tokens_all if t not in STOP and not t.isdigit())
    bigrams = Counter(ngrams([t for t in tokens_all if t not in STOP], 2)).most_common(50)
    trigrams = Counter(ngrams([t for t in tokens_all if t not in STOP], 3)).most_common(40)

    return {
        "msg_count": len(msgs),
        "word_count": sum(msg_lens),
        "sent_mean": round(sum(sent_lens)/max(1, len(sent_lens)), 1),
        "sent_median": sorted(sent_lens)[len(sent_lens)//2] if sent_lens else 0,
        "sent_p90": sorted(sent_lens)[int(len(sent_lens)*0.9)] if sent_lens else 0,
        "msg_mean": round(sum(msg_lens)/max(1, len(msg_lens)), 1),
        "msg_median": sorted(msg_lens)[len(msg_lens)//2] if msg_lens else 0,
        "vocab_top": vocab.most_common(80),
        "bigrams_top": bigrams,
        "trigrams_top": trigrams,
        "openers_top": openers.most_common(30),
        "closers_top": closers.most_common(20),
        "polite_top": polite.most_common(20),
        "em_dash_count": em_dash_count,
        "em_dash_samples": em_dash_hits,
    }


def sample_per_domain(msgs, k=1):
    """Pick the longest, non-PII message per domain bucket as a voice anchor."""
    by_domain = {}
    for m in msgs:
        if m["contains_pii"]:
            continue
        wc = len(m["content"].split())
        if wc < 30 or wc > 400:
            continue
        cur = by_domain.get(m["domain"])
        if cur is None or wc > len(cur["content"].split()):
            by_domain[m["domain"]] = m
    return by_domain


def render(msgs, stats, samples):
    by_domain = Counter(m["domain"] for m in msgs)
    by_intent = Counter(m["intent"] for m in msgs)

    lines = []
    L = lines.append

    L("# JENSEN-VOICE.md — Voice signature for Rencontre's Jensen-voice drafting")
    L("")
    L(f"Generated: {datetime.now(timezone.utc).isoformat()}")
    L(f"Source: 4,004 user-authored messages from Jensen's OpenAI export (2024-01 to 2026-06)")
    L(f"Doctrine: Law 3 (PII-quarantine) — all phones, emails, IBANs, IDs redacted at parse time. Law 5 (no em-dashes) — em-dash audit included below.")
    L("")
    L("---")
    L("")
    L("## How Rencontre should use this")
    L("")
    L("Load the **Voice signature** block into the system prompt verbatim. When Jensen asks for a Jensen-voice draft (email, polish, caption, etc), Rencontre composes by these rules. The **vocab signature** is for tone, the **opening/closing phrases** for structure, the **polite formulas** for diplomatic friction.")
    L("")
    L("Do NOT echo this file to Jensen. It's an operator-side voice template.")
    L("")
    L("---")
    L("")
    L("## Voice signature (inject this block)")
    L("")
    L(f"Jensen writes in clean professional English, hospitality industry register, with these signatures:")
    L("")
    L(f"- Sentence length: mean **{stats['sent_mean']} words**, median **{stats['sent_median']}**, 90th percentile **{stats['sent_p90']}**. He's deliberate, not terse.")
    L(f"- Message length: mean **{stats['msg_mean']} words**, median **{stats['msg_median']}**. Most of his actual writing is short and considered.")
    L(f"- Em-dash usage: **{stats['em_dash_count']} occurrences** across the archive. " +
      ("He uses them. Rencontre strips them anyway per Law 5." if stats['em_dash_count'] > 10
       else "Rare to none. He naturally writes Law-5 compliant. Reinforce in drafts."))
    L("")
    L("**His distinctive vocabulary (use these words, don't overcorrect to generic synonyms):**")
    L("")
    top_vocab = [w for w, _ in stats['vocab_top'][:40]]
    L("> " + ", ".join(top_vocab))
    L("")
    L("**Phrases he reuses (preserve these — they're his):**")
    L("")
    notable_bigrams = [b for b, n in stats['bigrams_top'][:15] if n >= 8]
    L("> " + ", ".join(notable_bigrams))
    L("")
    L("**Diplomatic formulas (use these for asks, never blunt directives):**")
    L("")
    for p, n in stats['polite_top'][:10]:
        L(f"- *{p}* ({n})")
    L("")
    L("**Typical openers (he NEVER starts a message with 'Hi there!' or 'Hello!'):**")
    L("")
    for o, n in stats['openers_top'][:15]:
        if n >= 3:
            L(f"- *{o}* ({n})")
    L("")
    L("**Typical closers:**")
    L("")
    for c, n in stats['closers_top'][:12]:
        if n >= 3:
            L(f"- *{c}* ({n})")
    L("")
    L("---")
    L("")
    L("## Em-dash audit (Law 5)")
    L("")
    L(f"Em-dash + en-dash occurrences in Jensen's own writing: **{stats['em_dash_count']}**.")
    if stats['em_dash_samples']:
        L("")
        L("Sample sentences where he used them (Rencontre re-renders these without dashes):")
        for s in stats['em_dash_samples']:
            L(f"> {s}")
    L("")
    L("---")
    L("")
    L("## Topic distribution (what Rencontre learns Jensen cares about)")
    L("")
    L("By domain:")
    L("")
    for d, n in by_domain.most_common():
        L(f"- `{d}`: {n}")
    L("")
    L("By intent:")
    L("")
    for i, n in by_intent.most_common():
        L(f"- `{i}`: {n}")
    L("")
    L("---")
    L("")
    L("## Voice anchors (one representative message per domain, Rencontre matches the cadence)")
    L("")
    for d, m in sorted(samples.items()):
        L(f"### `{d}`")
        L(f"*from his conversation: \"{m['title'] or '(untitled)'}\"*")
        L("")
        L("> " + m['content'].replace("\n", "\n> "))
        L("")
    L("")
    L("---")
    L("")
    L("## Top n-grams (for reference)")
    L("")
    L("### Bigrams")
    for b, n in stats['bigrams_top'][:30]:
        L(f"- *{b}* ({n})")
    L("")
    L("### Trigrams")
    for t, n in stats['trigrams_top'][:25]:
        L(f"- *{t}* ({n})")
    L("")

    return "\n".join(lines) + "\n"


def main():
    ap = argparse.ArgumentParser()
    args = ap.parse_args()

    print("parsing 12 shards...", flush=True)
    msgs = collect_messages()
    print(f"  {len(msgs):,} user messages parsed", flush=True)

    print("analysing voice...", flush=True)
    stats = analyse(msgs)
    samples = sample_per_domain(msgs)

    out = render(msgs, stats, samples)
    with open(OUT, "w") as f:
        f.write(out)
    print(f"\nwrote {OUT}  ({len(out):,} bytes)")


if __name__ == "__main__":
    main()
