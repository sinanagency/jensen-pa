// Granular server-side data operations the concierge tools dispatch into.
// Direct Supabase writes (admin/service-role) so a single tool call mutates one
// row, not the whole snapshot, and the portal + WhatsApp see it immediately.
// Server-only.

import { admin } from "../db";
import { dubaiToday } from "../time";

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
const now = () => Date.now();

// ---------- ENTITIES (venue | client | event) ----------
export async function listEntities(f: { kind?: string; status?: string } = {}) {
  let q = admin().from("entities").select("*").order("created_at", { ascending: true });
  if (f.kind) q = q.eq("kind", f.kind);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  let rows = data ?? [];
  if (f.status) rows = rows.filter((r: any) => (r.status || "").toLowerCase().includes(f.status!.toLowerCase()));
  return rows;
}
export async function createEntity(i: { kind: string; name: string; subtitle?: string; status?: string; notes?: string }) {
  const row = { id: uid(), kind: i.kind, name: i.name, subtitle: i.subtitle ?? null, status: i.status ?? null, notes: i.notes ?? null, created_at: now() };
  const { error } = await admin().from("entities").insert(row);
  if (error) throw new Error(error.message);
  return { id: row.id, ...i };
}
export async function updateEntity(i: { id: string; name?: string; subtitle?: string; status?: string; notes?: string }) {
  const patch: any = {};
  for (const k of ["name", "subtitle", "status", "notes"] as const) if (i[k] !== undefined) patch[k] = i[k];
  const { error } = await admin().from("entities").update(patch).eq("id", i.id);
  if (error) throw new Error(error.message);
  return { id: i.id, updated: Object.keys(patch) };
}
export async function deleteEntity(id: string) {
  const { error } = await admin().from("entities").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { deleted: id };
}
export async function findEntity(name: string) {
  const { data } = await admin().from("entities").select("*").ilike("name", `%${name}%`).limit(5);
  return data ?? [];
}

// ---------- TASKS (Covey 4-quadrant) ----------
export async function listTasks(f: { quadrant?: number; entityId?: string; done?: boolean } = {}) {
  let q = admin().from("tasks").select("*").order("created_at", { ascending: false });
  if (f.quadrant) q = q.eq("quadrant", f.quadrant);
  if (f.entityId) q = q.eq("entity_id", f.entityId);
  if (f.done !== undefined) q = q.eq("done", f.done);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}
export async function createTask(i: { title: string; quadrant?: number; entityId?: string; due?: string }) {
  const q = [1, 2, 3, 4].includes(i.quadrant as any) ? i.quadrant : 2;
  const row = { id: uid(), title: i.title, quadrant: q, entity_id: i.entityId ?? null, done: false, due: i.due ?? null, created_at: now() };
  const { error } = await admin().from("tasks").insert(row);
  if (error) throw new Error(error.message);
  return { id: row.id, title: i.title, quadrant: q };
}
export async function updateTask(i: { id: string; title?: string; quadrant?: number; due?: string; done?: boolean }) {
  const patch: any = {};
  if (i.title !== undefined) patch.title = i.title;
  if (i.quadrant !== undefined) patch.quadrant = i.quadrant;
  if (i.due !== undefined) patch.due = i.due;
  if (i.done !== undefined) patch.done = i.done;
  const { error } = await admin().from("tasks").update(patch).eq("id", i.id);
  if (error) throw new Error(error.message);
  return { id: i.id, updated: Object.keys(patch) };
}
export async function deleteTask(id: string) {
  const { error } = await admin().from("tasks").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { deleted: id };
}

// ---------- FINANCE (UAE) ----------
export async function listFinance(f: { entityId?: string; kind?: string } = {}) {
  let q = admin().from("finance").select("*").order("date", { ascending: false });
  if (f.entityId) q = q.eq("entity_id", f.entityId);
  if (f.kind) q = q.eq("kind", f.kind);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}
export async function recordFinance(i: { kind: "income" | "expense"; amount: number; vatApplies?: boolean; label: string; date?: string; entityId?: string }) {
  const row = { id: uid(), kind: i.kind === "income" ? "income" : "expense", amount: Number(i.amount) || 0, vat_applies: !!i.vatApplies, label: i.label, date: i.date || dubaiToday(), entity_id: i.entityId ?? null, created_at: now() };
  const { error } = await admin().from("finance").insert(row);
  if (error) throw new Error(error.message);
  return { id: row.id, kind: row.kind, amount: row.amount, label: row.label, date: row.date };
}
export async function updateFinance(i: { id: string; amount?: number; label?: string; vatApplies?: boolean; date?: string }) {
  const patch: any = {};
  if (i.amount !== undefined) patch.amount = i.amount;
  if (i.label !== undefined) patch.label = i.label;
  if (i.vatApplies !== undefined) patch.vat_applies = i.vatApplies;
  if (i.date !== undefined) patch.date = i.date;
  const { error } = await admin().from("finance").update(patch).eq("id", i.id);
  if (error) throw new Error(error.message);
  return { id: i.id, updated: Object.keys(patch) };
}
export async function deleteFinance(id: string) {
  const { error } = await admin().from("finance").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { deleted: id };
}

