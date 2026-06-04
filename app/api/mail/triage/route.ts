import { NextRequest, NextResponse } from "next/server";
import { MAIL_COOKIE, decryptCreds } from "@/lib/mailbox";
import { listInbox } from "@/lib/mail-ops";
import { triageInbox } from "@/lib/mail-triage";

export const runtime = "nodejs";
export const maxDuration = 60;

// GET -> latest inbox, each email classified into a quadrant with a needs-reply
// flag and a suggested draft. Cached by uid so repeat opens are cheap.
export async function GET(req: NextRequest) {
  const creds = await decryptCreds(req.cookies.get(MAIL_COOKIE)?.value);
  if (!creds) return NextResponse.json({ error: "No mailbox connected." }, { status: 401 });
  try {
    const list = await listInbox(creds, 20);
    const messages = await triageInbox(list);
    return NextResponse.json({ messages });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 502 });
  }
}
