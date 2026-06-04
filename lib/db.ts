// Server-authoritative data layer. The ONE place state lives now (Supabase).
// Both the portal (via /api/state + /api/docs) and the WhatsApp brain (next
// phase) call THIS module, so there is a single source of truth — the one-brain
// law. Service-role key, server-only. Never import from a client component.

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type {
  DB, Entity, Task, FinanceRecord, CalEvent, Note, Contact, ChatTurn, Prefs,
} from "./store";

let _client: SupabaseClient | null = null;
export function admin(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY not set");
  _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}

export function isConfigured(): boolean {
  return !!(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SECRET_KEY));
}

// ---- row <-> app mappers (snake_case db <-> camelCase app) ----
const toEntity = (r: any): Entity => ({ id: r.id, kind: r.kind, name: r.name, subtitle: r.subtitle ?? undefined, status: r.status ?? undefined, notes: r.notes ?? undefined, createdAt: Number(r.created_at) });
const fromEntity = (e: Entity) => ({ id: e.id, kind: e.kind, name: e.name, subtitle: e.subtitle ?? null, status: e.status ?? null, notes: e.notes ?? null, created_at: e.createdAt });

const toTask = (r: any): Task => ({ id: r.id, title: r.title, entityId: r.entity_id ?? undefined, quadrant: r.quadrant, done: r.done, due: r.due ?? undefined, createdAt: Number(r.created_at) });
const fromTask = (t: Task) => ({ id: t.id, title: t.title, entity_id: t.entityId ?? null, quadrant: t.quadrant, done: !!t.done, due: t.due ?? null, created_at: t.createdAt });

const toFinance = (r: any): FinanceRecord => ({ id: r.id, entityId: r.entity_id ?? undefined, kind: r.kind, amount: Number(r.amount), vatApplies: r.vat_applies, label: r.label, date: r.date, createdAt: Number(r.created_at) });
const fromFinance = (f: FinanceRecord) => ({ id: f.id, entity_id: f.entityId ?? null, kind: f.kind, amount: f.amount, vat_applies: !!f.vatApplies, label: f.label, date: f.date, created_at: f.createdAt });

const toEvent = (r: any): CalEvent => ({ id: r.id, title: r.title, entityId: r.entity_id ?? undefined, date: r.date, time: r.time ?? undefined, note: r.note ?? undefined, createdAt: Number(r.created_at) });
const fromEvent = (e: CalEvent) => ({ id: e.id, title: e.title, entity_id: e.entityId ?? null, date: e.date, time: e.time ?? null, note: e.note ?? null, created_at: e.createdAt });

const toNote = (r: any): Note => ({ id: r.id, kind: r.kind, title: r.title ?? undefined, body: r.body, url: r.url ?? undefined, entityId: r.entity_id ?? undefined, pinned: r.pinned ?? undefined, createdAt: Number(r.created_at) });
const fromNote = (n: Note) => ({ id: n.id, kind: n.kind, title: n.title ?? null, body: n.body, url: n.url ?? null, entity_id: n.entityId ?? null, pinned: !!n.pinned, created_at: n.createdAt });

const toContact = (r: any): Contact => ({ id: r.id, name: r.name, company: r.company ?? undefined, role: r.role ?? undefined, email: r.email ?? undefined, phone: r.phone ?? undefined, notes: r.notes ?? undefined, entityId: r.entity_id ?? undefined, createdAt: Number(r.created_at) });
const fromContact = (c: Contact) => ({ id: c.id, name: c.name, company: c.company ?? null, role: c.role ?? null, email: c.email ?? null, phone: c.phone ?? null, notes: c.notes ?? null, entity_id: c.entityId ?? null, created_at: c.createdAt });

// ---- key-value singletons ----
// These go through raw PostgREST (fetch), NOT supabase-js. The supabase-js client
// was observed returning EMPTY results for an existing row in some serverless
// bundles (the realtime client init misbehaves when bundled alongside imapflow/
// nodemailer), while a raw REST read of the identical row returns correctly. kv
// backs auth accounts, mailboxes and prefs, so it must be deterministic.
function sbHeaders(): Record<string, string> {
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SECRET_KEY || "";
  return { apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json" };
}
function sbRest(path: string): string {
  return `${process.env.SUPABASE_URL}/rest/v1/${path}`;
}

export async function kvGet<T = any>(key: string, fallback: T): Promise<T> {
  const r = await fetch(sbRest(`kv?key=eq.${encodeURIComponent(key)}&select=value`), { headers: sbHeaders(), cache: "no-store" });
  if (!r.ok) throw new Error(`kv get ${key}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  const rows = await r.json();
  return (rows?.[0]?.value as T) ?? fallback;
}
export async function kvSet(key: string, value: any): Promise<void> {
  // null/undefined = unset → remove the key (kv.value is NOT NULL; absence reads back as the fallback)
  if (value === null || value === undefined) {
    const r = await fetch(sbRest(`kv?key=eq.${encodeURIComponent(key)}`), { method: "DELETE", headers: sbHeaders() });
    if (!r.ok) throw new Error(`kv unset ${key}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    return;
  }
  const r = await fetch(sbRest(`kv?on_conflict=key`), {
    method: "POST",
    headers: { ...sbHeaders(), Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ key, value, updated_at: Date.now() }]),
  });
  if (!r.ok) throw new Error(`kv set ${key}: ${r.status} ${(await r.text()).slice(0, 200)}`);
}

