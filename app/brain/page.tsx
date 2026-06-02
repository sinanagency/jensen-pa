"use client";

import { useState } from "react";
import Shell from "@/components/Shell";
import { useDB } from "@/components/useDB";
import { BrainDoc, DocChunk, searchBrain, uid } from "@/lib/store";
import { Plus, Trash2, Search, FileText, Loader2 } from "lucide-react";

type SearchHit = { text: string; title: string; score: number };

type IngestResponse = { chunks: DocChunk[] } | { error: string };
type QueryResponse = { embedding: number[] } | { error: string };

export default function BrainPage() {
  const { db, mutate } = useDB();

  // Add form state
  const [title, setTitle] = useState<string>("");
  const [entityId, setEntityId] = useState<string>("");
  const [text, setText] = useState<string>("");
  const [addBusy, setAddBusy] = useState<boolean>(false);
  const [addError, setAddError] = useState<string>("");

  // Search state
  const [query, setQuery] = useState<string>("");
  const [searchBusy, setSearchBusy] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<string>("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);

  if (!db) return <Shell><div className="muted">Loading…</div></Shell>;

  async function handleAdd(): Promise<void> {
    const trimmedTitle = title.trim();
    const trimmedText = text.trim();
    if (!trimmedTitle || !trimmedText) return;

    setAddBusy(true);
    setAddError("");

    try {
      const res = await fetch("/api/brain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "ingest", text: trimmedText }),
      });
      const data: IngestResponse = await res.json();

      if ("error" in data) {
        setAddError(data.error);
        setAddBusy(false);
        return;
      }

      const newDoc: BrainDoc = {
        id: uid(),
        title: trimmedTitle,
        text: trimmedText,
        entityId: entityId || undefined,
        chunks: data.chunks,
        createdAt: Date.now(),
      };

      mutate((d) => {
        d.docs.push(newDoc);
      });

      setTitle("");
      setEntityId("");
      setText("");
    } catch {
      setAddError("Failed to reach the brain API. Try again.");
    } finally {
      setAddBusy(false);
    }
  }

  async function handleSearch(): Promise<void> {
    const trimmed = query.trim();
    if (!trimmed || !db) return;

    setSearchBusy(true);
    setSearchError("");
    setHits(null);

    try {
      const res = await fetch("/api/brain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "query", text: trimmed }),
      });
      const data: QueryResponse = await res.json();

      if ("error" in data) {
        setSearchError(data.error);
        setSearchBusy(false);
        return;
      }

      const results = searchBrain(db, data.embedding, 5);
      setHits(results);
    } catch {
      setSearchError("Failed to reach the brain API. Try again.");
    } finally {
      setSearchBusy(false);
    }
  }

  function handleDelete(id: string): void {
    mutate((d) => {
      d.docs = d.docs.filter((x) => x.id !== id);
    });
    if (hits) {
      // hits reference docs by title, no id, nothing to invalidate here
    }
  }

  const entityMap = new Map(db.entities.map((e) => [e.id, e.name]));

  return (
    <Shell>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>

      {/* Page hero */}
      <div className="page-hero fade-up">
        <div className="eyebrow">Document brain</div>
        <h1>Everything I remember.</h1>
        <div className="muted" style={{ marginTop: 8, fontSize: 14, lineHeight: 1.65 }}>
          Add his proposals, menus, SOPs, contracts, notes. I read them, remember them, and use them when we talk.
        </div>
      </div>

      {/* Add form */}
      <div className="card fade-up" style={{ padding: 24, marginBottom: 20 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 16, color: "var(--ink-2)" }}>
          Add a document
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Title + entity row */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <input
              className="input"
              style={{ flex: "1 1 200px" }}
              placeholder="Document title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <select
              className="input"
              style={{ flex: "0 1 200px", minWidth: 140 }}
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
            >
              <option value="">No entity (optional)</option>
              {db.entities.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </div>

          {/* Text area */}
          <textarea
            className="input"
            rows={6}
            placeholder="Paste the document text here. I will chunk it and embed it into memory."
            value={text}
            onChange={(e) => setText(e.target.value)}
          />

          {/* Submit row */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              className="btn purple sm"
              onClick={handleAdd}
              disabled={addBusy}
              style={{ opacity: addBusy ? 0.7 : 1 }}
            >
              {addBusy
                ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
                : <Plus size={14} />}
              Add to brain
            </button>
          </div>

          {addError && <div className="err">{addError}</div>}
        </div>
      </div>

      {/* Search card */}
      <div className="card feature fade-up" style={{ padding: 24, marginBottom: 20 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4, color: "var(--ink-2)" }}>
          Search the brain
        </div>
        <div className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
          Ask anything. I will find the most relevant chunks across all documents.
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
          <input
            className="input"
            style={{ flex: "1 1 240px" }}
            placeholder="What are the terms in the Khalifa contract?"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
          />
          <button
            className="btn purple sm"
            onClick={handleSearch}
            disabled={searchBusy}
            style={{ flexShrink: 0, opacity: searchBusy ? 0.7 : 1 }}
          >
            {searchBusy
              ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
              : <Search size={14} />}
            Search
          </button>
        </div>

        {searchError && <div className="err">{searchError}</div>}

        {hits !== null && hits.length === 0 && (
          <div className="faint" style={{ fontSize: 13 }}>
            No matching chunks found. Add more documents to the brain first.
          </div>
        )}

        {hits && hits.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {hits.map((hit, i) => (
              <div
                key={i}
                style={{
                  padding: "14px 16px",
                  borderRadius: 12,
                  background: "var(--glass-2)",
                  border: "1px solid var(--line)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <span className="accent" style={{ fontWeight: 600, fontSize: 13.5 }}>
                    {hit.title}
                  </span>
                  <span className="pill accent" style={{ fontSize: 11, height: 22, padding: "0 9px" }}>
                    {Math.round(hit.score * 100)}% match
                  </span>
                </div>
                <div
                  className="muted"
                  style={{
                    fontSize: 13,
                    lineHeight: 1.6,
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {hit.text}
                </div>
              </div>
            ))}
          </div>
        )}

        {hits === null && !searchBusy && db.docs.length === 0 && (
          <div className="faint" style={{ fontSize: 13 }}>
            No documents in the brain yet. Add one above to get started.
          </div>
        )}
      </div>

      {/* Document list */}
      <div className="card fade-up" style={{ padding: 24 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: "var(--ink-2)" }}>All documents</div>
          <span className="pill" style={{ fontSize: 11 }}>{db.docs.length}</span>
        </div>

        {db.docs.length === 0 && (
          <div className="faint" style={{ fontSize: 13 }}>
            Nothing here yet. Add the first document above.
          </div>
        )}

        {db.docs.map((doc: BrainDoc) => {
          const entityName = doc.entityId ? entityMap.get(doc.entityId) : undefined;
          const date = new Date(doc.createdAt).toLocaleDateString("en-GB", {
            day: "numeric", month: "short", year: "numeric",
          });

          return (
            <div
              key={doc.id}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                padding: "13px 0",
                borderTop: "1px solid var(--line)",
              }}
            >
              <FileText
                size={16}
                strokeWidth={1.6}
                style={{ color: "var(--purple-2)", marginTop: 2, flexShrink: 0 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: "var(--ink)" }}>
                  {doc.title}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5, flexWrap: "wrap" }}>
                  <span className="faint" style={{ fontSize: 12 }}>
                    {doc.chunks.length} chunk{doc.chunks.length !== 1 ? "s" : ""}
                  </span>
                  {entityName && (
                    <span className="pill" style={{ fontSize: 11, height: 22, padding: "0 9px" }}>
                      {entityName}
                    </span>
                  )}
                  <span className="faint" style={{ fontSize: 12 }}>{date}</span>
                </div>
              </div>
              <button
                className="btn ghost sm"
                onClick={() => handleDelete(doc.id)}
                title="Remove document"
                style={{ padding: "0 8px", height: 28, flexShrink: 0, color: "var(--faint)" }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          );
        })}
      </div>
    </Shell>
  );
}
