// One-shot fire of the training-complete bubble(s) to Jensen.
// Idempotent (kv flag `completion_bubbles_sent_at`). Requires ADMIN_SECRET
// header. Each bubble routes through sendTextAndLog (Law 2 chokepoint).
//
// Taona triggers via:
//   curl -X POST https://jensen-pa.vercel.app/api/cron/send-completion-bubbles \
//        -H "x-admin-secret: $ADMIN_SECRET"
//
// Pass ?dry=1 to validate config without sending.
// Pass ?force=1 to override the idempotency flag (debugging only).

import { NextRequest, NextResponse } from "next/server";
import { sendTextAndLog } from "@/lib/sendTextAndLog";
import { kvGet, kvSet } from "@/lib/db";
import {
  COMPLETION_BUBBLES,
  COMPLETION_PAUSE_MS_BETWEEN_BUBBLES,
} from "@/specs/001-export-mining/messages";

export const runtime = "nodejs";
export const maxDuration = 60;

const FLAG_KEY = "completion_bubbles_sent_at";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-admin-secret") || "";
  if (!process.env.ADMIN_SECRET || secret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";
  const force = url.searchParams.get("force") === "1";
  const devmode = url.searchParams.get("devmode") === "1";

  // OWNER_WHATSAPP is "+jensen,+taona" for the inbound owner gate. Meta's
  // outbound API needs a SINGLE E.164. Take the first entry (Jensen by
  // convention, see whoIs() defaults), then strip "+".
  const rawOwners = process.env.OWNER_WHATSAPP || "";
  const to = rawOwners.split(",")[0]?.trim().replace(/^\+/, "") || "";
  if (!to) {
    return NextResponse.json({ ok: false, error: "OWNER_WHATSAPP not set" }, { status: 500 });
  }

  if (!force) {
    const already = await kvGet<number | null>(FLAG_KEY, null);
    if (already) {
      return NextResponse.json({
        ok: false,
        error: "already sent",
        sent_at: new Date(already).toISOString(),
        hint: "pass ?force=1 to re-fire (debugging only)",
      }, { status: 409 });
    }
  }

  if (dry) {
    return NextResponse.json({
      ok: true,
      dry: true,
      to,
      devmode,
      bubble_count: COMPLETION_BUBBLES.length,
      pause_ms: COMPLETION_PAUSE_MS_BETWEEN_BUBBLES,
      previews: COMPLETION_BUBBLES.map((b) => b.split("\n")[0].slice(0, 80)),
    });
  }

  const startedAt = Date.now();
  const results: { idx: number; ok: boolean }[] = [];
  for (let i = 0; i < COMPLETION_BUBBLES.length; i++) {
    const body = COMPLETION_BUBBLES[i];
    // Law 10: devmode reroutes to devPhone() + skips chat_messages so Taona can
    // preview the exact rendered bubble before firing the real one to Jensen.
    const r = await sendTextAndLog(to, body, { force: true, party: "jensen", dev: devmode });
    results.push({ idx: i, ok: r.ok });
    if (i < COMPLETION_BUBBLES.length - 1) {
      await sleep(COMPLETION_PAUSE_MS_BETWEEN_BUBBLES);
    }
  }

  const allOk = results.every((r) => r.ok);
  // Only flip the idempotency flag on REAL sends. Devmode previews should be
  // re-runnable without touching prod state.
  if (allOk && !devmode) {
    await kvSet(FLAG_KEY, startedAt);
  }

  return NextResponse.json({
    ok: allOk,
    to,
    devmode,
    results,
    elapsed_ms: Date.now() - startedAt,
    flag_set: allOk && !devmode,
  });
}

// GET returns the current state so Taona can check whether bubbles fired.
export async function GET() {
  const already = await kvGet<number | null>(FLAG_KEY, null);
  return NextResponse.json({
    ok: true,
    already_sent: Boolean(already),
    sent_at: already ? new Date(already).toISOString() : null,
    bubble_count: COMPLETION_BUBBLES.length,
  });
}
