// Document store backed by IndexedDB. localStorage caps at ~5MB, far too small
// for "drop all my files". IndexedDB gives hundreds of MB, so the document brain
// lives here: original file, extracted text, and embeddings. The mentor reads
// from here for RAG. Server-side multi-device sync (Supabase + storage) is the
// documented next step.
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

const DB_NAME = "larencontre";
const STORE = "docs";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no indexedDB"));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function emit() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("lr-docs-change"));
}

export async function addDoc(doc: Doc): Promise<void> {
  const db = await open();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(doc);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
  emit();
}

export async function allDocs(): Promise<Doc[]> {
  const db = await open();
  const docs = await new Promise<Doc[]>((res, rej) => {
    const tx = db.transaction(STORE, "readonly");
    const r = tx.objectStore(STORE).getAll();
    r.onsuccess = () => res(r.result as Doc[]);
    r.onerror = () => rej(r.error);
  });
  return docs.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteDoc(id: string): Promise<void> {
  const db = await open();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
  emit();
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export async function searchDocs(queryEmbedding: number[], k = 5): Promise<{ title: string; text: string; score: number }[]> {
  const docs = await allDocs();
  const hits: { title: string; text: string; score: number }[] = [];
  for (const d of docs) {
    for (const c of d.chunks || []) {
      if (!c.embedding?.length) continue;
      hits.push({ title: d.title, text: c.text, score: cosine(queryEmbedding, c.embedding) });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, k);
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
