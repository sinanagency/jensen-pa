// Document brain — now server-backed (Supabase + pgvector) via /api/docs.
// The name is kept for import stability; it no longer touches IndexedDB. The
// mentor and the WhatsApp brain (next phase) hit the same server store, so
// document recall is shared, not per-browser.
"use client";

export type DocChunk = { text: string; embedding: number[] };
export type Doc = {
  id: string;
  title: string;
  fileName: string;
  mime: string;
  kind: string; // document | invoice | image | legal | note
  entityId?: string;
  text: string;
  chunks: DocChunk[];
  size: number;
  dataUrl?: string; // original file for re-download (optional)
  createdAt: number;
};

function emit() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("lr-docs-change"));
}

export async function addDoc(doc: Doc): Promise<void> {
  await fetch("/api/docs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(doc),
  });
  emit();
}

export async function allDocs(): Promise<Doc[]> {
  try {
    const r = await fetch("/api/docs", { cache: "no-store" });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.docs || []).map((d: any) => ({ ...d, chunks: d.chunks || [] })) as Doc[];
  } catch {
    return [];
  }
}

export async function deleteDoc(id: string): Promise<void> {
  await fetch(`/api/docs?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  emit();
}

export async function searchDocs(queryEmbedding: number[], k = 5): Promise<{ title: string; text: string; score: number }[]> {
  try {
    const r = await fetch("/api/docs/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ embedding: queryEmbedding, k }),
    });
    if (!r.ok) return [];
    const j = await r.json();
    return j.hits || [];
  } catch {
    return [];
  }
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
