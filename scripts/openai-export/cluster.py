"""
Domain + intent tagger for the OpenAI export ingest.

Rule-based first pass. Each row gets ONE domain (what it's about) and ONE intent
(what it's for). Scoring is keyword-count based with priority tiebreakers.

If nothing scores, defaults are domain='personal_admin', intent='comms'.

Conversation context counts: the title and any sibling user messages in the same
thread bias the score. A single ambiguous polish request inside an "Upaya Festival"
thread tags as upaya_festival/polish, not personal_admin/polish.
"""
import re
from collections import Counter
from typing import Tuple, Optional

# Domain rules: keyword → weight. Match is case-insensitive whole-word-ish.
DOMAIN_RULES = {
    "upaya_festival": {
        "upaya": 3, "prelude": 2, "f7b": 3, "festival": 2,
        "access code": 2, "ticket": 1, "wellness experience": 2,
        "after glow": 2, "meditation update": 1,
    },
    "sohum_consulting": {
        "sohum": 3, "soham": 2, "scbd": 2,
    },
    "larencontre_fnb": {
        "larencontre": 3, "la rencontre": 3, "ula": 2,
        "restaurant strategy": 2, "menu engineering": 2, "f&b": 2,
        "holistic house label": 2,
    },
    "dharma_personal": {
        "three jewels": 3, "mahayana": 3, "dharma": 2,
        "taichi": 2, "tai chi": 2, "sangha": 2,
        "nocturnal birds": 2, "dharma duel": 2,
        "buddhist": 2, "meditation practice": 1,
    },
    "cloud_kitchen": {
        "cloud kitchen": 3, "ghost kitchen": 2, "dark kitchen": 2,
    },
    "dubai_market": {
        "downtown visitor": 2, "panther": 2, "dubai market": 1,
        "uae market": 1, "gitex": 2, "marina": 1, "downtown dubai": 2,
    },
    "partnerships_outreach": {
        "partnership": 2, "collaboration": 2, "linkedin": 2,
        "outreach": 2, "proposal": 1, "cold email": 2, "cold reach": 2,
    },
    "content_marketing": {
        "instagram": 2, "reel": 2, "caption": 2, "carousel": 2,
        "social post": 2, "instagram post": 2, "tiktok": 2,
        "announcement": 1, "newsletter": 1,
    },
    "staff_hr": {
        "resignation": 3, "hiring": 2, "rgm candidate": 3,
        "candidate sourcing": 2, "staff transition": 2,
        "job description": 2, "interview": 1, "onboarding new hire": 2,
    },
}

INTENT_RULES = {
    "polish": {
        "proofread": 3, "proof read": 3, "polish": 2, "refine": 2,
        "rewrite": 2, "verbiage": 2, "tighten": 1,
        "better wording": 2, "clean up": 1, "improve this": 1,
    },
    "draft": {
        "draft": 2, "write up": 2, "compose": 2,
        "first version": 1, "starting point": 1, "rough draft": 2,
    },
    "plan": {
        "strategy": 2, "plan": 1, "model": 1, "optimization": 2,
        "benchmarking": 2, "roadmap": 2, "approach": 1,
        "growth": 1, "business model": 2,
    },
    "legal": {
        "agreement": 3, "contract": 2, "nda": 3, "terms": 2,
        "commission": 2, "clause": 2, "addendum": 2,
        "non-disclosure": 3, "memorandum": 2,
    },
    "comms": {
        "email": 2, "message": 1, "response": 1, "reply": 1,
        "template for": 2, "follow up": 2, "follow-up": 2,
        "invitation": 1, "guest response": 2,
    },
    "social": {
        "caption": 2, "reel": 2, "instagram": 2, "carousel": 2,
        "social media": 2, "post copy": 2, "story copy": 2,
    },
    "finance": {
        "invoice": 3, "aed": 1, "usd": 1, "payment": 2,
        "commission rate": 2, "payout": 2, "vat": 2, "receipt": 1,
    },
    "hr": {
        "hiring": 2, "candidate": 2, "resignation": 3,
        "job description": 2, "interview": 1, "salary": 2,
    },
    "research": {
        "look up": 2, "find me": 2, "research": 2,
        "benchmark": 2, "compare": 1, "options for": 1,
        "what are the": 1,
    },
    "study": {
        "explain": 1, "teach me": 2, "philosophy": 2,
        "history of": 1, "what does": 1, "concept of": 1,
        "lineage": 2, "scripture": 2, "sutra": 2,
    },
}

# When a domain wins, tiebreak intents toward this priority:
DOMAIN_INTENT_AFFINITY = {
    "dharma_personal": ["study", "research", "comms"],
    "upaya_festival": ["plan", "comms", "draft"],
    "sohum_consulting": ["legal", "plan", "draft"],
    "larencontre_fnb": ["plan", "draft", "comms"],
    "cloud_kitchen": ["plan", "research", "draft"],
    "dubai_market": ["research", "plan", "comms"],
    "partnerships_outreach": ["comms", "draft", "legal"],
    "content_marketing": ["social", "draft", "polish"],
    "staff_hr": ["hr", "comms", "legal"],
    "personal_admin": ["comms", "polish", "research"],
}

DEFAULT_DOMAIN = "personal_admin"
DEFAULT_INTENT = "comms"


def _score(text: str, rules: dict) -> Counter:
    text_l = text.lower()
    scores: Counter = Counter()
    for cluster, kws in rules.items():
        for kw, weight in kws.items():
            if kw in text_l:
                # rough word-boundary check: not preceded/followed by alpha
                pattern = re.compile(r"(?:^|[^a-z])" + re.escape(kw) + r"(?:[^a-z]|$)")
                hits = len(pattern.findall(text_l))
                if hits:
                    scores[cluster] += weight * hits
    return scores


def classify(content: str, title: str = "", siblings: str = "") -> Tuple[str, str]:
    """Return (domain, intent). Title and sibling messages weight the decision."""
    domain_text = " ".join([content, title * 3, siblings])  # title triples weight
    intent_text = " ".join([content, title * 2])

    d_scores = _score(domain_text, DOMAIN_RULES)
    i_scores = _score(intent_text, INTENT_RULES)

    if d_scores:
        # Priority order if tied: upaya > sohum > larencontre > dharma > cloud_kitchen > ...
        top = max(d_scores.items(), key=lambda kv: (kv[1], -list(DOMAIN_RULES.keys()).index(kv[0])))
        domain = top[0]
    else:
        domain = DEFAULT_DOMAIN

    if i_scores:
        top = max(i_scores.items(), key=lambda kv: (kv[1], -list(INTENT_RULES.keys()).index(kv[0])))
        intent = top[0]
    else:
        # Fall back to domain affinity
        affinity = DOMAIN_INTENT_AFFINITY.get(domain, [DEFAULT_INTENT])
        intent = affinity[0]

    return domain, intent


if __name__ == "__main__":
    cases = [
        ("Can you proofread this Upaya partnership invitation?", "Upaya Partnership Invitation"),
        ("Draft a commission agreement for Sohum", "Sohum Commission Agreement"),
        ("Write me an Instagram caption for the new menu launch", "Menu Launch Caption"),
        ("Explain the three jewels of buddhism please", "Three Jewels"),
        ("What's the latest on the cloud kitchen P&L model?", "Cloud Kitchen P&L"),
        ("Help me reply to this candidate's email", "RGM Candidate"),
        ("Refine this paragraph for me", ""),
    ]
    for content, title in cases:
        d, i = classify(content, title)
        print(f"  {d:25} {i:10}  | {content[:70]}")
