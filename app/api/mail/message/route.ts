import { NextRequest, NextResponse } from "next/server";
import { MAIL_COOKIE, decryptCreds } from "@/lib/mailbox";
import { readMessage } from "@/lib/mail-ops";

export const runtime = "nodejs";
export const maxDuration = 45;

export async function GET(req: NextRequest) {
  const creds = await decryptCreds(req.cookies.get(MAIL_COOKIE)?.value);
  if (!creds) return NextResponse.json({ error: "No mailbox connected." }, { status: 401 });
  const uid = Number(req.nextUrl.searchParams.get("uid"));
  if (!uid) return NextResponse.json({ error: "uid required" }, { status: 400 });
  try {
    const message = await readMessage(creds, uid);
    return NextResponse.json({ message });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 502 });
  }
}
