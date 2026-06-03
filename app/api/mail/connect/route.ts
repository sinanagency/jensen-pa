import { NextRequest, NextResponse } from "next/server";
import { MAIL_COOKIE, MailCreds, PRESETS, encryptCreds } from "@/lib/mailbox";
import { verifyMailbox } from "@/lib/mail-ops";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const preset = PRESETS[b.provider] || PRESETS.custom;
    const creds: MailCreds = {
      provider: b.provider || "custom",
      email: String(b.email || "").trim(),
      pass: String(b.pass || ""),
      imapHost: (b.imapHost || preset.imapHost).trim(),
      imapPort: Number(b.imapPort || preset.imapPort),
      smtpHost: (b.smtpHost || preset.smtpHost).trim(),
      smtpPort: Number(b.smtpPort || preset.smtpPort),
    };
    if (!creds.email || !creds.pass || !creds.imapHost || !creds.smtpHost) {
      return NextResponse.json({ ok: false, error: "Email, app password, and server hosts are required." }, { status: 400 });
    }
    const check = await verifyMailbox(creds);
    if (!check.ok) return NextResponse.json({ ok: false, error: check.error }, { status: 401 });

    const token = await encryptCreds(creds);
    const res = NextResponse.json({ ok: true, email: creds.email, count: check.count });
    res.cookies.set(MAIL_COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 90 });
    return res;
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
