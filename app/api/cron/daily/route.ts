import { NextRequest, NextResponse } from "next/server";
import * as ops from "@/lib/concierge/ops";
import { sendWhatsApp, sendWhatsAppTemplate, whoIs } from "@/lib/whatsapp";
import { callOwner, twilioConfigured } from "@/lib/voice-call";
import { dubaiToday, dayPart } from "@/lib/time";
import { isInWindow } from "@/lib/whatsapp-window";
import { peekCount } from "@/lib/mail-pending";

export const runtime = "nodejs";
export const maxDuration = 60;

function owners(): string[] {
  return (process.env.OWNER_WHATSAPP || "").split(",").map((n) => n.trim()).filter(Boolean);
}
function authed(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // FAIL CLOSED: never run unauthenticated (this route sends real messages)
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
  // Open warm, peer-counsel tone (matches Jensen's persona tree), then drop
  // into the board. Greeting first so the brief never reads sterile.
  const greeting = dayPart() === "morning"
    ? `Morning, Jensen. How's the head?`
    : `Good ${dayPart()}, Jensen.`;
  const lines: string[] = [greeting, "", `Here is your board for today.`];
  if (q1.length) {
    lines.push(`\n*Do first (${q1.length}):*`);
    q1.slice(0, 5).forEach((t: any) => lines.push(`• ${t.title}`));
  } else {
    lines.push(`\n*Do first:* nothing urgent. Clean board.`);
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
    // Stay silent until Jensen is switched on (past onboarding). No proactive
    // messages while he is still being set up.
    const prefs = await ops.getPrefs().catch(() => ({} as any));
    if (prefs?.onboarding !== false) return NextResponse.json({ ok: true, skipped: "onboarding" });

    const brief = await buildBrief();
    // Brief goes to JENSEN only (the owner), never the admin/developer.
    const to = owners().filter((n) => whoIs(n).role === "owner");

    // 24-hour customer-service window split. Free-text inside the window lands
    // (the rich brief). Outside the window, free-text is silently dropped by
    // Meta — we MUST switch to a pre-approved utility template that nudges
    // Jensen to engage, so the rich brief flows on his reply turn. The full
    // text is still logged via the chokepoint regardless (the bot's memory
    // never lies about what it tried to say).
    const tmplName = process.env.MORNING_BRIEF_TEMPLATE;     // e.g. "morning_brief_v1"
    const tmplLang = process.env.MORNING_BRIEF_TEMPLATE_LANG || "en_US";

    const sent: Record<string, any> = {};
    const pendingMail = await peekCount().catch(() => 0);
    for (const n of to) {
      const win = await isInWindow("jensen");
      if (win.open) {
        const ok = await sendWhatsApp(n, brief.text);
        sent[n] = { mode: "text", ok, hoursSince: Number(win.hoursSince.toFixed(1)) };
      } else if (tmplName) {
        // Template parameters: [q1 count, q2 count, today events count]. Must
        // match the body slots in the template Meta approved. Adjust template
        // body wording in WhatsApp Manager, not here.
        const today = dubaiToday();
        const [q1, q2, events] = await Promise.all([
          ops.listTasks({ quadrant: 1, done: false }).catch(() => []),
          ops.listTasks({ quadrant: 2, done: false }).catch(() => []),
          ops.queryCalendar({ from: today, to: today }).catch(() => []),
        ]);
        const wamid = await sendWhatsAppTemplate(n, tmplName, tmplLang, [
          String((q1 || []).length),
          String((q2 || []).length),
          String((events || []).length),
          String(pendingMail),
        ]);
        sent[n] = { mode: "template", template: tmplName, ok: !!wamid, hoursSinceLast: Number(win.hoursSince.toFixed(1)) };
      } else {
        // No template configured + window closed: skip rather than silently
        // fail. Operator sees this in the response payload and knows to submit
        // a Meta template (instructions in MEMORY.md project note).
        console.log(`[daily-brief] off-window (${win.hoursSince.toFixed(1)}h since last inbound) and MORNING_BRIEF_TEMPLATE not set — suppressing send to ${n.replace(/[^0-9]/g, "").slice(-4)}`);
        sent[n] = { mode: "skipped", reason: "off-window, no template configured", hoursSince: Number(win.hoursSince.toFixed(1)) };
      }
    }

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
