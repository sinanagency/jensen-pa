// Email -> calendar auto-sync. When the triage classifier detects a concretely
// dated meeting/event in an email, drop it onto /calendar automatically. Idempotent
// by message id (a kv "done" set) so re-opening the inbox never duplicates events.
// Server-only.

import { kvGet, kvSet, addEvent } from "./db";
import type { TriagedMail } from "./mail-triage";

const DONE = "email_events_done";

function uid(): string {
  try { return crypto.randomUUID(); } catch { return `ev_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`; }
}

export async function syncEmailEvents(messages: TriagedMail[]): Promise<number> {
  const withEvents = messages.filter((m) => m.event && m.event.date && m.event.title);
  if (!withEvents.length) return 0;

  const done = new Set(await kvGet<string[]>(DONE, []));
  const fresh = withEvents.filter((m) => !done.has(m.id));
  if (!fresh.length) return 0;

  let created = 0;
  for (const m of fresh) {
    const ev = m.event!;
    try {
      await addEvent({
        id: uid(),
        title: ev.title,
        date: ev.date,
        time: ev.time ?? null,
        note: `${ev.note ? ev.note + " · " : ""}from email — ${m.from}`,
        createdAt: Date.now(),
      });
      done.add(m.id);
      created++;
    } catch {
      // leave it out of `done` so a later load retries
    }
  }
  // cap the done-set so it cannot grow unbounded
  await kvSet(DONE, Array.from(done).slice(-2000)).catch(() => {});
  return created;
}