// ---------- EVENTS / CALENDAR ----------
export async function queryCalendar(f: { from?: string; to?: string; entityId?: string } = {}) {
  let q = admin().from("events").select("*").order("date", { ascending: true });
  if (f.from) q = q.gte("date", f.from);
  if (f.to) q = q.lte("date", f.to);
  if (f.entityId) q = q.eq("entity_id", f.entityId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}
export async function createEvent(i: { title: string; date: string; time?: string; entityId?: string; note?: string }) {
  const row = { id: uid(), title: i.title, date: i.date, time: i.time ?? null, entity_id: i.entityId ?? null, note: i.note ?? null, created_at: now() };
  const { error } = await admin().from("events").insert(row);
  if (error) throw new Error(error.message);
  return { id: row.id, title: i.title, date: i.date, time: i.time };
}
export async function updateEvent(i: { id: string; title?: string; date?: string; time?: string; note?: string }) {
  const patch: any = {};
  for (const k of ["title", "date", "time", "note"] as const) if (i[k] !== undefined) patch[k] = i[k];
  const { error } = await admin().from("events").update(patch).eq("id", i.id);
  if (error) throw new Error(error.message);
  return { id: i.id, updated: Object.keys(patch) };
}
export async function deleteEvent(id: string) {
  const { error } = await admin().from("events").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { deleted: id };
}

// ---------- NOTES ----------
export async function listNotes(f: { kind?: string } = {}) {
  let q = admin().from("notes").select("*").order("created_at", { ascending: false });
  if (f.kind) q = q.eq("kind", f.kind);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}
export async function addNote(i: { kind?: string; title?: string; body: string; url?: string; entityId?: string }) {
  const row = { id: uid(), kind: i.kind || "note", title: i.title ?? null, body: i.body, url: i.url ?? null, entity_id: i.entityId ?? null, pinned: false, created_at: now() };
  const { error } = await admin().from("notes").insert(row);
  if (error) throw new Error(error.message);
  return { id: row.id, kind: row.kind };
}
export async function deleteNote(id: string) {
  const { error } = await admin().from("notes").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { deleted: id };
}

// ---------- CONTACTS ----------
export async function listContacts() {
  const { data, error } = await admin().from("contacts").select("*").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}
export async function findContact(q: string) {
  const { data } = await admin().from("contacts").select("*").or(`name.ilike.%${q}%,company.ilike.%${q}%`).limit(8);
  return data ?? [];
}
export async function addContact(i: { name: string; company?: string; role?: string; email?: string; phone?: string; entityId?: string }) {
  const row = { id: uid(), name: i.name, company: i.company ?? null, role: i.role ?? null, email: i.email ?? null, phone: i.phone ?? null, entity_id: i.entityId ?? null, created_at: now() };
  const { error } = await admin().from("contacts").insert(row);
  if (error) throw new Error(error.message);
  return { id: row.id, name: i.name };
}
export async function updateContact(i: { id: string; name?: string; company?: string; role?: string; email?: string; phone?: string }) {
  const patch: any = {};
  for (const k of ["name", "company", "role", "email", "phone"] as const) if (i[k] !== undefined) patch[k] = i[k];
  const { error } = await admin().from("contacts").update(patch).eq("id", i.id);
  if (error) throw new Error(error.message);
  return { id: i.id, updated: Object.keys(patch) };
}
export async function deleteContact(id: string) {
  const { error } = await admin().from("contacts").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { deleted: id };
}

// ---------- DOCUMENTS: file (folder/entity/sensitivity) ----------
const RESTRICTED_FOLDERS = ["finance", "legal", "identity", "contracts"];
export async function fileDocument(i: { id: string; folder: string; entityId?: string; sensitivity?: string }) {
  const patch: any = { folder: i.folder };
  if (i.entityId !== undefined) patch.entity_id = i.entityId;
  patch.sensitivity = i.sensitivity || (RESTRICTED_FOLDERS.includes(i.folder) ? "restricted" : "normal");
  const { error } = await admin().from("docs").update(patch).eq("id", i.id);
  if (error) throw new Error(error.message);
  return { id: i.id, folder: i.folder, sensitivity: patch.sensitivity };
}
export async function listDocs(f: { folder?: string; entityId?: string } = {}) {
  let q = admin().from("docs").select("id,title,folder,kind,sensitivity,entity_id,created_at").order("created_at", { ascending: false });
  if (f.folder) q = q.eq("folder", f.folder);
  if (f.entityId) q = q.eq("entity_id", f.entityId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

// ---------- KV singletons ----------
export async function getPrefs() { const { data } = await admin().from("kv").select("value").eq("key", "prefs").maybeSingle(); return data?.value ?? {}; }
export async function setPrefs(p: any) { await admin().from("kv").upsert({ key: "prefs", value: p, updated_at: now() }); return { ok: true }; }
export async function getGoals() { const { data } = await admin().from("kv").select("value").eq("key", "goals").maybeSingle(); return (data?.value as string[]) ?? []; }
export async function setGoals(g: string[]) { await admin().from("kv").upsert({ key: "goals", value: g, updated_at: now() }); return { ok: true, goals: g }; }
export async function getBlueprint() { const { data } = await admin().from("kv").select("value").eq("key", "legalBlueprint").maybeSingle(); return (data?.value as string) ?? ""; }
export async function setBlueprint(t: string) { await admin().from("kv").upsert({ key: "legalBlueprint", value: t, updated_at: now() }); return { ok: true }; }
