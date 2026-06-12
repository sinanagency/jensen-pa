// Inbox triage: classify each email into Jensen's Eisenhower four quadrants and
// flag the ones that actually need a reply. One cheap Haiku call per uncached
// batch; results cached in Supabase kv by message id so we don't re-spend on
// every open. The four-quadrant frame is the platform philosophy — tasks,
// payments, and mail all sort by urgent x important.

import { askClaude, HAIKU } from "./anthropic";
import { kvGet, kvSet } from "./db";
import type { UMailSummary } from "./mail-provider";

export type Quadrant = 1 | 2 | 3 | 4;
export type EmailEvent = { title: string; date: string; time?: string; note?: string; meetingUrl?: string };
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

// Conservative default. When Haiku can't classify a message (parse failure, API
// error, model uncertainty), we DO NOT silently bucket it to Q4 (Drop). That
// would hide important mail forever. Default to Q2 (Schedule) so Jensen still
// sees it, and tag the row so he knows it's an auto-classify miss not a
// considered judgment.
function blank(): Triage {
  return {
    important: true,
    urgent: false,
    needsReply: false,
    quadrant: 2,
    summary: "Could not auto-classify, surfaced to Schedule for review.",
    draft: "",
  };
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

// Force re-classification of a single message id, bypassing the cache. Used by
// the "Re-classify" button in the mail UI when Jensen flags a misfile.
export async function retriageOne(msg: UMailSummary): Promise<Triage | null> {
  const fresh = await classifyChunk([msg]).catch(() => ({} as Record<string, Triage>));
  const t = fresh[msg.id];
  if (!t) return null;
  const cache = await kvGet<Record<string, Triage>>(CACHE_KEY, {});
  cache[msg.id] = t;
  await kvSet(CACHE_KEY, cache).catch(() => {});
  return t;
}

// Manual override. Jensen drags a message to a different quadrant; we persist
// the new classification and skip the LLM for that id from then on.
export async function reclassifyOne(id: string, quadrant: Quadrant): Promise<void> {
  const cache = await kvGet<Record<string, Triage>>(CACHE_KEY, {});
  const existing = cache[id] || blank();
  cache[id] = {
    ...existing,
    quadrant,
    important: quadrant === 1 || quadrant === 2,
    urgent: quadrant === 1 || quadrant === 3,
  };
  await kvSet(CACHE_KEY, cache).catch(() => {});
}

// Classify in small chunks so the JSON response never truncates (30 emails in one
// call overflows the output budget -> unparseable -> everything wrongly defaults
// to Q4). Chunks run in parallel; failed chunks are retried ONCE with a smaller
// chunk size, then anything still uncached falls back to the conservative Q2
// default at consumption time (blank()). Missing classifications never silently
// disappear into Q4.
async function classifyBatch(items: UMailSummary[]): Promise<Record<string, Triage>> {
  const CHUNK = 6; // 8 was occasionally truncating with long subjects; 6 keeps headroom
  const chunks: UMailSummary[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) chunks.push(items.slice(i, i + CHUNK));
  const out: Record<string, Triage> = {};
  const results = await Promise.all(chunks.map((c) => classifyChunk(c).catch(() => ({} as Record<string, Triage>))));
  for (const r of results) Object.assign(out, r);

  // Retry any items the first pass missed, one at a time. Single-item chunks
  // are essentially guaranteed to fit the output budget, so the only failures
  // here are real API errors which the blank() default will catch later.
  const missing = items.filter((m) => !out[m.id]);
  if (missing.length) {
    const retries = await Promise.all(
      missing.map((m) => classifyChunk([m]).catch(() => ({} as Record<string, Triage>)))
    );
    for (const r of retries) Object.assign(out, r);
  }
  return out;
}

async function classifyChunk(items: UMailSummary[]): Promise<Record<string, Triage>> {
  const lines = items
    .map((m) => `id=${m.id} | from: ${m.from} <${m.fromEmail}> | subject: ${m.subject} | preview: ${(m.snippet || "").replace(/\s+/g, " ").slice(0, 500)}`)
    .join("\n");

  // The prompt is intentionally explicit about uncertainty handling. The old
  // version let the model bias toward Q4 (Drop) when unsure, which buried real
  // business mail. New rule: when uncertain, default to Q2 (Schedule) so Jensen
  // still sees it. Drop is reserved for HIGH-confidence noise.
  const system = [
    `You triage the inbox of Jensen, founder of La Rencontre, a luxury F&B hospitality consultancy in Dubai (UAE).`,
    ``,
    `For each email, decide:`,
    `- important: TRUE for real clients (Sohum, Panther, Buddha Shop, Upaya), partners, prospects, deals, money/invoices, contracts, venues, events, staff, suppliers, government, legal, banking, business introductions, personal note from a real person.`,
    `  FALSE for newsletters, marketing, promotions, automated receipts/notifications, social media, recruitment spam, cold sales pitches.`,
    `- urgent: TRUE only if time sensitive within ~48h (a real deadline TODAY or TOMORROW, someone visibly blocked waiting, a payment due date imminent, a meeting time today). Otherwise FALSE.`,
    `- needsReply: TRUE if a real human is expecting a written reply from him. FALSE for automated mail.`,
    `- summary: max 14 words, plain, what it is and what is wanted (or "Newsletter from <vendor>" / "Auto-receipt <vendor>" for noise).`,
    `- draft: ONLY if needsReply=true. 1-2 sentences, warm, professional, FIRST PERSON as Jensen. Never use dash characters (no -, no —, no –); use commas or periods. If !needsReply, return "".`,
    `- event: ONLY for a SPECIFIC scheduled meeting/booking/event with a CONCRETE YYYY-MM-DD date. Otherwise null. Never invent dates. Never resolve "next week" or "Q3" into a date. Include meetingUrl if the preview shows a Zoom/Meet/Teams/Whereby link (full URL, http or https), else omit. Shape: {"title":"...", "date":"YYYY-MM-DD", "time":"HH:MM"|null, "note":"...", "meetingUrl":"https://..."|null}.`,
    ``,
    `Quadrant = (important ? 1 : 3) when urgent, else (important ? 2 : 4). Computed automatically from important + urgent — do NOT return quadrant directly.`,
    ``,
    `UNCERTAINTY RULE: if you are NOT confident whether something is important, default important=TRUE. It is far better to surface something Jensen doesn't need than to bury something he does. Drop (Q4) is only for high-confidence noise (verified newsletters, automated receipts from known vendors, marketing).`,
    ``,
    `EXAMPLES (orient yourself, do not echo back):`,
    `- "Newsletter: 5 hospitality trends" → important:false, urgent:false, Q4. summary: "Newsletter: hospitality trends".`,
    `- "Quote request for private dinner Aug 12, 14 guests" → important:true, urgent:false (unless date is imminent), Q2. needsReply:true. event: {date Aug 12}.`,
    `- "Stripe receipt $49 for Anthropic" → important:false, urgent:false, Q4. summary: "Auto receipt Anthropic".`,
    `- "Sohum: contract amendment needs your review by Friday" → important:true, urgent:true (deadline), Q1. needsReply:true.`,
    `- "LinkedIn: 3 new profile views" → important:false, urgent:false, Q4.`,
    `- "Bank statement May 2026 attached" → important:true, urgent:false, Q2.`,
    `- Unfamiliar sender, vague subject, hard to tell → important:TRUE, urgent:false, Q2 (default to surfacing).`,
    ``,
    `Return ONLY a JSON array (no prose, no markdown). One object per email. Use the exact id strings given:`,
    `[{"id":"...","important":true,"urgent":false,"needsReply":true,"summary":"...","draft":"...","event":null}]`,
  ].join("\n");

  const txt = await askClaude({
    system,
    messages: [{ role: "user", content: lines }],
    model: HAIKU,
    maxTokens: 3000,
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
        const url = typeof ev.meetingUrl === "string" && /^https?:\/\//i.test(ev.meetingUrl) ? ev.meetingUrl.slice(0, 500) : undefined;
        event = {
          title: String(ev.title).slice(0, 120),
          date: ev.date,
          time: typeof ev.time === "string" && /^\d{1,2}:\d{2}$/.test(ev.time) ? ev.time : undefined,
          note: ev.note ? String(ev.note).slice(0, 160) : undefined,
          meetingUrl: url,
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
