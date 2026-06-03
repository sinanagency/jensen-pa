import { NextRequest, NextResponse } from "next/server";
import { MAIL_COOKIE, decryptCreds } from "@/lib/mailbox";
import { sendMail, OutAttachment } from "@/lib/mail-ops";

export const runtime = "nodejs";
export const maxDuration = 45;

export async function POST(req: NextRequest) {
  const creds = await decryptCreds(req.cookies.get(MAIL_COOKIE)?.value);
  if (!creds) return NextResponse.json({ error: "No mailbox connected." }, { status: 401 });
  try {
    const b = await req.json();
    if (!b.to || !b.subject) return NextResponse.json({ error: "Recipient and subject required." }, { status: 400 });
    const attachments: OutAttachment[] = Array.isArray(b.attachments) ? b.attachments : [];
    const r = await sendMail(creds, { to: b.to, subject: b.subject, text: b.text || "", inReplyTo: b.inReplyTo, attachments });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
