// Email -> calendar, on confirmation. The triage classifier DETECTS dated events;
// Jensen accepts one from the mail modal, which calls addEmailEvent. Idempotent by
// message id (a kv "added" set) so accepting twice never duplicates. Server-only.

import { kvGet, kvSet, addEvent } from "./db";

const ADDED = "email_events_added";

function uid(): string {
  try { return crypto.randomUUID(); } catch { return `ev_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`; }
}

export async function addEmailEvent(
  messageId: string,
  ev: { title: string; date: string; time?: string | null; note?: string | null }
): Promise<{ added: boolean; already: boolean }> {
  const list = await kvGet<string[]>(ADDED, []);
  if (list.includes(messageId)) return { added: false, already: true };

  await addEvent({
    id: uid(),
    title: ev.title,
    date: ev.date,
    time: ev.time ?? null,
    note: ev.note ?? null,
    createdAt: Date.now(),
  });
  await kvSet(ADDED, [...list, messageId].slice(-3000)).catch(() => {});
  return { added: true, already: false };
}
