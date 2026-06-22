import { NextRequest, NextResponse } from "next/server";
import { admin, kvGet, kvSet } from "@/lib/db";
import { sendTextAndLog } from "@/lib/sendTextAndLog";
import { whoIs, devPhone } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const maxDuration = 60;

const BOTS = [
  { name: "jensen", url: "https://jensen.zanii.agency/api/whatsapp" },
  { name: "sasa",   url: "https://command.nisria.co/api/whatsapp/webhook" },
  { name: "cth",    url: "https://cthalaal.co.za/api/whatsapp/webhook" },
];

const DEGRADED_CONSECUTIVE_THRESHOLD = 3;
const INBOUND_DROP_FACTOR = 0.2;
const ALERT_COOLDOWN_MS = 5 * 60 * 1000;

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
  // chat_messages.ts is epoch-ms (bigint); compare to NUMBERS, not ISO strings
  // (the old ISO bound silently never matched — FM-20, the dead inbound signal).
  const fiveMinAgo = Date.now() - 5 * 60 * 1000;
  const thirtyMinAgo = Date.now() - 30 * 60 * 1000;
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
      let ir: { last5m: number; baseline: number } | null = null;

      if (!http.ok || http.status === 0 || http.status >= 500) {
        // 403 is the EXPECTED Meta webhook-verify rejection on a bare GET (= up).
        // Only a network failure or a 5xx is a real outage (FM-28).
        status = "down";
        error = http.status >= 500 ? `HTTP ${http.status}` : `HTTP unreachable`;
      } else if (bot.name === "jensen") {
        ir = await inboundRate(db);
        const { last5m, baseline } = ir;
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
          }
        }
      }

      await db.from("health_checks").insert({
        bot: bot.name,
        status,
        error,
        latency_ms: http.ms,
        http_status: http.status,
        inbound_last_5m: ir?.last5m ?? null,
        inbound_baseline: ir?.baseline ?? null,
      });

      results.push({ bot: bot.name, status, error, http: http.status, ms: http.ms });
      if (status === "degraded" || status === "down") fleetDegraded = true;
    } catch (e: any) {
      results.push({ bot: bot.name, status: "down", error: e.message });
      fleetDegraded = true;
    }
  }

  // PAGE the developer ONLY, and ONLY on a real DOWN (webhook unreachable / 5xx) —
  // never on quiet-night "degraded" (low inbound), never to owners()/Jensen. The old
  // block sent to owners() (which included Jensen) with a body containing "sasa", so
  // Jensen's own wall scrubbed it AND it leaked internal monitoring to the client
  // (FM-19/BUG-001). devPhone() is role=developer, which bypasses the send wall
  // (whatsapp.ts), so the alert arrives intact with the real bot names. Cooldown is
  // keyed on a kv marker of the last ALERT SENT, not the per-minute degraded
  // health_checks heartbeat that kept the old cooldown permanently shut (FM-27).
  const downBots = results.filter((r) => r.status === "down");
  if (downBots.length > 0) {
    const dev = devPhone();
    const last = await kvGet<{ ts: number }>("monitor_last_alert", { ts: 0 }).catch(() => ({ ts: 0 }));
    if (dev && Date.now() - (last?.ts || 0) >= ALERT_COOLDOWN_MS) {
      const msg = `[fleet monitor] ${new Date().toISOString()}\nDOWN: ${downBots.map((r) => `${r.bot} (${r.error || `http ${r.http}`})`).join(", ")}`;
      await sendTextAndLog(dev, msg, { party: "taona" }).catch(() => {});
      await kvSet("monitor_last_alert", { ts: Date.now() }).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true, checks: results });
}
