// Inbox triage: classify each email into Jensen's Eisenhower four quadrants and
// flag the ones that actually need a reply. One cheap Haiku call per uncached
// batch; results cached in Supabase kv by message id so we don't re-spend on
// every open. The four-quadrant frame is the platform philosophy — tasks,
// payments, and mail all sort by urgent x important.

import { askClaude, HAIKU } from "./anthropic";
import { kvGet, kvSet } from "./db";
import type { UMailSummary } from "./mail-provider";

export type Quadrant = 1 | 2 | 3 | 4;
export type EmailEvent = { title: string; date: string; time?: string; note?: string };
export type Triage = {
  important: boolean;
  urgent: boolean;
  needsReply: boolean;
  quadrant: Quadrant;
  summary: string;
  draft: string;
  event?: EmailEvent | null;
};
export type TriagedMail = UMailSummary & Triage;

const CACHE_KEY = "mailtriage";
const MAX_CACHE = 400;

export function quadrantOf(important: boolean, urgent: boolean): Quadrant {
  if (important && urgent) return 1;
  if (important && !urgent) return 2;
  if (!important && urgent) return 3;
  return 4;
}

function blank(): Triage {
  return { important: false, urgent: false, needsReply: false, quadrant: 4, summary: "", draft: "" };
}

export async function triageInbox(list: UMailSummary[]): Promise<TriagedMail[]> {
  const cache = await kvGet<Record<string, Triage>>(CACHE_KEY, {});
  const need = list.filter((m) => !cache[m.id]);

  if (need.length) {
    const fresh = await classifyBatch(need);
    for (const m of need) if (fresh[m.id]) cache[m.id] = fresh[m.id];
    const keys = Object.keys(cache);
    if (keys.length > MAX_CACHE) for (const k of keys.slice(0, keys.length - MAX_CACHE)) delete cache[k];
    await kvSet(CACHE_KEY, cache).catch(() => {});
  }

  return list.map((m) => ({ ...m, ...(cache[m.id] || blank()) }));
}

// Classify in small chunks so the JSON response never truncates (30 emails in one
// call overflows the output budget -> unparseable -> everything wrongly defaults
// to Q4). Chunks run in parallel; a failed chunk simply leaves those uncached.
async function classifyBatch(items: UMailSummary[]): Promise<Record<string, Triage>> {
  const CHUNK = 8;
  const chunks: UMailSummary[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) chunks.push(items.slice(i, i + CHUNK));
  const out: Record<string, Triage> = {};
  const results = await Promise.all(chunks.map((c) => classifyChunk(c).catch(() => ({} as Record<string, Triage>))));
  for (const r of results) Object.assign(out, r);
  return out;
}

async function classifyChunk(items: UMailSummary[]): Promise<Record<string, Triage>> {
  const lines = items
    .map((m) => `id=${m.id} | from: ${m.from} | subject: ${m.subject} | preview: ${(m.snippet || "").replace(/\s+/g, " ").slice(0, 220)}`)
    .join("\n");

  const system = [
    `You triage the inbox of Jensen, founder of La Rencontre, a luxury F&B hospitality consultancy in Dubai. For each email decide, honestly and conservatively:`,
    `- important: true ONLY if it needs Jensen's personal attention or action for the business: real clients, partners, prospects, deals, money/invoices, contracts, venues, events, staff, suppliers, legal or government. Newsletters, marketing, promotions, receipts, automated notifications, social media, and spam are NOT important.`,
    `- urgent: true if it is time sensitive (a deadline, today or tomorrow, someone is blocked waiting on him, a payment is due).`,
    `- needsReply: true if a human is genuinely expecting a written reply from him.`,
    `- summary: max 12 words, plain, what it is and what is wanted.`,
    `- draft: only if needsReply, a 1 to 2 sentence reply he could send, warm, professional, first person. Never use dash characters; use commas or periods. Otherwise an empty string.`,
    `- event: ONLY if the email is or contains a specific scheduled meeting/event/booking with a concrete calendar date, return {"title":"short title","date":"YYYY-MM-DD","time":"HH:MM" 24h or null,"note":"who/where, short"}. The date MUST be an absolute YYYY-MM-DD (resolve "tomorrow"/"next Tuesday" only if you can be certain, else omit). If there is no concrete dated event, set event to null. Do NOT invent dates.`,
    `Return ONLY a JSON array, one object per email, no prose. Use the exact id string given:`,
    `[{"id":"...","important":true,"urgent":false,"needsReply":true,"summary":"...","draft":"...","event":null}]`,
  ].join("\n");

  const txt = await askClaude({
    system,
    messages: [{ role: "user", content: lines }],
    model: HAIKU,
    maxTokens: 2200,
    temperature: 0,
  });

  const arr = extractJsonArray(txt);
  const out: Record<string, Triage> = {};
  if (Array.isArray(arr)) {
    for (const o of arr) {
      if (!o || o.id == null) continue;
      const important = !!o.important;
      const urgent = !!o.urgent;
      let event: EmailEvent | null = null;
      const ev = o.event;
      if (ev && typeof ev === "object" && typeof ev.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(ev.date) && ev.title) {
        event = {
          title: String(ev.title).slice(0, 120),
          date: ev.date,
          time: typeof ev.time === "string" && /^\d{1,2}:\d{2}$/.test(ev.time) ? ev.time : undefined,
          note: ev.note ? String(ev.note).slice(0, 160) : undefined,
        };
      }
      out[String(o.id)] = {
        important,
        urgent,
        needsReply: !!o.needsReply,
        quadrant: quadrantOf(important, urgent),
        summary: String(o.summary || "").slice(0, 140),
        draft: String(o.draft || "").slice(0, 600),
        event,
      };
    }
  }
  return out;
}

function extractJsonArray(s: string): any {
  try { return JSON.parse(s); } catch {}
  const a = s.indexOf("[");
  const b = s.lastIndexOf("]");
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch {} }
  return null;
}
