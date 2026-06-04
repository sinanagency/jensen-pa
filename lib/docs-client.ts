// Client-side document brain API. The ONE place the portal talks to the
// server-authoritative doc store (Supabase docs + doc_chunks/pgvector via
// /api/docs). Replaces the old browser-local IndexedDB (lib/idb) so the
// concierge, brain, meetings and the WhatsApp brain all share one memory.
"use client";

export type Doc = {
  id: string;
  title: string;
  fileName?: string;
  mime?: string;
  kind?: string;
  entityId?: string;
  text: string;
  size?: number;
  dataUrl?: string;
  createdAt: number;
  chunks: { text: string; embedding: number[] }[];
};

export function uid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `d_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
  }
}

// Persist a document (with its embedded chunks) to Supabase. We deliberately drop
// the raw base64 blob (dataUrl) before sending — keeps us under the serverless
// body limit and the docs table lean; the searchable text + embeddings are what
// the brain actually needs.
export async function addDoc(doc: Doc): Promise<void> {
  const { dataUrl, ...lean } = doc;
  const res = await fetch("/api/docs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(lean),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || `Could not save (${res.status}).`);
  }
}

export async function allDocs(): Promise<Doc[]> {
  const res = await fetch("/api/docs");
  if (!res.ok) return [];
  const d = await res.json().catch(() => ({}));
  return (d.docs || []) as Doc[];
}

export async function deleteDoc(id: string): Promise<void> {
  await fetch(`/api/docs?id=${encodeURIComponent(id)}`, { method: "DELETE" });
}

// Server-side pgvector RAG. Same shape as the old client cosine search.
export async function searchDocs(
  embedding: number[],
  k = 6
): Promise<{ title: string; text: string; score: number }[]> {
  const res = await fetch("/api/docs/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ embedding, k }),
  });
  if (!res.ok) return [];
  const d = await res.json().catch(() => ({}));
  return (d.hits || []) as { title: string; text: string; score: number }[];
}
