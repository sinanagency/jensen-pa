import { NextResponse } from "next/server";
import { sbHeaders, sbRest } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET -> meetings queued for DigitalU attendance in the next 48h.
// Polled by the DigitalU worker (T4 host) to pick up new dispatch jobs.
// Returns events with digital_u_status='queued' AND a meeting URL AND a date
// within +/- 2 days. The worker marks them 'dispatched' via POST /mark when
// it joins the room, 'attended' when the recording completes.
export async function GET() {
  try {
    const today = new Date();
    const start = new Date(today); start.setDate(today.getDate() - 1);
    const end = new Date(today); end.setDate(today.getDate() + 2);
    const fromIso = start.toISOString().slice(0, 10);
    const toIso = end.toISOString().slice(0, 10);

    const path = `events?digital_u_status=eq.queued&meeting_url=not.is.null&date=gte.${fromIso}&date=lte.${toIso}&select=id,title,date,time,meeting_url,note,source_message_id&order=date.asc`;
    const res = await fetch(sbRest(path), { headers: sbHeaders(), cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json({ error: `Supabase ${res.status}: ${(await res.text()).slice(0, 200)}` }, { status: 502 });
    }
    const rows = await res.json();
    return NextResponse.json({ pending: rows });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
