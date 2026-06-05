// Granular data operations for the concierge tools. Raw PostgREST (see rest.ts)
// so it works on Node 20 and Vercel alike. One row per call. Server-only.

import { sbSelect, sbInsert, sbUpsert, sbUpdate, sbDelete, enc } from "./rest";
import { dubaiToday } from "../time";

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
const now = () => Date.now();
const like = (v: string) => `ilike.*${enc(v)}*`;

// ---------- ENTITIES ----------
export async function listEntities(f: { kind?: string; status?: string } = {}) {
  let qs = "order=created_at.asc";
  if (f.kind) qs += `&kind=eq.${enc(f.kind)}`;
  if (f.status) qs += `&status=${like(f.status)}`;
  return sbSelect("entities", qs);
}
export async function findEntity(name: string) { return sbSelect("entities", `name=${like(name)}&limit=5`); }
export async function createEntity(i: { kind: string; name: string; subtitle?: string; status?: string; notes?: string }) {
  const row = { id: uid(), kind: i.kind, name: i.name, subtitle: i.subtitle ?? null, status: i.status ?? null, notes: i.notes ?? null, created_at: now() };
  await sbInsert("entities", row);
  return { id: row.id, kind: i.kind, name: i.name };
}
export async function updateEntity(i: any) {
  const patch: any = {};
  for (const k of ["name", "subtitle", "status", "notes"]) if (i[k] !== undefined) patch[k] = i[k];
  await sbUpdate("entities", `id=eq.${enc(i.id)}`, patch);
  return { id: i.id, updated: Object.keys(patch) };
}
export async function deleteEntity(id: string) { await sbDelete("entities", `id=eq.${enc(id)}`); return { deleted: id }; }

// ---------- TASKS ----------
export async function listTasks(f: { quadrant?: number; entityId?: string; done?: boolean } = {}) {
  let qs = "order=created_at.desc";
  if (f.quadrant) qs += `&quadrant=eq.${f.quadrant}`;
  if (f.entityId) qs += `&entity_id=eq.${enc(f.entityId)}`;
  if (f.done !== undefined) qs += `&done=is.${f.done}`;
  return sbSelect("tasks", qs);
}
export async function createTask(i: { title: string; quadrant?: number; entityId?: string; due?: string }) {
  const q = [1, 2, 3, 4].includes(i.quadrant as any) ? i.quadrant : 2;
  // Soft-dedup: never create a duplicate of an existing open task (Memorae's worst bug).
  const dup = await sbSelect<any>("tasks", `title=eq.${enc(i.title)}&done=is.false&select=id,quadrant&limit=1`).catch(() => []);
  if (dup.length) return { id: dup[0].id, title: i.title, quadrant: dup[0].quadrant, deduped: true };
  const row = { id: uid(), title: i.title, quadrant: q, entity_id: i.entityId ?? null, done: false, due: i.due ?? null, created_at: now() };
  await sbInsert("tasks", row);
  return { id: row.id, title: i.title, quadrant: q };
}
export async function updateTask(i: any) {
  const patch: any = {};
  for (const k of ["title", "quadrant", "due", "done"]) if (i[k] !== undefined) patch[k] = i[k];
  await sbUpdate("tasks", `id=eq.${enc(i.id)}`, patch);
  return { id: i.id, updated: Object.keys(patch) };
}
export async function deleteTask(id: string) { await sbDelete("tasks", `id=eq.${enc(id)}`); return { deleted: id }; }

// ---------- FINANCE ----------
export async function listFinance(f: { entityId?: string; kind?: string } = {}) {
  let qs = "order=date.desc";
  if (f.entityId) qs += `&entity_id=eq.${enc(f.entityId)}`;
  if (f.kind) qs += `&kind=eq.${enc(f.kind)}`;
  return sbSelect("finance", qs);
}
export async function recordFinance(i: { kind: "income" | "expense"; amount: number; vatApplies?: boolean; label: string; date?: string; entityId?: string }) {
  const row = { id: uid(), kind: i.kind === "income" ? "income" : "expense", amount: Number(i.amount) || 0, vat_applies: !!i.vatApplies, label: i.label, date: i.date || dubaiToday(), entity_id: i.entityId ?? null, created_at: now() };
  await sbInsert("finance", row);
  return { id: row.id, kind: row.kind, amount: row.amount, label: row.label, date: row.date };
}
export async function updateFinance(i: any) {
  const patch: any = {};
  if (i.amount !== undefined) patch.amount = i.amount;
  if (i.label !== undefined) patch.label = i.label;
  if (i.vatApplies !== undefined) patch.vat_applies = i.vatApplies;
  if (i.date !== undefined) patch.date = i.date;
  await sbUpdate("finance", `id=eq.${enc(i.id)}`, patch);
  return { id: i.id, updated: Object.keys(patch) };
}
export async function deleteFinance(id: string) { await sbDelete("finance", `id=eq.${enc(id)}`); return { deleted: id }; }

