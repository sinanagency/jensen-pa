"use client";

import { useState } from "react";
import Shell from "@/components/Shell";
import { useDB } from "@/components/useDB";
import { uid } from "@/lib/store";
import { BookOpen, Trash2 } from "lucide-react";

export default function Journal() {
  const { db, mutate } = useDB();
  const [body, setBody] = useState("");

  if (!db) return <Shell><div className="muted">Loading…</div></Shell>;

  const entries = db.notes.filter((n) => n.kind === "journal").sort((a, b) => b.createdAt - a.createdAt);

  function save() {
    const t = body.trim();
    if (!t) return;
    mutate((d) => d.notes.push({ id: uid(), kind: "journal", body: t, createdAt: Date.now() }));
    setBody("");
  }

  return (
    <Shell>
      <div className="page-hero fade-up"><div className="eyebrow">Journal</div><h1>Think on the page.</h1></div>
      <p className="muted" style={{ marginTop: -8, marginBottom: 18, maxWidth: 620 }}>
        A private place to clear your head. Entries are dated and yours alone. Your concierge can draw on them when you ask.
      </p>

      <div className="card feature" style={{ padding: 20, marginBottom: 18 }}>
        <label>New entry</label>
        <textarea className="input" rows={5} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What is on your mind today?" />
        <button className="btn purple" onClick={save} disabled={!body.trim()} style={{ marginTop: 12 }}><BookOpen size={15} /> Save entry</button>
      </div>

      {entries.length === 0 && <div className="card" style={{ padding: 28, textAlign: "center" }}><div className="muted" style={{ fontSize: 14 }}>No entries yet. Your first one starts the habit.</div></div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {entries.map((n) => (
          <div key={n.id} className="card" style={{ padding: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span className="faint" style={{ fontSize: 12 }}>{new Date(n.createdAt).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
              <button className="iconbtn" style={{ marginLeft: "auto", background: "rgba(18,20,28,0.05)", border: "1px solid rgba(18,20,28,0.12)", color: "var(--ink-2)" }} onClick={() => mutate((d) => { d.notes = d.notes.filter((x) => x.id !== n.id); })}><Trash2 size={14} /></button>
            </div>
            <div style={{ fontSize: 14.5, lineHeight: 1.65, color: "var(--ink-2)", whiteSpace: "pre-wrap" }}>{n.body}</div>
          </div>
        ))}
      </div>
    </Shell>
  );
}
