import { NextRequest, NextResponse } from "next/server";
import { MAIL_COOKIE, decryptCreds } from "@/lib/mailbox";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const creds = await decryptCreds(req.cookies.get(MAIL_COOKIE)?.value);
  return NextResponse.json({ connected: !!creds, email: creds?.email || null, provider: creds?.provider || null });
}
