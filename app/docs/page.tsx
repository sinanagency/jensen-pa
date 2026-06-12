"use client";

import { useEffect, useMemo, useState } from "react";
import Shell from "@/components/Shell";
import {
  FileText, FileSignature, ScrollText, BookOpen, Image as ImageIcon,
  Receipt, Briefcase, Folder, Search, X, ChevronRight, Archive,
} from "lucide-react";

type Doc = {
  id: string;
  title: string;
  fileName?: string;
  mime?: string;
  kind?: string;
  entityId?: string;
  folder?: string;
  text: string;
  size?: number;
  createdAt: number;
  docDate?: string | null;
};

type Entity = { id: string; name: string; kind: string };

const FOLDER_LABELS: Record<string, string> = {
  contracts: "Contracts",
  proposals: "Proposals",
  decks: "Decks",
  "upaya-decks": "Upaya Decks",
  policies: "Policies",
  operations: "Operations",
  pricing: "Pricing",
  brand: "Brand",
  images: "Images",
  media: "Media",
  archives: "Archives",
  pastes: "Pastes",
  legal: "Legal",
  clients: "Clients",
  general: "General",
  other: "Other",
};

const FOLDER_ORDER = [
  "contracts", "proposals", "decks", "upaya-decks",
  "policies", "operations", "pricing", "brand",
  "images", "media", "archives", "pastes", "general", "other",
];

function iconForKind(kind?: string) {
  switch (kind) {
    case "contract":
    case "agreement":
      return <FileSignature size={15} />;
    case "policy":
    case "legal":
      return <ScrollText size={15} />;
    case "pdf":
      return <FileText size={15} />;
    case "docx":
    case "doc":
      return <BookOpen size={15} />;
    case "image":
      return <ImageIcon size={15} />;
    case "invoice":
      return <Receipt size={15} />;
    case "archive":
      return <Archive size={15} />;
    default:
      return <FileText size={15} />;
  }
}

