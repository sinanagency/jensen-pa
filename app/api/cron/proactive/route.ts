// Proactive WhatsApp send endpoint. One-shot pings to Jensen authored by the
// operator (Taona) and scheduled outside the app (Mac launchd, Vercel cron, or
// a future proactive_pings queue). Authed by CRON_SECRET, routes through the
// sendTextAndLog chokepoint so Law 2 (single send door) and Law 5 (dash strip,
// applied inside sendWhatsApp) both hold. JENSEN_MODE=TRAINING gate still
// applies via sendWhatsApp; pass {"force": true} to bypass for an owner-direct
// ping. Returns 200 with {ok, persisted, sent} once the transcript row is in
// place even if the wire send is suppressed (training gate), so we never lose
// the brain-side record of intent.

import { NextRequest, NextResponse } from "next/server";
import { sendTextAndLog } from "@/lib/sendTextAndLog";

export const runtime = "nodejs";
export const maxDuration = 30;

function authed(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const hdr = req.headers.get("authorization") || "";
  const key = new URL(req.url).searchParams.get("key") || "";
  return hdr === `Bearer ${secret}` || key === secret;
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const { to, text, force, party } = (await req.json()) as {
      to?: string;
      text?: string;
      force?: boolean;
      party?: string;
    };
    if (!to || !text) return NextResponse.json({ error: "to+text required" }, { status: 400 });
    const r = await sendTextAndLog(to, text, { force, party });
    return NextResponse.json({ ok: true, sent: r.ok });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
