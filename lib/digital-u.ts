// Digital Jensen meeting-bot driver. The ONE place jensen-pa talks to the
// zanii-meetingbot service. Used by:
//   1. WhatsApp handler: Jensen pastes a Meet/Zoom/Teams link, fire immediately.
//   2. Mail-sweep: triage finds an emailed invite with a meetingUrl + date+time,
//      schedule the bot for 30 seconds before the meeting starts.
//
// The meeting-bot's /api/dispatch endpoint accepts {link, title?, scheduledAt?,
// callbackUrl, callbackKey?, displayName?} and POSTs notes back to callbackUrl
// when the capture finishes. Our callback is jensen-pa's /api/ingest, which
// extracts tasks and WhatsApps Jensen the summary in his own voice.

const MEET_RE = /(https?:\/\/(?:meet\.google\.com|[^\s]*\.zoom\.us|teams\.(?:microsoft|live)\.com)\/[\w\-/?&=#.@]+)/i;

// Pulls the first Meet/Zoom/Teams URL out of free text. Trailing punctuation
// (commas, full stops, parens, quotes) is trimmed because messaging clients
// frequently append them to URLs.
export function extractMeetingLink(text: string): string | null {
  const m = String(text || "").match(MEET_RE);
  if (!m) return null;
  return m[1].replace(/[).,;'"!?\]]+$/, "");
}

// Decide what meeting_url to persist on a calendar write. An explicit value the
// model passed wins; otherwise pull the link straight out of the operator's
// triggering message. This is the deterministic capture that stops links from
// being dropped: the LLM is no longer trusted to remember to pass it (Sotiris,
// 25 Jun, the bot even said "Teams link saved" and saved nothing). KT #206573.
export function meetingUrlForWrite(explicit: string | undefined | null, lastInbound: string | undefined | null): string | undefined {
  if (explicit && String(explicit).trim()) {
    const inExplicit = extractMeetingLink(String(explicit));
    return inExplicit || String(explicit).trim();
  }
  return extractMeetingLink(String(lastInbound || "")) || undefined;
}

function siteUrl(): string {
  // Prefer an explicit override (set on Vercel), then VERCEL_URL, then the
  // canonical production domain.
  const explicit = process.env.JENSEN_PUBLIC_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const v = process.env.VERCEL_URL;
  if (v) return `https://${v.replace(/\/$/, "")}`;
  return "https://jensen.zanii.agency";
}

// Detect "make the bot leave the meeting" intent in a WhatsApp inbound. We are
// generous about phrasing (Jensen will type things like "yo get out", "stop
// it", "kill the bot", "leave", "cancel") and conservative about false
// positives: the verb must be the dominant intent of the message, NOT a
// phrase inside a longer thought ("stop me if I am wrong" should not fire).
// Returns true only when the message is essentially the cancel verb on its
// own (with optional bot-direction prefix like "digital jensen").
const CANCEL_RE = /^(?:(?:digital\s+jensen\b)|(?:hey\s+(?:digital\s+jensen|bot|jensen))\b)?\s*[,.:]?\s*(stop(?:\s+it)?|leave(?:\s+(?:the\s+)?(?:meeting|call|room))?|cancel|abort|get\s+out|kill\s+(?:it|the\s+bot)|quit|exit)\s*[.!]?\s*$/i;

export function isCancelIntent(text: string): boolean {
  const t = String(text || "").trim();
  if (!t || t.length > 80) return false; // long messages are not cancels
  return CANCEL_RE.test(t);
}

// Fire the cancel on the meeting-bot. Returns { ok, title?, error? }.
export async function cancelActiveBot(): Promise<{ ok: boolean; title?: string; botId?: string; error?: string }> {
  const base = (process.env.MEETING_BOT_URL || "").replace(/\/$/, "");
  const key = process.env.MEETING_BOT_API_KEY;
  if (!base || !key) return { ok: false, error: "MEETING_BOT_URL or MEETING_BOT_API_KEY not configured" };
  try {
    const r = await fetch(`${base}/api/dispatch/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key },
      body: JSON.stringify({}),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: body?.error || `${r.status} ${r.statusText}` };
    return { ok: true, title: body?.title, botId: body?.botId };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// Fire a dispatch at the meeting-bot. If scheduledAt is omitted, the bot joins
// immediately. Returns { ok, mode?, error? }.
export async function dispatchMeetingBot(opts: {
  link: string;
  title?: string;
  scheduledAt?: string; // ISO 8601
  displayName?: string;
  phone?: string;       // WhatsApp number to send the summary back to
}): Promise<{ ok: boolean; mode?: string; eventId?: string; botId?: string; error?: string }> {
  const base = (process.env.MEETING_BOT_URL || "").replace(/\/$/, "");
  const key = process.env.MEETING_BOT_API_KEY;
  if (!base || !key) {
    return { ok: false, error: "MEETING_BOT_URL or MEETING_BOT_API_KEY not configured" };
  }
  const ingestKey = process.env.INGEST_KEY;
  const callbackUrl = `${siteUrl()}/api/ingest${opts.phone ? `?phone=${opts.phone}` : ""}`;
  try {
    const r = await fetch(`${base}/api/dispatch`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key },
      body: JSON.stringify({
        link: opts.link,
        title: opts.title || "",
        scheduledAt: opts.scheduledAt || undefined,
        callbackUrl,
        callbackKey: ingestKey || undefined,
        displayName: opts.displayName || "Digital Jensen",
        phone: opts.phone || undefined,
        // KT #362: opt in to lifecycle pings. The engine calls back {event:"joined"}
        // when admitted and {event:"waiting"} if stuck in the waiting room. The
        // /api/ingest handler handles both; flag and handler ship together.
        lifecycle: true,
      }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      return { ok: false, error: body?.error || `${r.status} ${r.statusText}` };
    }
    return { ok: true, mode: body?.mode, eventId: body?.eventId, botId: body?.botId };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}
