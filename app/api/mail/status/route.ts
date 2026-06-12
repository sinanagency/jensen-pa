import { NextRequest, NextResponse } from "next/server";
import { MAIL_COOKIE, decryptCreds } from "@/lib/mailbox";
import { listAccounts } from "@/lib/mail-accounts";

export const runtime = "nodejs";

// Two paths to "connected": the legacy single-mailbox cookie, OR any account
// in the multi-account store. The /mail page used to only check the cookie,
// so even with both larencontre IMAPs live it would still show the connect prompt.
export async function GET(req: NextRequest) {
  const creds = await decryptCreds(req.cookies.get(MAIL_COOKIE)?.value);
  if (creds) {
    return NextResponse.json({ connected: true, email: creds.email, provider: creds.provider, accountCount: 1 });
  }
  try {
    const accounts = await listAccounts();
    if (accounts.length > 0) {
      const primary = accounts[0];
      return NextResponse.json({
        connected: true,
        email: primary.email,
        provider: primary.provider,
        accountCount: accounts.length,
      });
    }
  } catch {}
  return NextResponse.json({ connected: false, email: null, provider: null, accountCount: 0 });
}
