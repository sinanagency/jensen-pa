import { NextResponse } from "next/server";
import { aggregateInbox, hasAccounts } from "@/lib/mail-provider";
import { triageInbox } from "@/lib/mail-triage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET -> latest mail across ALL connected mailboxes (Outlook + Zoho), each
// classified into a quadrant with a needs-reply flag and a suggested draft.
export async function GET() {
  if (!(await hasAccounts())) return NextResponse.json({ error: "No mailbox connected." }, { status: 401 });
  try {
    const list = await aggregateInbox(15);
    const messages = await triageInbox(list);
    return NextResponse.json({ messages });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 502 });
  }
}
