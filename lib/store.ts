// Client-side store (localStorage). Entity-first data model. This is the v1
// persistence: it genuinely persists across refresh per browser. Server-side
// multi-device sync is the documented next step (a Supabase project).
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

export type DB = {
  entities: Entity[];
  tasks: Task[];
  docs: BrainDoc[];
  finance: FinanceRecord[];
  events: CalEvent[];
  chat: ChatTurn[];
  goals: string[];
  onboarded: boolean;
};

const KEY = "larencontre.db.v1";

function empty(): DB {
  return { entities: [], tasks: [], docs: [], finance: [], events: [], chat: [], goals: [], onboarded: false };
}

export function load(): DB {
  if (typeof window === "undefined") return empty();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) { const s = seed(); save(s); return s; }
    return { ...empty(), ...JSON.parse(raw) };
  } catch {
    return empty();
  }
}

export function save(db: DB) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(db));
  window.dispatchEvent(new Event("lr-db-change"));
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

// Local RAG: rank stored chunks against a query embedding.
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

// A small, realistic seed so the platform is alive on first open and demos well.
function seed(): DB {
  const now = Date.now();
  const e = (kind: EntityKind, name: string, subtitle: string, status: string): Entity => ({
    id: uid(), kind, name, subtitle, status, createdAt: now,
  });
  const venues = [
    e("venue", "Marina Social House", "Rooftop lounge, Dubai Marina", "Open · managed"),
    e("venue", "Cordré", "Modern French bistro, DIFC", "Concept phase"),
  ];
  const clients = [
    e("client", "Al Habtoor Group", "Multi-venue F&B revamp", "Active engagement"),
    e("client", "Khalifa Hospitality", "New opening, Downtown", "Proposal sent"),
  ];
  const events = [
    e("event", "The Khalifa Wedding", "500 guests, Atlantis Royal, Nov", "Planning"),
    e("event", "Cordré Launch Dinner", "Press + investors, Sep", "Concept"),
  ];
  const all = [...venues, ...clients, ...events];
  const t = (title: string, quadrant: Quadrant, entityId?: string): Task => ({
    id: uid(), title, quadrant, entityId, done: false, createdAt: now,
  });
  const tasks: Task[] = [
    t("Send Khalifa Hospitality the revised concept deck", 1, clients[1].id),
    t("Confirm caterer for the Khalifa Wedding", 1, events[0].id),
    t("Review Marina Social House October P&L", 1, venues[0].id),
    t("Draft Cordré menu engineering doc", 2, venues[1].id),
    t("Build Q4 target list of venues to pitch", 2),
    t("Reply to supplier quote emails", 3),
    t("Renew trade license (expires in 6 weeks)", 1),
  ];
  const finance: FinanceRecord[] = [
    { id: uid(), entityId: venues[0].id, kind: "income", amount: 42000, vatApplies: true, label: "Marina mgmt retainer (Oct)", date: "2026-10-01", createdAt: now },
    { id: uid(), entityId: clients[0].id, kind: "income", amount: 85000, vatApplies: true, label: "Al Habtoor revamp phase 1", date: "2026-09-20", createdAt: now },
    { id: uid(), kind: "expense", amount: 12000, vatApplies: true, label: "Freelance design + content", date: "2026-10-05", createdAt: now },
  ];
  const events2: CalEvent[] = [
    { id: uid(), title: "Khalifa Wedding site visit", entityId: events[0].id, date: isoIn(3), time: "16:00", createdAt: now },
    { id: uid(), title: "Al Habtoor steering call", entityId: clients[0].id, date: isoIn(1), time: "11:00", createdAt: now },
  ];
  return {
    entities: all, tasks, docs: [], finance, events: events2, chat: [],
    goals: ["Land 3 new venue clients this quarter", "Get Cordré open by Q1", "Replace the freelancer stack"],
    onboarded: false,
  };
}

function isoIn(days: number): string {
  const d = new Date(2026, 5, 2);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
