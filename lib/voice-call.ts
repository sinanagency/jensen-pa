// Outbound phone calls via Twilio. WhatsApp's API cannot place voice calls and we
// cannot dial from a personal mobile, so a real "ring his phone and a voice
// speaks" needs a telephony number. Gated on Twilio creds; no-ops cleanly until
// TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM are set. Server-only.

export function twilioConfigured(): boolean {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c] as string));
}

// Calls `to` and speaks `message` (text-to-speech). Returns {ok} / {error}.
export async function callOwner(to: string, message: string): Promise<{ ok: boolean; error?: string }> {
  if (!twilioConfigured()) return { ok: false, error: "Twilio not configured (set TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM)" };
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const token = process.env.TWILIO_AUTH_TOKEN!;
  const from = process.env.TWILIO_FROM!;
  const voice = process.env.TWILIO_VOICE || "Polly.Amy"; // pleasant default; swap for Emir Voice TTS later
  const twiml = `<Response><Pause length="1"/><Say voice="${voice}">${escapeXml(message)}</Say></Response>`;
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: from, Twiml: twiml }).toString(),
    });
    if (!res.ok) return { ok: false, error: `Twilio ${res.status}: ${(await res.text()).slice(0, 200)}` };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}
