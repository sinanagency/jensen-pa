// The concierge brain. memorae-class: hybrid retrieval (vector + keyword fused by
// Reciprocal Rank Fusion), durable fact memory, salience auto-capture, and a
// grounding assembler. Server-only. Mirrors Nisria's lib/memory.ts pattern,
// reskinned to Jensen's world (no Nisria data/keys).

import { admin } from "../db";
import { claudeJSON } from "../anthropic";
import { embed as openaiEmbed } from "../openai";

const vec = (e: number[]) => `[${e.join(",")}]`;
const RRF_K = 60;

async function tryEmbed(text: string): Promise<number[] | null> {
  try {
    const [e] = await openaiEmbed([text.slice(0, 4000)]);
    return e || null;
  } catch {
    return null; // no embedder -> keyword-only recall
  }
}

// ---- write: durable fact ----
export async function rememberFact(fact: string, opts?: { source?: string; kind?: string; subject?: string }): Promise<void> {
  const f = (fact || "").trim();
  if (!f) return;
  // soft dedup: skip if an identical fact already exists
  const dup = await admin().from("brain_facts").select("id").eq("fact", f).limit(1);
  if (dup.data && dup.data.length) return;
  const e = await tryEmbed(f);
  const row: any = { fact: f, source: opts?.source ?? null, kind: opts?.kind ?? "fact", subject: opts?.subject ?? null, status: "active", created_at: Date.now() };
  if (e) row.embedding = vec(e);
  const res = await admin().from("brain_facts").insert(row);
  if (res.error) throw new Error(`remember_fact: ${res.error.message}`);
}

// ---- read: what do we know about X ----
export async function queryMemory(about: string, limit = 12): Promise<string[]> {
  const q = (about || "").trim();
  const res = await admin()
    .from("brain_facts")
    .select("fact,subject,created_at")
    .eq("status", "active")
    .or(`fact.ilike.%${q}%,subject.ilike.%${q}%`)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (res.error) return [];
  return (res.data ?? []).map((r: any) => r.fact);
}

// ---- RRF fusion helper ----
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
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => item.get(k)!)
    .filter(Boolean);
}

export type Recall = { facts: string[]; docs: { title: string; text: string }[] };

// ---- hybrid recall: vector + keyword, RRF-fused ----
export async function recall(query: string, opts?: { factK?: number; docK?: number }): Promise<Recall> {
  const factK = opts?.factK ?? 6;
  const docK = opts?.docK ?? 5;
  const q = (query || "").trim();
  if (!q) return { facts: [], docs: [] };
  const qe = await tryEmbed(q);

  // FACTS: vector arm + keyword arm
  const factVec = qe
    ? (await admin().rpc("match_brain_facts", { query_embedding: vec(qe), match_count: 10 })).data ?? []
    : [];
  const factKw = (await admin().from("brain_facts").select("fact,source").eq("status", "active").ilike("fact", `%${q}%`).limit(10)).data ?? [];
  const facts = rrf<any>([factVec, factKw], (r) => r.fact).slice(0, factK).map((r) => r.fact);

  // DOCS: vector arm (RPC) + keyword arm (chunk text ilike, joined to title)
  const docVec = qe
    ? (await admin().rpc("match_doc_chunks", { query_embedding: vec(qe), match_count: 10 })).data ?? []
    : [];
  const docKwRows = (await admin().from("doc_chunks").select("text,doc_id").ilike("text", `%${q}%`).limit(10)).data ?? [];
  // resolve titles for keyword hits
  const ids = [...new Set(docKwRows.map((r: any) => r.doc_id))];
  let titles: Record<string, string> = {};
  if (ids.length) {
    const t = (await admin().from("docs").select("id,title").in("id", ids)).data ?? [];
    titles = Object.fromEntries(t.map((r: any) => [r.id, r.title]));
  }
  const docKw = docKwRows.map((r: any) => ({ title: titles[r.doc_id] || "document", content: r.text }));
  const docVecNorm = (docVec as any[]).map((r) => ({ title: r.title, content: r.content }));
  const docs = rrf<any>([docVecNorm, docKw], (r) => (r.content || "").slice(0, 80))
    .slice(0, docK)
    .map((r) => ({ title: r.title, text: r.content }));

  return { facts, docs };
}

// ---- salience: pull durable facts out of a finished turn, store them ----
const SALIENCE_SYS =
  "You extract DURABLE facts about Jensen's business world from a chat turn, for an assistant's long-term memory. " +
  "Return only stable facts worth remembering for weeks (people, venues, clients, preferences, decisions, standing context). " +
  "DO NOT capture: tasks, to-dos, one-off questions, money amounts, dates of single events, greetings, or anything transient. " +
  "Return JSON {facts: string[]}. Each fact one short self-contained sentence. Empty array if nothing durable.";

export async function captureSalience(userMsg: string, assistantReply: string): Promise<number> {
  try {
    const out = await claudeJSON<{ facts: string[] }>(
      SALIENCE_SYS,
      `User: ${userMsg}\n\nAssistant: ${assistantReply}`,
      400
    );
    const facts = (out?.facts ?? []).filter((f) => typeof f === "string" && f.trim().length > 8).slice(0, 5);
    for (const f of facts) await rememberFact(f, { source: "chat", kind: "auto_fact" });
    return facts.length;
  } catch {
    return 0;
  }
}
