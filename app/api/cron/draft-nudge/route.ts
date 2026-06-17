import { NextRequest, NextResponse } from "next/server";
import { sendTextAndLog } from "@/lib/sendTextAndLog";
import { whoIs } from "@/lib/whatsapp";
import { sbSelect, enc } from "@/lib/concierge/rest";

export const runtime = "nodejs";
export const maxDuration = 30;

const NUDGE_AFTER_MS = 4 * 3600 * 1000;
const SKIP_AFTER_MS = 24 * 3600 * 1000;

function authed(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const hdr = req.headers.get("authorization") || "";
  const key = new URL(req.url).searchParams.get("key") || "";
  return hdr === `Bearer ${secret}` || key === secret;
}

function owners(): string[] {
  return (process.env.OWNER_WHATSAPP || "").split(",").map((n) => n.trim()).filter(Boolean);
}

async function handle(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = await sbSelect<any>(
    "chat_messages",
    `party=eq.jensen&role=eq.assistant&content=ilike.*My draft reply*&select=id,content,ts&order=ts.desc&limit=30`
  ).catch(() => []);

  if (!rows.length) return NextResponse.json({ ok: true, scanned: 0, nudged: 0 });

  const now = Date.now();
  const nudged: any[] = [];
  const latched = await sbSelect<any>(
    "kv",
    `key=eq.draft_nudge_latched&select=value`
  ).catch(() => []);

  const alreadyNudged: Record<string, true> = (latched?.[0]?.value || {});

  const skipped: any[] = [];

  for (const row of rows) {
    const draftTs: number = row.ts;
    const age = now - draftTs;
    if (age < NUDGE_AFTER_MS) continue;

    const emailMatch = row.content.match(/\(email_id:\s*([^\s)]+)/);
    if (!emailMatch) continue;
    const emailId = emailMatch[1];
    if (alreadyNudged[emailId]) continue;

    if (age > SKIP_AFTER_MS) {
      skipped.push({ emailId, draftTs, ageHours: Math.round(age / 3600000), reason: "24h_no_reply" });
      alreadyNudged[emailId] = true;
      continue;
    }

    const nextMsgs = await sbSelect<any>(
      "chat_messages",
      `party=eq.jensen&role=eq.user&ts=gt.${draftTs}&select=content&limit=3&order=ts.asc`
    ).catch(() => []);

    const actioned = nextMsgs.some((m: any) => {
      const c = (m.content || "").toLowerCase().trim();
      return c === "yes" || c === "send" || c.startsWith("change to") || c.startsWith("edit") || c.startsWith("skip") || c === "send it";
    });
    if (actioned) continue;

    const to = owners().filter((n) => whoIs(n).role === "owner");
    if (!to.length) break;

    for (const num of to) {
      const hours = Math.round(age / 3600000);
      await sendTextAndLog(num, `Still waiting on your reply about a draft I sent ${hours}h ago. You can say "yes" to send, "change to: ..." to edit, or "skip" to drop it.`, { force: true, party: "jensen" });
    }

    nudged.push({ emailId, draftTs, ageHours: Math.round(age / 3600000) });
    alreadyNudged[emailId] = true;

    if (nudged.length >= 3) break;
  }

  if (nudged.length || skipped.length) {
    const prev = await sbSelect<any>("kv", "key=eq.draft_nudge_latched&select=value").catch(() => []);
    const merged = { ...((prev?.[0]?.value) || {}), ...alreadyNudged };
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/kv?key=eq.${enc("draft_nudge_latched")}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", apikey: process.env.SUPABASE_SERVICE_KEY || "", Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY || ""}`, Prefer: "return=minimal" },
      body: JSON.stringify({ value: merged, updated_at: Date.now() }),
    }).catch(() => {
      try {
        const k = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SECRET_KEY || "";
        fetch(`${process.env.SUPABASE_URL}/rest/v1/kv`, {
          method: "POST", headers: { "Content-Type": "application/json", apikey: k, Authorization: `Bearer ${k}`, Prefer: "return=minimal" },
          body: JSON.stringify({ key: "draft_nudge_latched", value: merged, updated_at: Date.now() }),
        }).catch(() => {});
      } catch {}
    });
  }

  return NextResponse.json({ ok: true, scanned: rows.length, nudged: nudged.length, skipped: skipped.length, details: [...nudged, ...skipped].length ? [...nudged, ...skipped] : undefined });
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
