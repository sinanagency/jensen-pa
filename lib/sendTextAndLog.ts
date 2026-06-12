// JENSEN-DOCTRINE Law 2 (send-chokepoint) chokepoint. Every outbound bot-sent
// message routes through here: log to chat_messages BEFORE the Meta send so the
// brain's transcript and the wire never diverge. Mirrors the Sasa pattern.
// sendWhatsApp already enforces Law 5 (dash strip) + TRAINING gate + operator
// mirror; this wrapper adds the persistence half of the doctrine.
//
// 2026-06-12: Architecture 2 pre-send gate. Shared @sinanagency/bot-guards
// sanitizeReply runs with JENSEN_BOT_GUARDS_CONFIG before delivery. Catches
// cross-bot brand leaks (Sasa / Nisria / Stephen / Cape Town Halaal mentions
// — Jensen must NEVER reference those). On catch, body is replaced with
// reaskPhrase and the catch is logged for engineering review. The wall is
// in code; the rules are in lib/bot/guards-config.ts.

import { sendWhatsApp, devPhone } from "@/lib/whatsapp";
import { admin } from "@/lib/db";
import { sanitizeReply } from "@/lib/bot-guards/index.js";
import { JENSEN_BOT_GUARDS_CONFIG } from "@/lib/bot/guards-config";
import { mirrorToChatwoot } from "@/lib/chatwoot-mirror";

// Law 10 (test-mode) branch: opts.dev === true reroutes the message to the
// developer phone and SKIPS chat_messages + audit inserts. Test traffic never
// pollutes Jensen's transcript or lands on Jensen's WhatsApp. Guards still run
// so dev sees the same sanitised output the prod path would have produced.
export async function sendTextAndLog(
  to: string,
  body: string,
  opts?: { force?: boolean; party?: string; dev?: boolean }
): Promise<{ ok: boolean }> {
  // v0.2 (2026-06-12): the PRIMITIVE sendWhatsApp now enforces the wall for
  // every caller. This wrapper still runs sanitizeReply FIRST so that the
  // chat_messages transcript records exactly what ships (never diverging from
  // the wire on a catch) and so the audit row carries the party. The second
  // pass inside sendWhatsApp is a no-op on the already-clean body.
  const sanitized = sanitizeReply(body, JENSEN_BOT_GUARDS_CONFIG);
  const sendBody = sanitized.body;
  if (opts?.dev) {
    const target = devPhone();
    if (!target) return { ok: false };
    const ok = await sendWhatsApp(target, `[DEV] ${sendBody}`, { force: true });
    return { ok };
  }
  await admin().from("chat_messages").insert({
    role: "assistant",
    content: sendBody,
    channel: "whatsapp",
    party: opts?.party ?? "jensen",
    ts: Date.now(),
  });
  if (sanitized.caught.length) {
    try {
      await admin().from("chat_messages").insert({
        role: "system",
        content: `pre_send_caught: ${sanitized.caught.map((c) => `${c.kind}:${c.pattern}`).join(",")} | original=${String(sanitized.caught[0]?.original || "").slice(0, 400)}`,
        channel: "audit",
        party: opts?.party ?? "jensen",
        ts: Date.now(),
      });
    } catch {
      // best-effort log; never block delivery
    }
  }
  // Read-only Chatwoot mirror (Path B). Best-effort, never blocks delivery.
  // Fires AFTER chat_messages insert so the source of truth still holds even
  // if Chatwoot is down. Direction is "outgoing" because this is bot → Jensen.
  mirrorToChatwoot("outgoing", to, sendBody).catch(() => {});
  const ok = await sendWhatsApp(to, sendBody, opts);
  return { ok };
}
