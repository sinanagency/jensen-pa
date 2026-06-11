"""
PII redaction for the OpenAI export ingest. Doctrine Law 3.

Strategy: replace PII with token placeholders ([PHONE], [EMAIL], etc.) so the
content stays semantically intact for retrieval and voice analysis, but no raw
identifiers ever land in the corpus or pass through downstream embedding APIs.

We KEEP @larencontre.ae addresses visible because they're Jensen's own work
identities, not third-party PII. Personal Gmail / Yahoo / etc are redacted.

Returns: (redacted_text, list of pii_kinds_found_sorted_dedup)
"""
import re
from typing import Tuple, List

# UAE phones: +971-XX-XXX-XXXX. Generic intl: +<country><digits>. Bare 7-15 digit runs.
RE_PHONE = re.compile(r"""(?x)
    (?:
        \+\d{1,3}[\s\-\.]?\d[\d\s\-\.\(\)]{6,15}\d   # international
      | \b0\d{2}[\s\-\.]?\d{3}[\s\-\.]?\d{4}\b       # UAE local 0XX XXX XXXX
      | \b\d{4}[\s\-\.]?\d{4}\b                       # 8-digit grouped
    )
""")

# Standard email. KEEP @larencontre.ae addresses (Jensen's own work email is not PII).
RE_EMAIL = re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b")
LARENCONTRE_KEEP = re.compile(r"@larencontre\.ae$", re.IGNORECASE)

# UAE IBAN: AE + 2 check digits + 19 chars. Generic IBAN: 2 letters + 2 digits + 11-30 alnum.
RE_IBAN = re.compile(r"\b[A-Z]{2}\d{2}[\sA-Z0-9]{11,32}\b")

# Emirates ID: 784-YYYY-XXXXXXX-X
RE_EMIRATES_ID = re.compile(r"\b784[\s\-]?\d{4}[\s\-]?\d{7}[\s\-]?\d\b")

# Credit cards (rough — 4 groups of 4 digits, optional spaces/dashes)
RE_CARD = re.compile(r"\b(?:\d[ \-]?){13,19}\b")

# Passport-ish (alphanumeric 6-9 + optional country prefix). Conservative: only if
# preceded by "passport" keyword in the surrounding 30 chars.
RE_PASSPORT_KW = re.compile(r"passport[^a-z0-9]{0,4}([A-Z0-9]{6,9})", re.IGNORECASE)


def redact(text: str) -> Tuple[str, List[str]]:
    if not text:
        return text, []
    found = set()

    def keep_larencontre(m: re.Match) -> str:
        if LARENCONTRE_KEEP.search(m.group(0)):
            return m.group(0)
        found.add("email")
        return "[EMAIL]"

    text = RE_EMAIL.sub(keep_larencontre, text)

    if RE_EMIRATES_ID.search(text):
        found.add("emirates_id")
        text = RE_EMIRATES_ID.sub("[EMIRATES_ID]", text)

    if RE_IBAN.search(text):
        found.add("iban")
        text = RE_IBAN.sub("[IBAN]", text)

    # Card has to run before phone because they overlap on long digit runs.
    if RE_CARD.search(text):
        # Crude filter: require at least one separator OR exactly 16 digits.
        def card_sub(m: re.Match) -> str:
            raw = m.group(0)
            digits = re.sub(r"\D", "", raw)
            if len(digits) == 16 or (len(digits) >= 13 and any(c in raw for c in " -")):
                found.add("card")
                return "[CARD]"
            return raw
        text = RE_CARD.sub(card_sub, text)

    if RE_PHONE.search(text):
        found.add("phone")
        text = RE_PHONE.sub("[PHONE]", text)

    for m in RE_PASSPORT_KW.finditer(text):
        found.add("passport")
    text = RE_PASSPORT_KW.sub(lambda m: m.group(0).replace(m.group(1), "[PASSPORT]"), text)

    return text, sorted(found)


if __name__ == "__main__":
    cases = [
        "call me on +971 50 123 4567 or jensen@larencontre.ae",
        "wire to AE07 0331 2345 6789 0123 456",
        "his emirates id is 784-1996-1234567-8",
        "my passport A12345678 expires next year",
        "Visa 4242 4242 4242 4242 ends in 4242",
        "no pii here, just talking about Upaya",
        "contact maria.lopez@gmail.com or wassim@upaya.com",
    ]
    for c in cases:
        r, k = redact(c)
        print(f"  {k!s:30}  {r}")
