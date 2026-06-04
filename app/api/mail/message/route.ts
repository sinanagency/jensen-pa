import { NextRequest, NextResponse } from "next/server";
import { MAIL_COOKIE, decryptCreds } from "@/lib/mailbox";
import { readMessage } from "@/lib/mail-ops";
import { readUnified } from "@/lib/mail-provider";

export const runtime = "nodejs";
export const maxDuration = 45;

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  // Unified (OAuth multi-account) message id.
  if (id) {
    try {
      return NextResponse.json({ message: await readUnified(id) });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || String(e) }, { status: 502 });
    }
  }
  // Legacy IMAP path (numeric uid + connected-mailbox cookie).
  const creds = await decryptCreds(req.cookies.get(MAIL_COOKIE)?.value);
  if (!creds) return NextResponse.json({ error: "No mailbox connected." }, { status: 401 });
  const uid = Number(req.nextUrl.searchParams.get("uid"));
  if (!uid) return NextResponse.json({ error: "id or uid required" }, { status: 400 });
  try {
    return NextResponse.json({ message: await readMessage(creds, uid) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 502 });
  }
}
