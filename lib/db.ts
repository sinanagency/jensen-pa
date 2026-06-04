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
export async function kvGet<T = any>(key: string, fallback: T): Promise<T> {
  const { data } = await admin().from("kv").select("value").eq("key", key).maybeSingle();
  return (data?.value as T) ?? fallback;
}
export async function kvSet(key: string, value: any): Promise<void> {
  await admin().from("kv").upsert({ key, value, updated_at: Date.now() });
}

// ---- chat log (one-brain: portal + whatsapp share this) ----
export async function appendChat(turn: ChatTurn & { channel?: string }): Promise<void> {
  await admin().from("chat_messages").insert({ role: turn.role, content: turn.content, channel: turn.channel ?? "portal", ts: turn.ts });
}
export async function getChat(limit = 100): Promise<ChatTurn[]> {
  const { data } = await admin().from("chat_messages").select("role,content,ts").order("ts", { ascending: true }).limit(limit);
  return (data ?? []).map((r: any) => ({ role: r.role, content: r.content, ts: Number(r.ts) }));
}

// ---- assemble the full small-state snapshot the portal expects ----
export async function assembleState(): Promise<DB> {
  const db = admin();
  const [entities, tasks, finance, events, notes, contacts, chat, prefs, goals, legalBlueprint, onboarded] = await Promise.all([
    db.from("entities").select("*").order("created_at", { ascending: true }),
    db.from("tasks").select("*").order("created_at", { ascending: true }),
    db.from("finance").select("*").order("created_at", { ascending: true }),
    db.from("events").select("*").order("created_at", { ascending: true }),
    db.from("notes").select("*").order("created_at", { ascending: true }),
    db.from("contacts").select("*").order("created_at", { ascending: true }),
    getChat(200),
    kvGet<Prefs>("prefs", {}),
    kvGet<string[]>("goals", []),
    kvGet<string | undefined>("legalBlueprint", undefined),
    kvGet<boolean>("onboarded", false),
  ]);
  return {
    entities: (entities.data ?? []).map(toEntity),
    tasks: (tasks.data ?? []).map(toTask),
    docs: [], // docs live in their own server resource (large, see lib/docs server ops)
    finance: (finance.data ?? []).map(toFinance),
    events: (events.data ?? []).map(toEvent),
    notes: (notes.data ?? []).map(toNote),
    contacts: (contacts.data ?? []).map(toContact),
    prefs, chat, goals, legalBlueprint, onboarded,
  };
}

// ---- replace the small-state snapshot (portal save). Upsert present, delete absent. ----
async function syncTable(table: string, rows: any[]) {
  const db = admin();
  if (rows.length) await db.from(table).upsert(rows);
  const ids = rows.map((r) => r.id);
  // delete rows no longer present in the snapshot
  if (ids.length) {
    await db.from(table).delete().not("id", "in", `(${ids.map((i) => `"${i}"`).join(",")})`);
  } else {
    await db.from(table).delete().neq("id", "__never__"); // table emptied → clear all
  }
}

// Portal chat is replace-all for now (single user, brain not yet writing
// concurrently). Switches to append-only when the WhatsApp brain lands.
async function syncChat(chat: ChatTurn[]) {
  const db = admin();
  await db.from("chat_messages").delete().neq("id", -1);
  if (chat.length) {
    await db.from("chat_messages").insert(
      chat.map((c) => ({ role: c.role, content: c.content, channel: "portal", ts: c.ts }))
    );
  }
}

export async function replaceState(next: DB): Promise<void> {
  await Promise.all([
    syncTable("entities", next.entities.map(fromEntity)),
    syncTable("tasks", next.tasks.map(fromTask)),
    syncTable("finance", next.finance.map(fromFinance)),
    syncTable("events", next.events.map(fromEvent)),
    syncTable("notes", next.notes.map(fromNote)),
    syncTable("contacts", next.contacts.map(fromContact)),
    syncChat(next.chat ?? []),
    kvSet("prefs", next.prefs ?? {}),
    kvSet("goals", next.goals ?? []),
    kvSet("legalBlueprint", next.legalBlueprint ?? null),
    kvSet("onboarded", !!next.onboarded),
  ]);
}
