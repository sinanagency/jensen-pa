// Server-side document brain. Stores docs + their embedded chunks in Supabase
// (pgvector), and runs semantic search via the match_doc_chunks RPC. Replaces
// the old client-side IndexedDB + JS-cosine RAG. Server-only.

import { admin } from "./db";
import { askClaude, SONNET } from "./anthropic";

export type ServerDoc = {
  id: string;
  title: string;
  fileName?: string;
  mime?: string;
  kind?: string;
  entityId?: string;
  folder?: string;
  text: string;
  size?: number;
  dataUrl?: string;
  createdAt: number;
  docDate?: string | null;
  chunks: { text: string; embedding: number[] }[];
};

// pgvector wants a bracketed literal, not a JSON array, through PostgREST.
const vec = (e: number[]) => `[${e.join(",")}]`;

export async function addServerDoc(doc: ServerDoc): Promise<void> {
  const db = admin();
  const up = await db.from("docs").upsert({
    id: doc.id, title: doc.title, file_name: doc.fileName ?? null, mime: doc.mime ?? null,
    kind: doc.kind ?? "document", entity_id: doc.entityId ?? null, content: doc.text ?? "",
    size: doc.size ?? 0, data_url: doc.dataUrl ?? null, created_at: doc.createdAt,
  });
  if (up.error) throw new Error(`docs upsert: ${up.error.message}`);
  const delc = await db.from("doc_chunks").delete().eq("doc_id", doc.id);
  if (delc.error) throw new Error(`doc_chunks delete: ${delc.error.message}`);
  const rows = (doc.chunks || [])
    .filter((c) => c.embedding?.length)
    .map((c, i) => ({ doc_id: doc.id, idx: i, text: c.text, embedding: vec(c.embedding), created_at: doc.createdAt }));
  if (rows.length) {
    const ins = await db.from("doc_chunks").insert(rows);
    if (ins.error) throw new Error(`doc_chunks insert: ${ins.error.message}`);
  }
}

export async function listServerDocs(): Promise<ServerDoc[]> {
  const res = await admin().from("docs").select("*").order("created_at", { ascending: false });
  if (res.error) throw new Error(`docs select: ${res.error.message}`);
  return (res.data ?? []).map((r: any) => ({
    id: r.id, title: r.title, fileName: r.file_name ?? "", mime: r.mime ?? "", kind: r.kind ?? "document",
    entityId: r.entity_id ?? undefined, folder: r.folder ?? "general",
    text: r.content ?? "", size: Number(r.size ?? 0),
    dataUrl: r.data_url ?? undefined, createdAt: Number(r.created_at),
    docDate: r.doc_date ?? null,
    chunks: [],
  }));
}

export async function deleteServerDoc(id: string): Promise<void> {
  const res = await admin().from("docs").delete().eq("id", id); // doc_chunks cascade
  if (res.error) throw new Error(`docs delete: ${res.error.message}`);
}

export async function searchServerDocs(embedding: number[], k = 5): Promise<{ title: string; text: string; score: number }[]> {
  const { data, error } = await admin().rpc("match_doc_chunks", { query_embedding: vec(embedding), match_count: k });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({ title: r.title, text: r.content, score: Number(r.score) }));
}

// Claude-powered document search (KT #348). No embeddings / no OpenAI: Claude reads
// the index of every doc (title + kind + a content snippet) and picks the ones that
// match the query's INTENT, then we return those docs with their content. For a
// single-tenant bot at hundreds of docs this fits Claude's context in one pass and is
// smarter than vector cosine. (If the corpus ever grows into the thousands, snippet
// size / a pre-filter would need revisiting — logged, not a concern at Jensen's scale.)
export async function searchDocsWithClaude(query: string, k = 8): Promise<{ id: string; title: string; text: string; score: number }[]> {
  const docs = await listServerDocs();
  if (!docs.length) return [];
  const index = docs.map((d, i) =>
    `[${i}] ${d.title}${d.kind ? ` (${d.kind})` : ""}${d.folder && d.folder !== "general" ? ` <${d.folder}>` : ""}\n${(d.text || "").replace(/\s+/g, " ").slice(0, 280)}`
  ).join("\n\n");
  const sys = "You are a precise document-search engine over the user's filed documents. Given a numbered INDEX (each entry: title, type, and a content snippet) and a QUERY, return ONLY the indices of documents that genuinely match the query's intent, most relevant first, as a JSON array of numbers like [3,7]. Return [] if nothing genuinely matches. Output the JSON array and nothing else.";
  let raw = "";
  try {
    raw = await askClaude({ system: sys, model: SONNET, maxTokens: 120, messages: [{ role: "user", content: `INDEX:\n${index}\n\nQUERY: ${query}\n\nMatching indices (JSON array, at most ${k}):` }] });
  } catch (e: any) {
    // Fail-soft: never throw a fake-empty as "no docs" silently — surface via an empty
    // result the caller can word honestly. (A real error is logged.)
    console.warn(`[searchDocsWithClaude] failed: ${String(e?.message || e).slice(0, 160)}`);
    return [];
  }
  let idxs: number[] = [];
  try { const m = raw.match(/\[[\d,\s]*\]/); idxs = m ? JSON.parse(m[0]) : []; } catch { idxs = []; }
  return idxs.slice(0, k).map((i) => docs[i]).filter(Boolean).map((d) => ({ id: d.id, title: d.title, text: (d.text || "").slice(0, 1500), score: 1 }));
}
