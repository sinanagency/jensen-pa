// Client store. As of the Supabase migration this is a thin, server-backed cache:
// state lives in Supabase (see lib/db.ts) so the WhatsApp brain and the portal
// share one source of truth. This module keeps an in-memory cache + a localStorage
// MIRROR (instant first paint + offline fallback) and debounce-syncs writes to
// /api/state. hydrate() pulls the authoritative snapshot from the server.
"use client";

import { cosine } from "./openai";

export type EntityKind = "venue" | "client" | "event";
export type Entity = {
  id: string;
  kind: EntityKind;
  name: string;
  subtitle?: string;
  status?: string;
  notes?: string;
  createdAt: number;
};

export type Quadrant = 1 | 2 | 3 | 4;
export type Task = {
  id: string;
  title: string;
  entityId?: string;
  quadrant: Quadrant;
  done: boolean;
  due?: string;
  createdAt: number;
};

export type DocChunk = { text: string; embedding: number[] };
export type BrainDoc = {
  id: string;
  title: string;
  text: string;
  entityId?: string;
  chunks: DocChunk[];
  createdAt: number;
};

export type FinanceRecord = {
  id: string;
  entityId?: string;
  kind: "income" | "expense";
  amount: number; // net AED
  vatApplies: boolean;
  label: string;
  date: string;
  createdAt: number;
};

export type CalEvent = {
  id: string;
  title: string;
  entityId?: string;
  date: string; // ISO date
  time?: string;
  note?: string;
  createdAt: number;
};

export type ChatTurn = { role: "user" | "assistant"; content: string; ts: number };

export type NoteKind = "note" | "journal" | "idea" | "link";
export type Note = {
  id: string;
  kind: NoteKind;
  title?: string;
  body: string;
  url?: string;
  entityId?: string;
  pinned?: boolean;
  createdAt: number;
};

export type Contact = {
  id: string;
  name: string;
  company?: string;
  role?: string;
  email?: string;
  phone?: string;
  notes?: string;
  entityId?: string;
  createdAt: number;
};

export type Prefs = {
  workStyle?: string;
  tone?: string;
  hours?: string;
  extra?: string;
};

export type DB = {
  entities: Entity[];
  tasks: Task[];
  docs: BrainDoc[];
  finance: FinanceRecord[];
  events: CalEvent[];
  notes: Note[];
  contacts: Contact[];
  prefs: Prefs;
  chat: ChatTurn[];
  goals: string[];
  legalBlueprint?: string;
  onboarded: boolean;
};

const KEY = "larencontre.db.v1"; // local mirror for fast paint + offline fallback

export function empty(): DB {
  return { entities: [], tasks: [], docs: [], finance: [], events: [], notes: [], contacts: [], prefs: {}, chat: [], goals: [], onboarded: false };
}

let cache: DB | null = null;
let serverOK = true;
let syncTimer: ReturnType<typeof setTimeout> | null = null;

function mirror() {
  if (typeof window === "undefined" || !cache) return;
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch {}
}
function dispatch() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("lr-db-change"));
}

// Synchronous read: returns the cache, seeding it from the localStorage mirror on
// first call so the UI paints instantly before hydrate() returns from the server.
export function load(): DB {
  if (cache) return cache;
  if (typeof window !== "undefined") {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { const parsed = JSON.parse(raw) as Partial<DB>; cache = { ...empty(), ...parsed }; return cache; }
    } catch {}
  }
  cache = empty();
  return cache;
}

// Pull the authoritative snapshot from the server and replace the cache.
export async function hydrate(): Promise<DB> {
  try {
    const r = await fetch("/api/state", { cache: "no-store" });
    if (r.ok) {
      const db = (await r.json()) as DB;
      cache = { ...empty(), ...db };
      serverOK = true;
      mirror();
      dispatch();
      return cache;
    }
    if (r.status === 503) serverOK = false; // not configured -> stay local
  } catch {
    serverOK = false; // offline -> stay local
  }
  return load();
}

function scheduleSync() {
  if (!serverOK || typeof window === "undefined") return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    if (!cache) return;
    fetch("/api/state", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cache),
    }).catch(() => {});
  }, 500);
}

export function save(db: DB) {
  cache = db;
  mirror();
  dispatch();
  scheduleSync();
}

export function update(fn: (db: DB) => void): DB {
  const db = load();
  fn(db);
  save(db);
  return db;
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

// Legacy in-memory RAG over db.docs. Docs now live server-side (pgvector); the
// mentor uses lib/idb.searchDocs (server). Kept for any local-only callers.
export function searchBrain(db: DB, queryEmbedding: number[], k = 5): { text: string; title: string; score: number }[] {
  const hits: { text: string; title: string; score: number }[] = [];
  for (const doc of db.docs) {
    for (const c of doc.chunks) {
      if (!c.embedding?.length) continue;
      hits.push({ text: c.text, title: doc.title, score: cosine(queryEmbedding, c.embedding) });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, k);
}
