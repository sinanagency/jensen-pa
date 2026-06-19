import { NextRequest, NextResponse } from "next/server";
import { kvGet, kvSet } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 10;

function authed(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const hdr = req.headers.get("authorization") || "";
  const key = new URL(req.url).searchParams.get("key") || "";
  return hdr === `Bearer ${secret}` || key === secret;
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const body = await req.json().catch(() => ({}));
    const mute = body.mute !== false;
    await kvSet("bot_muted", mute);
    return NextResponse.json({ ok: true, muted: mute });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const muted = await kvGet("bot_muted", false);
    return NextResponse.json({ ok: true, muted });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
