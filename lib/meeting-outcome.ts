// Meeting outcome classifier — separated from app/api/ingest/route.ts so it's
// (a) importable from the verify script and (b) reusable by future paths
// (operator-injected reclassification, retry endpoints). Route files in the
// Next.js App Router can only export route handlers + a small set of config
// fields, so the classifier and its helpers live here.
//
// Background (2026-06-12, KT #234): the meeting-bot dispatched to a Zomato
// Meet at 17:00, joined and sat the full window, but Jatin never spoke. The
// ingest endpoint at app/api/ingest/route.ts:70 then said "I finished Zomato
// call (retry) and I have the notes for you." with a hallucinated summary.
// The classifier here evaluates the transcript / duration / notes shape and
// returns 'empty' when the recording yielded no substance, so the calling
// route can ship a single ask-once message instead of a fake summary.

export type MeetingOutcome = "happened" | "empty";

// Two strong signals make a capture "empty":
//   (a) short duration: < 60s of recording (a real meeting goes longer)
//   (b) thin transcript: < 200 chars of actual content after trim
// Either alone is enough. Both together is a hard empty. We're conservative
// on the upper bound because the cost of a false 'empty' is one extra ask
// to Jensen; the cost of a false 'happened' is a hallucinated summary that
// breaks trust (the bug we're fixing).
export function classifyOutcome(opts: { transcript: string; durationSec?: number; notesSummary?: string }): MeetingOutcome {
  const transcript = String(opts.transcript || "").trim();
  const duration = Number(opts.durationSec || 0);
  const summaryLen = String(opts.notesSummary || "").trim().length;
  // Hard empty: under one minute AND under two hundred chars of transcript.
  if (duration > 0 && duration < 60 && transcript.length < 200) return "empty";
  // Thin transcript regardless of duration: the recording produced almost no
  // text. The meeting-bot strips silence so 200 chars across any duration is
  // empty content.
  if (transcript.length < 200) return "empty";
  // Caught-some-audio-but-no-substance: transcript is short and the bot's
  // own structured notes have nothing in them. Defends against the
  // meeting-bot transcribing a few words of background noise that pass the
  // 200-char floor without yielding meaning.
  if (transcript.length < 500 && summaryLen < 60) return "empty";
  return "happened";
}

// Build the asking-once message for an empty outcome. Single line, ask one
// clear question, do not loop. Pairs with KT #234: bots must give the human
// ONE clear ask, then silence.
export function buildEmptyOutcomeMessage(title: string, durationSec?: number): string {
  const heard = !durationSec || durationSec === 0
    ? "almost no audio"
    : durationSec < 30
      ? `only ${durationSec}s of audio`
      : "mostly silence";
  const raw = `I joined ${title || "the meeting"} and sat the full window, but I caught ${heard}. Did the conversation happen elsewhere, or did it not actually take place? If you have a recording or transcript, paste it here and I will still write the notes.`;
  return raw.replace(/—/g, ", ").replace(/–/g, ", ");
}

// Max-1-retry guard for /api/ingest. The T4 meeting-bot worker can call back
// for the same events.id more than once (re-tries, two captures, partial
// failures). Without a guard, each callback ships a fresh WhatsApp to Jensen.
// On 2026-06-12 the Zomato call produced FIVE pings within 55 minutes for the
// same event — one hallucinated summary plus three empty-outcome probes.
//
// Strict rule: if events.outcome is already 'happened', 'empty', or
// 'resolved_by_email', we have already shipped Jensen exactly one ack for
// that meeting. Any subsequent ingest callback is a no-op. The 'happened'
// path stays gated so a re-run never re-extracts tasks against a transcript
// we already processed. 'awaiting_human_verdict' is NOT terminal: it means
// the bot asked Jensen and is waiting on his answer, so a fresh capture
// (e.g., he forwarded the recording) should still be allowed through.
//
// Failure path is intentionally NOT gated here. A "could not capture
// (waiting room, password)" failure can legitimately be retried after the
// human fixes the issue; the small risk of a duplicate "couldn't capture"
// notice is preferable to silently dropping a real retry.
export function isTerminalOutcome(outcome: string | null | undefined): boolean {
  if (!outcome) return false;
  return outcome === "happened" || outcome === "empty" || outcome === "resolved_by_email";
}
