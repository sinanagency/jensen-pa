import { NextRequest, NextResponse } from "next/server";
import { sendTextAndLog } from "@/lib/sendTextAndLog";
import { whoIs } from "@/lib/whatsapp";
import { sbSelect, sbUpsert, enc } from "@/lib/concierge/rest";

export const runtime = "nodejs";
export const maxDuration = 30;

const NUDGE_AFTER_MS = 4 * 3600 * 1000;
const SKIP_AFTER_MS = 24 * 3600 * 1000;
const MAX_NUDGES = 2;

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
  return NextResponse.json({ ok: true, scanned: 0, nudged: 0, skipped: 0, disabled: true });
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
