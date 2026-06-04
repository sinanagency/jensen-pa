import { NextRequest, NextResponse } from "next/server";
import { aggregateInbox, hasAccounts, packId, IMAP_ACCOUNT, UMailSummary } from "@/lib/mail-provider";
import { triageInbox } from "@/lib/mail-triage";
import { MAIL_COOKIE, decryptCreds } from "@/lib/mailbox";
import { listInbox } from "@/lib/mail-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET -> latest mail across ALL connected mailboxes (Outlook + Zoho via OAuth,
// plus a cPanel/IMAP mailbox if connected), each classified into a quadrant with
// a needs-reply flag and a suggested draft.
export async function GET(req: NextRequest) {
  const creds = await decryptCreds(req.cookies.get(MAIL_COOKIE)?.value);
  const haveOAuth = await hasAccounts();
  if (!creds && !haveOAuth) return NextResponse.json({ error: "No mailbox connected." }, { status: 401 });

  try {
    const [oauth, imap] = await Promise.all([
      haveOAuth ? aggregateInbox(15) : Promise.resolve([] as UMailSummary[]),
      creds
        ? listInbox(creds, 15)
            .then((ms) =>
              ms.map<UMailSummary>((m) => ({
                id: packId(IMAP_ACCOUNT, String(m.uid)), accountId: IMAP_ACCOUNT, accountEmail: creds.email, provider: "imap",
                from: m.from, fromEmail: m.fromEmail, subject: m.subject, date: m.date, snippet: m.snippet, seen: m.seen, attachments: m.attachments,
              }))
            )
            .catch(() => [] as UMailSummary[])
        : Promise.resolve([] as UMailSummary[]),
    ]);
    const combined = [...oauth, ...imap].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const messages = await triageInbox(combined);
    // Events are DETECTED here but NOT auto-added — Jensen confirms each from the
    // mail modal (see /api/calendar/add).
    return NextResponse.json({ messages }, { headers: { "cache-control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 502 });
  }
}
