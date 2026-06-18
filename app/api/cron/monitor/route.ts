import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/db";
import { sendTextAndLog } from "@/lib/sendTextAndLog";
import { whoIs } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const maxDuration = 60;

const BOTS = [
  { name: "jensen", url: "https://jensen.zanii.agency/api/whatsapp" },
  { name: "sasa",   url: "https://command.nisria.co/api/whatsapp/webhook" },
  { name: "cth",    url: "https://cthalaal.co.za/api/whatsapp/webhook" },
];

const DEGRADED_CONSECUTIVE_THRESHOLD = 3;
const INBOUND_DROP_FACTOR = 0.2;

function authed(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const hdr = req.headers.get("authorization") || "";
  const key = new URL(req.url).searchParams.get("key") || "";
  return hdr === `Bearer ${secret}` || key === secret;
}

function owners(): string[] {
  return (process.env.OWNER_WHATSAPP || "")
    .split(",")
    .map((n) => n.trim())
    .filter((n) => whoIs(n).role === "owner" || whoIs(n).role === "developer");
}

async function httpCheck(url: string): Promise<{ ok: boolean; status: number; ms: number }> {
  const start = Date.now();
  try {
    const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(8000) });
    return { ok: true, status: res.status, ms: Date.now() - start };
  } catch (e: any) {
    return { ok: false, status: 0, ms: Date.now() - start };
  }
}

async function inboundRate(db: ReturnType<typeof admin>): Promise<{ last5m: number; baseline: number }> {
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const [recent, past] = await Promise.all([
    db.from("chat_messages").select("id", { count: "exact", head: true })
      .gte("ts", fiveMinAgo),
    db.from("chat_messages").select("id", { count: "exact", head: true })
      .gte("ts", thirtyMinAgo),
  ]);
  const last5m = typeof recent.count === "number" ? recent.count : 0;
  const total30 = typeof past.count === "number" ? past.count : 0;
  const baseline = Math.max(Math.round(total30 / 6), 1);
  return { last5m, baseline };
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const db = admin();
  const results: any[] = [];
  let fleetDegraded = false;

  for (const bot of BOTS) {
    try {
      const http = await httpCheck(bot.url);
      let status = "ok";
      let error: string | null = null;

      if (!http.ok || http.status === 0) {
        status = "down";
        error = `HTTP unreachable`;
      } else if (bot.name === "jensen") {
        const { last5m, baseline } = await inboundRate(db);
        if (last5m < baseline * INBOUND_DROP_FACTOR) {
          const recentChecks = await db
            .from("health_checks")
            .select("status")
            .eq("bot", "jensen")
            .order("checked_at", { ascending: false })
            .limit(DEGRADED_CONSECUTIVE_THRESHOLD);
          const recent = (recentChecks.data || []) as { status: string }[];
          const degradedCount = recent.filter((r) => r.status === "degraded").length;
          if (degradedCount >= DEGRADED_CONSECUTIVE_THRESHOLD - 1) {
            status = "degraded";
            error = `Inbound ${last5m}/5m vs baseline ${baseline}/5m for ${degradedCount + 1}+ checks`;
          } else {
            status = "degraded";
          }
        }
      }

      await db.from("health_checks").insert({
        bot: bot.name,
        status,
        error,
        latency_ms: http.ms,
        http_status: http.status,
        inbound_last_5m: bot.name === "jensen" ? (await inboundRate(db)).last5m : null,
        inbound_baseline: bot.name === "jensen" ? (await inboundRate(db)).baseline : null,
      });

      results.push({ bot: bot.name, status, error, http: http.status, ms: http.ms });
      if (status === "degraded" || status === "down") fleetDegraded = true;
    } catch (e: any) {
      results.push({ bot: bot.name, status: "down", error: e.message });
      fleetDegraded = true;
    }
  }

  // Alert if fleet has issues
  if (fleetDegraded) {
    const to = owners();
    const msg = `[fleet monitor] ${new Date().toISOString()}\n${results.map((r) => `${r.bot}: ${r.status}${r.error ? ` (${r.error})` : ""}`).join("\n")}`;
    for (const owner of to) {
      sendTextAndLog(owner, msg, { party: "taona", dev: false }).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true, checks: results });
}