// Never mask a DB error: surface the real Postgres message instead of returning
// empty/no-op (which previously made a failed write look like a 200 success).
function chk<T>(res: { data: T; error: any }, where: string): T {
  if (res.error) throw new Error(`${where}: ${res.error.message || res.error}`);
  return res.data;
}

// Server-side calendar event insert (raw PostgREST, consistent with kv). Used by
// the email -> calendar auto-sync so detected meetings land on /calendar.
export async function addEvent(e: {
  id: string; title: string; date: string; time?: string | null; note?: string | null; entityId?: string | null; createdAt: number;
}): Promise<void> {
  const r = await fetch(sbRest("events"), {
    method: "POST",
    headers: { ...sbHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify([{ id: e.id, title: e.title, entity_id: e.entityId ?? null, date: e.date, time: e.time ?? null, note: e.note ?? null, created_at: e.createdAt }]),
  });
  if (!r.ok) throw new Error(`event insert: ${r.status} ${(await r.text()).slice(0, 200)}`);
}

// ---- chat log (one-brain: portal + whatsapp share this) ----
export async function appendChat(turn: ChatTurn & { channel?: string }): Promise<void> {
  const res = await admin().from("chat_messages").insert({ role: turn.role, content: turn.content, channel: turn.channel ?? "portal", ts: turn.ts });
  if (res.error) throw new Error(`chat insert: ${res.error.message}`);
}
export async function getChat(limit = 100): Promise<ChatTurn[]> {
  const data = chk(await admin().from("chat_messages").select("role,content,ts").order("ts", { ascending: true }).limit(limit), "chat select");
  return (data ?? []).map((r: any) => ({ role: r.role, content: r.content, ts: Number(r.ts) }));
}

// ---- assemble the full small-state snapshot the portal expects ----
export async function assembleState(): Promise<DB> {
  const db = admin();
  const sel = (t: string) => db.from(t).select("*").order("created_at", { ascending: true });
  const [entities, tasks, finance, events, notes, contacts, chat, prefs, goals, legalBlueprint, onboarded] = await Promise.all([
    sel("entities"), sel("tasks"), sel("finance"), sel("events"), sel("notes"), sel("contacts"),
    getChat(200),
    kvGet<Prefs>("prefs", {}),
    kvGet<string[]>("goals", []),
    kvGet<string | undefined>("legalBlueprint", undefined),
    kvGet<boolean>("onboarded", false),
  ]);
  return {
    entities: (chk(entities, "entities") ?? []).map(toEntity),
    tasks: (chk(tasks, "tasks") ?? []).map(toTask),
    docs: [], // docs live in their own server resource (large, see lib/docs server ops)
    finance: (chk(finance, "finance") ?? []).map(toFinance),
    events: (chk(events, "events") ?? []).map(toEvent),
    notes: (chk(notes, "notes") ?? []).map(toNote),
    contacts: (chk(contacts, "contacts") ?? []).map(toContact),
    prefs, chat, goals, legalBlueprint, onboarded,
  };
}

// ---- replace the small-state snapshot (portal save). Upsert present, delete absent. ----
async function syncTable(table: string, rows: any[]) {
  const db = admin();
  if (rows.length) {
    const up = await db.from(table).upsert(rows);
    if (up.error) throw new Error(`${table} upsert: ${up.error.message}`);
  }
  const ids = rows.map((r) => r.id);
  // delete rows no longer present in the snapshot
  const del = ids.length
    ? await db.from(table).delete().not("id", "in", `(${ids.map((i) => `"${i}"`).join(",")})`)
    : await db.from(table).delete().neq("id", "__never__"); // table emptied → clear all
  if (del.error) throw new Error(`${table} delete: ${del.error.message}`);
}

// NOTE: chat is append-only (one-brain). It lives in chat_messages, written by
// appendChat from runConcierge for BOTH portal and WhatsApp. The snapshot save
// must NOT replace-all chat, or it would wipe the other channel's messages.

export async function replaceState(next: DB): Promise<void> {
  await Promise.all([
    syncTable("entities", next.entities.map(fromEntity)),
    syncTable("tasks", next.tasks.map(fromTask)),
    syncTable("finance", next.finance.map(fromFinance)),
    syncTable("events", next.events.map(fromEvent)),
    syncTable("notes", next.notes.map(fromNote)),
    syncTable("contacts", next.contacts.map(fromContact)),
    kvSet("prefs", next.prefs ?? {}),
    kvSet("goals", next.goals ?? []),
    kvSet("legalBlueprint", next.legalBlueprint ?? null),
    kvSet("onboarded", !!next.onboarded),
  ]);
}
