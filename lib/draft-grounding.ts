// Deterministic grounding guard for email reply drafts (KT #331).
//
// THE BUG: the inbox "suggested reply" confabulates. For info-heavy emails (a
// prospect asking about an event: price, availability, capacity, logistics) the
// model writes a confident, plausible reply from its own head instead of from
// real facts, fabricating specifics Jensen never gave it. The prompt's soft
// "do not invent specifics" drifts. This is the same disease as the transcript
// honesty failures, on the draft surface.
//
// THE GUARD (prevention, not detection — same spine as honest-reply.ts): a
// suggested reply may ONLY assert a concrete QUANTITATIVE commitment (a price /
// amount, a headcount, a percentage) if that number appears in the grounded
// sources (the per-contact [Draft context] + the inbound email's own subject and
// body). A figure that is NOT grounded is a fabrication; the whole draft is
// downgraded to an honest holding reply. Quantitative commitments are the most
// damaging to get wrong (a quoted price that is invented), and they never appear
// in a legitimate warm "let me get back to you" reply, so the guard is narrow
// and false-downgrades are vanishingly unlikely (it never touches a generic
// reply). Dates/times are handled by the prompt's honest-holding rule + the
// existing event-extraction "never invent dates" guard.

// Human-readable name of the kind of specific that was fabricated, for the
// "needs your steer" ask shown to Jensen.
const GAP_LABEL: Record<string, string> = {
  money: "a price or amount",
  money_suffix: "a price or amount",
  headcount: "a headcount",
  percent: "a discount or percentage",
};

// Quantitative specifics a draft might fabricate. Each carries a unit (currency,
// a headcount noun, or %) so it is a real commitment, never incidental prose.
const RISKY: { label: string; re: RegExp }[] = [
  { label: "money", re: /(?:aed|usd|us\$|\$|€|£|dhs?|dirhams?|euros?|pounds?|dollars?)\s?\d[\d,]*(?:\.\d+)?/gi },
  { label: "money_suffix", re: /\d[\d,]*(?:\.\d+)?\s?(?:aed|usd|dirhams?|euros?|pounds?|dollars?|k\b|per\s+(?:head|person|guest|cover))/gi },
  // "covers" is deliberately excluded: it collides with the verb ("AED 25,000
  // covers it") and the hospitality noun is rare in a reply. Full comma-numbers
  // are captured (\d[\d,]*) so "25,000 guests" reads as 25000, not the "000" tail.
  { label: "headcount", re: /\d[\d,]*\s?(?:guests?|pax|people|persons?|attendees?|seats?|tables?)/gi },
  { label: "percent", re: /\d[\d,]*(?:\.\d+)?\s?%/g },
];

// All digit-runs in the grounded sources (commas stripped), as a lookup set.
function digitTokens(s: string): Set<string> {
  return new Set((String(s || "").toLowerCase().match(/\d[\d,]*(?:\.\d+)?/g) || []).map((x) => x.replace(/,/g, "")));
}

// Deterministic backstop. Returns the draft unchanged when grounded. When the
// draft quotes a quantitative specific NOT backed by the sources, it is a
// fabrication: returns needsSteer:true with NO draft (never a guess, never a
// holding reply pretending to be the answer) and a human-readable gap, so the
// caller can turn the suggestion into a "needs your steer" ask to Jensen
// instead of putting a fabricated reply in front of him (KT #332).
export function groundDraft(draft: string, sources: string): { draft: string; needsSteer: boolean; gap?: string } {
  const d = String(draft || "").trim();
  if (!d) return { draft: d, needsSteer: false };
  const srcDigits = digitTokens(sources);
  for (const p of RISKY) {
    const hits = d.match(p.re);
    if (!hits) continue;
    for (const hit of hits) {
      const num = (hit.match(/\d[\d,]*(?:\.\d+)?/) || [""])[0].replace(/,/g, "");
      // Grounded if the figure appears in the sources; otherwise it is invented.
      if (num && !srcDigits.has(num)) {
        return { draft: "", needsSteer: true, gap: GAP_LABEL[p.label] || "specifics I do not have on file" };
      }
    }
  }
  return { draft: d, needsSteer: false };
}
