// WhatsApp 24-hour customer-service window detection.
//
// Meta Cloud API rule: a business number can free-text a user ONLY within 24h
// of the user's last inbound message. Outside that window, free-text returns
// HTTP 200 with a message id but Meta silently drops delivery. Templates
// (pre-approved) are the only way through.
//
// This helper reads the most recent `user`-role row in chat_messages for a
// given party and returns whether the window is open. Used by mail-sweep
// (queue proposals off-window) and the daily brief (template-vs-text fork).

import { admin } from "@/lib/db";

const WINDOW_MS = 24 * 60 * 60 * 1000;

export async function isInWindow(party: string = "jensen"): Promise<{ open: boolean; hoursSince: number; lastInboundTs: number | null }> {
  try {
    const { data } = await admin()
      .from("chat_messages")
      .select("ts")
      .eq("party", party)
      .eq("role", "user")
      .eq("channel", "whatsapp")
      .order("ts", { ascending: false })
      .limit(1);
    const lastTs = data?.[0]?.ts ?? null;
    if (!lastTs) return { open: false, hoursSince: Infinity, lastInboundTs: null };
    const delta = Date.now() - Number(lastTs);
    return { open: delta < WINDOW_MS, hoursSince: delta / 3_600_000, lastInboundTs: Number(lastTs) };
  } catch {
    // Fail closed: if we can't tell, assume closed and route through the safer
    // path (template or skip). Better a missed ping than a silent fail.
    return { open: false, hoursSince: Infinity, lastInboundTs: null };
  }
}
