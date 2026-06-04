import { NextRequest, NextResponse } from "next/server";
import { MAIL_COOKIE, decryptCreds } from "@/lib/mailbox";
import { readMessage } from "@/lib/mail-ops";
import { readUnified, unpackId, IMAP_ACCOUNT } from "@/lib/mail-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (id) {
    const { accountId, local } = unpackId(id);
    // IMAP item: read via the cookie creds.
    if (accountId === IMAP_ACCOUNT) {
      const creds = await decryptCreds(req.cookies.get(MAIL_COOKIE)?.value);
      if (!creds) return NextResponse.json({ error: "No mailbox connected." }, { status: 401 });
      try {
        return NextResponse.json({ message: await readMessage(creds, Number(local)) });
      } catch (e: any) {
        return NextResponse.json({ error: e?.message || String(e) }, { status: 502 });
      }
    }
    // OAuth (Microsoft / Zoho) item.
    try {
      return NextResponse.json({ message: await readUnified(id) });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || String(e) }, { status: 502 });
    }
  }
  // Legacy ?uid= path (the standalone /mail IMAP inbox).
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
