// "Drop everything and it gets populated." Shared client pipeline:
// a dropped file (or pasted text) -> /api/ingest-file (extract text, OCR images)
// -> /api/triage (decide destination + fields) -> write into the local store and
// keep the source in the document brain for search. Used by Concierge + Finance.
"use client";

import { DB, uid } from "./store";
import { addDoc, uid as docUid } from "./docs-client";

export type DropResult = { ok: boolean; summary: string; destination?: string; error?: string };
type Mutate = (fn: (d: DB) => void) => void;

function fileToBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] || "");
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
}

const today = () => new Date().toISOString().slice(0, 10);

// Apply a triage result to the store. Returns the concierge summary line.
function apply(tri: any, mutate: Mutate, fallbackTitle: string): string {
  switch (tri.destination) {
    case "finance":
      if (tri.finance) {
        const f = tri.finance;
        mutate((d) => d.finance.push({
          id: uid(), kind: f.kind === "income" ? "income" : "expense",
          amount: Number(f.amount) || 0, vatApplies: !!f.vatApplies,
          label: f.label || f.vendor || fallbackTitle, date: f.date || today(), createdAt: Date.now(),
        }));
      }
      break;
    case "task":
      if (tri.task) {
        const q = [1, 2, 3, 4].includes(tri.task.quadrant) ? tri.task.quadrant : 2;
        mutate((d) => d.tasks.push({ id: uid(), title: tri.task.title || fallbackTitle, quadrant: q as any, done: false, createdAt: Date.now() }));
      }
      break;
    case "contact":
      if (tri.contact) {
        const c = tri.contact;
        mutate((d) => d.contacts.push({ id: uid(), name: c.name || fallbackTitle, company: c.company, role: c.role, email: c.email, phone: c.phone, createdAt: Date.now() }));
      }
      break;
    case "event":
      if (tri.event) {
        const ev = tri.event;
        mutate((d) => d.events.push({ id: uid(), title: ev.title || fallbackTitle, date: ev.date || today(), time: ev.time, note: ev.note, createdAt: Date.now() }));
      }
      break;
    case "note":
      if (tri.note) {
        mutate((d) => d.notes.push({ id: uid(), kind: "note", title: tri.note.title, body: tri.note.body || "", createdAt: Date.now() }));
      }
      break;
    default:
      break;
  }
  return tri.summary || "I filed that for you.";
}

// Ingest a single file end to end.
export async function dropFile(file: File, mutate: Mutate): Promise<DropResult> {
  try {
    const dataBase64 = await fileToBase64(file);
    const ing = await fetch("/api/ingest-file", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename: file.name, mime: file.type, dataBase64 }),
    }).then((r) => r.json());
    if (ing.error) return { ok: false, summary: "", error: ing.error };

    const tri = await fetch("/api/triage", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: ing.text, filename: ing.title, kind: ing.kind }),
    }).then((r) => r.json());
    // Never report fake success: if triage failed, surface it (mirror dropText).
    if (tri?.error) return { ok: false, summary: "", error: tri.error };

    const summary = apply(tri, mutate, ing.title);

    // Always keep the source in the document brain so it is searchable later.
    try {
      await addDoc({
        id: docUid(), title: ing.title, fileName: file.name, mime: file.type || "application/octet-stream",
        kind: tri.destination === "finance" ? "invoice" : (ing.kind || "document"),
        text: ing.text, chunks: ing.chunks || [], size: file.size, createdAt: Date.now(),
      });
    } catch {}

    return { ok: true, summary, destination: tri.destination };
  } catch (e: any) {
    return { ok: false, summary: "", error: e?.message || String(e) };
  }
}

// Triage pasted text (no file).
export async function dropText(text: string, mutate: Mutate): Promise<DropResult> {
  try {
    const tri = await fetch("/api/triage", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, filename: "(pasted text)", kind: "text" }),
    }).then((r) => r.json());
    if (tri.error) return { ok: false, summary: "", error: tri.error };
    const summary = apply(tri, mutate, text.slice(0, 40));
    return { ok: true, summary, destination: tri.destination };
  } catch (e: any) {
    return { ok: false, summary: "", error: e?.message || String(e) };
  }
}
