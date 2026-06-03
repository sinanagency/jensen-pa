import { NextRequest, NextResponse } from "next/server";
import { MAIL_COOKIE, decryptCreds } from "@/lib/mailbox";
import { listInbox } from "@/lib/mail-ops";

export const runtime = "nodejs";
export const maxDuration = 45;

export async function GET(req: NextRequest) {
  const creds = await decryptCreds(req.cookies.get(MAIL_COOKIE)?.value);
  if (!creds) return NextResponse.json({ error: "No mailbox connected." }, { status: 401 });
  try {
    const messages = await listInbox(creds, 25);
    return NextResponse.json({ messages });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 502 });
  }
}
