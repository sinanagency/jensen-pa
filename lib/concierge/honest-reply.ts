// Prevention, not detection. A false completion claim never ships.
// Deterministic first (cannot fail open). The LLM check is a secondary net only.
//
// Replaces the old verifyReply rail (fail-open, appended a contradicting note
// after a standing lie) and the `reply = "Done."` empty-reply fallback.
import { claudeJSON } from "../anthropic";
import { COMPLETION_TOOLS } from "./tools";

type ToolRun = { name: string; ok: boolean; result?: any };

// Verbs that assert a finished action.
const CLAIM =
  /\b(done|created|added|saved|recorded|logged|booked|scheduled|filed|sent|updated|deleted|set|drafted|posted|charged|refunded|cancelled)\b/i;
// Future or honest phrasings that are NOT claims of a finished action.
const NOT_A_CLAIM =
  /\b(will|going to|about to|can|could|shall I|should I|want me to|let me|i'?ll|once you|after you|draft(ed)? (it )?for you)\b/i;
// Sent-claim verbs, checked against send tools specifically.
const SENT_CLAIM = /\b(sent|messaged|emailed|notified|told|forwarded)\b/i;
// Tool names whose ok=true backs a "sent/emailed/notified" claim. Jensen has no
// generic "send" tool (his WhatsApp reply IS the message); the only outbound
// tools are reply_email (sends an email) and call_owner (places a call).
const SEND_TOOLS = new Set<string>(["reply_email", "call_owner"]);

const okIn = (runs: ToolRun[], names: Set<string>) =>
  runs.some((r) => names.has(r.name) && r.ok);

// A completion-class tool that RAN, failed, and carries a real message (a reason
// or a disambiguation question). That message is the honest, useful answer.
function failingToolMessage(runs: ToolRun[]): string | null {
  const t = [...runs]
    .reverse()
    .find(
      (r) =>
        COMPLETION_TOOLS.has(r.name) &&
        r.ok === false &&
        typeof r.result?.summary === "string" &&
        r.result.summary.trim(),
    );
  return t ? (t.result.summary as string).trim() : null;
}

function rewriteToHonest(runs: ToolRun[]): string {
  const msg = failingToolMessage(runs);
  if (msg) return msg; // e.g. "Two events match, which one?"
  return "I have not done that yet. Say the word and I will, or tell me the correction.";
}

/**
 * Returns the reply that should actually ship.
 * - Empty reply never becomes "Done." It becomes something true.
 * - A finished-action claim with no backing tool success is rewritten to the truth.
 * - We never append a contradicting note after a standing lie.
 */
export async function honestReply(reply: string, runs: ToolRun[]): Promise<string> {
  const text = (reply || "").trim();
  if (!text)
    return "I do not have anything to confirm there. Tell me what you need and I will action it.";
  if (!CLAIM.test(text) || NOT_A_CLAIM.test(text)) return text;

  const backed = SENT_CLAIM.test(text)
    ? okIn(runs, SEND_TOOLS)
    : okIn(runs, COMPLETION_TOOLS);

  if (!backed) return rewriteToHonest(runs); // definite fake, deterministic, cannot fail open

  // Backed claim. Secondary net for subtle mismatches the regex missed.
  // If this check itself errors, the backed claim stands (safe failure).
  try {
    const succeeded = runs
      .filter((r) => r.ok && COMPLETION_TOOLS.has(r.name))
      .map((r) => r.name);
    const out = await claudeJSON<{ fabricated: boolean; issue?: string }>(
      "You check an assistant reply against the write tools that actually succeeded this turn. " +
        "If the reply claims a completed WRITE that no listed tool supports, set fabricated=true. " +
        "Drafting or showing without claiming it was saved is fine. Return JSON {fabricated:boolean, issue?:string}.",
      `Successful write tools: ${succeeded.join(", ") || "(none)"}\n\nReply:\n${text}`,
      300,
    );
    if (out?.fabricated) return rewriteToHonest(runs);
  } catch {
    /* secondary net only */
  }
  return text;
}
