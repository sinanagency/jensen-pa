// JENSEN-DOCTRINE Law 2 (send-chokepoint) chokepoint. Every outbound bot-sent
// message routes through here: log to chat_messages BEFORE the Meta send so the
// brain's transcript and the wire never diverge. Mirrors the Sasa pattern.
// sendWhatsApp already enforces Law 5 (dash strip) + TRAINING gate + operator
// mirror; this wrapper adds the persistence half of the doctrine.

import { sendWhatsApp } from "@/lib/whatsapp";
import { admin } from "@/lib/db";

export async function sendTextAndLog(
  to: string,
  body: string,
  opts?: { force?: boolean; party?: string }
): Promise<{ ok: boolean }> {
  await admin().from("chat_messages").insert({
    role: "assistant",
    content: body,
    channel: "whatsapp",
    party: opts?.party ?? "jensen",
    ts: Date.now(),
  });
  const ok = await sendWhatsApp(to, body, opts);
  return { ok };
}
