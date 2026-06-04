// The concierge brain. Hybrid retrieval (vector + keyword fused by Reciprocal
// Rank Fusion), durable fact memory, salience auto-capture, grounding. Raw
// PostgREST (rest.ts) so it is deterministic on Node 20 + Vercel. Server-only.

import { sbSelect, sbInsert, sbRpc, enc } from "./rest";
import { claudeJSON } from "../anthropic";
import { embed as openaiEmbed } from "../openai";

const vec = (e: number[]) => `[${e.join(",")}]`;
const RRF_K = 60;
const now = () => Date.now();

async function tryEmbed(text: string): Promise<number[] | null> {
  try {
    const [e] = await openaiEmbed([text.slice(0, 4000)]);
    return e || null;
  } catch {
    return null;
  }
}

export async function rememberFact(fact: string, opts?: { source?: string; kind?: string; subject?: string }): Promise<void> {
  const f = (fact || "").trim();
  if (!f) return;
  const dup = await sbSelect("brain_facts", `fact=eq.${enc(f)}&select=id&limit=1`).catch(() => []);
  if (dup.length) return;
  const e = await tryEmbed(f);
  const row: any = { fact: f, source: opts?.source ?? null, kind: opts?.kind ?? "fact", subject: opts?.subject ?? null, status: "active", created_at: now() };
  if (e) row.embedding = vec(e);
  await sbInsert("brain_facts", row);
}

export async function queryMemory(about: string, limit = 12): Promise<string[]> {
  const q = (about || "").trim();
  const rows = await sbSelect<any>(
    "brain_facts",
    `status=eq.active&or=(fact.ilike.*${enc(q)}*,subject.ilike.*${enc(q)}*)&order=created_at.desc&limit=${limit}&select=fact`
  ).catch(() => []);
  return rows.map((r) => r.fact);
}

function rrf<T>(lists: T[][], key: (t: T) => string): T[] {
  const score = new Map<string, number>();
  const item = new Map<string, T>();
  for (const list of lists) {
    list.forEach((t, i) => {
      const k = key(t);
      score.set(k, (score.get(k) || 0) + 1 / (RRF_K + i));
      if (!item.has(k)) item.set(k, t);
    });
  }
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => item.get(k)!).filter(Boolean);
}

export type Recall = { facts: string[]; docs: { title: string; text: string }[] };

export async function recall(query: string, opts?: { factK?: number; docK?: number }): Promise<Recall> {
  const factK = opts?.factK ?? 6;
  const docK = opts?.docK ?? 5;
  const q = (query || "").trim();
  if (!q) return { facts: [], docs: [] };
  const qe = await tryEmbed(q);

  // FACTS
  const factVec: any[] = qe ? await sbRpc("match_brain_facts", { query_embedding: vec(qe), match_count: 10 }).catch(() => []) : [];
  const factKw: any[] = factK ? await sbSelect("brain_facts", `status=eq.active&fact=ilike.*${enc(q)}*&limit=10&select=fact,source`).catch(() => []) : [];
  const facts = factK ? rrf<any>([factVec, factKw], (r) => r.fact).slice(0, factK).map((r) => r.fact) : [];

  // DOCS
  const docVec: any[] = qe && docK ? await sbRpc("match_doc_chunks", { query_embedding: vec(qe), match_count: 10 }).catch(() => []) : [];
  const docKwRows: any[] = docK ? await sbSelect("doc_chunks", `text=ilike.*${enc(q)}*&limit=10&select=text,doc_id`).catch(() => []) : [];
  let titles: Record<string, string> = {};
  const ids = [...new Set(docKwRows.map((r) => r.doc_id))];
  if (ids.length) {
    const t = await sbSelect<any>("docs", `id=in.(${ids.map((i) => enc(String(i))).join(",")})&select=id,title`).catch(() => []);
    titles = Object.fromEntries(t.map((r) => [r.id, r.title]));
  }
  const docKw = docKwRows.map((r) => ({ title: titles[r.doc_id] || "document", content: r.text }));
  const docVecNorm = docVec.map((r) => ({ title: r.title, content: r.content }));
  const docs = docK ? rrf<any>([docVecNorm, docKw], (r) => (r.content || "").slice(0, 80)).slice(0, docK).map((r) => ({ title: r.title, text: r.content })) : [];

  return { facts, docs };
}

const SALIENCE_SYS =
  "You extract DURABLE facts about Jensen's business world from a chat turn, for an assistant's long-term memory. " +
  "Return only stable facts worth remembering for weeks (people, venues, clients, preferences, decisions, standing context). " +
  "DO NOT capture: tasks, to-dos, one-off questions, money amounts, dates of single events, greetings, or anything transient. " +
  "Return JSON {facts: string[]}. Each fact one short self-contained sentence. Empty array if nothing durable.";

export async function captureSalience(userMsg: string, assistantReply: string): Promise<number> {
  try {
    const out = await claudeJSON<{ facts: string[] }>(SALIENCE_SYS, `User: ${userMsg}\n\nAssistant: ${assistantReply}`, 400);
    const facts = (out?.facts ?? []).filter((f) => typeof f === "string" && f.trim().length > 8).slice(0, 5);
    for (const f of facts) await rememberFact(f, { source: "chat", kind: "auto_fact" });
    return facts.length;
  } catch {
    return 0;
  }
}
