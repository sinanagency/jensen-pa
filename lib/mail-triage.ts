// Inbox triage: classify each email into Jensen's Eisenhower four quadrants and
// flag the ones that actually need a reply. One cheap Haiku call per uncached
// batch; results cached in Supabase kv by uid so we don't re-spend on every open.
// The four-quadrant frame is the platform philosophy — tasks, payments, and mail
// all sort by urgent x important.

import { askClaude, HAIKU } from "./anthropic";
import { kvGet, kvSet } from "./db";
import type { MailSummary } from "./mail-ops";

export type Quadrant = 1 | 2 | 3 | 4;
export type Triage = {
  important: boolean;
  urgent: boolean;
  needsReply: boolean;
  quadrant: Quadrant;
  summary: string;
  draft: string;
};
export type TriagedMail = MailSummary & Triage;

const CACHE_KEY = "mailtriage";
const MAX_CACHE = 300;

export function quadrantOf(important: boolean, urgent: boolean): Quadrant {
  if (important && urgent) return 1;
  if (important && !urgent) return 2;
  if (!important && urgent) return 3;
  return 4;
}

function blank(): Triage {
  return { important: false, urgent: false, needsReply: false, quadrant: 4, summary: "", draft: "" };
}

export async function triageInbox(list: MailSummary[]): Promise<TriagedMail[]> {
  const cache = await kvGet<Record<string, Triage>>(CACHE_KEY, {});
  const need = list.filter((m) => !cache[String(m.uid)]);

  if (need.length) {
    const fresh = await classifyBatch(need);
    for (const m of need) {
      const c = fresh[String(m.uid)];
      if (c) cache[String(m.uid)] = c;
    }
    const keys = Object.keys(cache);
    if (keys.length > MAX_CACHE) for (const k of keys.slice(0, keys.length - MAX_CACHE)) delete cache[k];
    await kvSet(CACHE_KEY, cache).catch(() => {});
  }

  return list.map((m) => ({ ...m, ...(cache[String(m.uid)] || blank()) }));
}

async function classifyBatch(items: MailSummary[]): Promise<Record<string, Triage>> {
  const lines = items
    .map((m) => `uid=${m.uid} | from: ${m.from} | subject: ${m.subject} | preview: ${(m.snippet || "").replace(/\s+/g, " ").slice(0, 220)}`)
    .join("\n");

  const system = [
    `You triage the inbox of Jensen, founder of La Rencontre, a luxury F&B hospitality consultancy in Dubai. For each email decide, honestly and conservatively:`,
    `- important: true ONLY if it needs Jensen's personal attention or action for the business: real clients, partners, prospects, deals, money/invoices, contracts, venues, events, staff, suppliers, legal or government. Newsletters, marketing, promotions, receipts, automated notifications, social media, and spam are NOT important.`,
    `- urgent: true if it is time sensitive (a deadline, today or tomorrow, someone is blocked waiting on him, a payment is due).`,
    `- needsReply: true if a human is genuinely expecting a written reply from him.`,
    `- summary: max 12 words, plain, what it is and what is wanted.`,
    `- draft: only if needsReply, a 1 to 2 sentence reply he could send, warm, professional, first person. Never use dash characters; use commas or periods. Otherwise an empty string.`,
    `Return ONLY a JSON array, one object per email, no prose:`,
    `[{"uid":123,"important":true,"urgent":false,"needsReply":true,"summary":"...","draft":"..."}]`,
  ].join("\n");

  const txt = await askClaude({
    system,
    messages: [{ role: "user", content: lines }],
    model: HAIKU,
    maxTokens: 1800,
    temperature: 0,
  });

  const arr = extractJsonArray(txt);
  const out: Record<string, Triage> = {};
  if (Array.isArray(arr)) {
    for (const o of arr) {
      if (!o || o.uid == null) continue;
      const important = !!o.important;
      const urgent = !!o.urgent;
      out[String(o.uid)] = {
        important,
        urgent,
        needsReply: !!o.needsReply,
        quadrant: quadrantOf(important, urgent),
        summary: String(o.summary || "").slice(0, 140),
        draft: String(o.draft || "").slice(0, 600),
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
