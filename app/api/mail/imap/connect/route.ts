import { NextRequest, NextResponse } from "next/server";
import { MailCreds, PRESETS } from "@/lib/mailbox";
import { verifyMailbox } from "@/lib/mail-ops";
import { upsertImapAccount } from "@/lib/mail-accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Add a cPanel / IMAP mailbox to the multi-account store (so Jensen can add
// jensen@ and info@larencontre.ae, etc., all flowing into the one inbox).
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
      return NextResponse.json({ ok: false, error: "Email, password, and server hosts are required." }, { status: 400 });
    }
    const check = await verifyMailbox(creds);
    if (!check.ok) return NextResponse.json({ ok: false, error: check.error || "Could not sign in to that mailbox." }, { status: 401 });

    const account = await upsertImapAccount(creds.email, creds);
    return NextResponse.json({ ok: true, account });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