// ---------- EVENTS ----------
export async function queryCalendar(f: { from?: string; to?: string; entityId?: string } = {}) {
  let qs = "order=date.asc";
  if (f.from) qs += `&date=gte.${enc(f.from)}`;
  if (f.to) qs += `&date=lte.${enc(f.to)}`;
  if (f.entityId) qs += `&entity_id=eq.${enc(f.entityId)}`;
  return sbSelect("events", qs);
}
export async function createEvent(i: { title: string; date: string; time?: string; entityId?: string; note?: string }) {
  // Soft-dedup: same title on the same date is the same event, not a copy.
  const dup = await sbSelect<any>("events", `title=eq.${enc(i.title)}&date=eq.${enc(i.date)}&select=id&limit=1`).catch(() => []);
  if (dup.length) return { id: dup[0].id, title: i.title, date: i.date, deduped: true };
  const row = { id: uid(), title: i.title, date: i.date, time: i.time ?? null, entity_id: i.entityId ?? null, note: i.note ?? null, created_at: now() };
  await sbInsert("events", row);
  return { id: row.id, title: i.title, date: i.date, time: i.time };
}
export async function updateEvent(i: any) {
  const patch: any = {};
  for (const k of ["title", "date", "time", "note"]) if (i[k] !== undefined) patch[k] = i[k];
  await sbUpdate("events", `id=eq.${enc(i.id)}`, patch);
  return { id: i.id, updated: Object.keys(patch) };
}
export async function deleteEvent(id: string) { await sbDelete("events", `id=eq.${enc(id)}`); return { deleted: id }; }

// ---------- NOTES ----------
export async function listNotes(f: { kind?: string } = {}) {
  let qs = "order=created_at.desc";
  if (f.kind) qs += `&kind=eq.${enc(f.kind)}`;
  return sbSelect("notes", qs);
}
export async function addNote(i: { kind?: string; title?: string; body: string; url?: string; entityId?: string }) {
  const row = { id: uid(), kind: i.kind || "note", title: i.title ?? null, body: i.body, url: i.url ?? null, entity_id: i.entityId ?? null, pinned: false, created_at: now() };
  await sbInsert("notes", row);
  return { id: row.id, kind: row.kind };
}
export async function deleteNote(id: string) { await sbDelete("notes", `id=eq.${enc(id)}`); return { deleted: id }; }

// ---------- CONTACTS ----------
export async function listContacts() { return sbSelect("contacts", "order=created_at.desc"); }
export async function findContact(q: string) { return sbSelect("contacts", `or=(name.${like(q)},company.${like(q)})&limit=8`); }
export async function addContact(i: { name: string; company?: string; role?: string; email?: string; phone?: string; entityId?: string }) {
  const row = { id: uid(), name: i.name, company: i.company ?? null, role: i.role ?? null, email: i.email ?? null, phone: i.phone ?? null, entity_id: i.entityId ?? null, created_at: now() };
  await sbInsert("contacts", row);
  return { id: row.id, name: i.name };
}
export async function updateContact(i: any) {
  const patch: any = {};
  for (const k of ["name", "company", "role", "email", "phone"]) if (i[k] !== undefined) patch[k] = i[k];
  await sbUpdate("contacts", `id=eq.${enc(i.id)}`, patch);
  return { id: i.id, updated: Object.keys(patch) };
}
export async function deleteContact(id: string) { await sbDelete("contacts", `id=eq.${enc(id)}`); return { deleted: id }; }

