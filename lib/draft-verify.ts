// Claim-by-claim grounding verifier for email reply drafts (KT #333).
//
// This is the TRICKY-LOGIC-PROTOCOL step 3 ("adversarial read-back by a separate
// perspective") automated. The deterministic groundDraft guard (KT #331) only
// catches fabricated NUMBERS (price / headcount / %). A confident draft can still
// assert a non-numeric fabrication the number-guard is blind to: "Yes, Saturday
// works for us", "our venue fits your group", "the package includes airport
// transfers". This pass re-reads each CONFIDENT draft with one job — does every
// concrete claim trace to the sources? — and flags the ones that do not, so the
// caller flips them to a "needs your steer" ask instead of showing Jensen a
// confident-but-ungrounded reply.
//
// SEPARATE pass on purpose: the first triage call juggles importance, urgency,
// summary, draft, and event extraction; a fresh adversarial reader whose ONLY
// question is "is this grounded?" catches what the busy first pass misses. That
// is the protocol's point, not a redundancy.
//
// FAIL-OPEN: any error (API blip, bad JSON) returns no verdicts, so the caller
// keeps the model's draft unchanged. The verifier is an EXTRA layer; its absence
// degrades to the number-guard + model self-report (the prior live behavior),
// never to silence and never to downgrading every draft on a transient error.

import { askClaude, HAIKU } from "./anthropic";

export type GroundingVerdict = { grounded: boolean; unsupported?: string };

const SYSTEM = [
  "You are a STRICT, adversarial grounding auditor for email reply drafts. Your ONLY job is to catch a draft that asserts something not backed by its sources. You are not writing or improving anything.",
  "For each item you get a DRAFT (a proposed reply) and SOURCES (the original email plus any known context about the sender).",
  "A draft is grounded ONLY if every CONCRETE factual claim it makes is supported by the SOURCES. Concrete claims include: availability or a yes/no commitment ('yes we can', 'Saturday works'), a price or amount, a date or time, a capacity or headcount, menu or inclusions, a deliverable, a discount, or any specific about the venue, event, or offer.",
  "Generic courtesy is ALWAYS grounded and never a reason to fail: 'thank you for reaching out', 'happy to help', 'I will get back to you', 'let me confirm the details and revert', 'great to hear from you'.",
  "When you are unsure whether a concrete claim is backed by the sources, treat it as NOT grounded. Be strict: a wrong specific sent to a client is far worse than asking the owner.",
  "Return ONLY a JSON array, one object per id, no prose, no markdown:",
  `[{"id":"...","grounded":true,"unsupported":""},{"id":"...","grounded":false,"unsupported":"a few words naming the claim that is not backed, e.g. 'Saturday availability'"}]`,
].join("\n");

function extractJsonArray(s: string): any {
  try { return JSON.parse(s); } catch {}
  const a = s.indexOf("["); const b = s.lastIndexOf("]");
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch {} }
  return null;
}

// Verify a batch of confident drafts against their sources in ONE call. Returns a
// map id -> verdict. On any failure returns {} (fail-open: caller keeps the draft).
export async function verifyDraftsGrounded(
  items: { id: string; draft: string; sources: string }[]
): Promise<Record<string, GroundingVerdict>> {
  const real = items.filter((i) => i.id && (i.draft || "").trim());
  if (!real.length) return {};
  try {
    const lines = real
      .map((i) => `id=${i.id}\nDRAFT: ${i.draft.replace(/\s+/g, " ").slice(0, 700)}\nSOURCES: ${(i.sources || "(none)").replace(/\s+/g, " ").slice(0, 1200)}`)
      .join("\n---\n");
    const txt = await askClaude({ system: SYSTEM, messages: [{ role: "user", content: lines }], model: HAIKU, maxTokens: 1200, temperature: 0 });
    const arr = extractJsonArray(txt);
    const out: Record<string, GroundingVerdict> = {};
    if (Array.isArray(arr)) {
      for (const o of arr) {
        if (!o || o.id == null) continue;
        out[String(o.id)] = {
          grounded: o.grounded !== false, // default grounded on a malformed entry (fail-open per item)
          unsupported: typeof o.unsupported === "string" ? o.unsupported.slice(0, 120) : "",
        };
      }
    }
    return out;
  } catch {
    return {}; // FAIL-OPEN: no verdicts -> caller keeps the model's draft
  }
}
