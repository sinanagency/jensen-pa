import { NextRequest, NextResponse } from "next/server";
import { sbHeaders, sbRest } from "@/lib/db";

export const runtime = "nodejs";

// POST { id, status } -> updates events.digital_u_status.
// Used by the DigitalU worker (T4 host) to report state transitions:
//   queued -> dispatched (bot joined the room)
//   dispatched -> attended (recording captured + uploaded)
//   queued|dispatched -> failed (couldn't join / recording lost)
//   queued -> skipped (operator decision: don't attend this one)
const VALID = new Set(["queued", "dispatched", "attended", "failed", "skipped"]);

export async function POST(req: NextRequest) {
  try {
    const { id, status } = await req.json();
    if (!id || !VALID.has(status)) {
      return NextResponse.json({ error: "id and valid status required" }, { status: 400 });
    }
    const res = await fetch(sbRest(`events?id=eq.${encodeURIComponent(id)}`), {
      method: "PATCH",
      headers: { ...sbHeaders(), Prefer: "return=minimal" },
      body: JSON.stringify({ digital_u_status: status }),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `Supabase ${res.status}: ${(await res.text()).slice(0, 200)}` }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
