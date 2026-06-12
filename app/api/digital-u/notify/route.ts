// Internal Digital U → Jensen notify channel. The meeting-bot, mail-sweep
// auto-latch, and operator scripts use this to push a heads-up to Jensen via
// the send-chokepoint (Law 2). x-api-key matches INGEST_KEY so the same secret
// covers both the ingest callback and these out-of-band notifications.

import { NextRequest, NextResponse } from "next/server";
import { sendTextAndLog } from "@/lib/sendTextAndLog";

export const runtime = "nodejs";

const TAONA = "971501168462";

function jensenNumber(): string | null {
  const raw = process.env.OWNER_WHATSAPP || "";
  const digits = raw.split(",").map((n) => n.replace(/[^0-9]/g, "")).filter(Boolean);
  const jensen = digits.find((d) => d !== TAONA);
  return jensen || "971528902032";
}

export async function POST(req: NextRequest) {
  if (process.env.INGEST_KEY && req.headers.get("x-api-key") !== process.env.INGEST_KEY) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const message = String(body?.message || "").trim();
  if (!message) return NextResponse.json({ ok: false, error: "message required" }, { status: 400 });
  const to = jensenNumber();
  if (!to) return NextResponse.json({ ok: false, error: "no recipient" }, { status: 500 });
  const r = await sendTextAndLog(to, message, { party: "jensen" });
  return NextResponse.json({ ok: !!r.ok });
}
