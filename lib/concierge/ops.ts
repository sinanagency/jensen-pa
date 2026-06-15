// Granular data operations for the concierge tools. Raw PostgREST (see rest.ts)
// so it works on Node 20 and Vercel alike. One row per call. Server-only.

import { sbSelect, sbInsert, sbUpsert, sbUpdate, sbDelete, enc } from "./rest";
import { dubaiToday, dubaiHHMM } from "../time";

// Tag each calendar row with a derived status so the LLM never has to compare
// time strings against "now" when rendering Jensen's board. Past items must
// never be rendered as upcoming (bug repro 2026-06-12 11:47: "10:35 Call to
// set driving test" rendered as if it were still coming up). Field is the
// source of truth — model is told (in loop.ts) to trust `status` and not
// recompute. NOW_WINDOW_MIN keeps items within the next hour highlighted as
// live so Jensen sees what is happening this minute.
const NOW_WINDOW_MIN = 60;
type EventStatus = "past" | "now" | "upcoming";
function tagEventStatus(row: any, today: string, nowHHMM: string): any {
  const d: string = row.date || "";
  const t: string = row.time || "";
  let status: EventStatus = "upcoming";
  if (d && d < today) status = "past";
  else if (d && d > today) status = "upcoming";
  else if (d === today) {
    if (!t) status = "upcoming";
    else if (t < nowHHMM) status = "past";
    else {
      const [nh, nm] = nowHHMM.split(":").map(Number);
      const [eh, em] = t.split(":").map(Number);
      const diff = (eh * 60 + em) - (nh * 60 + nm);
      status = diff >= 0 && diff <= NOW_WINDOW_MIN ? "now" : "upcoming";
    }
  }
  return { ...row, status };
}

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
  const rows = await sbSelect<any>("events", qs);
  const today = dubaiToday();
  const nowHHMM = dubaiHHMM();
  return rows.map((r: any) => tagEventStatus(r, today, nowHHMM));
}
// Normalized title key for soft-dedup. Strips lead "meeting with the",
// trailing " at <location>", lowercases, collapses whitespace. Two model-produced
// titles describing the same meeting (one with location in title, one with
// location in note) collapse to the same key.
export function normalizeEventTitleKey(title: string): string {
  return (title || "")
    .toLowerCase()
    .replace(/^meeting (with|w\/)\s+(the\s+)?/i, "")
    .replace(/\s+at\s+[^,]+$/i, "")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function createEvent(i: { title: string; date: string; time?: string; entityId?: string; note?: string }) {
  // Soft-dedup: normalized title + same date (+ same time if both provided) is
  // the same event, not a copy. Prevents the 06-13 Karafotias case where the
  // model produced "Meeting with the Karafotias at Dubai Hills Mall" and
  // "Meeting with the Karafotias" 75s apart for the same 14:30 slot.
  const key = normalizeEventTitleKey(i.title);
  if (key) {
    const sameDay = await sbSelect<any>("events", `date=eq.${enc(i.date)}&select=id,title,time&limit=20`).catch(() => []);
    const dup = sameDay.find((r: any) => {
      if (normalizeEventTitleKey(r.title) !== key) return false;
      if (i.time && r.time && i.time !== r.time) return false;
      return true;
    });
    if (dup) return { id: dup.id, title: dup.title, date: i.date, deduped: true };
  }
  const row = { id: uid(), title: i.title, date: i.date, time: i.time ?? null, entity_id: i.entityId ?? null, note: i.note ?? null, created_at: now() };
  await sbInsert("events", row);
  return { id: row.id, title: i.title, date: i.date, time: i.time };
}
export async function updateEvent(i: any) {
  const patch: any = {};
  for (const k of ["title", "date", "time", "note"]) if (i[k] !== undefined) patch[k] = i[k];
  // Wall-at-primitive: any change to fire-time invalidates the reminder latch.
  // Without this, a moved event keeps its old reminded_at and the cron's
  // `reminded_at IS NULL` filter silently skips the row on the new date.
  if (patch.date !== undefined || patch.time !== undefined) patch.reminded_at = null;
  await sbUpdate("events", `id=eq.${enc(i.id)}`, patch);
  return { id: i.id, updated: Object.keys(patch) };
}
export async function deleteEvent(id: string) { await sbDelete("events", `id=eq.${enc(id)}`); return { deleted: id }; }

// complete_event (KT #288). When Jensen says "Sara done / Toana done", Dorje
// used to punt with "they were calendar events, so marked past automatically",
// a behavioral fiction (Law 1 persona-purity asks for honesty, Law 6 numbers-
// reconcile asks for status to match state). Stamps outcome="completed" and
// prepends a one-line marker on note. The reminders cron's reminded_at latch
// already gates re-firing, so completion is purely a status record.
export async function completeEvent(i: { id: string; note?: string }) {
  const stamp = new Date().toISOString().slice(0, 10);
  const noteLine = i.note ? `[completed ${stamp}: ${i.note}]` : `[completed ${stamp}]`;
  const rows = await sbSelect<any>("events", `id=eq.${enc(i.id)}&select=note&limit=1`).catch(() => []);
  const prev = rows?.[0]?.note || "";
  const merged = prev ? `${noteLine}\n${prev}` : noteLine;
  await sbUpdate("events", `id=eq.${enc(i.id)}`, { outcome: "completed", note: merged });
  return { id: i.id, completed: true };
}

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
//
// Wall 1 of "fragment match without anchor" (2026-06-16, KT #293):
//   externalId           outbound Meta wamid, set so a later inbound m.context.id
//                        can join chat_messages.reply_to_external_id -> external_id.
//   replyToExternalId    set on the inbound row when the user reply-quoted a
//                        prior Dorje message; the worker resolves it at turn time.
// Both are optional; existing call sites pass nothing and behavior is identical.
// Returns the inserted row id so the caller can back-patch external_id once Meta
// returns the wamid (sendTextAndLog and the whatsapp route both rely on this).
export async function chatAppend(
  role: "user" | "assistant",
  content: string,
  channel = "portal",
  party = "jensen",
  opts?: { externalId?: string | null; replyToExternalId?: string | null }
): Promise<number | null> {
  const row: any = { role, content, channel, party, ts: now() };
  if (opts?.externalId) row.external_id = opts.externalId;
  if (opts?.replyToExternalId) row.reply_to_external_id = opts.replyToExternalId;
  try {
    const rows: any[] = await sbInsert("chat_messages", row);
    const id = rows?.[0]?.id;
    return typeof id === "number" ? id : null;
  } catch {
    return null;
  }
}
// Back-patch a chat_messages row with the wamid Meta returned post-send. Best
// effort: the row itself already holds the transcript, only the anchor join
// degrades on failure.
export async function chatPatchExternalId(rowId: number, externalId: string): Promise<void> {
  try {
    await sbUpdate("chat_messages", `id=eq.${rowId}`, { external_id: externalId });
  } catch {
    // never block delivery, never throw upstream
  }
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

// ---------- SANAD (UAE legal brain via /api/v1/*) ----------
// sanadStartDraft enqueues an async draft job on Sanad and records the pending
// row locally so the cron at /api/cron/sanad-deliver can poll it and deliver
// the PDF to the recipient WA when ready. Returns context the model uses to
// tell the user "I will have that ready in two minutes" in first person.
import { sanadDraftContract, sanadReviewContract, type SanadKind, type SanadJurisdiction } from "../sanad/client";

interface SanadDraftToolInput {
  kind: SanadKind;
  jurisdiction: SanadJurisdiction;
  party_a_name: string;
  party_a_details?: string;
  party_b_name: string;
  party_b_details?: string;
  effective_date?: string;
  additional_context?: string;
  recipient_wa: string;
}

export async function sanadStartDraft(input: SanadDraftToolInput) {
  if (!input?.recipient_wa) {
    return { ok: false, error: "recipient_wa is required so the PDF can be delivered when ready." };
  }
  const r = await sanadDraftContract({
    kind: input.kind,
    jurisdiction: input.jurisdiction,
    party_a: { name: input.party_a_name, details: input.party_a_details },
    party_b: { name: input.party_b_name, details: input.party_b_details },
    effective_date: input.effective_date,
    additional_context: input.additional_context
  });
  if (!r.ok) {
    return { ok: false, error: r.reason, status: r.status, hint: r.reason === "sanad_disabled" ? "Sanad v1 env vars (SANAD_V1_BASE_URL + SANAD_V1_API_KEY) are not set on this deployment." : undefined };
  }
  await sbInsert("sanad_pending_drafts", {
    job_id: r.data.job_id,
    recipient_wa: input.recipient_wa,
    kind: input.kind,
    jurisdiction: input.jurisdiction,
    status: "queued",
    poll_url: r.data.poll_url,
    metadata: {
      party_a_name: input.party_a_name,
      party_b_name: input.party_b_name,
      effective_date: input.effective_date,
      additional_context: input.additional_context
    }
  });
  return {
    ok: true,
    job_id: r.data.job_id,
    eta_seconds: r.data.eta_seconds,
    message_to_user: r.data.message,
    note: "Job queued. The cron at /api/cron/sanad-deliver polls Sanad and delivers the PDF to recipient_wa via sendTextAndLog when ready."
  };
}

export async function sanadReview(input: { text: string; kind?: SanadKind; jurisdiction?: SanadJurisdiction }) {
  if (!input?.text || input.text.length < 200) {
    return { ok: false, error: "text must be at least 200 chars." };
  }
  const r = await sanadReviewContract(input);
  if (!r.ok) {
    return { ok: false, error: r.reason, status: r.status, hint: r.reason === "sanad_disabled" ? "Sanad v1 env vars not set." : undefined };
  }
  return { ok: true, ...r.data };
}