function formatBytes(n?: number): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso?: string | null, ms?: number): string {
  const d = iso ? new Date(iso) : ms ? new Date(ms) : null;
  if (!d || isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function DocsPage() {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [entities, setEntities] = useState<Record<string, Entity>>({});
  const [folder, setFolder] = useState<string>("all");
  const [q, setQ] = useState<string>("");
  const [open, setOpen] = useState<Doc | null>(null);
  const [err, setErr] = useState<string>("");

  useEffect(() => {
    Promise.all([
      fetch("/api/docs").then((r) => r.json()).catch((e) => ({ error: String(e) })),
      fetch("/api/state").then((r) => r.json()).catch(() => ({ entities: [] })),
    ]).then(([dResp, sResp]) => {
      if (dResp?.error) { setErr(dResp.error); setDocs([]); return; }
      setDocs(dResp.docs || []);
      const map: Record<string, Entity> = {};
      for (const e of sResp.entities || []) map[e.id] = e;
      setEntities(map);
    });
  }, []);

  const allFolders = useMemo(() => {
    if (!docs) return [];
    const present = new Set(docs.map((d) => d.folder || "general"));
    return FOLDER_ORDER.filter((f) => present.has(f));
  }, [docs]);

  const filtered = useMemo(() => {
    if (!docs) return [];
    const ql = q.trim().toLowerCase();
    return docs
      .filter((d) => folder === "all" || (d.folder || "general") === folder)
      .filter((d) => {
        if (!ql) return true;
        return (
          d.title.toLowerCase().includes(ql) ||
          (d.text || "").toLowerCase().includes(ql) ||
          (d.fileName || "").toLowerCase().includes(ql)
        );
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [docs, folder, q]);

  const grouped = useMemo(() => {
    const out: Record<string, Doc[]> = {};
    for (const d of filtered) {
      const f = d.folder || "general";
      (out[f] ||= []).push(d);
    }
    return out;
  }, [filtered]);

  return (
    <Shell>
      <div className="docs-page">
        <header className="page-head">
          <div>
            <h1 className="page-title">Documents</h1>
            <p className="page-sub">
              {docs ? `${docs.length} on file, ${Object.keys(allFolders.reduce((acc, f) => ({ ...acc, [f]: true }), {})).length} folders` : "Reading the cabinet..."}
            </p>
          </div>
          <div className="search">
            <Search size={14} />
            <input
              placeholder="Search every document, every word"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {q && <button type="button" className="clearq" onClick={() => setQ("")} aria-label="Clear search"><X size={14} /></button>}
          </div>
        </header>

        <div className="folder-rail">
          <button
            type="button"
            className={`f-pill ${folder === "all" ? "on" : ""}`}
            onClick={() => setFolder("all")}
          >
            <Folder size={13} /> All <span className="ct">{docs?.length ?? 0}</span>
          </button>
          {allFolders.map((f) => (
            <button
              key={f}
              type="button"
              className={`f-pill ${folder === f ? "on" : ""}`}
              onClick={() => setFolder(f)}
            >
              <Folder size={13} /> {FOLDER_LABELS[f] || f}{" "}
              <span className="ct">{docs?.filter((d) => (d.folder || "general") === f).length}</span>
            </button>
          ))}
        </div>

        {err && <div className="doc-err">Could not read documents: {err}</div>}

        {docs == null ? (
          <div className="doc-skel">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="doc-card skel" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="doc-empty">
            <Briefcase size={28} />
            <div>Nothing here yet</div>
            <div className="sub">{q ? "Try a different search." : "Drop a contract or upload a deck and it will appear in the right folder."}</div>
          </div>
        ) : (
          Object.keys(grouped).map((f) => (
            <section className="doc-group" key={f}>
              {folder === "all" && (
                <h3 className="group-head">
                  {FOLDER_LABELS[f] || f}
                  <span className="ct">{grouped[f].length}</span>
                </h3>
              )}
              <div className="doc-grid">
                {grouped[f].map((d) => {
                  const ent = d.entityId ? entities[d.entityId] : null;
                  return (
                    <button
                      type="button"
                      className="doc-card"
                      key={d.id}
                      onClick={() => setOpen(d)}
                    >
                      <div className="doc-row1">
                        <span className="doc-ico">{iconForKind(d.kind)}</span>
                        <span className="doc-title">{d.title}</span>
                      </div>
                      <div className="doc-row2">
                        {ent && <span className="doc-tag">{ent.name}</span>}
                        {d.docDate && <span className="doc-date">{formatDate(d.docDate)}</span>}
                        {!d.docDate && <span className="doc-date">{formatDate(undefined, d.createdAt)}</span>}
                        {d.size ? <span className="doc-size">{formatBytes(d.size)}</span> : null}
                      </div>
                      <ChevronRight size={14} className="doc-chev" />
                    </button>
                  );
                })}
              </div>
            </section>
          ))
        )}

        {open && (
          <div className="doc-sheet-bg" onClick={() => setOpen(null)}>
            <div className="doc-sheet" onClick={(e) => e.stopPropagation()}>
              <div className="sheet-head">
                <div>
                  <div className="sheet-folder">{FOLDER_LABELS[open.folder || "general"]}</div>
                  <h2 className="sheet-title">{open.title}</h2>
                  {open.entityId && entities[open.entityId] && (
                    <div className="sheet-ent">For {entities[open.entityId].name}</div>
                  )}
                </div>
                <button type="button" className="sheet-x" onClick={() => setOpen(null)} aria-label="Close">
                  <X size={16} />
                </button>
              </div>
              <div className="sheet-meta">
                {open.docDate && <span>Dated {formatDate(open.docDate)}</span>}
                {open.fileName && <span>{open.fileName}</span>}
                {open.size ? <span>{formatBytes(open.size)}</span> : null}
              </div>
              <div className="sheet-body">
                {(open.text || "").trim() || <em>No body content stored for this document.</em>}
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{`
        .docs-page { padding: 28px 32px 60px; max-width: 1200px; margin: 0 auto; }
        .page-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; margin-bottom: 22px; }
        .page-title { font-family: var(--font-serif-stack); font-size: 34px; font-weight: 500; letter-spacing: -0.01em; }
        .page-sub { color: var(--muted); font-size: 13px; margin-top: 4px; }
        .search { position: relative; display: flex; align-items: center; gap: 8px; background: var(--glass-2); border: 1px solid var(--line); border-radius: 14px; padding: 10px 14px; min-width: 320px; }
        .search input { flex: 1; background: transparent; border: 0; outline: none; color: var(--ink); font-size: 13.5px; }
        .search input::placeholder { color: var(--faint); font-style: italic; }
        .clearq { background: none; border: 0; color: var(--muted); cursor: pointer; padding: 2px; display: inline-flex; }

        .folder-rail { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 24px; padding-bottom: 14px; border-bottom: 1px solid var(--line); }
        .f-pill { display: inline-flex; align-items: center; gap: 7px; padding: 7px 13px; border-radius: var(--radius-pill); background: var(--glass-3); border: 1px solid var(--line); color: var(--ink-2); font-size: 12.5px; cursor: pointer; transition: all 0.18s var(--ease); }
        .f-pill:hover { color: var(--ink); border-color: var(--line-2); }
        .f-pill.on { background: var(--purple-soft); border-color: var(--purple-line); color: var(--ink); }
        .ct { font-size: 11px; color: var(--muted); margin-left: 3px; }
        .f-pill.on .ct { color: var(--purple-2); }

        .doc-err { background: rgba(248, 113, 113, 0.1); border: 1px solid rgba(248, 113, 113, 0.3); color: #fbb; padding: 14px 18px; border-radius: var(--radius-sm); margin-bottom: 20px; font-size: 13px; }

        .doc-group { margin-bottom: 36px; }
        .group-head { font-family: var(--font-serif-stack); font-size: 20px; font-weight: 500; letter-spacing: 0.5px; margin-bottom: 14px; color: var(--ink); display: flex; align-items: center; gap: 10px; }
        .group-head .ct { font-family: var(--font-body); font-size: 11.5px; color: var(--faint); margin-left: 4px; }

        .doc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
        .doc-card { position: relative; background: var(--glass-2); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 14px 16px; text-align: left; cursor: pointer; transition: all 0.2s var(--ease); color: var(--ink); font-family: inherit; }
        .doc-card:hover { background: var(--glass); border-color: var(--purple-line); transform: translateY(-1px); }
        .doc-card.skel { background: var(--glass-3); border-color: var(--edge); height: 86px; animation: pulse 1.6s ease-in-out infinite; }
        @keyframes pulse { 0%,100% { opacity: 0.7; } 50% { opacity: 0.4; } }

        .doc-row1 { display: flex; align-items: center; gap: 9px; margin-bottom: 9px; padding-right: 16px; }
        .doc-ico { color: var(--purple-2); display: inline-flex; flex-shrink: 0; }
        .doc-title { font-size: 14px; font-weight: 500; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
        .doc-row2 { display: flex; flex-wrap: wrap; gap: 10px; font-size: 11.5px; color: var(--muted); align-items: center; }
        .doc-tag { background: rgba(124, 107, 176, 0.14); color: var(--purple-2); padding: 2px 8px; border-radius: var(--radius-pill); font-size: 11px; }
        .doc-date, .doc-size { color: var(--faint); }
        .doc-chev { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); color: var(--faint); transition: color 0.18s; }
        .doc-card:hover .doc-chev { color: var(--purple-2); }

        .doc-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 80px 20px; color: var(--muted); }
        .doc-empty > div:first-of-type { margin-top: 16px; font-size: 16px; color: var(--ink-2); }
        .doc-empty .sub { font-size: 12.5px; margin-top: 6px; color: var(--faint); }

        .doc-sheet-bg { position: fixed; inset: 0; background: rgba(8, 7, 10, 0.72); backdrop-filter: blur(10px); z-index: var(--z-modal); display: flex; justify-content: flex-end; }
        .doc-sheet { width: min(640px, 100vw); height: 100vh; overflow-y: auto; background: var(--surface-elevated); border-left: 1px solid var(--line-2); padding: 32px; animation: slideIn 0.28s var(--ease); }
        @keyframes slideIn { from { transform: translateX(40px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        .sheet-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 18px; }
        .sheet-folder { font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--purple-2); margin-bottom: 8px; }
        .sheet-title { font-family: var(--font-serif-stack); font-size: 26px; font-weight: 500; line-height: 1.2; }
        .sheet-ent { font-size: 12.5px; color: var(--muted); margin-top: 8px; font-style: italic; }
        .sheet-x { background: var(--glass-2); border: 1px solid var(--line); color: var(--ink-2); border-radius: 8px; padding: 8px; cursor: pointer; display: inline-flex; }
        .sheet-x:hover { color: var(--ink); border-color: var(--line-2); }
        .sheet-meta { display: flex; flex-wrap: wrap; gap: 14px; font-size: 11.5px; color: var(--faint); border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); padding: 10px 0; margin-bottom: 22px; }
        .sheet-body { white-space: pre-wrap; line-height: 1.65; font-size: 14px; color: var(--ink-2); font-family: var(--font-body); }

        @media (max-width: 720px) {
          .docs-page { padding: 18px 18px 60px; }
          .page-head { flex-direction: column; align-items: stretch; }
          .search { min-width: 0; }
          .doc-grid { grid-template-columns: 1fr; }
          .doc-sheet { padding: 22px 18px; }
        }
      `}</style>
    </Shell>
  );
}
