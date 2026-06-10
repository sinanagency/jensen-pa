import { NextRequest, NextResponse } from "next/server";
import * as ops from "@/lib/concierge/ops";
import { sweepAndPropose } from "@/lib/mail-sweep";

export const runtime = "nodejs";
export const maxDuration = 60;

function authed(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // FAIL CLOSED, same as /api/cron/daily
  const hdr = req.headers.get("authorization") || "";
  const key = new URL(req.url).searchParams.get("key") || "";
  return hdr === `Bearer ${secret}` || key === secret;
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Same onboarding gate as /api/cron/daily. Stay silent until Jensen has been
  // switched on; no proactive WhatsApp during listen-only onboarding.
  const prefs = await ops.getPrefs().catch(() => ({} as any));
  if (prefs?.onboarding !== false) return NextResponse.json({ ok: true, skipped: "onboarding" });

  const r = await sweepAndPropose();
  return NextResponse.json(r);
}
