// Server-side document brain. Stores docs + their embedded chunks in Supabase
// (pgvector), and runs semantic search via the match_doc_chunks RPC. Replaces
// the old client-side IndexedDB + JS-cosine RAG. Server-only.

import { admin } from "./db";

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
