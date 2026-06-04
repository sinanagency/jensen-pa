"use client";

import { useEffect, useRef, useState } from "react";
import Shell from "@/components/Shell";
import { useDB } from "@/components/useDB";
import { Doc, addDoc, allDocs, deleteDoc, searchDocs, uid } from "@/lib/docs-client";
import { UploadCloud, FileText, Trash2, Search, Loader2, Image as ImageIcon, Receipt, ScrollText, Download } from "lucide-react";

const MAX_BYTES = 4 * 1024 * 1024; // 4MB per file (v1, client + serverless limit)

type Status = { name: string; state: "reading" | "ingesting" | "done" | "error"; msg?: string };

function kindIcon(kind: string) {
  if (kind === "invoice") return <Receipt size={16} />;
  if (kind === "image") return <ImageIcon size={16} />;
  if (kind === "legal") return <ScrollText size={16} />;
  return <FileText size={16} />;
}

function fileToBase64(file: File): Promise<{ dataUrl: string; base64: string }> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const dataUrl = String(r.result);
      resolve({ dataUrl, base64: dataUrl.split(",")[1] || "" });
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export default function Brain() {
  const { db } = useDB();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [drag, setDrag] = useState(false);
  const [queue, setQueue] = useState<Status[]>([]);
  const [entityId, setEntityId] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<{ title: string; text: string; score: number }[] | null>(null);
  const [searching, setSearching] = useState(false);

  async function refresh() { setDocs(await allDocs()); }
  useEffect(() => {
    refresh();
    const on = () => refresh();
    window.addEventListener("lr-docs-change", on);
    return () => window.removeEventListener("lr-docs-change", on);
  }, []);

  async function ingest(files: FileList | File[]) {
    const list = Array.from(files);
    for (const file of list) {
      const st: Status = { name: file.name, state: "reading" };
      setQueue((q) => [st, ...q]);
      const upd = (patch: Partial<Status>) => setQueue((q) => q.map((s) => (s === st ? { ...s, ...patch } : s)));
      try {
        if (file.size > MAX_BYTES) { upd({ state: "error", msg: "Over 4MB. Larger files need the server storage upgrade." }); continue; }
        const { dataUrl, base64 } = await fileToBase64(file);
        upd({ state: "ingesting" });
        const res = await fetch("/api/ingest-file", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ filename: file.name, mime: file.type, dataBase64: base64 }),
        });
        const data = await res.json();
        if (!res.ok) { upd({ state: "error", msg: data.error || "Could not read that file." }); continue; }
        const doc: Doc = {
          id: uid(), title: data.title, fileName: file.name, mime: file.type || "application/octet-stream",
          kind: data.kind || "document", entityId: entityId || undefined, text: data.text,
          chunks: data.chunks || [], size: file.size, dataUrl, createdAt: Date.now(),
        };
        await addDoc(doc);
        upd({ state: "done" });
      } catch (e: any) {
        upd({ state: "error", msg: e?.message || "Failed." });
      }
    }
  }

  async function search() {
    const q = query.trim();
    if (!q) return;
    setSearching(true); setHits(null);
    try {
      const res = await fetch("/api/brain", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "query", text: q }) });
      const { embedding } = await res.json();
      if (embedding) setHits((await searchDocs(embedding, 6)).filter((h) => h.score > 0.15));
    } finally { setSearching(false); }
  }

  const entityName = (id?: string) => db?.entities.find((e) => e.id === id)?.name;

  return (
    <Shell>
      <div className="page-hero fade-up">
        <div className="eyebrow">Document brain</div>
        <h1>Everything I remember.</h1>
      </div>
      <p className="muted" style={{ marginTop: -10, marginBottom: 18, maxWidth: 620 }}>
        Drop his proposals, invoices, menus, SOPs, contracts, anything. I read every file, remember it, and use it when we talk.
      </p>

      {/* dropzone */}
      <div
        className={`card ${drag ? "feature" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files?.length) ingest(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        style={{ padding: 34, textAlign: "center", cursor: "pointer", borderStyle: "dashed", marginBottom: 14 }}
      >
        <input ref={inputRef} type="file" multiple hidden
          onChange={(e) => { if (e.target.files?.length) ingest(e.target.files); e.currentTarget.value = ""; }} />
        <div className="orb sm" style={{ margin: "0 auto 12px", opacity: 0.9 }} />
        <div style={{ fontSize: 16, fontWeight: 600, display: "flex", gap: 8, justifyContent: "center", alignItems: "center" }}>
          <UploadCloud size={18} /> Drop files here, or click to browse
        </div>
        <div className="faint" style={{ fontSize: 12.5, marginTop: 6 }}>PDF, Word, Excel, CSV, text, and images. Up to 4MB each.</div>
        <div style={{ marginTop: 14, display: "flex", gap: 8, justifyContent: "center", alignItems: "center" }} onClick={(e) => e.stopPropagation()}>
          <span className="faint" style={{ fontSize: 12 }}>Tag to</span>
          <select className="input" value={entityId} onChange={(e) => setEntityId(e.target.value)} style={{ width: "auto", height: 34, padding: "0 10px" }}>
            <option value="">No entity</option>
            {db?.entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
      </div>

      {/* upload queue */}
      {queue.length > 0 && (
        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          {queue.slice(0, 8).map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", fontSize: 13.5 }}>
              {s.state === "done" ? <span style={{ color: "var(--success)" }}>✓</span>
                : s.state === "error" ? <span style={{ color: "var(--danger)" }}>!</span>
                : <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} />}
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
              <span className="faint" style={{ fontSize: 12 }}>
                {s.state === "reading" ? "reading" : s.state === "ingesting" ? "reading and remembering" : s.state === "done" ? "saved" : s.msg}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* search the brain */}
      <div className="card feature" style={{ padding: 18, marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} placeholder="Ask the brain, e.g. what margin did we set for the rooftop concept" style={{ flex: 1 }} />
          <button className="btn purple" onClick={search} disabled={searching} style={{ width: 48, padding: 0 }}>
            {searching ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> : <Search size={16} />}
          </button>
        </div>
        {hits && (
          <div style={{ marginTop: 14 }}>
            {hits.length === 0 && <div className="muted" style={{ fontSize: 13.5 }}>Nothing close in the brain yet. Drop some files first.</div>}
            {hits.map((h, i) => (
              <div key={i} style={{ padding: "10px 0", borderTop: "1px solid var(--line)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <span className="accent" style={{ fontSize: 13.5, fontWeight: 600 }}>{h.title}</span>
                  <span className="pill accent" style={{ height: 22 }}>{Math.round(h.score * 100)}% match</span>
                </div>
                <div className="muted" style={{ fontSize: 13, marginTop: 4, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{h.text}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* library */}
      <div className="card" style={{ padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontWeight: 600 }}>Library</div>
          <span className="faint" style={{ fontSize: 12.5 }}>{docs.length} document{docs.length === 1 ? "" : "s"}</span>
        </div>
        {docs.length === 0 && <div className="muted" style={{ fontSize: 14, padding: "10px 0" }}>No documents yet. Drop your first file above.</div>}
        {docs.map((d) => (
          <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderTop: "1px solid var(--line)" }}>
            <span style={{ color: "var(--purple-2)" }}>{kindIcon(d.kind || "document")}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.title}</div>
              <div className="faint" style={{ fontSize: 11.5 }}>
                {d.kind}{entityName(d.entityId) ? ` · ${entityName(d.entityId)}` : ""} · {((d.size || 0) / 1024).toFixed(0)} KB · saved to brain
              </div>
            </div>
            {d.dataUrl && <a href={d.dataUrl} download={d.fileName} className="iconbtn" title="Download" onClick={(e) => e.stopPropagation()}><Download size={15} /></a>}
            <button className="iconbtn" title="Remove" onClick={() => deleteDoc(d.id)}><Trash2 size={15} /></button>
          </div>
        ))}
      </div>

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </Shell>
  );
}