// ---------- DOCUMENTS ----------
const RESTRICTED = ["finance", "legal", "identity", "contracts"];
export async function addDoc(d: { id: string; title: string; fileName?: string; mime?: string; kind?: string; text: string; folder?: string; entityId?: string; chunks?: { text: string; embedding: number[] }[]; createdAt?: number }) {
  const created = d.createdAt ?? now();
  const folder = d.folder || "general";
  await sbInsert("docs", {
    id: d.id, title: d.title, file_name: d.fileName ?? null, mime: d.mime ?? null, kind: d.kind ?? "document",
    entity_id: d.entityId ?? null, content: d.text ?? "", folder, sensitivity: RESTRICTED.includes(folder) ? "restricted" : "normal",
    size: 0, created_at: created,
  });
  const rows = (d.chunks || []).filter((c) => c.embedding?.length).map((c, i) => ({ doc_id: d.id, idx: i, text: c.text, embedding: `[${c.embedding.join(",")}]`, created_at: created }));
  if (rows.length) await sbInsert("doc_chunks", rows);
  return { id: d.id, folder };
}
export async function listDocs(f: { folder?: string; entityId?: string } = {}) {
  let qs = "select=id,title,folder,kind,sensitivity,entity_id,created_at&order=created_at.desc";
  if (f.folder) qs += `&folder=eq.${enc(f.folder)}`;
  if (f.entityId) qs += `&entity_id=eq.${enc(f.entityId)}`;
  return sbSelect("docs", qs);
}
export async function fileDocument(i: { id: string; folder: string; entityId?: string; sensitivity?: string }) {
  const patch: any = { folder: i.folder, sensitivity: i.sensitivity || (RESTRICTED.includes(i.folder) ? "restricted" : "normal") };
  if (i.entityId !== undefined) patch.entity_id = i.entityId;
  await sbUpdate("docs", `id=eq.${enc(i.id)}`, patch);
  return { id: i.id, folder: i.folder, sensitivity: patch.sensitivity };
}
export async function deleteDoc(id: string) { await sbDelete("docs", `id=eq.${enc(id)}`); return { deleted: id }; }

// ---------- CHAT (append-only, one-brain, PARTY-SCOPED privacy wall) ----------
// Every message belongs to a `party` (the person the conversation is with).
// Jensen's history and Taona's dev history never mix; Jensen can only ever load
// his own. (Asymmetric wall: an admin tool can read Jensen's; nothing lets Jensen
// read the admin's.)
export async function chatAppend(role: "user" | "assistant", content: string, channel = "portal", party = "jensen") {
  await sbInsert("chat_messages", { role, content, channel, party, ts: now() });
}
export async function chatRecent(party = "jensen", limit = 12): Promise<{ role: "user" | "assistant"; content: string }[]> {
  const rows = await sbSelect<any>("chat_messages", `party=eq.${enc(party)}&select=role,content,ts&order=ts.desc&limit=${limit}`);
  return rows.reverse().map((r) => ({ role: r.role, content: r.content }));
}
// Admin-only: read Jensen's recent conversation (development access, one-way).
export async function readOwnerChats(limit = 40): Promise<{ role: string; content: string; channel: string; ts: number }[]> {
  const rows = await sbSelect<any>("chat_messages", `party=eq.jensen&select=role,content,channel,ts&order=ts.desc&limit=${limit}`);
  return rows.reverse();
}

// ---------- KV ----------
export async function getPrefs() { const r = await sbSelect<any>("kv", `key=eq.prefs&select=value`); return r[0]?.value ?? {}; }
export async function setPrefs(p: any) { await sbUpsert("kv", { key: "prefs", value: p, updated_at: now() }, "key"); return { ok: true }; }
export async function getGoals() { const r = await sbSelect<any>("kv", `key=eq.goals&select=value`); return (r[0]?.value as string[]) ?? []; }
export async function setGoals(g: string[]) { await sbUpsert("kv", { key: "goals", value: g, updated_at: now() }, "key"); return { ok: true, goals: g }; }
export async function getBlueprint() { const r = await sbSelect<any>("kv", `key=eq.legalBlueprint&select=value`); return (r[0]?.value as string) ?? ""; }
export async function setBlueprint(t: string) { await sbUpsert("kv", { key: "legalBlueprint", value: t, updated_at: now() }, "key"); return { ok: true }; }
