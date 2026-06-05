import { NextRequest, NextResponse } from "next/server";
import * as ops from "@/lib/concierge/ops";
import { sendWhatsApp } from "@/lib/whatsapp";
import { callOwner, twilioConfigured } from "@/lib/voice-call";
import { dubaiToday, dayPart } from "@/lib/time";

export const runtime = "nodejs";
export const maxDuration = 60;

function owners(): string[] {
  return (process.env.OWNER_WHATSAPP || "").split(",").map((n) => n.trim()).filter(Boolean);
}
function authed(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // not configured -> allow (Vercel cron / dev)
  const hdr = req.headers.get("authorization") || "";
  const key = new URL(req.url).searchParams.get("key") || "";
  return hdr === `Bearer ${secret}` || key === secret;
}

async function buildBrief(): Promise<{ text: string; q1: number; call: string }> {
  const today = dubaiToday();
  const [q1, q2, events] = await Promise.all([
    ops.listTasks({ quadrant: 1, done: false }).catch(() => []),
    ops.listTasks({ quadrant: 2, done: false }).catch(() => []),
    ops.queryCalendar({ from: today, to: today }).catch(() => []),
  ]);
  const lines: string[] = [`Good ${dayPart()}. Here is your board for today.`];
  if (q1.length) {
    lines.push(`\n*Do first (${q1.length}):*`);
    q1.slice(0, 5).forEach((t: any) => lines.push(`• ${t.title}`));
  } else {
    lines.push(`\n*Do first:* nothing urgent. Clean board. 🤍`);
  }
  if (events.length) {
    lines.push(`\n*Today's schedule:*`);
    events.slice(0, 6).forEach((e: any) => lines.push(`• ${e.time ? e.time + " " : ""}${e.title}`));
  }
  if (q2.length) lines.push(`\n${q2.length} important item${q2.length > 1 ? "s" : ""} I'm protecting for you.`);
  lines.push(`\nReply here anytime and I'll handle it.`);
  const call =
    q1.length > 0
      ? `Hello, this is your A.I. concierge from La Rencontre. A quick reminder: you have ${q1.length} urgent item${q1.length > 1 ? "s" : ""} today, starting with ${q1[0].title}. The full brief is on WhatsApp. Have a great day.`
      : `Hello, this is your A.I. concierge from La Rencontre. Your board is clear today, nothing urgent. The full brief is on WhatsApp. Have a great day.`;
  return { text: lines.join("\n"), q1: q1.length, call };
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const brief = await buildBrief();
    const to = owners();
    const sent: Record<string, boolean> = {};
    for (const n of to) sent[n] = await sendWhatsApp(n, brief.text);

    // Optional voice call to the primary owner (Jensen) when enabled + configured.
    let call: any = { attempted: false };
    if (process.env.CALL_REMINDERS === "on" && twilioConfigured() && to[0]) {
      const r = await callOwner(to[0], brief.call);
      call = { attempted: true, ...r };
    }
    return NextResponse.json({ ok: true, q1: brief.q1, sent, call });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
