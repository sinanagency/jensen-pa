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

function siteUrl(): string {
  // Prefer an explicit override (set on Vercel), then VERCEL_URL, then the
  // canonical production domain.
  const explicit = process.env.JENSEN_PUBLIC_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const v = process.env.VERCEL_URL;
  if (v) return `https://${v.replace(/\/$/, "")}`;
  return "https://jensen.zanii.agency";
}

// Fire a dispatch at the meeting-bot. If scheduledAt is omitted, the bot joins
// immediately. Returns { ok, mode?, error? }.
export async function dispatchMeetingBot(opts: {
  link: string;
  title?: string;
  scheduledAt?: string; // ISO 8601
  displayName?: string;
}): Promise<{ ok: boolean; mode?: string; eventId?: string; botId?: string; error?: string }> {
  const base = (process.env.MEETING_BOT_URL || "").replace(/\/$/, "");
  const key = process.env.MEETING_BOT_API_KEY;
  if (!base || !key) {
    return { ok: false, error: "MEETING_BOT_URL or MEETING_BOT_API_KEY not configured" };
  }
  const ingestKey = process.env.INGEST_KEY;
  const callbackUrl = `${siteUrl()}/api/ingest`;
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
